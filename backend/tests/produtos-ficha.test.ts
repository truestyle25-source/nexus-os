/**
 * TESTE DE INTEGRAÇÃO — módulo Produtos (ERP): ficha por abas e integrações reais.
 *
 * Cobre, pela API real (Fastify + Prisma + Postgres de teste):
 *  - catálogo padrão de unidades/tipos (idempotente);
 *  - cadastro com os campos ERP, ficha completa e precificação (markup x margem);
 *  - justificativa e histórico de preços; permissões de custo e de administração;
 *  - tributos com validação por regime (CST x CSOSN);
 *  - códigos de barras: validação GS1, duplicidade entre produtos, busca por código adicional;
 *  - filiais: preço e disponibilidade por filial aplicados na VENDA e no catálogo do PDV,
 *    desvínculo com saldo bloqueado e exigindo autorização;
 *  - movimentações com saldo anterior/posterior/custo, descarte, transferência,
 *    estoque negativo permitido, produto sem controle de estoque (sem baixa e sem estorno);
 *  - recebimento de compra: último custo, preço de compra, política de custo e histórico;
 *  - produção de kit com PRODUCAO e CONSUMO_INSUMO;
 *  - histórico (movimentações, documentos, preços, cadastro), exportação Excel/PDF;
 *  - integrações com estado real; isolamento entre empresas.
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
import { produtosRoutes } from '../src/modules/produtos/produtos.routes.js';
import { produtoFichaRoutes } from '../src/modules/produtos/produto-ficha.routes.js';
import { kitsRoutes } from '../src/modules/produtos/kits.routes.js';
import { estoqueRoutes } from '../src/modules/estoque/estoque.routes.js';
import { vendasRoutes } from '../src/modules/vendas/vendas.routes.js';
import { comprasRoutes } from '../src/modules/compras/compras.routes.js';
import { pdvRoutes } from '../src/modules/pdv/pdv.routes.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);
const SEGREDO = 'segredo-teste-produtos-ficha-0123456789abcdef';

async function montarApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.', detalhes: error.issues });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    if (error?.constructor === Error) return reply.status(400).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.', detalhe: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  for (const r of [produtosRoutes, produtoFichaRoutes, kitsRoutes, estoqueRoutes, vendasRoutes, comprasRoutes, pdvRoutes]) await app.register(r);
  await app.ready();
  return app;
}

async function criarEmpresa(nome: string, regime: string | null, permissoesNegadas: Array<[string, string]> = []) {
  const empresa = await prisma.empresa.create({ data: { nome: `${nome} ${SUF}`, cnpj: generateRandomValidCnpj().replace(/\D/g, ''), regimeTributario: regime } });
  const fA = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
  const fB = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Loja B', status: 'ATIVO' } });
  const mk = async (rotulo: string, negadas: Array<[string, string]>) => {
    const u = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: fA.id, nome: rotulo, email: `${rotulo}-${nome}-${SUF}@teste.local`.toLowerCase(), senhaHash: 'x' } });
    const nega = new Set(negadas.map(([m, a]) => `${m}.${a}`));
    await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.filter((a) => !nega.has(`${m}.${a}`)).map((a) => ({ usuarioId: u.id, modulo: m, acao: a, permitido: true }))) });
    return u;
  };
  const admin = await mk('admin', []);
  const restrito = await mk('restrito', permissoesNegadas);
  return { empresa, fA, fB, admin, restrito };
}

test('módulo Produtos (ERP) — ficha por abas', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const app = await montarApp();
  const A = await criarEmpresa('ProdA', 'REGIME_NORMAL', [['custos', 'visualizar'], ['custos', 'editar'], ['produtos', 'administrar']]);
  const B = await criarEmpresa('ProdB', 'SIMPLES_NACIONAL');
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });
  const H = tok(A.admin); const HR = tok(A.restrito); const HB = tok(B.admin);
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let body: any; try { body = r.json(); } catch { body = r.body; }
    return { s: r.statusCode, b: body };
  };

  let produtoId = '';
  let insumoId = '';

  await t.test('catálogo padrão é idempotente', async () => {
    const c1 = await call('GET', '/produtos/catalogos', H);
    assert.equal(c1.s, 200, JSON.stringify(c1.b).slice(0, 200));
    const c2 = await call('GET', '/produtos/catalogos', H);
    assert.equal(c2.b.unidades.length, c1.b.unidades.length, 'segunda chamada não duplica');
    assert.ok(c1.b.unidades.some((u: any) => u.simbolo === 'CX') && c1.b.unidades.some((u: any) => u.simbolo === 'kg'));
    assert.ok(c1.b.tipos.some((x: any) => x.codigo === 'MATERIA_PRIMA') && c1.b.tipos.some((x: any) => x.codigo === 'SERVICO'));
    assert.equal(c1.b.regimeTributario, 'REGIME_NORMAL');
    assert.equal(c1.b.filiais.length, 2);
  });

  await t.test('cadastro com campos ERP e ficha com precificação', async () => {
    const cat = (await call('GET', '/produtos/catalogos', H)).b;
    const un = cat.unidades.find((u: any) => u.simbolo === 'UN');
    const cx = cat.unidades.find((u: any) => u.simbolo === 'CX');
    const tipo = cat.tipos.find((x: any) => x.codigo === 'MERCADORIA');
    const grupo = await call('POST', '/categorias', H, { nome: `Bebidas ${SUF}` });
    const sub1 = await call('POST', '/categorias', H, { nome: 'Refrigerantes', categoriaPaiId: grupo.b.id });
    assert.equal(sub1.b.nivel, 1);
    const r = await call('POST', '/produtos', H, {
      nome: `Refri 2L ${SUF}`, sku: `RF${SUF}`, custo: 10, precoVenda: 15, unidade: 'UN', categoriaId: sub1.b.id,
      referencia: `REF-${SUF}`, descricaoResumida: 'Refri 2L', fabricante: 'Fab X', tipoProdutoId: tipo.id,
      unidadeBaseId: un.id, unidadeCompraId: cx.id, unidadeVendaId: un.id, unidadeTributavelId: un.id,
      vendaFracionada: false, controlaValidade: true, diasValidade: 180, estoqueSeguranca: 3, comissaoPercentual: 5, despesasPercentual: 5,
      precoTabelaA: 14, posicaoPdv: 2,
    });
    assert.equal(r.s, 200, JSON.stringify(r.b).slice(0, 300));
    produtoId = r.b.id;
    const f = await call('GET', `/produtos/${produtoId}/ficha`, H);
    assert.equal(f.s, 200);
    assert.equal(f.b.produto.referencia, `REF-${SUF}`);
    assert.equal(f.b.produto.unidadeCompra.simbolo, 'CX');
    assert.deepEqual(f.b.categoriaCadeia.map((c: any) => c.nivel), [0, 1], 'grupo > subgrupo');
    assert.equal(f.b.precificacao.markupPercentual, 50);
    assert.equal(f.b.precificacao.margemBrutaPercentual, 33.33);
    assert.equal(f.b.precificacao.deducoesPercentual, 10, 'comissão 5 + despesas 5 (sem impostos ainda)');
    assert.equal(f.b.estoque.filiais.length, 2, 'saldo por filial');
    const fator = await call('PUT', `/produtos/${produtoId}/fator-conversao`, H, { unidadeOrigemId: cx.id, unidadeDestinoId: un.id, fator: 6 });
    assert.equal(fator.s, 200, JSON.stringify(fator.b));
    const troca = await call('PUT', `/produtos/${produtoId}/fator-conversao`, H, { unidadeOrigemId: cx.id, unidadeDestinoId: un.id, fator: 12 });
    assert.equal(troca.b.fator, 12);
    const ativos = await prisma.fatorConversao.findMany({ where: { produtoId, ativo: true } });
    assert.equal(ativos.length, 1, 'troca do fator desativa o anterior (histórico preservado)');
    assert.equal(await prisma.fatorConversao.count({ where: { produtoId } }), 2);
    const igual = await call('PUT', `/produtos/${produtoId}/fator-conversao`, H, { unidadeOrigemId: un.id, unidadeDestinoId: un.id, fator: 1 });
    assert.equal(igual.s, 400, 'origem e destino iguais');
  });

  await t.test('permissões: sem custos.visualizar a ficha não traz custo; sem administrar não muda comissão', async () => {
    const f = await call('GET', `/produtos/${produtoId}/ficha`, HR);
    assert.equal(f.s, 200);
    assert.equal(f.b.produto.custo, undefined);
    assert.equal(f.b.precificacao, null);
    const r = await call('PUT', `/produtos/${produtoId}`, HR, { comissaoPercentual: 9 });
    assert.equal(r.s, 403);
    const r2 = await call('PUT', `/produtos/${produtoId}`, HR, { precoCompra: 5 });
    assert.equal(r2.s, 403, 'preço de compra exige custos.editar');
  });

  await t.test('preço: justificativa exigida e histórico gravado', async () => {
    const sem = await call('PUT', `/produtos/${produtoId}`, H, { precoVenda: 12 });
    assert.equal(sem.s, 422, 'queda de 20% sem justificativa');
    const com = await call('PUT', `/produtos/${produtoId}`, H, { precoVenda: 12, justificativaPreco: 'Promoção de lançamento' });
    assert.equal(com.s, 200, JSON.stringify(com.b).slice(0, 200));
    const leve = await call('PUT', `/produtos/${produtoId}`, H, { precoVenda: 12.5, precoTabelaB: 11 });
    assert.equal(leve.s, 200, 'aumento não exige justificativa');
    const h = await call('GET', `/produtos/${produtoId}/historico-precos`, H);
    const venda = h.b.filter((x: any) => x.campo === 'PRECO_VENDA');
    assert.equal(venda.length, 2);
    assert.equal(venda[1].valorAnterior, 15); assert.equal(venda[1].valorNovo, 12);
    assert.equal(venda[1].justificativa, 'Promoção de lançamento');
    assert.ok(h.b.some((x: any) => x.campo === 'TABELA_B' && x.valorNovo === 11));
  });

  await t.test('tributos: validação por regime e gravação', async () => {
    const inval = await call('PUT', `/produtos/${produtoId}/fiscal`, H, { cfopSaida: '1102', csosn: '102' });
    assert.equal(inval.s, 422);
    assert.deepEqual(inval.b.erros.map((e: any) => e.campo).sort(), ['cfopSaida', 'csosn']);
    const ok = await call('PUT', `/produtos/${produtoId}/fiscal`, H, { ncm: '2202.10.00', origemMercadoria: 0, cfopEntrada: '1102', cfopSaida: '5102', cstIcms: '00', aliquotaIcms: 18, cstPis: '01', aliquotaPis: 1.65, cstCofins: '01', aliquotaCofins: 7.6 });
    assert.equal(ok.s, 200, JSON.stringify(ok.b).slice(0, 300));
    const f = await call('GET', `/produtos/${produtoId}/ficha`, H);
    assert.equal(f.b.produto.ncm, '22021000', 'NCM normalizado e gravado no produto');
    assert.equal(f.b.impostosSobreVendaPercentual, 27.25);
    assert.equal(f.b.precificacao.deducoesPercentual, 37.25, 'margem líquida passa a considerar os impostos informados');
  });

  await t.test('códigos de barras: GS1, duplicidade e busca por código adicional', async () => {
    const inval = await call('POST', `/produtos/${produtoId}/codigos-barras`, H, { codigo: '4006381333932', tipo: 'EAN13' });
    assert.equal(inval.s, 422);
    const ok = await call('POST', `/produtos/${produtoId}/codigos-barras`, H, { codigo: '4006381333931', tipo: 'EAN13', principal: true });
    assert.equal(ok.s, 200, JSON.stringify(ok.b));
    const ean8 = await call('POST', `/produtos/${produtoId}/codigos-barras`, H, { codigo: '96385074' });
    assert.equal(ean8.b.tipo, 'EAN8', 'tipo inferido');
    const plu = await call('POST', `/produtos/${produtoId}/codigos-barras`, H, { codigo: '01234', tipo: 'BALANCA' });
    assert.equal(plu.s, 200);
    const outro = await call('POST', '/produtos', H, { nome: `Outro ${SUF}`, sku: `OT${SUF}`, custo: 1, precoVenda: 2 });
    const dup = await call('POST', `/produtos/${outro.b.id}/codigos-barras`, H, { codigo: '96385074' });
    assert.equal(dup.s, 409, 'código já identifica outro produto');
    const dupPrincipal = await call('PUT', `/produtos/${outro.b.id}`, H, { codigoBarras: '96385074' });
    assert.equal(dupPrincipal.s, 409, 'principal também confere os adicionais');
    const busca = await call('GET', '/produtos/codigo/96385074', H);
    assert.equal(busca.b.id, produtoId);
    const ficha = await call('GET', `/produtos/${produtoId}/ficha`, H);
    assert.equal(ficha.b.produto.codigoBarras, '4006381333931', 'principal espelhado em Produto.codigoBarras');
    assert.equal(ficha.b.produto.codigosBarras.length, 3);
  });

  await t.test('estoque: rastreabilidade completa e regras do cadastro', async () => {
    const e1 = await call('POST', '/estoque/movimentar', H, { produtoId, filialId: A.fA.id, tipo: 'ENTRADA', quantidade: 20, motivo: 'saldo inicial', documento: `NM-${SUF}` });
    assert.equal(e1.s, 200, JSON.stringify(e1.b).slice(0, 200));
    assert.equal(Number(e1.b.movimentacao.saldoAnterior), 0);
    assert.equal(Number(e1.b.movimentacao.saldoPosterior), 20);
    assert.equal(Number(e1.b.movimentacao.custoUnitario), 10);
    const desc = await call('POST', '/estoque/movimentar', H, { produtoId, filialId: A.fA.id, tipo: 'DESCARTE', quantidade: 2, motivo: 'vencido' });
    assert.equal(desc.s, 200);
    assert.equal(Number(desc.b.movimentacao.saldoPosterior), 18);
    const tr = await call('POST', '/estoque/transferir', H, { produtoId, filialOrigemId: A.fA.id, filialDestinoId: A.fB.id, quantidade: 5 });
    assert.equal(tr.s, 200, JSON.stringify(tr.b).slice(0, 200));
    assert.equal(Number(tr.b.movOrigem.saldoPosterior), 13);
    assert.equal(Number(tr.b.movDestino.saldoPosterior), 5);
    const negativo = await call('POST', '/estoque/transferir', H, { produtoId, filialOrigemId: A.fB.id, filialDestinoId: A.fA.id, quantidade: 50, permitirNegativo: true });
    assert.equal(negativo.s, 400, 'produto não permite transferência negativa');
    const f = await call('GET', `/produtos/${produtoId}/ficha`, H);
    const porFilial = Object.fromEntries(f.b.estoque.filiais.map((x: any) => [x.filialNome, x.atual]));
    assert.deepEqual(porFilial, { 'Loja B': 5, Matriz: 13 }, 'cada filial com o próprio saldo');
    assert.equal(f.b.estoque.consolidado.atual, 18);
  });

  await t.test('filiais: preço e disponibilidade aplicados na venda e no PDV; desvínculo protegido', async () => {
    const cfg = await call('PUT', `/produtos/${produtoId}/filiais`, H, { filiais: [{ filialId: A.fB.id, precoVenda: 13.9 }, { filialId: A.fA.id, disponivelVenda: false }] });
    assert.equal(cfg.s, 200, JSON.stringify(cfg.b));
    const vB = await call('POST', '/vendas', H, { filialId: A.fB.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId, quantidade: 1, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 13.9 }] });
    assert.ok([200, 201].includes(vB.s), JSON.stringify(vB.b).slice(0, 300));
    const item = await prisma.vendaItem.findFirst({ where: { produtoId, venda: { filialId: A.fB.id } } });
    assert.equal(Number(item?.preco), 13.9, 'venda usou o preço da filial B');
    const vA = await call('POST', '/vendas', H, { filialId: A.fA.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId, quantidade: 1, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 12.5 }] });
    assert.equal(vA.s, 422, 'indisponível para venda na Matriz');
    const catB = await call('GET', `/pdv/catalogo?filialId=${A.fB.id}`, H);
    const pB = catB.b.produtos.find((p: any) => p.id === produtoId);
    assert.equal(pB.precoVenda, 13.9);
    assert.ok(pB.codigosBarras.includes('96385074'), 'catálogo do PDV leva os códigos adicionais');
    const catA = await call('GET', `/pdv/catalogo?filialId=${A.fA.id}`, H);
    assert.equal(catA.b.produtos.find((p: any) => p.id === produtoId).ativo, false, 'fora do PDV da Matriz');
    const semAut = await call('PUT', `/produtos/${produtoId}/filiais`, HR, { filiais: [{ filialId: A.fB.id, ativo: false }] });
    assert.equal(semAut.s, 403, 'desvincular exige produtos.administrar');
    const comSaldo = await call('PUT', `/produtos/${produtoId}/filiais`, H, { filiais: [{ filialId: A.fB.id, ativo: false }] });
    assert.equal(comSaldo.s, 422, 'não desvincula filial com saldo');
    await call('PUT', `/produtos/${produtoId}/filiais`, H, { filiais: [{ filialId: A.fA.id, disponivelVenda: true }] });
  });

  await t.test('estoque negativo permitido e produto sem controle de estoque', async () => {
    const serv = await call('POST', '/produtos', H, { nome: `Instalação ${SUF}`, sku: `SV${SUF}`, custo: 0, precoVenda: 50, controlaEstoque: false });
    const v = await call('POST', '/vendas', H, { filialId: A.fA.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId: serv.b.id, quantidade: 3, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 150 }] });
    assert.ok([200, 201].includes(v.s), JSON.stringify(v.b).slice(0, 300));
    const vendaId = v.b.id ?? v.b.venda?.id;
    assert.equal(await prisma.estoqueMovimentacao.count({ where: { produtoId: serv.b.id } }), 0, 'serviço não baixa estoque');
    const cancel = await call('POST', `/vendas/${vendaId}/cancelar`, H, { motivo: 'teste', estornarEstoque: true });
    assert.equal(cancel.s, 200, JSON.stringify(cancel.b).slice(0, 200));
    assert.equal(await prisma.estoqueMovimentacao.count({ where: { produtoId: serv.b.id } }), 0, 'cancelar não cria estoque do nada');
    const neg = await call('POST', '/produtos', H, { nome: `Sob encomenda ${SUF}`, sku: `NG${SUF}`, custo: 1, precoVenda: 3, permiteEstoqueNegativo: true });
    const vn = await call('POST', '/vendas', H, { filialId: A.fA.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId: neg.b.id, quantidade: 2, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 6 }] });
    assert.ok([200, 201].includes(vn.s), JSON.stringify(vn.b).slice(0, 300));
    const mov = await prisma.estoqueMovimentacao.findFirst({ where: { produtoId: neg.b.id, tipo: 'VENDA' } });
    assert.equal(Number(mov?.saldoPosterior), -2, 'negativo permitido e registrado');
    const comum = await call('POST', '/produtos', H, { nome: `Comum ${SUF}`, sku: `CM${SUF}`, custo: 1, precoVenda: 2 });
    const proibido = await call('POST', '/vendas', H, { filialId: A.fA.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId: comum.b.id, quantidade: 1, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 2 }] });
    assert.equal(proibido.s, 422, 'produto comum sem saldo continua bloqueado');
  });

  await t.test('compra: último custo, preço de compra, política de custo e histórico', async () => {
    await prisma.produto.update({ where: { id: produtoId }, data: { politicaCusto: 'ULTIMO_CUSTO' } });
    const forn = await prisma.fornecedor.create({ data: { empresaId: A.empresa.id, nome: `Forn ${SUF}` } });
    const c = await call('POST', '/compras', H, { filialId: A.fA.id, fornecedorId: forn.id, itens: [{ produtoId, quantidade: 4, valorUnit: 11 }] });
    assert.ok([200, 201].includes(c.s), JSON.stringify(c.b).slice(0, 300));
    await call('POST', `/compras/${c.b.id}/confirmar`, H);
    const rec = await call('POST', `/compras/${c.b.id}/receber`, H);
    assert.equal(rec.s, 200, JSON.stringify(rec.b).slice(0, 300));
    const p = await prisma.produto.findUnique({ where: { id: produtoId } });
    assert.equal(Number(p?.ultimoCustoAquisicao), 11);
    assert.equal(Number(p?.precoCompra), 11);
    assert.equal(Number(p?.custo), 11, 'política ULTIMO_CUSTO aplicada no recebimento');
    const mov = await prisma.estoqueMovimentacao.findFirst({ where: { produtoId, tipo: 'COMPRA' } });
    assert.equal(Number(mov?.custoUnitario), 11);
    const h = await call('GET', `/produtos/${produtoId}/historico-precos`, H);
    assert.ok(h.b.some((x: any) => x.campo === 'CUSTO' && x.valorNovo === 11 && x.origem === 'COMPRA'));
    const docs = await call('GET', `/produtos/${produtoId}/documentos?tipo=entrada`, H);
    assert.equal(docs.b.total, 1);
    assert.equal(docs.b.itens[0].parceiro, `Forn ${SUF}`);
    const saidas = await call('GET', `/produtos/${produtoId}/documentos?tipo=saida`, H);
    assert.equal(saidas.b.total, 1, 'a venda na filial B');
    const manual = await call('GET', `/produtos/${produtoId}/documentos?tipo=manual`, H);
    assert.ok(manual.b.itens.some((x: any) => x.documento === `NM-${SUF}`));
  });

  await t.test('produção de kit registra PRODUCAO e CONSUMO_INSUMO', async () => {
    const ins = await call('POST', '/produtos', H, { nome: `Xarope ${SUF}`, sku: `XR${SUF}`, custo: 2, precoVenda: 3 });
    insumoId = ins.b.id;
    await call('POST', '/estoque/movimentar', H, { produtoId: insumoId, filialId: A.fA.id, tipo: 'ENTRADA', quantidade: 10 });
    const kit = await call('POST', '/produtos', H, { nome: `Combo ${SUF}`, sku: `KT${SUF}`, custo: 0, precoVenda: 20 });
    await prisma.produto.update({ where: { id: kit.b.id }, data: { ehKit: true } });
    const comp = await call('PUT', `/produtos/${kit.b.id}/kit`, H, { componentes: [{ produtoId: insumoId, quantidadePorKit: 2 }] });
    assert.equal(comp.s, 200, JSON.stringify(comp.b).slice(0, 200));
    const prod = await call('POST', `/produtos/${kit.b.id}/kit/produzir`, H, { filialId: A.fA.id, quantidade: 3, idempotencyKey: `prod-kit-${SUF}` });
    assert.equal(prod.s, 201, JSON.stringify(prod.b).slice(0, 300));
    const tipos = (await prisma.estoqueMovimentacao.findMany({ where: { empresaId: A.empresa.id, produtoId: { in: [kit.b.id, insumoId] }, tipo: { in: ['PRODUCAO', 'CONSUMO_INSUMO'] } } })).map((m) => `${m.tipo}:${Number(m.quantidade)}`).sort();
    assert.deepEqual(tipos, ['CONSUMO_INSUMO:-6', 'PRODUCAO:3']);
  });

  await t.test('histórico de movimentações filtrado, paginado e exportável', async () => {
    const todas = await call('GET', `/produtos/${produtoId}/movimentacoes?limite=2`, H);
    assert.equal(todas.s, 200);
    assert.equal(todas.b.itens.length, 2);
    assert.ok(todas.b.total >= 5);
    const descartes = await call('GET', `/produtos/${produtoId}/movimentacoes?tipo=DESCARTE`, H);
    assert.equal(descartes.b.total, 1);
    assert.equal(descartes.b.itens[0].saldoAnterior, 20);
    const semCusto = await call('GET', `/produtos/${produtoId}/movimentacoes`, HR);
    assert.equal('custoUnitario' in semCusto.b.itens[0], false, 'custo oculto sem custos.visualizar');
    const xlsx = await call('GET', `/produtos/${produtoId}/movimentacoes/exportar?formato=xlsx`, H);
    assert.equal(Buffer.from(xlsx.b.base64, 'base64').subarray(0, 2).toString(), 'PK', 'arquivo Excel válido (zip)');
    const pdf = await call('GET', `/produtos/${produtoId}/movimentacoes/exportar?formato=pdf`, H);
    assert.equal(Buffer.from(pdf.b.base64, 'base64').subarray(0, 4).toString(), '%PDF');
    const cad = await call('GET', `/produtos/${produtoId}/historico-cadastro`, H);
    assert.ok(cad.b.some((x: any) => x.contexto === 'Aba Tributos'));
    assert.ok(cad.b.some((x: any) => x.campos.some((c: any) => c.campo === 'precoVenda')));
  });

  await t.test('integrações: estado real', async () => {
    const r = await call('GET', `/produtos/${produtoId}/integracoes`, H);
    const por = Object.fromEntries(r.b.map((x: any) => [x.chave, x.estado]));
    assert.equal(por.fiscal, 'NAO_IMPLEMENTADO');
    assert.equal(por.pdv, 'ATIVO');
    assert.equal(por.compras, 'ATIVO');
    assert.equal(por.balanca, 'NAO_APLICAVEL');
  });

  await t.test('isolamento entre empresas', async () => {
    assert.equal((await call('GET', `/produtos/${produtoId}/ficha`, HB)).s, 404);
    assert.equal((await call('POST', `/produtos/${produtoId}/codigos-barras`, HB, { codigo: '12345678' })).s, 404);
    assert.equal((await call('GET', `/produtos/${produtoId}/movimentacoes`, HB)).s, 404);
    assert.equal((await call('PUT', `/produtos/${produtoId}/filiais`, HB, { filiais: [{ filialId: A.fA.id, precoVenda: 1 }] })).s, 404);
    assert.equal((await call('GET', '/produtos/codigo/96385074', HB)).s, 404, 'código de A não é encontrado por B');
    const meu = await call('POST', '/produtos', HB, { nome: `Prod B ${SUF}`, sku: `PB${SUF}`, custo: 1, precoVenda: 2 });
    const filialAlheia = await call('PUT', `/produtos/${meu.b.id}/filiais`, HB, { filiais: [{ filialId: A.fA.id, precoVenda: 1 }] });
    assert.equal(filialAlheia.s, 404, 'B não configura filial de A');
    const cstNoSimples = await call('PUT', `/produtos/${meu.b.id}/fiscal`, HB, { cstIcms: '00' });
    assert.equal(cstNoSimples.s, 422, 'empresa B é do Simples: CST recusado');
  });

  await app.close();
});
