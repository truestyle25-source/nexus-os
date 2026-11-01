// NEXUS OS — dicionário de fórmulas dos KPIs (fiel ao Layout Mestre V2.1)
// Cada card de indicador mostra a fórmula/métrica ao passar o mouse.
export const KPI_FORMULAS: Record<string, string> = {
  'Faturamento Bruto': 'Total de vendas antes das deduções.',
  'Receita Líquida': 'Receita após impostos, devoluções e abatimentos.',
  'Número de Vendas': 'Quantidade total de vendas no período.',
  'Ticket Médio': 'Faturamento Total ÷ Número de Vendas',
  CMV: 'Custo direto relacionado ao que foi vendido.',
  'Lucro Bruto': 'Receita Líquida − CMV/CPV/CSP',
  'Margem Bruta': '(Lucro Bruto ÷ Receita Líquida) × 100',
  'Despesas Operacionais': 'Gastos necessários para manter a operação.',
  EBITDA: 'Resultado operacional antes de juros, impostos, depreciação e amortização.',
  'Lucro Líquido': 'Resultado final após os componentes aplicáveis.',
  Lucratividade: '(Lucro Líquido ÷ Receita) × 100',
  'Ponto de Equilíbrio': 'Custos Fixos Totais ÷ Margem de Contribuição',
  ROI: '[(Ganho − Custo) ÷ Custo] × 100',
  CAC: 'Investimento Marketing e Vendas ÷ Nº Novos Clientes',
  LTV: 'Valor econômico estimado do cliente no relacionamento.',
  'Meta Atingida': 'Realizado ÷ Meta × 100',
};
