/**
 * NEXUS CLUB — Fase 6: painel da loja (aba NEXUS CLUB no módulo Clientes).
 *
 *  GET  /clientes/clube/visao-geral          configuração + indicadores REAIS (sem dado → 0/—)
 *  GET  /clientes/clube/config               configuração do clube
 *  PUT  /clientes/clube/config               salvar (clientes:administrar)
 *  GET  /clientes/clube/membros              carteirinhas (com autorizações por canal)
 *  GET  /clientes/clube/membros/:id/candidatos   cadastros possíveis (mesmo CPF) p/ quem está pendente
 *  POST /clientes/clube/membros/:id/vincular     escolher o cadastro (clientes:editar)
 *  POST /clientes/clube/membros/:id/bloquear | desbloquear   (clientes:administrar)
 *  GET  /clientes/clube/termos               versões do texto de autorização de mensagens
 *  POST /clientes/clube/termos               publicar nova versão (clientes:administrar)
 *
 * Permissões reaproveitam o catálogo atual (plano D.6): ver = clientes:visualizar; editar
 * vínculo = clientes:editar; configurar/termos/bloquear = clientes:administrar.
 * A loja NUNCA vê a conta global da pessoa (e-mail/CPF da conta, outros clubes): só o seu
 * cadastro de cliente e a carteirinha do seu clube.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { decryptSecret } from '../../lib/secrets.js';
import { normalizeCpf, formatCpf } from '../../domain/cpf.js';
import { comoSistema } from '../../lib/tenant-context.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { clubeHabilitado } from './clube-config.js';
import { registrarConsentimento } from './consentimento.service.js';

const num = (v: unknown) => (v == null ? null : Number(v));
const mascararDoc = (d: string | null) => {
  const x = normalizeCpf(d ?? '');
  return x.length === 11 ? `***.${x.slice(3, 6)}.${x.slice(6, 9)}-**` : d ? '•••' : null;
};

const auditar = (req: FastifyRequest, entidade: string, entidadeId: string | undefined, contexto: string, valorNovo?: unknown, valorAnterior?: unknown) =>
  registrarAuditoria({
    usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR', entidade, entidadeId, origem: 'MANUAL', ip: req.ip, contexto,
    valorNovo: valorNovo as any, valorAnterior: valorAnterior as any,
  });

function configPublica(c: { id: string; nome: string; ativo: boolean; publico: boolean; corPrimaria: string | null; beneficioPercentual: unknown; limiteBeneficio: unknown; updatedAt: Date } | null) {
  if (!c) return null;
  return { id: c.id, nome: c.nome, ativo: c.ativo, publico: c.publico, cor: c.corPrimaria, beneficioPercentual: num(c.beneficioPercentual), limiteBeneficio: num(c.limiteBeneficio), atualizadoEm: c.updatedAt };
}

/** Texto de autorização: mesmo cuidado do comando de termos (não publica rascunho com campos em aberto). */
function validarTexto(texto: string) {
  if (/\[[A-ZÀ-Ú0-9][^\]\n]{1,80}\]/.test(texto)) throw new ErroDeNegocio('O texto ainda tem campos entre colchetes para preencher.', 400);
}

export async function adminClubeRoutes(app: FastifyInstance): Promise<void> {
  const ver = [app.authenticate, await permissaoMiddleware('clientes', 'visualizar')];
  const editar = [app.authenticate, await permissaoMiddleware('clientes', 'editar')];
  const administrar = [app.authenticate, await permissaoMiddleware('clientes', 'administrar')];

  app.get('/clientes/clube/visao-geral', { preHandler: ver }, async (req) => {
    const empresaId = req.user.empresaId;
    const desde30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [config, porStatus, novos30, autorizados, termo, vendasMembros] = await Promise.all([
      prisma.clubeConfig.findUnique({ where: { empresaId } }),
      prisma.membroClube.groupBy({ by: ['status'], where: { empresaId }, _count: { _all: true } }),
      prisma.membroClube.count({ where: { empresaId, entrouEm: { gte: desde30 }, status: { in: ['ATIVO', 'PENDENTE_VINCULO'] } } }),
      // Só autorizações de quem está ATIVO no clube (a loja não enxerga a conta global da pessoa).
      prisma.$queryRaw<Array<{ canal: string; qtd: number }>>`
        SELECT c."canal"::text AS canal, COUNT(*)::int AS qtd
        FROM "ConsentimentoAtual" c
        JOIN "MembroClube" m ON m."empresaId" = c."empresaId" AND m."consumidorId" = c."consumidorId" AND m."status" = 'ATIVO'
        WHERE c."empresaId" = ${empresaId} AND c."situacao" = 'CONCEDIDO'
        GROUP BY c."canal"`,
      prisma.termoVersao.findFirst({ where: { empresaId, tipo: 'AUTORIZACAO_MARKETING' }, orderBy: { versao: 'desc' }, select: { versao: true, publicadoEm: true } }),
      prisma.$queryRaw<Array<{ qtd: number; total: number | null }>>`
        SELECT COUNT(*)::int AS qtd, SUM(v."total")::float8 AS total
        FROM "Venda" v
        WHERE v."empresaId" = ${empresaId} AND v."status" = 'FINALIZADA' AND v."createdAt" >= ${desde30}
          AND v."clienteId" IN (SELECT m."clienteId" FROM "MembroClube" m WHERE m."empresaId" = ${empresaId} AND m."status" = 'ATIVO' AND m."clienteId" IS NOT NULL)`,
    ]);
    const st = Object.fromEntries(porStatus.map((s) => [s.status, s._count._all])) as Record<string, number>;
    const canal = Object.fromEntries(autorizados.map((a) => [a.canal, a.qtd])) as Record<string, number>;
    return {
      plataformaLigada: clubeHabilitado(),
      config: configPublica(config),
      textoAutorizacao: termo ? { versao: termo.versao, publicadoEm: termo.publicadoEm } : null,
      indicadores: {
        membrosAtivos: st.ATIVO ?? 0, aguardandoVinculo: st.PENDENTE_VINCULO ?? 0, sairam: st.SAIU ?? 0, bloqueados: st.BLOQUEADO ?? 0,
        novos30dias: novos30,
        autorizamWhatsapp: canal.WHATSAPP ?? 0, autorizamEmail: canal.EMAIL ?? 0, autorizamApp: canal.APP ?? 0,
        comprasMembros30dias: vendasMembros[0]?.qtd ?? 0, valorMembros30dias: vendasMembros[0]?.total ?? 0,
      },
    };
  });

  app.get('/clientes/clube/config', { preHandler: ver }, async (req) => ({
    plataformaLigada: clubeHabilitado(),
    config: configPublica(await prisma.clubeConfig.findUnique({ where: { empresaId: req.user.empresaId } })),
  }));

  app.put('/clientes/clube/config', { preHandler: administrar }, async (req) => {
    const empresaId = req.user.empresaId;
    const d = z.object({
      nome: z.string().trim().min(2, 'Informe o nome do clube.').max(80),
      ativo: z.boolean(),
      publico: z.boolean(),
      cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida.').nullable().optional(),
      beneficioPercentual: z.number().min(0).max(50, 'Benefício máximo de 50%.').nullable().optional(),
      limiteBeneficio: z.number().min(0).max(100000).nullable().optional(),
    }).parse(req.body);
    const antes = await prisma.clubeConfig.findUnique({ where: { empresaId } });
    const dados = { nome: d.nome, ativo: d.ativo, publico: d.publico, corPrimaria: d.cor ?? null, beneficioPercentual: d.beneficioPercentual || null, limiteBeneficio: d.limiteBeneficio || null };
    const c = await prisma.clubeConfig.upsert({ where: { empresaId }, create: { empresaId, ...dados }, update: dados });
    await auditar(req, 'ClubeConfig', c.id, antes ? 'NEXUS CLUB: configuração alterada' : 'NEXUS CLUB: clube criado', configPublica(c), configPublica(antes));
    return { config: configPublica(c) };
  });

  app.get('/clientes/clube/membros', { preHandler: ver }, async (req) => {
    const empresaId = req.user.empresaId;
    const q = z.object({ status: z.enum(['ATIVO', 'PENDENTE_VINCULO', 'SAIU', 'BLOQUEADO']).optional(), busca: z.string().trim().max(80).optional() }).parse(req.query);
    const membros = await prisma.membroClube.findMany({
      where: {
        empresaId, ...(q.status ? { status: q.status } : {}),
        ...(q.busca ? { cliente: { OR: [{ nome: { contains: q.busca, mode: 'insensitive' } }, { documento: { contains: normalizeCpf(q.busca) || q.busca } }] } } : {}),
      },
      include: { cliente: { select: { id: true, nome: true, documento: true, telefone: true, email: true, ultimaCompra: true } } },
      orderBy: [{ status: 'asc' }, { entrouEm: 'desc' }], take: 300,
    });
    const atuais = await prisma.consentimentoAtual.findMany({ where: { empresaId, consumidorId: { in: membros.map((m) => m.consumidorId) } }, select: { consumidorId: true, canal: true, situacao: true } });
    const aut = new Map<string, Record<string, boolean>>();
    for (const a of atuais) aut.set(a.consumidorId, { ...(aut.get(a.consumidorId) ?? {}), [a.canal]: a.situacao === 'CONCEDIDO' });
    return membros.map((m) => ({
      id: m.id, status: m.status, entrouEm: m.entrouEm, saiuEm: m.saiuEm,
      cliente: m.cliente ? { id: m.cliente.id, nome: m.cliente.nome, documento: mascararDoc(m.cliente.documento), telefone: m.cliente.telefone, email: m.cliente.email, ultimaCompra: m.cliente.ultimaCompra } : null,
      autoriza: { WHATSAPP: !!aut.get(m.consumidorId)?.WHATSAPP, EMAIL: !!aut.get(m.consumidorId)?.EMAIL, APP: !!aut.get(m.consumidorId)?.APP },
    }));
  });

  /** CPF da conta (só o servidor lê, em escopo de sistema) para achar os cadastros desta loja. */
  async function candidatosDe(membroId: string, empresaId: string) {
    const m = await prisma.membroClube.findFirst({ where: { id: membroId, empresaId } });
    if (!m) throw NaoEncontrado('Carteirinha não encontrada.');
    const cifrado = await comoSistema('club:candidatos', () => prisma.contaConsumidor.findUnique({ where: { id: m.consumidorId }, select: { cpfCifrado: true } }));
    let cpf = '';
    try { cpf = normalizeCpf(decryptSecret(cifrado?.cpfCifrado ?? '')); } catch { cpf = ''; }
    const lista = cpf.length === 11
      ? await prisma.cliente.findMany({ where: { empresaId, documento: { in: [cpf, formatCpf(cpf)] } }, select: { id: true, nome: true, documento: true, telefone: true, email: true, ultimaCompra: true, valorTotalComprado: true, createdAt: true } })
      : [];
    return { membro: m, candidatos: lista };
  }

  app.get('/clientes/clube/membros/:id/candidatos', { preHandler: ver }, async (req) => {
    const { candidatos } = await candidatosDe((req.params as { id: string }).id, req.user.empresaId);
    return candidatos.map((c) => ({ id: c.id, nome: c.nome, documento: mascararDoc(c.documento), telefone: c.telefone, email: c.email, ultimaCompra: c.ultimaCompra, valorTotalComprado: Number(c.valorTotalComprado), criadoEm: c.createdAt }));
  });

  app.post('/clientes/clube/membros/:id/vincular', { preHandler: editar }, async (req) => {
    const { clienteId } = z.object({ clienteId: z.string().min(1) }).parse(req.body);
    const { membro, candidatos } = await candidatosDe((req.params as { id: string }).id, req.user.empresaId);
    if (!candidatos.some((c) => c.id === clienteId)) throw new ErroDeNegocio('Escolha um dos cadastros com o mesmo CPF desta pessoa.', 400);
    if (membro.status === 'SAIU' || membro.status === 'BLOQUEADO') throw new ErroDeNegocio('Esta carteirinha não está ativa.', 409);
    await prisma.membroClube.update({ where: { id: membro.id }, data: { clienteId, status: 'ATIVO' } });
    await auditar(req, 'MembroClube', membro.id, 'NEXUS CLUB: cadastro do cliente escolhido para a carteirinha', { clienteId }, { clienteId: membro.clienteId, status: membro.status });
    return { ok: true };
  });

  const mudarBloqueio = (bloquear: boolean) => async (req: FastifyRequest) => {
    const empresaId = req.user.empresaId;
    const m = await prisma.membroClube.findFirst({ where: { id: (req.params as { id: string }).id, empresaId } });
    if (!m) throw NaoEncontrado('Carteirinha não encontrada.');
    if (bloquear) {
      if (m.status === 'BLOQUEADO') return { ok: true };
      // Bloquear também desliga as mensagens desta loja para a pessoa.
      const ativos = await prisma.consentimentoAtual.findMany({ where: { empresaId, consumidorId: m.consumidorId, situacao: 'CONCEDIDO' }, select: { canal: true } });
      for (const a of ativos) await registrarConsentimento({ empresaId, consumidorId: m.consumidorId, canal: a.canal, acao: 'REVOGADO', origem: 'GESTOR', registradoPorId: req.user.id, ip: req.ip });
      await prisma.membroClube.update({ where: { id: m.id }, data: { status: 'BLOQUEADO', codigoQr: null, codigoQrGeradoEm: null } });
    } else {
      if (m.status !== 'BLOQUEADO') return { ok: true };
      await prisma.membroClube.update({ where: { id: m.id }, data: { status: m.clienteId ? 'ATIVO' : 'PENDENTE_VINCULO' } });
    }
    await auditar(req, 'MembroClube', m.id, bloquear ? 'NEXUS CLUB: carteirinha bloqueada (mensagens desligadas)' : 'NEXUS CLUB: carteirinha desbloqueada');
    return { ok: true };
  };
  app.post('/clientes/clube/membros/:id/bloquear', { preHandler: administrar }, mudarBloqueio(true));
  app.post('/clientes/clube/membros/:id/desbloquear', { preHandler: administrar }, mudarBloqueio(false));

  app.get('/clientes/clube/termos', { preHandler: ver }, async (req) => {
    const lista = await prisma.termoVersao.findMany({ where: { empresaId: req.user.empresaId, tipo: 'AUTORIZACAO_MARKETING' }, orderBy: { versao: 'desc' }, take: 50 });
    const usos = await prisma.consentimentoEvento.groupBy({ by: ['termoVersaoId'], where: { empresaId: req.user.empresaId, termoVersaoId: { in: lista.map((t) => t.id) } }, _count: { _all: true } });
    const nUsos = new Map(usos.map((u) => [u.termoVersaoId, u._count._all]));
    return lista.map((t) => ({ id: t.id, versao: t.versao, texto: t.texto, publicadoEm: t.publicadoEm, autorizacoes: nUsos.get(t.id) ?? 0 }));
  });

  app.post('/clientes/clube/termos', { preHandler: administrar }, async (req, reply) => {
    const empresaId = req.user.empresaId;
    const { texto } = z.object({ texto: z.string().trim().min(80, 'O texto precisa explicar o que a pessoa autoriza (pelo menos 80 caracteres).').max(8000) }).parse(req.body);
    validarTexto(texto);
    const atual = await prisma.termoVersao.findFirst({ where: { empresaId, tipo: 'AUTORIZACAO_MARKETING' }, orderBy: { versao: 'desc' } });
    if (atual?.texto.trim() === texto) return reply.status(200).send({ id: atual.id, versao: atual.versao, igual: true });
    const t = await prisma.termoVersao.create({ data: { empresaId, tipo: 'AUTORIZACAO_MARKETING', versao: (atual?.versao ?? 0) + 1, texto, criadoPorId: req.user.id } });
    await auditar(req, 'TermoVersao', t.id, `NEXUS CLUB: texto de autorização de mensagens publicado (versão ${t.versao})`);
    return reply.status(201).send({ id: t.id, versao: t.versao });
  });
}
