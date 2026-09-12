import { randomUUID } from 'node:crypto';
import type { Prisma, TipoMovEstoque, Origem } from '@prisma/client';
import { ErroDeNegocio, NaoEncontrado, Conflito } from '../../lib/erros.js';

type Tx = Prisma.TransactionClient;

const ENTRADAS: TipoMovEstoque[] = ['ENTRADA', 'COMPRA', 'DEVOLUCAO'];
const SAIDAS: TipoMovEstoque[] = ['SAIDA', 'VENDA', 'PERDA', 'AVARIA'];

/**
 * Garante que todo Produto ativo tenha uma linha de Estoque (quantidade 0)
 * em toda Filial da empresa, e vice-versa. Isso existe para que "produtos
 * sem estoque" (Seção 7/9) enxergue produtos/filiais recém-criados que
 * nunca tiveram uma movimentação — sem isso, eles simplesmente não
 * apareceriam em nenhum indicador porque não existiria linha de Estoque.
 *
 * Chame criarEstoqueParaProduto ao criar um Produto; criarEstoqueParaFilial
 * ao criar uma Filial. skipDuplicates protege contra corrida entre as duas.
 */
export async function criarEstoqueParaProduto(tx: Tx, empresaId: string, produtoId: string): Promise<void> {
  const filiais = await tx.filial.findMany({ where: { empresaId, status: 'ATIVO' }, select: { id: true } });
  if (filiais.length === 0) return;
  await tx.estoque.createMany({
    data: filiais.map((f: { id: string }) => ({ empresaId, filialId: f.id, produtoId, quantidade: 0, valorTotal: 0 })),
    skipDuplicates: true,
  });
}

export async function criarEstoqueParaFilial(tx: Tx, empresaId: string, filialId: string): Promise<void> {
  const produtos = await tx.produto.findMany({ where: { empresaId, status: 'ATIVO' }, select: { id: true } });
  if (produtos.length === 0) return;
  await tx.estoque.createMany({
    data: produtos.map((p: { id: string }) => ({ empresaId, filialId, produtoId: p.id, quantidade: 0, valorTotal: 0 })),
    skipDuplicates: true,
  });
}

export interface MovimentoInput {
  empresaId: string;
  filialId: string;
  produtoId: string;
  usuarioId?: string;
  tipo: TipoMovEstoque;
  quantidade: number; // sempre positivo aqui; o sinal é decidido pelo tipo
  motivo?: string;
  documento?: string;
  origem: Origem;
}

/**
 * Movimentação de estoque com concorrência segura: o decremento usa
 * updateMany com a condição de quantidade atual na cláusula WHERE, então
 * duas requisições simultâneas não conseguem levar o estoque a negativo
 * (a segunda simplesmente não casa nenhuma linha e recebe Conflito).
 * TRANSFERENCIA não é aceita aqui — use transferirEstoque.
 */
export async function aplicarMovimento(tx: Tx, input: MovimentoInput) {
  if (input.tipo === 'TRANSFERENCIA') {
    throw new ErroDeNegocio('Use /estoque/transferir para movimentações do tipo TRANSFERENCIA.', 400);
  }
  const produto = await tx.produto.findFirst({ where: { id: input.produtoId, empresaId: input.empresaId } });
  if (!produto) throw NaoEncontrado('Produto não encontrado nesta empresa.');
  const filial = await tx.filial.findFirst({ where: { id: input.filialId, empresaId: input.empresaId } });
  if (!filial) throw NaoEncontrado('Filial inválida para esta empresa.');

  const atual = await tx.estoque.findUnique({ where: { filialId_produtoId: { filialId: input.filialId, produtoId: input.produtoId } } });
  const qtdAtual = atual?.quantidade ?? 0;

  let estoqueId: string;
  let novaQtd: number;
  let delta: number;

  if (ENTRADAS.includes(input.tipo)) {
    delta = input.quantidade;
    novaQtd = qtdAtual + input.quantidade;
    if (atual) {
      await tx.estoque.update({ where: { id: atual.id }, data: { quantidade: { increment: input.quantidade } } });
      estoqueId = atual.id;
    } else {
      const criado = await tx.estoque.create({
        data: { empresaId: input.empresaId, filialId: input.filialId, produtoId: input.produtoId, quantidade: novaQtd, valorTotal: 0 },
      });
      estoqueId = criado.id;
    }
  } else if (SAIDAS.includes(input.tipo)) {
    delta = -input.quantidade;
    novaQtd = qtdAtual - input.quantidade;
    if (novaQtd < 0) throw new ErroDeNegocio(`Estoque insuficiente para ${produto.nome}: tem ${qtdAtual}, precisa ${input.quantidade}.`, 400);
    const updated = await tx.estoque.updateMany({
      where: { filialId: input.filialId, produtoId: input.produtoId, quantidade: { gte: input.quantidade } },
      data: { quantidade: { decrement: input.quantidade } },
    });
    if (updated.count !== 1) throw Conflito('Estoque foi alterado por outra operação. Tente novamente.');
    estoqueId = atual!.id;
  } else if (input.tipo === 'AJUSTE' || input.tipo === 'INVENTARIO') {
    // Nestes dois, "quantidade" é a contagem final, não um delta.
    novaQtd = input.quantidade;
    delta = novaQtd - qtdAtual;
    if (atual) {
      const updated = await tx.estoque.updateMany({ where: { id: atual.id, quantidade: qtdAtual }, data: { quantidade: novaQtd } });
      if (updated.count !== 1) throw Conflito('Estoque foi alterado por outra operação. Tente novamente.');
      estoqueId = atual.id;
    } else {
      if (novaQtd < 0) throw new ErroDeNegocio('Quantidade de ajuste/inventário não pode ser negativa.', 400);
      const criado = await tx.estoque.create({
        data: { empresaId: input.empresaId, filialId: input.filialId, produtoId: input.produtoId, quantidade: novaQtd, valorTotal: 0 },
      });
      estoqueId = criado.id;
    }
  } else {
    throw new ErroDeNegocio(`Tipo de movimentação não suportado: ${input.tipo}.`, 400);
  }

  const estoque = await tx.estoque.update({ where: { id: estoqueId }, data: { valorTotal: novaQtd * Number(produto.custo) } });
  const movimentacao = await tx.estoqueMovimentacao.create({
    data: {
      empresaId: input.empresaId,
      filialId: input.filialId,
      produtoId: input.produtoId,
      usuarioId: input.usuarioId,
      quantidade: delta,
      tipo: input.tipo,
      motivo: input.motivo,
      documento: input.documento,
      origem: input.origem,
    },
  });

  return { estoque, movimentacao, qtdAnterior: qtdAtual, qtdNova: novaQtd, estoqueMinimo: produto.estoqueMinimo };
}

export interface TransferenciaInput {
  empresaId: string;
  produtoId: string;
  filialOrigemId: string;
  filialDestinoId: string;
  quantidade: number;
  usuarioId?: string;
  motivo?: string;
  origem: Origem;
}

/**
 * Transferência real entre filiais (Seção 9). Gera duas linhas de
 * EstoqueMovimentacao (tipo TRANSFERENCIA) ligadas pelo mesmo `documento`,
 * uma com o efeito na origem (delta negativo, filialId = origem,
 * filialDestinoId = destino) e outra no destino (delta positivo,
 * filialId = destino, filialDestinoId = origem — para achar a outra ponta
 * a partir de qualquer uma das duas linhas).
 */
export async function transferirEstoque(tx: Tx, input: TransferenciaInput) {
  if (input.filialOrigemId === input.filialDestinoId) {
    throw new ErroDeNegocio('Filial de origem e destino não podem ser a mesma.', 400);
  }
  const produto = await tx.produto.findFirst({ where: { id: input.produtoId, empresaId: input.empresaId } });
  if (!produto) throw NaoEncontrado('Produto não encontrado nesta empresa.');
  const [origem, destino] = await Promise.all([
    tx.filial.findFirst({ where: { id: input.filialOrigemId, empresaId: input.empresaId } }),
    tx.filial.findFirst({ where: { id: input.filialDestinoId, empresaId: input.empresaId } }),
  ]);
  if (!origem || !destino) throw NaoEncontrado('Filial de origem ou destino inválida para esta empresa.');

  const estoqueOrigem = await tx.estoque.findUnique({ where: { filialId_produtoId: { filialId: input.filialOrigemId, produtoId: input.produtoId } } });
  const qtdOrigemAtual = estoqueOrigem?.quantidade ?? 0;
  if (qtdOrigemAtual < input.quantidade) {
    throw new ErroDeNegocio(`Estoque insuficiente na filial de origem para ${produto.nome}: tem ${qtdOrigemAtual}, precisa ${input.quantidade}.`, 400);
  }
  const decremento = await tx.estoque.updateMany({
    where: { filialId: input.filialOrigemId, produtoId: input.produtoId, quantidade: { gte: input.quantidade } },
    data: { quantidade: { decrement: input.quantidade } },
  });
  if (decremento.count !== 1) throw Conflito('Estoque de origem foi alterado por outra operação. Tente novamente.');

  const estoqueDestinoAtual = await tx.estoque.findUnique({ where: { filialId_produtoId: { filialId: input.filialDestinoId, produtoId: input.produtoId } } });
  let estoqueDestinoId: string;
  if (estoqueDestinoAtual) {
    await tx.estoque.update({ where: { id: estoqueDestinoAtual.id }, data: { quantidade: { increment: input.quantidade } } });
    estoqueDestinoId = estoqueDestinoAtual.id;
  } else {
    const criado = await tx.estoque.create({
      data: { empresaId: input.empresaId, filialId: input.filialDestinoId, produtoId: input.produtoId, quantidade: input.quantidade, valorTotal: 0 },
    });
    estoqueDestinoId = criado.id;
  }

  const [estoqueOrigemFinal, estoqueDestinoFinal] = await Promise.all([
    tx.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: input.filialOrigemId, produtoId: input.produtoId } } }),
    tx.estoque.findUniqueOrThrow({ where: { id: estoqueDestinoId } }),
  ]);
  const custo = Number(produto.custo);
  await tx.estoque.update({ where: { id: estoqueOrigemFinal.id }, data: { valorTotal: Number(estoqueOrigemFinal.quantidade) * custo } });
  await tx.estoque.update({ where: { id: estoqueDestinoFinal.id }, data: { valorTotal: Number(estoqueDestinoFinal.quantidade) * custo } });

  const documento = `TRANSF-${randomUUID()}`;
  const [movOrigem, movDestino] = await Promise.all([
    tx.estoqueMovimentacao.create({
      data: {
        empresaId: input.empresaId,
        filialId: input.filialOrigemId,
        filialDestinoId: input.filialDestinoId,
        produtoId: input.produtoId,
        usuarioId: input.usuarioId,
        quantidade: -input.quantidade,
        tipo: 'TRANSFERENCIA',
        motivo: input.motivo,
        documento,
        origem: input.origem,
      },
    }),
    tx.estoqueMovimentacao.create({
      data: {
        empresaId: input.empresaId,
        filialId: input.filialDestinoId,
        filialDestinoId: input.filialOrigemId,
        produtoId: input.produtoId,
        usuarioId: input.usuarioId,
        quantidade: input.quantidade,
        tipo: 'TRANSFERENCIA',
        motivo: input.motivo,
        documento,
        origem: input.origem,
      },
    }),
  ]);

  return { documento, movOrigem, movDestino, qtdOrigemAntes: qtdOrigemAtual, qtdOrigemDepois: qtdOrigemAtual - input.quantidade };
}
