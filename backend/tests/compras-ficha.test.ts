/**
 * TESTE DE INTEGRAÇÃO — módulo Compras completo (ficha, fluxo, recebimento parcial, NF, envio).
 *
 * Pela API real (Fastify + Prisma + Postgres de teste):
 *  - criar (número sequencial), editar, visualizar; totais (itens − desconto + frete + outras);
 *  - fluxo: rascunho → aprovação (quando exigida) → envio → confirmação; transições inválidas recusadas;
 *  - fornecedor bloqueado não recebe pedido nem envio; dados do fornecedor carregados na ficha;
 *  - PEDIDO NÃO MOVIMENTA ESTOQUE; recebimento parcial (80 de 100 kg) → +80 no estoque, saldo 20,
 *    status PARCIAL; recebimento do saldo → RECEBIDA; quantidade maior que o pendente recusada;
 *    avaria/recusa/divergência registradas; chave repetida não duplica; conversão CX → UN;
 *  - financeiro proporcional (sem duplicar; fecha o total no último recebimento), parcelas;
 *  - NF de entrada (chave única, divergência de valor), documentos sem storage → 503 claro;
 *  - envio por e-mail/WhatsApp sem credenciais → NAO_CONFIGURADO (nada simulado); wa.me →
 *    CONVERSA_ABERTA sem mudar o status; PDF do pedido;
 *  - cancelamento com motivo; parcial não cancela (concluir encerra o saldo); histórico real;
 *  - permissões e isolamento entre empresas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { comprasRoutes } from '../src/modules/compras/compras.routes.js';
import { compraFichaRoutes } from '../src/modules/compras/compra-ficha.routes.js';
import { produtosRoutes } from '../src/modules/produtos/produtos.routes.js';
import { produtoFichaRoutes } from '../src/modules/produtos/produto-ficha.routes.js';
import { fornecedorFichaRoutes } from '../src/modules/fornecedores/fornecedor-ficha.routes.js';
import { cronograma, prazosDaCondicao } from '../src/modules/compras/compra.service.js';
import { linkConversaWhatsApp, normalizarTelefone } from '../src/modules/compras/canais-envio.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);
const SEGREDO = 'segredo-teste-compras-ficha-0123456789abcd';

async function montarApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.', detalhes: error.issues });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.', detalhe: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  for (const r of [comprasRoutes, compraFichaRoutes, produtosRoutes, produtoFichaRoutes, fornecedorFichaRoutes]) await app.register(r);
  await app.ready();
  return app;
}

async function criarEmpresa(nome: string) {
  const empresa = await prisma.empresa.create({ data: { nome: `${nome} ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const fA = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
  const fB = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Loja B', status: 'ATIVO' } });
  const mk = async (rotulo: string, negadas: string[]) => {
    const u = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: fA.id, nome: rotulo, email: `${rotulo}-${nome}-${SUF}@teste.local`.toLowerCase(), senhaHash: 'x' } });
    await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.filter((a) => !negadas.includes(`${m}.${a}`)).map((a) => ({ usuarioId: u.id, modulo: m, acao: a, permitido: true }))) });
    return u;
  };
  return { empresa, fA, fB, admin: await mk('admin', []), comprador: await mk('comprador', ['compras.administrar']) };
}

test('compras — ficha completa, fluxo e recebimento parcial', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const envOriginal = { r: process.env.RESEND_API_KEY, w: process.env.WHATSAPP_TOKEN, p: process.env.WHATSAPP_PHONE_NUMBER_ID, s: process.env.STORAGE_BUCKET };
  delete process.env.RESEND_API_KEY; delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID; delete process.env.STORAGE_BUCKET;
  const app = await montarApp();
  const A = await criarEmpresa('CompA');
  const B = await criarEmpresa('CompB');
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });
  const H = tok(A.admin); const HC = tok(A.comprador); const HB = tok(B.admin);
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let body: any; try { body = r.json(); } catch { body = r.body; }
    return { s: r.statusCode, b: body };
  };
  const saldo = async (produtoId: string, filialId = A.fA.id) => Number((await prisma.estoque.findUnique({ where: { filialId_produtoId: { filialId, produtoId } } }))?.quantidade ?? 0);
  const cat = (await call('GET', '/produtos/catalogos', H)).b;
  const un = (s: string) => cat.unidades.find((u: any) => u.simbolo === s);
  const P: Record<string, string> = {};
  let fornecedorId = ''; let bloqueadoId = ''; let compraId = ''; let itemFarinha = ''; let itemOvo = '';

  await t.test('cadastros reais: produtos, fornecedor com contato e fornecedor bloqueado', async () => {
    for (const [k, nome, u, custo] of [['FAR', 'Farinha', 'kg', 4], ['ACU', 'Açúcar', 'kg', 5], ['OVO', 'Ovo', 'UN', 0.5]] as const) {
      const r = await call('POST', '/produtos', H, { nome: `${nome} ${SUF}`, sku: `${k}${SUF}`, custo, precoVenda: custo * 2 + 1, unidade: u, unidadeBaseId: un(u).id });
      assert.equal(r.s, 200, JSON.stringify(r.b).slice(0, 200)); P[k] = r.b.id;
    }
    await call('PUT', `/produtos/${P.OVO}/fator-conversao`, H, { unidadeOrigemId: un('CX').id, unidadeDestinoId: un('UN').id, fator: 12 });
    const f = await call('POST', '/api/v1/fornecedores/ficha', H, {
      tipoPessoa: 'JURIDICA', documento: generateRandomValidCnpj(), nome: `Comercial Alfa ${SUF}`, nomeFantasia: 'Alfa', cep: '01310100', cidade: 'São Paulo', uf: 'SP',
      emailPedidos: 'pedidos@alfa.com.br', condicaoPagamento: '30/60', prazoEntregaDias: 5, transportadora: 'Rápido',
      contatos: [{ nome: 'Mariana', whatsapp: '(11) 99999-8888', email: 'mariana@alfa.com.br', principal: true }],
    });
    assert.equal(f.s, 201, JSON.stringify(f.b).slice(0, 200)); fornecedorId = f.b.fornecedor.id;
    const fb = await call('POST', '/api/v1/fornecedores/ficha', H, { tipoPessoa: 'JURIDICA', documento: generateRandomValidCnpj(), nome: `Bloqueado ${SUF}`, cep: '01310100', cidade: 'São Paulo', uf: 'SP', contatos: [{ nome: 'Xavier' }] });
    assert.equal(fb.s, 201, JSON.stringify(fb.b).slice(0, 200));
    bloqueadoId = fb.b.fornecedor.id;
    await call('PATCH', `/fornecedores/${bloqueadoId}/status`, H, { status: 'Bloqueado' });
  });

  await t.test('criar compra: número automático, totais e fornecedor bloqueado recusado', async () => {
    const base = { filialId: A.fA.id, fornecedorId, previsaoEntrega: '2026-12-01', condPagamento: '30/60', formaPagamento: 'BOLETO', parcelas: 2, observacoesFornecedor: 'Entregar pela manhã', desconto: 10, frete: 20, outrasDespesas: 5 };
    const itens = [
      { produtoId: P.FAR, quantidade: 100, valorUnit: 5.2, unidadeCompra: 'kg' },
      { produtoId: P.ACU, quantidade: 50, valorUnit: 4.5, unidadeCompra: 'kg', desconto: 5 },
      { produtoId: P.OVO, quantidade: 2, valorUnit: 12, unidadeCompra: 'CX' },
    ];
    assert.equal((await call('POST', '/api/v1/compras/ficha', H, { ...base, itens: [] })).s, 400, 'sem itens');
    assert.equal((await call('POST', '/api/v1/compras/ficha', H, { ...base, fornecedorId: bloqueadoId, itens })).s, 422, 'fornecedor bloqueado');
    const r = await call('POST', '/api/v1/compras/ficha', H, { ...base, itens });
    assert.equal(r.s, 201, JSON.stringify(r.b).slice(0, 300));
    compraId = r.b.compra.id;
    assert.equal(r.b.compra.numeroExibido, 'CP-000001');
    assert.equal(r.b.compra.status, 'RASCUNHO');
    // produtos 520 + 225 − 5 + 24 = 764; total 764 − 10 + 20 + 5 = 779
    assert.equal(r.b.compra.valorProdutos, 764);
    assert.equal(r.b.compra.valorTotal, 779);
    assert.equal(r.b.fornecedor.emailPedidos, 'pedidos@alfa.com.br', 'dados do fornecedor carregados');
    assert.equal(r.b.fornecedor.contato.nome, 'Mariana');
    assert.equal(r.b.fornecedor.prazoEntregaDias, 5);
    const ovo = r.b.itens.find((i: any) => i.produtoId === P.OVO);
    assert.equal(ovo.quantidadeBase, 24, '2 CX = 24 UN pelo fator do produto');
    itemFarinha = r.b.itens.find((i: any) => i.produtoId === P.FAR).id; itemOvo = ovo.id;
    assert.deepEqual(r.b.financeiro.cronogramaPrevisto.map((p: any) => p.valor), [389.5, 389.5], 'cronograma 30/60');
    assert.equal(await saldo(P.FAR), 0, 'PEDIDO NÃO MOVIMENTA ESTOQUE');
    const segunda = await call('POST', '/api/v1/compras/ficha', H, { ...base, itens: [itens[0]] });
    assert.equal(segunda.b.compra.numeroExibido, 'CP-000002');
    const outraEmpresa = await call('POST', '/api/v1/compras/ficha', HB, { ...base, filialId: B.fA.id, itens });
    assert.equal(outraEmpresa.s, 404, 'fornecedor/filial de outra empresa');
  });

  await t.test('editar e visualizar; transições inválidas recusadas', async () => {
    const e = await call('PUT', `/api/v1/compras/${compraId}/ficha`, H, { frete: 30, prioridade: 'ALTA', observacoes: 'Urgente para produção' });
    assert.equal(e.s, 200, JSON.stringify(e.b).slice(0, 200));
    assert.equal(e.b.compra.valorTotal, 789);
    assert.equal(e.b.compra.prioridade, 'ALTA');
    const v = await call('GET', `/api/v1/compras/${compraId}/ficha`, H);
    assert.equal(v.b.compra.observacoes, 'Urgente para produção', 'persistido');
    assert.ok(v.b.acoes.includes('APROVAR'));
    assert.equal((await call('POST', `/api/v1/compras/${compraId}/acao`, H, { acao: 'CONFIRMAR_FORNECEDOR' })).s, 409, 'rascunho não pula para confirmado');
    assert.equal((await call('POST', `/api/v1/compras/${compraId}/recebimentos`, H, { idempotencyKey: `r-${SUF}-x`, itens: [{ compraItemId: itemFarinha, quantidadeRecebida: 1 }] })).s, 409, 'rascunho não recebe');
  });

  await t.test('aprovação exigida pela empresa: só compras.administrar aprova', async () => {
    assert.equal((await call('PUT', '/api/v1/compras/configuracao', HC, { exigeAprovacao: true })).s, 403);
    assert.equal((await call('PUT', '/api/v1/compras/configuracao', H, { exigeAprovacao: true })).s, 200);
    const env = await call('POST', `/api/v1/compras/${compraId}/acao`, HC, { acao: 'ENVIAR_APROVACAO' });
    assert.equal(env.b.compra.status, 'AGUARDANDO_APROVACAO');
    assert.equal((await call('POST', `/api/v1/compras/${compraId}/acao`, HC, { acao: 'APROVAR' })).s, 403, 'comprador não aprova');
    const ap = await call('POST', `/api/v1/compras/${compraId}/acao`, H, { acao: 'APROVAR' });
    assert.equal(ap.b.compra.status, 'APROVADA');
    assert.equal(ap.b.compra.aprovadoPor, 'admin');
    assert.equal((await call('PUT', `/api/v1/compras/${compraId}/ficha`, H, { frete: 1 })).s, 409, 'valores travados após aprovação');
  });

  await t.test('envio: canais sem credencial não simulam; wa.me não muda status; PDF', async () => {
    const prev = await call('GET', `/api/v1/compras/${compraId}/envio/previa`, H);
    assert.equal(prev.b.email, 'pedidos@alfa.com.br');
    assert.match(prev.b.linkWhatsApp, /^https:\/\/wa\.me\/5511999998888\?text=/);
    assert.equal(prev.b.canais.email.configurado, false);
    const em = await call('POST', `/api/v1/compras/${compraId}/envio`, H, { canal: 'EMAIL' });
    assert.equal(em.s, 200);
    assert.equal(em.b.envio.status, 'NAO_CONFIGURADO', 'sem RESEND_API_KEY nada é enviado');
    assert.equal(em.b.ficha.compra.status, 'APROVADA', 'não enviado → status não muda');
    const wa = await call('POST', `/api/v1/compras/${compraId}/envio`, H, { canal: 'WHATSAPP', modo: 'CONVERSA' });
    assert.equal(wa.b.envio.status, 'CONVERSA_ABERTA');
    assert.ok(wa.b.link.startsWith('https://wa.me/'));
    assert.equal(wa.b.ficha.compra.status, 'APROVADA', 'abrir conversa ≠ mensagem enviada');
    const api = await call('POST', `/api/v1/compras/${compraId}/envio`, H, { canal: 'WHATSAPP' });
    assert.equal(api.b.envio.status, 'NAO_CONFIGURADO');
    const pdf = await call('GET', `/api/v1/compras/${compraId}/pdf`, H);
    assert.ok(Buffer.from(pdf.b.base64, 'base64').subarray(0, 5).toString() === '%PDF-', 'PDF válido');
    const marca = await call('POST', `/api/v1/compras/${compraId}/acao`, H, { acao: 'MARCAR_ENVIADA' });
    assert.equal(marca.b.compra.status, 'ENVIADA');
    const conf = await call('POST', `/api/v1/compras/${compraId}/acao`, H, { acao: 'CONFIRMAR_FORNECEDOR' });
    assert.equal(conf.b.compra.status, 'PEDIDO');
    assert.equal((await prisma.compraEnvio.count({ where: { compraId } })), 3, 'todas as tentativas registradas');
  });

  await t.test('NF de entrada: chave única e divergência de valor; documentos sem storage', async () => {
    const chave = '3'.repeat(44);
    const nf = await call('POST', `/api/v1/compras/${compraId}/notas-fiscais`, H, { numero: '1234', serie: '1', chaveAcesso: chave, dataEmissao: '2026-11-20', valorTotal: 700 });
    assert.equal(nf.s, 201, JSON.stringify(nf.b));
    assert.equal(nf.b.status, 'DIVERGENTE', 'valor diferente do pedido');
    assert.equal((await call('POST', `/api/v1/compras/${compraId}/notas-fiscais`, H, { numero: '9', chaveAcesso: chave })).s, 409, 'chave duplicada');
    assert.equal((await call('POST', `/api/v1/compras/${compraId}/notas-fiscais`, H, { numero: '9', chaveAcesso: '123' })).s, 400, 'chave inválida');
    const doc = await call('POST', `/api/v1/compras/${compraId}/documentos`, H, { notaFiscalId: nf.b.id, arquivo: { nome: 'nfe.xml', base64: Buffer.from('<nfe/>').toString('base64') } });
    assert.equal(doc.s, 503);
    (globalThis as any).__nf = nf.b.id;
  });

  await t.test('recebimento parcial: 80 de 100 kg → estoque +80, saldo 20, PARCIAL, financeiro proporcional', async () => {
    const antes = await saldo(P.FAR);
    const maior = await call('POST', `/api/v1/compras/${compraId}/recebimentos`, H, { idempotencyKey: `r-${SUF}-maior`, itens: [{ compraItemId: itemFarinha, quantidadeRecebida: 101 }] });
    assert.equal(maior.s, 422, 'acima do pendente');
    const r = await call('POST', `/api/v1/compras/${compraId}/recebimentos`, H, {
      idempotencyKey: `r-${SUF}-1`, notaFiscalId: (globalThis as any).__nf, observacoes: 'Chegou parte',
      itens: [{ compraItemId: itemFarinha, quantidadeRecebida: 80, quantidadeAvariada: 2, divergencia: '2 kg com embalagem rasgada' }, { compraItemId: itemOvo, quantidadeRecebida: 1 }],
    });
    assert.equal(r.s, 201, JSON.stringify(r.b).slice(0, 300));
    assert.equal(r.b.ficha.compra.status, 'PARCIAL');
    assert.equal(await saldo(P.FAR), antes + 80, 'entraram 80 kg');
    assert.equal(await saldo(P.OVO), 12, '1 CX = 12 UN no estoque');
    const far = r.b.ficha.itens.find((i: any) => i.id === itemFarinha);
    assert.equal(far.quantidadePendente, 20);
    assert.equal(far.situacao, 'PARCIAL');
    const rec = r.b.ficha.recebimentos[0];
    assert.equal(rec.itens.find((i: any) => i.compraItemId === itemFarinha).avariada, 2);
    assert.equal(rec.movimentacoes.length, 2, 'movimentações vinculadas ao recebimento');
    const mov = await prisma.estoqueMovimentacao.findFirst({ where: { recebimentoId: r.b.recebimentoId, produtoId: P.FAR } });
    assert.equal(mov?.tipo, 'COMPRA'); assert.equal(mov?.documento, compraId); assert.equal(mov?.filialId, A.fA.id);
    assert.equal(await saldo(P.FAR, A.fB.id), 0, 'outra filial intacta');
    // financeiro: (80×5,2 + 12) / 764 × 789 = 428 / 764 × 789 = 442,0 em 2 parcelas
    const fin = await prisma.financeiro.findMany({ where: { compraId }, orderBy: { vencimento: 'asc' } });
    assert.equal(fin.length, 2, '2 parcelas');
    assert.equal(Math.round(fin.reduce((s, f) => s + Number(f.valor), 0) * 100) / 100, 442.01);
    // repetir a mesma chave não duplica nada
    const dup = await call('POST', `/api/v1/compras/${compraId}/recebimentos`, H, { idempotencyKey: `r-${SUF}-1`, itens: [{ compraItemId: itemFarinha, quantidadeRecebida: 80 }] });
    assert.equal(dup.s, 200); assert.equal(dup.b.duplicado, true);
    assert.equal(await saldo(P.FAR), antes + 80, 'sem entrada dobrada');
    assert.equal(await prisma.financeiro.count({ where: { compraId } }), 2, 'sem conta dobrada');
    assert.equal((await call('POST', `/compras/${compraId}/cancelar`, H, { motivo: 'teste' })).s, 409, 'parcial não cancela');
  });

  await t.test('recebimento do saldo: RECEBIDA, financeiro fecha o total exato', async () => {
    const r = await call('POST', '/compras/' + compraId + '/receber', H);
    assert.equal(r.s, 200, JSON.stringify(r.b).slice(0, 200));
    assert.equal(r.b.status, 'RECEBIDA');
    assert.equal(await saldo(P.FAR), 100);
    assert.equal(await saldo(P.ACU), 50);
    assert.equal(await saldo(P.OVO), 24);
    const total = (await prisma.financeiro.aggregate({ where: { compraId }, _sum: { valor: true } }))._sum.valor;
    assert.equal(Number(total), 789, 'soma das contas = total da compra');
    assert.equal((await call('POST', '/compras/' + compraId + '/receber', H)).s, 409, 'não recebe de novo');
    const conc = await call('POST', `/api/v1/compras/${compraId}/acao`, H, { acao: 'CONCLUIR' });
    assert.equal(conc.b.compra.status, 'CONCLUIDA');
  });

  await t.test('cancelamento com motivo e histórico real', async () => {
    const c2 = await prisma.compra.findFirst({ where: { empresaId: A.empresa.id, numero: 2 } });
    const cancel = await call('POST', `/compras/${c2!.id}/cancelar`, H, { motivo: 'Fornecedor sem prazo' });
    assert.equal(cancel.s, 200);
    assert.equal((await prisma.compra.findUnique({ where: { id: c2!.id } }))?.motivoCancelamento, 'Fornecedor sem prazo');
    const hist = (await call('GET', '/api/v1/compras/historico', H)).b;
    const eventos = hist.filter((h: any) => h.compraId === compraId).map((h: any) => h.evento);
    for (const e of ['Pedido criado', 'Pedido aprovado', 'Confirmado pelo fornecedor']) assert.ok(eventos.some((x: string) => x.startsWith(e)), `histórico: ${e}`);
    assert.ok(eventos.some((x: string) => x.startsWith('Recebimento 1 confirmado (parcial)')));
    assert.ok(hist.some((h: any) => h.compraId === c2!.id && /cancelado/i.test(h.evento)));
  });

  await t.test('painel, listas e isolamento', async () => {
    const p = (await call('GET', '/api/v1/compras/painel', H)).b;
    assert.equal(p.indicadores.total, 2);
    assert.equal(p.empresa.comprasExigeAprovacao, true);
    const lista = (await call('GET', '/api/v1/compras?busca=CP-000001', H)).b;
    assert.equal(lista.length, 1); assert.equal(lista[0].status, 'CONCLUIDA');
    const rec = (await call('GET', '/api/v1/compras/recebimentos', H)).b.find((x: any) => x.compraId === compraId);
    assert.equal(rec.recebimentos, 2); assert.equal(rec.pendente, 0); assert.equal(rec.divergencias, 1);
    assert.equal((await call('GET', '/api/v1/compras/notas-fiscais', H)).b.length, 1);
    for (const [m, u] of [['GET', `/api/v1/compras/${compraId}/ficha`], ['PUT', `/api/v1/compras/${compraId}/ficha`], ['POST', `/api/v1/compras/${compraId}/acao`], ['GET', `/api/v1/compras/${compraId}/pdf`]] as const) {
      assert.equal((await call(m, u, HB, m === 'GET' ? undefined : m === 'PUT' ? { frete: 1 } : { acao: 'CONCLUIR' })).s, 404, `${m} ${u}`);
    }
    assert.equal((await call('GET', '/api/v1/compras', HB)).b.length, 0, 'empresa B não vê compras da A');
  });

  await t.test('utilitários de pagamento e WhatsApp', () => {
    assert.deepEqual(prazosDaCondicao('30/60/90'), [30, 60, 90]);
    assert.deepEqual(prazosDaCondicao('À vista'), [0]);
    assert.deepEqual(cronograma(100, new Date('2026-01-01'), '30/60/90', 1).map((p) => p.valor), [33.33, 33.33, 33.34]);
    assert.equal(normalizarTelefone('(11) 98888-7777'), '5511988887777');
    assert.equal(linkConversaWhatsApp('123', 'x'), null);
  });

  await app.close();
  if (envOriginal.r !== undefined) process.env.RESEND_API_KEY = envOriginal.r;
  if (envOriginal.w !== undefined) process.env.WHATSAPP_TOKEN = envOriginal.w;
  if (envOriginal.p !== undefined) process.env.WHATSAPP_PHONE_NUMBER_ID = envOriginal.p;
  if (envOriginal.s !== undefined) process.env.STORAGE_BUCKET = envOriginal.s;
});
