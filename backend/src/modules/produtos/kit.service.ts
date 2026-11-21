import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../lib/prisma.js';
import { Conflito, ErroDeNegocio } from '../../lib/erros.js';
import { converterUnidade } from '../estoque/conversao.service.js';
import { registrarHistoricoPrecos } from './produto-campos.js';

/**
 * Tipo de produto KIT (2026-11-21).
 *
 * Um KIT é vendido como um único produto, mas não tem estoque próprio: a venda baixa os
 * componentes da composição (ComposicaoKit) na filial da venda. Já um produto FABRICADO com
 * ficha técnica (também em ComposicaoKit, com `ehKit`) é produzido antes (POST /produtos/:id/kit/produzir)
 * e a venda baixa só o produto acabado. O que separa os dois é o TIPO do produto.
 *
 * Quantidades: o usuário informa a quantidade numa unidade compatível (ex.: 500 g de farinha
 * estocada em kg); `quantidadePorKit` guarda a conversão para a UNIDADE BASE do componente, que é
 * o que sai do estoque. Conversões só pelas regras cadastradas (mesma dimensão, ou fator de
 * conversão do produto) — nunca por suposição.
 */

type Tx = Prisma.TransactionClient | typeof prisma;

export const CODIGO_TIPO_KIT = 'KIT' as const;
const CASAS_ESTOQUE = 3;

const arred = (n: number, casas = 2) => Math.round((n + Number.EPSILON) * 10 ** casas) / 10 ** casas;

/** Este produto é do tipo KIT? */
export async function produtoEhTipoKit(tx: Tx, empresaId: string, tipoProdutoId: string | null | undefined): Promise<boolean> {
  if (!tipoProdutoId) return false;
  const tipo = await tx.tipoProduto.findFirst({ where: { id: tipoProdutoId, empresaId }, select: { codigo: true } });
  return tipo?.codigo === CODIGO_TIPO_KIT;
}

/** Unidade base (de estoque) do produto: a cadastrada ou, nos produtos antigos, o símbolo legado `unidade`. */
async function unidadeBase(tx: Tx, empresaId: string, produto: { unidadeBaseId: string | null; unidade: string }) {
  const sel = { id: true, simbolo: true, nome: true, dimensaoId: true, fatorCanonico: true } as const;
  if (produto.unidadeBaseId) {
    const u = await tx.unidade.findFirst({ where: { id: produto.unidadeBaseId, empresaId }, select: sel });
    if (u) return { ...u, fatorCanonico: Number(u.fatorCanonico) };
  }
  const porSimbolo = await tx.unidade.findFirst({ where: { empresaId, simbolo: produto.unidade, ativo: true }, select: sel });
  return porSimbolo
    ? { ...porSimbolo, fatorCanonico: Number(porSimbolo.fatorCanonico) }
    : { id: null, simbolo: produto.unidade, nome: produto.unidade, dimensaoId: null, fatorCanonico: 1 };
}

/**
 * Unidades em que a quantidade de um componente pode ser informada: a própria base, as da mesma
 * dimensão (exceto embalagem, cujo conteúdo varia por produto) e as que têm fator de conversão
 * vigente cadastrado para o produto (ex.: 1 CX = 6 UN).
 */
export async function unidadesCompativeis(tx: Tx, empresaId: string, produto: { id: string; unidadeBaseId: string | null; unidade: string }) {
  const base = await unidadeBase(tx, empresaId, produto);
  const agora = new Date();
  const [mesmaDimensao, fatores] = await Promise.all([
    base.dimensaoId
      ? tx.unidade.findMany({
          where: { empresaId, ativo: true, dimensaoId: base.dimensaoId, dimensao: { codigo: { not: 'EMBALAGEM' } } },
          select: { id: true, simbolo: true, nome: true, fatorCanonico: true },
          orderBy: { fatorCanonico: 'desc' },
        })
      : Promise.resolve([]),
    base.id
      ? tx.fatorConversao.findMany({
          where: {
            empresaId, produtoId: produto.id, unidadeDestinoId: base.id, ativo: true, fornecedorId: null,
            AND: [{ OR: [{ vigenciaDe: null }, { vigenciaDe: { lte: agora } }] }, { OR: [{ vigenciaAte: null }, { vigenciaAte: { gte: agora } }] }],
          },
          select: { fator: true, unidadeOrigem: { select: { id: true, simbolo: true, nome: true } } },
        })
      : Promise.resolve([]),
  ]);
  // fatorParaBase: 1 desta unidade = N da unidade base (só para a tela mostrar o custo ao digitar;
  // o valor gravado é sempre convertido de novo no servidor).
  const lista = new Map<string, { id: string | null; simbolo: string; nome: string; fatorParaBase: number }>();
  lista.set(base.simbolo, { id: base.id, simbolo: base.simbolo, nome: base.nome, fatorParaBase: 1 });
  for (const u of mesmaDimensao) lista.set(u.simbolo, { id: u.id, simbolo: u.simbolo, nome: u.nome, fatorParaBase: Number(u.fatorCanonico) / base.fatorCanonico });
  for (const f of fatores) lista.set(f.unidadeOrigem.simbolo, { id: f.unidadeOrigem.id, simbolo: f.unidadeOrigem.simbolo, nome: `${f.unidadeOrigem.nome} (1 = ${Number(f.fator)} ${base.simbolo})`, fatorParaBase: Number(f.fator) });
  return { base, unidades: [...lista.values()] };
}

/** Converte a quantidade informada para a unidade base do componente, recusando conversão sem regra. */
export async function quantidadeNaBase(
  tx: Tx,
  empresaId: string,
  componente: { id: string; nome: string; unidadeBaseId: string | null; unidade: string },
  quantidade: number,
  unidadeId: string | null | undefined,
): Promise<{ quantidadeBase: number; unidadeId: string | null; unidadeSimbolo: string; baseSimbolo: string }> {
  const base = await unidadeBase(tx, empresaId, componente);
  let simbolo = base.simbolo;
  let idUsada: string | null = base.id;
  if (unidadeId && unidadeId !== base.id) {
    const u = await tx.unidade.findFirst({ where: { id: unidadeId, empresaId, ativo: true }, select: { id: true, simbolo: true } });
    if (!u) throw new ErroDeNegocio(`Unidade inválida para o componente ${componente.nome}.`, 400);
    simbolo = u.simbolo;
    idUsada = u.id;
  }
  let convertida: Decimal;
  try {
    const r = await converterUnidade({ empresaId, produtoId: componente.id, quantidade, unidadeOrigemSimbolo: simbolo, unidadeDestinoSimbolo: base.simbolo });
    convertida = r.quantidadeDestino;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ErroDeNegocio(`${componente.nome}: não há regra para converter ${simbolo} em ${base.simbolo}. ${msg}`, 422);
  }
  if (!convertida.equals(convertida.toDecimalPlaces(CASAS_ESTOQUE))) {
    throw new ErroDeNegocio(
      `${componente.nome}: ${quantidade} ${simbolo} vira ${convertida.toString()} ${base.simbolo}, com mais de ${CASAS_ESTOQUE} casas decimais — o estoque não registra essa fração. Use uma quantidade maior ou outra unidade.`,
      422,
    );
  }
  if (convertida.lessThanOrEqualTo(0)) throw new ErroDeNegocio(`${componente.nome}: a quantidade deve ser maior que zero.`, 400);
  return { quantidadeBase: convertida.toNumber(), unidadeId: idUsada, unidadeSimbolo: simbolo, baseSimbolo: base.simbolo };
}

/**
 * Impede ciclos: o kit não pode aparecer, direta ou indiretamente, dentro da composição dos
 * seus componentes (A contém B que contém A). Percorre o grafo de ComposicaoKit da empresa.
 */
export async function verificarCiclo(tx: Tx, empresaId: string, kitId: string, componenteIds: string[]): Promise<void> {
  if (componenteIds.includes(kitId)) throw new ErroDeNegocio('Um kit não pode ser componente dele mesmo.', 400);
  const visitados = new Set<string>();
  let fronteira = [...componenteIds];
  for (let nivel = 0; fronteira.length && nivel < 50; nivel += 1) {
    const arestas = await tx.composicaoKit.findMany({ where: { empresaId, kitProdutoId: { in: fronteira } }, select: { kitProdutoId: true, ingredienteProdutoId: true } });
    const proximos: string[] = [];
    for (const a of arestas) {
      if (a.ingredienteProdutoId === kitId) {
        throw new ErroDeNegocio('Composição circular: um dos componentes já usa este produto na própria composição.', 409);
      }
      if (!visitados.has(a.ingredienteProdutoId)) { visitados.add(a.ingredienteProdutoId); proximos.push(a.ingredienteProdutoId); }
    }
    fronteira = proximos;
  }
}

export interface ItemComposicao {
  produtoId: string;
  codigo: string | null;
  nome: string;
  tipo: string | null;
  tipoCodigo: string | null;
  status: string;
  ativo: boolean;
  quantidade: number;
  unidadeId: string | null;
  unidade: string;
  quantidadeBase: number;
  unidadeBase: string;
  custoUnitarioBase?: number;
  custoTotal?: number;
  ordem: number;
}

/** Composição do kit com conversões e custos atuais (custo = custo do componente × quantidade na base). */
export async function lerComposicao(tx: Tx, empresaId: string, kitId: string, comCusto: boolean) {
  const linhas = await tx.composicaoKit.findMany({
    where: { empresaId, kitProdutoId: kitId },
    orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
    include: {
      unidade: { select: { simbolo: true } },
      ingredienteProduto: { select: { id: true, nome: true, sku: true, referencia: true, status: true, custo: true, unidade: true, unidadeBaseId: true, tipoProduto: { select: { nome: true, codigo: true } } } },
    },
  });
  const itens: ItemComposicao[] = [];
  let custoTotal = 0;
  for (const l of linhas) {
    const c = l.ingredienteProduto;
    const base = await unidadeBase(tx, empresaId, c);
    const quantidadeBase = Number(l.quantidadePorKit);
    const custoItem = arred(Number(c.custo) * quantidadeBase, 4);
    custoTotal += custoItem;
    itens.push({
      produtoId: c.id,
      codigo: c.sku ?? c.referencia,
      nome: c.nome,
      tipo: c.tipoProduto?.nome ?? null,
      tipoCodigo: c.tipoProduto?.codigo ?? null,
      status: c.status,
      ativo: c.status === 'ATIVO',
      quantidade: l.quantidade != null ? Number(l.quantidade) : quantidadeBase,
      unidadeId: l.unidadeId ?? base.id,
      unidade: l.unidade?.simbolo ?? base.simbolo,
      quantidadeBase,
      unidadeBase: base.simbolo,
      ...(comCusto ? { custoUnitarioBase: Number(c.custo), custoTotal: arred(custoItem, 2) } : {}),
      ordem: l.ordem,
    });
  }
  return { itens, custoTotal: arred(custoTotal, 4) };
}

/**
 * Recalcula o custo dos KITS que usam algum destes componentes (regra: custo do kit = soma de
 * custo do componente × quantidade na base, pelo custo vigente do componente). O PREÇO de venda
 * nunca é alterado aqui; a margem é recalculada e a mudança de custo vai para o histórico de preços.
 */
export async function recalcularCustoDosKits(
  tx: Prisma.TransactionClient,
  empresaId: string,
  componenteIds: string[],
  contexto: { usuarioId?: string | null; justificativa: string; origem?: string },
): Promise<number> {
  if (!componenteIds.length) return 0;
  const kits = await tx.produto.findMany({
    where: { empresaId, tipoProduto: { codigo: CODIGO_TIPO_KIT }, composicaoComoKit: { some: { ingredienteProdutoId: { in: componenteIds } } } },
    select: { id: true },
  });
  for (const k of kits) await atualizarCustoDoKit(tx, empresaId, k.id, contexto);
  return kits.length;
}

/** Grava no produto KIT o custo calculado pela composição (sem tocar no preço de venda). */
export async function atualizarCustoDoKit(
  tx: Prisma.TransactionClient,
  empresaId: string,
  kitId: string,
  contexto: { usuarioId?: string | null; justificativa: string; origem?: string },
): Promise<number | null> {
  const kit = await tx.produto.findFirst({ where: { id: kitId, empresaId }, select: { id: true, custo: true, precoVenda: true, tipoProdutoId: true } });
  if (!kit || !(await produtoEhTipoKit(tx, empresaId, kit.tipoProdutoId))) return null;
  const { custoTotal } = await lerComposicao(tx, empresaId, kitId, true);
  const novoCusto = arred(custoTotal, 4);
  if (Number(kit.custo) === novoCusto) return novoCusto;
  const preco = Number(kit.precoVenda);
  await tx.produto.update({ where: { id: kitId }, data: { custo: novoCusto, margem: preco > 0 ? arred(((preco - novoCusto) / preco) * 100, 2) : 0 } });
  await registrarHistoricoPrecos(tx, {
    empresaId, produtoId: kitId, usuarioId: contexto.usuarioId ?? null,
    anterior: { custo: kit.custo }, novo: { custo: novoCusto },
    justificativa: contexto.justificativa, origem: contexto.origem ?? 'KIT',
  });
  return novoCusto;
}

export interface ComponenteBaixa {
  produtoId: string;
  nome: string;
  codigo: string | null;
  quantidadeInformada: number;
  unidadeInformada: string;
  quantidadePorKit: number;
  unidadeBase: string;
  quantidadeBaixa: number;
  custoUnitario: number;
  custoTotal: number;
}

/**
 * Expande um KIT vendido nos componentes a baixar (quantidade vendida × quantidade por kit, na
 * base de cada componente). Kit sem composição não pode ser vendido: seria uma venda sem baixa.
 */
export async function expandirKitParaVenda(tx: Prisma.TransactionClient, empresaId: string, kit: { id: string; nome: string }, quantidadeVendida: number) {
  const { itens } = await lerComposicao(tx, empresaId, kit.id, true);
  if (!itens.length) throw Conflito(`O kit "${kit.nome}" não tem composição cadastrada. Cadastre os componentes na aba Composição do Kit antes de vender.`);
  const componentes: ComponenteBaixa[] = itens.map((i) => {
    const baixa = new Decimal(i.quantidadeBase).times(quantidadeVendida).toDecimalPlaces(CASAS_ESTOQUE).toNumber();
    return {
      produtoId: i.produtoId, nome: i.nome, codigo: i.codigo,
      quantidadeInformada: i.quantidade, unidadeInformada: i.unidade,
      quantidadePorKit: i.quantidadeBase, unidadeBase: i.unidadeBase,
      quantidadeBaixa: baixa,
      custoUnitario: i.custoUnitarioBase ?? 0,
      custoTotal: arred((i.custoUnitarioBase ?? 0) * baixa, 4),
    };
  });
  const custoUnitarioKit = arred(itens.reduce((s, i) => s + (i.custoUnitarioBase ?? 0) * i.quantidadeBase, 0), 4);
  return { componentes, custoUnitarioKit };
}

/**
 * Regras de mudança do tipo do produto envolvendo KIT (PUT /produtos/:id):
 * - KIT → outro tipo: bloqueado enquanto houver composição (nada é apagado automaticamente;
 *   o usuário remove os componentes conscientemente e o histórico das vendas fica preservado).
 * - outro tipo → KIT: bloqueado se o produto compõe outro kit/ficha (kit não compõe kit) ou se
 *   ainda tem saldo próprio em estoque (o kit não tem estoque próprio; o saldo ficaria órfão).
 */
export async function validarMudancaDeTipo(
  tx: Tx,
  empresaId: string,
  produto: { id: string; tipoProdutoId: string | null },
  novoTipoProdutoId: string | null,
): Promise<void> {
  if ((novoTipoProdutoId ?? null) === (produto.tipoProdutoId ?? null)) return;
  const [eraKit, seraKit] = await Promise.all([
    produtoEhTipoKit(tx, empresaId, produto.tipoProdutoId),
    produtoEhTipoKit(tx, empresaId, novoTipoProdutoId),
  ]);
  if (eraKit && !seraKit) {
    const n = await tx.composicaoKit.count({ where: { empresaId, kitProdutoId: produto.id } });
    if (n > 0) {
      throw Conflito(`Este kit tem ${n} componente(s) na composição. Para mudar o tipo, remova os componentes na aba Composição do Kit e salve; as vendas já feitas mantêm a composição registrada.`);
    }
  }
  if (!eraKit && seraKit) {
    const usos = await tx.composicaoKit.count({ where: { empresaId, ingredienteProdutoId: produto.id } });
    if (usos > 0) throw Conflito(`Este produto é componente de ${usos} kit(s) ou ficha(s) técnica(s). Um kit não pode compor outro kit: retire-o dessas composições antes de mudar o tipo para Kit.`);
    const saldo = await tx.estoque.aggregate({ where: { empresaId, produtoId: produto.id }, _sum: { quantidade: true } });
    const total = Number(saldo._sum.quantidade ?? 0);
    if (total !== 0) throw Conflito(`Este produto tem saldo próprio em estoque (${total}). O kit não tem estoque próprio — a venda baixa os componentes. Zere o saldo (ajuste ou transferência) antes de mudar o tipo para Kit.`);
  }
}
