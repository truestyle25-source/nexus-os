export interface CupomImprimivel {
  id: string;
  criadoEm: string;
  filialNome: string;
  operador: string;
  itens: Array<{ nome: string; quantidade: number; total: number }>;
  subtotal: number;
  desconto: number;
  total: number;
  forma: string;
  parcelas: number;
}

/** Maps a persisted, finalized sale to the existing non-fiscal receipt view. */
export function cupomDaVenda(venda: any, filialNome: string, operador: string): CupomImprimivel | null {
  if (!venda || typeof venda.id !== 'string' || venda.status !== 'FINALIZADA' || !Array.isArray(venda.itens) || venda.itens.length === 0) return null;
  const subtotal = Number(venda.subtotal);
  const desconto = Number(venda.desconto);
  const total = Number(venda.total);
  const parcelas = Number(venda.parcelas ?? 1);
  const forma = typeof venda.formaPagamento === 'string' ? venda.formaPagamento : '';
  if (![subtotal, desconto, total, parcelas].every(Number.isFinite) || subtotal < 0 || desconto < 0 || total < 0 || parcelas < 1 || !forma) return null;

  const itens = venda.itens.map((item: any) => ({
    nome: String(item.produtoNome ?? item.nome ?? '').trim(),
    quantidade: Number(item.quantidade),
    total: Number(item.total),
  }));
  if (itens.some((item: CupomImprimivel['itens'][number]) => !item.nome || !Number.isFinite(item.quantidade) || item.quantidade <= 0 || !Number.isFinite(item.total) || item.total < 0)) return null;

  const dataVenda = new Date(venda.createdAt);
  if (!Number.isFinite(dataVenda.getTime())) return null;
  return {
    id: venda.id,
    criadoEm: dataVenda.toISOString(),
    filialNome,
    operador,
    itens,
    subtotal,
    desconto,
    total,
    forma,
    parcelas,
  };
}

/**
 * Formata o cupom NÃO FISCAL em texto puro (monoespaçado), pronto para
 * `window.print()`. Movido de `page.tsx` para cá para ser fonte única e
 * testável — a saída é idêntica à anterior. `brlFn` e `rotuloForma` são
 * injetados para respeitar as preferências de Moeda/Idioma da tela sem que este
 * módulo puro dependa de `lib/format`.
 *
 * Este comprovante é comercial, NÃO fiscal: nunca deve ser apresentado como
 * documento fiscal autorizado.
 */
export function renderCupom(c: any, brlFn: (v: number) => string, rotuloForma: Record<string, string>): string {
  const linhas: string[] = [];
  linhas.push('========== NEXUS OS ==========');
  linhas.push('      CUPOM NÃO FISCAL');
  if (c.filialNome) linhas.push(`Filial: ${c.filialNome}`);
  linhas.push(`Data: ${new Date(c.criadoEm).toLocaleString('pt-BR')}`);
  // O operador chega aqui como NOME (`caixa.usuario.nome`). O corte é por
  // tamanho de linha, não por ser id: um nome muito longo quebraria a
  // monoespaçada do cupom. A venda mantém o id curto, como antes.
  linhas.push(`Venda: ${String(c.id).slice(0, 8)} · Operador: ${String(c.operador ?? '').slice(0, 28)}`);
  linhas.push('------------------------------');
  for (const i of c.itens ?? []) linhas.push(`${i.quantidade}x ${(i.nome ?? 'Item').slice(0, 24).padEnd(24)} ${brlFn(Number(i.total))}`);
  linhas.push('------------------------------');
  linhas.push(`Subtotal: ${brlFn(Number(c.subtotal))}`);
  if (Number(c.desconto) > 0) linhas.push(`Desconto: -${brlFn(Number(c.desconto))}`);
  linhas.push(`TOTAL: ${brlFn(Number(c.total))}`);
  const forma = rotuloForma[c.forma] ?? c.forma;
  // As parcelas são GRAVADAS na venda (`Venda.parcelas`); a linha traz também
  // o valor de cada uma, que é o que o cliente realmente precisa.
  const nParcelas = Number(c.parcelas) || 1;
  linhas.push(`Pagamento: ${forma}${c.forma === 'CARTAO_CREDITO' && nParcelas > 1 ? ` ${nParcelas}x de ${brlFn(Number(c.total) / nParcelas)}` : ''}`);
  if (c.troco > 0) linhas.push(`Troco: ${brlFn(c.troco)}`);
  linhas.push('------------------------------');
  linhas.push('     Obrigado pela preferência!');
  return linhas.join('\n');
}
