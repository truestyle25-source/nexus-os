/**
 * TESTE — Fase C1: Compras envia o pedido pela conta da EMPRESA (Central de Integrações).
 *
 * Pela API real (Fastify + Prisma + Postgres de teste):
 *  - sem conta na Central e sem variáveis do servidor: canais "não configurado" e envio
 *    registrado como NAO_CONFIGURADO (nada simulado);
 *  - com WhatsApp da empresa marcado como conectado (token fictício): o envio sai pela conta
 *    da empresa — a Meta real recusa o upload — e fica FALHOU tanto no envio da compra quanto
 *    no histórico de mensagens da Central (origem COMPRAS); o status da compra NÃO muda;
 *    não cai para o servidor;
 *  - status de entrega vindo do webhook aparece no envio da compra (Entregue/Lida);
 *  - outra empresa não enxerga as mensagens.
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
import { compraFichaRoutes } from '../src/modules/compras/compra-ficha.routes.js';
import { produtosRoutes } from '../src/modules/produtos/produtos.routes.js';
import { produtoFichaRoutes } from '../src/modules/produtos/produto-ficha.routes.js';
import { fornecedorFichaRoutes } from '../src/modules/fornecedores/fornecedor-ficha.routes.js';
import { centralIntegracoesRoutes } from '../src/modules/integracoes/central/central.routes.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);
const SEGREDO = 'segredo-teste-integracoes-fase-c1-01234567';

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
  for (const r of [compraFichaRoutes, produtosRoutes, produtoFichaRoutes, fornecedorFichaRoutes, centralIntegracoesRoutes]) await app.register(r);
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

test('Fase C1 — Compras envia pela conta da empresa', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const envOriginal = { r: process.env.RESEND_API_KEY, w: process.env.WHATSAPP_TOKEN, p: process.env.WHATSAPP_PHONE_NUMBER_ID };
  delete process.env.RESEND_API_KEY; delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  const app = await montarApp();
  const A = await criarEmpresa('C1A');
  const B = await criarEmpresa('C1B');
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });
  const H = tok(A.admin); const HB = tok(B.admin);
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let body: any; try { body = r.json(); } catch { body = r.body; }
    return { s: r.statusCode, b: body, raw: r.body };
  };
  let compraId = '';

  try {
    await t.test('preparação: produto, fornecedor com WhatsApp e compra aprovada', async () => {
      const cat = (await call('GET', '/produtos/catalogos', H)).b;
      const kg = cat.unidades.find((u: any) => u.simbolo === 'kg');
      const p = await call('POST', '/produtos', H, { nome: `Farinha ${SUF}`, sku: `FC1${SUF}`, custo: 4, precoVenda: 9, unidade: 'kg', unidadeBaseId: kg.id });
      assert.equal(p.s, 200, p.raw.slice(0, 200));
      const f = await call('POST', '/api/v1/fornecedores/ficha', H, {
        tipoPessoa: 'JURIDICA', documento: generateRandomValidCnpj(), nome: `Moinho ${SUF}`, cep: '01310100', cidade: 'São Paulo', uf: 'SP',
        emailPedidos: 'pedidos@moinho.com.br', contatos: [{ nome: 'Paula', whatsapp: '(11) 98888-7777', email: 'paula@moinho.com.br', principal: true }],
      });
      assert.equal(f.s, 201, f.raw.slice(0, 200));
      const c = await call('POST', '/api/v1/compras/ficha', H, { filialId: A.filial.id, fornecedorId: f.b.fornecedor.id, previsaoEntrega: '2026-12-10', condPagamento: '30', formaPagamento: 'BOLETO', parcelas: 1, itens: [{ produtoId: p.b.id, quantidade: 10, valorUnit: 4, unidadeCompra: 'kg' }] });
      assert.equal(c.s, 201, c.raw.slice(0, 200));
      compraId = c.b.compra.id;
      assert.equal((await call('POST', `/api/v1/compras/${compraId}/acao`, H, { acao: 'APROVAR' })).s, 200);
    });

    await t.test('sem conta na Central nem servidor: não configurado, nada simulado', async () => {
      const prev = await call('GET', `/api/v1/compras/${compraId}/envio/previa`, H);
      assert.equal(prev.b.canais.whatsapp.configurado, false); assert.equal(prev.b.canais.whatsapp.origem, null);
      const env = await call('POST', `/api/v1/compras/${compraId}/envio`, H, { canal: 'WHATSAPP' });
      assert.equal(env.s, 200, env.raw.slice(0, 200));
      assert.equal(env.b.envio.status, 'NAO_CONFIGURADO');
      assert.equal(env.b.ficha.compra.status, 'APROVADA', 'não enviado não muda o status');
    });

    await t.test('WhatsApp da empresa conectado: envio sai pela conta da empresa (Meta real recusa o token)', async () => {
      // Estado de conexão gravado direto (a validação real exigiria um token verdadeiro da Meta).
      await prisma.integracaoExterno.create({ data: { empresaId: A.empresa.id, tipo: 'WHATSAPP', nome: 'WhatsApp Business', status: 'CONECTADO', config: { phoneNumberId: '109876543210987', wabaId: '1' }, credenciais: encryptSecret(JSON.stringify({ accessToken: `EAAG-falso-${SUF}` })) } });
      const prev = await call('GET', `/api/v1/compras/${compraId}/envio/previa`, H);
      assert.equal(prev.b.canais.whatsapp.origem, 'CENTRAL');
      const env = await call('POST', `/api/v1/compras/${compraId}/envio`, H, { canal: 'WHATSAPP' });
      assert.equal(env.s, 200, env.raw.slice(0, 200));
      assert.equal(env.b.envio.provedor, 'whatsapp-empresa', 'não cai para o servidor');
      assert.equal(env.b.envio.status, 'FALHOU');
      console.log('[c1 whatsapp real]', env.b.envio.erro);
      assert.equal(env.b.ficha.compra.status, 'APROVADA');
      const msgs = await call('GET', '/integracoes/central/whatsapp/mensagens', H);
      const m = msgs.b.mensagens.find((x: any) => x.origem === 'COMPRAS');
      assert.ok(m, 'envio registrado no histórico da Central');
      assert.equal(m.status, 'FALHOU'); assert.equal(m.telefone, '5511988887777'); assert.equal(m.tipo, 'document');
      assert.ok(!env.raw.includes('EAAG-falso'), 'token nunca aparece');
    });

    await t.test('status de entrega do webhook aparece no envio da compra', async () => {
      const wamid = `wamid.C1-${SUF}`;
      await prisma.whatsappMensagem.create({ data: { empresaId: A.empresa.id, direcao: 'ENVIADA', telefone: '5511988887777', tipo: 'document', conteudo: 'pedido', status: 'LIDA', waMessageId: wamid, origem: 'COMPRAS' } });
      await prisma.compraEnvio.create({ data: { empresaId: A.empresa.id, compraId, canal: 'WHATSAPP', destinatario: '(11) 98888-7777', status: 'ENVIADO', provedor: 'whatsapp-empresa', provedorId: wamid } });
      const ficha = await call('GET', `/api/v1/compras/${compraId}/ficha`, H);
      const e = ficha.b.envios.find((x: any) => x.provedorId === wamid);
      assert.equal(e.entrega.status, 'LIDA');
      assert.equal(ficha.b.envios.find((x: any) => x.status === 'NAO_CONFIGURADO').entrega, null);
    });

    await t.test('isolamento: outra empresa não vê as mensagens nem a compra', async () => {
      assert.equal((await call('GET', '/integracoes/central/whatsapp/mensagens', HB)).b.mensagens.length, 0);
      assert.equal((await call('GET', `/api/v1/compras/${compraId}/ficha`, HB)).s, 404);
    });
  } finally {
    await app.close();
    Object.assign(process.env, Object.fromEntries(Object.entries({ RESEND_API_KEY: envOriginal.r, WHATSAPP_TOKEN: envOriginal.w, WHATSAPP_PHONE_NUMBER_ID: envOriginal.p }).filter(([, v]) => v !== undefined)));
    for (const e of [A, B]) {
      const id = e.empresa.id;
      await prisma.whatsappMensagem.deleteMany({ where: { empresaId: id } });
      await prisma.integracaoEvento.deleteMany({ where: { empresaId: id } });
      await prisma.integracaoExterno.deleteMany({ where: { empresaId: id } });
      await prisma.compraEnvio.deleteMany({ where: { empresaId: id } });
      await prisma.auditoria.deleteMany({ where: { empresaId: id } });
      await prisma.compraItem.deleteMany({ where: { compra: { empresaId: id } } });
      await prisma.compra.deleteMany({ where: { empresaId: id } });
      await prisma.fornecedorContato.deleteMany({ where: { fornecedor: { empresaId: id } } });
      await prisma.fornecedorProduto.deleteMany({ where: { fornecedor: { empresaId: id } } });
      await prisma.fornecedor.deleteMany({ where: { empresaId: id } });
      await prisma.produtoPrecoHistorico.deleteMany({ where: { produto: { empresaId: id } } }).catch(() => {});
      await prisma.produtoFilial.deleteMany({ where: { produto: { empresaId: id } } }).catch(() => {});
      await prisma.estoque.deleteMany({ where: { empresaId: id } });
      await prisma.produto.deleteMany({ where: { empresaId: id } });
      await prisma.fatorConversao.deleteMany({ where: { empresaId: id } }).catch(() => {});
      await prisma.unidade.deleteMany({ where: { empresaId: id } });
      await prisma.dimensao.deleteMany({ where: { empresaId: id } });
      await prisma.tipoProduto.deleteMany({ where: { empresaId: id } });
      await prisma.categoria.deleteMany({ where: { empresaId: id } }).catch(() => {});
      await prisma.permissao.deleteMany({ where: { usuario: { empresaId: id } } });
      await prisma.usuario.deleteMany({ where: { empresaId: id } });
      await prisma.filial.deleteMany({ where: { empresaId: id } });
      await prisma.empresa.delete({ where: { id } }).catch((err) => console.log('[limpeza]', String(err.message).match(/constraint[^\n]*/)?.[0]));
    }
  }
});
