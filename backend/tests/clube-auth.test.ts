/**
 * NEXUS CLUB — Fase 3: cadastro e autenticação do consumidor (API real + Postgres de teste).
 *
 * E-mails capturados em memória (o `fetch` para api.resend.com é trocado só neste teste).
 * Critérios do plano: CPF inválido/duplicado recusado; senha nunca em texto; e-mail verificado;
 * recuperação funciona; limite de tentativas; aceite e consentimentos com versão e data.
 * Mais: as três travas entre o crachá do consumidor e o da empresa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { generateRandomValidCpf, formatCpf } from '../src/domain/cpf.js';
import { authRoutes } from '../src/modules/auth/auth.routes.js';
import { consumidorAuthRoutes } from '../src/modules/clube/consumidor-auth.routes.js';
import { lerCrachaConsumidor, emitirCrachaConsumidor } from '../src/modules/clube/token-consumidor.js';
import { estaAutorizado, registrarConsentimento } from '../src/modules/clube/consentimento.service.js';
import { comTenant } from '../src/lib/tenant-context.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const SEGREDO_EMPRESA = 'segredo-empresa-teste-clube-0123456789abcdef';
const SEGREDO_CLUBE = 'segredo-clube-teste-fase3-0123456789abcdefgh';
const CHAVE_CPF = 'chave-cpf-teste-fase3-0123456789abcdefghij';
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;

test('NEXUS CLUB desligado: /club responde 503 e /club/status diz que está desligado', async () => {
  const antes = process.env.NEXUS_CLUB_HABILITADO;
  delete process.env.NEXUS_CLUB_HABILITADO;
  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: SEGREDO_EMPRESA });
  await registerAuthentication(app);
  await app.register(consumidorAuthRoutes);
  await app.ready();
  try {
    assert.deepEqual((await app.inject({ method: 'GET', url: '/club/status' })).json(), { habilitado: false });
    const r = await app.inject({ method: 'POST', url: '/club/auth/login', payload: { login: 'a@b.com', senha: 'x' } });
    assert.equal(r.statusCode, 503);
  } finally {
    if (antes === undefined) delete process.env.NEXUS_CLUB_HABILITADO; else process.env.NEXUS_CLUB_HABILITADO = antes;
    await app.close();
  }
});

test('crachá do consumidor: assinatura, tipo, audiência e validade', () => {
  const antes = process.env.NEXUS_CLUB_JWT_SECRET;
  process.env.NEXUS_CLUB_JWT_SECRET = SEGREDO_CLUBE;
  try {
    const { token } = emitirCrachaConsumidor('conta-1', Date.now());
    assert.equal(lerCrachaConsumidor(token)?.sub, 'conta-1');
    assert.equal(lerCrachaConsumidor(token, Date.now() + 5 * 3600_000), null, 'vencido');
    const [c, p, s] = token.split('.');
    const adulterado = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: 'outra' })).toString('base64url');
    assert.equal(lerCrachaConsumidor(`${c}.${adulterado}.${s}`), null, 'carga adulterada');
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    assert.equal(lerCrachaConsumidor(`${none}.${p}.`), null, 'alg none');
    process.env.NEXUS_CLUB_JWT_SECRET = randomBytes(24).toString('hex'); // outro segredo qualquer
    assert.equal(lerCrachaConsumidor(token), null, 'segredo diferente');
  } finally {
    if (antes === undefined) delete process.env.NEXUS_CLUB_JWT_SECRET; else process.env.NEXUS_CLUB_JWT_SECRET = antes;
  }
});

test('NEXUS CLUB — cadastro e autenticação do consumidor', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const envAntes = Object.fromEntries(['NEXUS_CLUB_HABILITADO', 'NEXUS_CLUB_JWT_SECRET', 'NEXUS_CLUB_CPF_CHAVE', 'RESEND_API_KEY', 'JWT_SECRET'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { NEXUS_CLUB_HABILITADO: 'true', NEXUS_CLUB_JWT_SECRET: SEGREDO_CLUBE, NEXUS_CLUB_CPF_CHAVE: CHAVE_CPF, RESEND_API_KEY: 're_teste_local', JWT_SECRET: SEGREDO_EMPRESA });

  const emails: Array<{ para: string; assunto: string; texto: string }> = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (u: any, init: any) => {
    if (String(u).startsWith('https://api.resend.com/')) {
      const b = JSON.parse(String(init?.body));
      emails.push({ para: b.to[0], assunto: b.subject, texto: b.text });
      return new Response(JSON.stringify({ id: `msg-${emails.length}` }), { status: 200 });
    }
    return fetchOriginal(u, init);
  }) as typeof fetch;
  const tokenDoEmail = (para: string, assunto: RegExp) => {
    const e = [...emails].reverse().find((x) => x.para === para && assunto.test(x.assunto));
    return e?.texto.match(/token=([a-f0-9]+)/)?.[1] ?? null;
  };

  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: error.issues?.[0]?.message ?? 'Dados inválidos.' });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.', detalhe: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: SEGREDO_EMPRESA });
  await registerAuthentication(app);
  await app.register(authRoutes);
  await app.register(consumidorAuthRoutes);
  await app.ready();
  const call = async (method: string, url: string, payload?: any, token?: string) => {
    const r = await app.inject({ method: method as any, url, payload, remoteAddress: ip(), headers: token ? { authorization: `Bearer ${token}` } : {} });
    let b: any; try { b = r.json(); } catch { b = r.body; }
    return { s: r.statusCode, b };
  };

  // Termos da plataforma publicados (textos de teste; em produção vêm do responsável jurídico).
  const ultima = async (tipo: 'TERMOS_USO' | 'POLITICA_PRIVACIDADE') => (await prisma.termoVersao.findFirst({ where: { tipo, empresaId: null }, orderBy: { versao: 'desc' } }))?.versao ?? 0;
  await prisma.termoVersao.create({ data: { tipo: 'TERMOS_USO', versao: (await ultima('TERMOS_USO')) + 1, texto: `Termos de uso de teste ${SUF}` } });
  await prisma.termoVersao.create({ data: { tipo: 'POLITICA_PRIVACIDADE', versao: (await ultima('POLITICA_PRIVACIDADE')) + 1, texto: `Política de teste ${SUF}` } });
  const vig = await call('GET', '/club/termos/vigentes');
  const aceites: string[] = vig.b.termos.map((x: any) => x.id);

  const email = `maria-${SUF}@teste.local`;
  const cpf = generateRandomValidCpf();
  const senha = 'SenhaForte123';
  const cadastro = (over: Record<string, unknown> = {}) => call('POST', '/club/auth/cadastro', { nome: 'Maria Teste', email, cpf: formatCpf(cpf), senha, celular: '(11) 99999-0000', aceites, ...over });

  try {
    await t.test('status e termos vigentes', async () => {
      assert.deepEqual((await call('GET', '/club/status')).b, { habilitado: true });
      assert.equal(vig.s, 200); assert.equal(vig.b.completos, true); assert.equal(aceites.length, 2);
    });

    await t.test('cadastro recusa CPF inválido, senha fraca e falta de aceite', async () => {
      const r1 = await cadastro({ cpf: '111.111.111-11' });
      assert.equal(r1.s, 400); assert.match(r1.b.error, /CPF inválido/);
      const r2 = await cadastro({ senha: 'abcdefgh' });
      assert.equal(r2.s, 400); assert.match(r2.b.error, /letras e números/);
      const r3 = await cadastro({ aceites: [aceites[0]] });
      assert.equal(r3.s, 400); assert.match(r3.b.error, /aceitar os Termos/);
      assert.equal(await prisma.contaConsumidor.count({ where: { email } }), 0);
    });

    let contaId = '';
    await t.test('cadastro grava senha com hash, CPF cifrado, aceites com versão e data, e envia confirmação', async () => {
      const r = await cadastro();
      assert.equal(r.s, 202, JSON.stringify(r.b));
      const c = await prisma.contaConsumidor.findUniqueOrThrow({ where: { email } });
      contaId = c.id;
      assert.equal(c.status, 'PENDENTE_VERIFICACAO');
      assert.notEqual(c.senhaHash, senha); assert.ok(await bcrypt.compare(senha, c.senhaHash), 'senha com hash bcrypt');
      assert.ok(!c.cpfCifrado.includes(cpf), 'CPF não fica aberto');
      assert.equal(c.cpfHash, createHmac('sha256', CHAVE_CPF).update(cpf).digest('hex'));
      const ac = await prisma.termoAceite.findMany({ where: { consumidorId: c.id }, include: { termoVersao: true } });
      assert.deepEqual(ac.map((a) => a.termoVersaoId).sort(), [...aceites].sort());
      assert.ok(ac.every((a) => a.aceitoEm instanceof Date && a.ip && a.empresaId === null));
      assert.ok(tokenDoEmail(email, /Confirme seu e-mail/), 'e-mail de confirmação enviado');
      assert.ok(!JSON.stringify(r.b).includes(senha) && !JSON.stringify(r.b).includes(cpf));
    });

    await t.test('e-mail ou CPF repetido: mesma resposta, nenhuma conta nova, dono avisado', async () => {
      const n = emails.length;
      const r1 = await cadastro({ email: `outro-${SUF}@teste.local` }); // mesmo CPF
      const r2 = await cadastro({ cpf: generateRandomValidCpf() });     // mesmo e-mail
      assert.equal(r1.s, 202); assert.equal(r2.s, 202);
      assert.equal(r1.b.message, r2.b.message);
      assert.equal(await prisma.contaConsumidor.count({ where: { OR: [{ email }, { email: `outro-${SUF}@teste.local` }] } }), 1);
      assert.equal(emails.slice(n).filter((e) => e.para === email && /Tentativa de cadastro/.test(e.assunto)).length, 2);
    });

    await t.test('login antes de confirmar o e-mail: senha errada 401, certa 403 (confirme o e-mail)', async () => {
      assert.equal((await call('POST', '/club/auth/login', { login: email, senha: 'Errada123' })).s, 401);
      const r = await call('POST', '/club/auth/login', { login: email, senha });
      assert.equal(r.s, 403); assert.equal(r.b.codigo, 'EMAIL_NAO_VERIFICADO');
    });

    let token = '';
    await t.test('confirmação de e-mail (uso único) e login por e-mail e por CPF', async () => {
      const tk = tokenDoEmail(email, /Confirme seu e-mail/)!;
      assert.equal((await call('POST', '/club/auth/verificar-email', { token: tk })).s, 200);
      assert.equal((await call('POST', '/club/auth/verificar-email', { token: tk })).s, 400, 'link não serve duas vezes');
      assert.equal((await prisma.contaConsumidor.findUniqueOrThrow({ where: { id: contaId } })).status, 'ATIVA');
      const porCpf = await call('POST', '/club/auth/login', { login: formatCpf(cpf), senha });
      assert.equal(porCpf.s, 200, JSON.stringify(porCpf.b));
      const porEmail = await call('POST', '/club/auth/login', { login: email.toUpperCase(), senha });
      assert.equal(porEmail.s, 200); token = porEmail.b.token;
      assert.equal(porEmail.b.consumidor.id, contaId);
      const eu = await call('GET', '/club/eu', undefined, token);
      assert.equal(eu.s, 200); assert.equal(eu.b.email, email);
      assert.match(eu.b.cpf, /^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
      assert.equal('senhaHash' in eu.b || 'cpfHash' in eu.b || 'cpfCifrado' in eu.b, false);
    });

    await t.test('travas: crachá de cliente não entra na empresa e vice-versa', async () => {
      const empresa = await prisma.empresa.create({ data: { nome: `Empresa clube ${SUF}`, cnpj: generateRandomValidCnpj() } });
      const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
      const func = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: filial.id, nome: 'Func', email: `func-${SUF}@teste.local`, senhaHash: 'x' } });
      const tokEmpresa = app.jwt.sign({ id: func.id, empresaId: empresa.id, email: func.email, jti: `j-${SUF}`, emitidoEmMs: Date.now() } as any);
      assert.equal((await call('GET', '/auth/me', undefined, tokEmpresa)).s, 200, 'controle: funcionário entra na empresa');
      assert.equal((await call('GET', '/auth/me', undefined, token)).s, 401, 'crachá do cliente recusado na empresa');
      assert.equal((await call('GET', '/club/eu', undefined, tokEmpresa)).s, 401, 'crachá do funcionário recusado no clube');
      // Crachá "de cliente" forjado com o segredo da empresa: recusado nos dois lados.
      const forjado = app.jwt.sign({ id: func.id, empresaId: empresa.id, sub: contaId, tipo: 'CONSUMIDOR', aud: 'nexus-club', jti: `f-${SUF}`, emitidoEmMs: Date.now() } as any);
      assert.equal((await call('GET', '/auth/me', undefined, forjado)).s, 401, 'tipo CONSUMIDOR recusado na empresa (trava 2)');
      assert.equal((await call('GET', '/club/eu', undefined, forjado)).s, 401, 'segredo da empresa não vale no clube (trava 3)');
    });

    await t.test('dados pessoais: altera nome e telefone; e-mail não muda por aqui', async () => {
      const r = await call('PUT', '/club/eu', { nome: 'Maria Souza', whatsapp: '11988887777' }, token);
      assert.equal(r.s, 200); assert.equal(r.b.nome, 'Maria Souza');
      assert.equal((await call('PUT', '/club/eu', { email: `x-${SUF}@teste.local` }, token)).s, 400);
    });

    await t.test('sair encerra o crachá', async () => {
      const outro = (await call('POST', '/club/auth/login', { login: email, senha })).b.token;
      assert.equal((await call('POST', '/club/auth/logout', undefined, outro)).s, 200);
      assert.equal((await call('GET', '/club/eu', undefined, outro)).s, 401);
      assert.equal((await call('GET', '/club/eu', undefined, token)).s, 200, 'só aquela sessão foi encerrada');
    });

    await t.test('recuperar senha: resposta igual com ou sem conta; link troca a senha e encerra as sessões', async () => {
      const n = emails.length;
      const r1 = await call('POST', '/club/auth/recuperar-senha', { email: `ninguem-${SUF}@teste.local` });
      const r2 = await call('POST', '/club/auth/recuperar-senha', { email });
      assert.equal(r1.b.message, r2.b.message);
      assert.equal(emails.slice(n).length, 1, 'só quem tem conta recebe e-mail');
      const tk = tokenDoEmail(email, /Redefinir senha/)!;
      assert.equal((await call('POST', '/club/auth/redefinir-senha', { token: tk, novaSenha: 'curta' })).s, 400);
      assert.equal((await call('POST', '/club/auth/redefinir-senha', { token: tk, novaSenha: 'NovaSenha456' })).s, 200);
      assert.equal((await call('POST', '/club/auth/redefinir-senha', { token: tk, novaSenha: 'OutraSenha789' })).s, 400, 'link de uso único');
      assert.equal((await call('GET', '/club/eu', undefined, token)).s, 401, 'sessão antiga encerrada');
      assert.equal((await call('POST', '/club/auth/login', { login: email, senha })).s, 401, 'senha antiga não vale');
      const r = await call('POST', '/club/auth/login', { login: email, senha: 'NovaSenha456' });
      assert.equal(r.s, 200); token = r.b.token;
    });

    await t.test('trocar senha logado: exige a atual; crachá novo vale, o antigo não', async () => {
      assert.equal((await call('POST', '/club/eu/senha', { senhaAtual: 'Errada000', novaSenha: 'Trocada789' }, token)).s, 400);
      const r = await call('POST', '/club/eu/senha', { senhaAtual: 'NovaSenha456', novaSenha: 'Trocada789' }, token);
      assert.equal(r.s, 200);
      assert.equal((await call('GET', '/club/eu', undefined, token)).s, 401);
      assert.equal((await call('GET', '/club/eu', undefined, r.b.token)).s, 200);
      token = r.b.token;
    });

    await t.test('termos mudaram: pede novo aceite antes de continuar (troca da minuta provisória pela final)', async () => {
      assert.deepEqual((await call('GET', '/club/eu', undefined, token)).b.termosPendentes, [], 'sem pendência após o cadastro');
      const nova = await prisma.termoVersao.create({ data: { tipo: 'TERMOS_USO', versao: (await ultima('TERMOS_USO')) + 1, texto: `Termos de uso definitivos de teste ${SUF}` } });
      const eu = await call('GET', '/club/eu', undefined, token);
      assert.equal(eu.s, 200, 'os próprios dados continuam visíveis');
      assert.deepEqual(eu.b.termosPendentes.map((x: any) => x.id), [nova.id]);
      const bloq = await call('PUT', '/club/eu', { nome: 'Maria Bloqueada' }, token);
      assert.equal(bloq.s, 428); assert.equal(bloq.b.codigo, 'TERMOS_PENDENTES');
      const login = await call('POST', '/club/auth/login', { login: email, senha: 'Trocada789' });
      assert.deepEqual(login.b.termosPendentes.map((x: any) => x.id), [nova.id], 'o login avisa a pendência');
      assert.equal((await call('POST', '/club/termos/aceitar', { aceites: [] }, token)).s, 400);
      const ok = await call('POST', '/club/termos/aceitar', { aceites: [nova.id] }, token);
      assert.equal(ok.s, 200, JSON.stringify(ok.b));
      assert.equal((await call('PUT', '/club/eu', { nome: 'Maria Liberada' }, token)).s, 200, 'liberado depois do aceite');
      const ac = await prisma.termoAceite.findFirst({ where: { consumidorId: contaId, termoVersaoId: nova.id } });
      assert.ok(ac?.aceitoEm && ac.ip, 'novo aceite gravado com data e IP');
    });

    await t.test('limite de tentativas: a 11ª tentativa na mesma conta em 15 min é barrada, mesmo de IPs diferentes', async () => {
      const alvo = `alvo-${SUF}@teste.local`;
      const sts: number[] = [];
      for (let i = 0; i < 11; i++) sts.push((await call('POST', '/club/auth/login', { login: alvo, senha: 'Errada123' })).s);
      assert.deepEqual(sts, [...Array(10).fill(401), 429]);
    });

    await t.test('autorização de mensagens: exige carteirinha e versão do texto; histórico + situação atual', async () => {
      const empresa = await prisma.empresa.create({ data: { nome: `Loja clube ${SUF}`, cnpj: generateRandomValidCnpj() } });
      const termo = await prisma.termoVersao.create({ data: { empresaId: empresa.id, tipo: 'AUTORIZACAO_MARKETING', versao: 1, texto: 'Autorizo receber ofertas (teste).' } });
      const comLoja = <T>(fn: () => Promise<T>) => comTenant(empresa.id, fn);
      await assert.rejects(comLoja(() => registrarConsentimento({ empresaId: empresa.id, consumidorId: contaId, canal: 'WHATSAPP', acao: 'CONCEDIDO', origem: 'APP', termoVersaoId: termo.id })), /participa do clube/);
      await prisma.membroClube.create({ data: { empresaId: empresa.id, consumidorId: contaId } });
      await assert.rejects(comLoja(() => registrarConsentimento({ empresaId: empresa.id, consumidorId: contaId, canal: 'WHATSAPP', acao: 'CONCEDIDO', origem: 'APP' })), /versão do texto/);
      assert.equal(await comLoja(() => estaAutorizado(empresa.id, contaId, 'WHATSAPP')), false, 'começa desligado');
      await comLoja(() => registrarConsentimento({ empresaId: empresa.id, consumidorId: contaId, canal: 'WHATSAPP', acao: 'CONCEDIDO', origem: 'APP', termoVersaoId: termo.id, ip: '1.2.3.4' }));
      assert.equal(await comLoja(() => estaAutorizado(empresa.id, contaId, 'WHATSAPP')), true);
      assert.equal(await comLoja(() => estaAutorizado(empresa.id, contaId, 'EMAIL')), false, 'por canal');
      await comLoja(() => registrarConsentimento({ empresaId: empresa.id, consumidorId: contaId, canal: 'WHATSAPP', acao: 'REVOGADO', origem: 'WHATSAPP_SAIR' }));
      assert.equal(await comLoja(() => estaAutorizado(empresa.id, contaId, 'WHATSAPP')), false, 'revogar vale na hora');
      const hist = await prisma.consentimentoEvento.findMany({ where: { empresaId: empresa.id, consumidorId: contaId }, orderBy: { createdAt: 'asc' } });
      assert.deepEqual(hist.map((h) => h.acao), ['CONCEDIDO', 'REVOGADO']);
      assert.equal(hist[0].termoVersaoId, termo.id); assert.ok(hist[0].createdAt instanceof Date);
    });
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(envAntes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await app.close();
  }
});
