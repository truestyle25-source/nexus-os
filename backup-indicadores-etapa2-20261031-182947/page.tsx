'use client';

/**
 * ============================================================================
 *  NEXUS OS — Indicadores
 * ============================================================================
 *  Refactor in-place da tela "Indicadores" (fluxo Vendas → ROI e
 *  Marketing → CAC × LTV). Mantém `fluxo1Nodes` / `fluxo2Nodes` e a
 *  hierarquia de seções do V3; a melhoria é de layout, código e UX.
 *
 *  Decisões de arquitetura (auditadas contra o repositório):
 *
 *  1. SHELL — esta página é renderizada dentro de `app/(dashboard)/layout.tsx`,
 *     que já desenha a sidebar (w-64 / w-16 colapsada), o topbar com busca
 *     global + notificações e o `<main class="flex-1 overflow-auto">`.
 *     O artefato V3 auditado trazia sidebar/topbar próprios; replicá-los aqui
 *     duplicaria o chrome do produto. Por isso o chrome NÃO é reimplementado:
 *     só o corpo da página foi elevado.
 *
 *  2. PALETA — o projeto tem tokens próprios no `globals.css` (`:root`):
 *     fundo #030366, painel #1A1A2E, card interno #0f0f54, accent #866bf5.
 *     A paleta #0f29ec/#11121E/#8B5CF6 do V3 foi mapeada para esses tokens,
 *     para o módulo não destoar de Dashboard, Vendas, DRE etc.
 *
 *  3. ÍCONES — `lucide-react` (dependência já declarada e usada no app)
 *     no lugar dos glifos Unicode do V3.
 *
 *  4. ANIMAÇÃO — o `globals.css` não tem nenhum `@keyframes` e a regra do
 *     projeto é não criar arquivo de estilo novo; as animações ficam em um
 *     bloco `<style jsx>` (nativo do Next, com escopo por página).
 *
 *  5. DADOS — o NEXUS não exibe número fictício como se fosse real
 *     (ver BUILD-VALIDATION.md). `fluxo1Nodes`/`fluxo2Nodes` continuam
 *     carregando os valores de prévia do V3, mas ficam atrás do modo
 *     "PRÉVIA" (opt-in, sinalizado). O modo padrão "REAIS" busca /roi, /dre
 *     e /dashboard/serie e mostra "—" onde não existe fonte de dado.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  ComponentType,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Database,
  Gauge,
  Info,
  Layers,
  Percent,
  Receipt,
  RefreshCw,
  Repeat,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from 'lucide-react';

import ModuleHeader from '@/components/ModuleHeader';
import { EmptyState, Panel, SectionTitle } from '@/components/ui';
import api, { getToken } from '@/lib/api';
import { formatBRL, formatNumber, formatPct } from '@/lib/format';
import {
  comFuso,
  intervaloDoPreset,
  mensagemErro,
  type DashboardSerie,
  type DreDetalhes,
  type RoiResposta,
} from '@/lib/dashboard';

/* ========================================================================== *
 *  Tokens locais — evita classes mágicas repetidas e mantém o ritmo de 8px
 *  (gap-2 8px · gap-3 12px · gap-4 16px · gap-6 24px) em toda a tela.
 * ========================================================================== */
const CARD = 'rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)]';
const CARD_INNER = 'rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)]';
const ROTULO = 'text-[10px] uppercase tracking-[0.14em] text-[var(--nx-ink-3)] font-semibold';
const FOCO =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-surface)]';

/* ========================================================================== *
 *  Tipos
 * ========================================================================== */
type Variante = 'default' | 'perigo' | 'destaque';
type Icone = ComponentType<{ className?: string }>;

interface IndicadorNode {
  id: string;
  label: string;
  /** Valor de PRÉVIA (V3). No modo "REAIS" é substituído por `dadosReais[id]`. */
  value: string;
  icon: Icone;
  formula: string;
  what: string;
  calc: string;
  example: string;
  impact: string;
  next: string;
  nextImpact: string;
  variant: Variante;
  fonte: string;
}

/* ========================================================================== *
 *  Paleta semântica por variante de nó (mantida do V3, mapeada p/ o app)
 * ========================================================================== */
const PILL_VARIANTE: Record<Variante, string> = {
  default:
    'bg-[var(--nx-surface-2)] border-[var(--nx-border)] text-[var(--nx-ink-2)] hover:border-[var(--nx-accent)] hover:text-[var(--nx-ink)]',
  perigo:
    'bg-[color-mix(in_srgb,var(--nx-red)_10%,var(--nx-surface))] border-[color-mix(in_srgb,var(--nx-red)_35%,var(--nx-border))] text-[var(--nx-red)] hover:border-[var(--nx-red)] hover:text-[var(--nx-ink)]',
  destaque:
    'bg-[color-mix(in_srgb,var(--nx-amber)_10%,var(--nx-surface))] border-[color-mix(in_srgb,var(--nx-amber)_35%,var(--nx-border))] text-[var(--nx-amber)] hover:border-[var(--nx-amber)] hover:text-[var(--nx-ink)]',
};

const PILL_ATIVO =
  'bg-[var(--nx-accent)] border-[var(--nx-accent)] text-[var(--nx-accent-ink)]';

/* ========================================================================== *
 *  FLUXO 1 — Vendas → ROI (13 nós)
 *
 *  Os valores de prévia reconciliam entre si:
 *  1.240 × R$ 187 = R$ 231,5 mil → − R$ 28 mil deduções = R$ 203,5 mil
 *  → − R$ 89 mil CMV = R$ 114,5 mil (56,1% de margem)
 *  → − R$ 62 mil despesas = R$ 52,5 mil resultado
 *  → + R$ 6 mil D&A = R$ 58,5 mil EBITDA
 *  → − R$ 17 mil impostos = R$ 41,5 mil lucro líquido
 *  → ÷ R$ 175 mil investidos = ROI 23,4%.
 * ========================================================================== */
const fluxo1Nodes: IndicadorNode[] = [
  {
    id: 'vendas',
    label: 'Vendas',
    value: '1.240',
    icon: Layers,
    formula: 'Contagem de vendas finalizadas no período',
    what: 'Quantas vendas foram efetivamente concluídas e pagas no período. É o topo da cadeia: todo o resto do fluxo 1 nasce daqui.',
    calc: 'COUNT(venda.status = FINALIZADA) no período',
    example: '1.240 vendas finalizadas no mês.',
    impact: 'É a base de todos os demais indicadores. Uma queda aqui derruba receita, lucro e ROI na mesma proporção.',
    next: 'Ticket + Nº',
    nextImpact: 'Divide a receita pelo número de vendas para medir o valor médio de cada uma.',
    variant: 'default',
    fonte: 'GET /dashboard/serie → totais.qtdVendas',
  },
  {
    id: 'ticket',
    label: 'Ticket + Nº',
    value: 'R$ 187',
    icon: Receipt,
    formula: 'Faturamento Bruto ÷ Número de Vendas',
    what: 'Quanto a empresa fatura, em média, por venda. Separa "vendi pouco" de "vendi barato".',
    calc: 'Faturamento Bruto ÷ Número de Vendas',
    example: 'R$ 231.500 ÷ 1.240 = R$ 186,7 ≈ R$ 187.',
    impact: 'Elevar o ticket em 10% vale tanto quanto 10% mais vendas, e sem custo de aquisição.',
    next: 'Faturamento Bruto',
    nextImpact: 'Multiplica o ticket pelo número de vendas para chegar ao faturamento.',
    variant: 'default',
    fonte: 'GET /dashboard/serie → totais.ticketMedio',
  },
  {
    id: 'faturamento',
    label: 'Faturamento Bruto',
    value: 'R$ 231 mil',
    icon: TrendingUp,
    formula: 'Soma do total de todas as vendas finalizadas',
    what: 'Todo o valor vendido antes de descontar impostos, devoluções, abatimentos e custo.',
    calc: 'SUM(venda.total) para vendas finalizadas no período',
    example: '1.240 × R$ 187 ≈ R$ 231 mil.',
    impact: 'É o topo da receita, mas não é lucro: para chegar nele ainda falta deduzir custos e despesas.',
    next: 'Deduções',
    nextImpact: 'Retira do faturamento tudo que não é receita realizável.',
    variant: 'default',
    fonte: 'GET /dashboard/serie → totais.faturamento',
  },
  {
    id: 'deducoes',
    label: 'Deduções',
    value: '-R$ 28 mil',
    icon: Percent,
    formula: 'Impostos + devoluções + abatimentos + descontos',
    what: 'A parcela do faturamento que nunca chega ao caixa: impostos sobre a venda, devoluções e abatimentos concedidos.',
    calc: 'Impostos + devoluções + abatimentos + descontos do período',
    example: 'R$ 28 mil de deduções sobre R$ 231 mil = 12,1% do faturamento.',
    impact: 'Dedução alta encolhe a base de todo o fluxo. Cada ponto percentual aqui vale 1 ponto de margem no fim.',
    next: 'Receita Líquida',
    nextImpact: 'É o faturamento depois das deduções — a base real do cálculo de margem.',
    variant: 'perigo',
    fonte: 'GET /dre → detalhes.deducoes',
  },
  {
    id: 'receita',
    label: 'Receita Líquida',
    value: 'R$ 203 mil',
    icon: Wallet,
    formula: 'Faturamento Bruto − Deduções',
    what: 'O que realmente pertence à empresa depois de tudo que foi descontado na venda.',
    calc: 'Faturamento Bruto − Deduções',
    example: 'R$ 231 mil − R$ 28 mil = R$ 203 mil.',
    impact: 'Todo indicador de margem usa esta base. Confundi-la com faturamento é o erro mais comum de gestão.',
    next: 'CMV',
    nextImpact: 'Subtrai o custo direto do que foi vendido para chegar ao lucro bruto.',
    variant: 'default',
    fonte: 'GET /dre → detalhes.receitaLiquida',
  },
  {
    id: 'cmv',
    label: 'CMV',
    value: 'R$ 89 mil',
    icon: Database,
    formula: 'Custo das Mercadorias Vendidas',
    what: 'Custo direto do que foi vendido: produtos, insumos e serviços que entraram na venda.',
    calc: 'SUM(custo dos itens vendidos) no período',
    example: 'R$ 89 mil de CMV sobre R$ 203 mil de receita = 43,8% da receita.',
    impact: 'É o principal compressor de margem. Subir o CMV sem subir o preço destrói o lucro na mesma proporção.',
    next: 'Lucro Bruto',
    nextImpact: 'Mostra quanto sobra da receita depois do custo direto — a verdadeira margem do produto.',
    variant: 'perigo',
    fonte: 'GET /dashboard/serie → totais.cmv',
  },
  {
    id: 'lucro-bruto',
    label: 'Lucro Bruto',
    value: 'R$ 114 mil',
    icon: BarChart3,
    formula: 'Receita Líquida − CMV',
    what: 'O que sobra antes de qualquer despesa operacional: o resultado da venda do produto em si.',
    calc: 'Receita Líquida − CMV',
    example: 'R$ 203 mil − R$ 89 mil = R$ 114 mil.',
    impact: 'Mede a saúde do produto. Lucro bruto baixo com faturamento alto significa preço ou custo errado.',
    next: 'Margem',
    nextImpact: 'Normaliza o lucro bruto em porcentagem, permitindo comparar períodos de tamanhos diferentes.',
    variant: 'default',
    fonte: 'GET /dashboard/serie → totais.lucroBruto',
  },
  {
    id: 'margem',
    label: 'Margem',
    value: '56,1%',
    icon: Percent,
    formula: '(Lucro Bruto ÷ Receita Líquida) × 100',
    what: 'O lucro bruto em porcentagem da receita. É o termômetro mais rápido da saúde do negócio.',
    calc: '(Lucro Bruto ÷ Receita Líquida) × 100',
    example: '(R$ 114 mil ÷ R$ 203 mil) × 100 = 56,1%.',
    impact: 'Abaixo de 40% a operação quase não tem folga para despesa. Acima de 50% há espaço para investir em crescimento.',
    next: 'Despesas',
    nextImpact: 'Mostra quanto da margem bruta precisa ser consumida para manter a empresa de pé.',
    variant: 'destaque',
    fonte: 'GET /dashboard/serie → totais.margemBruta',
  },
  {
    id: 'despesas',
    label: 'Despesas',
    value: 'R$ 62 mil',
    icon: Receipt,
    formula: 'Gastos necessários para manter a operação',
    what: 'Folha, aluguel, energia, marketing, sistemas: tudo que é consumido para a empresa existir, independentemente do que foi vendido.',
    calc: 'SUM(despesas operacionais) no período',
    example: 'R$ 62 mil de despesa contra R$ 114 mil de lucro bruto.',
    impact: 'Despesa fixa alta exige faturamento constante para não entrar no prejuízo.',
    next: 'Resultado',
    nextImpact: 'Subtrai a despesa do lucro bruto e mostra o resultado operacional do período.',
    variant: 'perigo',
    fonte: 'GET /dre → detalhes.despesas',
  },
  {
    id: 'resultado',
    label: 'Resultado',
    value: 'R$ 52 mil',
    icon: Gauge,
    formula: 'Lucro Bruto − Despesas Operacionais',
    what: 'O resultado operacional: o que a empresa ganha ou perde antes de depreciação, amortização e impostos.',
    calc: 'Lucro Bruto − Despesas Operacionais',
    example: 'R$ 114 mil − R$ 62 mil = R$ 52 mil de resultado operacional.',
    impact: 'É o ponto de virada entre operação saudável e prejuízo. Negativo aqui exige ação imediata.',
    next: 'EBITDA',
    nextImpact: 'Adiciona de volta a depreciação e a amortização para medir a operação sem efeito contábil.',
    variant: 'default',
    fonte: 'GET /dre → detalhes.resultadoOperacional',
  },
  {
    id: 'ebitda',
    label: 'EBITDA',
    value: 'R$ 58 mil',
    icon: Gauge,
    formula: 'Resultado Operacional + Depreciação + Amortização',
    what: 'O resultado operacional sem depreciação nem amortização: a geração de caixa bruto da operação.',
    calc: 'Resultado Operacional + Depreciação + Amortização',
    example: 'R$ 52 mil de resultado + R$ 6 mil de D&A = R$ 58 mil de EBITDA.',
    impact: 'É o indicador que o mercado olha ao avaliar a operação. Mede caixa, não lucro contábil.',
    next: 'Lucro Líquido',
    nextImpact: 'Desconta impostos e proventos do EBITDA para chegar ao que de fato pertence ao dono.',
    variant: 'default',
    fonte: 'Sem fonte no backend — o DRE ainda não expõe depreciação e amortização.',
  },
  {
    id: 'lucro-liquido',
    label: 'Lucro Líquido',
    value: 'R$ 41 mil',
    icon: Wallet,
    formula: 'EBITDA − Impostos sobre o resultado + Resultado não recorrente',
    what: 'O resultado final depois de todos os custos, despesas e impostos do período. É o lucro do dono.',
    calc: 'EBITDA − Impostos − Despesas Financeiras + Receitas Não Operacionais',
    example: 'R$ 58 mil de EBITDA − R$ 17 mil de impostos = R$ 41 mil de lucro líquido.',
    impact: 'É o único número do fluxo que responde se a empresa ganhou dinheiro de verdade no mês.',
    next: 'ROI',
    nextImpact: 'Compara o lucro líquido com o capital investido para medir a eficiência do negócio.',
    variant: 'destaque',
    fonte: 'GET /dre → detalhes.lucroPrejuizo',
  },
  {
    id: 'roi',
    label: 'ROI',
    value: '23,4%',
    icon: Target,
    formula: '(Lucro Líquido ÷ Investimento) × 100',
    what: 'Retorno sobre o investimento: quanto a empresa gerou de lucro para cada real investido na operação.',
    calc: '(Lucro Líquido ÷ Capital Investido) × 100',
    example: '(R$ 41,5 mil ÷ R$ 175 mil investidos) × 100 = 23,4%.',
    impact: 'O indicador final do fluxo 1. É ele que diz se o capital está sendo bem aplicado.',
    next: 'Fim do fluxo',
    nextImpact: 'Compara-se com o custo do capital para decidir se vale continuar investindo no mesmo ritmo.',
    variant: 'destaque',
    fonte: 'GET /roi → roi (base: compras recebidas × vendas finalizadas)',
  },
];

/* ========================================================================== *
 *  FLUXO 2 — Marketing → CAC × LTV (9 nós)
 *
 *  Reconciliação da prévia:
 *  R$ 21 mil investidos → 1.120 leads → 14,8% de conversão = 166 clientes
 *  → CAC = R$ 21.000 ÷ 166 = R$ 126 · LTV = R$ 126 × 7,06 = R$ 889
 *  → Payback = R$ 126 ÷ (R$ 889/12 × 56,1% de margem) = 3,0 meses
 *  → ROI Marketing = (166 × R$ 889 − R$ 21 mil) ÷ R$ 21 mil = 603%.
 * ========================================================================== */
const fluxo2Nodes: IndicadorNode[] = [
  {
    id: 'investimento',
    label: 'Investimento',
    value: 'R$ 21 mil',
    icon: Wallet,
    formula: 'Verba aplicada em aquisição no período',
    what: 'Quanto foi investido em marketing e vendas para gerar novos clientes. É a base de todo o fluxo 2.',
    calc: 'SUM(investimento em mídia + equipe de aquisição)',
    example: 'R$ 21 mil investidos no mês.',
    impact: 'Sem essa verba não existe CAC: todo o fluxo 2 mede a eficiência do mesmo dinheiro.',
    next: 'Leads',
    nextImpact: 'Mostra quantas pessoas foram alcançadas pelo investimento.',
    variant: 'default',
    fonte: 'Sem fonte — o sistema ainda não registra investimento em aquisição (ver limitacao de GET /roi).',
  },
  {
    id: 'leads',
    label: 'Leads',
    value: '1.120',
    icon: Layers,
    formula: 'Contagem de contatos gerados no período',
    what: 'Pessoas alcançadas pela campanha. É o topo do funil: ainda não compraram nada.',
    calc: 'COUNT(leads gerados) no período',
    example: '1.120 leads no mês.',
    impact: 'Volume sem conversão é desperdício. Leads só têm valor quando a taxa de conversão sustenta o CAC.',
    next: 'Taxa Conv.',
    nextImpact: 'Converte o volume de leads em clientes reais, e é o elo mais volátil do fluxo.',
    variant: 'default',
    fonte: 'Sem fonte — não há entidade de campanha/marketing no NEXUS.',
  },
  {
    id: 'taxa-conversao',
    label: 'Taxa Conv.',
    value: '14,8%',
    icon: Repeat,
    formula: '(Novos Clientes ÷ Leads) × 100',
    what: 'Qual percentual dos leads virou cliente de fato. Converte alcance em resultado.',
    calc: '(Novos Clientes ÷ Leads) × 100',
    example: '166 clientes ÷ 1.120 leads = 14,8%.',
    impact: 'Melhorar 1 ponto aqui reduz o CAC na mesma proporção, sem gastar mais um real em mídia.',
    next: 'CAC',
    nextImpact: 'Divide o investimento pelo número real de clientes e entrega o custo da aquisição.',
    variant: 'default',
    fonte: 'Sem fonte — depende de leads e novos clientes, que o NEXUS ainda não registra.',
  },
  {
    id: 'cac',
    label: 'CAC',
    value: 'R$ 126',
    icon: Receipt,
    formula: 'Investimento em Marketing e Vendas ÷ Nº de Novos Clientes',
    what: 'Custo de aquisição por cliente: quanto se pagou, em média, para conquistar cada cliente novo.',
    calc: 'Investimento em Aquisição ÷ Nº de Novos Clientes',
    example: 'R$ 21.000 ÷ 166 clientes = R$ 126 por cliente.',
    impact: 'É o gargalo clássico do crescimento: se o CAC subir e o LTV não acompanhar, o negócio sangra caixa.',
    next: 'Retenção',
    nextImpact: 'Só o cliente que volta transforma o CAC em lucro; a retenção é o que paga o CAC de volta.',
    variant: 'perigo',
    fonte: 'Sem fonte — o backend retorna cac: null por falta de registro de investimento em aquisição.',
  },
  {
    id: 'retencao',
    label: 'Retenção',
    value: '74%',
    icon: Repeat,
    formula: 'Clientes ativos ÷ Clientes conquistados no período',
    what: 'Percentual de clientes que continuam comprando. É o que determina o LTV.',
    calc: 'Clientes que voltaram a comprar ÷ Clientes do período',
    example: '74% dos 166 clientes fizeram segunda compra em até 6 meses.',
    impact: 'Uma retenção 10% menor corta o LTV pela metade e dobra o CAC efetivo do negócio.',
    next: 'LTV',
    nextImpact: 'Multiplica o valor gerado pelo tempo de vida do cliente, calculando o retorno do CAC.',
    variant: 'default',
    fonte: 'Sem fonte — a retenção depende do histórico de compras por cliente.',
  },
  {
    id: 'ltv',
    label: 'LTV',
    value: 'R$ 889',
    icon: TrendingUp,
    formula: 'Ticket médio × Frequência de compra × Tempo de vida do cliente',
    what: 'Valor econômico total que um cliente gera ao longo de todo o relacionamento com a empresa.',
    calc: 'Receita gerada pelo cliente ÷ nº de clientes, no histórico',
    example: 'R$ 126 × 7,06 = R$ 889 de valor por cliente.',
    impact: 'É o teto do retorno do CAC. Se o LTV não cobrir o CAC com folga, crescer mais só acelera o prejuízo.',
    next: 'LTV/CAC',
    nextImpact: 'Divide os dois indicadores e mostra se o crescimento se paga de verdade.',
    variant: 'destaque',
    fonte: 'GET /dashboard/serie → ltv.ltvRealizado (LTV realizado histórico).',
  },
  {
    id: 'ltv-cac',
    label: 'LTV/CAC',
    value: '7,06x',
    icon: Repeat,
    formula: 'LTV ÷ CAC',
    what: 'Quantas vezes o valor do cliente supera o custo de conquistá-lo. O veredito do modelo de crescimento.',
    calc: 'LTV ÷ CAC',
    example: 'R$ 889 ÷ R$ 126 = 7,06x.',
    impact: 'Abaixo de 3x o crescimento queima caixa; acima de 5x a empresa deveria reinvestir mais agressivamente.',
    next: 'Payback',
    nextImpact: 'Mostra em quanto tempo o CAC é devolvido — o que define o caixa necessário para crescer.',
    variant: 'destaque',
    fonte: 'Sem fonte — CAC não é calculável enquanto não houver registro de investimento em aquisição.',
  },
  {
    id: 'payback',
    label: 'Payback',
    value: '3,0 meses',
    icon: Zap,
    formula: 'CAC ÷ (LTV mensal × Margem Bruta)',
    what: 'Em quantos meses a empresa recupera o dinheiro investido na aquisição do cliente.',
    calc: 'CAC ÷ ((LTV ÷ 12) × Margem Bruta)',
    example: 'R$ 126 ÷ ((R$ 889 ÷ 12) × 56,1%) = 3,0 meses.',
    impact: 'Payback curto libera caixa para escalar. Payback longo prende o caixa e trava a operação.',
    next: 'ROI Marketing',
    nextImpact: 'Fecha o ciclo: mostra o retorno total do investimento em marketing.',
    variant: 'default',
    fonte: 'Sem fonte — depende do CAC.',
  },
  {
    id: 'roi-marketing',
    label: 'ROI Marketing',
    value: '603%',
    icon: Target,
    formula: '(Receita atribuída − Investimento) ÷ Investimento × 100',
    what: 'O retorno final do investimento em marketing, no mesmo formato do ROI do fluxo 1.',
    calc: '((Novos Clientes × LTV) − Investimento) ÷ Investimento × 100',
    example: '((166 × R$ 889) − R$ 21 mil) ÷ R$ 21 mil = 603%.',
    impact: 'Fecha o fluxo 2. É o número que justifica (ou corta) o orçamento de marketing do período.',
    next: 'Fim do fluxo',
    nextImpact: 'Compara-se com o ROI do fluxo 1 para saber se vale investir em mídia ou em operação.',
    variant: 'destaque',
    fonte: 'Sem fonte — depende do Investimento (sem entidade de campanha no NEXUS).',
  },
];

/* ========================================================================== *
 *  Registro dos dois fluxos + KPIs de herói (valores do V3)
 * ========================================================================== */
interface Fluxo {
  id: string;
  kicker: string;
  title: string;
  resumo: string;
  nodes: IndicadorNode[];
}

const FLUXOS: Fluxo[] = [
  {
    id: 'fluxo-1',
    kicker: 'Fluxo 1',
    title: 'Relação entre Indicadores • Vendas → ROI',
    resumo:
      'Vendas ↓ Ticket+Nº → Faturamento Bruto → Deduções → Receita Líquida → CMV → Lucro Bruto → Margem → Despesas → Resultado → EBITDA → Lucro Líquido → ROI',
    nodes: fluxo1Nodes,
  },
  {
    id: 'fluxo-2',
    kicker: 'Fluxo 2',
    title: 'Marketing → CAC × LTV',
    resumo:
      'Investimento → Leads → Taxa Conv. → CAC → Retenção → LTV → LTV/CAC → Payback → ROI Marketing',
    nodes: fluxo2Nodes,
  },
];

type TomKpi = 'acento' | 'emerald' | 'ambar' | 'vermelho';

interface KpiHero {
  id: string;
  label: string;
  value: string;
  delta: string;
  tom: TomKpi;
  spark: number[];
  dica: string;
}

const TOM_KPI: Record<TomKpi, string> = {
  acento: 'text-[var(--nx-accent-ink)]',
  emerald: 'text-[var(--nx-green)]',
  ambar: 'text-[var(--nx-amber)]',
  vermelho: 'text-[var(--nx-red)]',
};

const KPIS_HERO: KpiHero[] = [
  {
    id: 'roi',
    label: 'ROI',
    value: '23,4%',
    delta: '+3,1 p.p.',
    tom: 'emerald',
    spark: [12, 14, 13, 17, 19, 18, 21, 23.4],
    dica: '(Lucro Líquido ÷ Investimento) × 100 — fecha o fluxo 1.',
  },
  {
    id: 'margem',
    label: 'Margem',
    value: '56,1%',
    delta: '+2,4 p.p.',
    tom: 'emerald',
    spark: [48, 50, 49, 52, 53, 52, 55, 56.1],
    dica: '(Lucro Bruto ÷ Receita Líquida) × 100 — o termômetro da saúde do produto.',
  },
  {
    id: 'cac',
    label: 'CAC',
    value: 'R$ 126',
    delta: '-R$ 14',
    tom: 'emerald',
    spark: [162, 158, 150, 147, 141, 138, 132, 126],
    dica: 'Investimento em Aquisição ÷ Nº de Novos Clientes — menor é melhor.',
  },
  {
    id: 'ltv-cac',
    label: 'LTV/CAC',
    value: '7,06x',
    delta: '+1,4x',
    tom: 'acento',
    spark: [4.2, 4.6, 4.9, 5.3, 5.6, 5.9, 6.4, 7.06],
    dica: 'LTV ÷ CAC — acima de 5x o crescimento se paga com folga.',
  },
];

/** Gargalo em destaque (dado do V3, mantido como alerta editorial). */
const GARGALO = {
  titulo: 'Gargalo detectado',
  texto:
    'O CMV subiu 8,5% e já consome 43,8% da receita líquida. Cada ponto percentual de CMV acima de 40% da receita derruba o ROI em aproximadamente 1,2 p.p.',
  acao: 'Revisar tabela de custo e mix de produtos com maior margem.',
} as const;

/** Catálogo de fórmulas que não têm ponto próprio em nenhum dos dois fluxos. */
const CATALOGO = [
  'Lucratividade',
  'Ponto de Equilíbrio',
  'Meta Atingida',
] as const;

/* ========================================================================== *
 *  Mapeamento dos endpoints reais para os nós dos fluxos.
 *  Nó sem fonte correspondente simplesmente não recebe valor → "—".
 * ========================================================================== */
type DadosReais = Record<string, string>;

function mapearReais(
  serie: DashboardSerie | null,
  dre: { detalhes: DreDetalhes } | null,
  roi: RoiResposta | null,
): DadosReais {
  const t = serie?.totais;
  const d = dre?.detalhes;
  const out: DadosReais = {};

  const brl = (v: number | null | undefined) =>
    v === null || v === undefined || !Number.isFinite(v) ? '' : formatBRL(v);
  const num = (v: number | null | undefined) =>
    v === null || v === undefined || !Number.isFinite(v) ? '' : formatNumber(v);
  const pct = (v: number | null | undefined) =>
    v === null || v === undefined || !Number.isFinite(v) ? '' : formatPct(v);

  if (t) {
    out.vendas = num(t.qtdVendas);
    out.ticket = brl(t.ticketMedio);
    out.faturamento = brl(t.faturamento);
    out.cmv = brl(t.cmv);
    out['lucro-bruto'] = brl(t.lucroBruto);
    out.margem = pct(t.margemBruta);
  }
  if (d) {
    // Deduções zero é um dado (R$ 0,00), não ausência de fonte: só some da
    // tela quando `/dre` nem respondeu (`d === null`).
    out.deducoes = d.deducoes ? `-${formatBRL(d.deducoes)}` : formatBRL(0);
    out.receita = brl(d.receitaLiquida);
    out.despesas = brl(d.despesas);
    out.resultado = brl(d.resultadoOperacional);
    out['lucro-liquido'] = brl(d.lucroPrejuizo);
  }
  // LTV: o nó `ltv` declara fonte `GET /dashboard/serie → ltv.ltvRealizado`,
  // mas o mapeamento nunca existiu — o pill ficava "—" mesmo com o dado pronto.
  if (serie) {
    out.ltv = brl(serie.ltv?.ltvRealizado);
  }
  if (roi && Number.isFinite(roi.roi)) {
    out.roi = pct(roi.roi);
  }

  // Remove chaves vazias para que a UI trate "sem dado" de forma uniforme.
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== ''));
}

/* ========================================================================== *
 *  Componentes de apresentação
 * ========================================================================== */

/** Normaliza a série numa viewBox 100×30 e devolve linha + área. */
function useSparkline(pontos: number[]) {
  return useMemo(() => {
    if (pontos.length < 2) return null;
    const min = Math.min(...pontos);
    const max = Math.max(...pontos);
    const amp = max - min || 1;
    const coords = pontos.map((v, i) => {
      const x = (i / (pontos.length - 1)) * 100;
      const y = 26 - ((v - min) / amp) * 22;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const linha = `M${coords.join(' L')}`;
    return { linha, area: `${linha} L100,30 L0,30 Z` };
  }, [pontos]);
}

function Sparkline({ pontos, ativo }: { pontos: number[]; ativo: boolean }) {
  const gradId = useId();
  const curva = useSparkline(pontos);
  if (!curva) return null;

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="h-8 w-full"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--nx-accent)" stopOpacity="0.34" />
          <stop offset="100%" stopColor="var(--nx-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={curva.area} fill={`url(#${gradId})`} />
      <path
        d={curva.linha}
        fill="none"
        stroke={ativo ? 'var(--nx-green)' : 'var(--nx-accent-2)'}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Card de KPI de herói: rótulo em caixa alta, valor, delta e sparkline. */
function KpiCardHero({
  kpi,
  valor,
  delta,
  spark,
  carregando,
  aoAbrir,
}: {
  kpi: KpiHero;
  /**
   * Valor exibido: real (modo "Reais"), de prévia (modo "Prévia") ou "—".
   * Quem decide é a página — aqui NUNCA se olha `kpi.value` direto, senão o
   * número de prévia apareceria como se fosse dado real (BUILD-VALIDATION.md).
   */
  valor: string;
  /** Variação; `null` quando não há fonte de período anterior para ela. */
  delta: string | null;
  /** Série da sparkline; `null` quando não há série real disponível. */
  spark: number[] | null;
  carregando: boolean;
  aoAbrir: () => void;
}) {
  const semDado = valor === '—';
  const ativo = !semDado && kpi.tom === 'emerald';

  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-label={`${kpi.label}: ${semDado ? 'sem dado no período' : `${valor}${delta ? `, ${delta}` : ''}`}. ${kpi.dica}`}
      className={clsx(
        CARD,
        'group relative flex flex-col items-stretch text-left p-4 gap-2 overflow-hidden',
        'transition-colors duration-200 hover:border-[var(--nx-accent)] hover:bg-[var(--nx-surface-2)]',
        FOCO,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={ROTULO}>{kpi.label}</span>
        <span
          className={clsx(
            'text-[11px] font-semibold',
            semDado || !delta ? 'text-[var(--nx-ink-3)]' : TOM_KPI[kpi.tom],
          )}
        >
          {semDado ? 'sem dado' : (delta ?? '—')}
        </span>
      </div>

      {carregando ? (
        <div className="h-7 w-24 animate-pulse rounded-[6px] bg-white/[0.07]" />
      ) : (
        <div
          className={clsx(
            'text-[22px] font-bold tracking-tight tabular-nums',
            semDado ? 'text-[var(--nx-ink-3)]' : 'text-[var(--nx-ink)]',
          )}
        >
          {valor}
        </div>
      )}

      <div className="mt-auto">
        {carregando ? (
          <div className="h-8 w-full animate-pulse rounded-[6px] bg-white/[0.05]" />
        ) : spark ? (
          <Sparkline pontos={spark} ativo={ativo} />
        ) : null}
      </div>
    </button>
  );
}

/** Skeleton exibido enquanto os endpoints reais respondem. */
function FluxoSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="h-3 w-40 animate-pulse rounded-full bg-white/[0.06]" />
      <div className="flex gap-3 overflow-hidden">
        {[68, 84, 96, 72, 88, 64, 80].map((w, i) => (
          <div
            key={i}
            style={{ width: w }}
            className="h-11 shrink-0 animate-pulse rounded-full bg-white/[0.06]"
          />
        ))}
      </div>
    </div>
  );
}

/* ========================================================================== *
 *  Pill de indicador — botão real, acessível, com hover/focus/active.
 *  Nunca recebe `role="button"`: <button> já expõe a role nativa, e o que o
 *  leitor de tela precisa é do `aria-pressed` + `aria-label` abaixo.
 * ========================================================================== */
function IndicatorPill({
  node,
  valor,
  selecionado,
  semDado,
  indice,
  total,
  criarRef,
  aoSelecionar,
  aoEntrar,
  aoSair,
}: {
  node: IndicadorNode;
  valor: string;
  selecionado: boolean;
  semDado: boolean;
  indice: number;
  total: number;
  criarRef: (id: string) => (el: HTMLButtonElement | null) => void;
  aoSelecionar: (id: string) => void;
  aoEntrar: (node: IndicadorNode, el: HTMLButtonElement) => void;
  aoSair: () => void;
}) {
  const Icone = node.icon;

  return (
    <li className="snap-center shrink-0">
      <button
        ref={criarRef(node.id)}
        type="button"
        onClick={() => aoSelecionar(node.id)}
        onMouseEnter={(e) => aoEntrar(node, e.currentTarget)}
        onMouseLeave={aoSair}
        onFocus={(e) => aoEntrar(node, e.currentTarget)}
        onBlur={aoSair}
        aria-pressed={selecionado}
        aria-label={`${node.label}, indicador ${indice + 1} de ${total}: ${semDado ? 'sem dado no período' : valor}. ${node.formula}`}
        className={clsx(
          'group flex h-[46px] items-center gap-2 rounded-full border px-4',
          'transition-all duration-200 hover:scale-[1.03]',
          semDado && 'border-dashed opacity-60',
          selecionado ? PILL_ATIVO : PILL_VARIANTE[node.variant],
          FOCO,
        )}
      >
        <Icone
          className={clsx(
            'h-3.5 w-3.5 shrink-0',
            selecionado ? 'text-[var(--nx-accent-ink)]' : 'text-[var(--nx-ink-3)]',
          )}
        />
        <span className="text-[13px] font-semibold whitespace-nowrap">
          {node.label}
        </span>
        <span
          className={clsx(
            'text-[12px] font-medium tabular-nums',
            selecionado ? 'text-[var(--nx-accent-ink)]' : 'text-[var(--nx-ink-3)]',
          )}
        >
          {valor}
        </span>
      </button>
    </li>
  );
}

/* ========================================================================== *
 *  Bloco de seção do fluxo: título + trilha horizontal com scroll-snap
 * ========================================================================== */
function FluxoCard({
  fluxo,
  selecionadoId,
  valorDe,
  carregando,
  criarRef,
  aoSelecionar,
  aoEntrar,
  aoSair,
  aoTeclado,
}: {
  fluxo: Fluxo;
  selecionadoId: string;
  valorDe: (node: IndicadorNode) => string;
  carregando: boolean;
  criarRef: (id: string) => (el: HTMLButtonElement | null) => void;
  aoSelecionar: (id: string) => void;
  aoEntrar: (node: IndicadorNode, el: HTMLButtonElement) => void;
  aoSair: () => void;
  aoTeclado: (e: ReactKeyboardEvent<HTMLUListElement>, fluxo: Fluxo) => void;
}) {
  const { nodes } = fluxo;

  return (
    <Panel className="rounded-[20px] p-5 lg:p-6">
      <SectionTitle kicker={fluxo.kicker} className="gap-3">
        <span className="block text-[16px]">{fluxo.title}</span>
      </SectionTitle>

      {carregando ? (
        <div className="mt-4">
          <FluxoSkeleton />
        </div>
      ) : (
        <div className="mt-4">
          <div className="fluxo relative">
            {/* Linha do fluxo: trilho pontilhado que "anda" (stroke-dashoffset)
                + um ponto que viaja. Só anima no hover do bloco (ver style jsx).
                Fica atrás dos pills, aparecendo apenas nos vãos entre eles. */}
            <div
              aria-hidden="true"
              className="linha-fluxo pointer-events-none absolute inset-x-0 top-1/2 z-0 -translate-y-1/2 opacity-0 transition-opacity duration-200"
            >
              <svg
                viewBox="0 0 1000 1"
                preserveAspectRatio="none"
                className="h-px w-full"
                focusable="false"
              >
                <path
                  d="M0,0.5 H1000"
                  fill="none"
                  stroke="var(--nx-border-strong)"
                  strokeWidth="1"
                  strokeDasharray="4 6"
                  vectorEffect="non-scaling-stroke"
                />
                {/* Cometa: um trecho curto que percorre o trilho inteiro. */}
                <path
                  d="M0,0.5 H1000"
                  fill="none"
                  stroke="var(--nx-accent)"
                  strokeWidth="1"
                  strokeDasharray="18 982"
                  vectorEffect="non-scaling-stroke"
                  className="trilho-dash"
                />
              </svg>
              <span
                className="ponto-viajante absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--nx-accent)]"
                style={{ boxShadow: '0 0 12px rgba(124,92,255,0.9)' }}
              />
            </div>

            {/* Trilha do fluxo: trilho único com scroll horizontal + snap.
                Nunca quebra linha — em telas estreitas o usuário rola. */}
            <ul
              onKeyDown={(e) => aoTeclado(e, fluxo)}
              aria-label={`${fluxo.title}. Use as setas esquerda e direita para navegar entre os indicadores.`}
              className="relative z-10 flex items-center gap-2 overflow-x-auto snap-x snap-mandatory px-0.5 py-1 nx-scroll"
            >
              {nodes.map((node, i) => {
                const valor = valorDe(node);
                return (
                  <IndicatorPill
                    key={node.id}
                    node={node}
                    valor={valor}
                    selecionado={node.id === selecionadoId}
                    semDado={valor === '—'}
                    indice={i}
                    total={nodes.length}
                    criarRef={criarRef}
                    aoSelecionar={aoSelecionar}
                    aoEntrar={aoEntrar}
                    aoSair={aoSair}
                  />
                );
              })}
            </ul>
          </div>

          {/* Resumo textual do fluxo — acessível e útil em leitura linear. */}
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--nx-ink-3)]">
            {fluxo.resumo}
          </p>
        </div>
      )}
    </Panel>
  );
}

/* ========================================================================== *
 *  Drawer de detalhe do indicador.
 *  Desktop: coluna sticky de 400px. Mobile/tablet: bottom sheet com
 *  `role="dialog"` + `aria-modal` e trava de scroll do body.
 * ========================================================================== */
function Drawer({
  node,
  valor,
  semDado,
  previa,
  aoFechar,
  comoSheet,
  simulando,
  simulacao,
  erroSimulacao,
  aoSimular,
}: {
  node: IndicadorNode;
  valor: string;
  semDado: boolean;
  previa: boolean;
  aoFechar: () => void;
  comoSheet: boolean;
  /** Simulação em andamento (POST /ia/perguntar). */
  simulando: boolean;
  /** Texto da simulação gerada para ESTE indicador (limpo ao trocar). */
  simulacao: string | null;
  /** Falha da última simulação (permissão/rede/IA indisponível). */
  erroSimulacao: string | null;
  aoSimular: () => void;
}) {
  const Icone = node.icon;

  return (
    <div
      role={comoSheet ? 'dialog' : 'region'}
      aria-modal={comoSheet || undefined}
      aria-label={`Detalhe do indicador ${node.label}`}
      className="flex h-full min-h-0 flex-col"
    >
      {/* Cabeçalho sticky com blur */}
      <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-[var(--nx-border)] bg-[var(--nx-surface)] px-5 py-4 backdrop-blur-xl">
        <div
          className={clsx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]',
            node.variant === 'perigo'
              ? 'bg-[color-mix(in_srgb,var(--nx-red)_12%,var(--nx-surface))] text-[var(--nx-red)]'
              : node.variant === 'destaque'
                ? 'bg-[color-mix(in_srgb,var(--nx-amber)_12%,var(--nx-surface))] text-[var(--nx-amber)]'
                : 'bg-[color-mix(in_srgb,var(--nx-accent)_15%,transparent)] text-[var(--nx-accent-ink)]',
          )}
        >
          <Icone className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className={ROTULO}>Indicador selecionado</div>
          <h3 className="mt-0.5 truncate text-[15px] font-semibold text-[var(--nx-ink)]">
            {node.label}
          </h3>
          <code className="mt-1 block truncate font-mono text-[11px] text-[var(--nx-ink-3)]">
            {node.formula}
          </code>
        </div>

        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar detalhe do indicador"
          className={clsx(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            'bg-[var(--nx-surface-2)] text-[var(--nx-ink-2)] transition-colors hover:bg-[var(--nx-surface-3)] hover:text-[var(--nx-ink)]',
            FOCO,
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Corpo rolável */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 nx-scroll">
        <div className="grid grid-cols-2 gap-2">
          <div className={clsx(CARD_INNER, 'p-3')}>
            <div className={ROTULO}>Valor atual</div>
            <div
              className={clsx(
                'mt-1 text-[18px] font-bold tracking-tight tabular-nums',
                semDado ? 'text-[var(--nx-ink-3)]' : 'text-[var(--nx-ink)]',
              )}
            >
              {valor}
            </div>
          </div>
          <div className={clsx(CARD_INNER, 'p-3')}>
            <div className={ROTULO}>Variação</div>
            <div className="mt-1 text-[18px] font-bold tracking-tight text-[var(--nx-ink-3)] tabular-nums">
              —
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <Secao titulo="O que é">
            <p className="text-[13px] leading-relaxed text-[var(--nx-ink-2)]">{node.what}</p>
          </Secao>

          <Secao titulo="Como calcula">
            <code
              className={clsx(
                CARD_INNER,
                'block px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--nx-accent-ink)]',
              )}
            >
              {node.calc}
            </code>
          </Secao>

          <Secao
            titulo={previa ? 'Exemplo (dados de prévia)' : 'Exemplo com seus dados'}
          >
            <p className="text-[13px] leading-relaxed text-[var(--nx-ink)]">{node.example}</p>
          </Secao>

          <Secao titulo="Impacto no negócio">
            <p className="text-[13px] leading-relaxed text-[var(--nx-ink-2)]">{node.impact}</p>
          </Secao>

          <Secao titulo="Impacto no próximo indicador">
            <div className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3">
              <div className="flex items-center gap-2">
                <ArrowRight className="h-3.5 w-3.5 text-[var(--nx-accent-ink)]" />
                <span className="text-[12px] font-semibold text-[var(--nx-ink)]">{node.next}</span>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--nx-ink-2)]">
                {node.nextImpact}
              </p>
            </div>
          </Secao>

          <div
            className="rounded-[12px] border border-[color-mix(in_srgb,var(--nx-accent)_30%,var(--nx-border))] bg-[var(--nx-surface-2)] p-4"
            style={{
              backgroundImage:
                'radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--nx-accent) 12%, transparent), transparent 60%)',
            }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-[var(--nx-accent-ink)]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nx-accent-ink)]">
                Insight NEXUS IA
              </span>
              <span className="rounded-full bg-[color-mix(in_srgb,var(--nx-accent)_15%,transparent)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--nx-accent-ink)]">
                Simulação
              </span>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--nx-ink-2)]">
              {simulacao ? (
                simulacao
              ) : erroSimulacao ? (
                <span className="text-[var(--nx-red)]">{erroSimulacao}</span>
              ) : semDado ? (
                `Ainda não existe fonte de dado para ${node.label}. O NEXUS não inventa número: registre a informação no módulo correspondente para liberar esta análise.`
              ) : (
                `Melhorar ${node.label} em 10% impacta diretamente ${node.next}, que passa a ser o ponto de atenção do fluxo.`
              )}
            </p>
            {simulando && (
              <p
                role="status"
                className="mt-2 flex items-center gap-2 text-[12px] text-[var(--nx-accent-ink)]"
              >
                <RefreshCw className="h-3 w-3 animate-spin" />
                Gerando simulação com a IA…
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Rodapé fixo com CTA */}
      <footer className="border-t border-[var(--nx-border)] bg-[var(--nx-surface)] px-5 py-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={aoSimular}
          disabled={simulando}
          aria-busy={simulando}
          className={clsx(
            'flex h-10 w-full items-center justify-center gap-2 rounded-[10px]',
            'bg-[var(--nx-accent)] text-[13px] font-semibold text-[var(--nx-accent-ink)]',
            'transition-[filter,transform] duration-200 hover:brightness-110 active:scale-[0.99]',
            'disabled:cursor-wait disabled:opacity-70',
            FOCO,
          )}
        >
          <Sparkles className={clsx('h-3.5 w-3.5', simulando && 'animate-pulse')} />
          {simulando ? 'Simulando…' : 'Simular otimização'}
        </button>
        <p className="mt-2 text-center text-[10px] leading-relaxed text-[var(--nx-ink-3)]">
          Fonte: {node.fonte}
        </p>
      </footer>
    </div>
  );
}

/** Seção rotulada do drawer. */
function Secao({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h4 className={clsx(ROTULO, 'mb-1.5')}>{titulo}</h4>
      {children}
    </section>
  );
}

/* ========================================================================== *
 *  Página
 * ========================================================================== */
type Modo = 'reais' | 'previa';

export default function IndicadoresPage() {
  /* ---- estado ---------------------------------------------------------- */
  const [modo, setModo] = useState<Modo>('reais');
  const [selecionadoId, setSelecionadoId] = useState<string>('vendas');
  /**
   * `null` = viewport ainda desconhecido (render no servidor / primeira
   * hidratação). Enquanto isso o drawer não é desenhado, evitando o flash do
   * bottom sheet em telas estreitas.
   */
  const [telaLarga, setTelaLarga] = useState<boolean | null>(null);
  const [drawerAberto, setDrawerAberto] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [reais, setReais] = useState<DadosReais>({});
  /** Série crua do período — guardada para a sparkline real da Margem. */
  const [serie, setSerie] = useState<DashboardSerie | null>(null);
  /** Simulação de otimização via IA (POST /ia/perguntar), com o id do nó a
   *  que pertence: a resposta só aparece no drawer do indicador que a pediu,
   *  mesmo que ela chegue depois de o usuário navegar para outro (corrida). */
  const [simulandoId, setSimulandoId] = useState<string | null>(null);
  const [simulacao, setSimulacao] = useState<{ id: string; texto: string } | null>(null);
  const [erroSimulacao, setErroSimulacao] = useState<{ id: string; texto: string } | null>(null);

  /**
   * ≥1536px (2xl) a coluna do drawer cabe ao lado do conteúdo e já vem aberta;
   * abaixo disso o detalhe vira bottom sheet, que precisa começar fechado.
   */
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1536px)');
    const aplicar = () => {
      setTelaLarga(mq.matches);
      setDrawerAberto(mq.matches);
    };
    aplicar();
    mq.addEventListener('change', aplicar);
    return () => mq.removeEventListener('change', aplicar);
  }, []);

  /** Refs dos pills, para rolar até o selecionado e mover o foco. */
  const pillsRef = useRef(new Map<string, HTMLButtonElement>());
  /**
   * Callbacks de ref estáveis por nó: sem o cache, o React desliga e religa
   * os 22 refs a cada render (o arrow inline é uma função nova toda vez).
   */
  const callbacksRef = useRef(new Map<string, (el: HTMLButtonElement | null) => void>());

  const criarRef = useCallback((id: string) => {
    let fn = callbacksRef.current.get(id);
    if (!fn) {
      fn = (el) => {
        if (el) pillsRef.current.set(id, el);
        else pillsRef.current.delete(id);
      };
      callbacksRef.current.set(id, fn);
    }
    return fn;
  }, []);

  /**
   * Tooltip em `position: fixed`: a trilha dos fluxos tem `overflow-x-auto`,
   * que recortaria um tooltip absoluto posicionado acima do pill. Medimos o
   * retângulo do elemento e fixamos o balão na viewport.
   */
  const [tooltip, setTooltip] = useState<{
    node: IndicadorNode;
    x: number;
    y: number;
    abaixo: boolean;
  } | null>(null);

  const handleEntrar = useCallback((node: IndicadorNode, el: HTMLButtonElement) => {
    const r = el.getBoundingClientRect();
    const MARGEM = 140; // mantém o balão inteiro visível na horizontal
    const x = Math.min(
      Math.max(r.left + r.width / 2, MARGEM),
      window.innerWidth - MARGEM,
    );
    setTooltip({ node, x, y: r.top, abaixo: r.top < 150 });
  }, []);

  const handleSair = useCallback(() => setTooltip(null), []);

  // Some com o tooltip quando a página rola ou redimensiona.
  useEffect(() => {
    if (!tooltip) return;
    const fechar = () => setTooltip(null);
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [tooltip]);

  /* ---- dados ----------------------------------------------------------- */
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { inicio, fim } = intervaloDoPreset('mes', '', '');
      const params = {
        periodoInicio: comFuso(inicio, '00:00'),
        periodoFim: comFuso(fim, '23:59'),
      };

      // `Promise.allSettled`: uma permissão negada não pode derrubar a tela
      // inteira — cada indicador simplesmente fica "—" se não tiver fonte.
      const [serie, dre, roi] = await Promise.allSettled([
        api.get<DashboardSerie>('/dashboard/serie', { params }),
        api.get<{ detalhes: DreDetalhes }>('/dre', { params }),
        api.get<RoiResposta>('/roi', { params }),
      ]);

      const falhas = [serie, dre, roi].filter((r) => r.status === 'rejected').length;
      if (falhas === 3) {
        setErro(mensagemErro((roi as PromiseRejectedResult).reason, 'Falha ao carregar os indicadores.'));
      } else if (falhas > 0) {
        setErro('Parte dos indicadores não pôde ser carregada (permissão ou endpoint indisponível).');
      }

      setReais(
        mapearReais(
          serie.status === 'fulfilled' ? serie.value.data : null,
          dre.status === 'fulfilled' ? dre.value.data : null,
          roi.status === 'fulfilled' ? roi.value.data : null,
        ),
      );
      setSerie(serie.status === 'fulfilled' ? serie.value.data : null);
    } catch (e) {
      setErro(mensagemErro(e, 'Falha ao carregar os indicadores.'));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return; // layout/middleware trata o redirecionamento
    void carregar();
  }, [carregar]);

  /* ---- valores derivados ----------------------------------------------- */
  const todosOsNos = useMemo(
    () => [...fluxo1Nodes, ...fluxo2Nodes],
    [],
  );

  const selecionado = useMemo(
    () => todosOsNos.find((n) => n.id === selecionadoId) ?? todosOsNos[0],
    [todosOsNos, selecionadoId],
  );

  /** Valor exibido: real quando existe fonte, prévia no modo de prévia, "—" caso contrário. */
  const valorDe = useCallback(
    (node: IndicadorNode) => {
      if (modo === 'previa') return node.value;
      return reais[node.id] ?? '—';
    },
    [modo, reais],
  );

  const semDadosNoPeriodo = useMemo(
    // Só quando a série CARREGOU com zero vendas (`reais.vendas` só existe
    // se /dashboard/serie respondeu) e o modo é real. Antes a condição era
    // `Object.keys(reais) === 0`, que é verdadeira exatamente quando os 3
    // endpoints FALHAM — aí a tela mostrava "Nenhuma venda registrada"
    // escondendo o verdadeiro motivo (permissão/rede), que já tem banner
    // próprio. Falha parcial (/roi fora) não esconde o estado vazio: a
    // frase "nenhuma venda" continua verdadeira e o banner cobre a falha.
    () => modo === 'reais' && !carregando && reais.vendas === '0',
    [modo, carregando, reais],
  );

  /* ---- handlers -------------------------------------------------------- */
  const handleSelectNode = useCallback((id: string) => {
    setSelecionadoId(id);
    setDrawerAberto(true);
    // Mantém o pill visível em telas com scroll horizontal.
    pillsRef.current.get(id)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
    // A simulação é guardada com o id do nó, então trocar de indicador não
    // reapresenta texto alheio — nada a limpar aqui (nem via setas).
  }, []);

  /**
   * "Simular otimização": chama `POST /ia/perguntar` (endpoint real, mesma
   * rota usada pela aba RH) com o contexto do indicador selecionado. Sem
   * permissão `ia:visualizar` ou sem IA disponível, o erro aparece no drawer
   * — o botão nunca fica morto nem finge sucesso.
   */
  const handleSimular = useCallback(async () => {
    const id = selecionado.id;
    setSimulandoId(id);
    setErroSimulacao(null);
    try {
      const valorAtual = valorDe(selecionado);
      const r = await api.post<{ resposta?: string; text?: string }>('/ia/perguntar', {
        pergunta:
          `Simule uma otimização do indicador "${selecionado.label}" ` +
          `(${selecionado.formula}). ` +
          `Valor atual no período: ${valorAtual === '—' ? 'sem dado' : valorAtual}. ` +
          `Contexto: ${selecionado.impact} ` +
          `Sugira de 2 a 3 ações concretas para melhorar este indicador e o efeito ` +
          `esperado no próximo ("${selecionado.next}"). Responda em português, em no máximo 6 linhas.`,
      });
      const texto = (r.data?.resposta ?? r.data?.text ?? '').trim();
      setSimulacao({
        id,
        texto: texto || 'A IA não retornou texto. Tente novamente em instantes.',
      });
    } catch (e) {
      setErroSimulacao({
        id,
        texto: mensagemErro(e, 'Não foi possível gerar a simulação agora. Verifique a permissão de IA.'),
      });
    } finally {
      setSimulandoId((atual) => (atual === id ? null : atual));
    }
  }, [selecionado, valorDe]);

  const handleTeclado = useCallback(
    (e: ReactKeyboardEvent<HTMLUListElement>, fluxo: Fluxo) => {
      const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (delta === 0 && e.key !== 'Home' && e.key !== 'End') return;

      const atual = fluxo.nodes.findIndex((n) => n.id === selecionadoId);
      const ultimo = fluxo.nodes.length - 1;
      const proximo =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? ultimo
            : Math.min(ultimo, Math.max(0, (atual < 0 ? 0 : atual) + delta));

      e.preventDefault();
      const alvo = fluxo.nodes[proximo];
      if (!alvo) return;
      setSelecionadoId(alvo.id);
      pillsRef.current.get(alvo.id)?.focus();
    },
    [selecionadoId],
  );

  // Fecha o bottom sheet com Esc (no desktop o drawer é uma coluna persistente).
  useEffect(() => {
    if (!drawerAberto || telaLarga) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerAberto(false);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [drawerAberto, telaLarga]);

  // Trava o scroll do fundo enquanto o bottom sheet estiver aberto.
  useEffect(() => {
    if (!drawerAberto || telaLarga) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [drawerAberto, telaLarga]);

  /* ---- render ---------------------------------------------------------- */
  const previa = modo === 'previa';
  const valorSelecionado = valorDe(selecionado);
  // Simulação pertence ao nó que a pediu: outro indicador não herda texto.
  const simulacaoAtual = simulacao?.id === selecionado.id ? simulacao.texto : null;
  const erroSimulacaoAtual =
    erroSimulacao?.id === selecionado.id ? erroSimulacao.texto : null;
  const simulandoAtual = simulandoId === selecionado.id;

  return (
    <div className="p-4 md:p-6 xl:p-8">
      {/* Animações escopadas desta página (o globals.css não tem keyframes). */}
      <style jsx>{`
        .trilho-dash {
          animation: ind-dash 6s linear infinite;
          animation-play-state: paused;
        }
        .ponto-viajante {
          animation: ind-viajar 6s linear infinite;
          animation-play-state: paused;
        }
        .fluxo:hover .trilho-dash,
        .fluxo:hover .ponto-viajante {
          animation-play-state: running;
        }
        .fluxo:hover .linha-fluxo {
          opacity: 1;
        }
        .balao {
          animation: ind-balao 150ms ease-out both;
        }
        .balao-abaixo {
          animation-name: ind-balao-abaixo;
        }
        @keyframes ind-dash {
          to {
            stroke-dashoffset: -1000;
          }
        }
        @keyframes ind-viajar {
          0% {
            left: 0%;
            opacity: 0;
          }
          8% {
            opacity: 1;
          }
          92% {
            opacity: 1;
          }
          100% {
            left: 100%;
            opacity: 0;
          }
        }
        @keyframes ind-balao {
          from {
            opacity: 0;
            transform: translate(-50%, calc(-100% - 8px)) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translate(-50%, calc(-100% - 12px)) scale(1);
          }
        }
        @keyframes ind-balao-abaixo {
          from {
            opacity: 0;
            transform: translate(-50%, 8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 12px) scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .trilho-dash,
          .ponto-viajante,
          .balao,
          .balao-abaixo {
            animation: none;
            opacity: 1;
          }
        }
      `}</style>

      <ModuleHeader
        kicker="Gestão"
        title="Indicadores"
        subtitle="Relação entre os indicadores do negócio: da venda até o ROI e do marketing até CAC × LTV — calculados com dados reais da empresa."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Alternador de fonte: explícito e honesto */}
            <div
              role="group"
              aria-label="Origem dos dados exibidos"
              className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-[#121221] p-1"
            >
              {(['reais', 'previa'] as Modo[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModo(m)}
                  aria-pressed={modo === m}
                  className={clsx(
                    'h-7 rounded-full px-3 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors',
                    modo === m ? 'bg-[#7C3AED] text-white' : 'text-white/40 hover:text-white/80',
                    FOCO,
                  )}
                >
                  {m === 'reais' ? 'Reais' : 'Prévia'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void carregar()}
              disabled={carregando}
              aria-label="Atualizar indicadores"
              className={clsx(
                'flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-[#121221]',
                'text-white/50 transition-colors hover:text-white disabled:opacity-50',
                FOCO,
              )}
            >
              <RefreshCw className={clsx('h-4 w-4', carregando && 'animate-spin')} />
            </button>
          </div>
        }
      />

      {previa && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-[12px] border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p className="text-[12px] leading-relaxed text-amber-200/80">
            <strong className="font-semibold">Modo prévia.</strong> Os valores
            abaixo são demonstrativos e{' '}
            <strong>não refletem a operação real</strong> da sua empresa. Use para
            conhecer o fluxo; troque para <strong>Reais</strong> para ver os dados
            do período.
          </p>
        </div>
      )}

      {erro && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-[12px] border border-red-500/25 bg-red-500/[0.07] px-4 py-3"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <p className="text-[12px] leading-relaxed text-red-200/80">{erro}</p>
        </div>
      )}

      <div
        className={clsx(
          'grid items-start gap-6',
          drawerAberto
            ? '2xl:grid-cols-[minmax(0,1fr)_400px]'
            : '2xl:grid-cols-[minmax(0,1fr)]',
        )}
      >
        {/* ---------------- Coluna principal ---------------- */}
        <div className="min-w-0 space-y-6">
          {/* Barra de KPIs de herói */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {KPIS_HERO.map((kpi) => {
              // Modo prévia: valores V3 (rotulados pelo aviso acima).
              // Modo real: só o que veio do backend; sem fonte → "—".
              // O delta V3 ('+3,1 p.p.' etc.) só existe na prévia: não há
              // busca de período anterior nesta tela, então no modo real ele
              // é `null` e o card mostra "—" em vez de variação inventada.
              const valorHero = previa ? kpi.value : (reais[kpi.id] ?? '—');
              const deltaHero = previa ? kpi.delta : null;
              // Série real só existe onde há fonte: a sparkline do V3 é um
              // desenho de prévia e não pode passar por tendência real.
              const sparkHero = previa
                ? kpi.spark
                : kpi.id === 'margem' && serie?.pontos.length
                  ? serie.pontos
                      .map((p) => p.margem)
                      .filter((m): m is number => m !== null)
                  : null;
              return (
                <KpiCardHero
                  key={kpi.id}
                  kpi={kpi}
                  valor={valorHero}
                  delta={deltaHero}
                  spark={sparkHero && sparkHero.length > 1 ? sparkHero : null}
                  carregando={carregando && !previa}
                  aoAbrir={() => handleSelectNode(kpi.id)}
                />
              );
            })}
          </div>

          {/* Estado vazio: empresa sem movimento no período */}
          {semDadosNoPeriodo && !carregando && (
            <EmptyState
              icon={Database}
              title="Nenhuma venda registrada neste mês"
              description="Os indicadores serão calculados a partir das vendas, custos, despesas e metas reais da empresa. Sem movimento registrado, permanecem vazios — o NEXUS OS nunca exibe números fictícios."
            />
          )}

          {/* Os dois fluxos */}
          {FLUXOS.map((fluxo) => (
            <FluxoCard
              key={fluxo.id}
              fluxo={fluxo}
              selecionadoId={selecionadoId}
              valorDe={valorDe}
              carregando={carregando && !previa}
              criarRef={criarRef}
              aoSelecionar={handleSelectNode}
              aoEntrar={handleEntrar}
              aoSair={handleSair}
              aoTeclado={handleTeclado}
            />
          ))}

          {/* Análise de gargalos */}
          {previa && (
            <Panel className="border-[#3A1E2A] bg-gradient-to-br from-[#1A121E] to-[#121221]">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-red-500/10">
                  <AlertTriangle className="h-4 w-4 text-red-300" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold text-white">
                    {GARGALO.titulo}
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-white/60">
                    {GARGALO.texto}
                  </p>
                  <p className="mt-2 text-[12px] leading-relaxed text-[#F5D07A]">
                    → {GARGALO.acao}
                  </p>
                </div>
              </div>
            </Panel>
          )}

          {/* Catálogo de indicadores sem ponto próprio nos fluxos */}
          <Panel>
            <SectionTitle kicker="Catálogo">
              Indicadores de apoio
            </SectionTitle>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CATALOGO.map((nome) => (
                <div
                  key={nome}
                  className={clsx(
                    CARD_INNER,
                    'flex items-center justify-between gap-3 px-3 py-2.5',
                  )}
                >
                  <span className="text-[12.5px] font-medium text-white/70">{nome}</span>
                  <span className="text-[12px] tabular-nums text-white/25">—</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--nx-ink-3)]">
              Estes indicadores não são pontos de nenhum dos dois fluxos. Serão
              calculados quando os módulos de metas e financeiro expuserem a base
              completa.
            </p>
          </Panel>
        </div>

        {/* ---------------- Drawer (desktop: coluna sticky 400px) ---------------- */}
        {telaLarga && drawerAberto && (
          <aside className="2xl:sticky 2xl:top-6 2xl:h-[calc(100dvh-7rem)]">
            <div
              className={clsx(
                CARD,
                'flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] bg-[#1A1A2E]',
              )}
            >
              <Drawer
                node={selecionado}
                valor={valorSelecionado}
                semDado={valorSelecionado === '—'}
                previa={previa}
                aoFechar={() => setDrawerAberto(false)}
                comoSheet={false}
                simulando={simulandoAtual}
                simulacao={simulacaoAtual}
                erroSimulacao={erroSimulacaoAtual}
                aoSimular={() => void handleSimular()}
              />
            </div>
          </aside>
        )}
      </div>

      {/* ---------------- Drawer (mobile/tablet: bottom sheet) ---------------- */}
      {telaLarga === false && drawerAberto && (
        <div className="fixed inset-0 z-50 flex items-end">
          <button
            type="button"
            aria-label="Fechar detalhe do indicador"
            onClick={() => setDrawerAberto(false)}
            className="absolute inset-0 h-full w-full bg-black/60 backdrop-blur-sm"
          />
          <div
            className={clsx(
              CARD,
              'relative flex max-h-[86dvh] w-full flex-col overflow-hidden rounded-t-[20px]',
              'border-b-0 shadow-[0_-12px_40px_rgba(0,0,0,0.6)]',
            )}
          >
            {/* Alça visual do sheet */}
            <div className="flex justify-center pt-2.5" aria-hidden="true">
              <span className="h-1 w-10 rounded-full bg-white/15" />
            </div>
            <Drawer
              node={selecionado}
              valor={valorSelecionado}
              semDado={valorSelecionado === '—'}
              previa={previa}
              aoFechar={() => setDrawerAberto(false)}
              comoSheet
              simulando={simulandoAtual}
              simulacao={simulacaoAtual}
              erroSimulacao={erroSimulacaoAtual}
              aoSimular={() => void handleSimular()}
            />
          </div>
        </div>
      )}

      {/* Botão flutuante que reabre o detalhe quando o drawer está fechado */}
      {telaLarga !== null && !drawerAberto && (
        <button
          type="button"
          onClick={() => setDrawerAberto(true)}
          aria-label={`Abrir detalhe do indicador ${selecionado.label}`}
          className={clsx(
            'fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2 rounded-full',
            'border border-white/[0.08] bg-[#1A1A2E]/90 px-4 text-[12.5px] font-semibold text-white',
            'shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl',
            'transition-transform duration-200 hover:scale-[1.03]',
            FOCO,
          )}
        >
          <Gauge className="h-4 w-4 text-[#A78BFA]" />
          {selecionado.label}
        </button>
      )}

      {/* Tooltip em position:fixed — não é recortado pela trilha com scroll */}
      {tooltip && (
        <div
          role="tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          className={clsx(
            'balao pointer-events-none fixed z-[60] w-64 rounded-[12px] border border-white/[0.10]',
            'bg-[#0B0B18]/95 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl',
            tooltip.abaixo && 'balao-abaixo',
          )}
        >
          <div className={ROTULO}>{tooltip.node.label}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-white/70">
            {tooltip.node.what}
          </p>
          <p className="mt-2 border-t border-white/[0.06] pt-2 font-mono text-[11px] text-[#A78BFA]">
            {tooltip.node.formula}
          </p>
        </div>
      )}

      {/* Nota de rodapé de integridade dos dados */}
      <p className="mt-6 text-[11px] leading-relaxed text-white/25">
        Os indicadores são calculados a partir das vendas, custos, despesas e metas
        reais da empresa. Indicadores sem fonte de dado permanecem vazios — o NEXUS
        OS nunca exibe números fictícios.
      </p>
    </div>
  );
}

