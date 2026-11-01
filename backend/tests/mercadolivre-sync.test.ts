/**
 * TESTE DE INTEGRAÇÃO — SINCRONIZAÇÃO MERCADO LIVRE (Etapas 2-4 + webhook)
 *
 * Tudo roda contra um servidor SIMULADO local da API do ML (`createServer`)
 * apontado por MERCADOLIVRE_API_URL — sem rede, sem credenciais reais, sem
 * migration. O access token é gravado criptografado com expiry FUTURO para
 * não acionar refresh. O que este arquivo trava:
 *
 *   1) Permissões: rotas sync exigem integracoes:editar (401/403) e validam
 *      body (limites dos parâmetros de paginação).
 *   2) ETAPA 2 (produtos): espelha anúncios em produtos 'ML-*' (custo nunca
 *      vem do ML), registra Importacao + Auditoria e é idempotente na
 *      segunda execução (sem duplicar produto).
 *   3) ETAPA 3 (estoque): precedência NEXUS → ML (PUT available_quantity),
 *      Pedidos ativos debitam saldo local idempotentemente; cancelamentos devolvem estoque.
 *   4) ETAPA 4 (pedidos): importa como Venda com DUAS camadas de
 *      idempotência (repetição = 'duplicada', nunca 2 vendas); moeda
 *      não-BRL é recusa explícita (sem venda), sem efeitos contábeis.
 *   5) Webhook público: ponteiro persistido na fila durável, consumo automático
 *      reconsulta com o token próprio, dedupe por evento e tenant via user_id.
 *   6) Falha transitória (500) é retentada pelo cliente (backoff curto) e
 *      rede indisponível vira 502 — nunca dado inventado.
 */
import { test } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { executarFilaNotificacoesML } from '../src/modules/integracoes/mercadolivre-notificacoes.service.js';
import { hashSenha } from '../src/lib/auth.js';
import { integracoesRoutes } from '../src/modules/integracoes/integracoes.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { encryptSecret } from '../src/lib/secrets.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-ml-sync';
const SUFIXO = Date.now().toString(36);
const ACCOUNT_ID = 'MLTESTE123';
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

/** Estado do "Mercado Livre" simulado: catálogo, pedidos e log de chamadas. */
interface EstadoML {
  chamadas: Array<{ metodo: string; caminho: string }>;
  puts: Array<{ id: string; body: any }>;
  /** Próxima chamada ao caminho recebe `status` (teste de retentativa). */
  falhaUnica: { caminhoExato: string; status: number } | null;
  /** Caminho que retorna 500 continuamente (teste do retry persistido da fila). */
  falhaPersistente: string | null;
  itens: Record<string, any>;
  pedidos: Record<string, any>;
}

/**
 * Servidor HTTP local que fala o subconjunto da API do ML usado pelo sync:
 * /users/{id}/items/search, /items/{id} (GET/PUT), /orders/search e
 * /orders/{id}. Exige Authorization: Bearer (senão 401) — prova que o cliente
 * envia o token próprio em TODA chamada.
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

    const responder = (status: number, dados: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dados));
    };

    const autorizacao = req.headers.authorization;
    if (!autorizacao || !autorizacao.startsWith('Bearer ')) {
      return responder(401, { message: 'Token ausente ou inválido.' });
    }
    if (estado.falhaPersistente === `${metodo} ${caminho}`) {
      return responder(500, { message: 'Falha persistente simulada.' });
    }
    if (estado.falhaUnica && estado.falhaUnica.caminhoExato === `${metodo} ${caminho}`) {
      const { status } = estado.falhaUnica;
      estado.falhaUnica = null;
      return responder(status, { message: `Falha simulada (${status}).` });
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
    const pagamento = /^\/collections\/([^/]+)$/.exec(caminho);
    if (metodo === 'GET' && pagamento) {
      return responder(200, { id: pagamento[1], order_id: '9004' });
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
      // Moeda fora de BRL: recusa explícita, nunca vira venda.
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
    MERCADOLIVRE_WEBHOOK_SECRET: process.env.MERCADOLIVRE_WEBHOOK_SECRET,
  };
  process.env.MERCADOLIVRE_API_URL = `http://127.0.0.1:${porta}`;
  process.env.ML_SYNC_BACKOFF_MS = '5'; // retentativas instantâneas no teste

  // ---------------- Dados (multi-tenant) ----------------
  const empresa = await prisma.empresa.create({
    data: { nome: `MLSync ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresaB = await prisma.empresa.create({
    data: { nome: `MLSyncOutro ${SUFIXO}`, cnpj: `${Date.now() + 1}`.padStart(14, '0') },
  });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Filial ML Sync' } });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: 'Sync ML', email: `mlsync-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: 'Sem Sync', email: `mlsemsync-${SUFIXO}@teste.local`, senhaHash },
  });
  const usuarioB = await prisma.usuario.create({
    data: { empresaId: empresaB.id, nome: 'Tenant B', email: `mltenantb-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuarioB.id })) });

  const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa.id, email: semPermissao.email })}` };
  const HB = { authorization: `Bearer ${app.jwt.sign({ id: usuarioB.id, empresaId: empresaB.id, email: usuarioB.email })}` };
  const ids = [usuario.id, semPermissao.id, usuarioB.id];

  // Conta CONECTADA apontando para o servidor simulado. Expiry FUTURO para
  // não acionar refresh; credenciais criptografadas como em produção.
  const cadastro = await prisma.integracaoExterno.create({
    data: {
      empresaId: empresa.id, tipo: 'MERCADO_LIVRE', nome: 'ML Sync Teste', status: 'CONECTADO',
      accountId: ACCOUNT_ID, accountName: 'Loja NEXUS Teste',
      clientId: encryptSecret('cid-sync'), clientSecret: encryptSecret('csec-sync'),
      redirectUri: 'http://localhost:3333/integracoes/mercadolivre/callback',
      accessToken: encryptSecret('access-sync-token'), refreshToken: encryptSecret('refresh-sync-token'),
      tokenExpiry: new Date(Date.now() + 3600_000),
    },
  });

  const qtdChamadas = (metodo: string, caminho: string) =>
    estado.chamadas.filter((c) => c.metodo === metodo && c.caminho === caminho).length;

  try {
    console.log('\n1. Rotas sync: permissões e validação de body');
    for (const url of [
      '/integracoes/mercadolivre/sync/produtos',
      '/integracoes/mercadolivre/sync/estoque',
      '/integracoes/mercadolivre/sync/pedidos',
    ]) {
      const semTok = await app.inject({ method: 'POST', url, payload: {} });
      ok(`${url} sem token -> 401`, semTok.statusCode === 401, `status=${semTok.statusCode}`);
      const semPerm = await app.inject({ method: 'POST', url, headers: Hsem, payload: {} });
      ok(`${url} sem integracoes:editar -> 403`, semPerm.statusCode === 403, `status=${semPerm.statusCode}`);
    }
    const limiteInvalido = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/sync/produtos', headers: H, payload: { limiteAnuncios: 5000 },
    });
    ok('limiteAnuncios acima do teto 1000 -> 400', limiteInvalido.statusCode === 400, `status=${limiteInvalido.statusCode}`);
    const estoqueSemFilial = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/sync/estoque', headers: H, payload: {},
    });
    ok('sync/estoque sem filialId -> 400', estoqueSemFilial.statusCode === 400, `status=${estoqueSemFilial.statusCode}`);
    const pedidosSemFilial = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/sync/pedidos', headers: H, payload: {},
    });
    ok('sync/pedidos sem filialId -> 400', pedidosSemFilial.statusCode === 400, `status=${pedidosSemFilial.statusCode}`);
    const contaB = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/sync/produtos', headers: HB, payload: {},
    });
    ok('empresa sem conta ML -> 400 "nao conectada" (nunca finge sincronizar)',
      contaB.statusCode === 400 && contaB.body.includes('não conectada'),
      `status=${contaB.statusCode} body=${contaB.body.slice(0, 160)}`);

    console.log('\n2. ETAPA 2 (produtos): espelha anúncios, registra Importacao/Auditoria, idempotente');
    // Primeira chamada ao /items/search falha UMA vez com 500 (transitório):
    // o cliente deve retentar (backoff de ML_SYNC_BACKOFF_MS=5) e concluir.
    estado.falhaUnica = { caminhoExato: `GET /users/${ACCOUNT_ID}/items/search`, status: 500 };
    const sync1 = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/sync/produtos', headers: H, payload: {},
    });
    ok('POST sync/produtos -> 200', sync1.statusCode === 200, `status=${sync1.statusCode} body=${sync1.body.slice(0, 200)}`);
    const r1 = sync1.json();
    ok('2 anuncios consultados apos retentar o 500', r1.anunciosConsultados === 2, JSON.stringify(r1));
    ok('listagem consultada 2x (500 + sucesso)',
      qtdChamadas('GET', `/users/${ACCOUNT_ID}/items/search`) === 2,
      `chamadas=${qtdChamadas('GET', `/users/${ACCOUNT_ID}/items/search`)}`);
    ok('2 criados, 0 erros', r1.criados === 2 && r1.erros === 0, JSON.stringify({ criados: r1.criados, erros: r1.erros }));

    const espelhos = await prisma.produto.findMany({ where: { empresaId: empresa.id, sku: { startsWith: 'ML-' } } });
    ok('2 produtos espelho ML-* com origem INTEGRACAO e custo zero',
      espelhos.length === 2 && espelhos.every((p) => p.origem === 'INTEGRACAO' && Number(p.custo) === 0),
      JSON.stringify(espelhos.map((p) => ({ sku: p.sku, origem: p.origem, custo: Number(p.custo) }))));
    const fone = espelhos.find((p) => p.sku === 'ML-MLB100');
    ok('espelho do MLB100: nome e preco vindos do anuncio',
      !!fone && fone.nome === 'Fone de Ouvido NEXUS' && Number(fone.precoVenda) === 199.9,
      JSON.stringify(fone));
    const impProd = await prisma.importacao.findFirst({
      where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE_PRODUTOS' },
      orderBy: { createdAt: 'desc' },
    });
    ok('Importacao MERCADO_LIVRE_PRODUTOS gravada (IMPORTADO, origem INTEGRACAO, qtdTotal 2)',
      !!impProd && impProd.status === 'IMPORTADO' && impProd.origem === 'INTEGRACAO' && impProd.qtdTotal === 2,
      JSON.stringify(impProd));
    const auditoria = await prisma.auditoria.findFirst({
      where: { empresaId: empresa.id, acao: 'SINCRONIZAR', entidade: 'IntegracaoExterno' },
    });
    ok('Auditoria SINCRONIZAR registrada', !!auditoria, JSON.stringify(auditoria));
    const cadastroDepois = await prisma.integracaoExterno.findUnique({ where: { id: cadastro.id } });
    ok('ultimoSyncEm atualizado na conta', !!cadastroDepois?.ultimoSyncEm, String(cadastroDepois?.ultimoSyncEm));

    const sync2 = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/sync/produtos', headers: H, payload: {},
    });
    const r2 = sync2.json();
    ok('segunda execucao: 0 criados e 2 semAlteracao',
      r2.criados === 0 && r2.semAlteracao === 2 && r2.erros === 0, JSON.stringify(r2));
    ok('produtos nao duplicados na segunda execucao',
      (await prisma.produto.count({ where: { empresaId: empresa.id, sku: { startsWith: 'ML-' } } })) === 2);

    console.log('\n3. ETAPA 3 (estoque): precedencia NEXUS -> ML, com baixa de venda idempotente');
    // Produto MANUAL com sku comum nao participa do push (so espelhos ML-*).
    const manual = await prisma.produto.create({
      data: { empresaId: empresa.id, nome: 'Produto Manual', sku: `MANUAL-${SUFIXO}`, precoVenda: 10, custo: 4, status: 'ATIVO', origem: 'MANUAL' },
    });
    // Saldo interno 9 vs ML 5 -> deve haver PUT com 9.
    await prisma.estoque.upsert({
      where: { filialId_produtoId: { filialId: filial.id, produtoId: fone!.id } },
      update: { quantidade: 9 },
      create: { empresaId: empresa.id, filialId: filial.id, produtoId: fone!.id, quantidade: 9 },
    });
    const est1 = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/sync/estoque', headers: H, payload: { filialId: filial.id },
    });
    ok('POST sync/estoque -> 200', est1.statusCode === 200, `status=${est1.statusCode} body=${est1.body.slice(0, 200)}`);
    const e1 = est1.json();
    ok('2 espelhos avaliados (produto manual fica de fora)', e1.anunciosAvaliados === 2, JSON.stringify(e1.relatorio?.map((r: any) => r.anuncioId)));
    ok('1 atualizado (MLB100) e MLB200 pulado por semLinhaDeEstoque',
      e1.atualizados === 1 && e1.relatorio.some((r: any) => r.anuncioId === 'MLB200' && r.acao === 'semLinhaDeEstoque'),
      JSON.stringify(e1.relatorio));
    ok('PUT /items/MLB100 enviado com o saldo interno 9',
      estado.puts.some((p) => p.id === 'MLB100' && p.body?.available_quantity === 9),
      JSON.stringify(estado.puts));
    const estoqueDepois = await prisma.estoque.findUnique({
      where: { filialId_produtoId: { filialId: filial.id, produtoId: fone!.id } },
    });
    ok('saldo interno NUNCA baixado pelo sync (segue 9)', Number(estoqueDepois?.quantidade) === 9,
      `quantidade=${estoqueDepois?.quantidade}`);
    ok('estoque do produto manual intocado',
      (await prisma.estoque.findUnique({ where: { filialId_produtoId: { filialId: filial.id, produtoId: manual.id } } })) === null);

    const est2 = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/sync/estoque', headers: H, payload: { filialId: filial.id },
    });
    const e2 = est2.json();
    ok('2a execucao: ML ja com 9 -> semAlteracao e NENHUM novo PUT',
      e2.atualizados === 0 && e2.semAlteracao === 1 && estado.puts.filter((p) => p.id === 'MLB100').length === 1,
      JSON.stringify({ atualizados: e2.atualizados, semAlteracao: e2.semAlteracao, puts: estado.puts.length }));
    const impEst = await prisma.importacao.findFirst({
      where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE_ESTOQUE' }, orderBy: { createdAt: 'desc' },
    });
    ok('Importacao MERCADO_LIVRE_ESTOQUE registrada', !!impEst && impEst.status === 'IMPORTADO', JSON.stringify(impEst));

    console.log('\n4. ETAPA 4 (pedidos): idempotencia dupla, moeda recusada, sem efeito lateral');
    const ped1 = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/sync/pedidos', headers: H, payload: { filialId: filial.id, limite: 10 },
    });
    ok('POST sync/pedidos -> 200', ped1.statusCode === 200, `status=${ped1.statusCode} body=${ped1.body.slice(0, 200)}`);
    const p1 = ped1.json();
    ok('2 pedidos consultados; 1 importado; USD pulado; 0 erros',
      p1.pedidosConsultados === 2 && p1.importados === 1 && p1.pulados === 1 && p1.erros === 0,
      JSON.stringify({ consultados: p1.pedidosConsultados, importados: p1.importados, pulados: p1.pulados, erros: p1.erros }));
    const vendas = await prisma.venda.findMany({ where: { empresaId: empresa.id } });
    ok('exatamente 1 venda (pedido USD nunca vira venda)', vendas.length === 1, `vendas=${vendas.length}`);
    const v = vendas[0];
    const itensVenda = await prisma.vendaItem.findMany({ where: { vendaId: v.id } });
    ok('venda: origem INTEGRACAO, chave ml:order:9001, 1 item de 199.90 do espelho',
      v.origem === 'INTEGRACAO' && v.idempotencyKey === 'ml:order:9001'
      && itensVenda.length === 1 && Number(itensVenda[0].total) === 199.9
      && itensVenda[0].produtoId === fone!.id,
      JSON.stringify({ origem: v.origem, chave: v.idempotencyKey, itens: itensVenda.length }));
    ok('status FINALIZADA com evidencia (paid + payment approved)', v.status === 'FINALIZADA', `status=${v.status}`);
    ok('formaPagamento CARTAO_CREDITO mapeada do ML', v.formaPagamento === 'CARTAO_CREDITO', String(v.formaPagamento));
    ok('dataOperacional preenchida pelo fuso da filial', !!v.dataOperacional, String(v.dataOperacional));
    const pagamentos = await prisma.vendaPagamento.findMany({ where: { vendaId: v.id } });
    ok('pagamento HISTORICO com referencia do ML (sem efeito de caixa aqui)',
      pagamentos.length === 1 && pagamentos[0].referencia === 'ML order 9001',
      JSON.stringify(pagamentos));
    const idem = await prisma.idempotencyKey.findFirst({ where: { empresaId: empresa.id, key: 'ml:order:9001' } });
    ok('IdempotencyKey ml:order:9001 CONFIRMADA apontando para a venda',
      idem?.status === 'CONFIRMADA' && idem?.vendaId === v.id, JSON.stringify(idem));
    const estoqueAposPedido = await prisma.estoque.findUnique({
      where: { filialId_produtoId: { filialId: filial.id, produtoId: fone!.id } },
    });
    ok('pedido ativo baixa uma unidade e registra movimento de estoque integrado',
      Number(estoqueAposPedido?.quantidade) === 8
      && await prisma.estoqueMovimentacao.count({ where: { empresaId: empresa.id, documento: 'ml:order:9001', tipo: 'VENDA' } }) === 1,
      `saldo=${estoqueAposPedido?.quantidade} movimentos=${await prisma.estoqueMovimentacao.count({ where: { empresaId: empresa.id, documento: 'ml:order:9001', tipo: 'VENDA' } })}`);

    const ped2 = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/sync/pedidos', headers: H, payload: { filialId: filial.id, limite: 10 },
    });
    const p2 = ped2.json();
    ok('2a execucao: 1 duplicada, 0 importados', p2.duplicados === 1 && p2.importados === 0,
      JSON.stringify({ duplicados: p2.duplicados, importados: p2.importados }));
    ok('2a execucao NUNCA cria segunda venda',
      (await prisma.venda.count({ where: { empresaId: empresa.id } })) === 1);
    const impPed = await prisma.importacao.findFirst({
      where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE_PEDIDOS' }, orderBy: { createdAt: 'desc' },
    });
    ok('Importacao MERCADO_LIVRE_PEDIDOS registrada', !!impPed && impPed.status === 'IMPORTADO', JSON.stringify(impPed));

    console.log('\n5. Webhook publico: ponteiro NAO confiavel, dedupe, tenant via user_id');
    const whInvalido = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: { qualquer: 'coisa' },
    });
    ok('webhook sem campos obrigatorios -> 200 com processada:false (ML nao reenvia em loop)',
      whInvalido.statusCode === 200 && whInvalido.json().processada === false,
      `status=${whInvalido.statusCode} body=${whInvalido.body.slice(0, 160)}`);
    const whTopic = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/webhook',
      payload: { resource: '/orders/1', user_id: ACCOUNT_ID, topic: 'messages' },
    });
    ok('topic fora do escopo -> 200 processada:false com motivo',
      whTopic.statusCode === 200 && whTopic.json().processada === false
      && String(whTopic.json().motivo).includes('escopo'),
      whTopic.body.slice(0, 200));
    const whTenant = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/webhook',
      payload: { resource: '/orders/9001', user_id: 999999, topic: 'orders_v2' },
    });
    ok('user_id sem conta conectada -> aceito sem fila e motivo de ignorado',
      whTenant.statusCode === 200 && whTenant.json().accepted === true
      && whTenant.json().queued === false && String(whTenant.json().ignored).includes('conectada'),
      whTenant.body.slice(0, 200));

    // Pedido 9001 ja importado: o webhook RE-CONSULTA o recurso com token
    // proprio e conclui como duplicada (nunca confia no corpo notificado).
    const antes9001 = qtdChamadas('GET', '/orders/9001');
    const payload9001 = { resource: '/orders/9001', user_id: ACCOUNT_ID, topic: 'orders_v2', application_id: 1, attempts: 1 };
    const wh9001 = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: payload9001,
    });
    await executarFilaNotificacoesML();
    ok('webhook orders_v2 de conta valida -> 200 apos enfileirar',
      wh9001.statusCode === 200 && wh9001.json().queued === true,
      `status=${wh9001.statusCode} body=${wh9001.body.slice(0, 200)}`);
    ok('re-consulta autenticada do recurso no servidor simulado',
      qtdChamadas('GET', '/orders/9001') === antes9001 + 1,
      `antes=${antes9001} depois=${qtdChamadas('GET', '/orders/9001')}`);
    const wh9001b = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: payload9001,
    });
    await executarFilaNotificacoesML();
    ok('mesma notificacao de novo -> dedupe persistente (sem nova re-consulta)',
      wh9001b.json().queued === true && wh9001b.json().duplicate === true && String(wh9001b.json().motivo).includes('duplicada')
      && qtdChamadas('GET', '/orders/9001') === antes9001 + 1,
      wh9001b.body.slice(0, 200));
    ok('dedupe nao criou segunda venda',
      (await prisma.venda.count({ where: { empresaId: empresa.id } })) === 1);

    // Pedido novo chega PRIMEIRO pelo webhook (9003 so existe a partir daqui).
    estado.pedidos['9003'] = {
      id: '9003', status: 'paid', currency_id: 'BRL', total_amount: 99.8,
      date_created: '2026-01-20T12:00:00.000-04:00',
      order_items: [{ item: { id: 'MLB100', title: 'Fone de Ouvido NEXUS' }, quantity: 2, unit_price: 49.9, currency_id: 'BRL' }],
      payments: [{ status: 'approved', payment_type_id: 'pix', transaction_amount: 99.8 }],
    };
    const wh9003 = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/webhook',
      payload: { resource: '/orders/9003', user_id: ACCOUNT_ID, topic: 'orders' },
    });
    await executarFilaNotificacoesML();
    const fila9003 = await prisma.notificacaoMercadoLivre.findFirst({
      where: { empresaId: empresa.id, resource: '/orders/9003' },
      select: { status: true, tentativas: true, ultimoErro: true },
    });
    ok('webhook de pedido novo -> persistido e consumido pelo worker',
      wh9003.json().queued === true,
      wh9003.body.slice(0, 200));
    const venda9003 = await prisma.venda.findFirst({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9003' } });
    ok('venda do 9003 criada pelo webhook (forma PIX, status FINALIZADA)',
      !!venda9003 && venda9003.formaPagamento === 'PIX' && venda9003.status === 'FINALIZADA',
      JSON.stringify({ venda: venda9003 && { forma: venda9003.formaPagamento, status: venda9003.status }, fila: fila9003 }));

    // Tópico de anúncio: re-consulta o item e espelha sem duplicar produto.
    const antesItem = qtdChamadas('GET', '/items/MLB100');
    const whItem = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/webhook',
      payload: { resource: '/items/MLB100', user_id: ACCOUNT_ID, topic: 'items' },
    });
    await executarFilaNotificacoesML();
    const filaItem = await prisma.notificacaoMercadoLivre.findFirst({
      where: { empresaId: empresa.id, resource: '/items/MLB100' },
      select: { status: true, tentativas: true, ultimoErro: true },
    });
    ok('webhook items -> re-consulta do anuncio e processada:true',
      whItem.json().queued === true && qtdChamadas('GET', '/items/MLB100') === antesItem + 1,
      JSON.stringify({ body: whItem.json(), antesItem, depois: qtdChamadas('GET', '/items/MLB100'), fila: filaItem }));
    ok('espelho MLB100 nao duplicado pelo webhook',
      (await prisma.produto.count({ where: { empresaId: empresa.id, sku: 'ML-MLB100' } })) === 1);

    console.log('\n5b. Webhook: eventos sem assinatura, dedupe por ID e atualizacoes do mesmo pedido');
    const payload9004 = { resource: '/orders/9004', user_id: ACCOUNT_ID, topic: 'orders_v2', application_id: 1, id: 'evt-9004-a', attempts: 1 };
    estado.pedidos['9004'] = {
      id: '9004', status: 'paid', currency_id: 'BRL', total_amount: 50,
      date_created: '2026-01-21T09:00:00.000-04:00',
      order_items: [{ item: { id: 'MLB100', title: 'Fone de Ouvido NEXUS' }, quantity: 1, unit_price: 50, currency_id: 'BRL' }],
      payments: [{ status: 'approved', payment_type_id: 'pix', transaction_amount: 50 }],
    };
    const antes9004 = qtdChamadas('GET', '/orders/9004');
    const evento9004 = await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: payload9004 });
    await executarFilaNotificacoesML();
    ok('webhook oficial sem x-signature -> 200 com reconsulta autenticada',
      evento9004.statusCode === 200 && evento9004.json().queued === true && qtdChamadas('GET', '/orders/9004') === antes9004 + 1,
      `status=${evento9004.statusCode} novasChamadas=${qtdChamadas('GET', '/orders/9004') - antes9004}`);
    const repetido9004 = await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: payload9004 });
    await executarFilaNotificacoesML();
    ok('reenvio do mesmo ID de evento nao consulta nem processa novamente',
      repetido9004.statusCode === 200 && String(repetido9004.json().motivo).includes('duplicada') && qtdChamadas('GET', '/orders/9004') === antes9004 + 1);
    const atualizacao9004 = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: { ...payload9004, id: 'evt-9004-b' },
    });
    await executarFilaNotificacoesML();
    ok('novo evento do mesmo pedido e reconsultado sem criar outra venda',
      atualizacao9004.statusCode === 200 && qtdChamadas('GET', '/orders/9004') === antes9004 + 2
      && (await prisma.venda.count({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9004' } })) === 1,
      JSON.stringify({ status: atualizacao9004.statusCode, antes: antes9004, depois: qtdChamadas('GET', '/orders/9004'),
        vendas: await prisma.venda.count({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9004' } }), body: atualizacao9004.json() }));

    console.log('\n5c. Fila duravel: pagamentos, ignorados, retry, lease e concorrencia');
    const chamadasPagamentoAntes = qtdChamadas('GET', '/collections/5004');
    const pagamento5004 = await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: {
      resource: '/collections/5004', user_id: ACCOUNT_ID, topic: 'payments', id: 'evt-payment-5004',
    } });
    await executarFilaNotificacoesML();
    ok('pagamento /collections/{id} enfileirado, reconsultado e ligado ao pedido',
      pagamento5004.json().queued === true
      && qtdChamadas('GET', '/collections/5004') === chamadasPagamentoAntes + 1
      && (await prisma.notificacaoMercadoLivre.findFirst({ where: { empresaId: empresa.id, eventKey: { contains: 'evt-payment-5004' } } }))?.status === 'PROCESSADO');
    ok('notificacao de pagamento nao duplica a venda do pedido 9004',
      (await prisma.venda.count({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9004' } })) === 1);

    const ignorado = await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: {
      resource: '/orders/9007', user_id: ACCOUNT_ID, topic: 'orders', id: 'evt-ignore-9007',
    } });
    await prisma.integracaoExterno.update({ where: { id: cadastro.id }, data: { status: 'REAUTENTICAR' } });
    const resultadoIgnorado = await executarFilaNotificacoesML();
    const linhaIgnorada = await prisma.notificacaoMercadoLivre.findFirst({ where: { empresaId: empresa.id, eventKey: { contains: 'evt-ignore-9007' } } });
    await prisma.integracaoExterno.update({ where: { id: cadastro.id }, data: { status: 'CONECTADO' } });
    ok('conta desconectada entre aceite e consumo termina como IGNORADO, sem chamar API',
      ignorado.json().queued === true && linhaIgnorada?.status === 'IGNORADO'
      && !!linhaIgnorada.finalizadaEm && resultadoIgnorado.ignoradas === 1
      && qtdChamadas('GET', '/orders/9007') === 0);

    estado.itens['MLB101'] = { id: 'MLB101', status: 'active' };
    const permanente = await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: {
      resource: '/items/MLB101', user_id: ACCOUNT_ID, topic: 'items', id: 'evt-invalid-item-101',
    } });
    const resultadoPermanente = await executarFilaNotificacoesML();
    const linhaPermanente = await prisma.notificacaoMercadoLivre.findFirst({ where: { empresaId: empresa.id, eventKey: { contains: 'evt-invalid-item-101' } } });
    ok('anuncio sem dados necessarios termina em FALHA_PERMANENTE com diagnostico',
      permanente.json().queued === true && linhaPermanente?.status === 'FALHA_PERMANENTE'
      && !!linhaPermanente.finalizadaEm && !!linhaPermanente.ultimoErro && resultadoPermanente.falhasPermanentes === 1,
      JSON.stringify({ resposta: permanente.json(), status: linhaPermanente?.status,
        finalizadaEm: linhaPermanente?.finalizadaEm, ultimoErro: linhaPermanente?.ultimoErro, resultadoPermanente }));

    estado.pedidos['9006'] = {
      id: '9006', status: 'paid', currency_id: 'BRL', total_amount: 20,
      date_created: '2026-02-10T10:00:00.000-04:00',
      order_items: [{ item: { id: 'MLB100', title: 'Fone de Ouvido NEXUS' }, quantity: 1, unit_price: 20, currency_id: 'BRL' }],
      payments: [{ status: 'approved', payment_type_id: 'pix', transaction_amount: 20 }],
    };
    estado.falhaPersistente = 'GET /orders/9006';
    const retentavel = await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: {
      resource: '/orders/9006', user_id: ACCOUNT_ID, topic: 'orders', id: 'evt-retry-9006',
    } });
    const resultadoRetry = await executarFilaNotificacoesML();
    let linhaRetry = await prisma.notificacaoMercadoLivre.findFirst({ where: { empresaId: empresa.id, eventKey: { contains: 'evt-retry-9006' } } });
    ok('falha 5xx fica AGUARDANDO com proxima tentativa e erro persistidos',
      retentavel.json().queued === true && linhaRetry?.status === 'AGUARDANDO'
      && linhaRetry.tentativas === 1 && linhaRetry.proximaExecucaoEm > new Date()
      && resultadoRetry.retentativas === 1 && !!linhaRetry.ultimoErro);
    estado.falhaPersistente = null;
    await prisma.notificacaoMercadoLivre.update({ where: { id: linhaRetry!.id }, data: { proximaExecucaoEm: new Date(Date.now() - 1000) } });
    const resultadoRetryOk = await executarFilaNotificacoesML();
    linhaRetry = await prisma.notificacaoMercadoLivre.findUnique({ where: { id: linhaRetry!.id } });
    ok('retry apos falha conclui uma venda e uma baixa de estoque apenas',
      resultadoRetryOk.processadas === 1 && linhaRetry?.status === 'PROCESSADO'
      && (await prisma.venda.count({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9006' } })) === 1
      && (await prisma.estoqueMovimentacao.count({ where: { empresaId: empresa.id, documento: 'ml:order:9006', tipo: 'VENDA' } })) === 1,
      JSON.stringify({ resultadoRetryOk, status: linhaRetry?.status, tentativas: linhaRetry?.tentativas,
        venda: await prisma.venda.count({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9006' } }),
        movimento: await prisma.estoqueMovimentacao.count({ where: { empresaId: empresa.id, documento: 'ml:order:9006', tipo: 'VENDA' } }) }));

    estado.pedidos['9010'] = { ...estado.pedidos['9006'], id: '9010', date_created: '2026-02-11T10:00:00.000-04:00' };
    estado.falhaPersistente = 'GET /orders/9010';
    await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: {
      resource: '/orders/9010', user_id: ACCOUNT_ID, topic: 'orders', id: 'evt-retry-limit-9010',
    } });
    let eventoLimite = await prisma.notificacaoMercadoLivre.findFirst({ where: { empresaId: empresa.id, eventKey: { contains: 'evt-retry-limit-9010' } } });
    for (let i = 0; i < 8; i++) {
      await prisma.notificacaoMercadoLivre.update({ where: { id: eventoLimite!.id }, data: { proximaExecucaoEm: new Date(Date.now() - 1000) } });
      await executarFilaNotificacoesML();
      eventoLimite = await prisma.notificacaoMercadoLivre.findUnique({ where: { id: eventoLimite!.id } });
    }
    estado.falhaPersistente = null;
    ok('falha transitória persistente atinge limite finito e vira FALHA_PERMANENTE',
      eventoLimite?.status === 'FALHA_PERMANENTE' && eventoLimite.tentativas === 8
      && !!eventoLimite.finalizadaEm && (await prisma.venda.count({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9010' } })) === 0,
      JSON.stringify({ status: eventoLimite?.status, tentativas: eventoLimite?.tentativas,
        finalizadaEm: eventoLimite?.finalizadaEm, venda: await prisma.venda.count({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9010' } }) }));

    estado.pedidos['9008'] = { ...estado.pedidos['9006'], id: '9008', date_created: '2026-02-12T10:00:00.000-04:00' };
    await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: {
      resource: '/orders/9008', user_id: ACCOUNT_ID, topic: 'orders', id: 'evt-lease-9008',
    } });
    const eventoLease = await prisma.notificacaoMercadoLivre.findFirst({ where: { empresaId: empresa.id, eventKey: { contains: 'evt-lease-9008' } } });
    await prisma.notificacaoMercadoLivre.update({ where: { id: eventoLease!.id }, data: { status: 'EXECUTANDO', leaseExpiraEm: new Date(Date.now() - 1000) } });
    const resultadoLease = await executarFilaNotificacoesML();
    const leaseRecuperado = await prisma.notificacaoMercadoLivre.findUnique({ where: { id: eventoLease!.id } });
    ok('lease expirado e recuperado termina com os efeitos do pedido aplicados uma vez',
      resultadoLease.recuperadas === 1 && leaseRecuperado?.status === 'PROCESSADO'
      && (await prisma.venda.count({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9008' } })) === 1
      && (await prisma.estoqueMovimentacao.count({ where: { empresaId: empresa.id, documento: 'ml:order:9008', tipo: 'VENDA' } })) === 1);

    estado.pedidos['9009'] = { ...estado.pedidos['9006'], id: '9009', date_created: '2026-02-13T10:00:00.000-04:00' };
    await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/webhook', payload: {
      resource: '/orders/9009', user_id: ACCOUNT_ID, topic: 'orders', id: 'evt-concurrent-9009',
    } });
    const antesConcConsumidor = qtdChamadas('GET', '/orders/9009');
    await Promise.all([executarFilaNotificacoesML(), executarFilaNotificacoesML()]);
    ok('consumidores concorrentes reivindicam uma vez e nao duplicam venda/estoque',
      qtdChamadas('GET', '/orders/9009') === antesConcConsumidor + 1
      && (await prisma.venda.count({ where: { empresaId: empresa.id, idempotencyKey: 'ml:order:9009' } })) === 1
      && (await prisma.estoqueMovimentacao.count({ where: { empresaId: empresa.id, documento: 'ml:order:9009', tipo: 'VENDA' } })) === 1);
    console.log('\n6. API inacessivel: 502 declarado, nada inventado');
    await fecharServidor();
    const semRede = await app.inject({
      method: 'POST', url: '/integracoes/mercadolivre/sync/produtos', headers: H, payload: {},
    });
    ok('sync com servidor ML fora do ar -> 502 (falha de rede propagada)',
      semRede.statusCode === 502, `status=${semRede.statusCode} body=${semRede.body.slice(0, 160)}`);
    ok('falha de rede NAO cria produto novo',
      (await prisma.produto.count({ where: { empresaId: empresa.id, sku: { startsWith: 'ML-' } } })) === 2);
    const impErro = await prisma.importacao.findFirst({
      where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE_PRODUTOS', status: 'ERRO' },
      orderBy: { createdAt: 'desc' },
    });
    ok('falha de rede registrada como Importacao ERRO (visivel na Central, sem fingir sucesso)',
      !!impErro && impErro.qtdErro >= 1, JSON.stringify(impErro));
  } finally {
    await fecharServidor();
    for (const [chave, valor] of Object.entries(envAnterior)) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
    const todas = [empresa.id, empresaB.id];
    const vendasDasEmpresas = await prisma.venda.findMany({ where: { empresaId: { in: todas } }, select: { id: true } });
    const vendaIds = vendasDasEmpresas.map((x) => x.id);
    await prisma.notificacaoMercadoLivre.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.idempotencyKey.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.vendaPagamento.deleteMany({ where: { vendaId: { in: vendaIds } } });
    await prisma.vendaItem.deleteMany({ where: { vendaId: { in: vendaIds } } });
    await prisma.venda.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.auditoria.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.importacao.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.integracaoExterno.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.sincronizacaoTarefa.deleteMany({ where: { empresaId: { in: todas } } });
    // Movimentos têm FK restritiva para Produto e Filial; removê-los antes
    // desses cadastros evita que o teardown do teste deixe dados residuais.
    await prisma.estoqueMovimentacao.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.estoque.deleteMany({ where: { empresaId: { in: todas } } });
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

test('integração: sincronização Mercado Livre', async () => {
  await main();
});
