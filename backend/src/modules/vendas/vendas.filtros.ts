import type { Prisma } from '@prisma/client';

/**
 * Filtros e KPIs de Vendas — funções PURAS, sem Prisma em runtime.
 *
 * Mesmo padrão de `lib/permissoes-catalogo.ts` e `domain/cnpj.ts`: o tipo
 * `Prisma` entra apenas como `import type` (apagado na compilação), então
 * este módulo pode ser testado com `node:test` sem banco — ver
 * `tests/vendas-filtros.test.ts`.
 *
 * Motivo de existir: a aba Vendas ganhou os filtros do layout de referência
 * (período, status, forma de pagamento, filial, vendedor e busca livre) e os
 * KPIs de "Vendas em Aberto" e "Canceladas / Estornos". Antes, a montagem do
 * `where` vivia solta dentro do handler e não aceitava nada disso.
 */

export const STATUS_VENDA = ['ABERTA', 'FINALIZADA', 'CANCELADA', 'DEVOLVIDA', 'ESTORNADA'] as const;
export type StatusVenda = (typeof STATUS_VENDA)[number];

/** Status que contam no KPI "Canceladas / Estornos" do layout de referência. */
export const STATUS_ENCERRADOS_SEM_RECEITA: readonly StatusVenda[] = ['CANCELADA', 'ESTORNADA', 'DEVOLVIDA'];

export const FORMAS_PAGAMENTO = [
  'DINHEIRO',
  'PIX',
  'CARTAO_CREDITO',
  'CARTAO_DEBITO',
  'BOLETO',
  'TRANSFERENCIA',
  'OUTRO',
] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export type FiltroVendas = {
  filialId?: string;
  clienteId?: string;
  funcionarioId?: string;
  status?: StatusVenda;
  formaPagamento?: FormaPagamento;
  /** Busca livre: bate no ID da venda ou no nome do cliente. */
  busca?: string;
  /** Dia operacional inicial (YYYY-MM-DD ou ISO), no fuso da filial. */
  de?: string;
  /** Dia operacional final (YYYY-MM-DD ou ISO), no fuso da filial. */
  ate?: string;
};

/** Meia-noite local do dia informado. `undefined` quando a data é inválida. */
export function inicioDoDia(iso?: string): Date | undefined {
  if (!iso || typeof iso !== 'string') return undefined;
  const base = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(base.getTime()) ? undefined : base;
}

/** Meia-noite UTC do dia informado. Evita o drift do fuso local quando o banco
 * grava datas sem hora em `Date` (ex.: `2026-10-02T00:00:00.000Z`). */
export function inicioDoDiaUTC(iso?: string): Date | undefined {
  if (!iso || typeof iso !== 'string') return undefined;
  const s = iso.slice(0, 10);
  const [ano, mes, dia] = s.split('-').map(Number);
  if (!ano || !mes || !dia || mes < 1 || mes > 12 || dia < 1) return undefined;
  const base = new Date(Date.UTC(ano, mes - 1, dia));
  return Number.isNaN(base.getTime()) ? undefined : base;
}

/** 23:59:59.999 UTC do dia informado. `undefined` quando a data é inválida. */
export function fimDoDiaUTC(iso?: string): Date | undefined {
  const base = inicioDoDiaUTC(iso);
  if (!base) return undefined;
  const fim = new Date(base);
  fim.setUTCHours(23, 59, 59, 999);
  return fim;
}

/** 23:59:59.999 local do dia informado. `undefined` quando a data é inválida. */
export function fimDoDia(iso?: string): Date | undefined {
  const base = inicioDoDia(iso);
  if (!base) return undefined;
  const fim = new Date(base);
  fim.setHours(23, 59, 59, 999);
  return fim;
}

/**
 * Monta o `where` do Prisma a partir do filtro. Campo vazio/`undefined` não
 * entra no `where` (nunca filtra por string vazia, que devolveria zero linhas)
 * e `empresaId` está sempre presente — isolamento multiempresa não é opcional.
 */
export function montarWhereVendas(empresaId: string, filtro: FiltroVendas): Prisma.VendaWhereInput {
  // Venda.dataOperacional é DATE, normalizado como meia-noite UTC pelo
  // Prisma. Filtrar essa coluna evita depender do fuso do navegador/servidor.
  const de = inicioDoDiaUTC(filtro.de);
  const ate = fimDoDiaUTC(filtro.ate);
  const busca = filtro.busca?.trim();

  return {
    empresaId,
    ...(filtro.filialId ? { filialId: filtro.filialId } : {}),
    ...(filtro.clienteId ? { clienteId: filtro.clienteId } : {}),
    ...(filtro.funcionarioId ? { funcionarioId: filtro.funcionarioId } : {}),
    ...(filtro.status ? { status: filtro.status } : {}),
    ...(filtro.formaPagamento ? { formaPagamento: filtro.formaPagamento } : {}),
    ...(de || ate ? { dataOperacional: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } } : {}),
    ...(busca
      ? {
          OR: [
            { id: { contains: busca } },
            { cliente: { nome: { contains: busca, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
}

/**
 * `groupBy(['status'])` do Prisma → objeto com as 5 chaves do enum sempre
 * presentes (zero quando o status não apareceu). Assim o front nunca precisa
 * tratar `undefined` para montar KPI/contador.
 */
export function normalizarContagemPorStatus(
  grupos: Array<{ status: string; _count?: number | { _all?: number } }>,
): Record<StatusVenda, number> {
  const base = STATUS_VENDA.reduce(
    (acc, s) => ({ ...acc, [s]: 0 }),
    {} as Record<StatusVenda, number>,
  );
  for (const g of grupos) {
    if (!(g.status in base)) continue;
    const bruto = typeof g._count === 'number' ? g._count : g._count?._all ?? 0;
    base[g.status as StatusVenda] = Number(bruto) || 0;
  }
  return base;
}

/** KPI "Canceladas / Estornos": canceladas + estornadas + devolvidas. */
export function contarCanceladasEstornos(porStatus: Partial<Record<StatusVenda, number>>): number {
  return STATUS_ENCERRADOS_SEM_RECEITA.reduce((soma, s) => soma + (Number(porStatus[s]) || 0), 0);
}

/**
 * Variação percentual entre dois valores. `null` quando não existe base de
 * comparação (período anterior zerado) — o front mostra "sem comparativo" em
 * vez de inventar um número.
 */
export function variacaoPercentual(atual: number, anterior: number): number | null {
  const a = Number(atual) || 0;
  const b = Number(anterior) || 0;
  if (b === 0) return null;
  return ((a - b) / b) * 100;
}
