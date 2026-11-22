/**
 * TESTE — pendências da Central de Integrações.
 *  - telefone internacional (+ / 00) nunca ganha 55; sem DDI assume Brasil;
 *  - e-mail: porta × segurança incompatíveis recusadas antes de conectar;
 *  - status: falha passageira com as mesmas credenciais não derruba CONECTADO;
 *  - Gemini/Resend: status real (sem variável / não testado / teste real recusado);
 *  - LGPD: envio exige autorização (ou conversa iniciada pelo cliente), SAIR descadastra,
 *    VOLTAR reativa, descadastrado nunca recebe (Central e Compras), base gravada na mensagem;
 *    retenção anonimiza o que passou do prazo e preserva o recente;
 *  - WooCommerce automático: só lojas com "Sim" + filial; trava entre instâncias; falha
 *    registrada e reagendada; rota de ativação valida a filial.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { encryptSecret } from '../src/lib/secrets.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { centralIntegracoesRoutes, whatsappWebhookRoutes } from '../src/modules/integracoes/central/central.routes.js';
import { telefoneWhatsApp, enviarDocumentoWhatsApp } from '../src/modules/integracoes/central/whatsapp.service.js';
import { normalizarTelefone } from '../src/modules/compras/canais-envio.js';
import { validarDestinosEmail } from '../src/modules/integracoes/central/adaptadores.js';
import { estadoAposTeste } from '../src/modules/integracoes/central/central.service.js';
import { statusServidor, testarServidor } from '../src/modules/integracoes/central/servidor.service.js';
import { aplicarRetencao, executarLojaWoo, reservarLojaWoo } from '../src/modules/integracoes/central/integracoes-agendador.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);
const SEGREDO = 'segredo-teste-integracoes-pendencias-01234';
const APP_SECRET = `app-secret-pend-${SUF}`;
const PHONE_ID = '109876543210111';

test('telefone: internacional não ganha 55; sem DDI assume Brasil', () => {
  assert.equal(telefoneWhatsApp('+1 415 555 0100'), '14155550100');
  assert.equal(telefoneWhatsApp('0044 20 7946 0958'), '442079460958');
  assert.equal(telefoneWhatsApp('(11) 99999-8888'), '5511999998888');
  assert.equal(telefoneWhatsApp('+55 11 99999-8888'), '5511999998888');
  assert.equal(telefoneWhatsApp('123'), null);
  assert.equal(normalizarTelefone('+1 415 555 0100'), '14155550100');
  assert.equal(normalizarTelefone('(11) 3333-4444'), '551133334444');
});

test('e-mail: porta × segurança incompatíveis são recusadas', async () => {
  const base = { emailRemetente: 'a@b.com.br', smtpHost: '8.8.8.8' };
  const r1 = await validarDestinosEmail({ ...base, smtpPorta: '465', smtpSeguranca: 'STARTTLS' });
  assert.match(r1.erro?.mensagem ?? '', /465 usa SSL\/TLS/);
  const r2 = await validarDestinosEmail({ ...base, smtpPorta: '587', smtpSeguranca: 'SSL_TLS' });
  assert.match(r2.erro?.mensagem ?? '', /587 usa STARTTLS/);
  const r3 = await validarDestinosEmail({ ...base, smtpPorta: '587', smtpSeguranca: 'STARTTLS', receber: 'SIM', imapHost: '8.8.4.4', imapPorta: '143', imapSeguranca: 'SSL_TLS' });
  assert.match(r3.erro?.mensagem ?? '', /143 usa STARTTLS/);
  const ok = await validarDestinosEmail({ ...base, smtpPorta: '465', smtpSeguranca: 'SSL_TLS' });
  assert.equal(ok.erro, undefined);
});

test('status: falha passageira não derruba CONECTADO; credencial recusada sim', () => {
  const transit = { ok: false, codigo: 'TIMEOUT' as const, mensagem: 'x' };
  assert.equal(estadoAposTeste(transit, new Date(), { status: 'CONECTADO', mesmaCredencial: true }).status, 'CONECTADO');
  assert.equal(estadoAposTeste(transit, new Date(), { status: 'CONECTADO', mesmaCredencial: false }).status, 'CREDENCIAIS_SALVAS', 'credencial nova não herda o status');
  assert.equal(estadoAposTeste(transit, null, { status: 'ERRO', mesmaCredencial: true }).status, 'CREDENCIAIS_SALVAS');
  assert.equal(estadoAposTeste({ ok: false, codigo: 'CREDENCIAL_INVALIDA', mensagem: 'x' }, new Date(), { status: 'CONECTADO', mesmaCredencial: true }).status, 'ERRO');
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
  return { empresa, filial, admin: u };
}

test('pendências — LGPD, retenção, servidor e WooCommerce automático', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const envOriginal = { g: process.env.GEMINI_API_KEY, r: process.env.RESEND_API_KEY };
  const app = await montarApp();
  const A = await criarEmpresa('PendA');
  const B = await criarEmpresa('PendB');
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });
  const H = tok(A.admin);
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let body: any; try { body = r.json(); } catch { body = r.body; }
    return { s: r.statusCode, b: body, raw: r.body };
  };
  let regWhats = '';
  const webhook = (texto: string, de: string, id: string) => {
    const corpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, messages: [{ from: de, id, type: 'text', text: { body: texto } }] } }] }] });
    return app.inject({ method: 'POST', url: `/integracoes/whatsapp/webhook/${regWhats}`, headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(corpo).digest('hex')}` }, payload: corpo });
  };

  try {
    await t.test('LGPD: autorização obrigatória, SAIR/VOLTAR e base gravada', async () => {
      regWhats = (await prisma.integracaoExterno.create({ data: { empresaId: A.empresa.id, tipo: 'WHATSAPP', nome: 'WhatsApp', status: 'CONECTADO', config: { phoneNumberId: PHONE_ID, wabaId: '1' }, credenciais: encryptSecret(JSON.stringify({ accessToken: `EAAG-falso-${SUF}`, appSecret: APP_SECRET })) } })).id;
      const semAutorizacao = await call('POST', '/integracoes/central/whatsapp/mensagens', H, { para: '11977776666', tipo: 'TEXTO', texto: 'oi' });
      assert.equal(semAutorizacao.s, 409); assert.match(semAutorizacao.b.error, /autorizou/);
      // Declarada pelo usuário: passa a regra e vai à Meta (token fictício → falha real, base gravada).
      const declarada = await call('POST', '/integracoes/central/whatsapp/mensagens', H, { para: '11977776666', tipo: 'TEXTO', texto: 'oi', consentimento: true });
      assert.equal(declarada.s, 200, declarada.raw); assert.equal(declarada.b.status, 'FALHOU');
      assert.equal((await prisma.whatsappMensagem.findUniqueOrThrow({ where: { id: declarada.b.id } })).consentimento, 'DECLARADO');
      // A Meta recusou o token fictício (erro 190) e a integração foi para EXPIRADO; volta a CONECTADO para o próximo cenário.
      assert.equal((await prisma.integracaoExterno.findUniqueOrThrow({ where: { id: regWhats } })).status, 'EXPIRADO');
      const reconectar = () => prisma.integracaoExterno.update({ where: { id: regWhats }, data: { status: 'CONECTADO' } });
      await reconectar();
      // Cliente escreveu → base CLIENTE_INICIOU, sem precisar marcar.
      assert.equal((await webhook('Olá', '5511955554444', `wamid.P1-${SUF}`)).statusCode, 200);
      const iniciou = await call('POST', '/integracoes/central/whatsapp/mensagens', H, { para: '11955554444', tipo: 'TEXTO', texto: 'Oi!' });
      assert.equal(iniciou.s, 200, iniciou.raw);
      assert.equal((await prisma.whatsappMensagem.findUniqueOrThrow({ where: { id: iniciou.b.id } })).consentimento, 'CLIENTE_INICIOU');
      // SAIR → descadastrado: nem com autorização marcada.
      await reconectar();
      await webhook('SAIR', '5511955554444', `wamid.P2-${SUF}`);
      const bloqueado = await call('POST', '/integracoes/central/whatsapp/mensagens', H, { para: '11955554444', tipo: 'TEXTO', texto: 'Oi', consentimento: true });
      assert.equal(bloqueado.s, 409); assert.match(bloqueado.b.error, /SAIR/);
      const doc = await enviarDocumentoWhatsApp(A.empresa.id, null, { para: '(11) 95555-4444', legenda: 'pedido', pdf: { nome: 'p.pdf', base64: 'JVBERi0=' }, origem: 'COMPRAS' });
      assert.equal(doc.status, 'FALHOU'); assert.match((doc as any).erro, /não receber/);
      assert.equal((await call('GET', '/integracoes/central/whatsapp/descadastros', H)).b.descadastros.length, 1);
      assert.equal((await call('GET', '/integracoes/central/whatsapp/descadastros', tok(B.admin))).b.descadastros.length, 0, 'isolamento');
      // VOLTAR reativa; manual também funciona.
      await webhook(' voltar ', '5511955554444', `wamid.P3-${SUF}`);
      assert.equal(await prisma.whatsappDescadastro.count({ where: { empresaId: A.empresa.id } }), 0);
      assert.equal((await call('POST', '/integracoes/central/whatsapp/descadastros', H, { telefone: '(11) 91111-2222', descadastrar: true })).s, 200);
      assert.equal(await prisma.whatsappDescadastro.count({ where: { empresaId: A.empresa.id, origem: 'MANUAL' } }), 1);
    });

    await t.test('retenção: anonimiza só o que passou do prazo', async () => {
      await prisma.integracaoExterno.update({ where: { id: regWhats }, data: { config: { phoneNumberId: PHONE_ID, wabaId: '1', retencaoDias: '90' } } });
      const velha = await prisma.whatsappMensagem.create({ data: { empresaId: A.empresa.id, direcao: 'RECEBIDA', telefone: '5511900000000', nomeContato: 'Fulano', tipo: 'text', conteudo: 'dado pessoal', status: 'RECEBIDA', createdAt: new Date(Date.now() - 100 * 86400_000) } });
      const nova = await prisma.whatsappMensagem.create({ data: { empresaId: A.empresa.id, direcao: 'RECEBIDA', telefone: '5511900000001', nomeContato: 'Ciclano', tipo: 'text', conteudo: 'recente', status: 'RECEBIDA' } });
      const r = await aplicarRetencao();
      assert.ok(r.whatsapp >= 1);
      const v = await prisma.whatsappMensagem.findUniqueOrThrow({ where: { id: velha.id } });
      assert.equal(v.conteudo, null); assert.equal(v.nomeContato, null); assert.equal(v.telefone, 'ANONIMIZADO'); assert.equal(v.status, 'RECEBIDA');
      assert.equal((await prisma.whatsappMensagem.findUniqueOrThrow({ where: { id: nova.id } })).conteudo, 'recente');
      assert.equal((await aplicarRetencao()).whatsapp, 0, 'idempotente');
    });

    await t.test('Gemini/Resend: sem variável, não testado e teste real recusado', async () => {
      delete process.env.GEMINI_API_KEY;
      assert.equal(await statusServidor(A.empresa.id, 'gemini'), 'NAO_CONFIGURADO');
      process.env.GEMINI_API_KEY = `chave-gemini-falsa-${SUF}`;
      process.env.RESEND_API_KEY = `re_falsa_${SUF}`;
      assert.equal(await statusServidor(A.empresa.id, 'gemini'), 'CREDENCIAIS_SALVAS', 'variável presente não é prova de conexão');
      const g = await testarServidor(A.empresa.id, A.admin.id, 'gemini');
      console.log('[pend gemini real]', g.codigo, g.mensagem);
      assert.equal(g.ok, false);
      if (g.codigo === 'CREDENCIAL_INVALIDA') assert.equal(g.status, 'ERRO');
      const r = await testarServidor(A.empresa.id, A.admin.id, 'email-transacional');
      console.log('[pend resend real]', r.codigo, r.mensagem);
      assert.equal(r.ok, false);
      if (r.codigo !== 'FALHA_COMUNICACAO') assert.equal(r.codigo, 'CREDENCIAL_INVALIDA');
      assert.equal((await call('POST', '/integracoes/servidor/outro/testar', H)).s, 400);
    });

    await t.test('WooCommerce automático: seleção, trava, falha reagendada e rota', async () => {
      const reg = await prisma.integracaoExterno.create({ data: { empresaId: A.empresa.id, tipo: 'WOOCOMMERCE', nome: 'Woo', status: 'CONECTADO', conectadoEm: new Date(), config: { urlLoja: 'https://example.com', importarAutomatico: 'NAO' }, credenciais: encryptSecret(JSON.stringify({ consumerKey: 'ck', consumerSecret: 'cs' })) } });
      const minha = async () => { for (let i = 0; i < 20; i++) { const j = await reservarLojaWoo(); if (!j) return null; if (j.id === reg.id) return j; await prisma.integracaoExterno.updateMany({ where: { id: j.id }, data: { syncLeaseExpiraEm: null, proximoSyncEm: new Date(Date.now() + 3600_000) } }); } return null; };
      assert.equal(await minha(), null, 'desligada não entra');
      assert.equal((await call('PUT', '/integracoes/central/woocommerce/automatico', H, { ativo: true, filialId: B.filial.id })).s, 400, 'filial de outra empresa');
      const lig = await call('PUT', '/integracoes/central/woocommerce/automatico', H, { ativo: true, filialId: A.filial.id });
      assert.equal(lig.s, 200); assert.equal(lig.b.importarAutomatico, 'SIM');
      const job = await minha();
      assert.ok(job, 'ligada entra');
      assert.equal(await minha(), null, 'trava: a mesma loja não é pega duas vezes');
      await executarLojaWoo(job!);
      const depois = await prisma.integracaoExterno.findUniqueOrThrow({ where: { id: reg.id } });
      assert.equal(depois.syncLeaseExpiraEm, null, 'trava liberada');
      assert.ok(depois.proximoSyncEm && depois.proximoSyncEm.getTime() > Date.now(), 'reagendada');
      assert.ok(await prisma.integracaoEvento.findFirst({ where: { empresaId: A.empresa.id, provedor: 'woocommerce', codigoErro: 'AGENDADO' } }), 'falha registrada no histórico');
      assert.equal((await call('PUT', '/integracoes/central/woocommerce/automatico', H, { ativo: false })).b.importarAutomatico, 'NAO');
    });
  } finally {
    await app.close();
    if (envOriginal.g === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = envOriginal.g;
    if (envOriginal.r === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = envOriginal.r;
    for (const e of [A, B]) {
      const id = e.empresa.id;
      await prisma.whatsappDescadastro.deleteMany({ where: { empresaId: id } });
      await prisma.whatsappMensagem.deleteMany({ where: { empresaId: id } });
      await prisma.integracaoEvento.deleteMany({ where: { empresaId: id } });
      await prisma.integracaoExterno.deleteMany({ where: { empresaId: id } });
      await prisma.permissao.deleteMany({ where: { usuario: { empresaId: id } } });
      await prisma.usuario.deleteMany({ where: { empresaId: id } });
      await prisma.filial.deleteMany({ where: { empresaId: id } });
      await prisma.empresa.delete({ where: { id } }).catch((err) => console.log('[limpeza]', String(err.message).match(/constraint[^\n]*/)?.[0]));
    }
  }
});
