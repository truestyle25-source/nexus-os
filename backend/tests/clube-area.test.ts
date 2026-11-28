/**
 * NEXUS CLUB — Fase 5: área do cliente (API real + Postgres de teste).
 * Entrar/sair de clube (ligando ao cadastro da loja pelo CPF), autorizações por canal com versão
 * do texto, compras só da própria pessoa, isolamento entre clubes, baixar dados e excluir conta.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { hashSenha } from '../src/lib/auth.js';
import { encryptSecret } from '../src/lib/secrets.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { generateRandomValidCpf, formatCpf } from '../src/domain/cpf.js';
import { consumidorAuthRoutes } from '../src/modules/clube/consumidor-auth.routes.js';
import { areaClienteRoutes } from '../src/modules/clube/area-cliente.routes.js';
import { hashCpf } from '../src/modules/clube/clube-config.js';
import { TERMOS_OBRIGATORIOS_CADASTRO, termosVigentes } from '../src/modules/clube/consentimento.service.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;

test('NEXUS CLUB — área do cliente', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const chaves = ['NEXUS_CLUB_HABILITADO', 'NEXUS_CLUB_JWT_SECRET', 'NEXUS_CLUB_CPF_CHAVE', 'JWT_SECRET', 'RESEND_API_KEY'];
  const antes = Object.fromEntries(chaves.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { NEXUS_CLUB_HABILITADO: 'true', NEXUS_CLUB_JWT_SECRET: randomBytes(24).toString('hex'), NEXUS_CLUB_CPF_CHAVE: randomBytes(24).toString('hex'), JWT_SECRET: randomBytes(24).toString('hex') });
  delete process.env.RESEND_API_KEY;

  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.' });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.', detalhe: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: process.env.JWT_SECRET! });
  await registerAuthentication(app);
  await app.register(consumidorAuthRoutes);
  await app.register(areaClienteRoutes);
  await app.ready();
  const call = async (method: string, url: string, token?: string, payload?: any) => {
    const r = await app.inject({ method: method as any, url, payload, remoteAddress: ip(), headers: token ? { authorization: `Bearer ${token}` } : {} });
    let b: any; try { b = r.json(); } catch { b = r.body; }
    return { s: r.statusCode, b };
  };

  // Termos da plataforma (para a conta não cair em TERMOS_PENDENTES).
  for (const tipo of TERMOS_OBRIGATORIOS_CADASTRO) {
    const max = (await prisma.termoVersao.findFirst({ where: { tipo, empresaId: null }, orderBy: { versao: 'desc' } }))?.versao ?? 0;
    await prisma.termoVersao.create({ data: { tipo, versao: max + 1, texto: `Texto de teste ${tipo} ${SUF}` } });
  }
  const vigentes = await termosVigentes(TERMOS_OBRIGATORIOS_CADASTRO);

  const pessoa = async (nome: string) => {
    const cpf = generateRandomValidCpf();
    const email = `${nome.toLowerCase()}-${SUF}@teste.local`;
    const c = await prisma.contaConsumidor.create({ data: { nome, email, cpfHash: hashCpf(cpf), cpfCifrado: encryptSecret(cpf), senhaHash: await hashSenha('Senha12345'), status: 'ATIVA', emailVerificadoEm: new Date() } });
    await prisma.termoAceite.createMany({ data: vigentes.map((v) => ({ consumidorId: c.id, termoVersaoId: v.id })) });
    const r = await call('POST', '/club/auth/login', undefined, { login: email, senha: 'Senha12345' });
    assert.equal(r.s, 200, JSON.stringify(r.b));
    return { id: c.id, cpf, email, token: r.b.token as string };
  };
  const loja = async (nome: string, publico = true) => {
    const e = await prisma.empresa.create({ data: { nome: `${nome} ${SUF}`, cnpj: generateRandomValidCnpj() } });
    const f = await prisma.filial.create({ data: { empresaId: e.id, nome: 'Matriz', status: 'ATIVO' } });
    const c = await prisma.clubeConfig.create({ data: { empresaId: e.id, nome: `Clube ${nome} ${SUF}`, ativo: true, publico, beneficioPercentual: 5 } });
    const termo = await prisma.termoVersao.create({ data: { empresaId: e.id, tipo: 'AUTORIZACAO_MARKETING', versao: 1, texto: `Autorizo ofertas da ${nome} (teste).` } });
    return { empresa: e, filial: f, clube: c, termo };
  };

  const ana = await pessoa('Ana');
  const beto = await pessoa('Beto');
  const mercado = await loja('Mercado');
  const padaria = await loja('Padaria');
  const fechado = await loja('Fechado', false);
  // O mercado já tinha a Ana no cadastro (pelo CPF); a padaria tem o Beto duas vezes.
  const anaNoMercado = await prisma.cliente.create({ data: { empresaId: mercado.empresa.id, nome: 'Ana (cadastro da loja)', documento: ana.cpf } });
  await prisma.cliente.createMany({ data: [1, 2].map((i) => ({ empresaId: padaria.empresa.id, nome: `Beto ${i}`, documento: i === 1 ? beto.cpf : formatCpf(beto.cpf) })) });

  try {
    await t.test('encontrar loja: só clubes ativos e públicos', async () => {
      const r = await call('GET', `/club/lojas?busca=${SUF}`, ana.token);
      assert.equal(r.s, 200);
      const nomes = r.b.map((c: any) => c.nome);
      assert.ok(nomes.includes(mercado.clube.nome) && nomes.includes(padaria.clube.nome));
      assert.equal(nomes.includes(fechado.clube.nome), false, 'clube não público não aparece');
      assert.equal((await call('POST', `/club/clubes/${fechado.clube.id}/entrar`, ana.token)).s, 404);
    });

    await t.test('entrar liga ao cadastro que a loja já tem pelo CPF (sem duplicar)', async () => {
      const r = await call('POST', `/club/clubes/${mercado.clube.id}/entrar`, ana.token);
      assert.equal(r.s, 201, JSON.stringify(r.b)); assert.equal(r.b.status, 'ATIVO');
      const m = await prisma.membroClube.findUniqueOrThrow({ where: { empresaId_consumidorId: { empresaId: mercado.empresa.id, consumidorId: ana.id } } });
      assert.equal(m.clienteId, anaNoMercado.id);
      assert.equal(await prisma.cliente.count({ where: { empresaId: mercado.empresa.id, documento: ana.cpf } }), 1);
      assert.equal((await call('POST', `/club/clubes/${mercado.clube.id}/entrar`, ana.token)).s, 200, 'entrar de novo não duplica');
    });

    await t.test('sem cadastro na loja: cria cliente com origem NEXUS CLUB; com dois: a loja escolhe', async () => {
      assert.equal((await call('POST', `/club/clubes/${padaria.clube.id}/entrar`, ana.token)).b.status, 'ATIVO');
      const novo = await prisma.cliente.findFirstOrThrow({ where: { empresaId: padaria.empresa.id, documento: ana.cpf } });
      assert.equal(novo.origem, 'NEXUS_CLUB'); assert.equal(novo.email, ana.email);
      assert.equal((await call('POST', `/club/clubes/${padaria.clube.id}/entrar`, beto.token)).b.status, 'PENDENTE_VINCULO');
      const mb = await prisma.membroClube.findUniqueOrThrow({ where: { empresaId_consumidorId: { empresaId: padaria.empresa.id, consumidorId: beto.id } } });
      assert.equal(mb.clienteId, null, 'não escolhe sozinho entre dois cadastros');
    });

    await t.test('meus clubes e isolamento: Beto não vê o clube do mercado', async () => {
      const meus = await call('GET', '/club/clubes', ana.token);
      assert.deepEqual(meus.b.map((c: any) => c.id).sort(), [mercado.clube.id, padaria.clube.id].sort());
      assert.equal((await call('GET', `/club/clubes/${mercado.clube.id}`, beto.token)).s, 403, 'não participa → não vê detalhes');
      assert.equal((await call('GET', `/club/clubes/${mercado.clube.id}/compras`, beto.token)).s, 403);
      assert.equal((await call('GET', `/club/clubes/${fechado.clube.id}`, ana.token)).s, 404);
    });

    await t.test('autorizações: começam desligadas; autorizar exige a versão atual do texto', async () => {
      const d = await call('GET', `/club/clubes/${mercado.clube.id}`, ana.token);
      assert.equal(d.s, 200);
      assert.deepEqual(d.b.consentimentos.map((c: any) => c.autorizado), [false, false, false]);
      assert.equal(d.b.autorizacao.id, mercado.termo.id);
      assert.equal(d.b.clube.beneficioPercentual, 5);
      const url = `/club/clubes/${mercado.clube.id}/consentimentos/WHATSAPP`;
      assert.equal((await call('PUT', url, ana.token, { autorizar: true })).s, 409, 'sem a versão do texto');
      assert.equal((await call('PUT', url, ana.token, { autorizar: true, termoVersaoId: padaria.termo.id })).s, 409, 'texto de outra loja');
      const ok = await call('PUT', url, ana.token, { autorizar: true, termoVersaoId: mercado.termo.id });
      assert.equal(ok.s, 200); assert.equal(ok.b.autorizado, true);
      const d2 = await call('GET', `/club/clubes/${mercado.clube.id}`, ana.token);
      assert.deepEqual(d2.b.consentimentos.map((c: any) => [c.canal, c.autorizado]), [['WHATSAPP', true], ['EMAIL', false], ['APP', false]]);
      const p = await call('GET', `/club/clubes/${padaria.clube.id}`, ana.token);
      assert.equal(p.b.consentimentos[0].autorizado, false, 'autorizar no mercado não autoriza na padaria');
      assert.equal((await call('PUT', `/club/clubes/${padaria.clube.id}/consentimentos/WHATSAPP`, beto.token, { autorizar: true, termoVersaoId: padaria.termo.id })).s, 409, 'cadastro pendente não autoriza');
      const h = await call('GET', `/club/clubes/${mercado.clube.id}/consentimentos/historico`, ana.token);
      assert.equal(h.b[0].acao, 'CONCEDIDO'); assert.equal(h.b[0].versaoTexto, 1);
    });

    await t.test('compras: só as vendas ligadas a mim, nesta loja', async () => {
      const outro = await prisma.cliente.create({ data: { empresaId: mercado.empresa.id, nome: 'Outro cliente' } });
      const venda = (clienteId: string, total: number, status: 'FINALIZADA' | 'CANCELADA' = 'FINALIZADA') =>
        prisma.venda.create({ data: { empresaId: mercado.empresa.id, filialId: mercado.filial.id, clienteId, subtotal: total, total, status } });
      await venda(anaNoMercado.id, 86.4); await venda(anaNoMercado.id, 10, 'CANCELADA'); await venda(outro.id, 999);
      const r = await call('GET', `/club/clubes/${mercado.clube.id}/compras`, ana.token);
      assert.equal(r.s, 200); assert.deepEqual(r.b.map((v: any) => v.total), [86.4]);
      assert.equal(Object.keys(r.b[0]).sort().join(','), 'data,desconto,id,itens,total', 'nada de dado interno da loja');
      assert.deepEqual((await call('GET', `/club/clubes/${padaria.clube.id}/compras`, ana.token)).b, []);
    });

    await t.test('sair do clube revoga as autorizações daquele clube', async () => {
      assert.equal((await call('POST', `/club/clubes/${mercado.clube.id}/sair`, ana.token)).s, 200);
      const atual = await prisma.consentimentoAtual.findFirstOrThrow({ where: { empresaId: mercado.empresa.id, consumidorId: ana.id, canal: 'WHATSAPP' } });
      assert.equal(atual.situacao, 'REVOGADO');
      assert.equal((await call('GET', `/club/clubes/${mercado.clube.id}`, ana.token)).s, 403);
      assert.equal((await call('POST', `/club/clubes/${mercado.clube.id}/entrar`, ana.token)).b.status, 'ATIVO', 'pode voltar');
    });

    await t.test('baixar meus dados: conta, termos, clubes e autorizações (CPF completo, sem senha)', async () => {
      const r = await call('GET', '/club/eu/exportar', ana.token);
      assert.equal(r.s, 200);
      assert.equal(r.b.conta.cpf, formatCpf(ana.cpf));
      assert.ok(r.b.termosAceitos.length >= 2 && r.b.clubes.length === 2 && r.b.autorizacoes.length >= 2);
      const txt = JSON.stringify(r.b);
      assert.ok(!txt.includes('senhaHash') && !txt.includes('cpfHash') && !txt.includes('Beto'), 'sem segredos nem dados de outra pessoa');
    });

    await t.test('excluir conta: exige senha; anonimiza, sai dos clubes e libera e-mail/CPF', async () => {
      assert.equal((await call('POST', '/club/eu/encerrar', ana.token, { senha: 'errada', confirmo: true })).s, 400);
      assert.equal((await call('POST', '/club/eu/encerrar', ana.token, { senha: 'Senha12345' })).s, 400, 'precisa confirmar');
      assert.equal((await call('POST', '/club/eu/encerrar', ana.token, { senha: 'Senha12345', confirmo: true })).s, 200);
      const c = await prisma.contaConsumidor.findUniqueOrThrow({ where: { id: ana.id } });
      assert.equal(c.status, 'ENCERRADA'); assert.notEqual(c.email, ana.email); assert.equal(c.cpfCifrado, ''); assert.notEqual(c.cpfHash, hashCpf(ana.cpf));
      assert.equal(await prisma.membroClube.count({ where: { consumidorId: ana.id, status: { not: 'SAIU' } } }), 0);
      assert.equal((await call('GET', '/club/eu', ana.token)).s, 401, 'sessão encerrada');
      assert.equal((await call('POST', '/club/auth/login', undefined, { login: ana.email, senha: 'Senha12345' })).s, 401);
      assert.equal(await prisma.cliente.count({ where: { id: anaNoMercado.id } }), 1, 'o cadastro da loja (e as vendas) continuam com a loja');
    });
  } finally {
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await app.close();
  }
});
