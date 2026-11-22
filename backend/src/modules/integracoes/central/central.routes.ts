/**
 * Rotas da Central de Integrações (prefixo /integracoes/central).
 * Mercado Livre e Shopee continuam usando as rotas próprias de OAuth; aqui eles
 * aparecem no catálogo, nos estados e no histórico.
 *
 * Permissões (módulo `integracoes`): visualizar = ver catálogo/estado/histórico;
 * editar = testar, salvar e desconectar; excluir = remover a configuração.
 * empresaId sempre da sessão — nunca do corpo.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { permissaoMiddleware } from '../../../middlewares/auth.js';
import { catalogoPublico } from './provedores.js';
import { desconectar, estadosDaEmpresa, historico, obterConfiguracao, remover, resumir, salvar, testar, registrarEvento } from './central.service.js';
import { assinaturaValida, desafioValido, enviarWhatsApp, listarMensagens, processarWebhook, verificarAssinaturaWebhook } from './whatsapp.service.js';
import { caixaDeEntrada, enviarEmail, listarEnvios } from './email.service.js';
import { atualizarCobranca, conferirPagamento, credenciaisPorRegistro, gerarCobranca } from './cobrancas.service.js';
import { importarPedidosWoo } from './woocommerce-pedidos.service.js';
import { timingSafeEqual } from 'node:crypto';
import { definirSistemaDaRequisicao } from '../../../lib/tenant-context.js';
import { createRateLimiter } from '../../../middlewares/rateLimiter.js';

// Limites (janela persistida no Postgres, vale entre instâncias). Testar/salvar fazem o
// servidor conectar em hosts externos escolhidos pelo usuário: sem limite, a rota viraria
// ferramenta de varredura de portas ou de abuso de SMTP. Por empresa, não por usuário.
const porEmpresa = (req: any) => (req.user?.empresaId ? `e:${req.user.empresaId}` : null);
const limiteConexao = createRateLimiter(20, 10 * 60_000, { nome: 'integracoes-conexao', chaveExtra: porEmpresa });
const limiteEnvio = createRateLimiter(120, 60_000, { nome: 'integracoes-envio', chaveExtra: porEmpresa });
// Webhook público: limita por IP ANTES de qualquer consulta de credenciais.
const limiteWebhook = createRateLimiter(600, 60_000, { nome: 'whatsapp-webhook' });

/** Endereço público da API (para a URL do webhook). API_PUBLIC_URL tem prioridade. */
function baseUrlPublica(req: any): string {
  const env = (process.env.API_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/\S+$/.test(env)) return env;
  return `${req.protocol}://${req.hostname}`;
}

const EnvioWhats = z.object({
  para: z.string().min(8).max(30),
  tipo: z.enum(['TEXTO', 'MODELO']),
  texto: z.string().max(4096).optional(),
  modelo: z.object({ nome: z.string().max(512), idioma: z.string().max(10).default('pt_BR'), parametros: z.array(z.string().max(1024)).max(20).default([]) }).optional(),
});
const EnvioMail = z.object({
  para: z.array(z.string().max(254)).min(1).max(50),
  cc: z.array(z.string().max(254)).max(50).optional(),
  assunto: z.string().max(300),
  html: z.string().max(500_000).optional(),
  texto: z.string().max(200_000).optional(),
  responderPara: z.string().max(254).optional(),
  anexos: z.array(z.object({ nome: z.string().max(200), base64: z.string().max(14_000_000), tipo: z.string().max(100).optional() })).max(10).optional(),
});

const Params = z.object({ provedor: z.string().regex(/^[a-z0-9-]{2,40}$/) });
const Corpo = z.record(z.string(), z.string().max(2000)).default({});

export async function centralIntegracoesRoutes(app: FastifyInstance): Promise<void> {
  const auth = (app as any).authenticate;
  const ver = await permissaoMiddleware('integracoes', 'visualizar');
  const editar = await permissaoMiddleware('integracoes', 'editar');
  const excluir = await permissaoMiddleware('integracoes', 'excluir');

  app.get('/integracoes/central/painel', { preHandler: [auth, ver] }, async (req: any) => {
    const estados = await estadosDaEmpresa(req.user.empresaId);
    return { provedores: catalogoPublico(), estados, resumo: resumir(estados) };
  });

  app.get('/integracoes/central/:provedor', { preHandler: [auth, ver] }, async (req: any) =>
    obterConfiguracao(req.user.empresaId, Params.parse(req.params).provedor, baseUrlPublica(req)));

  // --- WhatsApp Business: envio real e histórico de mensagens -------------------
  const criar = await permissaoMiddleware('integracoes', 'criar');
  app.post('/integracoes/central/whatsapp/mensagens', { preHandler: [auth, criar, limiteEnvio] }, async (req: any) =>
    enviarWhatsApp(req.user.empresaId, req.user.id, EnvioWhats.parse(req.body ?? {}) as any));
  app.get('/integracoes/central/whatsapp/mensagens', { preHandler: [auth, ver] }, async (req: any) => {
    const q = z.object({ direcao: z.enum(['ENVIADA', 'RECEBIDA']).optional(), limite: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query ?? {});
    return { mensagens: await listarMensagens(req.user.empresaId, q) };
  });

  // --- E-mail: envio real, histórico e caixa de entrada -------------------------
  app.post('/integracoes/central/email/enviar', { preHandler: [auth, criar, limiteEnvio] }, async (req: any) =>
    enviarEmail(req.user.empresaId, req.user.id, EnvioMail.parse(req.body ?? {})));
  app.get('/integracoes/central/email/envios', { preHandler: [auth, ver] }, async (req: any) =>
    ({ envios: await listarEnvios(req.user.empresaId) }));
  // --- Financeiro: cobrança externa (Asaas / Mercado Pago) para uma conta a receber ---------
  const fin = await permissaoMiddleware('financeiro', 'criar');
  const PedidoCobranca = z.object({
    provedor: z.enum(['asaas', 'mercadopago']),
    forma: z.enum(['BOLETO', 'PIX', 'UNDEFINED']).optional(),
    pagador: z.object({ nome: z.string().trim().min(2).max(120), documento: z.string().max(20), email: z.string().email().max(254).optional() }).optional(),
  });
  app.post('/financeiro/:id/cobranca', { preHandler: [auth, fin, limiteConexao] }, async (req: any) =>
    gerarCobranca(req.user.empresaId, req.user.id, z.object({ id: z.string().min(1).max(40) }).parse(req.params).id, PedidoCobranca.parse(req.body ?? {}), baseUrlPublica(req)));
  app.post('/financeiro/:id/cobranca/atualizar', { preHandler: [auth, fin, limiteConexao] }, async (req: any) =>
    atualizarCobranca(req.user.empresaId, req.user.id, z.object({ id: z.string().min(1).max(40) }).parse(req.params).id));

  // --- WooCommerce: importação de pedidos para Vendas (manual, por filial) ---------------
  app.post('/integracoes/central/woocommerce/pedidos/importar', { preHandler: [auth, editar, limiteConexao] }, async (req: any) => {
    const d = z.object({ filialId: z.string().min(1).max(40), limite: z.number().int().min(1).max(200).default(50) }).parse(req.body ?? {});
    return importarPedidosWoo(req.user.empresaId, req.user.id, d.filialId, d.limite);
  });

  app.get('/integracoes/central/email/caixa', { preHandler: [auth, ver, limiteConexao] }, async (req: any) =>
    ({ mensagens: await caixaDeEntrada(req.user.empresaId) }));

  app.post('/integracoes/central/:provedor/testar', { preHandler: [auth, editar, limiteConexao] }, async (req: any) =>
    testar(req.user.empresaId, req.user.id, Params.parse(req.params).provedor, Corpo.parse(req.body ?? {})));

  app.put('/integracoes/central/:provedor', { preHandler: [auth, editar, limiteConexao] }, async (req: any) =>
    salvar(req.user.empresaId, req.user.id, Params.parse(req.params).provedor, Corpo.parse(req.body ?? {})));

  app.post('/integracoes/central/:provedor/desconectar', { preHandler: [auth, editar] }, async (req: any) =>
    desconectar(req.user.empresaId, req.user.id, Params.parse(req.params).provedor));

  app.delete('/integracoes/central/:provedor', { preHandler: [auth, excluir] }, async (req: any) =>
    remover(req.user.empresaId, req.user.id, Params.parse(req.params).provedor));

  app.get('/integracoes/central/:provedor/historico', { preHandler: [auth, ver] }, async (req: any) =>
    ({ eventos: await historico(req.user.empresaId, Params.parse(req.params).provedor) }));
}

/**
 * Webhook PÚBLICO do WhatsApp (a Meta chama sem sessão). Plugin encapsulado: aqui o JSON
 * chega como Buffer bruto, porque a assinatura X-Hub-Signature-256 é calculada sobre os
 * bytes exatos do corpo. A empresa vem do registro (id na URL); a autenticidade, da
 * assinatura com o App Secret dessa empresa. Responde 200 rápido para a Meta não repetir.
 */
export async function whatsappWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 3 * 1024 * 1024 }, (_req, corpo, feito) => feito(null, corpo));
  const IdReg = z.object({ registroId: z.string().regex(/^[a-z0-9]{20,40}$/) });

  app.get('/integracoes/whatsapp/webhook/:registroId', { preHandler: limiteWebhook }, async (req: any, reply: any) => {
    definirSistemaDaRequisicao('whatsapp:webhook');
    const p = IdReg.safeParse(req.params);
    if (!p.success) return reply.code(404).send();
    const cred = await verificarAssinaturaWebhook(p.data.registroId);
    const desafio = desafioValido(req.query ?? {}, cred?.segredos.verifyToken);
    if (!cred || !desafio) return reply.code(403).send();
    await registrarEvento({ empresaId: cred.empresaId, provedor: 'whatsapp', operacao: 'CONECTAR', ok: true, mensagem: 'Webhook verificado pela Meta.' });
    return reply.code(200).type('text/plain').send(desafio);
  });

  app.post('/integracoes/whatsapp/webhook/:registroId', { preHandler: limiteWebhook }, async (req: any, reply: any) => {
    definirSistemaDaRequisicao('whatsapp:webhook');
    const p = IdReg.safeParse(req.params);
    if (!p.success) return reply.code(404).send();
    const cred = await verificarAssinaturaWebhook(p.data.registroId);
    const bruto: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!cred || !assinaturaValida(bruto, req.headers['x-hub-signature-256'], cred.segredos.appSecret)) return reply.code(401).send();
    let payload: unknown;
    try { payload = JSON.parse(bruto.toString('utf8')); } catch { return reply.code(400).send(); }
    const inicio = Date.now();
    try {
      const r = await processarWebhook(cred.empresaId, cred.config.phoneNumberId, payload);
      if (r.recebidas || r.status) await registrarEvento({ empresaId: cred.empresaId, provedor: 'whatsapp', operacao: 'SINCRONIZAR', ok: true, mensagem: `Webhook: ${r.recebidas} recebida(s), ${r.status} status atualizado(s).`, duracaoMs: Date.now() - inicio });
      return reply.code(200).send({ ok: true });
    } catch (e) {
      req.log.error({ err: e instanceof Error ? e.message : 'erro' }, 'falha ao processar webhook do WhatsApp');
      await registrarEvento({ empresaId: cred.empresaId, provedor: 'whatsapp', operacao: 'SINCRONIZAR', ok: false, codigoErro: 'PERSISTENCIA', mensagem: 'Falha ao processar evento do webhook.', duracaoMs: Date.now() - inicio });
      return reply.code(500).send(); // a Meta reenvia; o processamento é idempotente
    }
  });
}

/**
 * Webhooks PÚBLICOS de cobrança. O aviso só serve de gatilho: o pagamento é sempre consultado
 * na API do provedor com a credencial da empresa dona do registro (ver cobrancas.service.ts).
 *  - Asaas: exige o cabeçalho asaas-access-token igual ao "Token do webhook" salvo.
 *  - Mercado Pago: notification_url única por empresa; aceita o id em data.id (corpo) ou
 *    na query (data.id / id) e consulta GET /v1/payments/{id}.
 * Sempre 200 rápido quando autenticado (o provedor reenvia em erro; a baixa é idempotente).
 */
export async function cobrancasWebhookRoutes(app: FastifyInstance): Promise<void> {
  const IdReg = z.object({ registroId: z.string().regex(/^[a-z0-9]{20,40}$/) });

  app.post('/integracoes/asaas/webhook/:registroId', { preHandler: limiteWebhook }, async (req: any, reply: any) => {
    definirSistemaDaRequisicao('asaas:webhook');
    const p = IdReg.safeParse(req.params);
    if (!p.success) return reply.code(404).send();
    const cred = await credenciaisPorRegistro(p.data.registroId, 'ASAAS');
    const recebido = Buffer.from(String(req.headers['asaas-access-token'] ?? ''));
    const esperado = Buffer.from(cred?.segredos.webhookToken ?? '');
    if (!cred || !esperado.length || recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return reply.code(401).send();
    const evento = String(req.body?.event ?? '');
    const idPagamento = String(req.body?.payment?.id ?? '');
    if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH'].includes(evento) && idPagamento) {
      await conferirPagamento(cred.empresaId, 'asaas', idPagamento);
    }
    return reply.code(200).send({ ok: true });
  });

  app.post('/integracoes/mercadopago/webhook/:registroId', { preHandler: limiteWebhook }, async (req: any, reply: any) => {
    definirSistemaDaRequisicao('mercadopago:webhook');
    const p = IdReg.safeParse(req.params);
    if (!p.success) return reply.code(404).send();
    const cred = await credenciaisPorRegistro(p.data.registroId, 'MERCADO_PAGO');
    if (!cred) return reply.code(404).send();
    const tipo = String(req.body?.type ?? req.query?.type ?? req.query?.topic ?? '');
    const id = String(req.body?.data?.id ?? req.query?.['data.id'] ?? req.query?.id ?? '');
    if (tipo === 'payment' && id) await conferirPagamento(cred.empresaId, 'mercadopago', id);
    return reply.code(200).send({ ok: true });
  });
}
