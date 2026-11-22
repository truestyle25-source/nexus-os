/**
 * Fase C3 — importação de pedidos do WooCommerce para Vendas (mesmo modelo do Mercado Livre).
 *
 * API (https://woocommerce.github.io/woocommerce-rest-api-docs/): GET <loja>/wp-json/wc/v3/orders
 * com Basic Auth (Consumer Key/Secret), page/per_page/orderby=date/order=desc; total de páginas no
 * cabeçalho X-WP-TotalPages. Valores monetários chegam como TEXTO com 2 casas; ids como inteiros.
 * Status: pending, processing, on-hold, completed, cancelled, refunded, failed.
 *
 * Regras:
 *  - Produto: casado pelo SKU do item do pedido com o SKU do produto no NEXUS (mesma empresa).
 *    Item sem SKU ou sem produto correspondente → o pedido NÃO é importado e fica no relatório.
 *  - Idempotência em duas camadas (Venda.idempotencyKey + tabela IdempotencyKey), chave
 *    "woo:order:<host da loja>:<id>": reimportar nunca cria segunda venda.
 *  - Status da venda: cancelled/refunded → CANCELADA; pago (date_paid_gmt preenchido) ou
 *    completed → FINALIZADA; demais → ABERTA (sem fingir pagamento). failed não é importado.
 *  - Estoque: baixa (VENDA) na filial escolhida, na MESMA transação da venda, só para pedidos
 *    criados depois da conexão da loja (pedidos antigos já estão no estoque inicial).
 *    Cancelamento posterior devolve (DEVOLUCAO) uma única vez.
 *  - Não cria financeiro nem caixa (igual ao Mercado Livre): a importação REGISTRA a venda.
 */
import { randomUUID } from 'node:crypto';
import type { FormaPagamento } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { ErroDeNegocio, NaoEncontrado } from '../../../lib/erros.js';
import { adquirirIdempotencia, concluirIdempotencia } from '../../../lib/idempotencia.js';
import { dataOperacionalDate } from '../../../lib/fuso.js';
import { aplicarMovimento } from '../../estoque/estoque.service.js';
import { exigirUrlHttpsPublica } from '../../../lib/destino-seguro.js';
import { basicAuth } from './adaptadores.js';
import { credenciaisInternas, registrarEvento } from './central.service.js';

export interface PedidoWoo {
  id: number | string;
  status?: string;
  currency?: string;
  date_created_gmt?: string | null;
  date_paid_gmt?: string | null;
  total?: string | number;
  payment_method?: string;
  payment_method_title?: string;
  line_items?: { sku?: string | null; quantity?: number; price?: string | number; name?: string }[];
}

export interface ItemRelatorioWoo { pedido: string; vendaId: string | null; acao: 'importada' | 'atualizada' | 'duplicada' | 'semVinculoProduto' | 'ignorado' | 'moedaNaoSuportada' | 'erro'; detalhe?: string }

const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

export function statusVendaWoo(p: PedidoWoo): 'CANCELADA' | 'FINALIZADA' | 'ABERTA' | null {
  const s = p.status ?? '';
  if (s === 'failed' || s === 'checkout-draft' || s === 'trash') return null;
  if (s === 'cancelled' || s === 'refunded') return 'CANCELADA';
  if (s === 'completed' || p.date_paid_gmt) return 'FINALIZADA';
  return 'ABERTA';
}

export function formaPagamentoWoo(p: PedidoWoo): FormaPagamento {
  const m = `${p.payment_method ?? ''} ${p.payment_method_title ?? ''}`.toLowerCase();
  if (m.includes('pix')) return 'PIX';
  if (m.includes('boleto') || m.includes('ticket')) return 'BOLETO';
  if (m.includes('bacs') || m.includes('transfer')) return 'TRANSFERENCIA';
  if (m.includes('debit') || m.includes('débito')) return 'CARTAO_DEBITO';
  if (m.includes('card') || m.includes('cart') || m.includes('stripe') || m.includes('credit')) return 'CARTAO_CREDITO';
  if (m.includes('cod') || m.includes('dinheiro') || m.includes('cash')) return 'DINHEIRO';
  return 'OUTRO';
}

/** Importa UM pedido (sem rede). Exportada para os testes. */
export async function importarPedidoWoo(params: { empresaId: string; filialId: string; usuarioId: string; loja: string; inicioIntegracao: Date | null; fusoHorario: string | null; pedido: PedidoWoo }): Promise<ItemRelatorioWoo> {
  const { empresaId, filialId, usuarioId, loja, pedido } = params;
  const idPedido = String(pedido.id);
  const key = `woo:order:${loja}:${idPedido}`;
  const status = statusVendaWoo(pedido);
  const criadoEm = pedido.date_created_gmt ? new Date(`${pedido.date_created_gmt.replace(/Z?$/, 'Z')}`) : null;
  const aplicarEstoque = !params.inicioIntegracao || !criadoEm || Number.isNaN(criadoEm.getTime()) || criadoEm >= params.inicioIntegracao;

  const existente = await prisma.venda.findFirst({ where: { empresaId, idempotencyKey: key }, select: { id: true, status: true } });
  if (existente) {
    if (!status || status === existente.status) return { pedido: idPedido, vendaId: existente.id, acao: 'duplicada' };
    const atualizou = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Venda" WHERE "id" = ${existente.id} FOR UPDATE`;
      const atual = await tx.venda.findUnique({ where: { id: existente.id }, include: { itens: true } });
      if (!atual) return false;
      const movs = await tx.estoqueMovimentacao.findMany({ where: { empresaId, documento: key, tipo: { in: ['VENDA', 'DEVOLUCAO'] } }, select: { tipo: true } });
      const baixado = movs.some((m) => m.tipo === 'VENDA'); const devolvido = movs.some((m) => m.tipo === 'DEVOLUCAO');
      if (status === 'CANCELADA' && baixado && !devolvido) {
        for (const i of atual.itens) await aplicarMovimento(tx, { empresaId, filialId, produtoId: i.produtoId, usuarioId, tipo: 'DEVOLUCAO', quantidade: Number(i.quantidade), motivo: `Cancelamento WooCommerce ${idPedido}`, documento: key, origem: 'INTEGRACAO' });
      }
      const permitido = status === 'CANCELADA' || (atual.status === 'ABERTA' && status === 'FINALIZADA');
      if (!permitido) return false;
      await tx.venda.update({ where: { id: existente.id }, data: { status } });
      return true;
    });
    return { pedido: idPedido, vendaId: existente.id, acao: atualizou ? 'atualizada' : 'duplicada' };
  }

  if (!status) return { pedido: idPedido, vendaId: null, acao: 'ignorado', detalhe: `Pedido com status "${pedido.status}" não é importado.` };
  if (pedido.currency && pedido.currency !== 'BRL') return { pedido: idPedido, vendaId: null, acao: 'moedaNaoSuportada', detalhe: `Moeda ${pedido.currency} não suportada.` };
  const linhas = pedido.line_items ?? [];
  if (!linhas.length) return { pedido: idPedido, vendaId: null, acao: 'erro', detalhe: 'Pedido sem itens.' };

  const itens: { produtoId: string; custo: number; quantidade: number; preco: number }[] = [];
  for (const l of linhas) {
    const sku = (l.sku ?? '').trim();
    const quantidade = Math.trunc(Number(l.quantity ?? 0));
    const preco = num(l.price);
    if (!sku) return { pedido: idPedido, vendaId: null, acao: 'semVinculoProduto', detalhe: `Item "${(l.name ?? '').slice(0, 60)}" sem SKU na loja.` };
    if (!(quantidade > 0) || !(preco >= 0)) return { pedido: idPedido, vendaId: null, acao: 'erro', detalhe: `Item ${sku} com quantidade ou preço inválido.` };
    const produto = await prisma.produto.findFirst({ where: { empresaId, sku }, select: { id: true, custo: true } });
    if (!produto) return { pedido: idPedido, vendaId: null, acao: 'semVinculoProduto', detalhe: `SKU ${sku} não existe no NEXUS. Cadastre o produto com o mesmo SKU.` };
    itens.push({ produtoId: produto.id, custo: Number(produto.custo), quantidade, preco });
  }

  const aquisicaoInput = { key, empresaId, filialId, operadorId: usuarioId };
  // Outra execução importando o MESMO pedido agora: adquirirIdempotencia recusa (409) — o pedido
  // não é duplicado; aqui isso vira "duplicada" para o lote seguir com os demais pedidos.
  const adquirir = async () => {
    try { return await adquirirIdempotencia(aquisicaoInput); }
    catch (e) { if (e instanceof ErroDeNegocio && e.status === 409) return null; throw e; }
  };
  let aquisicao = await adquirir();
  if (aquisicao?.duplicada && aquisicao.status === 'REJEITADA') {
    await prisma.idempotencyKey.delete({ where: { id: aquisicao.id } }).catch(() => undefined);
    aquisicao = await adquirir();
  }
  if (!aquisicao) return { pedido: idPedido, vendaId: null, acao: 'duplicada', detalhe: 'Pedido sendo importado por outra execução.' };
  if (aquisicao.duplicada) {
    const v = await prisma.venda.findFirst({ where: { empresaId, idempotencyKey: key }, select: { id: true } });
    return { pedido: idPedido, vendaId: v?.id ?? null, acao: 'duplicada' };
  }

  try {
    const subtotal = itens.reduce((t, i) => t + i.preco * i.quantidade, 0);
    const totalInformado = num(pedido.total);
    const total = totalInformado > 0 ? totalInformado : subtotal;
    const desconto = subtotal > total ? subtotal - total : 0;
    const forma = formaPagamentoWoo(pedido);
    const instante = criadoEm && !Number.isNaN(criadoEm.getTime()) ? criadoEm : new Date();
    const vendaId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.venda.create({
        data: {
          id: vendaId, empresaId, filialId, formaPagamento: forma, status, subtotal, desconto, total, origem: 'INTEGRACAO', idempotencyKey: key,
          dataOperacional: dataOperacionalDate(instante, params.fusoHorario),
          itens: { create: itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade, preco: i.preco, custoUnitario: i.custo, desconto: 0, total: i.preco * i.quantidade })) },
          ...(status === 'FINALIZADA' ? { pagamentos: { create: [{ empresaId, forma, valor: total, referencia: `WooCommerce ${idPedido}`, status: 'CONFIRMADO' }] } } : {}),
        },
      });
      if (aplicarEstoque && status !== 'CANCELADA') {
        for (const i of itens) await aplicarMovimento(tx, { empresaId, filialId, produtoId: i.produtoId, usuarioId, tipo: 'VENDA', quantidade: i.quantidade, motivo: `Pedido WooCommerce ${idPedido}`, documento: key, origem: 'INTEGRACAO' });
      }
    });
    await concluirIdempotencia(aquisicao.id, { status: 'CONFIRMADA', vendaId, responseStatus: 201, responseBody: { pedido: idPedido, vendaId } });
    return { pedido: idPedido, vendaId, acao: 'importada' };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : 'Falha ao gravar a venda.';
    await concluirIdempotencia(aquisicao.id, { status: 'REJEITADA', responseStatus: 400, responseBody: { erro: msg } }).catch(() => undefined);
    return { pedido: idPedido, vendaId: null, acao: 'erro', detalhe: msg };
  }
}

/** Busca os pedidos mais recentes na loja e importa cada um. */
export async function importarPedidosWoo(empresaId: string, usuarioId: string, filialId: string, limite = 50) {
  const cred = await credenciaisInternas(empresaId, 'woocommerce');
  if (!cred || cred.status !== 'CONECTADO') throw new ErroDeNegocio('O WooCommerce não está conectado na Central de Integrações.', 409);
  const filial = await prisma.filial.findFirst({ where: { id: filialId, empresaId, status: 'ATIVO' }, select: { id: true, fusoHorario: true, empresa: { select: { fusoHorario: true } } } });
  if (!filial) throw NaoEncontrado('Filial não encontrada ou inativa.');
  const url = await exigirUrlHttpsPublica(cred.config.urlLoja).catch((e) => { throw new ErroDeNegocio(e.message, 400); });
  const reg = await prisma.integracaoExterno.findUniqueOrThrow({ where: { id: cred.id }, select: { conectadoEm: true } });
  // Fuso da filial prevalece sobre o da empresa (mesma regra do PDV).
  const fuso = filial.fusoHorario ?? filial.empresa.fusoHorario ?? null;
  const teto = Math.min(Math.max(limite, 1), 200);
  const relatorio: ItemRelatorioWoo[] = [];
  const inicio = Date.now();
  for (let pagina = 1; relatorio.length < teto; pagina++) {
    let r: Response;
    try {
      r = await fetch(`${url.origin}${url.pathname}/wp-json/wc/v3/orders?per_page=${Math.min(50, teto - relatorio.length)}&page=${pagina}&orderby=date&order=desc`, { headers: { Authorization: basicAuth(cred.segredos.consumerKey, cred.segredos.consumerSecret), Accept: 'application/json', 'User-Agent': 'NexusOS/1.0' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new ErroDeNegocio('Sem comunicação com a loja WooCommerce (timeout ou rede).', 502);
    }
    if (r.status === 401 || r.status === 403) throw new ErroDeNegocio('A loja recusou as chaves (sem permissão de leitura de pedidos).', 502);
    if (!r.ok) throw new ErroDeNegocio(`A loja respondeu HTTP ${r.status} ao listar pedidos.`, 502);
    const pedidos = (await r.json().catch(() => null)) as PedidoWoo[] | null;
    if (!Array.isArray(pedidos)) throw new ErroDeNegocio('Resposta inesperada da loja ao listar pedidos.', 502);
    for (const p of pedidos) relatorio.push(await importarPedidoWoo({ empresaId, filialId, usuarioId, loja: url.hostname, inicioIntegracao: reg.conectadoEm, fusoHorario: fuso, pedido: p }));
    const totalPaginas = Number(r.headers.get('x-wp-totalpages') ?? '1');
    if (!pedidos.length || pagina >= totalPaginas) break;
  }
  const conta = (a: ItemRelatorioWoo['acao']) => relatorio.filter((x) => x.acao === a).length;
  const resumo = { consultados: relatorio.length, importados: conta('importada'), atualizados: conta('atualizada'), duplicados: conta('duplicada'), semVinculo: conta('semVinculoProduto'), ignorados: conta('ignorado') + conta('moedaNaoSuportada'), erros: conta('erro') };
  await prisma.integracaoExterno.update({ where: { id: cred.id }, data: { ultimoSyncEm: new Date() } });
  await registrarEvento({ empresaId, provedor: 'woocommerce', operacao: 'SINCRONIZAR', ok: resumo.erros === 0, codigoErro: resumo.erros ? 'PEDIDOS_COM_ERRO' : null, mensagem: `Pedidos: ${resumo.importados} importado(s), ${resumo.atualizados} atualizado(s), ${resumo.duplicados} já existente(s), ${resumo.semVinculo} sem produto.`, duracaoMs: Date.now() - inicio, usuarioId });
  return { resumo, relatorio };
}
