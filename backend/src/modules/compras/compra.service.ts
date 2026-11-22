import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { Conflito, ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { aplicarMovimento } from '../estoque/estoque.service.js';
import { registrarHistoricoPrecos } from '../produtos/produto-campos.js';
import { recalcularCustoDosKits } from '../produtos/kit.service.js';
import { gerarPdf } from '../../lib/pdf.js';

/**
 * Regras do módulo Compras (2026-11-21).
 *
 * FLUXO: RASCUNHO → (AGUARDANDO_APROVACAO → APROVADA, se a empresa exige aprovação) → ENVIADA
 *        → PEDIDO (confirmado pelo fornecedor) → PARCIAL → RECEBIDA → CONCLUIDA.  CANCELADA a qualquer
 *        momento ANTES do primeiro recebimento.
 * Legado: SOLICITADA (tela antiga) equivale a rascunho; o fluxo antigo SOLICITADA → PEDIDO → RECEBIDA
 * continua válido.
 *
 * REGRA INEGOCIÁVEL: pedido NÃO movimenta estoque; só o RECEBIMENTO CONFIRMADO movimenta. Cada
 * recebimento é atômico (recebimento + movimentações + custo + financeiro na mesma transação) e
 * idempotente (chave única por empresa): confirmar duas vezes não duplica nada.
 */

type Tx = Prisma.TransactionClient;

export const ROTULO_STATUS: Record<string, string> = {
  RASCUNHO: 'Rascunho', SOLICITADA: 'Rascunho', AGUARDANDO_APROVACAO: 'Aguardando aprovação', APROVADA: 'Aprovada',
  ENVIADA: 'Enviada — aguardando confirmação', PEDIDO: 'Confirmada pelo fornecedor', PARCIAL: 'Parcialmente recebida',
  RECEBIDA: 'Recebida', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada',
};
/** Status em que itens e valores ainda podem ser editados. */
export const EDITAVEIS = ['RASCUNHO', 'SOLICITADA', 'AGUARDANDO_APROVACAO'];
/** Status que aceitam recebimento. */
export const RECEBEM = ['SOLICITADA', 'APROVADA', 'ENVIADA', 'PEDIDO', 'PARCIAL'];
/** Status que permitem envio ao fornecedor. */
export const ENVIAVEIS = ['APROVADA', 'ENVIADA', 'PEDIDO', 'SOLICITADA'];

export const numeroExibido = (n: number | null | undefined) => (n == null ? null : `CP-${String(n).padStart(6, '0')}`);
const arred2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Próximo número da empresa, sob trava transacional (sem colisão entre requisições simultâneas). */
export async function proximoNumeroCompra(tx: Tx, empresaId: string): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`compra-numero:${empresaId}`}))`;
  const max = await tx.compra.aggregate({ where: { empresaId }, _max: { numero: true } });
  return (max._max.numero ?? 0) + 1;
}

/** Totais: produtos (q × valor − desconto do item) − desconto + frete + outras despesas. */
export function calcularTotais(itens: Array<{ quantidade: number; valorUnit: number; desconto?: number }>, extras: { desconto?: number; frete?: number; outrasDespesas?: number }) {
  const valorProdutos = arred2(itens.reduce((s, i) => s + i.quantidade * i.valorUnit - (i.desconto ?? 0), 0));
  const valorTotal = arred2(valorProdutos - (extras.desconto ?? 0) + (extras.frete ?? 0) + (extras.outrasDespesas ?? 0));
  if (valorTotal < 0) throw new ErroDeNegocio('O desconto não pode ser maior que o valor da compra.', 400);
  return { valorProdutos, valorTotal };
}

/** Dias de vencimento a partir da condição ("30/60/90" → [30, 60, 90]; "À vista" → [0]). */
export function prazosDaCondicao(cond: string | null | undefined): number[] {
  const n = (cond ?? '').match(/\d+/g)?.map(Number).filter((x) => x >= 0 && x <= 3650) ?? [];
  return n.length ? n : [0];
}

/** Cronograma de pagamento de um valor (usado na aba Financeiro e no recebimento). */
export function cronograma(valor: number, base: Date, cond: string | null | undefined, parcelas: number, primeiroVencimento?: Date | null) {
  const prazos = prazosDaCondicao(cond);
  const n = Math.max(1, prazos.length > 1 ? prazos.length : parcelas);
  const datas = Array.from({ length: n }, (_, i) => {
    if (primeiroVencimento) { const d = new Date(primeiroVencimento); d.setMonth(d.getMonth() + i); return d; }
    const dias = prazos.length > 1 ? prazos[i] : prazos[0] + 30 * i;
    return new Date(base.getTime() + dias * 86_400_000);
  });
  const parte = arred2(valor / n);
  return datas.map((vencimento, i) => ({ parcela: i + 1, de: n, vencimento, valor: i === n - 1 ? arred2(valor - parte * (n - 1)) : parte }));
}

export interface ItemRecebido { compraItemId: string; quantidadeRecebida: number; quantidadeAvariada?: number; quantidadeRecusada?: number; divergencia?: string | null }

/**
 * Confirma um recebimento (total ou parcial). Tudo numa transação:
 * trava a compra (FOR UPDATE) → valida saldo pendente → grava recebimento → entrada no estoque
 * (aplicarMovimento, com conversão para a unidade base) → custo (política do produto) →
 * vínculo fornecedor×produto → custo dos kits → status da compra → contas a pagar proporcionais.
 */
export async function confirmarRecebimento(tx: Tx, p: {
  empresaId: string; usuarioId: string; compraId: string; itens: ItemRecebido[] | 'TOTAL';
  idempotencyKey: string; notaFiscalId?: string | null; observacoes?: string | null; dataRecebimento?: Date;
}) {
  const repetido = await tx.compraRecebimento.findFirst({ where: { empresaId: p.empresaId, idempotencyKey: p.idempotencyKey } });
  if (repetido) {
    if (repetido.compraId !== p.compraId) throw Conflito('Esta chave de idempotência já foi usada em outro recebimento.');
    return { recebimento: repetido, duplicado: true as const };
  }
  await tx.$queryRaw`SELECT "id" FROM "Compra" WHERE "id" = ${p.compraId} AND "empresaId" = ${p.empresaId} FOR UPDATE`;
  const compra = await tx.compra.findFirst({ where: { id: p.compraId, empresaId: p.empresaId }, include: { itens: true } });
  if (!compra) throw NaoEncontrado('Compra não encontrada.');
  if (compra.status === 'RECEBIDA' || compra.status === 'CONCLUIDA') throw new ErroDeNegocio('Compra já recebida.', 409);
  if (compra.status === 'CANCELADA') throw new ErroDeNegocio('Compra cancelada não pode ser recebida.', 409);
  if (!RECEBEM.includes(compra.status)) {
    throw new ErroDeNegocio(`Compra "${ROTULO_STATUS[compra.status] ?? compra.status}" ainda não pode ser recebida: ${compra.status === 'AGUARDANDO_APROVACAO' ? 'aguarda aprovação' : 'aprove/envie o pedido antes'}.`, 409);
  }
  if (p.notaFiscalId) {
    const nf = await tx.compraNotaFiscal.findFirst({ where: { id: p.notaFiscalId, empresaId: p.empresaId, compraId: compra.id } });
    if (!nf) throw NaoEncontrado('Nota fiscal não encontrada nesta compra.');
  }

  const pendente = (i: (typeof compra.itens)[number]) => new Decimal(i.quantidade).minus(i.quantidadeRecebida);
  const linhas = p.itens === 'TOTAL'
    ? compra.itens.filter((i) => pendente(i).greaterThan(0)).map((i) => ({ item: i, recebido: pendente(i), avariada: new Decimal(0), recusada: new Decimal(0), divergencia: null as string | null }))
    : p.itens.map((r) => {
        const item = compra.itens.find((i) => i.id === r.compraItemId);
        if (!item) throw NaoEncontrado('Item não pertence a esta compra.');
        const recebido = new Decimal(r.quantidadeRecebida).toDecimalPlaces(3);
        const avariada = new Decimal(r.quantidadeAvariada ?? 0).toDecimalPlaces(3);
        const recusada = new Decimal(r.quantidadeRecusada ?? 0).toDecimalPlaces(3);
        if (recebido.lessThan(0) || avariada.lessThan(0) || recusada.lessThan(0)) throw new ErroDeNegocio('Quantidades não podem ser negativas.', 400);
        if (recebido.greaterThan(pendente(item))) {
          throw new ErroDeNegocio(`Quantidade recebida (${recebido}) maior que o pendente (${pendente(item)}) no item ${item.id.slice(-6)}.`, 422);
        }
        return { item, recebido, avariada, recusada, divergencia: r.divergencia?.trim() || null };
      });
  if (new Set(linhas.map((l) => l.item.id)).size !== linhas.length) throw new ErroDeNegocio('Cada item aparece uma vez por recebimento.', 400);
  if (!linhas.some((l) => l.recebido.greaterThan(0))) throw new ErroDeNegocio('Informe ao menos uma quantidade recebida maior que zero.', 400);

  const numero = (await tx.compraRecebimento.count({ where: { compraId: compra.id } })) + 1;
  // Valor da mercadoria aceita neste recebimento (base do financeiro).
  const valorItens = linhas.reduce((s, l) => {
    const q = Number(l.item.quantidade);
    const unitLiquido = q > 0 ? (q * Number(l.item.valorUnit) - Number(l.item.desconto)) / q : Number(l.item.valorUnit);
    return s + l.recebido.toNumber() * unitLiquido;
  }, 0);
  const recebimento = await tx.compraRecebimento.create({
    data: {
      empresaId: p.empresaId, compraId: compra.id, filialId: compra.filialId, numero, usuarioId: p.usuarioId,
      dataRecebimento: p.dataRecebimento ?? new Date(), notaFiscalId: p.notaFiscalId ?? null, observacoes: p.observacoes ?? null,
      valorRecebido: arred2(valorItens), idempotencyKey: p.idempotencyKey,
    },
  });

  for (const l of linhas) {
    const item = l.item;
    const fator = item.fatorAplicado && Number(item.fatorAplicado) > 0 ? Number(item.fatorAplicado) : 1;
    const qtdBase = l.recebido.times(fator).toDecimalPlaces(3).toNumber();
    await tx.compraRecebimentoItem.create({
      data: {
        empresaId: p.empresaId, recebimentoId: recebimento.id, compraItemId: item.id, produtoId: item.produtoId,
        quantidadeRecebida: l.recebido, quantidadeBase: qtdBase, quantidadeAvariada: l.avariada, quantidadeRecusada: l.recusada, divergencia: l.divergencia,
      },
    });
    if (l.recebido.lessThanOrEqualTo(0)) continue;
    await tx.compraItem.update({ where: { id: item.id }, data: { quantidadeRecebida: { increment: l.recebido } } });

    const produto = await tx.produto.findFirst({ where: { id: item.produtoId, empresaId: p.empresaId } });
    if (!produto) throw NaoEncontrado('Produto da compra não pertence à empresa.');
    // Saldo e valor ANTES do movimento (base do custo médio). FOR UPDATE: duas compras do mesmo
    // produto recebidas juntas não leem o mesmo saldo.
    const [estoqueAntes] = await tx.$queryRaw<Array<{ quantidade: Prisma.Decimal; valorTotal: Prisma.Decimal }>>`
      SELECT "quantidade", "valorTotal" FROM "Estoque" WHERE "filialId" = ${compra.filialId} AND "produtoId" = ${produto.id} FOR UPDATE`;
    const q = Number(item.quantidade);
    const unitLiquido = q > 0 ? (q * Number(item.valorUnit) - Number(item.desconto)) / q : Number(item.valorUnit);
    const precoUnitarioBase = unitLiquido / fator;
    await aplicarMovimento(tx, {
      empresaId: p.empresaId, filialId: compra.filialId, produtoId: item.produtoId, usuarioId: p.usuarioId,
      tipo: 'COMPRA', quantidade: qtdBase, motivo: `Recebimento ${numero} da compra ${numeroExibido(compra.numero) ?? compra.id}`,
      documento: compra.id, origem: compra.origem, custoUnitario: precoUnitarioBase, recebimentoId: recebimento.id,
    });
    const qtdAtual = Number(estoqueAntes?.quantidade ?? 0);
    const valorAtual = Number(estoqueAntes?.valorTotal ?? 0);
    const novaQtd = qtdAtual + qtdBase;
    const novoValorTotal = valorAtual + qtdBase * precoUnitarioBase;
    const custoMedio = novaQtd > 0 ? novoValorTotal / novaQtd : precoUnitarioBase;
    const novoCusto = produto.politicaCusto === 'ULTIMO_CUSTO' ? precoUnitarioBase : produto.politicaCusto === 'PADRAO' ? Number(produto.custo) : custoMedio;
    await tx.produto.update({ where: { id: produto.id }, data: { custo: novoCusto, ultimoCustoAquisicao: precoUnitarioBase, precoCompra: Number(item.valorUnit) } });
    await registrarHistoricoPrecos(tx, {
      empresaId: p.empresaId, produtoId: produto.id, usuarioId: p.usuarioId, filialId: compra.filialId,
      anterior: produto, novo: { custo: novoCusto, precoCompra: Number(item.valorUnit) },
      justificativa: `Recebimento da compra ${compra.id}`, origem: 'COMPRA',
    });
    await tx.estoque.update({
      where: { filialId_produtoId: { filialId: compra.filialId, produtoId: produto.id } },
      data: { quantidade: novaQtd, valorTotal: produto.politicaCusto === 'MEDIO_PONDERADO' ? novoValorTotal : novaQtd * novoCusto },
    });
    // Vínculo fornecedor × produto: último preço de compra (por unidade base) e histórico.
    const vinculo = await tx.fornecedorProduto.findFirst({ where: { empresaId: p.empresaId, fornecedorId: compra.fornecedorId, produtoId: item.produtoId } });
    if (vinculo) {
      await tx.fornecedorProduto.update({ where: { id: vinculo.id }, data: { ultimoPrecoCompra: precoUnitarioBase } });
      await tx.fornecedorPrecoHistorico.create({
        data: { empresaId: p.empresaId, fornecedorId: compra.fornecedorId, produtoId: item.produtoId, campo: 'ULTIMA_COMPRA', valorAnterior: vinculo.ultimoPrecoCompra, valorNovo: precoUnitarioBase, origem: 'COMPRA', documento: compra.id, usuarioId: p.usuarioId },
      });
    }
  }
  // Kits que usam algum produto recebido: o custo do kit acompanha (preço de venda não muda).
  await recalcularCustoDosKits(tx, p.empresaId, [...new Set(linhas.filter((l) => l.recebido.greaterThan(0)).map((l) => l.item.produtoId))], {
    usuarioId: p.usuarioId, justificativa: `Componente atualizado no recebimento da compra ${compra.id}`, origem: 'COMPRA',
  });

  const itensDepois = await tx.compraItem.findMany({ where: { compraId: compra.id } });
  const completo = itensDepois.every((i) => new Decimal(i.quantidadeRecebida).greaterThanOrEqualTo(i.quantidade));
  const atualizada = await tx.compra.update({
    where: { id: compra.id },
    data: { status: completo ? 'RECEBIDA' : 'PARCIAL', ...(completo ? { dataRecebimento: new Date() } : {}), atualizadoPorId: p.usuarioId, atualizadoEm: new Date() },
  });

  // Contas a pagar: proporcionais ao que chegou (frete/despesas/desconto rateados pelo valor dos
  // produtos). No recebimento que completa a compra, o valor fecha exatamente o total (sem resto
  // de centavos). Uma conta por parcela, vinculada à compra (compraId).
  const valorProdutos = Number(compra.valorProdutos ?? 0) || compra.itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.valorUnit) - Number(i.desconto), 0);
  const total = Number(compra.valorTotal);
  const jaLancado = Number((await tx.financeiro.aggregate({ where: { empresaId: p.empresaId, compraId: compra.id, tipo: 'DESPESA' }, _sum: { valor: true } }))._sum.valor ?? 0);
  const valorFinanceiro = completo ? arred2(total - jaLancado) : arred2(valorProdutos > 0 ? (valorItens / valorProdutos) * total : valorItens);
  if (valorFinanceiro > 0) {
    const partes = cronograma(valorFinanceiro, recebimento.dataRecebimento, compra.condPagamento, compra.parcelas, numero === 1 ? compra.primeiroVencimento : null);
    for (const parte of partes) {
      await tx.financeiro.create({
        data: {
          empresaId: p.empresaId, filialId: compra.filialId, tipo: 'DESPESA', categoria: 'fornecedores',
          descricao: `Compra ${numeroExibido(compra.numero) ?? compra.id} — recebimento ${numero}${parte.de > 1 ? ` — parcela ${parte.parcela}/${parte.de}` : ''}`,
          valor: parte.valor, vencimento: parte.vencimento, status: 'PENDENTE', compraId: compra.id, origem: compra.origem,
          ...(compra.centroCusto ? { centroCusto: compra.centroCusto } : {}),
        },
      });
    }
  }
  return { recebimento, compra: atualizada, completo, duplicado: false as const };
}

/** PDF do pedido de compra (documento enviado ao fornecedor). */
export function pdfDoPedido(c: {
  numero: number | null; dataCompra: Date; previsaoEntrega: Date | null; condPagamento: string | null; formaPagamento: string | null;
  observacoesFornecedor: string | null; valorProdutos: number; desconto: number; frete: number; outrasDespesas: number; valorTotal: number;
  empresa: { nome: string; cnpj: string | null }; filial: { nome: string };
  fornecedor: { nome: string; nomeFantasia: string | null; cnpj: string | null; email: string | null; telefone: string | null };
  itens: Array<{ codigo: string | null; nome: string; quantidade: number; unidade: string; valorUnit: number; desconto: number; subtotal: number }>;
}): Buffer {
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const data = (d: Date | null) => (d ? d.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—');
  const col = (t: string, n: number, dir = false) => (dir ? t.slice(0, n).padStart(n) : t.slice(0, n).padEnd(n));
  return gerarPdf({
    titulo: `Pedido de compra ${numeroExibido(c.numero) ?? ''}`,
    subtitulo: `${c.empresa.nome}${c.empresa.cnpj ? ` · CNPJ ${c.empresa.cnpj}` : ''} · ${c.filial.nome}`,
    blocos: [
      { texto: 'Fornecedor', negrito: true, espacoAntes: 1 },
      { texto: `${c.fornecedor.nome}${c.fornecedor.nomeFantasia ? ` (${c.fornecedor.nomeFantasia})` : ''}${c.fornecedor.cnpj ? ` · ${c.fornecedor.cnpj}` : ''}` },
      { texto: [c.fornecedor.email, c.fornecedor.telefone].filter(Boolean).join(' · ') || '—' },
      { texto: `Data do pedido: ${data(c.dataCompra)} · Previsão de entrega: ${data(c.previsaoEntrega)}`, espacoAntes: 1 },
      { texto: `Condição: ${c.condPagamento ?? '—'} · Forma de pagamento: ${c.formaPagamento ?? '—'}` },
      { texto: 'Itens', negrito: true, espacoAntes: 1 },
      { texto: `${col('Código', 12)} ${col('Produto', 34)} ${col('Qtd', 9, true)} ${col('Un', 4)} ${col('Unit.', 12, true)} ${col('Subtotal', 13, true)}`, negrito: true, tamanho: 8 },
      ...c.itens.map((i) => ({ texto: `${col(i.codigo ?? '—', 12)} ${col(i.nome, 34)} ${col(String(i.quantidade), 9, true)} ${col(i.unidade, 4)} ${col(brl(i.valorUnit), 12, true)} ${col(brl(i.subtotal), 13, true)}`, tamanho: 8 })),
      { texto: `Produtos: ${brl(c.valorProdutos)} · Desconto: ${brl(c.desconto)} · Frete: ${brl(c.frete)} · Outras: ${brl(c.outrasDespesas)}`, espacoAntes: 1 },
      { texto: `Total do pedido: ${brl(c.valorTotal)}`, negrito: true, tamanho: 12 },
      ...(c.observacoesFornecedor ? [{ texto: 'Observações', negrito: true, espacoAntes: 1 }, { texto: c.observacoesFornecedor }] : []),
    ],
    rodape: `NEXUS OS · ${numeroExibido(c.numero) ?? ''} · gerado em ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  });
}
