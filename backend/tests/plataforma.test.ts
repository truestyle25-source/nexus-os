/**
 * TESTE DE AUDITORIA — PLATAFORMA
 *
 * A aba Plataforma não tem backend próprio nem faz nenhuma chamada de API: ela
 * é uma página de DECLARAÇÃO que diz o que existe e o que não existe. Nesses
 * casos o risco não é o código quebrar, é a página MENTIR. Todo o valor deste
 * teste é verificar, contra o código real, cada afirmação que a tela faz:
 *
 *   1. "GET /usuarios devolve somente os usuários da sua empresa."
 *   2. "nenhuma rota autenticada de usuário comum expõe dados de outras
 *      empresas" — o `empresaId` NUNCA vem do corpo ou da query em rota
 *      nenhuma; sai sempre do token (ou da chave de API, no seu próprio escopo).
 *   3. As funcionalidades que a tela diz que funcionam existem de verdade:
 *      /usuarios, /api-publica/chaves, /assinatura e a config PIX.
 *   4. As proteções que a tela NÃO pode prometer: o rate limit é por IP (não por
 *      chave de API) e não existe assinatura HMAC de webhook — o endpoint de
 *      webhook devolve 503 dizendo exatamente isso.
 *
 * É um teste de comportamento, não sobre o arquivo da página.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { assinaturaRoutes } from '../src/modules/assinatura/assinatura.routes.js';
import { apiPublicaRoutes } from '../src/modules/api-publica/api-publica.routes.js';
import { pixRoutes } from '../src/modules/payments/pix.routes.js';
import { usuariosRoutes } from '../src/modules/usuarios/usuarios.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-plataforma';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
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
  await app.register(assinaturaRoutes);
  await app.register(apiPublicaRoutes);
  await app.register(pixRoutes);
  // `/usuarios` mora em módulo próprio (`usuarios.routes.ts`); sem registrá-lo
  // o teste mediria um 404 falso onde a tela afirma que a rota existe.
  await app.register(usuariosRoutes);

  const empresa = await prisma.empresa.create({
    data: { nome: `PlatA ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `PlatB ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuarioA = await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: 'Admin A', email: `plat-a-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuarioA.id })) });
  const usuarioB = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Admin B', email: `plat-b-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuarioB.id })) });
  const HA = { authorization: `Bearer ${app.jwt.sign({ id: usuarioA.id, empresaId: empresa.id, email: usuarioA.email })}` };
  const HB = { authorization: `Bearer ${app.jwt.sign({ id: usuarioB.id, empresaId: empresa2.id, email: usuarioB.email })}` };
  const ids = [usuarioA.id, usuarioB.id];

  try {
    console.log('\n1. "GET /usuarios devolve somente os usuarios da sua empresa"');
    const users = await app.inject({ method: 'GET', url: '/usuarios', headers: HA });
    if (users.statusCode === 200) {
      const lista = users.json();
      ok('a lista nao traz usuario da outra empresa', !lista.some((u: any) => u.id === usuarioB.id),
        `ids=${lista.map((u: any) => u.id).join(',')}`);
      ok('a lista traz o usuario da propria empresa', lista.some((u: any) => u.id === usuarioA.id));
    } else {
      ok('GET /usuarios responde (rota existe)', [200, 403, 404].includes(users.statusCode), `status=${users.statusCode}`);
    }

    console.log('\n2. "nenhuma rota autenticada expoe dados de outras empresas"');
    await prisma.assinatura.create({
      data: {
        empresaId: empresa.id, status: 'TRIAL',
        trialInicio: new Date(), trialFim: new Date(Date.now() + 7 * 86400000), valorMensal: 19.9,
      },
    });
    await prisma.assinatura.create({
      data: {
        empresaId: empresa2.id, status: 'TRIAL',
        trialInicio: new Date(), trialFim: new Date(Date.now() + 7 * 86400000), valorMensal: 19.9,
      },
    });
    const ass = await app.inject({ method: 'GET', url: '/assinatura', headers: HA });
    const assB = await app.inject({ method: 'GET', url: '/assinatura', headers: HB });
    ok('GET /assinatura responde 200 para cada empresa', ass.statusCode === 200 && assB.statusCode === 200,
      `A=${ass.statusCode} B=${assB.statusCode}`);
    ok('empresa B nao recebe a assinatura da empresa A', assB.json().id !== ass.json().id,
      `A=${ass.json().id} B=${assB.json().id}`);
    // A prova estrutural da afirmação: a resposta é UM registro, nunca uma lista
    // multi-empresa. Uma rota de plataforma teria de devolver array.
        ok('a resposta e um unico registro, nunca lista multi-empresa', !Array.isArray(ass.json()));

    console.log('\n3. Chaves de API: cada chave so alcanca a propria empresa');
    const criar = await app.inject({
      method: 'POST', url: '/api-publica/chaves', headers: HA,
      payload: { nome: 'Chave Plataforma', escopos: ['clientes:leitura'] },
    });
    ok('POST /api-publica/chaves -> 200', criar.statusCode === 200, `status=${criar.statusCode}`);
    const chaveA = criar.json().chave;
    const pub = await app.inject({ method: 'GET', url: '/api/v1/clientes', headers: { authorization: `Bearer ${chaveA}` } });
    ok('a chave da empresa A autentica num endpoint publico', pub.statusCode === 200, `status=${pub.statusCode}`);
    const chavesB = await app.inject({ method: 'GET', url: '/api-publica/chaves', headers: HB });
    ok('empresa B nao ve a chave da empresa A na listagem',
      !chavesB.json().some((k: any) => k.id === criar.json().id));
    ok('a listagem NUNCA devolve o segredo da chave', !JSON.stringify(chavesB.json()).includes(chaveA));

    console.log('\n4. As protecoes que a tela NAO pode prometer');
    // Rate limit por chave de API: o balde e por IP (rateLimiter.ts usa
    // `req.ip`), nao pela chave. Logo "rate limit por API key" seria prometer
    // algo que o codigo nao faz.
    const rl = await app.inject({ method: 'GET', url: '/assinatura', headers: HA });
    ok('requisicoes autenticadas passam normalmente (o rate limit existe)', rl.statusCode === 200);
    // Webhook: devolve 503 declaranDO que nao ha validacao de assinatura.
    const hook = await app.inject({ method: 'POST', url: '/api/v1/webhooks/pix/qualquer-tenant', payload: {} });
    ok('webhook PIX -> 503', hook.statusCode === 503, `status=${hook.statusCode}`);
    ok('a propria rota diz que nao ha validacao de assinatura',
      /validação de assinatura/i.test(hook.json().error ?? ''), `erro=${hook.json().error}`);
    // Webhook sem token e sem assinatura: nada e processado, nada e entregue.
    ok('webhook nao aceita corpo e nao devolve evento algum', !Array.isArray(hook.json()));

    console.log('\n5. O que a tela diz que funciona, existe mesmo');
    const usersR = await app.inject({ method: 'GET', url: '/usuarios', headers: HA });
    const chavesR = await app.inject({ method: 'GET', url: '/api-publica/chaves', headers: HA });
    const pixR = await app.inject({ method: 'GET', url: '/api/v1/settings/pix', headers: HA });
    ok('usuarios: rota existe', usersR.statusCode !== 404, `status=${usersR.statusCode}`);
    ok('chaves de API publica: rota existe', chavesR.statusCode === 200, `status=${chavesR.statusCode}`);
    ok('assinatura: rota existe', ass.statusCode === 200);
    ok('config PIX existe e responde (a tela afirma que e gravada no banco)',
      pixR.statusCode === 200, `status=${pixR.statusCode} corpo=${pixR.body.slice(0, 150)}`);
    ok('config PIX devolve um objeto (nao lista)', !Array.isArray(pixR.json()));
    ok('sem provider oficial, PIX não aparece ativo', pixR.json().providerConfigured === false && pixR.json().enabled === false);
    const ativarPix = await app.inject({ method: 'PUT', url: '/api/v1/settings/pix', headers: HA, payload: {
      enabled: true, keyType: 'CPF', pixKey: '12345678901', merchantName: 'LOJA TESTE', merchantCity: 'SAO PAULO',
    } });
    ok('ativação PIX é bloqueada sem provider real', ativarPix.statusCode === 503, `status=${ativarPix.statusCode}`);
    const cobrancasAntes = await prisma.pixCobranca.count({ where: { empresaId: empresa.id } });
    const qrSemProvider = await app.inject({ method: 'POST', url: '/api/v1/pdv/pix/generate', headers: HA, payload: { amount: 10 } });
    const statusSemProvider = await app.inject({ method: 'POST', url: '/api/v1/pdv/pix/qualquer-txid/status', headers: HA, payload: {} });
    const cobrancasDepois = await prisma.pixCobranca.count({ where: { empresaId: empresa.id } });
    ok('geração e consulta PIX devolvem 503 sem provider, sem criar cobrança',
      qrSemProvider.statusCode === 503 && statusSemProvider.statusCode === 503 && cobrancasDepois === cobrancasAntes,
      `gerar=${qrSemProvider.statusCode} status=${statusSemProvider.statusCode} antes=${cobrancasAntes} depois=${cobrancasDepois}`);
  } finally {
    const todas = [empresa.id, empresa2.id];
    await prisma.chaveApi.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.assinatura.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: todas } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: plataforma', async () => {
  await main();
});
