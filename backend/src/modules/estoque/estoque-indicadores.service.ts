import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Captura a posição atual de Estoque como snapshot do dia (Seção 9 —
 * decisão registrada no schema.prisma acima de EstoqueSnapshotDiario e em
 * DEBITO-TECNICO.md item 8). Idempotente: repetir no mesmo dia atualiza o
 * snapshot em vez de duplicar.
 *
 * Este projeto não inclui um agendador (cron) próprio — Section 29 é o
 * motor de regras, não um scheduler de jobs. Rode isto uma vez por dia via:
 *   a) `npm run estoque:snapshot` (src/scripts/gerarSnapshotsDiarios.ts),
 *      chamado por um cron externo (systemd timer, cron do provedor, etc.); ou
 *   b) POST /estoque/snapshot/gerar, chamado por um scheduler HTTP
 *      (ex.: cron jobs de plataformas que só conseguem bater numa URL).
 * Nenhuma das duas formas dispara sozinha — registrar isso como pendência
 * de operação, não fingir automação que não existe.
 */
export async function gerarSnapshotDoDia(empresaId: string, dataRef: Date = new Date()): Promise<{ processados: number }> {
  const dia = new Date(dataRef);
  dia.setHours(0, 0, 0, 0);
  const estoques = await prisma.estoque.findMany({
    where: { empresaId },
    include: { produto: { select: { custo: true } } },
  });
  for (const e of estoques) {
    await prisma.estoqueSnapshotDiario.upsert({
      where: { filialId_produtoId_data: { filialId: e.filialId, produtoId: e.produtoId, data: dia } },
      update: { quantidade: e.quantidade, custoUnitario: e.produto.custo, valorTotal: e.valorTotal },
      create: {
        empresaId,
        filialId: e.filialId,
        produtoId: e.produtoId,
        data: dia,
        quantidade: e.quantidade,
        custoUnitario: e.produto.custo,
        valorTotal: e.valorTotal,
      },
    });
  }
  return { processados: estoques.length };
}

export interface IndicadorGiroProduto {
  produtoId: string;
  estoqueMedioPeriodo: number | null;
  consumoPeriodo: number;
  giro: number | null;
  coberturaDias: number | null;
  tendencia: 'CRESCENTE' | 'DECRESCENTE' | 'ESTAVEL';
  // true quando o cálculo ainda não tem snapshots suficientes no período e
  // caiu no fallback aproximado (saídas ÷ estoque atual) — ver Seção 9.
  aproximado: boolean;
}

/**
 * Giro, cobertura de estoque e tendência por produto, usando snapshots
 * diários quando existem. Enquanto o histórico de snapshots do período for
 * curto (menos da metade dos dias do período têm snapshot), o resultado
 * daquele produto volta para a aproximação simples e vem marcado
 * `aproximado: true` — nunca finge precisão que os dados não sustentam.
 */
export async function calcularGiroPorProduto(
  empresaId: string,
  opcoes: { filialId?: string; diasPeriodo?: number },
): Promise<IndicadorGiroProduto[]> {
  const diasPeriodo = opcoes.diasPeriodo ?? 30;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const desde = new Date(hoje);
  desde.setDate(desde.getDate() - diasPeriodo);

  const whereSaida: Prisma.EstoqueMovimentacaoWhereInput = {
    empresaId,
    tipo: { in: ['SAIDA', 'VENDA'] },
    createdAt: { gte: desde },
    ...(opcoes.filialId ? { filialId: opcoes.filialId } : {}),
  };
  const saidas = await prisma.estoqueMovimentacao.groupBy({ by: ['produtoId'], where: whereSaida, _sum: { quantidade: true } });
  const consumoPorProduto = new Map<string, number>(
    saidas.map((s: { produtoId: string; _sum: { quantidade: number | null } }) => [s.produtoId, Math.abs(s._sum.quantidade ?? 0)]),
  );

  const whereSnapshot: Prisma.EstoqueSnapshotDiarioWhereInput = {
    empresaId,
    data: { gte: desde, lte: hoje },
    ...(opcoes.filialId ? { filialId: opcoes.filialId } : {}),
  };
  const snapshots = await prisma.estoqueSnapshotDiario.findMany({ where: whereSnapshot, orderBy: { data: 'asc' } });

  const porProduto = new Map<string, Map<number, number>>(); // produtoId -> (dataMs -> quantidade somada entre filiais)
  for (const s of snapshots) {
    const porDia = porProduto.get(s.produtoId) ?? new Map<number, number>();
    const chave = s.data.getTime();
    porDia.set(chave, (porDia.get(chave) ?? 0) + s.quantidade);
    porProduto.set(s.produtoId, porDia);
  }

  const diasComSnapshotMinimos = Math.ceil(diasPeriodo * 0.5);
  const resultado: IndicadorGiroProduto[] = [];
  const produtosComSnapshot = new Set(porProduto.keys());

  for (const [produtoId, porDia] of porProduto) {
    const pontos = [...porDia.entries()].sort((a, b) => a[0] - b[0]).map(([data, quantidade]) => ({ data, quantidade }));
    const consumoPeriodo = consumoPorProduto.get(produtoId) ?? 0;

    if (pontos.length < diasComSnapshotMinimos) {
      const estoqueAtualAprox = pontos.length ? pontos[pontos.length - 1].quantidade : null;
      resultado.push({
        produtoId,
        estoqueMedioPeriodo: estoqueAtualAprox,
        consumoPeriodo,
        giro: estoqueAtualAprox && estoqueAtualAprox > 0 ? consumoPeriodo / estoqueAtualAprox : null,
        coberturaDias: null,
        tendencia: 'ESTAVEL',
        aproximado: true,
      });
      continue;
    }

    const estoqueMedio = pontos.reduce((soma, p) => soma + p.quantidade, 0) / pontos.length;
    const giro = estoqueMedio > 0 ? consumoPeriodo / estoqueMedio : null;
    const consumoDiarioMedio = consumoPeriodo / diasPeriodo;
    const coberturaDias = consumoDiarioMedio > 0 ? estoqueMedio / consumoDiarioMedio : null;

    const metade = Math.floor(pontos.length / 2);
    const primeira = pontos.slice(0, metade);
    const segunda = pontos.slice(metade);
    const mediaPrimeira = primeira.reduce((s, p) => s + p.quantidade, 0) / (primeira.length || 1);
    const mediaSegunda = segunda.reduce((s, p) => s + p.quantidade, 0) / (segunda.length || 1);
    let tendencia: IndicadorGiroProduto['tendencia'] = 'ESTAVEL';
    if (mediaPrimeira > 0) {
      const variacao = (mediaSegunda - mediaPrimeira) / mediaPrimeira;
      if (variacao > 0.05) tendencia = 'CRESCENTE';
      else if (variacao < -0.05) tendencia = 'DECRESCENTE';
    }

    resultado.push({ produtoId, estoqueMedioPeriodo: estoqueMedio, consumoPeriodo, giro, coberturaDias, tendencia, aproximado: false });
  }

  // Produtos que tiveram saída no período mas ainda não têm nenhum snapshot.
  for (const [produtoId, consumoPeriodo] of consumoPorProduto) {
    if (!produtosComSnapshot.has(produtoId)) {
      resultado.push({ produtoId, estoqueMedioPeriodo: null, consumoPeriodo, giro: null, coberturaDias: null, tendencia: 'ESTAVEL', aproximado: true });
    }
  }

  return resultado;
}
