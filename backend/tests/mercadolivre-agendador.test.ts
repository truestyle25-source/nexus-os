/**
 * TESTE DE INTEGRAÇÃO — AGENDADOR PERSISTENTE DE SINCRONIZAÇÃO DO ML
 * ===================================================================
 *
 * Cobre os 15 cenários da fase de agendamento automático (o sync manual e o
 * webhook e dedupe por ID continuam cobertos por mercadolivre-sync.test.ts — regressão
 * verificada também aqui nas seções 5, 12 e 13). Tudo roda contra um
 * servidor SIMULADO local da API do ML — sem rede, sem credenciais reais.
 * O estado do agendador vive na tabela `SincronizacaoTarefa` (migration
 * 202610130900): nenhum teste depende de `setInterval` em memória.
 *
 *   1)  Autostart: iniciarAgendadorML provisiona tarefas das contas
 *      CONECTADAS sem nenhum clique manual.
 *   2)  Processamento automático de produtos, estoque e pedidos via tick.
 *   3)  Recuperação pós-reinicialização (lease vencido = execução órfã).
 *   4)  Duas instâncias concorrentes: trava atômica, exatamente UMA executa.
 *   5)  Dedupe de notificações repetidas (webhook 2x => 1 venda).
 *   6)  Retentativa da TAREFA após falha temporária (backoff exponencial).
 *   7)  HTTP 429: Retry-After respeitado pelo cliente + recuperação.
 *   8)  Conta desconectada => tarefa PAUSADA sem martelar a API.
 *   9)  Isolamento entre empresas no tick e no estado persistido.
 *   10) Vendas duplicadas prevenidas em execuções repetidas.
 *   11) Estoque: NUNCA baixa interna; apenas empurra saldo (PUT) sem
 *       movimentações indevidas.
 *   12) Webhook e sincronização periódica convivem (idempotência cruzada).
 *   13) Sincronização manual preservada.
 *   14) Pendências de falha sobrevivem a restart e executam ao vencer.
 *   15) Persistência + loop vivo (setTimeout recursivo executa sozinho).
 *   16) Rota de observabilidade protegida, isolada e sem segredos.
 */
import { test } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { integracoesRoutes } from '../src/modules/integracoes/integracoes.routes.js';
import { executarFilaNotificacoesML } from '../src/modules/integracoes/mercadolivre-notificacoes.service.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { encryptSecret } from '../src/lib/secrets.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import {
  iniciarAgendadorML,
  pararAgendadorML,
  executarTickML,
  provisionarTarefasML,
} from '../src/modules/integracoes/agendador-ml.js';

const SEGREDO = 'segredo-teste-ml-agendador';
const SUFIXO = Date.now().toString(36);
const ACCOUNT_ID = 'MLAGEND123';
const TIPOS = ['MERCADO_LIVRE_PRODUTOS', 'MERCADO_LIVRE_ESTOQUE', 'MERCADO_LIVRE_PEDIDOS'] as const;
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Estado do "Mercado Livre" simulado: catálogo, pedidos e log de chamadas. */
interface EstadoML {
  chamadas: Array<{ metodo: string; caminho: string }>;
  puts: Array<{ id: string; body: any }>;
  /** Próxima chamada ao caminho recebe `status` (opcionalmente com Retry-After). */
  falhaUnica: { caminhoExato: string; status: number; retryAfter?: number } | null;
  /** Chamada ao caminho falha SEMPRE com 500 (testa backoff da TAREFA). */
  falhaPersistente: string | null;
  bloqueio?: { caminho: string; iniciou: () => void; aguardando: Promise<void> };
  itens: Record<string, any>;
  pedidos: Record<string, any>;
}

/**
 * Servidor HTTP local com o subconjunto da API usado pelos serviços:
 * /users/{id}/items/search, /items/{id} (GET/PUT), /orders/search e
 * /orders/{id}. Exige Authorization: Bearer (senão 401).
 */
async function criarServidorML(estado: EstadoML): Promise<import('node:http').Server> {
  const servidor = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const caminho = url.pathname;
    const metodo = req.method ?? 'GET';
    let corpo: any = null;
    if (metodo === 'POST' || metodo === 'PUT') {
      const pedacos: Buffer[] = [];
      for await (const pedaco of req) pedacos.push(pedaco as Buffer);
      const texto = Buffer.concat(pedacos).toString('utf8');
      corpo = texto ? JSON.parse(texto) : null;
    }
    estado.chamadas.push({ metodo, caminho });

    const responder = (status: number, dados: unknown, cabecalhos: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...cabecalhos });
      res.end(JSON.stringify(dados));
    };

    const autorizacao = req.headers.authorization;
    if (!autorizacao || !autorizacao.startsWith('Bearer ')) {
      return responder(401, { message: 'Token ausente ou inválido.' });
    }
    if (estado.bloqueio?.caminho === `${metodo} ${caminho}`) {
      estado.bloqueio.iniciou();
      await estado.bloqueio.aguardando;
    }
    const chave = `${metodo} ${caminho}`;
    if (estado.falhaPersistente === chave) {
      return responder(500, { message: 'Falha persistente simulada.' });
    }
    if (estado.falhaUnica && estado.falhaUnica.caminhoExato === chave) {
      const { status, retryAfter } = estado.falhaUnica;
      estado.falhaUnica = null;
      return responder(
        status,
        { message: `Falha simulada (${status}).` },
        retryAfter !== undefined ? { 'Retry-After': String(retryAfter) } : {},
      );
    }

    const buscaAnuncios = /^\/users\/([^/]+)\/items\/search$/.exec(caminho);
    if (metodo === 'GET' && buscaAnuncios) {
      const ids = Object.keys(estado.itens);
      return responder(200, { paging: { total: ids.length, offset: 0, size: ids.length }, results: ids });
    }
    const item = /^\/items\/([^/]+)$/.exec(caminho);
    if (item) {
      const id = decodeURIComponent(item[1]);
      const atual = estado.itens[id];
      if (metodo === 'GET') {
        return atual ? responder(200, atual) : responder(404, { message: 'Item not found' });
      }
      if (metodo === 'PUT') {
        if (!atual) return responder(404, { message: 'Item not found' });
        estado.puts.push({ id, body: corpo });
        if (typeof corpo?.available_quantity === 'number') {
          atual.available_quantity = corpo.available_quantity;
        }
        return responder(200, atual);
      }
    }
    if (metodo === 'GET' && caminho === '/orders/search') {
      const ids = Object.keys(estado.pedidos);
      return responder(200, { paging: { total: ids.length, offset: 0, size: ids.length }, results: ids });
    }
    const pedido = /^\/orders\/([^/]+)$/.exec(caminho);
    if (metodo === 'GET' && pedido) {
      const id = decodeURIComponent(pedido[1]);
      return estado.pedidos[id] ? responder(200, estado.pedidos[id]) : responder(404, { message: 'Order not found' });
    }
    return responder(404, { message: `Rota simulada não mapeada: ${metodo} ${caminho}` });
  });
  await new Promise<void>((resolveListen) => servidor.listen(0, '127.0.0.1', resolveListen));
  return servidor;
}

async function main() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') {
      return reply.status(400).send({ error: 'Dados inválidos.', detalhes: (error as any).issues });
    }
    if (error instanceof ErroDeNegocio) {
      return reply.status(error.status).send({ error: error.message });
    }
    if (error?.statusCode >= 400 && error?.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    if (error?.constructor === Error) return reply.status(400).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.' });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  await app.register(integracoesRoutes);
  await app.ready();

  // ---------------- Servidor simulado da API do ML ----------------
  const estado: EstadoML = {
    chamadas: [], puts: [], falhaUnica: null, falhaPersistente: null,
    itens: {
      MLB100: { id: 'MLB100', title: 'Fone de Ouvido NEXUS', price: 199.9, currency_id: 'BRL', available_quantity: 5, status: 'active' },
      MLB200: { id: 'MLB200', title: 'Capa Protetora NEXUS', price: 49.9, currency_id: 'BRL', available_quantity: 3, status: 'active' },
    },
    pedidos: {
      '9001': {
        id: '9001', status: 'paid', currency_id: 'BRL', total_amount: 199.9,
        date_created: '2026-01-15T10:00:00.000-04:00',
        order_items: [{ item: { id: 'MLB100', title: 'Fone de Ouvido NEXUS' }, quantity: 1, unit_price: 199.9, currency_id: 'BRL' }],
        payments: [{ status: 'approved', payment_type_id: 'credit_card', transaction_amount: 199.9 }],
      },
      '9002': {
        id: '9002', status: 'paid', currency_id: 'USD', total_amount: 100,
        date_created: '2026-01-16T10:00:00.000-04:00',
        order_items: [{ item: { id: 'MLB200', title: 'Capa Protetora NEXUS' }, quantity: 1, unit_price: 100, currency_id: 'USD' }],
        payments: [],
      },
    },
  };
  const servidor = await criarServidorML(estado);
  const servidorFechado = { valor: false };
  const fecharServidor = async () => {
    if (servidorFechado.valor) return;
    servidorFechado.valor = true;
    await new Promise<void>((resolveFecha) => servidor.close(() => resolveFecha()));
  };
  const porta = (servidor.address() as { port: number }).port;
  const envAnterior = {
    MERCADOLIVRE_API_URL: process.env.MERCADOLIVRE_API_URL,
    ML_SYNC_BACKOFF_MS: process.env.ML_SYNC_BACKOFF_MS,
    ML_SYNC_BACKOFF_BASE_S: process.env.ML_SYNC_BACKOFF_BASE_S,
    ML_SYNC_TICK_MS: process.env.ML_SYNC_TICK_MS,
    ML_SYNC_AUTO: process.env.ML_SYNC_AUTO,
    MERCADOLIVRE_WEBHOOK_SECRET: process.env.MERCADOLIVRE_WEBHOOK_SECRET,
  };
  process.env.MERCADOLIVRE_API_URL = `http://127.0.0.1:${porta}`;
  process.env.ML_SYNC_BACKOFF_MS = '5'; // retentativas internas do cliente instantâneas
  process.env.ML_SYNC_BACKOFF_BASE_S = '1'; // backoff da TAREFA ~1s (mensurável e rápido)
  delete process.env.ML_SYNC_AUTO; // agendador habilitado (autostart precisa dele ligado)
  delete process.env.MERCADOLIVRE_WEBHOOK_SECRET; // webhook na camada de re-consulta

  // ---------------- Dados (multi-tenant) ----------------
  const empresa = await prisma.empresa.create({
    data: { nome: `MLAgend ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresaB = await prisma.empresa.create({
    data: { nome: `MLAgendOutro ${SUFIXO}`, cnpj: `${Date.now() + 1}`.padStart(14, '0') },
  });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Filial ML Agend' } });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: 'Agend ML', email: `mlagend-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: 'Sem Agend', email: `mlsemagend-${SUFIXO}@teste.local`, senhaHash },
  });
  const usuarioB = await prisma.usuario.create({
    data: { empresaId: empresaB.id, nome: 'Tenant B Agend', email: `mlagendb-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuarioB.id })) });

  const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa.id, email: semPermissao.email })}` };
  const HB = { authorization: `Bearer ${app.jwt.sign({ id: usuarioB.id, empresaId: empresaB.id, email: usuarioB.email })}` };
  const ids = [usuario.id, semPermissao.id, usuarioB.id];

  const cadastro = await prisma.integracaoExterno.create({
    data: {
      empresaId: empresa.id, tipo: 'MERCADO_LIVRE', nome: 'ML Agend Teste', status: 'CONECTADO',
      accountId: ACCOUNT_ID, accountName: 'Loja NEXUS Agend',
      clientId: encryptSecret('cid-agend'), clientSecret: encryptSecret('csec-agend'),
      redirectUri: 'http://localhost:3333/integracoes/mercadolivre/callback',
      accessToken: encryptSecret('access-agend-token'), refreshToken: encryptSecret('refresh-agend-token'),
      tokenExpiry: new Date(Date.now() + 3600_000),
    },
  });

  const qtdChamadas = (metodo: string, caminho: string) =>
    estado.chamadas.filter((c) => c.metodo === metodo && c.caminho === caminho).length;
  const tarefaDe = (empresaId: string, tipo: string) =>
    prisma.sincronizacaoTarefa.findUnique({ where: { empresaId_tipo: { empresaId, tipo } } });
  /** Deixa vencida(s) a(s) tarefa(s) da empresa (proximaExecucaoEm no passado). */
  const vencer = async (empresaId: string, tipo?: string) => {
    await prisma.sincronizacaoTarefa.updateMany({
      where: { empresaId, ...(tipo ? { tipo } : {}) },
      data: { proximaExecucaoEm: new Date(Date.now() - 1000) },
    });
  };
  /**
   * Tick ESCOPADO nas empresas deste teste. O tick real é global (correto em
   * produção), mas aqui o banco é compartilhado com outros arquivos de teste
   * rodando em paralelo — sem escopo, uma tarefa vencida deles contaminaria
   * as contagens exatas destas asserções.
   */
  const tick = (empresaIds?: string[]) =>
    executarTickML({ empresaIds: empresaIds ?? [empresa.id, empresaB.id] });

  try {
    console.log('\n1. Inicialização automática (autostart sem clique manual)');
    await iniciarAgendadorML();
    const tarefasA = await prisma.sincronizacaoTarefa.findMany({ where: { empresaId: empresa.id } });
    ok('3 tarefas provisionadas para a conta CONECTADA ao subir o agendador',
      tarefasA.length === 3 && new Set(tarefasA.map((t) => t.tipo)).size === 3,
      JSON.stringify(tarefasA.map((t) => ({ tipo: t.tipo, status: t.status }))));
    ok('toda tarefa nasce AGUARDANDO com execução FUTURA (nada executado no provisionar)',
      tarefasA.every((t) => t.status === 'AGUARDANDO' && t.proximaExecucaoEm.getTime() > Date.now() - 1000
        && t.ultimoSucessoEm === null),
      JSON.stringify(tarefasA.map((t) => ({ tipo: t.tipo, status: t.status, proxima: t.proximaExecucaoEm.toISOString() }))));
    const tarefasB = await prisma.sincronizacaoTarefa.count({ where: { empresaId: empresaB.id } });
    ok('empresa SEM conta ML não recebe tarefas (bootstrap só de CONECTADAS)',
      tarefasB === 0, `tarefasB=${tarefasB}`);
    ok('provisionar e idempotente (chamar de novo nao duplica linha)',
      (await (async () => { await provisionarTarefasML(empresa.id); return prisma.sincronizacaoTarefa.count({ where: { empresaId: empresa.id } }); })()) === 3);
    await pararAgendadorML(); // o resto dos testes usa executarTickML() (mesmo código do ciclo)

    console.log('\n2. Processamento automático de produtos, estoque e pedidos (tick)');
    await vencer(empresa.id);
    const tick1 = await tick();
    ok('tick executou as 3 tarefas vencidas', tick1.execucoes === 3 && tick1.candidatas === 3,
      JSON.stringify(tick1));
    const espelhos = await prisma.produto.findMany({ where: { empresaId: empresa.id, sku: { startsWith: 'ML-' } } });
    ok('produtos espelhados automaticamente (2 anuncios do catalogo)',
      espelhos.length === 2 && espelhos.every((p) => p.origem === 'INTEGRACAO'),
      JSON.stringify(espelhos.map((p) => p.sku)));
    const venda9001 = await prisma.venda.findMany({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9001' } });
    const venda9002 = await prisma.venda.findMany({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9002' } });
    ok('pedido BRL 9001 importado como venda sem clique manual',
      venda9001.length === 1, `vendas9001=${venda9001.length}`);
    ok('pedido USD 9002 recusado (nunca vira venda indevida)', venda9002.length === 0,
      `vendas9002=${venda9002.length}`);
    const tProd = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PRODUTOS');
    ok('tarefa PRODUTOS: sucesso com processados=2, tentativas 0, proxima futura',
      !!tProd && tProd.status === 'AGUARDANDO' && tProd.processadosUltima === 2
      && tProd.tentativas === 0 && !!tProd.ultimoSucessoEm && tProd.proximaExecucaoEm.getTime() > Date.now(),
      JSON.stringify(tProd && { status: tProd.status, processados: tProd.processadosUltima, proxima: tProd.proximaExecucaoEm }));
    const tPed = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    ok('tarefa PEDIDOS: sucesso com processados=2 (9001+9002 consultados)',
      !!tPed && tPed.status === 'AGUARDANDO' && tPed.processadosUltima === 2 && tPed.tentativas === 0,
      JSON.stringify(tPed && { status: tPed.status, processados: tPed.processadosUltima }));

    // Linha de estoque do espelho MLB100: a ETAPA 3 deve EMPURRAR o saldo.
    const espelhoFone = espelhos.find((p) => p.sku === 'ML-MLB100');
    ok('espelho MLB100 criado para montar o cenario de estoque', !!espelhoFone, JSON.stringify(espelhos.map((p) => p.sku)));
    if (espelhoFone) {
      await prisma.estoque.create({ data: { filialId: filial.id, produtoId: espelhoFone.id, quantidade: 7, empresaId: empresa.id } });
      const movAntes = await prisma.estoqueMovimentacao.count({ where: { produtoId: espelhoFone.id } });
      await vencer(empresa.id, 'MERCADO_LIVRE_ESTOQUE');
      const tickEstoque = await tick();
      ok('tick do estoque executou (1 tarefa)', tickEstoque.execucoes === 1, JSON.stringify(tickEstoque));
      const putFone = estado.puts.find((p) => p.id === 'MLB100');
      ok('saldo interno EMPURRADO para o ML (PUT available_quantity=7)',
        !!putFone && putFone.body?.available_quantity === 7,
        JSON.stringify(estado.puts));
      const linha = await prisma.estoque.findUnique({ where: { filialId_produtoId: { filialId: filial.id, produtoId: espelhoFone.id } } });
      ok('saldo interno permanece 7 (sync de estoque NUNCA baixa)', Number(linha?.quantidade) === 7,
        String(linha?.quantidade));
      const movDepois = await prisma.estoqueMovimentacao.count({ where: { produtoId: espelhoFone.id } });
      ok('NENHUMA movimentacao interna indevida gerada', movDepois === movAntes,
        `antes=${movAntes} depois=${movDepois}`);
    }

    console.log('\n3. Recuperacao pos-reinicializacao (lease vencido = execucao orfa)');
    // Simula "processo caiu no meio": EXECUTANDO de OUTRA instancia com lease vencido.
    await prisma.sincronizacaoTarefa.update({
      where: { empresaId_tipo: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE_PEDIDOS' } },
      data: { status: 'EXECUTANDO', leaseExpiraEm: new Date(Date.now() - 5000), instanciaId: 'instancia-caida' },
    });
    const antesSearch = qtdChamadas('GET', '/orders/search');
    const tickOrfa = await tick();
    ok('tick desengatou a execucao orfa (recuperadas +1) e a re-executou',
      tickOrfa.desengatadas === 1 && tickOrfa.execucoes >= 1,
      JSON.stringify(tickOrfa));
    ok('re-execucao consultou o recurso no servidor simulado',
      qtdChamadas('GET', '/orders/search') === antesSearch + 1,
      `antes=${antesSearch} depois=${qtdChamadas('GET', '/orders/search')}`);
    const tPedDepois = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    ok('tarefa recuperada: AGUARDANDO, contador recuperadas=1, ultimoSucessoEm novo',
      !!tPedDepois && tPedDepois.status === 'AGUARDANDO' && tPedDepois.recuperadas === 1
      && !!tPedDepois.ultimoSucessoEm && tPedDepois.leaseExpiraEm === null,
      JSON.stringify(tPedDepois && { status: tPedDepois.status, recuperadas: tPedDepois.recuperadas }));
    ok('recuperacao nao duplicou a venda', (await prisma.venda.count({ where: { empresaId: empresa.id } })) === 1);

    // "Reinicio do processo": novo boot NAO perde nem rescreve o estado do banco.
    const agendaAntes = await prisma.sincronizacaoTarefa.findMany({ where: { empresaId: empresa.id }, orderBy: { tipo: 'asc' } });
    await iniciarAgendadorML();
    const agendaDepois = await prisma.sincronizacaoTarefa.findMany({ where: { empresaId: empresa.id }, orderBy: { tipo: 'asc' } });
    ok('novo boot preserva 3 tarefas e a agenda (proximaExecucaoEm intacta)',
      agendaDepois.length === 3
      && agendaDepois.every((t, i) => t.proximaExecucaoEm.getTime() === agendaAntes[i].proximaExecucaoEm.getTime()
        && t.status === agendaAntes[i].status),
      JSON.stringify(agendaDepois.map((t) => ({ tipo: t.tipo, proxima: t.proximaExecucaoEm, status: t.status }))));
    await pararAgendadorML();

    console.log('\n4. Protecao contra processamento conflitante (duas instancias)');
    await vencer(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    const antesConc = qtdChamadas('GET', '/orders/search');
    const [tickA, tickB] = await Promise.all([tick(), tick()]);
    ok('duas instancias concorrentes: exatamente UMA tomou a tarefa',
      (tickA.execucoes === 1 && tickB.execucoes === 0) || (tickA.execucoes === 0 && tickB.execucoes === 1),
      JSON.stringify({ tickA, tickB }));
    ok('listagem de pedidos consultada UMA vez (trava atomica nao duplica chamada a API)',
      qtdChamadas('GET', '/orders/search') === antesConc + 1,
      `antes=${antesConc} depois=${qtdChamadas('GET', '/orders/search')}`);
    ok('corrida nao gerou segunda venda', (await prisma.venda.count({ where: { empresaId: empresa.id } })) === 1);

    console.log('\n5. Deduplicacao de notificacoes repetidas (webhook 2x)');
    const payload9001 = { resource: '/orders/9001', user_id: ACCOUNT_ID, topic: 'orders_v2', application_id: 1, attempts: 1 };
    const wh1 = await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: payload9001 });
    const reconsultasAntes = qtdChamadas('GET', '/orders/9001');
    await executarFilaNotificacoesML();
    const reconsultasDepoisDaPrimeira = qtdChamadas('GET', '/orders/9001');
    const wh2 = await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: payload9001 });
    await executarFilaNotificacoesML();
    ok('primeira notificacao persistida e consumida (re-consulta autenticada)',
      wh1.statusCode === 200 && wh1.json().queued === true && reconsultasDepoisDaPrimeira === reconsultasAntes + 1,
      `status=${wh1.statusCode} body=${wh1.body.slice(0, 160)}`);
    ok("notificacao repetida deduplicada (motivo 'duplicada', sem nova re-consulta)",
      wh2.json().queued === true && wh2.json().duplicate === true && String(wh2.json().motivo).includes('duplicada')
      && wh2.json().duplicate === true && qtdChamadas('GET', '/orders/9001') === reconsultasDepoisDaPrimeira,
      `body=${wh2.body.slice(0, 160)} reconsultas=${qtdChamadas('GET', '/orders/9001') - reconsultasAntes}`);
    ok('dedupe manteve 1 unica venda', (await prisma.venda.count({ where: { empresaId: empresa.id } })) === 1);

    console.log('\n6. Retentativas apos falha temporaria (backoff da TAREFA)');
    estado.falhaPersistente = 'GET /orders/search'; // 500 em toda tentativa
    await vencer(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    const tickFalha = await tick();
    ok('tick com falha persistente executou a tentativa (1 tomada)', tickFalha.execucoes === 1,
      JSON.stringify(tickFalha));
    const tFalha = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    const erroTFalha = (tFalha?.ultimoErro ?? null) as any;
    ok('apos falha: AGUARDANDO (nao presa em EXECUTANDO), tentativas=1, proxima no FUTURO (backoff)',
      !!tFalha && tFalha.status === 'AGUARDANDO' && tFalha.tentativas === 1
      && tFalha.proximaExecucaoEm.getTime() > Date.now() && tFalha.leaseExpiraEm === null,
      JSON.stringify(tFalha && { status: tFalha.status, tentativas: tFalha.tentativas, proxima: tFalha.proximaExecucaoEm }));
    ok('ultimoErro persistido de forma redigida (motivo + em, sem segredo)',
      !!erroTFalha && typeof erroTFalha.motivo === 'string' && erroTFalha.motivo.length > 0 && !!erroTFalha.em,
      JSON.stringify(erroTFalha));
    ok('falha registrada em Importacao ERRO (visivel, sem fingir sucesso)',
      !!(await prisma.importacao.findFirst({
        where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE_PEDIDOS', status: 'ERRO' },
        orderBy: { createdAt: 'desc' },
      })));
    estado.falhaPersistente = null; // servico volta ao normal
    await vencer(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    await tick();
    const tRecuperada = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    ok('retentativa de sucesso zerou tentativas e limpou o erro',
      !!tRecuperada && tRecuperada.status === 'AGUARDANDO' && tRecuperada.tentativas === 0
      && tRecuperada.ultimoErro === null && !!tRecuperada.ultimoSucessoEm,
      JSON.stringify(tRecuperada && { tentativas: tRecuperada.tentativas, erro: tRecuperada.ultimoErro }));

    console.log('\n7. Tratamento de HTTP 429 (Retry-After respeitado)');
    estado.falhaUnica = { caminhoExato: 'GET /orders/search', status: 429, retryAfter: 1 };
    await vencer(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    const antes429 = qtdChamadas('GET', '/orders/search');
    const t0_429 = Date.now();
    await tick();
    const dt429 = Date.now() - t0_429;
    ok('429 com Retry-After: 1s AGUARDADO antes de repetir (>=900ms e <15s)',
      dt429 >= 900 && dt429 < 15_000, `dt=${dt429}ms`);
    ok('listagem consultada 2x (429 + repeticao de sucesso)',
      qtdChamadas('GET', '/orders/search') === antes429 + 2,
      `novas=${qtdChamadas('GET', '/orders/search') - antes429}`);
    const t429 = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    ok('tarefa concluiu sem contar tentativa (cliente absorveu o 429)',
      !!t429 && t429.tentativas === 0 && !!t429.ultimoSucessoEm,
      JSON.stringify(t429 && { tentativas: t429.tentativas }));

    console.log('\n8. Conta desconectada => tarefa bloqueada (PAUSADA)');
    await prisma.integracaoExterno.update({ where: { id: cadastro.id }, data: { status: 'EXPIRADO' } });
    await vencer(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    const chamadasAntesPausa = estado.chamadas.length;
    await tick();
    const tPausada = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    const erroPausada = (tPausada?.ultimoErro ?? null) as any;
    ok('tarefa PAUSADA com motivo de conta desconectada (sem consumir tentativa)',
      !!tPausada && tPausada.status === 'PAUSADA' && tPausada.tentativas === 0
      && typeof erroPausada?.motivo === 'string' && erroPausada.motivo.includes('desconectada'),
      JSON.stringify(tPausada && { status: tPausada.status, erro: tPausada.ultimoErro }));
    ok('NENHUMA chamada nova a API com a conta desconectada',
      estado.chamadas.length === chamadasAntesPausa,
      `novas=${estado.chamadas.length - chamadasAntesPausa}`);
    await provisionarTarefasML(empresa.id, { reativar: true }); // reconectar = reativar
    const tReativada = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    ok('reconexao (provisionar com reativar) devolveu a tarefa a AGUARDANDO',
      !!tReativada && tReativada.status === 'AGUARDANDO' && tReativada.tentativas === 0 && tReativada.ultimoErro === null,
      JSON.stringify(tReativada && { status: tReativada.status }));
    await prisma.integracaoExterno.update({ where: { id: cadastro.id }, data: { status: 'CONECTADO' } });

    console.log('\n9. Isolamento de dados entre empresas');
    await provisionarTarefasML(empresaB.id); // outra empresa provisionada (sem conta ML)
    await vencer(empresaB.id); // vence APENAS as da B
    const tAantes = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    const chamadasAntesIsolamento = estado.chamadas.length;
    const tickIsolamento = await tick();
    ok('tick processou somente as 3 tarefas vencidas da empresa B',
      tickIsolamento.execucoes === 3, JSON.stringify(tickIsolamento));
    const tarefasDaB = await prisma.sincronizacaoTarefa.findMany({ where: { empresaId: empresaB.id } });
    ok('tarefas da B pausadas por falta de conta (sem tocar em dados de A)',
      tarefasDaB.length === 3 && tarefasDaB.every((t) => t.status === 'PAUSADA'),
      JSON.stringify(tarefasDaB.map((t) => ({ tipo: t.tipo, status: t.status }))));
    const tAdepois = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    ok('tarefa da A permaneceu intacta (agenda de A nao afetada pelo tick da B)',
      !!tAantes && !!tAdepois && tAdepois.status === tAantes.status
      && tAdepois.proximaExecucaoEm.getTime() === tAantes.proximaExecucaoEm.getTime(),
      JSON.stringify({ antes: tAantes?.proximaExecucaoEm, depois: tAdepois?.proximaExecucaoEm }));
    ok('nenhuma chamada a API (B sem conta nao consulta Mercado Livre)',
      estado.chamadas.length === chamadasAntesIsolamento,
      `novas=${estado.chamadas.length - chamadasAntesIsolamento}`);

    console.log('\n10. Prevencao de vendas duplicadas na importacao de pedidos');
    await vencer(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    const tickDups = await tick();
    ok('execucao repetida de pedidos realizada', tickDups.execucoes === 1, JSON.stringify(tickDups));
    ok('venda do 9001 continua UNICA apos reexecucao',
      (await prisma.venda.count({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9001' } })) === 1);
    const impPedidos = await prisma.importacao.findFirst({
      where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE_PEDIDOS', status: 'IMPORTADO' },
      orderBy: { createdAt: 'desc' },
    });
    const relatorioPedidos = ((impPedidos?.mapeamento ?? {}) as any).relatorio ?? [];
    ok('relatorio da importacao marca 9001 como duplicada (e nao como nova)',
      relatorioPedidos.some((r: any) => r.pedidoId === '9001' && r.acao === 'duplicada'),
      JSON.stringify(relatorioPedidos));
    ok('total de vendas da empresa segue 1 (9002 USD nunca entrou)',
      (await prisma.venda.count({ where: { empresaId: empresa.id } })) === 1);

    console.log('\n11. Estoque: nova execucao sem baixas internas indevidas');
    const linhaAntes = await prisma.estoque.findUnique({
      where: { filialId_produtoId: { filialId: filial.id, produtoId: espelhoFone!.id } },
    });
    const movTotalAntes = await prisma.estoqueMovimentacao.count({ where: { filialId: filial.id } });
    await vencer(empresa.id, 'MERCADO_LIVRE_ESTOQUE');
    await tick();
    const linhaDepois = await prisma.estoque.findUnique({
      where: { filialId_produtoId: { filialId: filial.id, produtoId: espelhoFone!.id } },
    });
    const movTotalDepois = await prisma.estoqueMovimentacao.count({ where: { filialId: filial.id } });
    ok('saldo interno inalterado apos nova execucao do sync de estoque',
      Number(linhaAntes?.quantidade) === 7 && Number(linhaDepois?.quantidade) === 7,
      `antes=${linhaAntes?.quantidade} depois=${linhaDepois?.quantidade}`);
    ok('nenhuma movimentacao de estoque nova (so empurra saldo, nunca baixa)',
      movTotalDepois === movTotalAntes, `antes=${movTotalAntes} depois=${movTotalDepois}`);
    ok('SEM PUT redundante quando saldo interno == remoto (otimizacao do sync)',
      estado.puts.filter((p) => p.id === 'MLB100').length === 1,
      `puts=${estado.puts.filter((p) => p.id === 'MLB100').length}`);
    // Mudanca de saldo interno => nova diferenca => o sync EMPURRA novamente.
    await prisma.estoque.update({
      where: { filialId_produtoId: { filialId: filial.id, produtoId: espelhoFone!.id } },
      data: { quantidade: 6 },
    });
    await vencer(empresa.id, 'MERCADO_LIVRE_ESTOQUE');
    await tick();
    ok('saldo interno alterado => novo PUT available_quantity=6 (NEXUS segue sendo a fonte)',
      estado.puts.filter((p) => p.id === 'MLB100').some((p) => p.body?.available_quantity === 6),
      JSON.stringify(estado.puts.filter((p) => p.id === 'MLB100')));

    console.log('\n12. Webhook e sincronizacao periodica sao compativeis');
    // (a) webhook CHEGA DEPOIS do tick ja ter importado o pedido:
    const whAposTick = await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: payload9001 });
    await executarFilaNotificacoesML();
    ok('webhook apos tick: 200 processada como duplicada (idempotencia cruzada)',
      whAposTick.statusCode === 200 && whAposTick.json().duplicate === true
      && String(whAposTick.json().motivo).includes('duplicada'),
      `body=${whAposTick.body.slice(0, 160)}`);
    // (b) webhook CHEGA PRIMEIRO (pedido novo), tick depois:
    estado.pedidos['9005'] = {
      id: '9005', status: 'paid', currency_id: 'BRL', total_amount: 50,
      date_created: '2026-02-01T08:00:00.000-04:00',
      order_items: [{ item: { id: 'MLB100', title: 'Fone de Ouvido NEXUS' }, quantity: 1, unit_price: 50, currency_id: 'BRL' }],
      payments: [{ status: 'approved', payment_type_id: 'pix', transaction_amount: 50 }],
    };
    const wh9005 = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/webhook',
      payload: { resource: '/orders/9005', user_id: ACCOUNT_ID, topic: 'orders' },
    });
    await executarFilaNotificacoesML();
    ok('webhook de pedido novo enfileirou 9005 para o consumidor',
      wh9005.json().queued === true,
      `body=${wh9005.body.slice(0, 160)}`);
    await vencer(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    await tick();
    ok('tick posterior NAO duplica o pedido que o webhook ja importou',
      (await prisma.venda.count({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9005' } })) === 1);
    ok('total de vendas A = 2 (9001 + 9005; 9002 USD e 9002/recusados nunca contam)',
      (await prisma.venda.count({ where: { empresaId: empresa.id } })) === 2,
      `vendas=${await prisma.venda.count({ where: { empresaId: empresa.id } })}`);

    console.log('\n13. Sincronizacao manual preservada');
    const manual = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/sync/pedidos',
      headers: H, payload: { filialId: filial.id },
    });
    ok('POST sync/pedidos manual ainda responde 200', manual.statusCode === 200,
      `status=${manual.statusCode} body=${manual.body.slice(0, 160)}`);
    const manualJson = manual.json();
    ok('manual reconhece as duplicatas ja importadas (2x9001/9005) sem novas vendas',
      manualJson.duplicados === 2 && (await prisma.venda.count({ where: { empresaId: empresa.id } })) === 2,
      JSON.stringify({ duplicados: manualJson.duplicados }));

    console.log('\n14. Pendencias de falha sobrevivem a restart e executam ao vencer');
    estado.falhaPersistente = 'GET /orders/search';
    await vencer(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    await tick(); // deixa uma pendencia registrada
    const pendenciaAntes = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    ok('pendencia criada antes do restart (tentativas >= 1)',
      !!pendenciaAntes && pendenciaAntes.tentativas >= 1 && pendenciaAntes.status === 'AGUARDANDO',
      JSON.stringify(pendenciaAntes && { tentativas: pendenciaAntes.tentativas, status: pendenciaAntes.status }));
    await pararAgendadorML();
    await iniciarAgendadorML(); // "novo processo": estado vem APENAS do banco
    const pendenciaDepois = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    ok('apos restart: mesma pendencia (proximaExecucaoEm, tentativas e erro intactos)',
      !!pendenciaAntes && !!pendenciaDepois
      && pendenciaDepois.proximaExecucaoEm.getTime() === pendenciaAntes.proximaExecucaoEm.getTime()
      && pendenciaDepois.tentativas === pendenciaAntes.tentativas
      && JSON.stringify(pendenciaDepois.ultimoErro) === JSON.stringify(pendenciaAntes.ultimoErro),
      JSON.stringify({ antes: pendenciaAntes && { p: pendenciaAntes.proximaExecucaoEm, t: pendenciaAntes.tentativas }, depois: pendenciaDepois && { p: pendenciaDepois.proximaExecucaoEm, t: pendenciaDepois.tentativas } }));
    await pararAgendadorML();
    estado.falhaPersistente = null;
    await vencer(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    await tick();
    const pendenciaResolvida = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    ok('apos restart + servico saudavel: pendencia executada, tentativas zeradas',
      !!pendenciaResolvida && pendenciaResolvida.tentativas === 0
      && pendenciaResolvida.ultimoErro === null && !!pendenciaResolvida.ultimoSucessoEm,
      JSON.stringify(pendenciaResolvida && { tentativas: pendenciaResolvida.tentativas, erro: pendenciaResolvida.ultimoErro }));

    console.log('\n15. Persistencia, concorrencia e execucao correta do agendador');
    ok('tarefas vivem NO BANCO (3 linhas em SincronizacaoTarefa), nao em memoria',
      (await prisma.sincronizacaoTarefa.count({ where: { empresaId: empresa.id } })) === 3);
    // Loop vivo: o timer recursivo (setTimeout encadeado) executa sozinho —
    // nenhum teste chama executarTickML() durante a janela.
    process.env.ML_SYNC_TICK_MS = '1000';
    await vencer(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    const sucessoAntesDoLoop = (await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS'))?.ultimoSucessoEm?.getTime() ?? 0;
    await iniciarAgendadorML();
    await dormir(3000); // ~1s de tick + execucao; folga para jitter
    await pararAgendadorML();
    const tLoop = await tarefaDe(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    ok('loop executou a tarefa vencida SOZINHO (sem tick manual) e reagendou',
      !!tLoop && (tLoop.ultimoSucessoEm?.getTime() ?? 0) > sucessoAntesDoLoop
      && tLoop.status === 'AGUARDANDO' && tLoop.proximaExecucaoEm.getTime() > Date.now(),
      JSON.stringify(tLoop && { status: tLoop.status, ultimoSucessoEm: tLoop.ultimoSucessoEm, proxima: tLoop.proximaExecucaoEm }));
    ok('concorrencia ja comprovada na secao 4 (2 ticks paralelos, 1 execucao)', true);

    console.log('\n15b. Encerramento aguarda o ciclo ativo e nao agenda outro tick');
    let avisarInicio!: () => void;
    const cicloIniciado = new Promise<void>((resolve) => { avisarInicio = resolve; });
    let liberarChamada!: () => void;
    const liberarCiclo = new Promise<void>((resolve) => { liberarChamada = resolve; });
    estado.bloqueio = { caminho: 'GET /orders/search', iniciou: avisarInicio, aguardando: liberarCiclo };
    await vencer(empresa.id, 'MERCADO_LIVRE_PEDIDOS');
    await iniciarAgendadorML();
    await cicloIniciado;
    let encerramentoConcluido = false;
    const encerramento = pararAgendadorML().then(() => { encerramentoConcluido = true; });
    await dormir(50);
    ok('pararAgendadorML aguarda a consulta que ja estava em andamento', !encerramentoConcluido);
    liberarChamada();
    await encerramento;
    estado.bloqueio = undefined;
    const chamadasAoEncerrar = estado.chamadas.length;
    await dormir(1200);
    ok('apos pararAgendadorML nao inicia novo ciclo nem nova chamada', estado.chamadas.length === chamadasAoEncerrar,
      `antes=${chamadasAoEncerrar} depois=${estado.chamadas.length}`);

    console.log('\n16. Rota de observabilidade (protegida, isolada, sem segredos)');
    const rota = '/integracoes/mercadolivre/sync/agendamento';
    const rotaSemToken = await app.inject({ method: 'GET', url: rota });
    ok('GET sync/agendamento sem token -> 401', rotaSemToken.statusCode === 401,
      `status=${rotaSemToken.statusCode}`);
    const rotaSemPerm = await app.inject({ method: 'GET', url: rota, headers: Hsem });
    ok('GET sync/agendamento sem integracoes:visualizar -> 403', rotaSemPerm.statusCode === 403,
      `status=${rotaSemPerm.statusCode}`);
    const rotaA = await app.inject({ method: 'GET', url: rota, headers: H });
    ok('GET sync/agendamento com permissao -> 200 com as 3 tarefas da empresa',
      rotaA.statusCode === 200 && rotaA.json().tarefas?.length === 3,
      `status=${rotaA.statusCode} body=${rotaA.body.slice(0, 200)}`);
    const corpoA = rotaA.json();
    const tarefaPedResp = (corpoA.tarefas ?? []).find((t: any) => t.tipo === 'MERCADO_LIVRE_PEDIDOS');
    ok('resposta expoe: status, proxima, ultimoSucesso, processados, tentativas e ultimoErro redigido',
      !!tarefaPedResp && typeof tarefaPedResp.status === 'string'
      && !!tarefaPedResp.proximaExecucaoEm && !!tarefaPedResp.ultimoSucessoEm
      && typeof tarefaPedResp.processadosUltima === 'number' && typeof tarefaPedResp.tentativas === 'number'
      && (tarefaPedResp.ultimoErro === null || typeof tarefaPedResp.ultimoErro.motivo === 'string'),
      JSON.stringify(tarefaPedResp));
    ok('resumo agrega pendentes/falhas/recuperadas + periodos configurados',
      !!corpoA.resumo && typeof corpoA.resumo.pendentes === 'number' && typeof corpoA.resumo.recuperadas === 'number'
      && corpoA.periodos?.produtosMin >= 0 && corpoA.periodos?.estoqueMin >= 0 && corpoA.periodos?.pedidosMin >= 0,
      JSON.stringify({ resumo: corpoA.resumo, periodos: corpoA.periodos }));
    const rotaB = await app.inject({ method: 'GET', url: rota, headers: HB });
    const corpoB = rotaB.json();
    ok('empresa B ve APENAS as tarefas da B (pausadas, processados 0) — isolamento',
      rotaB.statusCode === 200 && corpoB.tarefas?.length === 3
      && corpoB.tarefas.every((t: any) => t.processadosUltima === 0 && t.status === 'PAUSADA'),
      JSON.stringify(corpoB.tarefas?.map((t: any) => ({ tipo: t.tipo, status: t.status, proc: t.processadosUltima }))));
    const textoRespostas = rotaA.body + rotaB.body;
    ok('nenhum token/segredo/accountId na resposta',
      !textoRespostas.includes('access-agend-token') && !textoRespostas.includes('refresh-agend-token')
      && !textoRespostas.includes('csec-agend') && !textoRespostas.includes('Bearer')
      && !textoRespostas.includes(ACCOUNT_ID),
      textoRespostas.slice(0, 300));
  } finally {
    await pararAgendadorML();
    await fecharServidor();
    for (const [chave, valor] of Object.entries(envAnterior)) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
    const todas = [empresa.id, empresaB.id];
    const vendasDasEmpresas = await prisma.venda.findMany({ where: { empresaId: { in: todas } }, select: { id: true } });
    const vendaIds = vendasDasEmpresas.map((x) => x.id);
    await prisma.notificacaoMercadoLivre.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.sincronizacaoTarefa.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.idempotencyKey.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.vendaPagamento.deleteMany({ where: { vendaId: { in: vendaIds } } });
    await prisma.vendaItem.deleteMany({ where: { vendaId: { in: vendaIds } } });
    await prisma.venda.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.auditoria.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.importacao.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.integracaoExterno.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.estoque.deleteMany({ where: { filialId: filial.id } });
    await prisma.produto.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.filial.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: todas } } });
    await app.close();
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}

test('integração: agendador persistente Mercado Livre (15 cenários + observabilidade)', async () => {
  await main();
});









