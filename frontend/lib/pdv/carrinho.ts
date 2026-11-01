// ============================================================================
// FASE 4 PDV PRO — Regras PURAS do carrinho (testáveis, sem React).
//
// Extração da lógica que antes vivia inline dentro de
// `app/(dashboard)/pdv/page.tsx`. O componente continua dono do ESTADO, mas
// delega o CÁLCULO e as TRANSIÇÕES do carrinho para cá — fonte única, sem
// duplicar aritmética. Nada aqui confirma venda: o backend segue sendo a
// autoridade sobre preço, desconto, estoque e integridade. Isto só sustenta a
// experiência do operador (o que ele vê na tela antes de finalizar).
// ============================================================================

/** Um item do carrinho na tela do PDV. */
export interface ItemCarrinho {
  produtoId: string;
  nome: string;
  preco: number;
  quantidade: number;
  estoque: number;
  desconto: number;
  imagem?: string;
}

/** Produto do catálogo local, como chega em `adicionarAoCarrinho`. */
export interface ProdutoEntrada {
  id: string;
  nome: string;
  precoVenda: number;
  precoPromocional?: number | null;
  promocaoInicio?: string | null;
  promocaoFim?: string | null;
  estoqueFilial: number;
  imagem?: string | null;
}

/**
 * Resultado de uma transição do carrinho. `itens` é o novo estado; `erro`
 * carrega a mensagem pronta para a interface (null quando a operação foi
 * válida). O componente apenas aplica `setCarrinho(itens)` e `setError(erro)`.
 */
export interface ResultadoCarrinho {
  itens: ItemCarrinho[];
  erro: string | null;
}

/**
 * Adiciona 1 unidade de um produto. Se já está no carrinho, incrementa a
 * quantidade — mas NUNCA acima do estoque da filial. Produto sem estoque é
 * recusado com mensagem explicativa. Espelha exatamente o comportamento que
 * existia inline no PDV.
 */
export function adicionarProduto(itens: ItemCarrinho[], p: ProdutoEntrada): ResultadoCarrinho {
  if (!(p.estoqueFilial > 0)) {
    return { itens, erro: `Sem estoque de ${p.nome} nesta filial.` };
  }
  const existente = itens.find((i) => i.produtoId === p.id);
  if (existente) {
    if (existente.quantidade + 1 > p.estoqueFilial) {
      return { itens, erro: `Estoque insuficiente de ${p.nome}: ${p.estoqueFilial} unidade${p.estoqueFilial !== 1 ? 's' : ''}.` };
    }
    return {
      itens: itens.map((i) => (i.produtoId === p.id ? { ...i, quantidade: i.quantidade + 1 } : i)),
      erro: null,
    };
  }
  return {
    itens: [
      ...itens,
      {
        produtoId: p.id,
        nome: p.nome,
        preco: precoVigente(p),
        quantidade: 1,
        estoque: p.estoqueFilial,
        desconto: 0,
        imagem: p.imagem ?? undefined,
      },
    ],
    erro: null,
  };
}

function precoVigente(p: ProdutoEntrada, agora = Date.now()): number {
  if (p.precoPromocional == null) return Number(p.precoVenda);
  const inicio = p.promocaoInicio ? Date.parse(p.promocaoInicio) : -Infinity;
  const fim = p.promocaoFim ? Date.parse(p.promocaoFim) : Infinity;
  return agora >= inicio && agora <= fim ? Number(p.precoPromocional) : Number(p.precoVenda);
}

/**
 * Define a quantidade de um item. Quantidade <= 0 remove o item (comportamento
 * natural do stepper). Respeita o estoque da filial como limite superior.
 * Devolve o estado inalterado + erro quando a nova quantidade é inválida.
 */
export function alterarQuantidade(
  itens: ItemCarrinho[],
  produtoId: string,
  novaQuantidade: number,
): ResultadoCarrinho {
  const alvo = itens.find((i) => i.produtoId === produtoId);
  if (!alvo) return { itens, erro: null };
  if (!Number.isFinite(novaQuantidade)) {
    return { itens, erro: `Quantidade inválida para ${alvo.nome}.` };
  }
  if (novaQuantidade <= 0) {
    return { itens: removerProduto(itens, produtoId), erro: null };
  }
  if (novaQuantidade > alvo.estoque) {
    return { itens, erro: `Estoque insuficiente de ${alvo.nome}: ${alvo.estoque} unidade${alvo.estoque !== 1 ? 's' : ''}.` };
  }
  return {
    itens: itens.map((i) => (i.produtoId === produtoId ? { ...i, quantidade: novaQuantidade } : i)),
    erro: null,
  };
}

/** Remove um produto do carrinho pelo id. */
export function removerProduto(itens: ItemCarrinho[], produtoId: string): ItemCarrinho[] {
  return itens.filter((i) => i.produtoId !== produtoId);
}

/**
 * Subtotal = soma de (preço * quantidade - desconto do item). É o mesmo cáculo
 * que a tela sempre mostrou; isolado aqui para ser testado de forma determinística.
 */
export function subtotalDoCarrinho(itens: ItemCarrinho[]): number {
  return itens.reduce((s, i) => s + i.preco * i.quantidade - i.desconto, 0);
}

/**
 * Aplica o desconto geral informado pelo operador ao subtotal.
 * `descontoInvalido` sinaliza (para a UI travar o botão) quando o valor é
 * negativo ou supera o subtotal — o backend revalida de todo jeito.
 */
export function totalComDesconto(
  itens: ItemCarrinho[],
  descontoInformado: number,
): { descontoAplicado: number; total: number; descontoInvalido: boolean } {
  const subtotal = subtotalDoCarrinho(itens);
  const informado = Number.isFinite(descontoInformado) ? descontoInformado : 0;
  const descontoInvalido = informado < 0 || informado > subtotal;
  const descontoAplicado = Math.min(Math.max(informado, 0), subtotal);
  return { descontoAplicado, total: subtotal - descontoAplicado, descontoInvalido };
}
