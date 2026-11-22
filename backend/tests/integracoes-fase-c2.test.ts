/**
 * TESTE — Fase C2: cobranças do Asaas / Mercado Pago a partir do Financeiro.
 *
 *  - Baixa (aplicarPagamento): só RECEITA pendente da própria empresa, valor conferido ao
 *    centavo; repetição não baixa de novo; 5 avisos simultâneos → exatamente 1 baixa;
 *  - gerar cobrança: despesa recusada, lançamento pago recusado, provedor não conectado 409,
 *    credencial fictícia → recusa REAL do Asaas e do Mercado Pago, nada gravado no lançamento;
 *  - webhooks: Asaas exige o token (sem token configurado / token errado → 401); com token certo
 *    o pagamento é CONSULTADO na API (falha com chave fictícia → nada é baixado);
 *    Mercado Pago: um corpo dizendo "approved" NÃO basta — sem a consulta à API, nada muda;
 *  - permissão do Financeiro e isolamento entre empresas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { encryptSecret } from '../src/lib/secrets.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { centralIntegracoesRoutes, cobrancasWebhookRoutes } from '../src/modules/integracoes/central/central.routes.js';
import { aplicarPagamento } from '../src/modules/integracoes/central/cobrancas.service.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);
const SEGREDO = 'segredo-teste-integracoes-fase-c2-012345678';
const TOKEN_WEBHOOK = `token-webhook-asaas-${SUF}-0123456789abcdef`;

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
  await app.register(cobrancasWebhookRoutes);
  await app.ready();
  return app;
}

async function criarEmpresa(nome: string) {
  const empresa = await prisma.empresa.create({ data: { nome: `${nome} ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
  const mk = async (rotulo: string, negadas: string[]) => {
    const u = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: filial.id, nome: rotulo, email: `${rotulo}-${nome}-${SUF}@teste.local`.toLowerCase(), senhaHash: 'x' } });
    await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.filter((a) => !negadas.includes(`${m}.${a}`)).map((a) => ({ usuarioId: u.id, modulo: m, acao: a, permitido: true }))) });
    return u;
  };
  return { empresa, admin: await mk('admin', []), leitor: await mk('leitor', ['financeiro.criar']) };
}
const receita = (empresaId: string, valor = 150.25, extra: Record<string, unknown> = {}) =>
  prisma.financeiro.create({ data: { empresaId, tipo: 'RECEITA', categoria: 'vendas', descricao: `Serviço ${SUF}`, valor, vencimento: new Date(Date.now() + 5 * 86400_000), ...extra } });

test('Fase C2 — cobranças e baixa segura', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const app = await montarApp();
  const A = await criarEmpresa('C2A');
  const B = await criarEmpresa('C2B');
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });
  const H = tok(A.admin); const HL = tok(A.leitor);
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let body: any; try { body = r.json(); } catch { body = r.body; }
    return { s: r.statusCode, b: body, raw: r.body };
  };

  try {
    await t.test('baixa: valor ao centavo, só da própria empresa, idempotente', async () => {
      const f = await receita(A.empresa.id);
      const pg = { provedor: 'ASAAS' as const, pago: true, valor: 150.25, idPagamento: 'pay_1', statusProvedor: 'RECEIVED' };
      assert.equal((await aplicarPagamento(B.empresa.id, f.id, pg)).resultado, 'LANCAMENTO_NAO_ENCONTRADO', 'outra empresa');
      assert.equal((await aplicarPagamento(A.empresa.id, f.id, { ...pg, pago: false, statusProvedor: 'PENDING' })).resultado, 'NAO_PAGO');
      assert.equal((await aplicarPagamento(A.empresa.id, f.id, { ...pg, valor: 150.24 })).resultado, 'VALOR_DIVERGENTE');
      assert.equal((await prisma.financeiro.findUniqueOrThrow({ where: { id: f.id } })).status, 'PENDENTE');
      assert.equal((await aplicarPagamento(A.empresa.id, f.id, pg)).resultado, 'BAIXADO');
      assert.equal((await aplicarPagamento(A.empresa.id, f.id, pg)).resultado, 'JA_BAIXADO');
      const final = await prisma.financeiro.findUniqueOrThrow({ where: { id: f.id } });
      assert.equal(final.status, 'PAGO'); assert.equal(final.pagamentoExternoId, 'pay_1'); assert.ok(final.pagoEm);
      const despesa = await prisma.financeiro.create({ data: { empresaId: A.empresa.id, tipo: 'DESPESA', categoria: 'x', descricao: 'd', valor: 150.25 } });
      assert.equal((await aplicarPagamento(A.empresa.id, despesa.id, pg)).resultado, 'LANCAMENTO_NAO_ENCONTRADO', 'despesa nunca é baixada por cobrança');
    });

    await t.test('5 avisos simultâneos → exatamente 1 baixa', async () => {
      const f = await receita(A.empresa.id, 80);
      const rs = await Promise.all(Array.from({ length: 5 }, () => aplicarPagamento(A.empresa.id, f.id, { provedor: 'MERCADO_PAGO', pago: true, valor: 80, idPagamento: '999', statusProvedor: 'approved' })));
      assert.equal(rs.filter((r) => r.resultado === 'BAIXADO').length, 1);
    });

    await t.test('gerar cobrança: validações e provedor não conectado', async () => {
      const desp = await prisma.financeiro.create({ data: { empresaId: A.empresa.id, tipo: 'DESPESA', categoria: 'x', descricao: 'd', valor: 10 } });
      assert.equal((await call('POST', `/financeiro/${desp.id}/cobranca`, H, { provedor: 'mercadopago' })).s, 400);
      const paga = await receita(A.empresa.id, 10, { status: 'PAGO' });
      assert.equal((await call('POST', `/financeiro/${paga.id}/cobranca`, H, { provedor: 'mercadopago' })).s, 409);
      const f = await receita(A.empresa.id);
      const r = await call('POST', `/financeiro/${f.id}/cobranca`, H, { provedor: 'asaas', pagador: { nome: 'Cliente', documento: '12345678909' } });
      assert.equal(r.s, 409); assert.match(r.b.error, /não está conectado/);
      assert.equal((await call('POST', `/financeiro/${f.id}/cobranca`, HL, { provedor: 'mercadopago' })).s, 403, 'sem permissão do Financeiro');
      assert.equal((await call('POST', `/financeiro/${f.id}/cobranca`, tok(B.admin), { provedor: 'mercadopago' })).s, 404, 'outra empresa');
    });

    let regAsaas = ''; let regMp = '';
    await t.test('credenciais fictícias: Asaas e Mercado Pago reais recusam; nada é gravado', async () => {
      regAsaas = (await prisma.integracaoExterno.create({ data: { empresaId: A.empresa.id, tipo: 'ASAAS', nome: 'Asaas', status: 'CONECTADO', config: { ambiente: 'SANDBOX' }, credenciais: encryptSecret(JSON.stringify({ apiKey: `$aact_hmlg_000000000000falso${SUF}`, webhookToken: TOKEN_WEBHOOK })) } })).id;
      regMp = (await prisma.integracaoExterno.create({ data: { empresaId: A.empresa.id, tipo: 'MERCADO_PAGO', nome: 'Mercado Pago', status: 'CONECTADO', config: {}, credenciais: encryptSecret(JSON.stringify({ accessToken: `TEST-0000-${SUF}` })) } })).id;
      const f = await receita(A.empresa.id);
      const a = await call('POST', `/financeiro/${f.id}/cobranca`, H, { provedor: 'asaas', forma: 'PIX', pagador: { nome: 'Cliente Teste', documento: '123.456.789-09' } });
      console.log('[c2 asaas real]', a.s, a.b.error);
      assert.equal(a.s, 502);
      const m = await call('POST', `/financeiro/${f.id}/cobranca`, H, { provedor: 'mercadopago' });
      console.log('[c2 mercadopago real]', m.s, m.b.error);
      assert.equal(m.s, 502);
      const depois = await prisma.financeiro.findUniqueOrThrow({ where: { id: f.id } });
      assert.equal(depois.cobrancaId, null); assert.equal(depois.status, 'PENDENTE');
    });

    await t.test('webhook Asaas: token obrigatório; pagamento sempre consultado na API', async () => {
      const f = await receita(A.empresa.id, 50);
      const corpo = { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_falso', status: 'RECEIVED', value: 50, externalReference: f.id } };
      const url = `/integracoes/asaas/webhook/${regAsaas}`;
      assert.equal((await app.inject({ method: 'POST', url, payload: corpo })).statusCode, 401, 'sem token');
      assert.equal((await app.inject({ method: 'POST', url, headers: { 'asaas-access-token': 'errado' }, payload: corpo })).statusCode, 401);
      const ok = await app.inject({ method: 'POST', url, headers: { 'asaas-access-token': TOKEN_WEBHOOK }, payload: corpo });
      assert.equal(ok.statusCode, 200);
      assert.equal((await prisma.financeiro.findUniqueOrThrow({ where: { id: f.id } })).status, 'PENDENTE', 'o corpo do aviso não é prova de pagamento');
      const ev = await prisma.integracaoEvento.findFirst({ where: { empresaId: A.empresa.id, provedor: 'asaas', codigoErro: 'FALHA_CONSULTA' } });
      assert.ok(ev, 'consulta à API registrada');
    });

    await t.test('webhook Mercado Pago: corpo "approved" não basta', async () => {
      const f = await receita(A.empresa.id, 70);
      const r = await app.inject({ method: 'POST', url: `/integracoes/mercadopago/webhook/${regMp}`, payload: { type: 'payment', action: 'payment.updated', data: { id: '123456' }, status: 'approved', external_reference: f.id, transaction_amount: 70 } });
      assert.equal(r.statusCode, 200);
      assert.equal((await prisma.financeiro.findUniqueOrThrow({ where: { id: f.id } })).status, 'PENDENTE');
      assert.equal((await app.inject({ method: 'POST', url: '/integracoes/mercadopago/webhook/cl00000000000000000000000', payload: { type: 'payment', data: { id: '1' } } })).statusCode, 404);
      // Registro do Asaas não serve como registro do Mercado Pago.
      assert.equal((await app.inject({ method: 'POST', url: `/integracoes/mercadopago/webhook/${regAsaas}`, payload: { type: 'payment', data: { id: '1' } } })).statusCode, 404);
    });

    await t.test('URL de webhook exibida na configuração', async () => {
      assert.match((await call('GET', '/integracoes/central/asaas', H)).b.webhookUrl, new RegExp(`/integracoes/asaas/webhook/${regAsaas}$`));
      assert.match((await call('GET', '/integracoes/central/mercadopago', H)).b.webhookUrl, new RegExp(`/integracoes/mercadopago/webhook/${regMp}$`));
    });
  } finally {
    await app.close();
    for (const e of [A, B]) {
      const id = e.empresa.id;
      await prisma.financeiro.deleteMany({ where: { empresaId: id } });
      await prisma.integracaoEvento.deleteMany({ where: { empresaId: id } });
      await prisma.integracaoExterno.deleteMany({ where: { empresaId: id } });
      await prisma.permissao.deleteMany({ where: { usuario: { empresaId: id } } });
      await prisma.usuario.deleteMany({ where: { empresaId: id } });
      await prisma.filial.deleteMany({ where: { empresaId: id } });
      await prisma.empresa.delete({ where: { id } }).catch((err) => console.log('[limpeza]', String(err.message).match(/constraint[^\n]*/)?.[0]));
    }
  }
});
