/**
 * Execution and Approval Engine (Fase 06).
 *
 * A IA nunca executa uma ação com efeito: ela PREPARA uma proposta (AIAprovacao, nível 2) com
 * os parâmetros já validados, o impacto e as evidências. Só um usuário com a permissão da ação
 * aprova — ou uma política de automação da empresa (nível 3), desligada por padrão, executa
 * dentro de um limite de valor.
 *
 * Idempotência: a transição PENDENTE → EXECUTADA e o efeito de negócio acontecem NA MESMA
 * transação, com a linha travada. Aprovar duas vezes (clique duplo, duas abas, repetição após
 * falha de rede) encontra a proposta já decidida e devolve o mesmo resultado, sem executar de
 * novo. Se o efeito falhar, a transação inteira volta e a proposta fica FALHOU, sem efeito parcial.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { temPermissao } from '../../lib/permissoes.js';
import type { Acao, Modulo } from '../../lib/permissoes-catalogo.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { converterParaUnidadeBaseCompra } from '../estoque/conversao.service.js';
import { STATUS_QUE_RECEBEM_PEDIDO } from '../fornecedores/fornecedor-ficha.service.js';
import { proximoNumeroCompra } from '../compras/compra.service.js';

type Tx = Prisma.TransactionClient;
const VALIDADE_DIAS = 7;

export interface PropostaPreparada { titulo: string; impacto: string; valorCentavos: number | null; proposta: Record<string, unknown>; evidencias?: Record<string, unknown> }

export interface AcaoAprovavel<A = any> {
  id: string;
  nome: string;
  descricao: string;
  /** Permissão exigida de quem aprova (e de quem solicita, para a automação nível 3). */
  permissao: { modulo: Modulo; acao: Acao };
  validar: z.ZodType<A>;
  /** Pode ser executada por política (nível 3)? Só ações com valor e efeito reversível. */
  automatizavel?: boolean;
  preparar(empresaId: string, args: A, filialDaSessao?: string | null): Promise<PropostaPreparada>;
  executar(tx: Tx, empresaId: string, usuarioId: string, proposta: any, aprovacaoId: string): Promise<Record<string, unknown>>;
}

const N = (v: unknown) => Number(v ?? 0);

// ---------------------------------------------------------------------------------------------
// Ação: criar pedido de compra em RASCUNHO. Efeito reversível: o pedido ainda passa pelo fluxo
// normal de compras (aprovação, envio ao fornecedor). Nada é enviado nem pago.
// ---------------------------------------------------------------------------------------------
const criarCompraRascunho: AcaoAprovavel<{ produtoId: string; quantidade: number; fornecedorId?: string; filialId?: string; motivo?: string }> = {
  id: 'criar_compra_rascunho',
  nome: 'Criar pedido de compra (rascunho)',
  descricao: 'Cria um pedido de compra em rascunho no módulo Compras. O pedido não é enviado ao fornecedor nem gera pagamento.',
  permissao: { modulo: 'compras', acao: 'criar' },
  automatizavel: true,
  validar: z.object({ produtoId: z.string().min(1).max(40), quantidade: z.coerce.number().positive().max(1_000_000), fornecedorId: z.string().max(40).optional(), filialId: z.string().max(40).optional(), motivo: z.string().max(300).optional() }),
  async preparar(empresaId, a, filialDaSessao) {
    const produto = await prisma.produto.findFirst({ where: { id: a.produtoId, empresaId }, select: { id: true, nome: true, custo: true, fornecedorId: true, unidade: true } });
    if (!produto) throw new ErroDeNegocio('Produto não encontrado nesta empresa.', 404);
    const fornecedorId = a.fornecedorId ?? produto.fornecedorId;
    if (!fornecedorId) throw new ErroDeNegocio(`O produto ${produto.nome} não tem fornecedor padrão; informe o fornecedor.`, 422);
    const fornecedor = await prisma.fornecedor.findFirst({ where: { id: fornecedorId, empresaId }, select: { id: true, nome: true, status: true } });
    if (!fornecedor) throw new ErroDeNegocio('Fornecedor não encontrado nesta empresa.', 404);
    if (!STATUS_QUE_RECEBEM_PEDIDO.includes(fornecedor.status)) throw new ErroDeNegocio(`Fornecedor ${fornecedor.nome} está ${fornecedor.status.toLowerCase()} e não recebe pedidos.`, 422);
    const filial = await prisma.filial.findFirst({ where: { empresaId, ...(a.filialId ?? filialDaSessao ? { id: (a.filialId ?? filialDaSessao)! } : {}) }, select: { id: true, nome: true }, orderBy: { createdAt: 'asc' } });
    if (!filial) throw new ErroDeNegocio('Filial não encontrada nesta empresa.', 404);
    const valorUnit = N(produto.custo);
    const conv = await converterParaUnidadeBaseCompra({ empresaId, produtoId: produto.id, quantidadeCompra: a.quantidade, unidadeCompraSimbolo: produto.unidade || 'UN', fornecedorId: fornecedor.id });
    const total = Math.round(valorUnit * a.quantidade * 100) / 100;
    return {
      titulo: `Comprar ${a.quantidade} ${produto.unidade || 'UN'} de ${produto.nome} — ${fornecedor.nome}`,
      impacto: `Cria um pedido de compra em rascunho de R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (custo atual R$ ${valorUnit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} por ${produto.unidade || 'unidade'}) para a filial ${filial.nome}. O pedido segue o fluxo normal de Compras; nada é enviado ao fornecedor.`,
      valorCentavos: Math.round(total * 100),
      proposta: { produtoId: produto.id, produto: produto.nome, quantidade: a.quantidade, unidadeCompra: produto.unidade || 'UN', fornecedorId: fornecedor.id, fornecedor: fornecedor.nome, filialId: filial.id, filial: filial.nome, valorUnit, fatorAplicado: conv.fator.toNumber(), quantidadeBase: conv.quantidadeDestino.toNumber(), motivo: a.motivo ?? null },
    };
  },
  async executar(tx, empresaId, usuarioId, p, aprovacaoId) {
    const valorTotal = Math.round(p.valorUnit * p.quantidade * 100) / 100;
    const compra = await tx.compra.create({
      data: {
        empresaId, filialId: p.filialId, fornecedorId: p.fornecedorId, valorTotal, valorProdutos: valorTotal, status: 'RASCUNHO', origem: 'IA',
        numero: await proximoNumeroCompra(tx, empresaId),
        observacoes: `Preparado pela NEXUS AI e aprovado (aprovação ${aprovacaoId}).${p.motivo ? ` Motivo: ${String(p.motivo).slice(0, 200)}` : ''}`,
        responsavelId: usuarioId, criadoPorId: usuarioId, atualizadoPorId: usuarioId, atualizadoEm: new Date(),
        itens: { create: [{ produtoId: p.produtoId, quantidade: p.quantidade, unidadeCompra: p.unidadeCompra ?? 'UN', fatorAplicado: p.fatorAplicado, quantidadeBase: p.quantidadeBase, valorUnit: p.valorUnit }] },
      },
      select: { id: true, numero: true, valorTotal: true, status: true },
    });
    return { compraId: compra.id, numero: compra.numero, valorTotal: N(compra.valorTotal), status: compra.status };
  },
};

// ---------------------------------------------------------------------------------------------
// Ação: ajustar o estoque mínimo de um produto (ex.: a partir da previsão de demanda).
// Reversível: o valor anterior fica na proposta e na auditoria.
// ---------------------------------------------------------------------------------------------
const ajustarEstoqueMinimo: AcaoAprovavel<{ produtoId: string; estoqueMinimo: number; motivo?: string }> = {
  id: 'ajustar_estoque_minimo',
  nome: 'Ajustar estoque mínimo',
  descricao: 'Altera o estoque mínimo do cadastro de um produto. O valor anterior fica registrado para desfazer.',
  permissao: { modulo: 'produtos', acao: 'editar' },
  validar: z.object({ produtoId: z.string().min(1).max(40), estoqueMinimo: z.coerce.number().min(0).max(10_000_000), motivo: z.string().max(300).optional() }),
  async preparar(empresaId, a) {
    const p = await prisma.produto.findFirst({ where: { id: a.produtoId, empresaId }, select: { id: true, nome: true, unidade: true, estoqueMinimo: true } });
    if (!p) throw new ErroDeNegocio('Produto não encontrado nesta empresa.', 404);
    const atual = N(p.estoqueMinimo); const novo = Math.round(a.estoqueMinimo * 1000) / 1000;
    if (atual === novo) throw new ErroDeNegocio(`O estoque mínimo de ${p.nome} já é ${novo}.`, 422);
    return {
      titulo: `Estoque mínimo de ${p.nome}: ${atual} → ${novo} ${p.unidade || ''}`.trim(),
      impacto: `Muda o estoque mínimo do cadastro de ${p.nome} de ${atual} para ${novo} ${p.unidade || ''}. Alertas de estoque baixo e sugestões de reposição passam a usar o novo valor.`.replace(/\s+\./, '.'),
      valorCentavos: null,
      proposta: { produtoId: p.id, produto: p.nome, anterior: atual, estoqueMinimo: novo, motivo: a.motivo ?? null },
    };
  },
  async executar(tx, empresaId, _usuarioId, p) {
    const r = await tx.produto.updateMany({ where: { id: p.produtoId, empresaId }, data: { estoqueMinimo: p.estoqueMinimo } });
    if (!r.count) throw new Error('Produto não encontrado nesta empresa.');
    return { produtoId: p.produtoId, anterior: p.anterior, estoqueMinimo: p.estoqueMinimo };
  },
};

// ---------------------------------------------------------------------------------------------
// Ação: bloquear um usuário (resposta a alerta de segurança). Inativa a conta e encerra todas as
// sessões abertas na hora. Reversível pelo módulo Usuários (reativar).
// ---------------------------------------------------------------------------------------------
const bloquearUsuario: AcaoAprovavel<{ usuarioId: string; motivo?: string }> = {
  id: 'bloquear_usuario',
  nome: 'Bloquear usuário',
  descricao: 'Inativa a conta do usuário e encerra as sessões abertas. Pode ser reativado no módulo Usuários.',
  permissao: { modulo: 'usuarios', acao: 'editar' },
  validar: z.object({ usuarioId: z.string().min(1).max(40), motivo: z.string().max(300).optional() }),
  async preparar(empresaId, a) {
    const u = await prisma.usuario.findFirst({ where: { id: a.usuarioId, empresaId }, select: { id: true, nome: true, status: true } });
    if (!u) throw new ErroDeNegocio('Usuário não encontrado nesta empresa.', 404);
    if (u.status !== 'ATIVO') throw new ErroDeNegocio(`${u.nome} já não está ativo.`, 422);
    return {
      titulo: `Bloquear o usuário ${u.nome}`,
      impacto: `${u.nome} não consegue mais entrar e todas as sessões abertas são encerradas imediatamente. Para desfazer, reative o usuário no módulo Usuários.`,
      valorCentavos: null,
      proposta: { usuarioId: u.id, usuario: u.nome, motivo: a.motivo ?? null },
    };
  },
  async executar(tx, empresaId, aprovadorId, p) {
    if (p.usuarioId === aprovadorId) throw new Error('Você não pode bloquear a própria conta.');
    const r = await tx.usuario.updateMany({ where: { id: p.usuarioId, empresaId, status: 'ATIVO' }, data: { status: 'INATIVO', sessoesValidasDesde: new Date() } });
    if (!r.count) throw new Error('Usuário não encontrado ou já inativo.');
    return { usuarioId: p.usuarioId, status: 'INATIVO', sessoesEncerradas: true };
  },
};

const ACOES = new Map<string, AcaoAprovavel>([criarCompraRascunho, ajustarEstoqueMinimo, bloquearUsuario].map((a) => [a.id, a]));
export const acaoAprovavel = (id: string) => ACOES.get(id);

/**
 * Usuário que um alerta de segurança aponta (para preparar o bloqueio): a conta atacada por
 * logins falhos, a conta que recebeu permissões ou quem exportou em massa. null = não se aplica.
 */
export function usuarioAlvoDoInsight(tipo: string, evidencias: unknown): string | null {
  const e = (evidencias ?? {}) as Record<string, unknown>;
  const id = tipo === 'LOGIN_FALHO' ? e.usuarioId : tipo === 'PERMISSAO_ALTERADA' ? e.usuarioAlteradoId : tipo === 'EXPORTACAO_MASSA' ? e.usuarioId : null;
  return typeof id === 'string' && id !== 'desconhecido' ? id : null;
}
export const acoesAprovaveis = () => [...ACOES.values()];

const SELECAO = { id: true, acao: true, titulo: true, proposta: true, evidencias: true, impacto: true, valorCentavos: true, nivel: true, status: true, solicitadoPor: true, execucaoId: true, insightId: true, decididoPor: true, decididoEm: true, motivo: true, resultado: true, erro: true, expiraEm: true, createdAt: true } as const;

/**
 * Prepara uma proposta. Mesmos parâmetros no mesmo dia = mesma proposta (não duplica).
 * Se houver política ativa (nível 3) e o valor couber no limite, executa na hora.
 */
export async function criarProposta(p: { empresaId: string; usuarioId: string | null; filialId?: string | null; acao: string; args: unknown; execucaoId?: string | null; insightId?: string | null; evidencias?: Record<string, unknown>; idempotencyKey?: string }) {
  const acao = ACOES.get(p.acao);
  if (!acao) throw new ErroDeNegocio(`Ação "${p.acao}" não existe.`, 400);
  const args = acao.validar.parse(p.args ?? {});
  const prep = await acao.preparar(p.empresaId, args, p.filialId);
  const dia = new Date().toISOString().slice(0, 10);
  const chave = p.idempotencyKey ?? `${acao.id}:${createHash('sha256').update(JSON.stringify(prep.proposta) + dia).digest('hex').slice(0, 32)}`;
  const existente = await prisma.aIAprovacao.findUnique({ where: { empresaId_idempotencyKey: { empresaId: p.empresaId, idempotencyKey: chave } }, select: SELECAO });
  if (existente) return { ...existente, reaproveitada: true };
  let criada;
  try {
    criada = await prisma.aIAprovacao.create({ data: {
      empresaId: p.empresaId, acao: acao.id, titulo: prep.titulo.slice(0, 200), proposta: prep.proposta as Prisma.InputJsonValue, evidencias: { ...(prep.evidencias ?? {}), ...(p.evidencias ?? {}) } as Prisma.InputJsonValue,
      impacto: prep.impacto, valorCentavos: prep.valorCentavos, nivel: 2, solicitadoPor: p.usuarioId, execucaoId: p.execucaoId ?? null, insightId: p.insightId ?? null,
      idempotencyKey: chave, expiraEm: new Date(Date.now() + VALIDADE_DIAS * 86_400_000),
    }, select: SELECAO });
  } catch (e: any) {
    if (e?.code !== 'P2002') throw e; // corrida: outra requisição criou a mesma proposta
    return { ...(await prisma.aIAprovacao.findUniqueOrThrow({ where: { empresaId_idempotencyKey: { empresaId: p.empresaId, idempotencyKey: chave } }, select: SELECAO })), reaproveitada: true };
  }
  await registrarAuditoria({ empresaId: p.empresaId, usuarioId: p.usuarioId ?? undefined, acao: 'CRIAR', entidade: 'AIAprovacao', entidadeId: criada.id, valorNovo: { acao: acao.id, titulo: criada.titulo, valorCentavos: criada.valorCentavos }, origem: 'IA' });

  // Nível 3: política explícita da empresa, dentro do limite de valor, e o solicitante pode executar a ação.
  const politica = await prisma.aIAutomacao.findUnique({ where: { empresaId_acao: { empresaId: p.empresaId, acao: acao.id } } });
  const cabe = acao.automatizavel && politica?.ativa && (politica.valorMaxCentavos == null || (criada.valorCentavos ?? 0) <= politica.valorMaxCentavos);
  if (cabe && p.usuarioId && (await temPermissao(p.usuarioId, acao.permissao.modulo, acao.permissao.acao))) {
    return { ...(await executarDecisao(p.empresaId, p.usuarioId, criada.id, { automatica: true })), reaproveitada: false };
  }
  return { ...criada, reaproveitada: false };
}

async function executarDecisao(empresaId: string, usuarioId: string, id: string, op: { automatica?: boolean }) {
  const ap = await prisma.aIAprovacao.findFirst({ where: { id, empresaId }, select: SELECAO });
  if (!ap) throw NaoEncontrado('Proposta não encontrada.');
  const acao = ACOES.get(ap.acao)!;
  const decididoPor = op.automatica ? `politica:${ap.acao}` : usuarioId;
  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const trava = await tx.aIAprovacao.updateMany({ where: { id, empresaId, status: 'PENDENTE', expiraEm: { gt: new Date() } }, data: { status: 'EXECUTADA', decididoPor, decididoEm: new Date(), nivel: op.automatica ? 3 : 2 } });
      if (trava.count === 0) return null; // já decidida (ou expirada): não executa de novo
      const r = await acao.executar(tx, empresaId, usuarioId, ap.proposta, id);
      await tx.aIAprovacao.update({ where: { id }, data: { resultado: r as Prisma.InputJsonValue } });
      return r;
    }, { timeout: 30_000 });
    if (resultado) {
      await registrarAuditoria({ empresaId, usuarioId, acao: 'CRIAR', entidade: 'AIAprovacao', entidadeId: id, valorNovo: { decisao: op.automatica ? 'executada_por_politica' : 'aprovada', resultado } as Prisma.InputJsonValue, origem: 'IA', contexto: ap.acao });
    }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await prisma.aIAprovacao.updateMany({ where: { id, empresaId, status: 'PENDENTE' }, data: { status: 'FALHOU', erro: msg, decididoPor, decididoEm: new Date() } });
  }
  await prisma.aIAprovacao.updateMany({ where: { id, empresaId, status: 'PENDENTE', expiraEm: { lte: new Date() } }, data: { status: 'EXPIRADA' } });
  return prisma.aIAprovacao.findFirstOrThrow({ where: { id, empresaId }, select: SELECAO });
}

/** Aprovar ou rejeitar. Repetir a mesma decisão é seguro: devolve o estado atual. */
export async function decidir(empresaId: string, usuarioId: string, id: string, decisao: 'aprovar' | 'rejeitar', motivo?: string) {
  const ap = await prisma.aIAprovacao.findFirst({ where: { id, empresaId }, select: { acao: true, status: true } });
  if (!ap) throw NaoEncontrado('Proposta não encontrada.');
  const acao = ACOES.get(ap.acao);
  if (!acao) throw new ErroDeNegocio('Ação desta proposta não existe mais.', 409);
  if (!(await temPermissao(usuarioId, acao.permissao.modulo, acao.permissao.acao))) throw new ErroDeNegocio(`Você não tem permissão (${acao.permissao.modulo}.${acao.permissao.acao}) para decidir esta proposta.`, 403);
  if (decisao === 'aprovar') return executarDecisao(empresaId, usuarioId, id, {});
  const r = await prisma.aIAprovacao.updateMany({ where: { id, empresaId, status: 'PENDENTE' }, data: { status: 'REJEITADA', decididoPor: usuarioId, decididoEm: new Date(), motivo: motivo?.slice(0, 300) ?? null } });
  if (r.count) await registrarAuditoria({ empresaId, usuarioId, acao: 'EDITAR', entidade: 'AIAprovacao', entidadeId: id, valorNovo: { decisao: 'rejeitada', motivo: motivo ?? null }, origem: 'IA' });
  return prisma.aIAprovacao.findFirstOrThrow({ where: { id, empresaId }, select: SELECAO });
}

export async function listarAprovacoes(empresaId: string, status?: string) {
  await prisma.aIAprovacao.updateMany({ where: { empresaId, status: 'PENDENTE', expiraEm: { lte: new Date() } }, data: { status: 'EXPIRADA' } });
  return prisma.aIAprovacao.findMany({ where: { empresaId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, select: SELECAO });
}

export async function listarAutomacoes(empresaId: string) {
  const politicas = await prisma.aIAutomacao.findMany({ where: { empresaId } });
  const por = new Map(politicas.map((p) => [p.acao, p]));
  return acoesAprovaveis().filter((a) => a.automatizavel).map((a) => ({ acao: a.id, nome: a.nome, descricao: a.descricao, permissao: `${a.permissao.modulo}.${a.permissao.acao}`, ativa: por.get(a.id)?.ativa ?? false, valorMaxCentavos: por.get(a.id)?.valorMaxCentavos ?? null }));
}

export async function salvarAutomacao(empresaId: string, usuarioId: string, acao: string, d: { ativa: boolean; valorMaxCentavos: number | null }) {
  if (!ACOES.has(acao)) throw new ErroDeNegocio(`Ação "${acao}" não existe.`, 400);
  if (!ACOES.get(acao)!.automatizavel) throw new ErroDeNegocio('Esta ação sempre exige aprovação humana e não pode ser automatizada.', 422);
  if (d.ativa && d.valorMaxCentavos == null) throw new ErroDeNegocio('Para ligar a automação, defina o valor máximo por execução.', 422);
  const r = await prisma.aIAutomacao.upsert({ where: { empresaId_acao: { empresaId, acao } }, create: { empresaId, acao, ...d, atualizadoPor: usuarioId }, update: { ...d, atualizadoPor: usuarioId } });
  await registrarAuditoria({ empresaId, usuarioId, acao: 'ALTERAR_CONFIG', entidade: 'AIAutomacao', entidadeId: r.id, valorNovo: { acao, ...d }, origem: 'MANUAL' });
  return listarAutomacoes(empresaId);
}
