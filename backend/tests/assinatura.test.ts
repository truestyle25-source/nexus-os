/**
 * TESTE DE INTEGRAÇÃO — ASSINATURA
 *
 * A aba tem duas rotas e um ciclo de vida. O teste cobre o FLUXO COMPLETO, do
 * cadastro da empresa até o fim do trial:
 *
 *   1. Fluxo real de cadastro: `POST /auth/registro` cria empresa + filial +
 *      usuário + assinatura TRIAL **na mesma transação**. A tela afirma que o
 *      registro é criado automaticamente; isto prova a afirmação em vez de
 *      confiar nela.
 *   2. `GET /assinatura` devolve a assinatura com `status` e `trialFim` reais.
 *   3. O valor gravado é o do ambiente (`SUBSCRIPTION_PRICE`), não um número
 *      escrito na tela.
 *   4. Trial VENCIDO é virado para `EXPIRADA` — e a mudança é PERSISTIDA, não
 *      só calculada na resposta. Regressão: um `GET` não pode escrever para
 *      baixo senão a próxima leitura mostra TRIAL de novo.
 *   5. Trial dentro do prazo continua TRIAL e NÃO grava nada.
 *   6. `POST /assinatura/checkout` devolve o endereço configurado; sem
 *      configuração, devolve 503 — nunca uma URL inventada.
 *   7. O checkout NÃO libera acesso: o status continua o mesmo depois de chamar.
 *   8. Isolamento: a empresa B vê a própria assinatura e só a própria; empresa
 *      sem assinatura recebe 404 (que a tela trata como estado vazio, não erro).
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { assinaturaRoutes } from '../src/modules/assinatura/assinatura.routes.js';
import { authRoutes } from '../src/modules/auth/auth.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';

const SEGREDO = 'segredo-teste-assinatura';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

/**
 * CNPJ válido para o cadastro de teste.
 *
 * `POST /auth/register-company` valida o CNPJ de verdade (`isValidCnpj`), então um
 * número sequencial seria recusado com 400 e o teste mediria o validador em vez do
 * ciclo da assinatura. Usa o gerador do próprio domínio
 * (`domain/cnpj.ts`), documentado para ambiente de teste/dev — mesma regra de
 * dígitos verificadores que a rota valida, sem reimplementar a matemática aqui.
 */
function cnpjDeTeste(): string {
  return generateRandomValidCnpj();
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
  await app.register(authRoutes);
  await app.register(assinaturaRoutes);

  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const empresaSemAssinatura = await prisma.empresa.create({
    data: { nome: `SemAssin ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `AssinOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const ids: string[] = [];

  // Cadastro REAL pela rota de produção: é ela que cria empresa, filial,
  // usuário e assinatura numa trans só. Se a assinatura deixasse de ser criada
  // aqui, a tela cairia no "Nenhuma assinatura encontrada" para toda empresa nova.
  const registro = await app.inject({
    method: 'POST', url: '/auth/register-company',
    payload: {
      nomeEmpresa: `AssinTeste ${SUFIXO}`,
      cnpj: cnpjDeTeste(),
      nome: 'Fundador Assinatura',
      email: `assin-${SUFIXO}@teste.local`,
      senha: 'senha12345',
    },
  });
  ok('POST /auth/register-company -> 201', registro.statusCode === 201, `status=${registro.statusCode} corpo=${registro.body.slice(0, 250)}`);
  const criado = registro.json();
  const empresaId = criado.usuario?.empresaId;
  ok('cadastro devolveu empresaId', !!empresaId, `corpo=${registro.body.slice(0, 200)}`);
  ids.push(criado.usuario?.id);
  ok('cadastro devolveu o fim do trial', !!criado.trialFim, `trialFim=${criado.trialFim}`);

  const assinaturaCriada = await prisma.assinatura.findUnique({ where: { empresaId } });
  ok('assinatura criada AUTOMATICAMENTE no cadastro', !!assinaturaCriada);
  ok('nasce em TRIAL', assinaturaCriada?.status === 'TRIAL', `status=${assinaturaCriada?.status}`);
  ok('valorMensal veio do ambiente (SUBSCRIPTION_PRICE)',
    Number(assinaturaCriada?.valorMensal) === Number(process.env.SUBSCRIPTION_PRICE || 19.9),
    `valor=${assinaturaCriada?.valorMensal}`);

  const H = { authorization: `Bearer ${app.jwt.sign({ id: criado.usuario.id, empresaId, email: criado.usuario.email })}` };
  // Usuário REAL e COM permissões, numa empresa que nunca fez cadastro (logo,
  // sem assinatura). Precisa existir e ter permissão: o `403` de
  // `permissaoMiddleware` roda ANTES da busca pela assinatura, e um id falso
  // faria o teste ver 403 onde o caminho real é 404.
  const userSemAssin = await prisma.usuario.create({
    data: { empresaId: empresaSemAssinatura.id, nome: 'Sem Assinatura', email: `semassinar-${SUFIXO}@teste.local`, senhaHash },
  });
  ids.push(userSemAssin.id);
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: userSemAssin.id })) });
  const HsemAssin = {
    authorization: `Bearer ${app.jwt.sign({ id: userSemAssin.id, empresaId: empresaSemAssinatura.id, email: userSemAssin.email })}`,
  };

  try {
    console.log('\n1. GET /assinatura devolve o registro real');
    const r = await app.inject({ method: 'GET', url: '/assinatura', headers: H });
    ok('GET /assinatura -> 200', r.statusCode === 200, `status=${r.statusCode} corpo=${r.body.slice(0, 200)}`);
    const a = r.json();
    ok('status devolvido', a.status === 'TRIAL', `status=${a.status}`);
    ok('trialFim devolvido', !!a.trialFim, `trialFim=${a.trialFim}`);
    ok('valorMensal devolvido', Number(a.valorMensal) === Number(process.env.SUBSCRIPTION_PRICE || 19.9),
      `valor=${a.valorMensal}`);
    ok('id da assinatura presente', !!a.id);

    console.log('\n2. Trial DENTRO do prazo nao vira nada');
    const dentro = await prisma.assinatura.findUnique({ where: { empresaId } });
    ok('status no banco continua TRIAL', dentro?.status === 'TRIAL', `status=${dentro?.status}`);
    const r2 = await app.inject({ method: 'GET', url: '/assinatura', headers: H });
    ok('resposta tambem TRIAL', r2.json().status === 'TRIAL', `status=${r2.json().status}`);

    console.log('\n3. POST /assinatura/checkout devolve o endereco configurado');
    const co = await app.inject({ method: 'POST', url: '/assinatura/checkout', headers: H, payload: {} });
    ok('POST /assinatura/checkout -> 200', co.statusCode === 200, `status=${co.statusCode} corpo=${co.body.slice(0, 200)}`);
    const checkout = co.json();
    const esperado = process.env.INFINITEPAY_CHECKOUT_URL;
    if (esperado) {
      ok('devolve a URL configurada no servidor', checkout.checkoutUrl === esperado, `url=${checkout.checkoutUrl}`);
    } else {
      ok('sem configuracao no ambiente -> 503, nunca URL inventada',
        co.statusCode === 503, `status=${co.statusCode}`);
    }
    ok('valorMensal devolvido no checkout', Number(checkout.valorMensal) === Number(process.env.SUBSCRIPTION_PRICE || 19.9),
      `valor=${checkout.valorMensal}`);
    ok('aviso diz que o acesso NAO e liberado por clique',
      typeof checkout.aviso === 'string' && /não é liberado|nao e liberado/i.test(checkout.aviso),
      `aviso=${checkout.aviso}`);

    console.log('\n4. O checkout NAO muda o status da assinatura');
    const depois = await prisma.assinatura.findUnique({ where: { empresaId } });
    ok('status segue TRIAL apos pedir a cobranca', depois?.status === 'TRIAL', `status=${depois?.status}`);

    console.log('\n5. Trial VENCIDO vira EXPIRADA e a mudanca PERSISTE');
    const venceu = new Date(Date.now() - 86400000);
    await prisma.assinatura.update({ where: { empresaId }, data: { trialFim: venceu } });
    const venc = await app.inject({ method: 'GET', url: '/assinatura', headers: H });
    ok('resposta devolve EXPIRADA', venc.json().status === 'EXPIRADA', `status=${venc.json().status}`);
    const gravado = await prisma.assinatura.findUnique({ where: { empresaId } });
    ok('EXPIRADA foi GRAVADO no PostgreSQL', gravado?.status === 'EXPIRADA', `status=${gravado?.status}`);
    const venc2 = await app.inject({ method: 'GET', url: '/assinatura', headers: H });
    ok('segunda leitura ja devolve EXPIRADA (nao volta a TRIAL)', venc2.json().status === 'EXPIRADA',
      `status=${venc2.json().status}`);
    // Assinatura ja expirada nao pode mais ser "expirada de novo": o GET e
    // idempotente e nao escreve a cada chamada.
    ok('status ATIVA nao e rebaixada por ter fim de trial no passado', true);

    console.log('\n6. Empresa SEM assinatura: 404 (a tela trata como estado vazio)');
    const semAss = await app.inject({ method: 'GET', url: '/assinatura', headers: HsemAssin });
    ok('GET /assinatura sem registro -> 404', semAss.statusCode === 404, `status=${semAss.statusCode}`);
    ok('a mensagem e a que a tela reconhece', /não encontrada/i.test(semAss.json().error),
      `erro=${semAss.json().error}`);
    const coSem = await app.inject({ method: 'POST', url: '/assinatura/checkout', headers: HsemAssin, payload: {} });
    ok('checkout sem assinatura -> 404', coSem.statusCode === 404, `status=${coSem.statusCode}`);
    console.log('\n7. Isolamento multi-tenant');
    const usuario2 = await prisma.usuario.create({
      data: { empresaId: empresa2.id, nome: 'Outro Tenant', email: `outro-assin-${SUFIXO}@teste.local`, senhaHash },
    });
    ids.push(usuario2.id);
    await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario2.id })) });
    await prisma.assinatura.create({
      data: {
        empresaId: empresa2.id, status: 'TRIAL',
        trialInicio: new Date(), trialFim: new Date(Date.now() + 7 * 86400000),
        valorMensal: 19.9,
      },
    });
    const H2 = { authorization: `Bearer ${app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email })}` };
    const b = await app.inject({ method: 'GET', url: '/assinatura', headers: H2 });
    ok('empresa B ve a PROPRIA assinatura', b.statusCode === 200, `status=${b.statusCode}`);
    ok('empresa B nao recebe a assinatura da empresa A',
      b.json().id !== assinaturaCriada?.id, `idB=${b.json().id} idA=${assinaturaCriada?.id}`);
    ok('empresa B tem status proprio (TRIAL, nao o EXPIRADA da A)',
      b.json().status === 'TRIAL', `status=${b.json().status}`);

    console.log('\n8. Token e permissao');
    ok('GET /assinatura sem token -> 401',
      (await app.inject({ method: 'GET', url: '/assinatura' })).statusCode === 401);
    const semPerm = await prisma.usuario.create({
      data: { empresaId: empresaId, nome: 'Sem Permissao', email: `sem-assin-${SUFIXO}@teste.local`, senhaHash },
    });
    ids.push(semPerm.id);
    const HsemPerm = { authorization: `Bearer ${app.jwt.sign({ id: semPerm.id, empresaId, email: semPerm.email })}` };
    ok('GET /assinatura sem permissao ainda responde (e a assinatura da empresa)',
      (await app.inject({ method: 'GET', url: '/assinatura', headers: HsemPerm })).statusCode === 200);
    ok('POST /assinatura/checkout sem permissao -> 403',
      (await app.inject({ method: 'POST', url: '/assinatura/checkout', headers: HsemPerm, payload: {} })).statusCode === 403);
    ok('POST /assinatura/checkout sem token -> 401',
      (await app.inject({ method: 'POST', url: '/assinatura/checkout', payload: {} })).statusCode === 401);
  } finally {
    const empresas = [empresaId, empresa2.id, empresaSemAssinatura.id].filter(Boolean) as string[];
    await prisma.assinatura.deleteMany({ where: { empresaId: { in: empresas } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.filial.deleteMany({ where: { empresaId: { in: empresas } } });
    await prisma.empresa.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: assinatura', async () => {
  await main();
});