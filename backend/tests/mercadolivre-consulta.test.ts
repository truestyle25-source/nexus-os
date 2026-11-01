/**
 * TESTE DE INTEGRAÇÃO — CONSULTA DE DADOS DO USUÁRIO NO MERCADO LIVRE
 * ===================================================================
 * Testa os 9 endpoints de consulta da API oficial do ML implementados nas
 * rotas GET/PUT /integracoes/mercadolivre/users/*, /applications/* e
 * /missed_feeds.
 *
 * Tudo roda contra um servidor SIMULADO local da API do ML (createServer)
 * apontado por MERCADOLIVRE_API_URL — sem rede, sem credenciais reais.
 */
import { test } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { integracoesRoutes } from '../src/modules/integracoes/integracoes.routes.js';
import { encryptSecret } from '../src/lib/secrets.js';
import { registerAuthentication } from '../src/middlewares/auth.js';


const SEGREDO = 'segredo-teste-ml-consulta';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface EstadoML {
  chamadas: Array<{ metodo: string; caminho: string }>;
  /** Corpos JSON recebidos pelo mock no PUT — auditam o que chega ao ML. */
  corposPut: any[];
  usuario: any;
  enderecos: any[];
  pagamentos: any[];
  aplicacao: any;
  marcas: any[];
  pacotes: any[];
  notificacoesPerdidas: any[];
  falhaRede: boolean;
  falhaStatus: { caminho: string; status: number } | null;
  missedFeedsMalformado: boolean;
}

async function criarServidorML(estado: EstadoML): Promise<import('node:http').Server> {
  const servidor = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const caminho = url.pathname;
    const metodo = req.method ?? 'GET';
    const query = url.searchParams;
    estado.chamadas.push({ metodo, caminho });

    if (estado.falhaRede) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Falha de rede simulada' }));
      return;
    }

    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'token_invalido', message: 'Access token inválido' }));
      return;
    }

    if (estado.falhaStatus && estado.falhaStatus.caminho === caminho) {
      res.writeHead(estado.falhaStatus.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'falha_simulada', message: `Falha em ${caminho}` }));
      return;
    }

    if (caminho.startsWith('/users/') && caminho.split('/').length === 3 && metodo === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(estado.usuario));
      return;
    }
    if (caminho === '/users/me' && metodo === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(estado.usuario));
      return;
    }
    if (caminho.startsWith('/users/') && metodo === 'PUT') {
      let corpo = '';
      for await (const pedaco of req) corpo += pedaco;
      const atualizacao = corpo ? JSON.parse(corpo) : {};
      // Registra o corpo RECEBIDO para os testes auditarem o que chega ao ML.
      estado.corposPut.push(atualizacao);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...estado.usuario, ...atualizacao, updated: true }));
      return;
    }
    if (caminho.startsWith('/users/') && caminho.endsWith('/addresses') && metodo === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(estado.enderecos));
      return;
    }
    if (caminho.startsWith('/users/') && caminho.endsWith('/accepted_payment_methods') && metodo === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(estado.pagamentos));
      return;
    }
    if (caminho.startsWith('/applications/') && metodo === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(estado.aplicacao));
      return;
    }
    if (caminho.startsWith('/users/') && caminho.endsWith('/brands') && metodo === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(estado.marcas));
      return;
    }
    if (caminho.startsWith('/users/') && caminho.endsWith('/classifieds_promotion_packs') && metodo === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(estado.pacotes));
      return;
    }
    if (caminho === '/missed_feeds' && metodo === 'GET') {
      const userId = query.get('user_id');
      // Simula resposta inesperada da API: objeto sem a propriedade `messages`.
      if (estado.missedFeedsMalformado) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ unexpected_shape: true }));
        return;
      }
      let resultado = estado.notificacoesPerdidas;
      if (userId) {
        resultado = estado.notificacoesPerdidas.filter((n: any) => String(n.user_id) === userId);
      }
      // Formato oficial do ML: { messages: [...] }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messages: resultado }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'nao_encontrado', message: `Caminho não simulado: ${caminho}` }));
  });

  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  return servidor;
}

async function main() {
try {
  const estado: EstadoML = {
    chamadas: [],
    corposPut: [],
    usuario: {
      id: '123456789',
      nickname: 'loja_teste',
      email: 'teste@exemplo.com.br',
      first_name: 'Samuel',
      last_name: 'Duarte',
      phone: { area_code: '43', number: '99999-9999' },
      address: { address: 'Rua Exemplo, 123', city: 'Londrina', state: 'BR-PR', zip_code: '86010-000' },
      company: { corporate_name: 'Minha Empresa LTDA', brand_name: 'TrueStyle' },
      site_id: 'MLB',
      permalink: 'http://perfil.mercadolivre.com.br/loja_teste',
      registration_date: '2020-01-01T00:00:00.000Z',
    },
    enderecos: [
      { id: '1', address: 'Rua Exemplo, 123', city: 'Londrina', state: 'BR-PR', zip_code: '86010-000' },
    ],
    pagamentos: [
      { id: 'credit_card', description: 'Cartão de crédito', type: 'credit_card' },
      { id: 'boleto', description: 'Boleto bancário', type: 'ticket' },
    ],
    aplicacao: {
      id: 'APP_ID_123',
      name: 'Minha App',
      client_id: 'client_id_123',
      redirect_uri: ['http://localhost:3333/callback'],
    },
    marcas: [
      { id: 'marca_1', name: 'TrueStyle' },
    ],
    pacotes: [
      { id: 'pack_1', description: 'Pacote de destaque' },
    ],
    notificacoesPerdidas: [
      { id: 'notif_1', user_id: '123456789', topic: 'orders', resource: '/orders/999' },
      { id: 'notif_2', user_id: '123456789', topic: 'items', resource: '/items/MLB123' },
      { id: 'notif_3', user_id: '999999999', topic: 'orders', resource: '/orders/888' },
    ],
    falhaRede: false,
    falhaStatus: null,
    missedFeedsMalformado: false,
  };

  const servidorML = await criarServidorML(estado);
  const enderecoML = servidorML.address() as import('net').AddressInfo;
  const API_URL = `http://127.0.0.1:${enderecoML.port}`;

  const envAnterior: Record<string, string | undefined> = {};
  for (const k of ['MERCADOLIVRE_API_URL', 'MERCADOLIVRE_CLIENT_ID', 'MERCADOLIVRE_CLIENT_SECRET', 'MERCADOLIVRE_REDIRECT_URI']) {
    envAnterior[k] = process.env[k];
    if (k === 'MERCADOLIVRE_CLIENT_ID') process.env[k] = 'APP_ID_123';
    else if (k === 'MERCADOLIVRE_CLIENT_SECRET') process.env[k] = 'secret_123';
    else if (k === 'MERCADOLIVRE_REDIRECT_URI') process.env[k] = 'http://localhost:3333/callback';
    else process.env[k] = API_URL;
  }

  async function fecharServidor() {
    await new Promise<void>((resolve) => servidorML.close(() => resolve()));
  }

  const app = Fastify();
  await app.register(jwt, { secret: SEGREDO });
  registerAuthentication(app);
  await app.register(integracoesRoutes);

  const empresa = await prisma.empresa.create({
    data: { nome: `Empresa Teste Consulta ${SUFIXO}`, status: 'ATIVO' },
  });
  const empresaSemML = await prisma.empresa.create({
    data: { nome: `Empresa Sem ML ${SUFIXO}`, status: 'ATIVO' },
  });
  const usuario = await prisma.usuario.create({
    data: {
      nome: 'Usuário Teste',
      email: `usuario_${SUFIXO}@exemplo.com.br`,
      senhaHash: await hashSenha('senha12345'),
      empresaId: empresa.id,
      status: 'ATIVO',
    },
  });
  await prisma.permissao.create({
    data: { usuarioId: usuario.id, modulo: 'integracoes', acao: 'visualizar', permitido: true },
  });
  await prisma.permissao.create({
    data: { usuarioId: usuario.id, modulo: 'integracoes', acao: 'editar', permitido: true },
  });

  // Usuário da MESMA empresa SEM nenhuma linha de permissão: prova que o PUT
  // devolve 403. O token é assinado com `id` (formato de produção) para que a
  // checagem de permissão seja determinística.
  const usuarioSemPermissao = await prisma.usuario.create({
    data: {
      nome: 'Usuário Sem Permissão',
      email: `semperm_${SUFIXO}@exemplo.com.br`,
      senhaHash: await hashSenha('senha12345'),
      empresaId: empresa.id,
      status: 'ATIVO',
    },
  });

  const cadastro = await prisma.integracaoExterno.create({
    data: {
      empresaId: empresa.id,
      tipo: 'MERCADO_LIVRE',
      nome: 'ML Consulta Teste',
      status: 'CONECTADO',
      accountId: estado.usuario.id,
      accountName: estado.usuario.nickname,
      clientId: encryptSecret('cid_consulta'),
      clientSecret: encryptSecret('csec_consulta'),
      redirectUri: 'http://localhost:3333/integracoes/mercadolivre/callback',
      accessToken: encryptSecret('access_token_consulta'),
      refreshToken: encryptSecret('refresh_token_consulta'),
      tokenExpiry: new Date(Date.now() + 3600_000),
      scope: 'offline_access read',
    },
  });

  // Formato de produção (auth.routes.ts): { id, empresaId, email, jti }. A claim
  // `id` é OBRIGATÓRIA: desde a correção do fail-open, um token sem `id`
  // utilizável é rejeitado com 401 pelo permissaoMiddleware ANTES de consultar
  // o banco (antes um token com `sub` — como este teste usava — passava porque
  // o Prisma ignorava o filtro `usuarioId: undefined`).
  const token = app.jwt.sign({ id: usuario.id, email: usuario.email, empresaId: empresa.id });
  const H = { authorization: `Bearer ${token}` };

  console.log('\n1. GET /users/{userId} — dados da conta (sucesso)');
  {
    const r = await app.inject({ method: 'GET', url: `/integracoes/mercadolivre/users/${estado.usuario.id}`, headers: H });
    ok('status 200', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('retorna dados do usuário', body.ok === true && body.dados?.id === estado.usuario.id);
    ok('dados contêm nome', body.dados?.first_name === 'Samuel' && body.dados?.last_name === 'Duarte');
    ok('chamada feita ao ML', estado.chamadas.some((c) => c.caminho === `/users/${estado.usuario.id}` && c.metodo === 'GET'));
  }

  console.log('\n2. GET /users/{userId} — empresa sem conta conectada (400)');
  {
    const tokenB = app.jwt.sign({ id: usuario.id, email: usuario.email, empresaId: empresaSemML.id });
    const HB = { authorization: `Bearer ${tokenB}` };
    const r = await app.inject({ method: 'GET', url: `/integracoes/mercadolivre/users/${estado.usuario.id}`, headers: HB });
    ok('status 400 para conta não conectada', r.statusCode === 400, `status=${r.statusCode}`);
  }

  console.log('\n3. PUT /users/me — atualizar dados do usuário logado (sucesso)');
  {
    const r = await app.inject({
      method: 'PUT',
      url: '/integracoes/mercadolivre/users/me',
      headers: { ...H, 'content-type': 'application/json' },
      payload: { first_name: 'Samuel Atualizado', phone: { area_code: '43', number: '88888-8888' } },
    });
    ok('status 200', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('retorna dados atualizados', body.ok === true && body.dados?.first_name === 'Samuel Atualizado');
    ok('chamada PUT feita ao ML', estado.chamadas.some((c) => c.caminho === `/users/${estado.usuario.id}` && c.metodo === 'PUT'));
  }

  console.log('\n4. GET /users/me — dados do usuário logado pelo token (sucesso)');
  {
    const r = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre/users/me', headers: H });
    ok('status 200', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('retorna dados do usuário logado', body.ok === true && body.dados?.id === estado.usuario.id);
  }

  console.log('\n5. GET /users/{userId}/addresses — endereços (sucesso)');
  {
    const r = await app.inject({ method: 'GET', url: `/integracoes/mercadolivre/users/${estado.usuario.id}/addresses`, headers: H });
    ok('status 200', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('retorna lista de endereços', body.ok === true && Array.isArray(body.dados) && body.dados.length >= 1);
  }

  console.log('\n6. GET /users/{userId}/accepted_payment_methods — meios de pagamento (sucesso)');
  {
    const r = await app.inject({ method: 'GET', url: `/integracoes/mercadolivre/users/${estado.usuario.id}/accepted_payment_methods`, headers: H });
    ok('status 200', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('retorna lista de pagamentos', body.ok === true && Array.isArray(body.dados) && body.dados.length >= 1);
  }

  console.log('\n7. GET /applications/{applicationId} — dados da aplicação (sucesso)');
  {
    const r = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre/applications/APP_ID_123', headers: H });
    ok('status 200', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('retorna dados da aplicação', body.ok === true && body.dados?.id === 'APP_ID_123');
  }

  console.log('\n8. GET /users/{userId}/brands — marcas (sucesso)');
  {
    const r = await app.inject({ method: 'GET', url: `/integracoes/mercadolivre/users/${estado.usuario.id}/brands`, headers: H });
    ok('status 200', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('retorna lista de marcas', body.ok === true && Array.isArray(body.dados) && body.dados.length >= 1);
  }

  console.log('\n9. GET /users/{userId}/classifieds_promotion_packs — pacotes de promoção (sucesso)');
  {
    const r = await app.inject({ method: 'GET', url: `/integracoes/mercadolivre/users/${estado.usuario.id}/classifieds_promotion_packs`, headers: H });
    ok('status 200', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('retorna lista de pacotes', body.ok === true && Array.isArray(body.dados) && body.dados.length >= 1);
  }

  console.log('\n10. GET /missed_feeds — notificações perdidas (sucesso)');
  {
    const r = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre/missed_feeds?app_id=APP_ID_123', headers: H });
    ok('status 200', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('retorna notificações', body.ok === true && Array.isArray(body.dados) && body.dados.length >= 1);
  }

  console.log('\n10b. GET /missed_feeds com user_id — filtra por vendedor');
  {
    const r = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre/missed_feeds?app_id=APP_ID_123&user_id=999999999', headers: H });
    ok('status 200', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('filtra por user_id', body.ok === true && Array.isArray(body.dados) && body.dados.length === 1 && body.dados[0].user_id === '999999999');
  }

  console.log('\n10c. GET /missed_feeds com messages vazia');
  {
    estado.notificacoesPerdidas = [];
    const r = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre/missed_feeds?app_id=APP_ID_123', headers: H });
    ok('status 200 com messages vazia', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('retorna array vazio', body.ok === true && Array.isArray(body.dados) && body.dados.length === 0);
    estado.notificacoesPerdidas = [
      { id: 'notif_1', user_id: '123456789', topic: 'orders', resource: '/orders/999' },
      { id: 'notif_2', user_id: '123456789', topic: 'items', resource: '/items/MLB123' },
      { id: 'notif_3', user_id: '999999999', topic: 'orders', resource: '/orders/888' },
    ];
  }

  console.log('\n10d. GET /missed_feeds resposta sem messages (malformada)');
  {
    estado.missedFeedsMalformado = true;
    const r = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre/missed_feeds?app_id=APP_ID_123', headers: H });
    ok('resposta malformada nao e apresentada como sucesso', r.statusCode === 502, `status=${r.statusCode}`);
    const body = r.json();
    ok('resposta malformada retorna diagnostico sem lista vazia enganosa',
      body.ok !== true && /Resposta inválida/.test(body.message ?? body.error ?? ''), JSON.stringify(body));
    estado.missedFeedsMalformado = false;
  }

  console.log('\n10e. GET /missed_feeds preserva campos das notificações');
  {
    const r = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre/missed_feeds?app_id=APP_ID_123', headers: H });
    ok('status 200', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('preserva id', body.ok === true && body.dados?.[0]?.id === 'notif_1');
    ok('preserva user_id', body.ok === true && body.dados?.[0]?.user_id === '123456789');
    ok('preserva topic', body.ok === true && body.dados?.[0]?.topic === 'orders');
    ok('preserva resource', body.ok === true && body.dados?.[0]?.resource === '/orders/999');
    ok('todos os 3 itens preservados', body.ok === true && body.dados.length === 3);
  }

  console.log('\n11. Falha de status da API ML (500) → 502');
  {
    estado.falhaStatus = { caminho: `/users/${estado.usuario.id}`, status: 500 };
    const r = await app.inject({ method: 'GET', url: `/integracoes/mercadolivre/users/${estado.usuario.id}`, headers: H });
    ok('status 502', r.statusCode === 502, `status=${r.statusCode}`);
    estado.falhaStatus = null;
  }

  console.log('\n12. Falha de rede → 502');
  {
    estado.falhaRede = true;
    const r = await app.inject({ method: 'GET', url: `/integracoes/mercadolivre/users/${estado.usuario.id}`, headers: H });
    ok('status 502 na falha de rede', r.statusCode === 502, `status=${r.statusCode}`);
    estado.falhaRede = false;
  }

  // =========================================================================
  // Validação de corpo do PUT /users/me (Correção Pontual 1)
  // =========================================================================
  const urlPutMe = '/integracoes/mercadolivre/users/me';

  console.log('\n13. PUT /users/me — corpo válido com TODOS os campos permitidos');
  {
    const antes = estado.corposPut.length;
    const r = await app.inject({
      method: 'PUT',
      url: urlPutMe,
      headers: { ...H, 'content-type': 'application/json' },
      payload: {
        first_name: 'Samuel',
        last_name: 'Duarte',
        phone: { area_code: '43', number: '99999-9999' },
        address: { address: 'Rua Nova, 456', city: 'Londrina', state: 'BR-PR', zip_code: '86010-001' },
        company: { corporate_name: 'NEXUS LTDA', brand_name: 'NEXUS OS' },
      },
    });
    ok('status 200', r.statusCode === 200, `status=${r.statusCode}`);
    const body = r.json();
    ok('retorna ok e dados atualizados', body.ok === true && body.dados?.updated === true);
    const enviado = estado.corposPut[antes];
    ok(
      'todos os campos permitidos encaminhados ao ML',
      estado.corposPut.length === antes + 1 &&
        enviado?.first_name === 'Samuel' &&
        enviado?.last_name === 'Duarte' &&
        enviado?.phone?.area_code === '43' &&
        enviado?.address?.city === 'Londrina' &&
        enviado?.company?.brand_name === 'NEXUS OS',
      JSON.stringify(enviado),
    );
  }

  console.log('\n14. PUT /users/me — corpo vazio (contrato: atualização parcial)');
  {
    const antes = estado.corposPut.length;
    const r = await app.inject({
      method: 'PUT',
      url: urlPutMe,
      headers: { ...H, 'content-type': 'application/json' },
      payload: {},
    });
    ok('status 200 com corpo vazio', r.statusCode === 200, `status=${r.statusCode}`);
    ok(
      'chamada PUT feita com objeto vazio',
      estado.corposPut.length === antes + 1 && Object.keys(estado.corposPut[antes] ?? {}).length === 0,
      `recebidos=${JSON.stringify(estado.corposPut[antes])}`,
    );
    // Sem payload algum (body nulo) — o handler normaliza para {} e aceita.
    const rSemPayload = await app.inject({ method: 'PUT', url: urlPutMe, headers: { ...H } });
    ok('status 200 sem payload', rSemPayload.statusCode === 200, `status=${rSemPayload.statusCode}`);
  }

  console.log('\n15. PUT /users/me — tipos inválidos → 400 sem chamar o ML');
  {
    const antes = estado.corposPut.length;
    const r1 = await app.inject({
      method: 'PUT', url: urlPutMe,
      headers: { ...H, 'content-type': 'application/json' },
      payload: { first_name: 123 },
    });
    const r2 = await app.inject({
      method: 'PUT', url: urlPutMe,
      headers: { ...H, 'content-type': 'application/json' },
      payload: { phone: { area_code: 43 } },
    });
    const r3 = await app.inject({
      method: 'PUT', url: urlPutMe,
      headers: { ...H, 'content-type': 'application/json' },
      payload: { address: 'Rua Sem Formato' },
    });
    ok('first_name numérico → 400', r1.statusCode === 400, `status=${r1.statusCode}`);
    ok('phone.area_code numérico → 400', r2.statusCode === 400, `status=${r2.statusCode}`);
    ok('address string (esperado objeto) → 400', r3.statusCode === 400, `status=${r3.statusCode}`);
    ok(
      'nenhuma chamada PUT ao ML em tipo inválido',
      estado.corposPut.length === antes,
      `chamadas extras=${estado.corposPut.length - antes}`,
    );
  }

  console.log('\n16. PUT /users/me — campos extras (id, empresaId) → 400 sem chamar o ML');
  {
    const antes = estado.corposPut.length;
    const r1 = await app.inject({
      method: 'PUT', url: urlPutMe,
      headers: { ...H, 'content-type': 'application/json' },
      payload: { first_name: 'Samuel', id: '123456789', empresaId: empresa.id },
    });
    const r2 = await app.inject({
      method: 'PUT', url: urlPutMe,
      headers: { ...H, 'content-type': 'application/json' },
      payload: { empresaId: 'outra-empresa' },
    });
    ok('400 com id e empresaId', r1.statusCode === 400, `status=${r1.statusCode}`);
    ok('400 só com empresaId', r2.statusCode === 400, `status=${r2.statusCode}`);
    ok(
      'nenhuma chamada PUT ao ML com campos extras',
      estado.corposPut.length === antes,
      `chamadas extras=${estado.corposPut.length - antes}`,
    );
    const msg = String(r1.json().message ?? r1.json().error ?? '');
    ok('mensagem de validação cita os campos permitidos', msg.includes('first_name'), msg);
  }

  console.log('\n17. PUT /users/me — garantia: nada fora da allowlist chega ao cliente ML');
  {
    const permitidas = ['first_name', 'last_name', 'phone', 'address', 'company'];
    const inesperadas: string[] = [];
    for (const corpo of estado.corposPut) {
      for (const chave of Object.keys(corpo ?? {})) {
        if (!permitidas.includes(chave)) inesperadas.push(chave);
      }
    }
    ok(
      'todos os corpos PUT só contêm chaves da allowlist',
      inesperadas.length === 0,
      inesperadas.join(','),
    );
    const comIdentidade = estado.corposPut.filter((c) => c && ('id' in c || 'empresaId' in c));
    ok('nenhum corpo contém id ou empresaId', comIdentidade.length === 0, JSON.stringify(comIdentidade));
    ok('houve corpos PUT auditados', estado.corposPut.length > 0, `corpos=${estado.corposPut.length}`);
  }

  console.log('\n18. PUT /users/me — sem token de autenticação → 401');
  {
    const antes = estado.corposPut.length;
    const r = await app.inject({
      method: 'PUT', url: urlPutMe,
      headers: { 'content-type': 'application/json' },
      payload: { first_name: 'Invasor' },
    });
    ok('status 401 sem token', r.statusCode === 401, `status=${r.statusCode}`);
    ok('nenhuma chamada PUT ao ML em 401', estado.corposPut.length === antes);
  }

  console.log('\n19. PUT /users/me — usuário sem permissão editar → 403');
  {
    const antes = estado.corposPut.length;
    const tokenSem = app.jwt.sign({
      id: usuarioSemPermissao.id,
      email: usuarioSemPermissao.email,
      empresaId: empresa.id,
    });
    const r = await app.inject({
      method: 'PUT', url: urlPutMe,
      headers: { authorization: `Bearer ${tokenSem}`, 'content-type': 'application/json' },
      payload: { first_name: 'Sem Permissão' },
    });
    ok('status 403 sem permissão editar', r.statusCode === 403, `status=${r.statusCode}`);
    ok('nenhuma chamada PUT ao ML em 403', estado.corposPut.length === antes);
  }

  console.log('\n20. PUT /users/me — falha 500 da API ML → 502 (tratamento de erros preservado)');
  {
    estado.falhaStatus = { caminho: `/users/${estado.usuario.id}`, status: 500 };
    const r = await app.inject({
      method: 'PUT', url: urlPutMe,
      headers: { ...H, 'content-type': 'application/json' },
      payload: { first_name: 'Samuel' },
    });
    ok('status 502 na falha 500 do ML', r.statusCode === 502, `status=${r.statusCode}`);
    estado.falhaStatus = null;
  }

  try {
    await fecharServidor();
    for (const [chave, valor] of Object.entries(envAnterior)) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
    const ids = [usuario.id, usuarioSemPermissao.id];
    await prisma.idempotencyKey.deleteMany({ where: { empresaId: { in: [empresa.id, empresaSemML.id] } } });
    await prisma.integracaoExterno.deleteMany({ where: { empresaId: { in: [empresa.id, empresaSemML.id] } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: [empresa.id, empresaSemML.id] } } });
    await app.close();
    await prisma.$disconnect();
  } catch (e) {
    console.error('Erro na limpeza:', e);
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
  } catch (err) {
    console.error('ERRO NO TESTE:', err);
    process.exitCode = 1;
  }
}

test('integração: consulta de dados do usuário no Mercado Livre (9 endpoints)', async () => {
  await main();
});
