import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { NaoEncontrado, Conflito } from '../../lib/erros.js';
import { clean } from '../../lib/format.js';

/**
 * Serviço da aba /fornecedores (Seção 11 v2 — artefato
 * "nexus-fornecedores-add-v2"). Todo acesso é filtrado por `empresaId`
 * (multi-tenant): o escopo NUNCA vem do corpo da request, sempre do JWT.
 */

export type StatusFornecedor = 'Ativo' | 'Crítico' | 'Inativo';
export const STATUS_FORNECEDORES: StatusFornecedor[] = ['Ativo', 'Crítico', 'Inativo'];

export const CATEGORIAS_FORNECEDOR = [
  'Malharia', 'Jeans', 'Bonés', 'Acessórios', 'Calçados', 'Outros',
] as const;

export const CONDICOES_PAGAMENTO = ['À vista', '30 dias', '30/60', '30/60/90'] as const;

export interface CriarFornecedorInput {
  empresaId: string;
  nome: string;
  cnpj?: string;
  categoria: string;
  status?: string;
  contato?: string;
  whatsapp?: string;
  email?: string;
  telefone?: string;
  produtos?: string;
  condicaoPagamento?: string;
  observacoes?: string;
}

export interface FiltroListagemFornecedores {
  empresaId: string;
  status?: string;
  categoria?: string;
  busca?: string;
}

function normalizarStatus(status?: string): StatusFornecedor {
  if (!status) return 'Ativo';
  const s = status.trim().toLowerCase();
  if (s === 'crítico' || s === 'critico') return 'Crítico';
  // ARQUIVADO e INATIVO são o mesmo estado (é o que a migração 202609240003
  // gravou). Sem o caso 'arquivado' aqui, o legado caía no `return 'Ativo'`
  // do fim e um fornecedor arquivado era filtrado como ATIVO.
  if (s === 'inativo' || s === 'arquivado') return 'Inativo';
  return 'Ativo';
}

/** CNPJ duplicado por empresa é 409 (mesma regra do cadastro legado). */
async function checarCnpjDuplicado(empresaId: string, cnpj: string | undefined, excetoId?: string): Promise<void> {
  const limpo = clean(cnpj);
  if (!limpo) return;
  const existente = await prisma.fornecedor.findFirst({
    where: { empresaId, cnpj: limpo, ...(excetoId ? { NOT: { id: excetoId } } : {}) },
    select: { id: true },
  });
  if (existente) throw Conflito('Já existe um fornecedor com este CNPJ nesta empresa.');
}

export async function create(input: CriarFornecedorInput) {
  await checarCnpjDuplicado(input.empresaId, input.cnpj);
  return prisma.fornecedor.create({
    data: {
      empresaId: input.empresaId,
      nome: input.nome.trim(),
      cnpj: clean(input.cnpj) ?? null,
      categoria: input.categoria,
      status: normalizarStatus(input.status),
      contato: input.contato?.trim() || null,
      whatsapp: input.whatsapp?.trim() || null,
      email: input.email?.trim() || null,
      telefone: input.telefone?.trim() || null,
      produtos: input.produtos?.trim() || null,
      condicaoPagamento: input.condicaoPagamento ?? null,
      observacoes: input.observacoes?.trim() || null,
      origem: 'MANUAL',
    },
  });
}

// ===== Pedidos do fornecedor ==================================================
//
// FONTE DA VERDADE: a tabela `Compra` (módulo Compras).
//
// Antes esta aba lia `CompraFornecedor` e as colunas desnormalizadas
// `Fornecedor.totalComprado/totalPedidos/ultimoPedidoAt`. Nenhum código da
// aplicação preenchia nenhuma das duas: só a migração 202609240003 fazia
// backfill. Resultado: todo pedido criado depois da migração era INVISÍVEL
// para esta aba — gasto do mês, ticket, histórico do gráfico, pedidos
// pendentes/atrasados, insights e as colunas "Total Comprado"/"Pedidos"
// ficavam congelados nos valores do dia da migração (zero, na maioria das
// instalações). Ler `Compra` resolve sem depender de nenhum hook: a conta
// fica correta para os pedidos antigos E para os novos, sem estado duplicado
// para divergir.

/**
 * Dias sem recebimento, após a confirmação do pedido, para ele ser contado
 * como ATRASADO. `Compra` não tem "data prometida de entrega", então sem um
 * prazo o KPI de atraso ficaria sempre 0 — honesto, porém inútil. 30 dias é o
 * mesmo horizonte que a própria aba usa em CONDICOES_PAGAMENTO ('30 dias'),
 * então não é um número inventado aqui: é a condição de pagamento padrão
 * declarada pelo próprio cadastro do fornecedor.
 */
export const DIAS_PARA_CONSIDERAR_ATRASO = 30;

export type StatusPedido = 'Pendente' | 'Entregue' | 'Atrasado';

interface CompraLegivel {
  status: string;
  dataCompra: Date;
}

/**
 * Traduz o status da `Compra` para o vocabulário de pedido da aba.
 *
 * CANCELADA devolve `null`: compra cancelada não é pedido, então não entra em
 * gasto, ticket médio nem contagem. A regra é a MESMA que a migração aplicou
 * no backfill (SOLICITADA/PEDIDO -> Pendente, RECEBIDA -> Entregue,
 * CANCELADA ignorada), acrescida da regra de atraso acima.
 */
export function classificarPedido(compra: CompraLegivel, agora = new Date()): StatusPedido | null {
  if (compra.status === 'CANCELADA') return null;
  if (compra.status === 'RECEBIDA') return 'Entregue';
  if (compra.status === 'PEDIDO') {
    const limite = new Date(compra.dataCompra);
    limite.setDate(limite.getDate() + DIAS_PARA_CONSIDERAR_ATRASO);
    return agora > limite ? 'Atrasado' : 'Pendente';
  }
  return 'Pendente'; // SOLICITADA: ainda nem confirmado com o fornecedor
}

/** Compras que contam como pedido (tudo menos cancelada). */
function ondeContaComoPedido(empresaId: string): Prisma.CompraWhereInput {
  return { empresaId, status: { not: 'CANCELADA' } };
}

export interface ResumoFornecedor {
  total: number;
  pedidos: number;
  ultimo: Date | null;
}

/**
 * Totais REAIS por fornecedor, derivados de `Compra`. Substitui as colunas
 * desnormalizadas — o nome do retorno é o mesmo (`totalComprado`,
 * `totalPedidos`, `ultimoPedidoAt`), então a tela não muda.
 */
async function resumoPorFornecedor(empresaId: string): Promise<Map<string, ResumoFornecedor>> {
  const grouped = await prisma.compra.groupBy({
    by: ['fornecedorId'],
    where: ondeContaComoPedido(empresaId),
    _sum: { valorTotal: true },
    _count: { _all: true },
    _max: { dataCompra: true },
  });
  return new Map(
    grouped.map((g) => [
      g.fornecedorId,
      {
        total: Number(g._sum.valorTotal ?? 0),
        pedidos: g._count._all,
        ultimo: g._max.dataCompra,
      },
    ]),
  );
}

/**
 * Resumo de UM fornecedor. Usa uma consulta direcionada em vez de agregar a
 * empresa inteira (`update` roda a cada edição; `getById` a cada detalhe).
 */
async function resumoDe(fornecedorId: string, empresaId: string): Promise<ResumoFornecedor> {
  const r = await prisma.compra.aggregate({
    where: { fornecedorId, ...ondeContaComoPedido(empresaId) },
    _sum: { valorTotal: true },
    _count: { _all: true },
    _max: { dataCompra: true },
  });
  return {
    total: Number(r._sum.valorTotal ?? 0),
    pedidos: r._count._all,
    ultimo: r._max.dataCompra,
  };
}

export async function list(filtro: FiltroListagemFornecedores) {
  const where: Prisma.FornecedorWhereInput = { empresaId: filtro.empresaId };
  if (filtro.status) where.status = normalizarStatus(filtro.status);
  if (filtro.categoria) where.categoria = filtro.categoria;
  if (filtro.busca?.trim()) {
    const termo = filtro.busca.trim();
    where.OR = [
      { nome: { contains: termo, mode: 'insensitive' } },
      { cnpj: { contains: termo, mode: 'insensitive' } },
      { contato: { contains: termo, mode: 'insensitive' } },
    ];
  }
  const [fornecedores, resumo] = await Promise.all([
    prisma.fornecedor.findMany({ where }),
    resumoPorFornecedor(filtro.empresaId),
  ]);

  const comTotais = fornecedores.map((f) => {
    const r = resumo.get(f.id);
    return {
      ...f,
      totalComprado: r?.total ?? 0,
      totalPedidos: r?.pedidos ?? 0,
      ultimoPedidoAt: r?.ultimo ?? null,
    };
  });

  // Ordena pelo total REAL (a coluna antiga só era escrita pela migração) e
  // desempata pelo nome para a lista não ficar instável entre carregamentos.
  comTotais.sort((a, b) => b.totalComprado - a.totalComprado || a.nome.localeCompare(b.nome, 'pt-BR'));
  return comTotais;
}

export async function getById(id: string, empresaId: string) {
  const fornecedor = await prisma.fornecedor.findFirst({ where: { id, empresaId } });
  if (!fornecedor) throw NaoEncontrado('Fornecedor não encontrado nesta empresa.');

  // Os últimos pedidos vêm de `Compra` (fonte da verdade), e não de
  // `comprasFornecedor` — que era uma relação que nada preenchia.
  const [compras, resumo] = await Promise.all([
    prisma.compra.findMany({
      where: { fornecedorId: id, ...ondeContaComoPedido(empresaId) },
      orderBy: { dataCompra: 'desc' },
      take: 20,
      select: {
        id: true, valorTotal: true, status: true, dataCompra: true, dataRecebimento: true,
        filial: { select: { nome: true } },
      },
    }),
    resumoDe(id, empresaId),
  ]);

  return {
    ...fornecedor,
    totalComprado: resumo.total,
    totalPedidos: resumo.pedidos,
    ultimoPedidoAt: resumo.ultimo,
    compras: compras.map((c) => ({
      ...c,
      valor: Number(c.valorTotal),
      statusPedido: classificarPedido(c),
    })),
  };
}

export type AtualizarFornecedorInput = Partial<Omit<CriarFornecedorInput, 'empresaId'>>;

export async function update(id: string, empresaId: string, dados: AtualizarFornecedorInput) {
  const anterior = await prisma.fornecedor.findFirst({ where: { id, empresaId }, select: { id: true, cnpj: true } });
  if (!anterior) throw NaoEncontrado('Fornecedor não encontrado nesta empresa.');
  if (dados.cnpj !== undefined) await checarCnpjDuplicado(empresaId, dados.cnpj, id);

  const atualizado = await prisma.fornecedor.update({
    where: { id },
    data: {
      ...(dados.nome !== undefined ? { nome: dados.nome.trim() } : {}),
      ...(dados.cnpj !== undefined ? { cnpj: clean(dados.cnpj) ?? null } : {}),
      ...(dados.categoria !== undefined ? { categoria: dados.categoria } : {}),
      ...(dados.status !== undefined ? { status: normalizarStatus(dados.status) } : {}),
      ...(dados.contato !== undefined ? { contato: dados.contato.trim() || null } : {}),
      ...(dados.whatsapp !== undefined ? { whatsapp: dados.whatsapp.trim() || null } : {}),
      ...(dados.email !== undefined ? { email: dados.email.trim() || null } : {}),
      ...(dados.telefone !== undefined ? { telefone: dados.telefone.trim() || null } : {}),
      ...(dados.produtos !== undefined ? { produtos: dados.produtos.trim() || null } : {}),
      ...(dados.condicaoPagamento !== undefined ? { condicaoPagamento: dados.condicaoPagamento } : {}),
      ...(dados.observacoes !== undefined ? { observacoes: dados.observacoes.trim() || null } : {}),
      updatedAt: new Date(),
    },
  });

  // `update` devolve a linha crua do Prisma, com as colunas desnormalizadas
  // que nada mantém (ver nota de fonte da verdade no topo do arquivo). Sem
  // isto, a tela receberia totais desatualizados após uma edição.
  const resumo = await resumoDe(id, empresaId);
  return {
    ...atualizado,
    totalComprado: resumo.total,
    totalPedidos: resumo.pedidos,
    ultimoPedidoAt: resumo.ultimo,
  };
}

export interface KpiFornecedores {
  totalFornecedores: number;
  gastoMes: number;
  pedidosPendentes: number;
  ticketMedio: number;
  // Extras reais para os deltas das caps e o gráfico de barras (histórico).
  criadosNoMes: number;
  gastoMesAnterior: number;
  pedidosAtrasados: number;
  ticketGeral: number;
  historico: Array<{ mes: string; valor: number }>;
}

function inicioDoMes(ref = new Date()): Date {
  return new Date(ref.getFullYear(), ref.getMonth(), 1);
}

function chaveMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * KPIs reais (sem mock): total de fornecedores, gasto do mês somando as
 * compras NÃO canceladas por dataCompra, pedidos Pendente/Atrasado, ticket
 * médio (mês; cai para a média geral se o mês estiver vazio) e a série mensal
 * dos últimos 6 meses que alimenta o gráfico "histórico".
 *
 * Tudo derivado de `Compra` — ver a nota de fonte da verdade no topo do
 * arquivo. Antes vinha de `CompraFornecedor`, que ninguém escrevia.
 */
export async function getKPIs(empresaId: string): Promise<KpiFornecedores> {
  const hoje = new Date();
  const inicio = inicioDoMes(hoje);
  const inicioAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const inicio6Meses = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);

  const [totalFornecedores, criadosNoMes, compras] = await Promise.all([
    prisma.fornecedor.count({ where: { empresaId } }),
    prisma.fornecedor.count({ where: { empresaId, createdAt: { gte: inicio } } }),
    prisma.compra.findMany({
      where: ondeContaComoPedido(empresaId),
      select: { valorTotal: true, status: true, dataCompra: true },
      orderBy: { dataCompra: 'desc' },
    }),
  ]);

  let gastoMes = 0;
  let gastoMesAnterior = 0;
  let pedidosPendentes = 0;
  let pedidosAtrasados = 0;
  let somaGeral = 0;
  let somaMes = 0;
  const porMes = new Map<string, number>();

  for (const c of compras) {
    const valor = Number(c.valorTotal);
    somaGeral += valor;

    // 'Entregue' não conta como pendente nem atrasado; 'Atrasado' é sempre
    // pedido em aberto, então os dois KPIs seguem mutuamente exclusivos —
    // como eram em CompraFornecedor.
    const pedido = classificarPedido(c, hoje);
    if (pedido === 'Pendente') pedidosPendentes++;
    else if (pedido === 'Atrasado') pedidosAtrasados++;

    if (c.dataCompra >= inicio) {
      gastoMes += valor;
      somaMes += valor;
    } else if (c.dataCompra >= inicioAnterior) {
      gastoMesAnterior += valor;
    }
    if (c.dataCompra >= inicio6Meses) {
      const chave = chaveMes(c.dataCompra);
      porMes.set(chave, (porMes.get(chave) ?? 0) + valor);
    }
  }

  // Série mensal real (6 meses) para o gráfico de barras "histórico".
  const historico: Array<{ mes: string; valor: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const ref = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    historico.push({
      mes: `${String(ref.getMonth() + 1).padStart(2, '0')}/${String(ref.getFullYear()).slice(2)}`,
      valor: porMes.get(chaveMes(ref)) ?? 0,
    });
  }

  const ticketGeral = compras.length > 0 ? somaGeral / compras.length : 0;
  const qtdMes = compras.filter((c) => c.dataCompra >= inicio).length;
  const ticketMedio = qtdMes > 0 ? somaMes / qtdMes : ticketGeral;

  return {
    totalFornecedores,
    gastoMes,
    pedidosPendentes,
    ticketMedio,
    criadosNoMes,
    gastoMesAnterior,
    pedidosAtrasados,
    ticketGeral,
    historico,
  };
}

export interface InsightFornecedores {
  melhorNegociacao: string;
  atrasoCritico: string;
  oportunidade: string;
}

/**
 * Três insights com dados reais:
 * - melhor negociação: fornecedor com MENOR ticket médio por pedido, entre os
 *   que têm amostra mínima (ver MIN_PEDIDOS_PARA_COMPARAR);
 * - atraso crítico: fornecedor com MAIS pedidos atrasados;
 * - oportunidade: fornecedor com MAIOR margem média nos produtos ativos.
 * Sem dados suficientes, devolve mensagem honesta — nunca número inventado.
 */
export const MIN_PEDIDOS_PARA_COMPARAR = 2;

export async function getInsights(empresaId: string): Promise<InsightFornecedores> {
  const hoje = new Date();
  const [compras, margemPorFornecedor] = await Promise.all([
    prisma.compra.findMany({
      where: ondeContaComoPedido(empresaId),
      select: { fornecedorId: true, valorTotal: true, status: true, dataCompra: true },
    }),
    prisma.produto.groupBy({
      by: ['fornecedorId'],
      where: { empresaId, fornecedorId: { not: null }, margem: { not: null }, status: 'ATIVO' },
      _avg: { margem: true },
      _count: { _all: true },
    }),
  ]);

  // Ticket médio e atraso por fornecedor, derivados de `Compra`.
  // Antes vinha de CompraFornecedor — relação que nada preenchia, então os
  // dois insights devolviam sempre o texto "sem histórico".
  const acc = new Map<string, { soma: number; qtd: number; atrasados: number }>();
  for (const c of compras) {
    const atual = acc.get(c.fornecedorId) ?? { soma: 0, qtd: 0, atrasados: 0 };
    atual.soma += Number(c.valorTotal);
    atual.qtd += 1;
    if (classificarPedido(c, hoje) === 'Atrasado') atual.atrasados += 1;
    acc.set(c.fornecedorId, atual);
  }

  const tickets = [...acc.entries()]
    .map(([fornecedorId, a]) => ({ fornecedorId, media: a.qtd > 0 ? a.soma / a.qtd : 0, qtd: a.qtd }))
    .filter((t) => t.qtd >= MIN_PEDIDOS_PARA_COMPARAR);
  const atrasados = [...acc.entries()]
    .filter(([, a]) => a.atrasados > 0)
    .map(([fornecedorId, a]) => ({ fornecedorId, atrasados: a.atrasados }))
    .sort((a, b) => b.atrasados - a.atrasados);

  const ids = [
    ...tickets.map((t) => t.fornecedorId),
    ...atrasados.map((a) => a.fornecedorId),
    ...margemPorFornecedor.map((m) => m.fornecedorId as string),
  ].filter(Boolean);
  const linhas = ids.length > 0
    ? await prisma.fornecedor.findMany({ where: { empresaId, id: { in: ids } }, select: { id: true, nome: true } })
    : [];
  const nomes = new Map(linhas.map((f) => [f.id, f.nome]));

  // Ordena por menor média e desempata pelo nome (estabilidade entre cargas).
  const negociacao = tickets.sort(
    (a, b) => a.media - b.media || (nomes.get(a.fornecedorId) ?? '').localeCompare(nomes.get(b.fornecedorId) ?? '', 'pt-BR'),
  )[0];
  const melhorNegociacao = negociacao
    ? `${nomes.get(negociacao.fornecedorId) ?? 'Fornecedor'} tem o menor ticket médio: R$ ${negociacao.media.toFixed(2)} por pedido em ${negociacao.qtd} pedido(s) — referência para renegociar.`
    : `Sem base para comparar negociações: é preciso ${MIN_PEDIDOS_PARA_COMPARAR} pedidos no mesmo fornecedor.`;

  const atraso = atrasados[0];
  const atrasoCritico = atraso
    ? `${nomes.get(atraso.fornecedorId) ?? 'Fornecedor'} concentra ${atraso.atrasados} pedido(s) atrasado(s) — priorize o contato.`
    : 'Nenhum pedido atrasado: nenhum fornecedor em estado crítico por prazo.';

  const oportunidade = margemPorFornecedor
    .filter((m) => m.fornecedorId && Number(m._avg.margem ?? 0) > 0)
    .sort((a, b) => Number(b._avg.margem ?? 0) - Number(a._avg.margem ?? 0))[0];
  const oportunidadeTxt = oportunidade
    ? `${nomes.get(oportunidade.fornecedorId as string) ?? 'Fornecedor'} fornece os produtos de maior margem (média ${Number(oportunidade._avg.margem ?? 0).toFixed(1)}% em ${oportunidade._count?._all ?? 0} item(ns)) — priorize compras aqui.`
    : 'Sem produtos ativos vinculados a fornecedores para calcular margem.';

  return { melhorNegociacao, atrasoCritico, oportunidade: oportunidadeTxt };
}


