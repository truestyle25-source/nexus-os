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
import { NaoEncontrado } from '../../lib/erros.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { createRateLimiter } from '../../middlewares/rateLimiter.js';
import { temPermissao } from '../../lib/permissoes.js';
import { carregarCatalogo } from './catalogo.js';
import { todosAgentes } from './agentes/registro.js';
import { contexto, iniciarInvestigacao, montarResultado, retomarInvestigacao } from './motor.js';
import { situacaoConsumo } from './consumo.js';
import { provedorAtual } from './provedores/roteador.js';
import { estadoCircuito } from './provedores/gemini.js';
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
    const d = z.object({ pergunta: z.string().min(1).max(2000), agente: z.string().max(40).default('geral'), conversaId: z.string().max(40).optional(), idempotencyKey: z.string().min(8).max(100).optional() }).parse(req.body ?? {});
    return iniciarInvestigacao(contexto(req.user.empresaId, req.user.id, { filialId: req.user.filialId ?? null }), { agenteId: d.agente, pergunta: d.pergunta, conversaId: d.conversaId ?? null, idempotencyKey: d.idempotencyKey ?? null });
  });

  app.post(`${B}/execucoes/:id/retomar`, { preHandler: [auth, usar, limitePerguntas] }, async (req: any) =>
    retomarInvestigacao(contexto(req.user.empresaId, req.user.id), z.object({ id: z.string().max(40) }).parse(req.params).id));

  app.get(`${B}/execucoes/:id`, { preHandler: [auth, usar] }, async (req: any) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const ex = await prisma.aIExecucao.findFirst({ where: { id, empresaId: req.user.empresaId }, select: { id: true } });
    if (!ex) throw NaoEncontrado('Investigação não encontrada.');
    return montarResultado(ex.id);
  });

  app.get(`${B}/conversas`, { preHandler: [auth, usar] }, async (req: any) => ({
    conversas: await prisma.aIConversa.findMany({ where: { empresaId: req.user.empresaId, usuarioId: req.user.id }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, titulo: true, updatedAt: true } }),
  }));

  app.get(`${B}/conversas/:id`, { preHandler: [auth, usar] }, async (req: any) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const c = await prisma.aIConversa.findFirst({ where: { id, empresaId: req.user.empresaId, usuarioId: req.user.id }, include: { mensagens: { orderBy: { createdAt: 'asc' }, select: { id: true, papel: true, conteudo: true, detalhes: true, execucaoId: true, createdAt: true } } } });
    if (!c) throw NaoEncontrado('Conversa não encontrada.');
    return c;
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
}

