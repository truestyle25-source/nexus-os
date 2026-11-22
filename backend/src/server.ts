import Fastify from 'fastify';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { opcoesCors } from './lib/cors.js';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { Prisma } from '@prisma/client';
import { authRoutes } from './modules/auth/auth.routes.js';
import { dashboardRealRoutes } from './modules/dashboard/dashboard.routes.js';
import { empresaRoutes } from './modules/empresa/empresa.routes.js';
import { usuariosRoutes } from './modules/usuarios/usuarios.routes.js';
import { produtosRoutes } from './modules/produtos/produtos.routes.js';
import { kitsRoutes } from './modules/produtos/kits.routes.js';
import { estoqueRoutes } from './modules/estoque/estoque.routes.js';
import { comprasRoutes } from './modules/compras/compras.routes.js';
import { vendasRoutes } from './modules/vendas/vendas.routes.js';
import { pdvRoutes } from './modules/pdv/pdv.routes.js';
import { gestaoRoutes } from './modules/gestao/gestao.routes.js';
import { rhRoutes } from './modules/rh/rh.routes.js';
// Ciclo 1 — Plano de Desenvolvimento DISC. Registro separado de `rhRoutes`
// porque é um módulo com rotas, regra e IA próprios; o cadastro das rotas do RH
// continua exatamente como estava.
import { planoDesenvolvimentoRoutes } from './modules/rh/plano-desenvolvimento.routes.js';
// Ciclo 2 — Treinamentos, participantes e presença. Mesmo motivo: módulo
// próprio, rotas na raiz (padrão do RH: `/funcionarios`, e não `/rh/...`).
import { treinamentosRoutes } from './modules/rh/treinamentos.routes.js';
// Ciclo 3 — Liderança Empática (feedback) e Gestão de Tempo (leitura de ponto).
// Nenhuma das duas grava jornada: a Gestão de Tempo só LÊ o `Ponto`.
import { liderancaRoutes } from './modules/rh/lideranca.routes.js';
import { gestaoTempoRoutes } from './modules/rh/gestao-tempo.routes.js';
// Ciclo 4 — Loja de Recompensas e resgates. Catálogo e estoque próprios; o
// saldo de pontos é calculado, nunca gravado.
import { lojaRoutes } from './modules/rh/loja.routes.js';
// Ciclo 6: sessao de inventario. A folha conta quem contou e quando, e o
// saldo do sistema fica congelado no momento em que a sessao abre.
import { inventarioRoutes } from './modules/rh/inventario.routes.js';
// Ciclo 5 — Pontuação configurável por empresa. Os critérios, os valores e as
// condições são da empresa; o NEXUS só mede o evento real e credita o que ela
// configurou.
import { pontuacaoRoutes } from './modules/rh/pontuacao.routes.js';
import { folhaRoutes } from './modules/rh/folha.routes.js';
import { iaRoutes } from './modules/ia/ia.routes.js';
import { importacaoRoutes } from './modules/importacao/importacao.routes.js';
import { assinaturaRoutes } from './modules/assinatura/assinatura.routes.js';
import { integracoesRoutes } from './modules/integracoes/integracoes.routes.js';
import { shopeeRoutes } from './modules/integracoes/shopee/shopee.routes.js';
import { pixRoutes } from './modules/payments/pix.routes.js';
import { lgpdRoutes } from './modules/lgpd/lgpd.routes.js';
import { apiPublicaRoutes } from './modules/api-publica/api-publica.routes.js';
import { ttsRoutes } from './modules/tts/tts.controller.js';
import { relatoriosRoutes } from './modules/relatorios/relatorios.routes.js';
import { fornecedoresRoutes } from './modules/fornecedores/fornecedores.routes.js';
import { fornecedorFichaRoutes } from './modules/fornecedores/fornecedor-ficha.routes.js';
import { compraFichaRoutes } from './modules/compras/compra-ficha.routes.js';
import { produtoFichaRoutes } from './modules/produtos/produto-ficha.routes.js';
import { radarRoutes } from './modules/radar/radar.routes.js';
import { fiscalRoutes } from './modules/fiscal/fiscal.routes.js';
import { registerAuthentication } from './middlewares/auth.js';
import { prisma } from './lib/prisma.js';
import { comoSistema } from './lib/tenant-context.js';
import { ErroDeNegocio } from './lib/erros.js';
import { opcoesDeLog } from './lib/logger.js';
import { configuracaoTrustProxy } from './lib/client-ip.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createRateLimiter } from './middlewares/rateLimiter.js';
import { iniciarAgendadorDeSnapshot, pararAgendadorDeSnapshot, TAREFAS_DIARIAS } from './scripts/scheduler.js';
import { tarefasAtrasadas } from './lib/tarefa-agendada.js';
import { iniciarAgendadorML, pararAgendadorML } from './modules/integracoes/agendador-ml.js';
import { iniciarAgendadorShopee, pararAgendadorShopee } from './modules/integracoes/shopee/shopee-scheduler.js';

dotenv.config();

/**
 * `bodyLimit` de 20 MB — obrigatório, não é folga.
 *
 * O upload de documentos do RH viaja em base64 dentro do JSON (ver o comentário
 * de transporte em `modules/rh/rh.routes.ts`). Base64 custa ~33% de overhead:
 * um arquivo de 10 MB — o limite anunciado na interface — vira um corpo de
 * ~13,3 MB. O padrão do Fastify é 1 MB, que derrubaria a requisição com
 * `413 FST_ERR_CTP_BODY_TOO_LARGE` ANTES de qualquer validação nossa, e o
 * operador veria só "arquivo grande demais" num arquivo que está dentro do
 * limite real. 20 MB dão folga para o base64 + o resto do JSON do mesmo body.
 */
/**
 * `logger` como objeto (antes: `true`) — MESMA configuração padrão do Pino
 * (nível info, stdout, mesmas frequências de "incoming request"/"request
 * completed"), com um único acréscimo: o serializer `req` que mascara valores
 * de parâmetros sensíveis na URL (code/state do callback OAuth do Mercado
 * Livre, tokens) nas linhas de log. Nenhum log é desativado; nas demais rotas
 * só as chaves sensíveis conhecidas são afetadas (ver `lib/log-redacao.ts`).
 */
const app = Fastify({
  // Configuração única de log (redação de segredos, nível por LOG_LEVEL): lib/logger.ts.
  logger: opcoesDeLog,
  bodyLimit: 20 * 1024 * 1024,
  // `true` (padrão anterior) ou o número de proxies confiáveis em TRUST_PROXY_HOPS: lib/client-ip.ts.
  trustProxy: configuracaoTrustProxy(),
  // Identificador de requisição: reaproveita o `X-Request-Id` recebido (se tiver formato seguro)
  // ou gera um UUID. Vai em toda linha de log (`reqId`) e volta no cabeçalho da resposta.
  requestIdHeader: false,
  genReqId: (req) => {
    const recebido = req.headers['x-request-id'];
    const valor = Array.isArray(recebido) ? recebido[0] : recebido;
    return valor && /^[A-Za-z0-9._-]{8,64}$/.test(valor) ? valor : randomUUID();
  },
});

// Cabeçalhos de segurança em TODA resposta da API.
// A CSP restritiva vale só para respostas JSON (a API não serve páginas); PDFs e
// downloads continuam abrindo normalmente.
app.addHook('onSend', async (request, reply, payload) => {
  reply.header('X-Request-Id', request.id);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  const tipo = String(reply.getHeader('content-type') ?? '');
  if (tipo.startsWith('application/json')) {
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }
  return payload;
});

// Métodos declarados e origens normalizadas: ver lib/cors.ts.
await app.register(cors, opcoesCors());
await app.register(cookie);
validarJwtSecret();
await app.register(jwt, { secret: process.env.JWT_SECRET! });

await app.register(registerAuthentication);
// O Enterprise Pack (pasta Nexus-OS-Enterprise-Pack/ na raiz) ainda não está integrado ao backend.

/**
 * Tratamento de erros centralizado (Seção 45). Ordem importa:
 *  1. Zod (validação de entrada) -> 400 com os issues detalhados.
 *  2. ErroDeNegocio -> usa o status explícito que a rota escolheu.
 *  3. Erros conhecidos do Prisma (unicidade, registro não encontrado) ->
 *     status apropriado sem vazar detalhes internos do banco.
 *  4. `new Error('mensagem')` lançado deliberadamente dentro de uma rota
 *     (convenção usada em todos os módulos deste projeto) -> 400 com a
 *     própria mensagem, porque foi escrita para o usuário final.
 *  5. Qualquer outra coisa (bug real, exceção não prevista) -> 500 genérico;
 *     o detalhe completo vai só para o log do servidor, nunca na resposta.
 */
app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
  // Nível de log pelo TIPO do erro: falha do cliente (validação, regra de negócio,
  // 4xx) é `info`; só o que vira 500 é `error` — é o que monitoramento e alertas contam.
  const rota = request.routeOptions?.url ?? request.url.split('?')[0];
  const erroDoCliente = error.name === 'ZodError'
    || error instanceof ErroDeNegocio && error.status < 500
    || (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2025'))
    || (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500)
    || error.constructor === Error;
  // Capacidade esgotada (fila de conexões/transação além do tempo): 503 com Retry-After,
  // para o cliente tentar de novo — não é bug, é sobrecarga. Registrado para o monitoramento.
  const sobrecarga = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2028' || error.code === 'P2024');
  if (sobrecarga) {
    request.log.warn({ rota, evento: 'capacidade_excedida', mensagem: error.message?.slice(0, 200) }, 'transação sem conexão disponível a tempo');
    return reply.status(503).header('Retry-After', '2').send({ error: 'Sistema ocupado no momento. Tente novamente em instantes.', referencia: request.id });
  }
  if (erroDoCliente) {
    request.log.info({ rota, erro: error.name, mensagem: error.message?.slice(0, 300) }, 'requisição recusada');
  } else {
    request.log.error({ err: error, rota, evento: 'erro_interno' }, 'erro interno não tratado');
  }

  if (error.name === 'ZodError') {
    const zodError = error as unknown as { issues: unknown };
    return reply.status(400).send({ error: 'Dados inválidos.', detalhes: zodError.issues });
  }

  if (error instanceof ErroDeNegocio) {
    return reply.status(error.status).send({ error: error.message });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return reply.status(409).send({ error: 'Registro duplicado.' });
    if (error.code === 'P2025') return reply.status(404).send({ error: 'Registro não encontrado.' });
  }

  // Erros com statusCode proprio (erros do Fastify: parsing de body 400,
  // content-type 415, rota nao encontrada 404 etc.) ja carregam o status
  // correto de ERRO DE CLIENTE - devem mante-lo, nao ser mascarados como 500.
  if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.status(error.statusCode).send({ error: error.message });
  }

  if (error.constructor === Error) {
    return reply.status(400).send({ error: error.message });
  }

  // `referencia` = id da requisição: o usuário pode informá-lo e o erro é achado no log.
  return reply.status(500).send({ error: 'Erro interno do servidor.', referencia: request.id });
});

// Disponibilidade (liveness): o processo responde. Usado pelo health check do Render.
app.get('/health', async () => ({ status: 'ok', service: 'NEXUS OS' }));

// Prontidão (readiness): o processo consegue falar com o banco. 503 quando não.
// Não expõe host, versão nem mensagem de erro do banco — só o estado e a latência.
app.get('/health/ready', async (request, reply) => {
  const inicio = Date.now();
  try {
    await Promise.race([
      comoSistema('health:ready', () => prisma.$queryRaw`SELECT 1`),
      new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error('timeout do banco (3 s)')), 3000)),
    ]);
    const latenciaBancoMs = Date.now() - inicio;
    // Tarefas diárias sem sucesso há mais de 26 h (o monitor externo alerta). Não derruba a prontidão.
    const atrasadas = await tarefasAtrasadas([...TAREFAS_DIARIAS]).catch(() => [] as string[]);
    return { status: 'ok', banco: 'ok', latenciaBancoMs, tarefasAtrasadas: atrasadas, uptimeS: Math.round(process.uptime()) };
  } catch (err) {
    request.log.error({ err, evento: 'banco_indisponivel' }, 'health/ready: banco indisponível');
    return reply.status(503).send({ status: 'indisponivel', banco: 'falha', uptimeS: Math.round(process.uptime()) });
  }
});

// Erros de tela do frontend (error.tsx / global-error.tsx): vão para o MESMO log
// estruturado do backend, com o id da requisição, para serem achados e contados.
// Público de propósito (a tela pode quebrar antes do login), com corpo pequeno
// e validado, e limite por IP.
const limiteTelemetria = createRateLimiter(30, 60_000, { nome: 'telemetria-erro' });
const esquemaErroFrontend = z.object({
  mensagem: z.string().trim().min(1).max(500),
  digest: z.string().max(100).optional(),
  pagina: z.string().max(300).optional(),
  pilha: z.string().max(4000).optional(),
});
app.post('/telemetria/erro-frontend', { preHandler: limiteTelemetria, bodyLimit: 16 * 1024 }, async (request, reply) => {
  const dados = esquemaErroFrontend.parse(request.body);
  request.log.warn({ evento: 'erro_frontend', ...dados, userAgent: String(request.headers['user-agent'] ?? '').slice(0, 200) }, 'erro no frontend');
  return reply.status(204).send();
});

await app.register(dashboardRealRoutes, { prefix: "/dashboard" });
await app.register(authRoutes);
await app.register(empresaRoutes);
await app.register(usuariosRoutes);
await app.register(produtosRoutes);
await app.register(kitsRoutes);
await app.register(estoqueRoutes);
await app.register(comprasRoutes);
await app.register(vendasRoutes);
await app.register(pdvRoutes);
await app.register(gestaoRoutes);
await app.register(rhRoutes);
// Ciclo 1: rotas na RAIZ (sem prefixo), igual ao restante do módulo RH —
// `GET /funcionarios`, e não `GET /rh/funcionarios`.
await app.register(planoDesenvolvimentoRoutes);
// Ciclo 2: Treinamentos. Rotas na raiz também, por consistência com o RH.
await app.register(treinamentosRoutes);
// Ciclo 3: Liderança Empática e Gestão de Tempo. Rotas na raiz, mesmo padrão.
await app.register(liderancaRoutes);
await app.register(gestaoTempoRoutes);
// Ciclo 4: Loja de Recompensas e resgates. Rotas na raiz, mesmo padrão.
await app.register(lojaRoutes);
// Ciclo 6: sessoes de inventario e contagens.
await app.register(inventarioRoutes);
// Ciclo 5: critérios de pontuação da empresa, apuração e lançamento manual.
await app.register(pontuacaoRoutes);
// Folha de pagamento: rotas separadas, registradas no mesmo prefixo do RH.
await app.register(folhaRoutes);
await app.register(iaRoutes);
await app.register(importacaoRoutes);
await app.register(assinaturaRoutes);
await app.register(integracoesRoutes);
await app.register(shopeeRoutes);
await app.register(pixRoutes);
await app.register(lgpdRoutes);
await app.register(apiPublicaRoutes);
await app.register(ttsRoutes);
await app.register(relatoriosRoutes);
await app.register(fornecedoresRoutes);
await app.register(fornecedorFichaRoutes);
await app.register(compraFichaRoutes);
// Ficha completa do produto (cadastro ERP por abas).
await app.register(produtoFichaRoutes);
await app.register(fiscalRoutes);
// Radar Organizacional: uma única chamada (/radar/resumo) alimenta a tela.
await app.register(radarRoutes, { prefix: "/radar" });

// Exportado para testes de integração (o servidor só escuta quando este arquivo é o ponto de entrada).
export { app };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3333);
  await app.listen({ port, host: '0.0.0.0' });
  // Agendadores rodam fora de requisições: escopo de sistema explícito. Os
  // timers criados aqui herdam este contexto (AsyncLocalStorage).
  void comoSistema('agendador:snapshot-estoque', () => iniciarAgendadorDeSnapshot());
  // Agendador persistente de sync ML: provisiona tarefas das contas CONECTADAS
  // e inicia o despertador recursivo (o estado vive no banco — sobrevive a
  // restart). Desabilitável com ML_SYNC_AUTO=false.
  void comoSistema('agendador:mercadolivre', () => iniciarAgendadorML());
  void comoSistema('agendador:shopee', () => iniciarAgendadorShopee());

  async function encerrarComCuidado(sinal: string) {
    app.log.info(`${sinal} recebido, encerrando NEXUS OS...`);
    pararAgendadorDeSnapshot();
    await pararAgendadorML();
    await pararAgendadorShopee();
    await app.close();
    await prisma.$disconnect();
  }
  process.once('SIGTERM', () => void encerrarComCuidado('SIGTERM'));
  process.once('SIGINT', () => void encerrarComCuidado('SIGINT'));
}

/**
 * Valida que JWT_SECRET está definido e tem pelo menos 32 caracteres.
 * Lança Error se inválido, impedindo a inicialização do servidor.
 * Exportado para ser testável isoladamente.
 */
export function validarJwtSecret(): void {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error(
      'JWT_SECRET não definido ou com menos de 32 caracteres. O servidor não pode iniciar sem um segredo JWT seguro.'
    );
  }
}
