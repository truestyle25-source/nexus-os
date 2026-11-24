/**
 * AI Gateway — /api/v1/nexus-ai. Autenticação, empresa/filial da sessão, permissões,
 * limite de requisições por empresa e controle de consumo. A chave do provedor nunca sai
 * do servidor.
 *  - Usar a NEXUS AI: ia.visualizar (+ a permissão mínima de cada agente)
 *  - Ajustar limites da empresa: ia.administrar
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { createRateLimiter } from '../../middlewares/rateLimiter.js';
import { temPermissao } from '../../lib/permissoes.js';
import { carregarCatalogo } from './catalogo.js';
import { todosAgentes } from './agentes/registro.js';
import { agenteParaVoz } from './roteamento-voz.js';
import { contexto, iniciarInvestigacao, montarResultado, retomarInvestigacao } from './motor.js';
import { situacaoConsumo } from './consumo.js';
import { provedorAtual } from './provedores/roteador.js';
import { estadoCircuito } from './provedores/gemini.js';
import { acaoAprovavel, acoesAprovaveis, criarProposta, usuarioAlvoDoInsight, decidir, listarAprovacoes, listarAutomacoes, salvarAutomacao } from './aprovacoes.service.js';
import { DESCRICAO_REGRAS } from './eventos/regras.js';
import { TIPOS_MEMORIA, adicionarDocumento, excluirDocumento, excluirMemoria, indexarDocumento, listarDocumentos, listarMemoria, salvarMemoria } from './conhecimento.service.js';

const porEmpresa = (req: any) => (req.user?.empresaId ? `e:${req.user.empresaId}` : null);
const limitePerguntas = createRateLimiter(30, 60_000, { nome: 'nexus-ai-perguntas', chaveExtra: porEmpresa });

export async function nexusAiRoutes(app: FastifyInstance): Promise<void> {
  carregarCatalogo();
  const auth = (app as any).authenticate;
  const usar = await permissaoMiddleware('ia', 'visualizar');
  const administrar = await permissaoMiddleware('ia', 'administrar');
  const B = '/api/v1/nexus-ai';

  app.get(`${B}/agentes`, { preHandler: [auth, usar] }, async (req: any) => {
    const lista = await Promise.all(todosAgentes().map(async (a) => ({ id: a.id, nome: a.nome, descricao: a.descricao, versao: a.versao, autonomiaMax: a.autonomiaMax, disponivel: await temPermissao(req.user.id, a.permissaoMinima.modulo, a.permissaoMinima.acao) })));
    return { agentes: lista, provedor: { nome: provedorAtual().nome, configurado: provedorAtual().configurado(), circuito: estadoCircuito() } };
  });

  app.post(`${B}/perguntar`, { preHandler: [auth, usar, limitePerguntas] }, async (req: any) => {
    const d = z.object({ pergunta: z.string().min(1).max(2000), agente: z.string().max(40).default('geral'), conversaId: z.string().max(40).optional(), idempotencyKey: z.string().min(8).max(100).optional(), modo: z.enum(['texto', 'voz']).default('texto') }).parse(req.body ?? {});
    const ctx = contexto(req.user.empresaId, req.user.id, { filialId: req.user.filialId ?? null });
    // Modo voz: resposta curta para ser falada e, se a pergunta for de uma área só, direto ao especialista.
    if (d.modo === 'voz') ctx.voz = true;
    const agenteId = d.modo === 'voz' && d.agente === 'nexus' ? await agenteParaVoz(d.pergunta, req.user.id) : d.agente;
    return iniciarInvestigacao(ctx, { agenteId, pergunta: d.pergunta, conversaId: d.conversaId ?? null, idempotencyKey: d.idempotencyKey ?? null });
  });

  app.post(`${B}/execucoes/:id/retomar`, { preHandler: [auth, usar, limitePerguntas] }, async (req: any) =>
    retomarInvestigacao(contexto(req.user.empresaId, req.user.id), z.object({ id: z.string().max(40) }).parse(req.params).id));

  app.get(`${B}/execucoes/:id`, { preHandler: [auth, usar] }, async (req: any) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const ex = await prisma.aIExecucao.findFirst({ where: { id, empresaId: req.user.empresaId }, select: { id: true } });
    if (!ex) throw NaoEncontrado('Investigação não encontrada.');
    return montarResultado(ex.id);
  });

  // Retorno do usuário sobre a resposta (correta / incorreta), registrado para revisão. Só quem perguntou avalia.
  app.post(`${B}/execucoes/:id/avaliacao`, { preHandler: [auth, usar] }, async (req: any) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const d = z.object({ avaliacao: z.enum(['CORRETA', 'INCORRETA']), comentario: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    const r = await prisma.aIExecucao.updateMany({ where: { id, empresaId: req.user.empresaId, usuarioId: req.user.id, execucaoPaiId: null }, data: { avaliacao: d.avaliacao, avaliacaoComentario: d.comentario || null, avaliadoPor: req.user.id, avaliadoEm: new Date() } });
    if (!r.count) throw NaoEncontrado('Investigação não encontrada.');
    return { ok: true, avaliacao: d.avaliacao };
  });

  app.get(`${B}/conversas`, { preHandler: [auth, usar] }, async (req: any) => ({
    conversas: await prisma.aIConversa.findMany({ where: { empresaId: req.user.empresaId, usuarioId: req.user.id }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, titulo: true, updatedAt: true } }),
  }));

  app.get(`${B}/conversas/:id`, { preHandler: [auth, usar] }, async (req: any) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const c = await prisma.aIConversa.findFirst({ where: { id, empresaId: req.user.empresaId, usuarioId: req.user.id }, include: { mensagens: { orderBy: { createdAt: 'asc' }, select: { id: true, papel: true, conteudo: true, detalhes: true, execucaoId: true, createdAt: true } } } });
    if (!c) throw NaoEncontrado('Conversa não encontrada.');
    const ids = c.mensagens.map((m) => m.execucaoId).filter((x): x is string => !!x);
    const av = new Map((await prisma.aIExecucao.findMany({ where: { id: { in: ids }, empresaId: req.user.empresaId }, select: { id: true, avaliacao: true, status: true } })).map((e) => [e.id, e]));
    return { ...c, mensagens: c.mensagens.map((m) => (m.execucaoId && m.detalhes && typeof m.detalhes === 'object' ? { ...m, status: av.get(m.execucaoId)?.status ?? null, detalhes: { ...(m.detalhes as object), avaliacao: av.get(m.execucaoId)?.avaliacao ?? null } } : m)) };
  });

  app.get(`${B}/consumo`, { preHandler: [auth, usar] }, async (req: any) => situacaoConsumo(req.user.empresaId));

  app.put(`${B}/limites`, { preHandler: [auth, administrar] }, async (req: any) => {
    const d = z.object({ execucoesMes: z.number().int().min(0).max(1_000_000).nullable().optional(), custoMesCentavos: z.number().int().min(0).max(100_000_000).nullable().optional(), bloqueadoManualmente: z.boolean().optional() }).parse(req.body ?? {});
    await prisma.aILimite.upsert({ where: { empresaId: req.user.empresaId }, create: { empresaId: req.user.empresaId, ...d }, update: d });
    return situacaoConsumo(req.user.empresaId);
  });
  // Memória empresarial e documentos (Fase 04): leitura com ia.visualizar, escrita com ia.administrar.
  const corpoMemoria = z.object({ tipo: z.enum(TIPOS_MEMORIA), titulo: z.string().trim().min(2).max(120), conteudo: z.string().trim().min(2).max(2000) });
  app.get(`${B}/memoria`, { preHandler: [auth, usar] }, async (req: any) => ({ itens: await listarMemoria(req.user.empresaId) }));
  app.post(`${B}/memoria`, { preHandler: [auth, administrar] }, async (req: any) => salvarMemoria(req.user.empresaId, req.user.id, corpoMemoria.parse(req.body ?? {})));
  app.put(`${B}/memoria/:id`, { preHandler: [auth, administrar] }, async (req: any) => salvarMemoria(req.user.empresaId, req.user.id, { id: req.params.id, ...corpoMemoria.parse(req.body ?? {}) }));
  app.delete(`${B}/memoria/:id`, { preHandler: [auth, administrar] }, async (req: any) => excluirMemoria(req.user.empresaId, req.params.id));
  app.get(`${B}/documentos`, { preHandler: [auth, usar] }, async (req: any) => ({ documentos: await listarDocumentos(req.user.empresaId) }));
  app.post(`${B}/documentos`, { preHandler: [auth, administrar], bodyLimit: 2 * 1024 * 1024 }, async (req: any) => {
    const d = z.object({ titulo: z.string().trim().min(2).max(200), conteudo: z.string(), modulo: z.string().nullable().optional() }).parse(req.body ?? {});
    return adicionarDocumento(req.user.empresaId, req.user.id, d);
  });
  app.post(`${B}/documentos/reindexar`, { preHandler: [auth, administrar] }, async (req: any) => ({ vetorizados: await indexarDocumento(req.user.empresaId) }));
  app.delete(`${B}/documentos/:id`, { preHandler: [auth, administrar] }, async (req: any) => excluirDocumento(req.user.empresaId, req.params.id));
  // Fase 06 — Inteligência (insights), Aprovações e Automações.
  // Insights e propostas só aparecem para quem tem permissão de ver o módulo de origem.
  const modulosVisiveis = async (usuarioId: string, modulos: string[]) => {
    const r = await Promise.all([...new Set(modulos)].map(async (m) => [m, await temPermissao(usuarioId, m as any, 'visualizar')] as const));
    return new Set(r.filter(([, ok]) => ok).map(([m]) => m));
  };
  app.get(`${B}/insights`, { preHandler: [auth, usar] }, async (req: any) => {
    const { status } = z.object({ status: z.enum(['ABERTO', 'LIDO', 'DESCARTADO']).optional() }).parse(req.query ?? {});
    const itens = await prisma.aIInsight.findMany({ where: { empresaId: req.user.empresaId, ...(status ? { status } : { status: { not: 'DESCARTADO' } }) }, orderBy: { createdAt: 'desc' }, take: 200 });
    const ok = await modulosVisiveis(req.user.id, itens.map((i) => i.modulo));
    return { insights: itens.filter((i) => ok.has(i.modulo)) };
  });
  app.post(`${B}/insights/:id/status`, { preHandler: [auth, usar] }, async (req: any) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const { status } = z.object({ status: z.enum(['ABERTO', 'LIDO', 'DESCARTADO']) }).parse(req.body ?? {});
    const i = await prisma.aIInsight.findFirst({ where: { id, empresaId: req.user.empresaId } });
    if (!i || !(await temPermissao(req.user.id, i.modulo as any, 'visualizar'))) throw NaoEncontrado('Insight não encontrado.');
    return prisma.aIInsight.update({ where: { id }, data: { status } });
  });
  app.post(`${B}/insights/:id/propor-bloqueio`, { preHandler: [auth, usar] }, async (req: any) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const i = await prisma.aIInsight.findFirst({ where: { id, empresaId: req.user.empresaId } });
    if (!i || !(await temPermissao(req.user.id, i.modulo as any, 'visualizar'))) throw NaoEncontrado('Insight não encontrado.');
    const alvo = usuarioAlvoDoInsight(i.tipo, i.evidencias);
    if (!alvo) throw new ErroDeNegocio('Este alerta não aponta um usuário para bloquear.', 422);
    if (alvo === req.user.id) throw new ErroDeNegocio('Este alerta é sobre a sua própria conta: você não pode bloqueá-la. Troque a senha ou peça a outro administrador.', 422);
    return criarProposta({ empresaId: req.user.empresaId, usuarioId: req.user.id, acao: 'bloquear_usuario', args: { usuarioId: alvo, motivo: `Alerta: ${i.titulo}`.slice(0, 300) }, insightId: i.id });
  });
  app.get(`${B}/aprovacoes`, { preHandler: [auth, usar] }, async (req: any) => {
    const { status } = z.object({ status: z.enum(['PENDENTE', 'EXECUTADA', 'REJEITADA', 'FALHOU', 'EXPIRADA']).optional() }).parse(req.query ?? {});
    const itens = await listarAprovacoes(req.user.empresaId, status);
    const ok = await modulosVisiveis(req.user.id, itens.map((a) => acaoAprovavel(a.acao)?.permissao.modulo ?? 'ia'));
    const podeDecidir = new Map<string, boolean>();
    for (const a of acoesAprovaveis()) podeDecidir.set(a.id, await temPermissao(req.user.id, a.permissao.modulo, a.permissao.acao));
    return { aprovacoes: itens.filter((a) => ok.has(acaoAprovavel(a.acao)?.permissao.modulo ?? 'ia')).map((a) => ({ ...a, podeDecidir: podeDecidir.get(a.acao) ?? false })) };
  });
  app.post(`${B}/aprovacoes/:id/:decisao`, { preHandler: [auth, usar] }, async (req: any) => {
    const p = z.object({ id: z.string().max(40), decisao: z.enum(['aprovar', 'rejeitar']) }).parse(req.params);
    const { motivo } = z.object({ motivo: z.string().max(300).optional() }).parse(req.body ?? {});
    return decidir(req.user.empresaId, req.user.id, p.id, p.decisao, motivo);
  });
  // Qualidade das respostas (30 dias). As perguntas avaliadas como incorretas só aparecem para quem administra a IA.
  const resumoAvaliacoes = async (empresaId: string, usuarioId: string) => {
    const desde = new Date(Date.now() - 30 * 86_400_000);
    const g = await prisma.aIExecucao.groupBy({ by: ['avaliacao'], where: { empresaId, avaliadoEm: { gte: desde }, avaliacao: { not: null } }, _count: { _all: true } });
    const n = (v: string) => g.find((x) => x.avaliacao === v)?._count._all ?? 0;
    const admin = await temPermissao(usuarioId, 'ia', 'administrar');
    const incorretas = admin ? await prisma.aIExecucao.findMany({ where: { empresaId, avaliacao: 'INCORRETA', avaliadoEm: { gte: desde } }, orderBy: { avaliadoEm: 'desc' }, take: 10, select: { id: true, agente: true, entrada: true, avaliacaoComentario: true, avaliadoEm: true } }) : null;
    return { corretas: n('CORRETA'), incorretas: n('INCORRETA'), ultimasIncorretas: incorretas?.map((e) => ({ id: e.id, agente: e.agente, pergunta: e.entrada.slice(0, 300), comentario: e.avaliacaoComentario, quando: e.avaliadoEm })) ?? null };
  };
  app.get(`${B}/automacoes`, { preHandler: [auth, usar] }, async (req: any) => {
    const desde = new Date(Date.now() - 7 * 86_400_000);
    const porTipo = await prisma.aIEvento.groupBy({ by: ['tipo'], where: { empresaId: req.user.empresaId, createdAt: { gte: desde } }, _count: { _all: true } });
    const pendentes = await prisma.aIEvento.count({ where: { empresaId: req.user.empresaId, status: { in: ['PENDENTE', 'PROCESSANDO'] } } });
    const cont = new Map(porTipo.map((t) => [t.tipo, t._count._all]));
    return {
      regras: DESCRICAO_REGRAS.map((r) => ({ ...r, eventos7dias: cont.get(r.tipo) ?? 0 })),
      insightsDiarios: { eventos7dias: cont.get('ANOMALIA') ?? 0, regra: 'Uma vez por dia: vendas, cancelamentos, despesas e perdas dos últimos 7 dias comparados com as 8 semanas anteriores.' },
      filaPendente: pendentes,
      acoes: await listarAutomacoes(req.user.empresaId),
      avaliacoes: await resumoAvaliacoes(req.user.empresaId, req.user.id),
    };
  });
  app.put(`${B}/automacoes/:acao`, { preHandler: [auth, administrar] }, async (req: any) => {
    const { acao } = z.object({ acao: z.string().max(60) }).parse(req.params);
    const d = z.object({ ativa: z.boolean(), valorMaxCentavos: z.number().int().min(0).max(100_000_000).nullable() }).parse(req.body ?? {});
    return { acoes: await salvarAutomacao(req.user.empresaId, req.user.id, acao, d) };
  });
}
