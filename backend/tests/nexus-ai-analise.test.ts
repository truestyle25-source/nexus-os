/**
 * TESTE / AVALIAÇÃO — NEXUS AI, Fase 05: previsão de demanda, previsão de caixa, detecção de
 * anomalias e simulador de preço. Cenários com valores conhecidos; cada número conferido por
 * cálculo esperado. Avaliação com o modelo real (Gemini) em NEXUS_AI_AVALIACAO=1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { carregarCatalogo } from '../src/modules/nexus-ai/catalogo.js';
import { executarFerramenta } from '../src/modules/nexus-ai/ferramentas/registro.js';
import { medianaMad, regressao } from '../src/modules/nexus-ai/ferramentas/analise.js';
import { contexto, iniciarInvestigacao } from '../src/modules/nexus-ai/motor.js';
import { agente } from '../src/modules/nexus-ai/agentes/registro.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const AVALIACAO_REAL = process.env.NEXUS_AI_AVALIACAO === '1' && Boolean(process.env.GEMINI_API_KEY);
const SUF = Date.now().toString(36);
const DIA = 86400_000;
const atras = (d: number, h = 1) => new Date(Date.now() - d * DIA - h * 3600_000);
const adiante = (d: number) => new Date(Date.now() + d * DIA);

test('funções puras: regressão e mediana/MAD', () => {
  assert.deepEqual(regressao([10, 10, 10]), { a: 10, b: 0 });
  const r = regressao([0, 1, 2, 3]); assert.equal(r.a, 0); assert.equal(r.b, 1);
  assert.deepEqual(medianaMad([1, 2, 3, 100]), { mediana: 2.5, mad: 1 });
});

test('NEXUS AI — Fase 05: previsões, anomalias e simulador', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test', timeout: 900_000 }, async (t) => {
  carregarCatalogo();
  const criarEmpresa = async (nome: string) => {
    const e = await prisma.empresa.create({ data: { nome: `${nome} ${SUF}`, cnpj: generateRandomValidCnpj() } });
    const f = await prisma.filial.create({ data: { empresaId: e.id, nome: 'Matriz', status: 'ATIVO' } });
    const u = await prisma.usuario.create({ data: { empresaId: e.id, filialId: f.id, nome: 'gestor', email: `g-${nome.replace(/\W/g, '')}-${SUF}@teste.local`, senhaHash: 'x' } });
    await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: u.id, modulo: m, acao: a, permitido: true }))) });
    return { e, f, u };
  };
  const A = await criarEmpresa('Analise A');
  const B = await criarEmpresa('Analise B');
  const semFin = await prisma.usuario.create({ data: { empresaId: B.e.id, filialId: B.f.id, nome: 'vendedor', email: `v-anal-${SUF}@teste.local`, senhaHash: 'x' } });
  await prisma.permissao.createMany({ data: MODULOS.filter((m) => m !== 'financeiro' && m !== 'custos').flatMap((m) => ACOES.map((a) => ({ usuarioId: semFin.id, modulo: m, acao: a, permitido: true }))) });
  const ctxA = contexto(A.e.id, A.u.id); const ctxB = contexto(B.e.id, B.u.id);
  const f = async (ag: string, nome: string, args: Record<string, unknown>, c = ctxA) => (await executarFerramenta(c, nome, agente(ag)!.ferramentas, args)).resultado as any;

  // Empresa A — demanda: farinha 10/dia constante; fermento crescente (t no dia t).
  const prod = (nome: string, custo: number, preco: number) => prisma.produto.create({ data: { empresaId: A.e.id, nome, sku: `${nome.slice(0, 3).toUpperCase()}${SUF}`, unidade: 'UN', custo, precoVenda: preco, status: 'ATIVO' } as any });
  const farinha = await prod('Farinha', 3, 5); const fermento = await prod('Fermento', 2, 4); const bolo = await prod('Bolo', 12, 20);
  await prisma.estoqueMovimentacao.createMany({ data: [
    ...Array.from({ length: 30 }, (_, i) => ({ empresaId: A.e.id, filialId: A.f.id, produtoId: farinha.id, tipo: 'VENDA' as any, quantidade: 10, origem: 'MANUAL' as any, createdAt: atras(29 - i) })),
    ...Array.from({ length: 29 }, (_, i) => ({ empresaId: A.e.id, filialId: A.f.id, produtoId: fermento.id, tipo: 'VENDA' as any, quantidade: i + 1, origem: 'MANUAL' as any, createdAt: atras(28 - i) })),
    { empresaId: A.e.id, filialId: A.f.id, produtoId: farinha.id, tipo: 'PERDA' as any, quantidade: 999, origem: 'MANUAL' as any, createdAt: atras(3) },
  ] });
  await prisma.estoque.create({ data: { empresaId: A.e.id, filialId: A.f.id, produtoId: farinha.id, quantidade: 100 } as any });
  // Caixa: 1 venda de 800 + venda do bolo (200) nas últimas 8 semanas; despesa paga 400; contas em aberto.
  await prisma.venda.create({ data: { empresaId: A.e.id, filialId: A.f.id, formaPagamento: 'PIX', status: 'FINALIZADA', subtotal: 800, desconto: 0, total: 800, createdAt: atras(10) } as any });
  await prisma.venda.create({ data: { empresaId: A.e.id, filialId: A.f.id, formaPagamento: 'PIX', status: 'FINALIZADA', subtotal: 200, desconto: 0, total: 200, createdAt: atras(20), itens: { create: [{ produtoId: bolo.id, quantidade: 10, preco: 20, custoUnitario: 12, desconto: 0, total: 200 }] } } as any });
  const fin = (empresaId: string, tipo: string, categoria: string, valor: number, status: string, extra: Record<string, unknown>) => prisma.financeiro.create({ data: { empresaId, tipo, categoria, descricao: categoria, valor, status, ...extra } as any });
  await fin(A.e.id, 'DESPESA', 'aluguel', 400, 'PAGO', { createdAt: atras(15), pagoEm: atras(15) });
  await fin(A.e.id, 'RECEITA', 'cliente', 200, 'PENDENTE', { vencimento: adiante(3) });
  await fin(A.e.id, 'DESPESA', 'fornecedor', 500, 'PENDENTE', { vencimento: adiante(10) });

  // Empresa B — anomalias: 100/dia na base de 56 dias; queda para 10 há 2 dias; 4 cancelamentos; despesa de manutenção 500.
  await prisma.venda.createMany({ data: Array.from({ length: 63 }, (_, d) => ({ empresaId: B.e.id, filialId: B.f.id, formaPagamento: 'PIX', status: 'FINALIZADA', subtotal: d === 2 ? 10 : 100, desconto: 0, total: d === 2 ? 10 : 100, createdAt: atras(d) })) as any });
  await prisma.venda.createMany({ data: Array.from({ length: 4 }, () => ({ empresaId: B.e.id, filialId: B.f.id, formaPagamento: 'PIX', status: 'CANCELADA', subtotal: 50, desconto: 0, total: 50, createdAt: atras(1) })) as any });
  for (let d = 7; d < 63; d++) await fin(B.e.id, 'DESPESA', 'manutencao', 1, 'PAGO', { createdAt: atras(d), pagoEm: atras(d) });
  await fin(B.e.id, 'DESPESA', 'manutencao', 500, 'PAGO', { createdAt: atras(1), pagoEm: atras(1) });

  try {
    await t.test('Previsão de demanda: constante, tendência, saldo e perdas fora da demanda', async () => {
      const r = await f('estoque', 'previsao_demanda', { historicoDias: 30, horizonteDias: 10 });
      const fa = r.itens.find((i: any) => i.nome === 'Farinha');
      assert.deepEqual([fa.mediaDiariaHistorica, fa.demandaPrevista, fa.saldoAtual, fa.diasAteAcabar, fa.faltaParaOHorizonte, fa.tendenciaPercentualNoHistorico], [10, 100, 100, 10, 0, 0]);
      const fe = r.itens.find((i: any) => i.nome === 'Fermento');
      // série 0,1,2,...,29 → b = 1, a = 0 → dias 30..39 somam 345
      assert.equal(fe.demandaPrevista, 345); assert.equal(fe.saldoAtual, 0); assert.equal(fe.faltaParaOHorizonte, 345);
      assert.equal(r.itens[0].nome, 'Fermento', 'ordenado pela demanda prevista');
    });

    await t.test('Previsão de caixa: só contas x com estimativas', async () => {
      const r = await f('financeiro', 'previsao_caixa', { semanas: 2, semanasHistorico: 8 });
      assert.deepEqual([r.vendasEstimadasPorSemana, r.despesasEstimadasPorSemana], [125, 50]);
      assert.deepEqual(r.projecao.map((p: any) => [p.saldoAcumuladoSoContas, p.saldoAcumuladoComEstimativas]), [[200, 275], [-300, -150]]);
      assert.deepEqual(r.menorSaldoSoContas, { semana: 2, valor: -300 });
    });

    await t.test('Simulador de preço: +10% com elasticidade -1', async () => {
      const r = await f('comercial', 'simular_preco', { produtoId: bolo.id, variacaoPercentual: 10, elasticidade: -1, dias: 30 });
      assert.deepEqual([r.atual.precoMedio, r.atual.custoUnitario, r.atual.quantidade, r.atual.lucroBruto, r.atual.margemPercentual], [20, 12, 10, 80, 40]);
      assert.deepEqual([r.simulado.preco, r.simulado.quantidadeEstimada, r.simulado.lucroBruto, r.simulado.diferencaLucroBruto, r.simulado.margemPercentual], [22, 9, 90, 10, 45.5]);
      assert.equal(r.quantidadeMinimaParaManterLucro, 8);
      await assert.rejects(f('comercial', 'simular_preco', { produtoId: bolo.id, novoPreco: 25 }, contexto(B.e.id, semFin.id)), /Sem permissão \(custos\.visualizar\)/);
      assert.equal((await f('comercial', 'simular_preco', { produtoId: bolo.id, novoPreco: 25 }, ctxB)).erro, 'Produto não encontrado.', 'isolamento por empresa');
    });

    await t.test('Anomalias: queda de vendas, cancelamentos e despesa; nada de falso alarme', async () => {
      const r = await f('comercial', 'detectar_anomalias', { dias: 7, diasBase: 56 }, ctxB);
      const tipos = r.anomalias.map((a: any) => a.tipo).sort();
      assert.deepEqual(tipos, ['CANCELAMENTOS_ACIMA_DO_NORMAL', 'DESPESA_ACIMA_DO_NORMAL', 'QUEDA_DE_VENDAS']);
      const q = r.anomalias.find((a: any) => a.tipo === 'QUEDA_DE_VENDAS');
      assert.deepEqual([q.atual, q.esperado, q.severidade], [10, 100, 'ALTA']);
      const d = r.anomalias.find((a: any) => a.tipo === 'DESPESA_ACIMA_DO_NORMAL');
      assert.deepEqual([d.atual, d.esperado, d.severidade], [500, 7, 'ALTA']);
      const sem = await f('comercial', 'detectar_anomalias', { dias: 7, diasBase: 56 }, contexto(B.e.id, semFin.id));
      assert.deepEqual(sem.areasOmitidasPorPermissao, ['financeiro']);
      assert.equal(sem.anomalias.some((a: any) => a.area === 'financeiro'), false);
      const a = await f('comercial', 'detectar_anomalias', { dias: 7, diasBase: 56 });
      assert.deepEqual(a.anomalias.map((x: any) => x.tipo), ['PERDAS_ACIMA_DO_NORMAL'], 'empresa A: só a perda de 999 unidades');
    });

    const casos: { ag: string; ctx: () => ReturnType<typeof contexto>; pergunta: string; deve: RegExp[] }[] = [
      { ag: 'estoque', ctx: () => ctxA, pergunta: 'Em quantos dias acaba a farinha?', deve: [/10 dias/] },
      { ag: 'comercial', ctx: () => ctxA, pergunta: 'Se eu aumentar o preço do bolo em 10% e as vendas caírem na mesma proporção (elasticidade -1), o que acontece com o lucro?', deve: [/90/, /22/] },
      { ag: 'nexus', ctx: () => ctxB, pergunta: 'Aconteceu algo fora do normal na última semana?', deve: [/cancel/i, /manuten/i] },
    ];
    for (const c of casos) {
      await t.test(`B [${c.ag}] ${c.pergunta}`, { skip: !AVALIACAO_REAL && 'avaliação com modelo real: NEXUS_AI_AVALIACAO=1' }, async () => {
        await new Promise((ok) => setTimeout(ok, 6000));
        const r = await iniciarInvestigacao(c.ctx(), { agenteId: c.ag, pergunta: c.pergunta });
        console.log(`[aval:${c.ag}] ${c.pergunta}\n  → ${String(r.resposta).replace(/\s+/g, ' ').slice(0, 500)}\n  fontes: ${r.detalhes?.fontes.map((x) => x.ferramenta).join(', ')} · verificada: ${r.detalhes?.verificacao?.aprovada} ${r.detalhes?.verificacao?.divergentes?.join(',') ?? ''}`);
        assert.equal(r.status, 'CONCLUIDA');
        assert.equal(r.detalhes?.verificacao?.aprovada, true, 'números conferidos com as ferramentas');
        for (const d of c.deve) assert.match(r.resposta!, d);
      });
    }
  } finally {
    for (const id of [A.e.id, B.e.id]) {
      await prisma.aIMensagem.deleteMany({ where: { empresaId: id } }); await prisma.aIConversa.deleteMany({ where: { empresaId: id } });
      await prisma.aIExecucaoFerramenta.deleteMany({ where: { empresaId: id } }); await prisma.aIExecucao.deleteMany({ where: { empresaId: id } });
      await prisma.aIConsumo.deleteMany({ where: { empresaId: id } }); await prisma.auditoria.deleteMany({ where: { empresaId: id } });
      await prisma.financeiro.deleteMany({ where: { empresaId: id } });
      await prisma.vendaItem.deleteMany({ where: { venda: { empresaId: id } } }); await prisma.venda.deleteMany({ where: { empresaId: id } });
      await prisma.estoqueMovimentacao.deleteMany({ where: { empresaId: id } }); await prisma.estoque.deleteMany({ where: { empresaId: id } });
      await prisma.produto.deleteMany({ where: { empresaId: id } });
      await prisma.permissao.deleteMany({ where: { usuario: { empresaId: id } } }); await prisma.usuario.deleteMany({ where: { empresaId: id } });
      await prisma.filial.deleteMany({ where: { empresaId: id } });
      await prisma.empresa.delete({ where: { id } }).catch((err) => console.log('[limpeza]', String(err.message).match(/constraint[^\n]*/)?.[0]));
    }
  }
});
