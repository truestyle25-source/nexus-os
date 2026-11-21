/**
 * TESTE DE INTEGRAÇÃO — tipo de produto KIT e aba Composição do Kit.
 *
 * Pela API real (Fastify + Prisma + Postgres de teste), cobre os 19 cenários pedidos:
 *  1-3  tipo KIT no catálogo; produto KIT x produto de outro tipo (o que decide a aba);
 *  4    busca de componentes reais (nome, código, código de barras, grupo, subgrupo, tipo);
 *  5-6  quantidades em KG, G, L, ML e CX → UN, com conversão só por regra cadastrada;
 *  7    custo total do kit = Σ custo do componente × quantidade na base (preço não muda);
 *  8-9  edição, salvar e reabrir; auditoria;
 *  10-12 venda no PDV/vendas baixa os componentes (1 e várias unidades), nunca o kit;
 *  13   estoque insuficiente: venda inteira recusada, nada baixado (sem baixa parcial);
 *  14-15 cancelamento e estorno devolvem exatamente o que saiu, sem duplicar;
 *  16-17 isolamento entre filiais e entre empresas;
 *  18   histórico de movimentações com o kit de origem e consumo por componente;
 *  19   integridade: snapshot da venda, mudança de tipo bloqueada, produção bloqueada,
 *       custo recalculado no recebimento de compra.
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
const SEGREDO = 'segredo-teste-produto-kit-0123456789abcdef';

/** EAN-13 válido a partir de 12 dígitos. */
function ean13(base12: string) {
  const soma = [...base12].reverse().reduce((t, d, i) => t + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return base12 + ((10 - (soma % 10)) % 10);
}

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
  for (const r of [produtosRoutes, produtoFichaRoutes, kitsRoutes, estoqueRoutes, vendasRoutes, comprasRoutes, pdvRoutes]) await app.register(r);
  await app.ready();
  return app;
}

async function criarEmpresa(nome: string) {
  const empresa = await prisma.empresa.create({ data: { nome: `${nome} ${SUF}`, cnpj: generateRandomValidCnpj().replace(/\D/g, '') } });
  const fA = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
  const fB = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Loja B', status: 'ATIVO' } });
  const admin = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: fA.id, nome: 'admin', email: `admin-${nome}-${SUF}@teste.local`.toLowerCase(), senhaHash: 'x' } });
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: admin.id, modulo: m, acao: a, permitido: true }))) });
  return { empresa, fA, fB, admin };
}

test('tipo de produto KIT — composição, custo e baixa dos componentes', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const app = await montarApp();
  const A = await criarEmpresa('KitA');
  const B = await criarEmpresa('KitB');
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });
  const H = tok(A.admin); const HB = tok(B.admin);
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let body: any; try { body = r.json(); } catch { body = r.body; }
    return { s: r.statusCode, b: body };
  };
  const saldo = async (produtoId: string, filialId = A.fA.id) =>
    Number((await prisma.estoque.findUnique({ where: { filialId_produtoId: { filialId, produtoId } } }))?.quantidade ?? 0);
  const vender = (kitId: string, quantidade: number, preco: number, filialId = A.fA.id, h = H) =>
    call('POST', '/vendas', h, { filialId, formaPagamento: 'DINHEIRO', itens: [{ produtoId: kitId, quantidade, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: preco * quantidade }] });

  const cat = (await call('GET', '/produtos/catalogos', H)).b;
  const un = (s: string) => cat.unidades.find((u: any) => u.simbolo === s);
  const tipo = (c: string) => cat.tipos.find((x: any) => x.codigo === c);
  const P: Record<string, string> = {};
  let kitId = '';
  let outroId = '';
  let venda1 = '';
  let venda3 = '';
  let grupoId = '';
  let subgrupoId = '';
  const barrasLeite = ean13(`789${String(Date.now()).slice(-9)}`);

  await t.test('1. tipo KIT disponível (sem remover os tipos existentes) e produto KIT criado', async () => {
    const codigos = cat.tipos.map((x: any) => x.codigo);
    for (const c of ['MERCADORIA', 'INSUMO', 'FABRICADO', 'USO_INTERNO', 'MATERIA_PRIMA', 'PRODUTO_ACABADO', 'SERVICO', 'KIT', 'FABRICA', 'NAO_CLASSIFICADO']) {
      assert.ok(codigos.includes(c), `tipo ${c} no catálogo`);
    }
    assert.equal(tipo('KIT').nome, 'Kit');
    const g = await call('POST', '/categorias', H, { nome: `Confeitaria ${SUF}` });
    const sg = await call('POST', '/categorias', H, { nome: `Secos ${SUF}`, categoriaPaiId: g.b.id });
    grupoId = g.b.id; subgrupoId = sg.b.id;
    const mk = async (chave: string, nome: string, base: string, custo: number, extra: Record<string, unknown> = {}) => {
      const r = await call('POST', '/produtos', H, { nome: `${nome} ${SUF}`, sku: `${chave}${SUF}`, custo, precoVenda: custo * 2 + 1, unidade: base, unidadeBaseId: un(base).id, tipoProdutoId: tipo('INSUMO').id, ...extra });
      assert.equal(r.s, 200, JSON.stringify(r.b).slice(0, 200));
      P[chave] = r.b.id;
    };
    await mk('ACU', 'Açúcar', 'kg', 5, { categoriaId: subgrupoId });
    await mk('FAR', 'Farinha de trigo', 'kg', 4, { categoriaId: subgrupoId });
    await mk('LEI', 'Leite', 'L', 5, { codigoBarras: barrasLeite, tipoProdutoId: tipo('MATERIA_PRIMA').id });
    await mk('CHO', 'Chocolate', 'kg', 24, { categoriaId: grupoId });
    await mk('OVO', 'Ovo', 'UN', 0.5);
    await mk('INA', 'Insumo antigo', 'kg', 1);
    await call('PATCH', `/produtos/${P.INA}/status`, H, { status: 'INATIVO' });
    // 1 CX de ovos = 12 UN (fator cadastrado na ficha; vigência aberta).
    const fator = await call('PUT', `/produtos/${P.OVO}/fator-conversao`, H, { unidadeOrigemId: un('CX').id, unidadeDestinoId: un('UN').id, fator: 12 });
    assert.equal(fator.s, 200, JSON.stringify(fator.b));
    for (const [k, q] of [['ACU', 10], ['FAR', 10], ['LEI', 10], ['CHO', 5], ['OVO', 30]] as const) {
      const e = await call('POST', '/estoque/movimentar', H, { produtoId: P[k], filialId: A.fA.id, tipo: 'ENTRADA', quantidade: q, motivo: 'saldo inicial' });
      assert.equal(e.s, 200, JSON.stringify(e.b).slice(0, 200));
    }
    const kit = await call('POST', '/produtos', H, { nome: `Kit Bolo ${SUF}`, sku: `KIT${SUF}`, custo: 0, precoVenda: 60, unidade: 'UN', unidadeBaseId: un('UN').id, tipoProdutoId: tipo('KIT').id });
    assert.equal(kit.s, 200, JSON.stringify(kit.b).slice(0, 200));
    kitId = kit.b.id;
  });

  await t.test('2-3. a ficha informa o tipo: KIT (aba visível) x outro tipo (aba oculta)', async () => {
    const f = await call('GET', `/produtos/${kitId}/ficha`, H);
    assert.equal(f.b.produto.tipoProduto.codigo, 'KIT');
    const outro = await call('POST', '/produtos', H, { nome: `Refri ${SUF}`, sku: `REF${SUF}`, custo: 3, precoVenda: 6, tipoProdutoId: tipo('MERCADORIA').id });
    outroId = outro.b.id;
    const fo = await call('GET', `/produtos/${outroId}/ficha`, H);
    assert.notEqual(fo.b.produto.tipoProduto.codigo, 'KIT');
    const k = await call('GET', `/produtos/${kitId}/kit`, H);
    assert.equal(k.s, 200);
    assert.equal(k.b.kit.tipoKit, true);
    assert.deepEqual(k.b.componentes, []);
  });

  await t.test('4. busca de componentes: produtos reais por nome, código, código de barras, grupo, subgrupo e tipo', async () => {
    const q = async (params: string) => (await call('GET', `/produtos/${kitId}/kit/candidatos?${params}`, H)).b.itens.map((i: any) => i.id);
    assert.ok((await q('busca=A%C3%A7%C3%BAcar')).includes(P.ACU), 'por nome');
    assert.deepEqual(await q(`busca=FAR${SUF}`), [P.FAR], 'por código interno');
    assert.deepEqual(await q(`busca=${barrasLeite}`), [P.LEI], 'por código de barras');
    const porGrupo = await q(`categoriaId=${grupoId}`);
    assert.ok(porGrupo.includes(P.CHO) && porGrupo.includes(P.ACU) && porGrupo.includes(P.FAR), 'grupo inclui os subgrupos');
    const porSub = await q(`categoriaId=${subgrupoId}`);
    assert.ok(porSub.includes(P.ACU) && !porSub.includes(P.CHO), 'subgrupo filtra');
    assert.ok((await q(`busca=${encodeURIComponent(`Secos ${SUF}`)}`)).includes(P.FAR), 'pelo nome do subgrupo');
    assert.deepEqual(await q(`tipoProdutoId=${tipo('MATERIA_PRIMA').id}&busca=${SUF}`), [P.LEI], 'por tipo');
    const todos = await q(`busca=${SUF}`);
    assert.ok(!todos.includes(kitId), 'não lista o próprio kit');
    assert.ok(!todos.includes(P.INA), 'não lista inativos');
    const ovo = (await call('GET', `/produtos/${kitId}/kit/candidatos?busca=OVO${SUF}`, H)).b.itens[0];
    assert.deepEqual(ovo.unidades.map((u: any) => u.simbolo).sort(), ['CX', 'CENTO', 'DZ', 'PAR', 'UN'].sort(), 'unidades compatíveis: contagem + caixa com fator');
    assert.equal(ovo.unidades.find((u: any) => u.simbolo === 'CX').fatorParaBase, 12);
  });

  await t.test('5-6. quantidades em KG, G, L, ML e CX com conversão validada', async () => {
    const invalidos: Array<[any, number, string]> = [
      [{ produtoId: P.FAR, quantidade: 1, unidadeId: un('L').id }, 422, 'kg ↔ L sem regra'],
      [{ produtoId: P.ACU, quantidade: 0.5, unidadeId: un('g').id }, 422, '0,5 g = 0,0005 kg: mais de 3 casas'],
      [{ produtoId: P.ACU, quantidade: 0, unidadeId: un('kg').id }, 400, 'quantidade zero'],
      [{ produtoId: P.ACU, quantidade: -1, unidadeId: un('kg').id }, 400, 'quantidade negativa'],
      [{ produtoId: kitId, quantidade: 1 }, 400, 'kit dentro dele mesmo'],
      [{ produtoId: P.INA, quantidade: 1 }, 409, 'componente inativo'],
      [{ produtoId: P.OVO, quantidade: 1, unidadeId: un('PCT').id }, 422, 'pacote sem fator cadastrado'],
    ];
    for (const [c, status, motivo] of invalidos) {
      const r = await call('PUT', `/produtos/${kitId}/kit`, H, { componentes: [c] });
      assert.equal(r.s, status, `${motivo}: ${JSON.stringify(r.b).slice(0, 200)}`);
    }
    const dup = await call('PUT', `/produtos/${kitId}/kit`, H, { componentes: [{ produtoId: P.ACU, quantidade: 1 }, { produtoId: P.ACU, quantidade: 2 }] });
    assert.equal(dup.s, 409, 'componente duplicado');

    const r = await call('PUT', `/produtos/${kitId}/kit`, H, { componentes: [
      { produtoId: P.ACU, quantidade: 1, unidadeId: un('kg').id },
      { produtoId: P.FAR, quantidade: 2000, unidadeId: un('g').id },
      { produtoId: P.LEI, quantidade: 1000, unidadeId: un('mL').id },
      { produtoId: P.CHO, quantidade: 500, unidadeId: un('g').id },
      { produtoId: P.OVO, quantidade: 1, unidadeId: un('CX').id },
    ] });
    assert.equal(r.s, 200, JSON.stringify(r.b).slice(0, 300));
    const base = Object.fromEntries(r.b.componentes.map((c: any) => [c.produtoId, [c.quantidade, c.unidade, c.quantidadeBase, c.unidadeBase]]));
    assert.deepEqual(base[P.FAR], [2000, 'g', 2, 'kg']);
    assert.deepEqual(base[P.LEI], [1000, 'mL', 1, 'L']);
    assert.deepEqual(base[P.CHO], [500, 'g', 0.5, 'kg']);
    assert.deepEqual(base[P.OVO], [1, 'CX', 12, 'UN'], 'CX → UN pelo fator cadastrado');
  });

  await t.test('7. custo total calculado; preço de venda intacto', async () => {
    const k = await call('GET', `/produtos/${kitId}/kit`, H);
    // 1 kg × 5 + 2 kg × 4 + 1 L × 5 + 0,5 kg × 24 + 12 UN × 0,5 = 5 + 8 + 5 + 12 + 6
    assert.equal(k.b.custoTotal, 36);
    const p = await prisma.produto.findUnique({ where: { id: kitId } });
    assert.equal(Number(p?.custo), 36, 'custo do kit gravado');
    assert.equal(Number(p?.precoVenda), 60, 'preço não muda sozinho');
    assert.equal(Number(p?.margem), 40);
    assert.ok(await prisma.produtoPrecoHistorico.findFirst({ where: { produtoId: kitId, campo: 'CUSTO', valorNovo: 36 } }), 'mudança de custo no histórico');
  });

  await t.test('8-9. editar, salvar e reabrir; alteração auditada', async () => {
    const r = await call('PUT', `/produtos/${kitId}/kit`, H, { componentes: [
      { produtoId: P.ACU, quantidade: 1, unidadeId: un('kg').id },
      { produtoId: P.FAR, quantidade: 2, unidadeId: un('kg').id },
      { produtoId: P.LEI, quantidade: 1, unidadeId: un('L').id },
      { produtoId: P.CHO, quantidade: 500, unidadeId: un('g').id },
    ] });
    assert.equal(r.s, 200, JSON.stringify(r.b).slice(0, 200));
    const k = await call('GET', `/produtos/${kitId}/kit`, H);
    assert.equal(k.b.componentes.length, 4, 'ovo removido');
    assert.equal(k.b.custoTotal, 30, 'exemplo do pedido: R$ 30,00');
    assert.deepEqual(k.b.componentes.map((c: any) => c.unidade), ['kg', 'kg', 'L', 'g'], 'reabre com as unidades informadas, na ordem');
    assert.ok(k.b.componentes.every((c: any) => c.unidades.length > 0), 'opções de unidade para edição');
    const aud = await prisma.auditoria.findFirst({ where: { empresaId: A.empresa.id, entidade: 'ComposicaoKit', entidadeId: kitId }, orderBy: { createdAt: 'desc' } });
    assert.ok(aud, 'auditoria da composição');
    assert.equal((aud!.valorAnterior as any).componentes.length, 5);
    assert.equal((aud!.valorNovo as any).componentes.length, 4);
  });

  await t.test('10-11. venda de 1 kit baixa os componentes (nunca o kit) com origem registrada', async () => {
    const cat1 = await call('GET', `/pdv/catalogo?filialId=${A.fA.id}`, H);
    const noPdv = cat1.b.produtos.find((p: any) => p.id === kitId);
    // Farinha: 10 kg / 2 kg = 5; Chocolate: 5 kg / 0,5 kg = 10; Açúcar 10; Leite 10 → 5 kits.
    assert.equal(noPdv.estoqueFilial, 5, 'PDV vê o kit disponível pelos componentes');
    const v = await vender(kitId, 1, 60);
    assert.equal(v.s, 201, JSON.stringify(v.b).slice(0, 300));
    venda1 = v.b.venda.id;
    assert.deepEqual([await saldo(P.ACU), await saldo(P.FAR), await saldo(P.LEI), await saldo(P.CHO)], [9, 8, 9, 4.5]);
    const proprio = await prisma.estoque.aggregate({ where: { produtoId: kitId }, _sum: { quantidade: true } });
    assert.equal(Number(proprio._sum.quantidade ?? 0), 0, 'kit não tem estoque próprio (saldo zero)');
    assert.equal(await prisma.estoqueMovimentacao.count({ where: { produtoId: kitId } }), 0, 'nenhuma movimentação do próprio kit');
    const movs = await prisma.estoqueMovimentacao.findMany({ where: { documento: venda1 } });
    assert.equal(movs.length, 4);
    assert.ok(movs.every((m) => m.kitProdutoId === kitId && m.tipo === 'VENDA'), 'origem: venda de kit');
    const item = await prisma.vendaItem.findFirst({ where: { vendaId: venda1 } });
    assert.equal(Number(item?.custoUnitario), 30, 'CMV do kit = custo dos componentes');
    assert.equal((item?.composicaoKit as any).componentes.length, 4, 'composição usada gravada na venda');
    const fin = await prisma.financeiro.findFirst({ where: { vendaId: venda1 } });
    assert.equal(Number(fin?.valor), 60, 'financeiro com o valor do kit');
  });

  await t.test('12. venda de várias unidades multiplica o consumo', async () => {
    const v = await vender(kitId, 3, 60);
    assert.equal(v.s, 201, JSON.stringify(v.b).slice(0, 300));
    venda3 = v.b.venda.id;
    assert.deepEqual([await saldo(P.ACU), await saldo(P.FAR), await saldo(P.LEI), await saldo(P.CHO)], [6, 2, 6, 3]);
  });

  await t.test('13. estoque insuficiente: venda recusada inteira, sem baixa parcial', async () => {
    const v = await vender(kitId, 2, 60); // farinha precisa 4 kg, tem 2
    assert.equal(v.s, 422, JSON.stringify(v.b));
    assert.match(v.b.error, /Farinha de trigo/);
    assert.deepEqual([await saldo(P.ACU), await saldo(P.FAR), await saldo(P.LEI), await saldo(P.CHO)], [6, 2, 6, 3], 'nada saiu');
    // Componente com estoque negativo liberado não bloqueia (regra do cadastro respeitada).
    await prisma.produto.update({ where: { id: P.FAR }, data: { permiteEstoqueNegativo: true } });
    const pdv = await call('GET', `/pdv/catalogo?filialId=${A.fA.id}`, H);
    assert.equal(pdv.b.produtos.find((p: any) => p.id === kitId).estoqueFilial, 6, 'limite passa a ser o chocolate (3 kg / 0,5)');
    await prisma.produto.update({ where: { id: P.FAR }, data: { permiteEstoqueNegativo: false } });
  });

  await t.test('14. cancelamento (PDV) devolve os componentes e não duplica', async () => {
    const c = await call('POST', `/vendas/${venda3}/cancelar`, H, {});
    assert.equal(c.s, 200, JSON.stringify(c.b).slice(0, 200));
    assert.deepEqual([await saldo(P.ACU), await saldo(P.FAR), await saldo(P.LEI), await saldo(P.CHO)], [9, 8, 9, 4.5]);
    const dev = await prisma.estoqueMovimentacao.findMany({ where: { documento: venda3, tipo: 'DEVOLUCAO' } });
    assert.equal(dev.length, 4);
    assert.ok(dev.every((m) => m.kitProdutoId === kitId), 'estorno mantém o kit de origem');
    const de = await call('POST', `/vendas/${venda3}/cancelar`, H, {});
    assert.equal(de.s, 409, 'segundo cancelamento recusado');
    assert.equal(await saldo(P.FAR), 8, 'sem devolução em dobro');
  });

  await t.test('15. estorno com motivo; estorno só financeiro não mexe no estoque', async () => {
    const e = await call('POST', `/vendas/${venda1}/cancelar`, H, { motivo: 'cliente desistiu', estornarEstoque: true, estornarFinanceiro: true });
    assert.equal(e.s, 200, JSON.stringify(e.b).slice(0, 200));
    assert.deepEqual([await saldo(P.ACU), await saldo(P.FAR), await saldo(P.LEI), await saldo(P.CHO)], [10, 10, 10, 5]);
    const v = await vender(kitId, 1, 60);
    const so = await call('POST', `/vendas/${v.b.venda.id}/cancelar`, H, { motivo: 'só financeiro', estornarEstoque: false, estornarFinanceiro: true });
    assert.equal(so.s, 200);
    assert.equal(await saldo(P.FAR), 8, 'estoque permanece baixado quando o estorno é só financeiro');
  });

  await t.test('16. isolamento entre filiais: baixa só na filial da venda', async () => {
    const pdvB = await call('GET', `/pdv/catalogo?filialId=${A.fB.id}`, H);
    assert.equal(pdvB.b.produtos.find((p: any) => p.id === kitId).estoqueFilial, 0, 'Loja B sem componentes');
    const semSaldo = await vender(kitId, 1, 60, A.fB.id);
    assert.equal(semSaldo.s, 422);
    for (const [k, q] of [['ACU', 1], ['FAR', 2], ['LEI', 1], ['CHO', 0.5]] as const) {
      await call('POST', '/estoque/movimentar', H, { produtoId: P[k], filialId: A.fB.id, tipo: 'ENTRADA', quantidade: q, motivo: 'loja B' });
    }
    const antesA = [await saldo(P.ACU), await saldo(P.FAR), await saldo(P.LEI), await saldo(P.CHO)];
    const v = await vender(kitId, 1, 60, A.fB.id);
    assert.equal(v.s, 201, JSON.stringify(v.b).slice(0, 200));
    assert.deepEqual([await saldo(P.ACU, A.fB.id), await saldo(P.FAR, A.fB.id), await saldo(P.LEI, A.fB.id), await saldo(P.CHO, A.fB.id)], [0, 0, 0, 0]);
    assert.deepEqual([await saldo(P.ACU), await saldo(P.FAR), await saldo(P.LEI), await saldo(P.CHO)], antesA, 'Matriz intacta');
    const disp = (await call('GET', `/produtos/${kitId}/kit`, H)).b.disponibilidade;
    assert.equal(disp.find((d: any) => d.filialId === A.fB.id).kitsPossiveis, 0);
    assert.equal(disp.find((d: any) => d.filialId === A.fA.id).kitsPossiveis, 4, 'Matriz: farinha 8 kg / 2');
  });

  await t.test('17. isolamento entre empresas', async () => {
    assert.equal((await call('GET', `/produtos/${kitId}/kit`, HB)).s, 404);
    assert.equal((await call('GET', `/produtos/${kitId}/kit/candidatos`, HB)).s, 404);
    assert.equal((await call('PUT', `/produtos/${kitId}/kit`, HB, { componentes: [] })).s, 404);
    const catB = (await call('GET', '/produtos/catalogos', HB)).b;
    const kitB = await call('POST', '/produtos', HB, { nome: `Kit B ${SUF}`, sku: `KB${SUF}`, custo: 0, precoVenda: 10, tipoProdutoId: catB.tipos.find((x: any) => x.codigo === 'KIT').id });
    const intruso = await call('PUT', `/produtos/${kitB.b.id}/kit`, HB, { componentes: [{ produtoId: P.ACU, quantidade: 1 }] });
    assert.equal(intruso.s, 404, 'não usa produto de outra empresa');
    const buscaB = (await call('GET', `/produtos/${kitB.b.id}/kit/candidatos?busca=${SUF}`, HB)).b.itens;
    assert.ok(!buscaB.some((i: any) => Object.values(P).includes(i.id)), 'busca não vaza produtos da empresa A');
    assert.equal((await vender(kitId, 1, 60, B.fA.id, HB)).s, 404, 'não vende kit de outra empresa');
  });

  await t.test('18. histórico: movimentações com o kit de origem e consumo por componente', async () => {
    const m = await call('GET', `/produtos/${P.FAR}/movimentacoes?limite=50`, H);
    assert.equal(m.s, 200, JSON.stringify(m.b).slice(0, 200));
    const daVenda = m.b.itens.filter((i: any) => i.kit?.id === kitId);
    assert.ok(daVenda.length >= 5, 'baixas e estornos marcados com o kit');
    assert.ok(daVenda.some((i: any) => i.tipo === 'DEVOLUCAO'));
    const k = (await call('GET', `/produtos/${kitId}/kit`, H)).b;
    // Vendas efetivas: venda1 (estornada), venda3 (cancelada), venda estorno-só-financeiro (estoque mantido), Loja B.
    // Consumo líquido de farinha: 2 (estoque não estornado) + 2 (Loja B) = 4 kg.
    assert.equal(k.consumoComponentes.find((c: any) => c.produtoId === P.FAR).quantidade, 4);
    assert.equal(k.vendas.kitsVendidos, 1, 'só a venda da Loja B segue FINALIZADA');
  });

  await t.test('19. integridade: snapshot, mudança de tipo, produção e custo pela compra', async () => {
    // Snapshot: mudar a composição não altera a venda já feita.
    const antes = (await prisma.vendaItem.findFirst({ where: { vendaId: venda1 } }))!.composicaoKit as any;
    await call('PUT', `/produtos/${kitId}/kit`, H, { componentes: [{ produtoId: P.ACU, quantidade: 2 }, { produtoId: P.FAR, quantidade: 2 }, { produtoId: P.LEI, quantidade: 1 }, { produtoId: P.CHO, quantidade: 0.5 }] });
    const depois = (await prisma.vendaItem.findFirst({ where: { vendaId: venda1 } }))!.composicaoKit as any;
    assert.deepEqual(depois, antes, 'venda passada preserva a composição usada');

    // KIT → outro tipo com composição: bloqueado (nada apagado).
    const troca = await call('PUT', `/produtos/${kitId}`, H, { tipoProdutoId: tipo('MERCADORIA').id });
    assert.equal(troca.s, 409, JSON.stringify(troca.b));
    assert.equal(await prisma.composicaoKit.count({ where: { kitProdutoId: kitId } }), 4, 'composição preservada');
    // Outro tipo → KIT: bloqueado se for componente de kit ou tiver saldo próprio.
    assert.equal((await call('PUT', `/produtos/${P.ACU}`, H, { tipoProdutoId: tipo('KIT').id })).s, 409, 'componente não vira kit');
    await call('POST', '/estoque/movimentar', H, { produtoId: outroId, filialId: A.fA.id, tipo: 'ENTRADA', quantidade: 3, motivo: 'saldo' });
    assert.equal((await call('PUT', `/produtos/${outroId}`, H, { tipoProdutoId: tipo('KIT').id })).s, 409, 'produto com saldo próprio não vira kit');
    // Com composição vazia, o kit pode mudar de tipo.
    const kit2 = await call('POST', '/produtos', H, { nome: `Kit vazio ${SUF}`, sku: `KV${SUF}`, custo: 0, precoVenda: 9, tipoProdutoId: tipo('KIT').id });
    assert.equal((await call('PUT', `/produtos/${kit2.b.id}`, H, { tipoProdutoId: tipo('MERCADORIA').id })).s, 200);
    // Kit sem composição não é vendido (seria venda sem baixa).
    const kit3 = await call('POST', '/produtos', H, { nome: `Kit sem itens ${SUF}`, sku: `KS${SUF}`, custo: 0, precoVenda: 9, tipoProdutoId: tipo('KIT').id });
    assert.equal((await vender(kit3.b.id, 1, 9)).s, 409);
    // Kit não compõe kit.
    assert.equal((await call('PUT', `/produtos/${kit3.b.id}/kit`, H, { componentes: [{ produtoId: kitId, quantidade: 1 }] })).s, 409);
    // Produção é para ficha técnica (fabricado), não para KIT.
    const prod = await call('POST', `/produtos/${kitId}/kit/produzir`, H, { filialId: A.fA.id, quantidade: 1, idempotencyKey: `prod-${SUF}-kit` });
    assert.equal(prod.s, 409, JSON.stringify(prod.b));

    // Compra recebida muda o custo do componente → custo do kit recalculado; preço intacto.
    const forn = await prisma.fornecedor.create({ data: { empresaId: A.empresa.id, nome: `Forn ${SUF}` } });
    await prisma.produto.update({ where: { id: P.ACU }, data: { politicaCusto: 'ULTIMO_CUSTO' } });
    const c = await call('POST', '/compras', H, { filialId: A.fA.id, fornecedorId: forn.id, itens: [{ produtoId: P.ACU, quantidade: 5, valorUnit: 7, unidadeCompra: 'kg' }] });
    assert.ok([200, 201].includes(c.s), `compra: ${JSON.stringify(c.b).slice(0, 300)}`);
    await call('POST', `/compras/${c.b.id}/confirmar`, H);
    const rec = await call('POST', `/compras/${c.b.id}/receber`, H);
    assert.equal(rec.s, 200, JSON.stringify(rec.b).slice(0, 200));
    const kit = await prisma.produto.findUnique({ where: { id: kitId } });
    // 2 kg × 7 + 2 kg × 4 + 1 L × 5 + 0,5 kg × 24 = 14 + 8 + 5 + 12 = 39
    assert.equal(Number(kit?.custo), 39);
    assert.equal(Number(kit?.precoVenda), 60, 'preço de venda nunca muda sozinho');
    assert.ok(await prisma.produtoPrecoHistorico.findFirst({ where: { produtoId: kitId, campo: 'CUSTO', valorNovo: 39, origem: 'COMPRA' } }));

    // Componente inativado depois: continua na composição, sinalizado.
    await call('PATCH', `/produtos/${P.LEI}/status`, H, { status: 'INATIVO' });
    const k = (await call('GET', `/produtos/${kitId}/kit`, H)).b;
    const leite = k.componentes.find((x: any) => x.produtoId === P.LEI);
    assert.equal(leite.ativo, false, 'sinalizado como inativo');
    assert.equal(k.componentes.length, 4, 'histórico preservado');
  });

  await app.close();
});
