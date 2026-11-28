/**
 * NEXUS CLUB — termos e autorizações (LGPD).
 *
 * - Termos da plataforma (empresaId nulo) são versionados; o cadastro exige aceitar a
 *   versão VIGENTE de cada tipo obrigatório. Sem termo publicado, o cadastro não abre
 *   (nunca se inventa texto jurídico).
 * - Autorização de publicidade por canal: cada mudança é uma linha nova no histórico
 *   (ConsentimentoEvento, que o banco não deixa alterar) e a situação atual fica em
 *   ConsentimentoAtual, na MESMA transação. Sem linha = não autorizado.
 * - Conceder exige a versão do texto de autorização aceito e carteirinha ativa; revogar
 *   vale sempre e na hora.
 */
import type { AcaoConsentimento, CanalConsentimento, OrigemConsentimento, TipoTermo } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ErroDeNegocio } from '../../lib/erros.js';

export const TERMOS_OBRIGATORIOS_CADASTRO: TipoTermo[] = ['TERMOS_USO', 'POLITICA_PRIVACIDADE'];

/** Versão mais recente publicada de cada tipo (plataforma ou de uma empresa). */
export async function termosVigentes(tipos: TipoTermo[], empresaId: string | null = null) {
  const agora = new Date();
  const lista = await Promise.all(tipos.map((tipo) => prisma.termoVersao.findFirst({
    where: { tipo, empresaId, publicadoEm: { lte: agora } },
    orderBy: [{ versao: 'desc' }],
    select: { id: true, tipo: true, versao: true, texto: true, publicadoEm: true },
  })));
  return lista.filter((t): t is NonNullable<typeof t> => !!t);
}

/**
 * Termos obrigatórios cuja versão VIGENTE a pessoa ainda não aceitou (ex.: publicou-se uma
 * versão nova depois do cadastro). Enquanto houver pendência, o clube pede o novo aceite.
 */
export async function termosPendentes(consumidorId: string) {
  const vigentes = await termosVigentes(TERMOS_OBRIGATORIOS_CADASTRO);
  if (!vigentes.length) return [];
  const aceitos = await prisma.termoAceite.findMany({
    where: { consumidorId, termoVersaoId: { in: vigentes.map((t) => t.id) } },
    select: { termoVersaoId: true },
  });
  const ok = new Set(aceitos.map((a) => a.termoVersaoId));
  return vigentes.filter((t) => !ok.has(t.id)).map(({ id, tipo, versao, publicadoEm }) => ({ id, tipo, versao, publicadoEm }));
}

export interface NovoConsentimento {
  empresaId: string;
  consumidorId: string;
  canal: CanalConsentimento;
  acao: AcaoConsentimento;
  origem: OrigemConsentimento;
  termoVersaoId?: string | null;
  registradoPorId?: string | null;
  ip?: string | null;
}

/**
 * Grava a mudança de autorização. Precisa rodar com o contexto da empresa (comTenant ou
 * requisição autenticada), porque as regras do banco só deixam gravar no clube aberto.
 */
export async function registrarConsentimento(d: NovoConsentimento) {
  if (d.acao === 'CONCEDIDO') {
    if (!d.termoVersaoId) throw new ErroDeNegocio('Para autorizar, informe a versão do texto de autorização aceito.', 400);
    const termo = await prisma.termoVersao.findFirst({ where: { id: d.termoVersaoId, empresaId: d.empresaId, tipo: 'AUTORIZACAO_MARKETING' }, select: { id: true } });
    if (!termo) throw new ErroDeNegocio('Texto de autorização não encontrado neste clube.', 400);
    const membro = await prisma.membroClube.findFirst({ where: { empresaId: d.empresaId, consumidorId: d.consumidorId, status: 'ATIVO' }, select: { id: true } });
    if (!membro) throw new ErroDeNegocio('Só quem participa do clube pode autorizar mensagens.', 403);
  }
  return prisma.$transaction(async (tx) => {
    const evento = await tx.consentimentoEvento.create({
      data: {
        empresaId: d.empresaId, consumidorId: d.consumidorId, canal: d.canal, finalidade: 'MARKETING', acao: d.acao,
        origem: d.origem, termoVersaoId: d.termoVersaoId ?? null, registradoPorId: d.registradoPorId ?? null, ip: d.ip ?? null,
      },
    });
    const atual = await tx.consentimentoAtual.upsert({
      where: { empresaId_consumidorId_canal_finalidade: { empresaId: d.empresaId, consumidorId: d.consumidorId, canal: d.canal, finalidade: 'MARKETING' } },
      create: { empresaId: d.empresaId, consumidorId: d.consumidorId, canal: d.canal, finalidade: 'MARKETING', situacao: d.acao, eventoId: evento.id, atualizadoEm: evento.createdAt },
      update: { situacao: d.acao, eventoId: evento.id, atualizadoEm: evento.createdAt },
    });
    return { evento, atual };
  });
}

/** Pode receber mensagem por este canal? Só com autorização CONCEDIDA vigente. */
export async function estaAutorizado(empresaId: string, consumidorId: string, canal: CanalConsentimento): Promise<boolean> {
  const atual = await prisma.consentimentoAtual.findUnique({
    where: { empresaId_consumidorId_canal_finalidade: { empresaId, consumidorId, canal, finalidade: 'MARKETING' } },
    select: { situacao: true },
  });
  return atual?.situacao === 'CONCEDIDO';
}
