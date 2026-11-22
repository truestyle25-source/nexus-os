// Estado do formulário da ficha de compra (compartilhado entre as abas) e corpo da API.
import { lerNumero } from '@/lib/produto-ficha';
import type { FichaCompra } from '@/lib/compra-ficha';

export interface ItemForm {
  produtoId: string; codigo: string | null; nome: string; quantidade: string; unidade: string; valorUnit: string; desconto: string; observacao: string;
  custoAtual?: number; ultimoPreco?: number | null; unidadeBase?: string;
}
export interface FormCompra {
  filialId: string; fornecedorId: string; responsavelId: string; dataCompra: string; previsaoEntrega: string; prioridade: string;
  condPagamento: string; formaPagamento: string; parcelas: string; primeiroVencimento: string; contaFinanceira: string; centroCusto: string; planoContas: string;
  observacoesFinanceiras: string; observacoes: string; observacoesFornecedor: string; desconto: string; frete: string; outrasDespesas: string;
  itens: ItemForm[];
}

const txt = (v: unknown) => (v == null ? '' : String(v));
const numTxt = (v: unknown) => (v == null || v === '' ? '' : String(Number(v)).replace('.', ','));
const dia = (v: unknown) => (v ? String(v).slice(0, 10) : '');

export function formVazio(): FormCompra {
  return {
    filialId: '', fornecedorId: '', responsavelId: '', dataCompra: new Date().toISOString().slice(0, 10), previsaoEntrega: '', prioridade: 'NORMAL',
    condPagamento: '', formaPagamento: '', parcelas: '1', primeiroVencimento: '', contaFinanceira: '', centroCusto: '', planoContas: '',
    observacoesFinanceiras: '', observacoes: '', observacoesFornecedor: '', desconto: '', frete: '', outrasDespesas: '', itens: [],
  };
}

export function formDaFicha(f: FichaCompra): FormCompra {
  const c = f.compra;
  return {
    filialId: txt(c.filial?.id), fornecedorId: f.fornecedor.id, responsavelId: txt(c.responsavel?.id), dataCompra: dia(c.dataCompra), previsaoEntrega: dia(c.previsaoEntrega),
    prioridade: txt(c.prioridade) || 'NORMAL', condPagamento: txt(c.condPagamento), formaPagamento: txt(c.formaPagamento), parcelas: String(c.parcelas ?? 1),
    primeiroVencimento: dia(c.primeiroVencimento), contaFinanceira: txt(c.contaFinanceira), centroCusto: txt(c.centroCusto), planoContas: txt(c.planoContas),
    observacoesFinanceiras: txt(c.observacoesFinanceiras), observacoes: txt(c.observacoes), observacoesFornecedor: txt(c.observacoesFornecedor),
    desconto: numTxt(c.desconto || ''), frete: numTxt(c.frete || ''), outrasDespesas: numTxt(c.outrasDespesas || ''),
    itens: f.itens.map((i) => ({
      produtoId: i.produtoId, codigo: i.codigo, nome: i.nome, quantidade: numTxt(i.quantidade), unidade: i.unidade, valorUnit: numTxt(i.valorUnit),
      desconto: numTxt(i.desconto || ''), observacao: txt(i.observacao), custoAtual: i.custoAtual, ultimoPreco: i.ultimoPrecoFornecedor, unidadeBase: i.unidadeBase,
    })),
  };
}

/** Itens no formato da API (números lidos no padrão brasileiro). */
export function itensApi(itens: ItemForm[]) {
  return itens.map((i) => ({
    produtoId: i.produtoId, quantidade: lerNumero(i.quantidade) ?? 0, valorUnit: lerNumero(i.valorUnit) ?? 0, unidadeCompra: i.unidade || undefined,
    desconto: lerNumero(i.desconto) ?? 0, observacao: i.observacao.trim() || null,
  }));
}

/** Corpo da API: tudo (cadastro, `original` null) ou só o que mudou (edição). Itens/valores só quando editáveis. */
export function payloadCompra(original: FormCompra | null, f: FormCompra, editavel: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const mudou = (k: keyof FormCompra) => !original || JSON.stringify(original[k]) !== JSON.stringify(f[k]);
  const texto = ['responsavelId', 'prioridade', 'condPagamento', 'formaPagamento', 'contaFinanceira', 'centroCusto', 'planoContas', 'observacoesFinanceiras', 'observacoes', 'observacoesFornecedor'] as const;
  for (const k of texto) if (mudou(k) && (f[k] || original)) out[k] = f[k].trim() || null;
  if (out.prioridade === null) delete out.prioridade;
  for (const k of ['dataCompra', 'previsaoEntrega', 'primeiroVencimento'] as const) if (mudou(k) && (f[k] || original)) out[k] = f[k] || null;
  if (out.dataCompra === null) delete out.dataCompra;
  if (mudou('parcelas')) out.parcelas = Math.max(1, Math.round(lerNumero(f.parcelas) ?? 1));
  if (editavel) {
    for (const k of ['filialId', 'fornecedorId'] as const) if (mudou(k) && f[k]) out[k] = f[k];
    for (const k of ['desconto', 'frete', 'outrasDespesas'] as const) if (mudou(k)) out[k] = lerNumero(f[k]) ?? 0;
    if (mudou('itens')) out.itens = itensApi(f.itens);
  }
  return out;
}

/** Validação mínima antes de salvar (o servidor valida tudo de novo). */
export function problemas(f: FormCompra): string[] {
  const p: string[] = [];
  if (!f.filialId) p.push('filial');
  if (!f.fornecedorId) p.push('fornecedor');
  if (!f.itens.length) p.push('ao menos um produto');
  f.itens.forEach((i) => {
    const q = lerNumero(i.quantidade); const v = lerNumero(i.valorUnit);
    if (q == null || q <= 0) p.push(`quantidade de ${i.nome}`);
    if (v == null || v < 0) p.push(`valor de ${i.nome}`);
  });
  return p;
}
