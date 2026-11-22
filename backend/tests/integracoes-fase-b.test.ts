/**
 * TESTE — Central de Integrações, Fase B: WooCommerce, Mercado Pago, WhatsApp Business e E-mail.
 *
 * Unidade: proteção SSRF (IPs privados, metadados de nuvem, IPv6, URL http/credenciais/porta),
 * telefone E.164, assinatura HMAC do webhook, desafio de verificação, validação de e-mail.
 * Integração (API real + Postgres de teste, sem mock de provedor):
 *  - WooCommerce: URL http e host interno recusados antes de qualquer conexão; host público sem
 *    WooCommerce → erro real (404/redirecionamento);
 *  - Mercado Pago: token fictício → 401 real da API do Mercado Pago;
 *  - WhatsApp: token fictício → recusa real da Meta (nunca CONECTADO); segredos cifrados;
 *    URL do webhook; verificação GET; POST sem/ com assinatura; mensagem recebida gravada uma
 *    vez só (idempotência); evento de outro número ignorado; status só avança; isolamento
 *    entre empresas; envio sem conexão validada recusado;
 *  - E-mail: servidor interno recusado (SSRF); envio sem conta conectada recusado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { centralIntegracoesRoutes, whatsappWebhookRoutes } from '../src/modules/integracoes/central/central.routes.js';
import { enderecoPrivado, exigirHostPublico, exigirUrlHttpsPublica } from '../src/lib/destino-seguro.js';
import { assinaturaValida, desafioValido, telefoneWhatsApp } from '../src/modules/integracoes/central/whatsapp.service.js';
import { validarEnvio } from '../src/modules/integracoes/central/email.service.js';
import { opcoesImap, opcoesSmtp } from '../src/modules/integracoes/central/adaptadores.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);
const SEGREDO = 'segredo-teste-integracoes-fase-b-0123456789';
const APP_SECRET = `app-secret-${SUF}`;
const VERIFY = `verify-${SUF}`;
const PHONE_ID = '109876543210987';

const recusa = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };

test('SSRF: endereços internos são recusados', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '224.0.0.1']) {
    assert.ok(enderecoPrivado(ip), ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.ok(!enderecoPrivado(ip), ip);
  for (const h of ['localhost', '127.0.0.1', '169.254.169.254', 'metadata.google.internal', 'servidor.local', '[::1]']) assert.ok(await recusa(exigirHostPublico(h)), h);
  assert.ok(await recusa(exigirUrlHttpsPublica('http://example.com')), 'http');
  assert.ok(await recusa(exigirUrlHttpsPublica('https://user:senha@example.com')), 'credencial na URL');
  assert.ok(await recusa(exigirUrlHttpsPublica('https://example.com:22')), 'porta');
  assert.ok(await recusa(exigirUrlHttpsPublica('https://10.0.0.1/loja')), 'IP privado');
  assert.ok(await recusa(exigirUrlHttpsPublica('nao é url')), 'inválida');
});

test('E-mail: conexão vai ao IP já validado, com o nome só no TLS (anti DNS rebinding)', async () => {
  assert.equal(await exigirHostPublico('8.8.8.8'), '8.8.8.8');
  const cfg = { smtpHost: 'smtp.exemplo.com', smtpPorta: '587', smtpSeguranca: 'STARTTLS', emailRemetente: 'a@exemplo.com', imapHost: 'imap.exemplo.com', imapPorta: '993' };
  const smtp: any = opcoesSmtp(cfg, { senha: 'x' }, '203.0.113.10');
  assert.equal(smtp.host, '203.0.113.10'); assert.equal(smtp.servername, 'smtp.exemplo.com'); assert.equal(smtp.tls.servername, 'smtp.exemplo.com');
  assert.equal(smtp.requireTLS, true); assert.equal(smtp.secure, false);
  const imap = opcoesImap(cfg, { senha: 'x' }, '203.0.113.11');
  assert.equal(imap.host, '203.0.113.11'); assert.equal(imap.servername, 'imap.exemplo.com'); assert.equal(imap.secure, true);
});

test('WhatsApp: telefone, assinatura e desafio', () => {
  assert.equal(telefoneWhatsApp('(11) 99999-8888'), '5511999998888');
  assert.equal(telefoneWhatsApp('+55 11 3333-4444'), '551133334444');
  assert.equal(telefoneWhatsApp('123'), null);
  const corpo = Buffer.from('{"a":1}');
  const assinatura = `sha256=${createHmac('sha256', 'segredo').update(corpo).digest('hex')}`;
  assert.ok(assinaturaValida(corpo, assinatura, 'segredo'));
  assert.ok(!assinaturaValida(Buffer.from('{"a":2}'), assinatura, 'segredo'), 'corpo alterado');
  assert.ok(!assinaturaValida(corpo, assinatura, 'outro'), 'segredo errado');
  assert.ok(!assinaturaValida(corpo, undefined, 'segredo'));
  assert.ok(!assinaturaValida(corpo, assinatura, undefined), 'sem App Secret salvo nada passa');
  assert.equal(desafioValido({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '123' }, 'x'), '123');
  assert.equal(desafioValido({ 'hub.mode': 'subscribe', 'hub.verify_token': 'y', 'hub.challenge': '123' }, 'x'), null);
  assert.equal(desafioValido({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '123' }, undefined), null);
});

test('E-mail: validação do envio', () => {
  const ok = validarEnvio({ para: ['a@b.com', 'a@b.com'], assunto: 'Oi\r\nBcc: x@y.com', texto: 'olá', anexos: [{ nome: 'a/b.pdf', base64: Buffer.from('pdf').toString('base64') }] });
  assert.deepEqual(ok.para, ['a@b.com']);
  assert.equal(ok.assunto, 'Oi Bcc: x@y.com', 'quebra de linha no assunto (injeção de cabeçalho) é neutralizada');
  assert.equal(ok.anexos[0].filename, 'a_b.pdf');
  assert.throws(() => validarEnvio({ para: ['inválido'], assunto: 'x', texto: 'y' }), /E-mail inválido/);
  assert.throws(() => validarEnvio({ para: ['a@b.com'], assunto: '', texto: 'y' }), /Assunto/);
  assert.throws(() => validarEnvio({ para: ['a@b.com'], assunto: 'x' }), /conteúdo/);
  assert.throws(() => validarEnvio({ para: ['a@b.com'], assunto: 'x', texto: 'y', anexos: [{ nome: 'g', base64: Buffer.alloc(11 * 1024 * 1024).toString('base64') }] }), /10 MB/);
});

async function montarApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.' });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno.', detalhe: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  await app.register(centralIntegracoesRoutes);
  await app.register(whatsappWebhookRoutes);
  await app.ready();
  return app;
}

async function criarEmpresa(nome: string) {
  const empresa = await prisma.empresa.create({ data: { nome: `${nome} ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
  const u = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: filial.id, nome: 'admin', email: `admin-${nome}-${SUF}@teste.local`.toLowerCase(), senhaHash: 'x' } });
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: u.id, modulo: m, acao: a, permitido: true }))) });
  return { empresa, admin: u };
}

test('Fase B — provedores reais, webhook do WhatsApp e isolamento', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const app = await montarApp();
  const A = await criarEmpresa('FbA');
  const B = await criarEmpresa('FbB');
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });
  const H = tok(A.admin); const HB = tok(B.admin);
  const empresasExtras: Awaited<ReturnType<typeof criarEmpresa>>[] = [];
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let body: any; try { body = r.json(); } catch { body = r.body; }
    return { s: r.statusCode, b: body, raw: r.body };
  };
  const webhook = (registroId: string, payload: unknown, segredo = APP_SECRET) => {
    const corpo = JSON.stringify(payload);
    return app.inject({ method: 'POST', url: `/integracoes/whatsapp/webhook/${registroId}`, headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}` }, payload: corpo });
  };
  const evento = (value: Record<string, unknown>) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550001111', phone_number_id: PHONE_ID }, ...value } }] }] });

  await t.test('catálogo: os 4 provedores da Fase B aceitam configuração', async () => {
    const r = await call('GET', '/integracoes/central/painel', H);
    for (const id of ['woocommerce', 'mercadopago', 'whatsapp', 'email-conta']) {
      assert.equal(r.b.provedores.find((p: any) => p.id === id)?.disponibilidade, 'CREDENCIAIS', id);
    }
  });

  await t.test('WooCommerce: http e host interno recusados sem conexão; host sem WooCommerce → erro real', async () => {
    const http = await call('POST', '/integracoes/central/woocommerce/testar', H, { urlLoja: 'http://minhaloja.com.br', consumerKey: 'ck_x', consumerSecret: 'cs_x' });
    assert.equal(http.b.ok, false); assert.equal(http.b.codigo, 'CONFIGURACAO_INCOMPLETA'); assert.match(http.b.mensagem, /https/);
    const interno = await call('POST', '/integracoes/central/woocommerce/testar', H, { urlLoja: 'https://169.254.169.254', consumerKey: 'ck_x', consumerSecret: 'cs_x' });
    assert.equal(interno.b.codigo, 'CONFIGURACAO_INCOMPLETA'); assert.match(interno.b.mensagem, /privados|internos/);
    const real = await call('POST', '/integracoes/central/woocommerce/testar', H, { urlLoja: 'https://example.com', consumerKey: 'ck_x', consumerSecret: 'cs_x' });
    assert.equal(real.b.ok, false, 'example.com não é uma loja WooCommerce');
    console.log('[woocommerce real]', real.b.codigo, real.b.mensagem);
  });

  await t.test('Mercado Pago: token fictício recusado pela API real', async () => {
    const r = await call('POST', '/integracoes/central/mercadopago/testar', H, { accessToken: `TEST-0000-${SUF}` });
    assert.equal(r.b.ok, false);
    console.log('[mercadopago real]', r.b.codigo, r.b.mensagem);
    if (r.b.codigo !== 'TIMEOUT' && !/comunicar/.test(r.b.mensagem)) assert.equal(r.b.codigo, 'CREDENCIAL_INVALIDA');
  });

  let registroA = '';
  await t.test('WhatsApp: salvar com token fictício → recusa real da Meta, segredos cifrados, URL do webhook', async () => {
    const r = await call('PUT', '/integracoes/central/whatsapp', H, { phoneNumberId: PHONE_ID, wabaId: '1234567890', accessToken: `EAAG-falso-${SUF}`, appSecret: APP_SECRET, verifyToken: VERIFY });
    assert.equal(r.s, 200, r.raw.slice(0, 200));
    assert.equal(r.b.ok, false, 'token fictício nunca conecta');
    console.log('[whatsapp real]', r.b.status, r.b.codigo, r.b.mensagem);
    const reg = await prisma.integracaoExterno.findFirstOrThrow({ where: { empresaId: A.empresa.id, tipo: 'WHATSAPP' } });
    registroA = reg.id;
    for (const s of [APP_SECRET, VERIFY, 'EAAG-falso']) assert.ok(!reg.credenciais!.includes(s), 'segredo cifrado');
    const g = await call('GET', '/integracoes/central/whatsapp', H);
    assert.match(g.b.webhookUrl, new RegExp(`/integracoes/whatsapp/webhook/${reg.id}$`));
    assert.ok(!g.raw.includes(APP_SECRET) && !g.raw.includes(VERIFY));
  });

  await t.test('WhatsApp: verificação do webhook (GET)', async () => {
    const q = (token: string) => `/integracoes/whatsapp/webhook/${registroA}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=987654`;
    const ok = await app.inject({ method: 'GET', url: q(VERIFY) });
    assert.equal(ok.statusCode, 200); assert.equal(ok.body, '987654');
    assert.equal((await app.inject({ method: 'GET', url: q('errado') })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: `/integracoes/whatsapp/webhook/cl000000000000000000000000?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1` })).statusCode, 403);
  });

  await t.test('WhatsApp: assinatura obrigatória no POST', async () => {
    const corpo = JSON.stringify(evento({ messages: [] }));
    assert.equal((await app.inject({ method: 'POST', url: `/integracoes/whatsapp/webhook/${registroA}`, headers: { 'content-type': 'application/json' }, payload: corpo })).statusCode, 401);
    assert.equal((await webhook(registroA, evento({ messages: [] }), 'segredo-errado')).statusCode, 401);
  });

  await t.test('WhatsApp: mensagem recebida gravada uma vez (idempotente); outro número ignorado', async () => {
    const msg = evento({ contacts: [{ profile: { name: 'Mariana' }, wa_id: '5511999998888' }], messages: [{ from: '5511999998888', id: `wamid.IN-${SUF}`, timestamp: '1', type: 'text', text: { body: 'Olá, quero um orçamento' } }] });
    assert.equal((await webhook(registroA, msg)).statusCode, 200);
    assert.equal((await webhook(registroA, msg)).statusCode, 200, 'reenvio da Meta');
    const recebidas = await prisma.whatsappMensagem.findMany({ where: { empresaId: A.empresa.id, direcao: 'RECEBIDA' } });
    assert.equal(recebidas.length, 1);
    assert.equal(recebidas[0].nomeContato, 'Mariana'); assert.equal(recebidas[0].conteudo, 'Olá, quero um orçamento');
    const outro = { ...msg, entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '999' }, messages: [{ from: '5511', id: `wamid.X-${SUF}`, type: 'text', text: { body: 'x' } }] } }] }] };
    await webhook(registroA, outro);
    assert.equal(await prisma.whatsappMensagem.count({ where: { empresaId: A.empresa.id, direcao: 'RECEBIDA' } }), 1, 'número de outra conta não entra');
  });

  await t.test('WhatsApp: status de entrega só avança; falha registra o erro', async () => {
    const wamid = `wamid.OUT-${SUF}`;
    const m = await prisma.whatsappMensagem.create({ data: { empresaId: A.empresa.id, direcao: 'ENVIADA', telefone: '5511999998888', tipo: 'text', conteudo: 'teste', status: 'ENVIADA', waMessageId: wamid } });
    const st = (status: string, extra: Record<string, unknown> = {}) => evento({ statuses: [{ id: wamid, status, timestamp: '2', recipient_id: '5511999998888', ...extra }] });
    await webhook(registroA, st('read'));
    assert.equal((await prisma.whatsappMensagem.findUniqueOrThrow({ where: { id: m.id } })).status, 'LIDA');
    await webhook(registroA, st('delivered'));
    assert.equal((await prisma.whatsappMensagem.findUniqueOrThrow({ where: { id: m.id } })).status, 'LIDA', 'evento atrasado não regride');
    await webhook(registroA, st('failed', { errors: [{ code: 131026, title: 'Message undeliverable' }] }));
    const f = await prisma.whatsappMensagem.findUniqueOrThrow({ where: { id: m.id } });
    assert.equal(f.status, 'FALHOU'); assert.match(f.erro ?? '', /131026/);
  });

  await t.test('WhatsApp: avisos simultâneos ("entregue" e "lida" juntos) nunca regridem o status', async () => {
    for (let i = 0; i < 8; i++) {
      const wamid = `wamid.CONC-${i}-${SUF}`;
      const m = await prisma.whatsappMensagem.create({ data: { empresaId: A.empresa.id, direcao: 'ENVIADA', telefone: '5511999998888', tipo: 'text', conteudo: 'c', status: 'ENVIADA', waMessageId: wamid } });
      const st = (status: string) => evento({ statuses: [{ id: wamid, status, timestamp: '3', recipient_id: '5511999998888' }] });
      const ordem = i % 2 ? ['read', 'delivered', 'sent'] : ['sent', 'delivered', 'read'];
      const rs = await Promise.all(ordem.map((x) => webhook(registroA, st(x))));
      assert.ok(rs.every((r) => r.statusCode === 200));
      assert.equal((await prisma.whatsappMensagem.findUniqueOrThrow({ where: { id: m.id } })).status, 'LIDA', `rodada ${i}`);
    }
  });

  await t.test('WhatsApp: isolamento entre empresas e envio sem conexão validada', async () => {
    // Empresa B configura o próprio WhatsApp; a assinatura de A não vale no registro de B.
    await call('PUT', '/integracoes/central/whatsapp', HB, { phoneNumberId: PHONE_ID, wabaId: '1', accessToken: `EAAG-b-${SUF}`, appSecret: `outro-${SUF}`, verifyToken: 'vb' });
    const regB = await prisma.integracaoExterno.findFirstOrThrow({ where: { empresaId: B.empresa.id, tipo: 'WHATSAPP' } });
    const msg = evento({ messages: [{ from: '5511888887777', id: `wamid.B-${SUF}`, type: 'text', text: { body: 'invasão' } }] });
    assert.equal((await webhook(regB.id, msg)).statusCode, 401, 'assinatura de A não vale para B');
    assert.equal(await prisma.whatsappMensagem.count({ where: { empresaId: B.empresa.id } }), 0);
    const lista = await call('GET', '/integracoes/central/whatsapp/mensagens', HB);
    assert.equal(lista.b.mensagens.length, 0);
    assert.ok((await call('GET', '/integracoes/central/whatsapp/mensagens', H)).b.mensagens.length >= 2);
    const envio = await call('POST', '/integracoes/central/whatsapp/mensagens', H, { para: '11999998888', tipo: 'TEXTO', texto: 'oi' });
    assert.equal(envio.s, 409, 'sem conexão validada não envia');
    assert.equal(await prisma.whatsappMensagem.count({ where: { empresaId: A.empresa.id, direcao: 'ENVIADA', conteudo: 'oi' } }), 0);
  });

  await t.test('E-mail: servidor interno recusado; envio sem conta conectada recusado', async () => {
    const base = { emailRemetente: 'loja@empresa.com.br', smtpPorta: '587', smtpSeguranca: 'STARTTLS', senha: 'senha-de-app' };
    for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '169.254.169.254']) {
      const r = await call('POST', '/integracoes/central/email-conta/testar', H, { ...base, smtpHost: host });
      assert.equal(r.b.ok, false, host); assert.equal(r.b.codigo, 'CONFIGURACAO_INCOMPLETA', host);
    }
    const imap = await call('POST', '/integracoes/central/email-conta/testar', H, { ...base, smtpHost: 'smtp.gmail.com', receber: 'SIM', imapHost: '192.168.1.1', imapPorta: '993' });
    assert.equal(imap.b.codigo, 'CONFIGURACAO_INCOMPLETA');
    const porta = await call('POST', '/integracoes/central/email-conta/testar', H, { ...base, smtpHost: 'smtp.gmail.com', smtpPorta: '22' });
    assert.equal(porta.s, 400, 'porta fora da lista');
    const envio = await call('POST', '/integracoes/central/email/enviar', H, { para: ['cliente@exemplo.com'], assunto: 'Teste', texto: 'olá' });
    assert.equal(envio.s, 409);
    assert.equal((await call('GET', '/integracoes/central/email/envios', H)).b.envios.length, 0);
  });

  await t.test('limite de tentativas: testar conexão é limitado por empresa (429)', async () => {
    const C = await criarEmpresa('FbC');
    const HC = tok(C.admin);
    const codigos: number[] = [];
    for (let i = 0; i < 22; i++) codigos.push((await call('POST', '/integracoes/central/woocommerce/testar', HC, { urlLoja: 'http://x.com', consumerKey: 'ck', consumerSecret: 'cs' })).s);
    assert.equal(codigos.filter((c) => c === 200).length, 20);
    assert.ok(codigos.slice(20).every((c) => c === 429), String(codigos.slice(18)));
    // Outra empresa não é afetada.
    assert.equal((await call('POST', '/integracoes/central/woocommerce/testar', HB, { urlLoja: 'http://x.com', consumerKey: 'ck', consumerSecret: 'cs' })).s, 200);
    empresasExtras.push(C);
  });

  await app.close();
  for (const e of [A, B, ...empresasExtras]) {
    await prisma.whatsappMensagem.deleteMany({ where: { empresaId: e.empresa.id } });
    await prisma.emailEnvio.deleteMany({ where: { empresaId: e.empresa.id } });
    await prisma.integracaoEvento.deleteMany({ where: { empresaId: e.empresa.id } });
    await prisma.integracaoExterno.deleteMany({ where: { empresaId: e.empresa.id } });
    await prisma.permissao.deleteMany({ where: { usuario: { empresaId: e.empresa.id } } });
    await prisma.usuario.deleteMany({ where: { empresaId: e.empresa.id } });
    await prisma.filial.deleteMany({ where: { empresaId: e.empresa.id } });
    await prisma.empresa.delete({ where: { id: e.empresa.id } });
  }
});
