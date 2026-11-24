/**
 * TESTE / AVALIAÇÃO — NEXUS AI, Fase 03: agentes Comercial, Financeiro e Compras.
 * Empresa de teste com valores conhecidos; cada indicador conferido por cálculo esperado (CI).
 * Avaliação com o modelo real (Gemini) em NEXUS_AI_AVALIACAO=1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { carregarCatalogo } from '../src/modules/nexus-ai/catalogo.js';
import { executarFerramenta } from '../src/modules/nexus-ai/ferramentas/registro.js';
import { contexto, iniciarInvestigacao } from '../src/modules/nexus-ai/motor.js';
import { agente } from '../src/modules/nexus-ai/agentes/registro.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const AVALIACAO_REAL = process.env.NEXUS_AI_AVALIACAO === '1' && Boolean(process.env.GEMINI_API_KEY);
const SUF = Date.now().toString(36);
const dias = (d: number) => new Date(Date.now() - d * 86400_000);

test('NEXUS AI — agentes Comercial, Financeiro e Compras', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test', timeout: 900_000 }, async (t) => {
  carregarCatalogo();
  const empresa = await prisma.empresa.create({ data: { nome: `Padaria Esp ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const M = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
  const u = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: M.id, nome: 'gestor', email: `gestor-esp-${SUF}@teste.local`, senhaHash: 'x' } });
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: u.id, modulo: m, acao: a, permitido: true }))) });
  const semCusto = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: M.id, nome: 'vendedor', email: `vend-esp-${SUF}@teste.local`, senhaHash: 'x' } });
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.filter(() => m !== 'custos').map((a) => ({ usuarioId: semCusto.id, modulo: m, acao: a, permitido: true }))) });
  const ctx = contexto(empresa.id, u.id);
  const pao = await prisma.produto.create({ data: { empresaId: empresa.id, nome: 'Pão francês', sku: `PAO${SUF}`, unidade: 'UN', custo: 0.3, precoVenda: 1, status: 'ATIVO' } as any });
  const bolo = await prisma.produto.create({ data: { empresaId: empresa.id, nome: 'Bolo de cenoura', sku: `BOL${SUF}`, unidade: 'UN', custo: 10, precoVenda: 25, status: 'ATIVO' } as any });
  const ana = await prisma.funcionario.create({ data: { empresaId: empresa.id, nome: 'Ana Souza' } as any });
  const bruno = await prisma.funcionario.create({ data: { empresaId: empresa.id, nome: 'Bruno Lima' } as any });
  const c1 = await prisma.cliente.create({ data: { empresaId: empresa.id, nome: 'Mercado Bom', ultimaCompra: dias(5) } as any });
  await prisma.cliente.create({ data: { empresaId: empresa.id, nome: 'Café Antigo', ultimaCompra: dias(100), valorTotalComprado: 500 } as any });
  const venda = (d: number, status: string, total: number, itens: { p: string; q: number; preco: number; custo: number }[], extra: Record<string, unknown> = {}) => prisma.venda.create({ data: { empresaId: empresa.id, filialId: M.id, formaPagamento: 'PIX', status, subtotal: total, desconto: 0, total, createdAt: dias(d), itens: { create: itens.map((i) => ({ produtoId: i.p, quantidade: i.q, preco: i.preco, custoUnitario: i.custo, desconto: 0, total: i.q * i.preco })) }, ...extra } as any });
  await venda(5, 'FINALIZADA', 100, [{ p: pao.id, q: 50, preco: 1, custo: 0.3 }, { p: bolo.id, q: 2, preco: 25, custo: 10 }], { funcionarioId: ana.id, clienteId: c1.id });
  await venda(10, 'FINALIZADA', 50, [{ p: bolo.id, q: 2, preco: 25, custo: 10 }], { funcionarioId: bruno.id, formaPagamento: 'CARTAO_CREDITO' });
  await venda(3, 'CANCELADA', 30, [{ p: pao.id, q: 30, preco: 1, custo: 0.3 }]);
  await venda(40, 'FINALIZADA', 300, [{ p: bolo.id, q: 12, preco: 25, custo: 10 }]);
  const fin = (tipo: string, categoria: string, valor: number, status: string, criado: number, venc?: number) => prisma.financeiro.create({ data: { empresaId: empresa.id, tipo, categoria, descricao: `${categoria} ${valor}`, valor, status, createdAt: dias(criado), ...(venc !== undefined ? { vencimento: dias(venc) } : {}) } as any });
  await fin('RECEITA', 'vendas', 150, 'PAGO', 5); await fin('DESPESA', 'aluguel', 1000, 'PAGO', 8); await fin('DESPESA', 'energia', 200, 'PAGO', 6); await fin('DESPESA', 'energia', 100, 'PAGO', 40);
  await fin('RECEITA', 'cliente', 400, 'PENDENTE', 15, 10); await fin('DESPESA', 'fornecedor', 300, 'PENDENTE', 2, -3); await fin('DESPESA', 'fornecedor', 700, 'PENDENTE', 2, -10);
  const fa = await prisma.fornecedor.create({ data: { empresaId: empresa.id, nome: 'Moinho Sul' } as any });
  const fb = await prisma.fornecedor.create({ data: { empresaId: empresa.id, nome: 'Trigal' } as any });
  const compra = (f: string, d: number, status: string, preco: number, q: number, extra: Record<string, unknown> = {}) => prisma.compra.create({ data: { empresaId: empresa.id, filialId: M.id, fornecedorId: f, status, valorTotal: preco * q, dataCompra: dias(d), itens: { create: [{ produtoId: pao.id, quantidade: q, valorUnit: preco }] }, ...extra } as any });
  await compra(fa.id, 120, 'RECEBIDA', 0.25, 1000); await compra(fa.id, 40, 'RECEBIDA', 0.3, 1000); await compra(fb.id, 10, 'ENVIADA', 0.28, 1000, { previsaoEntrega: dias(2) });
  await prisma.fornecedorProduto.create({ data: { empresaId: empresa.id, fornecedorId: fa.id, produtoId: pao.id, ultimoPrecoCompra: 0.3, prazoEntregaDias: 3, status: 'ATIVO' } as any });
  await prisma.fornecedorProduto.create({ data: { empresaId: empresa.id, fornecedorId: fb.id, produtoId: pao.id, ultimoPrecoCompra: 0.28, prazoEntregaDias: 5, status: 'ATIVO' } as any });
  const ferr = (ag: string) => agente(ag)!.ferramentas;
  const f = async (ag: string, nome: string, args: Record<string, unknown> = {}, c = ctx) => (await executarFerramenta(c, nome, ferr(ag), args)).resultado as any;

  try {
    await t.test('Comercial: resumo com comparação, ABC, margem, vendedores e clientes', async () => {
      const r = await f('comercial', 'resumo_vendas', { dias: 30 });
      assert.deepEqual([r.atual.vendas, r.atual.faturamento, r.atual.ticketMedio, r.atual.canceladasOuDevolvidas, r.atual.valorCanceladoOuDevolvido], [2, 150, 75, 1, 30]);
      assert.equal(r.anterior.faturamento, 300); assert.equal(r.variacaoFaturamentoPercentual, -50);
      const p = await f('comercial', 'vendas_por_produto', { dias: 30 });
      assert.deepEqual(p.itens.map((i: any) => [i.nome, i.faturamento, i.curva]), [['Bolo de cenoura', 100, 'A'], ['Pão francês', 50, 'C']]);
      assert.equal(p.itens[0].participacaoPercentual, 66.7);
      const m = await f('comercial', 'margem_por_produto', { dias: 30, ordem: 'MAIOR_MARGEM' });
      assert.deepEqual([m.custoTotal, m.lucroBrutoTotal, m.margemBrutaPercentual], [55, 95, 63.3]);
      assert.deepEqual(m.itens.map((i: any) => [i.nome, i.margemPercentual]), [['Pão francês', 70], ['Bolo de cenoura', 60]]);
      const v = await f('comercial', 'vendas_por_vendedor', { dias: 30 });
      assert.deepEqual(v.vendedores.map((x: any) => [x.vendedor, x.faturamento]), [['Ana Souza', 100], ['Bruno Lima', 50]]);
      const c = await f('comercial', 'clientes_principais', { dias: 90, inativosHaDias: 60 });
      assert.deepEqual(c.principais.map((x: any) => [x.cliente, x.faturamento]), [['Mercado Bom', 100]]);
      assert.equal(c.vendasSemClienteIdentificado, 2); assert.deepEqual(c.inativos.map((x: any) => x.cliente), ['Café Antigo']);
      const d = await f('comercial', 'vendas_por_dia', { dias: 30 });
      assert.equal(d.diasComVenda, 2); assert.equal(d.melhorDia.faturamento, 100);
    });

    await t.test('Comercial: margem exige permissão de custos', async () => {
      await assert.rejects(f('comercial', 'margem_por_produto', { dias: 30 }, contexto(empresa.id, semCusto.id)), /Sem permissão \(custos\.visualizar\)/);
    });

    await t.test('Financeiro: realizado, abertos, vencidos, fluxo, categorias e DRE', async () => {
      const r = await f('financeiro', 'resumo_financeiro', { dias: 30 });
      assert.deepEqual(r.realizado, { receitasPagas: 150, despesasPagas: 1200, saldo: -1050 });
      assert.deepEqual([r.emAberto.aReceber, r.emAberto.aPagar, r.emAberto.receberVencido, r.emAberto.pagarVencido], [400, 1000, 400, 0]);
      const v = await f('financeiro', 'contas_vencidas', { tipo: 'RECEITA' });
      assert.equal(v.totalVencido, 400); assert.equal(v.itens[0].diasDeAtraso, 10);
      const fl = await f('financeiro', 'fluxo_caixa_projetado', { semanas: 4 });
      assert.deepEqual(fl.projecao.slice(0, 2).map((s: any) => [s.entradas, s.saidas, s.saldoAcumulado]), [[400, 300, 100], [0, 700, -600]]);
      assert.deepEqual(fl.menorSaldoAcumulado, { semana: 2, valor: -600 });
      const dc = await f('financeiro', 'despesas_por_categoria', { dias: 30 });
      assert.equal(dc.totalAtual, 1200); assert.equal(dc.totalAnterior, 100);
      assert.deepEqual(dc.maioresAumentos.map((x: any) => [x.categoria, x.variacao]), [['aluguel', 1000], ['energia', 100]]);
      const dre = await f('financeiro', 'resultado_periodo', { dias: 30 });
      assert.deepEqual([dre.atual.receita, dre.atual.custoMercadorias, dre.atual.lucroBruto, dre.atual.margemBrutaPercentual, dre.atual.despesasPagas, dre.atual.resultado], [150, 55, 95, 63.3, 1200, -1105]);
      assert.deepEqual([dre.anterior.receita, dre.anterior.lucroBruto, dre.anterior.resultado], [300, 180, 80]);
      assert.equal(dre.variacaoMargemBrutaPontos, 3.3);
    });

    await t.test('Compras: resumo, pendentes com atraso, histórico de custo e fornecedores', async () => {
      const r = await f('compras', 'resumo_compras', { dias: 30 });
      assert.equal(r.totalComprado, 280); assert.deepEqual(r.principaisFornecedores.map((x: any) => x.fornecedor), ['Trigal']);
      const p = await f('compras', 'compras_pendentes');
      assert.equal(p.pedidosEmAberto, 1); assert.equal(p.atrasados, 1); assert.equal(p.itens[0].diasDeAtraso, 2); assert.equal(p.valorEmAberto, 280);
      const h = await f('compras', 'historico_custo_produto', { produtoId: pao.id, dias: 180 });
      assert.deepEqual(h.compras.map((c: any) => c.precoUnitario), [0.25, 0.3, 0.28]); assert.equal(h.variacaoPercentual, 12);
      const c = await f('compras', 'comparar_fornecedores', { produtoId: pao.id });
      assert.deepEqual(c.menorUltimoPreco, { fornecedor: 'Trigal', preco: 0.28 });
      assert.equal(c.fornecedores.find((x: any) => x.fornecedor === 'Moinho Sul').comprasEm365d, 2);
    });

    const casos: { ag: string; pergunta: string; deve: (RegExp | string)[] }[] = [
      { ag: 'comercial', pergunta: 'Como foram as vendas nos últimos 30 dias comparadas com os 30 dias anteriores?', deve: [/150/, /-?50/] },
      { ag: 'comercial', pergunta: 'Qual produto teve a maior margem bruta nos últimos 30 dias?', deve: [/p[aã]o/i, '70'] },
      { ag: 'financeiro', pergunta: 'Como está o fluxo de caixa das próximas 4 semanas? Em alguma semana o saldo fica negativo?', deve: [/600/] },
      { ag: 'financeiro', pergunta: 'Por que o resultado dos últimos 30 dias ficou negativo?', deve: [/1\.?105/, /aluguel|1\.?000|1\.?200/i] },
      { ag: 'compras', pergunta: 'Qual fornecedor tem o menor último preço para o pão francês?', deve: [/trigal/i, /0[,.]28/] },
      { ag: 'compras', pergunta: 'Existe algum pedido de compra atrasado?', deve: [/trigal/i, /2 dia/] },
    ];
    for (const c of casos) {
      await t.test(`B [${c.ag}] ${c.pergunta}`, { skip: !AVALIACAO_REAL && 'avaliação com modelo real: NEXUS_AI_AVALIACAO=1' }, async () => {
        await new Promise((ok) => setTimeout(ok, 6000));
        const r = await iniciarInvestigacao(contexto(empresa.id, u.id), { agenteId: c.ag, pergunta: c.pergunta });
        console.log(`[aval:${c.ag}] ${c.pergunta}\n  → ${String(r.resposta).replace(/\s+/g, ' ').slice(0, 450)}\n  fontes: ${r.detalhes?.fontes.map((x) => x.ferramenta).join(', ')} · verificada: ${r.detalhes?.verificacao?.aprovada} ${r.detalhes?.verificacao?.divergentes?.join(',') ?? ''}`);
        assert.equal(r.status, 'CONCLUIDA');
        assert.equal(r.detalhes?.verificacao?.aprovada, true, 'números conferidos com as ferramentas');
        for (const d of c.deve) assert.ok(typeof d === 'string' ? r.resposta!.includes(d) : d.test(r.resposta!), `esperado ${d}`);
      });
    }
  } finally {
    const id = empresa.id;
    await prisma.aIMensagem.deleteMany({ where: { empresaId: id } }); await prisma.aIConversa.deleteMany({ where: { empresaId: id } });
    await prisma.aIExecucaoFerramenta.deleteMany({ where: { empresaId: id } }); await prisma.aIExecucao.deleteMany({ where: { empresaId: id } });
    await prisma.aIConsumo.deleteMany({ where: { empresaId: id } }); await prisma.auditoria.deleteMany({ where: { empresaId: id } });
    await prisma.fornecedorProduto.deleteMany({ where: { empresaId: id } });
    await prisma.compraItem.deleteMany({ where: { compra: { empresaId: id } } }); await prisma.compra.deleteMany({ where: { empresaId: id } });
    await prisma.fornecedor.deleteMany({ where: { empresaId: id } });
    await prisma.financeiro.deleteMany({ where: { empresaId: id } });
    await prisma.vendaItem.deleteMany({ where: { venda: { empresaId: id } } }); await prisma.venda.deleteMany({ where: { empresaId: id } });
    await prisma.cliente.deleteMany({ where: { empresaId: id } }); await prisma.funcionario.deleteMany({ where: { empresaId: id } });
    await prisma.produto.deleteMany({ where: { empresaId: id } });
    await prisma.permissao.deleteMany({ where: { usuario: { empresaId: id } } }); await prisma.usuario.deleteMany({ where: { empresaId: id } });
    await prisma.filial.deleteMany({ where: { empresaId: id } });
    await prisma.empresa.delete({ where: { id } }).catch((err) => console.log('[limpeza]', String(err.message).match(/constraint[^\n]*/)?.[0]));
  }
});
