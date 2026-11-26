/**
 * Comprovantes do PDV em texto de 32 colunas (impressora térmica 80 mm em
 * fonte padrão). O mesmo texto vai para a térmica (ESC/POS) ou para a janela
 * de impressão do navegador.
 */

const LARGURA = 32;
const linha = '-'.repeat(LARGURA);
const centro = (t: string) => {
  const s = t.slice(0, LARGURA);
  return ' '.repeat(Math.max(0, Math.floor((LARGURA - s.length) / 2))) + s;
};
/** "Rótulo ........ valor" alinhado nas 32 colunas. */
export const par = (rotulo: string, valor: string) => {
  const espaco = LARGURA - rotulo.length - valor.length;
  return espaco >= 1 ? `${rotulo}${' '.repeat(espaco)}${valor}` : `${rotulo}\n${' '.repeat(Math.max(0, LARGURA - valor.length))}${valor}`;
};
const dataHora = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
const quebrar = (texto: string) => (texto.match(new RegExp(`.{1,${LARGURA}}`, 'g')) ?? ['']).join('\n');

export interface DadosMovimentacao {
  tipo: 'SANGRIA' | 'SUPRIMENTO';
  valor: number;
  motivo?: string | null;
  createdAt: string;
  operadorNome?: string | null;
  autorizadoPorNome?: string | null;
  caixaNumero?: number | null;
  caixaId: string;
  saldoAntes: number;
  saldoDepois: number;
}

export function renderMovimentacao(m: DadosMovimentacao, loja: string, brl: (v: number) => string): string {
  const titulo = m.tipo === 'SANGRIA' ? 'COMPROVANTE DE SANGRIA' : 'COMPROVANTE DE SUPRIMENTO';
  const l = [
    centro(loja || 'NEXUS OS'),
    centro(titulo),
    linha,
    par('Data/hora:', dataHora(m.createdAt)),
    par('Caixa:', `${m.caixaNumero != null ? String(m.caixaNumero).padStart(2, '0') + ' ' : ''}#${m.caixaId.slice(-5)}`),
    par('Operador:', (m.operadorNome ?? '-').slice(0, 20)),
  ];
  if (m.tipo === 'SANGRIA') l.push(par('Autorizou:', (m.autorizadoPorNome ?? 'próprio supervisor').slice(0, 20)));
  l.push(linha, par('VALOR:', brl(m.valor)));
  if (m.motivo) l.push(quebrar(`Motivo: ${m.motivo}`));
  l.push(linha, par('Gaveta antes:', brl(m.saldoAntes)), par('Gaveta depois:', brl(m.saldoDepois)), '', '', '');
  l.push('______________  ______________', m.tipo === 'SANGRIA' ? '   Operador       Supervisor' : '   Operador        Conferente');
  return l.join('\n');
}

export interface DadosRelatorio {
  caixaId: string; numero?: number | null; filial?: string | null; operador?: string | null;
  abertoEm: string; fechadoEm?: string | null;
  fundoTroco: number; totalVendas: number; qtdVendas: number; porForma: Record<string, number>;
  suprimentos: number; sangrias: number; estornos: number; dinheiroEsperado: number;
  valorContado: number | null; diferenca: number | null; observacao?: string | null;
  vendasCanceladas?: number; itensCancelados?: { quantidade: number; valor: number };
}

export function renderRelatorioFechamento(r: DadosRelatorio, brl: (v: number) => string, rotuloForma: Record<string, string>): string {
  const l = [
    centro(r.filial || 'NEXUS OS'),
    centro('FECHAMENTO DE CAIXA'),
    linha,
    par('Caixa:', `${r.numero != null ? String(r.numero).padStart(2, '0') + ' ' : ''}#${r.caixaId.slice(-5)}`),
    par('Operador:', (r.operador ?? '-').slice(0, 20)),
    par('Abertura:', dataHora(r.abertoEm)),
    par('Fechamento:', dataHora(r.fechadoEm)),
    linha,
    par('Fundo inicial:', brl(r.fundoTroco)),
    par(`Vendas (${r.qtdVendas}):`, brl(r.totalVendas)),
  ];
  for (const [forma, valor] of Object.entries(r.porForma ?? {})) l.push(par(`  ${rotuloForma[forma] ?? forma}:`, brl(valor)));
  l.push(
    par('Suprimentos:', brl(r.suprimentos)),
    par('Sangrias:', `- ${brl(r.sangrias)}`),
    par('Estornos:', `- ${brl(r.estornos)}`),
    linha,
    par('Dinheiro esperado:', brl(r.dinheiroEsperado)),
    par('Dinheiro contado:', r.valorContado == null ? '-' : brl(r.valorContado)),
    par('DIFERENCA:', r.diferenca == null ? '-' : `${r.diferenca < 0 ? '-' : r.diferenca > 0 ? '+' : ''}${brl(Math.abs(r.diferenca))}`),
  );
  if (r.diferenca) l.push(centro(r.diferenca < 0 ? '(falta)' : '(sobra)'));
  l.push(linha, par('Vendas canceladas:', String(r.vendasCanceladas ?? 0)));
  if (r.itensCancelados) l.push(par('Itens cancelados:', `${r.itensCancelados.quantidade} (${brl(r.itensCancelados.valor)})`));
  if (r.observacao) l.push(quebrar(`Obs: ${r.observacao}`));
  l.push('', '', '______________  ______________', '   Operador       Supervisor');
  return l.join('\n');
}

export interface DadosCancelamentoVenda {
  vendaId: string; total: number; motivo: string; dinheiroDevolvido: number;
  operadorNome?: string | null; autorizadoPorNome?: string | null; quando: string;
}

export function renderCancelamentoVenda(c: DadosCancelamentoVenda, loja: string, brl: (v: number) => string): string {
  return [
    centro(loja || 'NEXUS OS'),
    centro('CANCELAMENTO DE VENDA'),
    linha,
    par('Data/hora:', dataHora(c.quando)),
    par('Venda:', `#${c.vendaId.slice(-5)}`),
    par('Valor da venda:', brl(c.total)),
    par('Devolvido (din.):', brl(c.dinheiroDevolvido)),
    linha,
    par('Operador:', (c.operadorNome ?? '-').slice(0, 20)),
    par('Autorizou:', (c.autorizadoPorNome ?? 'próprio supervisor').slice(0, 20)),
    quebrar(`Motivo: ${c.motivo}`),
    '', '', '______________  ______________', '   Cliente        Supervisor',
  ].join('\n');
}
