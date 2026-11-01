// =============================================================================
// Sincronização Mercado Livre — catálogo (produtos/anúncios), estoque e pedidos
//
// ESCOPO DELIBERADO (sem mudanças de banco — tudo persiste em tabelas que já
// existem no schema; mudanças de schema exigem autorização específica):
//
//   VÍNCULO PRODUTO <-> ANÚNCIO
//   - Produto criado pela integração leva `sku = 'ML-<itemId>'` (único por
//     empresa+sku no schema — é a trava natural de duplicidade) e
//     `origem = INTEGRACAO`.
//   - Produto INTERNO já existente pode ser vinculado ao anúncio preenchendo
//     o próprio `sku` com o `seller_custom_label` do anúncio; a integração
//     só RECONHECE esse vínculo — nunca altera nome, preço, custo ou SKU de
//     produto de origem MANUAL/IMPORTADO (preservação dos dados internos).
//
//   ESTOQUE — regra explícita de precedência (a API não permite bidirecional
//   ingênuo e o ML não distingue "reserva" vs "disponível" para nós):
//   - NEXUS OS é a FONTE DO SALDO. O sync apenas EMPURRA o saldo interno da
//     filial para o anúncio (available_quantity) quando difere.
//   - Active orders decrement local stock idempotently; cancellation restores it.
//   - Saldo negativo, anúncio pausado/removido, anúncio com variações ou sem
//     linha de estoque na filial: NÃO se envia; registra-se no relatório.
//
//   PEDIDOS
//   - Idempotência em DUAS camadas: `Venda.idempotencyKey` = 'ml:order:<id>'
//     (índice auxiliar do schema) + tabela `IdempotencyKey` (fonte
//     normativa, mesmo mecanismo do PDV PRO). Reprocessar é seguro.
//   - FINALIZADA só com EVIDÊNCIA de pagamento da API (status 'paid' OU
//     payment 'approved'); cancelado vira CANCELADA; o restante vira ABERTA.
//     Moeda diferente de BRL: recusado (não há conversão neste projeto).
//   - NÃ£o cria financeiro, caixa ou indicadores; pedidos ativos geram baixa
//     de estoque idempotente na mesma transaÃ§Ã£o, e cancelamentos devolvem
//     o saldo uma vez. Caixa e financeiro seguem sem conciliaÃ§Ã£o automÃ¡tica.
//
//   REGISTRO DE ORIGEM/RESULTADO
//   - Cada execução grava linha em `Importacao` (tipo MERCADO_LIVRE_*) com
//     contadores, mapeamento (relatório item a item) e erros; mais entrada
//     em `Auditoria` (SINCRONIZAR, origem INTEGRACAO) e `ultimoSyncEm`.
//
//   CONCORRÊNCIA: trava em processo por (empresaId:operação) — mesma
//   filosofia da renovação de token. NÃO é trava distribuída (limitação).
// =============================================================================
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { FormaPagamento } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { chamarML } from './mercadolivre-api.client.js';
import { adquirirIdempotencia, concluirIdempotencia } from '../../lib/idempotencia.js';
import { dataOperacionalDate } from '../../lib/fuso.js';
import { aplicarMovimento } from '../estoque/estoque.service.js';

// ---------------------------------------------------------------------------
// Tipos dos recursos da API (somente os campos que a integração usa)
// ---------------------------------------------------------------------------
export interface ItemML {
  id: string;
  title?: string;
  price?: number | null;
  currency_id?: string;
  available_quantity?: number | null;
  status?: string; // active | paused | closed | inactive
  seller_custom_label?: string | null;
  variations?: Array<{ id: number | string }>;
}

interface ListagemItensML {
  paging?: { total?: number; offset?: number; size?: number };
  results?: Array<string | { id: string }>;
}

export interface OrderItemML {
  item: { id: string; title?: string; variation_id?: number | null };
  quantity: number;
  unit_price: number;
  currency_id?: string;
}

export interface OrderML {
  id: string | number;
  status?: string; // paid | confirmed | cancelled | ...
  currency_id?: string;
  total_amount?: number | null;
  date_created?: string;
  order_items?: OrderItemML[];
  payments?: Array<{
    status?: string;
    payment_type_id?: string;
    payment_method_id?: string;
    transaction_amount?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers compartilhados
// ---------------------------------------------------------------------------

/** Cadastro CONECTADO da conta ML da empresa (único por empresa+tipo). */
export async function cadastroConectadoML(empresaId: string) {
  const cadastro = await prisma.integracaoExterno.findFirst({
    where: { empresaId, tipo: 'MERCADO_LIVRE', status: 'CONECTADO' },
  });
  if (!cadastro) {
    throw new ErroDeNegocio('Conta do Mercado Livre não conectada. Autorize a conexão na Central de Integrações.', 400);
  }
  if (!cadastro.accountId) {
    throw new ErroDeNegocio('Conta do Mercado Livre sem identificador confirmado (accountId). Execute “Testar” na Central.', 400);
  }
  // Propaga o narrowing de accountId (string) no tipo de retorno.
  return { ...cadastro, accountId: cadastro.accountId };
}

/**
 * Trava EM PROCESSO por (empresaId:operacao): duas sincronizações da mesma
 * operação na mesma empresa compartilham a MESMA execução (não duplica
 * requisição nem escrita). Não é trava distribuída — limitação documentada,
 * igual à renovação de token.
 */
const syncsEmAndamento = new Map<string, Promise<unknown>>();

export async function executarComTravaDeSync<T>(empresaId: string, operacao: string, fn: () => Promise<T>): Promise<T> {
  const chave = `${empresaId}:${operacao}`;
  const pendente = syncsEmAndamento.get(chave) as Promise<T> | undefined;
  if (pendente) return pendente;
  const execucao = fn().finally(() => {
    syncsEmAndamento.delete(chave);
  });
  syncsEmAndamento.set(chave, execucao);
  return execucao;
}

/** Grava a linha de `Importacao` que registra origem e resultado da operação. */
export async function registrarImportacaoML(params: {
  empresaId: string;
  usuarioId: string;
  tipo: 'MERCADO_LIVRE_PRODUTOS' | 'MERCADO_LIVRE_ESTOQUE' | 'MERCADO_LIVRE_PEDIDOS';
  status: 'IMPORTADO' | 'ERRO';
  mapeamento: unknown;
  erros: unknown;
  qtdTotal: number;
  qtdImportada: number;
  qtdErro: number;
}) {
  return prisma.importacao.create({
    data: {
      id: randomUUID(),
      empresaId: params.empresaId,
      usuarioId: params.usuarioId,
      tipo: params.tipo,
      status: params.status,
      mapeamento: (params.mapeamento ?? null) as Prisma.InputJsonValue,
      erros: (params.erros ?? []) as Prisma.InputJsonValue,
      qtdTotal: params.qtdTotal,
      qtdImportada: params.qtdImportada,
      qtdErro: params.qtdErro,
      origem: 'INTEGRACAO',
    },
  });
}

/** Atualiza `ultimoSyncEm`/`erros` do cadastro após uma sincronização. */
export async function marcarSyncConcluida(cadastroId: string, erros: unknown) {
  await prisma.integracaoExterno.update({
    where: { id: cadastroId },
    data: {
      ultimoSyncEm: new Date(),
      // Lista vazia vira JsonNull; lista com falhas fica visível na Central.
      ...(Array.isArray(erros) && erros.length > 0
        ? { erros: erros as Prisma.InputJsonValue }
        : { erros: Prisma.JsonNull }),
    },
  });
}

// ---------------------------------------------------------------------------
// ETAPA 2 — Produtos e anúncios (catálogo)
// ---------------------------------------------------------------------------
const SKU_PREFIXO_ML = 'ML-';

/** SKU interno que identifica um produto criado a partir do anúncio ML. */
export function skuDeAnuncio(anuncioId: string): string {
  return `${SKU_PREFIXO_ML}${anuncioId}`;
}

export interface RelatorioItemProduto {
  anuncioId: string;
  produtoId: string | null;
  acao: 'criado' | 'atualizado' | 'semAlteracao' | 'vinculadoPreservado' | 'erro';
  detalhe?: string;
}

/**
 * Espelha UM anúncio no cadastro interno (usado pelo sync completo e pelo
 * reprocessamento de notificações `items`).
 *
 * REGRA DE PRESERVAÇÃO: produto de origem diferente de INTEGRACAO (manual,
 * importado por CSV etc.) NUNCA tem campo alterado — o anúncio apenas
 * passa a ser conhecido pelo vínculo de SKU. Dados de custo interno jamais
 * são sobrescritos porque o ML não é fonte de custo.
 */
export async function espelharAnuncioNoInterno(
  empresaId: string,
  item: ItemML,
  relatorio: RelatorioItemProduto[],
): Promise<void> {
  const anuncioId = String(item.id);
  const skuMl = skuDeAnuncio(anuncioId);
  const label =
    typeof item.seller_custom_label === 'string' && item.seller_custom_label.trim()
      ? item.seller_custom_label.trim()
      : null;

  let produto = await prisma.produto.findFirst({ where: { empresaId, sku: skuMl } });

  if (!produto && label) {
    const vinculado = await prisma.produto.findFirst({ where: { empresaId, sku: label } });
    if (vinculado) {
      relatorio.push({
        anuncioId,
        produtoId: vinculado.id,
        acao: 'vinculadoPreservado',
        detalhe: 'Anúncio vinculado a produto interno pelo SKU (seller_custom_label); nenhum campo interno foi alterado.',
      });
      return;
    }
  }

  const statusAtivo = item.status === undefined || item.status === 'active';
  const precoEspelho = typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0 ? item.price : null;

  if (!produto) {
    if (!item.title || !precoEspelho) {
      relatorio.push({
        anuncioId,
        produtoId: null,
        acao: 'erro',
        detalhe: 'Anúncio sem título ou preço válido para criar o produto espelho.',
      });
      return;
    }
    produto = await prisma.produto.create({
      data: {
        empresaId,
        nome: item.title,
        sku: skuMl,
        // O ML não é fonte de custo: cria com custo zero e o vendedor
        // preenche o custo real depois (custo NUNCA vem do externo).
        custo: 0,
        precoVenda: precoEspelho,
        origem: 'INTEGRACAO',
        status: statusAtivo ? 'ATIVO' : 'INATIVO',
      },
    });
    relatorio.push({ anuncioId, produtoId: produto.id, acao: 'criado', detalhe: 'Produto espelho criado (custo pendente de preenchimento interno).' });
    return;
  }

  // Produto de outra origem: vínculo apenas reconhecido, nada é alterado.
  if (produto.origem !== 'INTEGRACAO') {
    relatorio.push({
      anuncioId,
      produtoId: produto.id,
      acao: 'vinculadoPreservado',
      detalhe: 'Produto interno (origem não-ML) preservado; sem sobrescrita de dados.',
    });
    return;
  }

  const dados: Prisma.ProdutoUpdateInput = {};
  if (item.title && item.title !== produto.nome) dados.nome = item.title;
  if (precoEspelho !== null && Number(produto.precoVenda) !== precoEspelho) dados.precoVenda = precoEspelho;
  // Pausado/encerrado/inativo no ML → produto espelho fica INATIVO (nunca
  // apagado): a informação permanece para quando o anúncio voltar.
  if (item.status && ((item.status === 'active' && produto.status !== 'ATIVO') || (item.status !== 'active' && produto.status !== 'INATIVO'))) {
    dados.status = statusAtivo ? 'ATIVO' : 'INATIVO';
  }

  if (Object.keys(dados).length === 0) {
    relatorio.push({ anuncioId, produtoId: produto.id, acao: 'semAlteracao' });
    return;
  }
  const atualizado = await prisma.produto.update({ where: { id: produto.id }, data: dados });
  relatorio.push({ anuncioId, produtoId: atualizado.id, acao: 'atualizado' });
}

export interface ResultadoSyncProdutos {
  contasProcessadas: number;
  anunciosConsultados: number;
  criados: number;
  atualizados: number;
  vinculosPreservados: number;
  semAlteracao: number;
  erros: number;
  relatorio: RelatorioItemProduto[];
  falhas: Array<{ anuncioId: string; erro: string }>;
}

/**
 * ETAPA 2 — Importa/atualiza o catálogo da conta autorizada.
 *
 * Endpoints oficiais: GET /users/{user_id}/items/search (paginação
 * offset/limit; limit máx. 100) + GET /items/{id} para o detalhe.
 * Anúncio que desapareceu da listagem NÃO apaga produto interno algum:
 * o produto permanece como está (tratamento "removido" = sem ação).
 */
export async function sincronizarProdutos(params: {
  empresaId: string;
  usuarioId: string;
  /** Quantidade máxima de anúncios a consultar (padrão 100, teto 1000). */
  limiteAnuncios?: number;
}): Promise<ResultadoSyncProdutos> {
  const { empresaId, usuarioId } = params;
  const limite = Math.min(Math.max(params.limiteAnuncios ?? 100, 1), 1000);
  const cadastro = await cadastroConectadoML(empresaId);

  const relatorio: RelatorioItemProduto[] = [];
  const falhas: Array<{ anuncioId: string; erro: string }> = [];
  let consultados = 0;

  try {
    // Paginação da listagem de IDs (limit 100 = teto oficial por página).
    let offset = 0;
    const tamanhoPagina = 100;
    while (consultados < limite) {
      const resposta = await chamarML(
        empresaId,
        cadastro.id,
        'GET',
        `/users/${encodeURIComponent(cadastro.accountId)}/items/search`,
        { query: `?offset=${offset}&limit=${tamanhoPagina}` },
      );
      if (!resposta.ok) {
        throw new ErroDeNegocio(
          `Falha ao listar anúncios no Mercado Livre (HTTP ${resposta.status}).`,
          resposta.status === 401 ? 401 : 502,
        );
      }
      const listagem = (resposta.dados ?? {}) as ListagemItensML;
      const ids = (listagem.results ?? []).map((r) => (typeof r === 'string' ? r : r?.id)).filter(Boolean) as string[];
      if (ids.length === 0) break;

      for (const idAnuncio of ids) {
        if (consultados >= limite) break;
        consultados++;
        try {
          const detalhe = await chamarML(empresaId, cadastro.id, 'GET', `/items/${encodeURIComponent(idAnuncio)}`);
          if (!detalhe.ok || !detalhe.dados) {
            falhas.push({ anuncioId: idAnuncio, erro: `Detalhe do anúncio indisponível (HTTP ${detalhe.status}).` });
            relatorio.push({ anuncioId: idAnuncio, produtoId: null, acao: 'erro', detalhe: `HTTP ${detalhe.status}` });
            continue;
          }
          await espelharAnuncioNoInterno(empresaId, detalhe.dados as ItemML, relatorio);
          const ultimo = relatorio[relatorio.length - 1];
          if (ultimo?.acao === 'erro') falhas.push({ anuncioId: idAnuncio, erro: ultimo.detalhe ?? 'Erro ao espelhar anúncio.' });
        } catch (err) {
          // Falha por item NÃO derruba a execução inteira: os demais
          // anúncios seguem e a falha fica registrada para reprocessamento.
          const msg = err instanceof ErroDeNegocio ? err.message : 'Falha inesperada ao processar o anúncio.';
          falhas.push({ anuncioId: idAnuncio, erro: msg });
          relatorio.push({ anuncioId: idAnuncio, produtoId: null, acao: 'erro', detalhe: msg });
        }
      }

      const total = listagem.paging?.total;
      offset += ids.length;
      // Sem total confiável ou já alcançou o total do provedor: encerra.
      if (ids.length < tamanhoPagina) break;
      if (typeof total === 'number' && offset >= total) break;
    }

    const contadores = {
      criados: relatorio.filter((r) => r.acao === 'criado').length,
      atualizados: relatorio.filter((r) => r.acao === 'atualizado').length,
      vinculosPreservados: relatorio.filter((r) => r.acao === 'vinculadoPreservado').length,
      semAlteracao: relatorio.filter((r) => r.acao === 'semAlteracao').length,
      erros: falhas.length,
    };
    await registrarImportacaoML({
      empresaId,
      usuarioId,
      tipo: 'MERCADO_LIVRE_PRODUTOS',
      status: falhas.length > 0 && relatorio.length === 0 ? 'ERRO' : 'IMPORTADO',
      mapeamento: relatorio,
      erros: falhas,
      qtdTotal: consultados,
      qtdImportada: contadores.criados + contadores.atualizados + contadores.vinculosPreservados + contadores.semAlteracao,
      qtdErro: contadores.erros,
    });
    await marcarSyncConcluida(cadastro.id, falhas);
    await registrarAuditoria({
      usuarioId,
      empresaId,
      acao: 'SINCRONIZAR',
      entidade: 'IntegracaoExterno',
      entidadeId: cadastro.id,
      valorNovo: { operacao: 'produtos', consultados, ...contadores },
      origem: 'INTEGRACAO',
      ip: undefined,
    });
    return { contasProcessadas: 1, anunciosConsultados: consultados, ...contadores, relatorio, falhas };
  } catch (err) {
    const msg = err instanceof ErroDeNegocio ? err.message : 'Falha inesperada na sincronização de produtos.';
    await registrarImportacaoML({
      empresaId,
      usuarioId,
      tipo: 'MERCADO_LIVRE_PRODUTOS',
      status: 'ERRO',
      mapeamento: relatorio,
      erros: [{ erro: msg }],
      qtdTotal: consultados,
      qtdImportada: 0,
      qtdErro: Math.max(falhas.length, 1),
    }).catch(() => undefined);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// ETAPA 3 — Estoque (precedência NEXUS OS → ML: apenas EMPURRA o saldo interno)
// ---------------------------------------------------------------------------
export interface RelatorioItemEstoque {
  produtoId: string;
  sku: string | null;
  anuncioId: string;
  saldoInterno: number | null;
  saldoMlAntes: number | null;
  saldoMlDepois: number | null;
  acao:
    | 'atualizado'
    | 'semAlteracao'
    | 'anuncioPausado'
    | 'anuncioNaoEncontrado'
    | 'anuncioComVariacoes'
    | 'semLinhaDeEstoque'
    | 'saldoNegativoBloqueado'
    | 'erro';
  detalhe?: string;
}

export interface ResultadoSyncEstoque {
  anunciosAvaliados: number;
  atualizados: number;
  semAlteracao: number;
  pulados: number;
  erros: number;
  relatorio: RelatorioItemEstoque[];
  falhas: Array<{ anuncioId: string; erro: string }>;
}

/**
 * ETAPA 3 — Reconciliação de estoque: envia o saldo interno da FILIAL para os
 * anúncios da conta (somente anúncios produto espelho com SKU 'ML-<id>').
 *
 * PRECEDÊNCIA (regra explícita): o NEXUS OS é a fonte do saldo. Este sync NUNCA
 * grava quantidade vinda do ML na tabela Estoque; ele apenas atualiza
 * `available_quantity` no anúncio quando o saldo interno DIFERE do remoto.
 * Produtos internos vinculados por outro SKU (origem MANUAL/IMPORTADO) NÃO
 * participam (só espelhos INTEGRACAO), para nunca "empurrar" saldo interno
 * de um produto que o vendedor gerencia de outro jeito sem intenção.
 */
export async function sincronizarEstoque(params: {
  empresaId: string;
  usuarioId: string;
  filialId: string;
}): Promise<ResultadoSyncEstoque> {
  const { empresaId, usuarioId, filialId } = params;
  const cadastro = await cadastroConectadoML(empresaId);
  const filial = await prisma.filial.findFirst({ where: { id: filialId, empresaId, status: 'ATIVO' } });
  if (!filial) {
    throw NaoEncontrado('Filial não encontrada ou inativa.');
  }

  const relatorio: RelatorioItemEstoque[] = [];
  const falhas: Array<{ anuncioId: string; erro: string }> = [];

  try {
    // Interlock de segurança: se a importação de pedidos mais recente deixou
    // pedidos sem aplicar no NEXUS (por exemplo, produto sem vínculo ou saldo
    // interno insuficiente), não publicar um saldo potencialmente obsoleto no
    // marketplace. A próxima rodada limpa de pedidos libera o envio automático.
    const ultimaImportacaoPedidos = await prisma.importacao.findFirst({
      where: { empresaId, tipo: 'MERCADO_LIVRE_PEDIDOS' },
      orderBy: { createdAt: 'desc' },
      select: { qtdErro: true },
    });
    if ((ultimaImportacaoPedidos?.qtdErro ?? 0) > 0) {
      throw new ErroDeNegocio(
        'Sincronização de estoque pausada: corrija os pedidos com erro na última importação e aguarde a próxima sincronização automática.',
        503,
      );
    }

    const produtosMl = await prisma.produto.findMany({
      where: { empresaId, origem: 'INTEGRACAO', sku: { startsWith: 'ML-' } },
      select: { id: true, sku: true },
      orderBy: { createdAt: 'asc' },
    });

    for (const produto of produtosMl) {
      const anuncioId = (produto.sku ?? '').slice('ML-'.length);
      if (!anuncioId) continue;
      const base = {
        produtoId: produto.id,
        sku: produto.sku,
        anuncioId,
        saldoMlAntes: null as number | null,
        saldoMlDepois: null as number | null,
      };

      const linha = await prisma.estoque.findUnique({
        where: { filialId_produtoId: { filialId, produtoId: produto.id } },
        select: { quantidade: true },
      });
      if (!linha) {
        relatorio.push({ ...base, saldoInterno: null, acao: 'semLinhaDeEstoque', detalhe: 'Sem linha de estoque na filial; nada foi enviado ao ML.' });
        continue;
      }
      const saldoInterno = Number(linha.quantidade);
      if (saldoInterno < 0) {
        relatorio.push({ ...base, saldoInterno, acao: 'saldoNegativoBloqueado', detalhe: 'Saldo interno negativo: não se envia ao ML (reconciliação manual necessária).' });
        continue;
      }

      const detalhe = await chamarML(empresaId, cadastro.id, 'GET', `/items/${encodeURIComponent(anuncioId)}`);
      if (detalhe.status === 404) {
        relatorio.push({ ...base, saldoInterno, acao: 'anuncioNaoEncontrado', detalhe: 'Anúncio inexistente/revogado no ML; nenhum dado interno foi apagado.' });
        continue;
      }
      if (!detalhe.ok || !detalhe.dados) {
        const erro = `Falha ao consultar anúncio (HTTP ${detalhe.status}).`;
        falhas.push({ anuncioId, erro });
        relatorio.push({ ...base, saldoInterno, acao: 'erro', detalhe: erro });
        continue;
      }

      const item = detalhe.dados as ItemML;
      const saldoMlAntes = typeof item.available_quantity === 'number' ? item.available_quantity : null;
      base.saldoMlAntes = saldoMlAntes;

      if (item.status && item.status !== 'active') {
        relatorio.push({ ...base, saldoInterno, acao: 'anuncioPausado', detalhe: `Anúncio ${item.status}: quantidade não enviada (não reativamos/alteramos anúncio pausado sem decisão humana).` });
        continue;
      }
      if (Array.isArray(item.variations) && item.variations.length > 0) {
        relatorio.push({ ...base, saldoInterno, acao: 'anuncioComVariacoes', detalhe: 'Anúncio com variações: quantidade por variação não é gerida por este sync (limitação documentada).' });
        continue;
      }
      if (saldoMlAntes === saldoInterno) {
        relatorio.push({ ...base, saldoInterno, acao: 'semAlteracao' });
        continue;
      }

      const put = await chamarML(empresaId, cadastro.id, 'PUT', `/items/${encodeURIComponent(anuncioId)}`, {
        corpo: { available_quantity: Math.floor(saldoInterno) },
      });
      if (!put.ok || !put.dados) {
        const erro = `PUT de quantidade recusado (HTTP ${put.status}).`;
        falhas.push({ anuncioId, erro });
        relatorio.push({ ...base, saldoInterno, acao: 'erro', detalhe: erro });
        continue;
      }
      const depois = put.dados as ItemML;
      base.saldoMlDepois = typeof depois.available_quantity === 'number' ? depois.available_quantity : Math.floor(saldoInterno);
      relatorio.push({ ...base, saldoInterno, acao: 'atualizado' });
    }

    const contadores = {
      atualizados: relatorio.filter((r) => r.acao === 'atualizado').length,
      semAlteracao: relatorio.filter((r) => r.acao === 'semAlteracao').length,
      pulados: relatorio.filter((r) => r.acao !== 'atualizado' && r.acao !== 'semAlteracao' && r.acao !== 'erro').length,
      erros: falhas.length,
    };
    await registrarImportacaoML({
      empresaId,
      usuarioId,
      tipo: 'MERCADO_LIVRE_ESTOQUE',
      status: falhas.length > 0 && relatorio.length === 0 ? 'ERRO' : 'IMPORTADO',
      mapeamento: { filialId, relatorio },
      erros: falhas,
      qtdTotal: relatorio.length,
      qtdImportada: contadores.atualizados + contadores.semAlteracao,
      qtdErro: contadores.erros,
    });
    await marcarSyncConcluida(cadastro.id, falhas);
    await registrarAuditoria({
      usuarioId,
      empresaId,
      acao: 'SINCRONIZAR',
      entidade: 'Estoque',
      entidadeId: filialId,
      valorNovo: { operacao: 'estoque', filialId, ...contadores },
      origem: 'INTEGRACAO',
      ip: undefined,
    });
    return { anunciosAvaliados: relatorio.length, ...contadores, relatorio, falhas };
  } catch (err) {
    const msg = err instanceof ErroDeNegocio ? err.message : 'Falha inesperada na sincronização de estoque.';
    await registrarImportacaoML({
      empresaId,
      usuarioId,
      tipo: 'MERCADO_LIVRE_ESTOQUE',
      status: 'ERRO',
      mapeamento: { filialId, relatorio },
      erros: [{ erro: msg }],
      qtdTotal: relatorio.length,
      qtdImportada: 0,
      qtdErro: Math.max(falhas.length, 1),
    }).catch(() => undefined);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// ETAPA 4 — Pedidos (importação idempotente, SEM efeitos contábeis laterais)
// ---------------------------------------------------------------------------
export interface RelatorioItemPedido {
  pedidoId: string;
  vendaId: string | null;
  acao: 'importada' | 'atualizada' | 'duplicada' | 'moedaNaoSuportada' | 'semVinculoProduto' | 'semItens' | 'erro';
  detalhe?: string;
}

export interface ResultadoSyncPedidos {
  pedidosConsultados: number;
  importados: number;
  atualizados: number;
  duplicados: number;
  pulados: number;
  erros: number;
  relatorio: RelatorioItemPedido[];
  falhas: Array<{ pedidoId: string; erro: string }>;
}

/**
 * A primeira conexão pode importar pedidos históricos para criar o histórico
 * de vendas. Esses pedidos já estão refletidos no estoque inicial do NEXUS e
 * não podem ser baixados outra vez. `createdAt` da tarefa de pedidos é a linha
 * de corte persistida no banco; pedidos posteriores geram movimento local.
 */
async function pedidoPosteriorAoInicioDaIntegracao(empresaId: string, order: OrderML): Promise<boolean> {
  if (!order.date_created) return true;
  const dataPedido = new Date(order.date_created);
  if (!Number.isFinite(dataPedido.getTime())) return true;
  const tarefa = await prisma.sincronizacaoTarefa.findUnique({
    where: { empresaId_tipo: { empresaId, tipo: 'MERCADO_LIVRE_PEDIDOS' } },
    select: { createdAt: true },
  });
  return !tarefa || dataPedido >= tarefa.createdAt;
}

/** Mapeia o meio de pagamento relatado pelo ML para a FormaPagamento interna. */
function mapearFormaPagamento(order: OrderML): FormaPagamento {
  const pagamentos = order.payments ?? [];
  const aprovado = pagamentos.find((p) => p.status === 'approved') ?? pagamentos[0];
  const tipo = (aprovado?.payment_type_id ?? '').toLowerCase();
  const metodo = (aprovado?.payment_method_id ?? '').toLowerCase();
  if (metodo.includes('pix') || tipo.includes('pix')) return 'PIX';
  if (tipo.includes('credit')) return 'CARTAO_CREDITO';
  if (tipo.includes('debit')) return 'CARTAO_DEBITO';
  if (tipo.includes('bank_transfer') || tipo.includes('transfer')) return 'TRANSFERENCIA';
  if (tipo.includes('ticket')) return 'BOLETO';
  return 'OUTRO';
}

/**
 * Status interno da venda derivado do pedido, com EVIDÊNCIA obrigatória:
 * - CANCELADA: pedido cancelado no ML;
 * - FINALIZADA: pedido 'paid' OU payment 'approved' (evidência de pagamento);
 * - ABERTA: demais estados (confirmado, etc.) — NÃO fingimos pagamento.
 */
function statusVendaDoPedido(order: OrderML): 'CANCELADA' | 'FINALIZADA' | 'ABERTA' {
  if (order.status === 'cancelled') return 'CANCELADA';
  const pagamentoAprovado = (order.payments ?? []).some((p) => p.status === 'approved');
  if (order.status === 'paid' || pagamentoAprovado) return 'FINALIZADA';
  return 'ABERTA';
}

/**
 * Resolve o produto interno para um item do pedido: busca primeiro o espelho
 * ('ML-<itemId>'); se não existir, re-consulta o anúncio e tenta espelhá-lo
 * sob demanda (cobre pedido anterior ao primeiro sync de produtos). Variação
 * usa o produto espelho do anúncio BASE (limitação documentada).
 */
async function resolverProdutoDoItemPedido(
  empresaId: string,
  cadastroId: string,
  orderItem: OrderItemML,
): Promise<{ produtoId: string; custoUnitario: number } | null> {
  const anuncioId = String(orderItem.item?.id ?? '');
  if (!anuncioId) return null;
  const sku = skuDeAnuncio(anuncioId);
  let produto = await prisma.produto.findFirst({ where: { empresaId, sku } });
  if (!produto) {
    const detalhe = await chamarML(empresaId, cadastroId, 'GET', `/items/${encodeURIComponent(anuncioId)}`);
    if (detalhe.ok && detalhe.dados) {
      const relatorioTemporario: RelatorioItemProduto[] = [];
      await espelharAnuncioNoInterno(empresaId, detalhe.dados as ItemML, relatorioTemporario);
      produto = await prisma.produto.findFirst({ where: { empresaId, sku } });
    }
  }
  if (!produto) return null;
  return { produtoId: produto.id, custoUnitario: Number(produto.custo) };
}

/**
 * Pedido já importado + desfecho novo no ML → atualiza SOMENTE o campo
 * `status` da venda (ABERTA→FINALIZADA com evidência, ou →CANCELADA).
 * NÃO cria financeiro, caixa, movimentações nem indicadores aqui.
 */
async function atualizarDesfechoPedido(
  venda: { id: string; status: string },
  order: OrderML,
  contexto: { empresaId: string; filialId: string; usuarioId: string; pedidoId: string; aplicarEstoque: boolean },
): Promise<'atualizada' | 'semAlteracao'> {
  const novoStatus = statusVendaDoPedido(order);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Venda" WHERE "id" = ${venda.id} FOR UPDATE`;
    const atual = await tx.venda.findUnique({ where: { id: venda.id }, include: { itens: true } });
    if (!atual) return 'semAlteracao';
    const documento = `ml:order:${contexto.pedidoId}`;
    const movimentos = await tx.estoqueMovimentacao.findMany({
      where: { empresaId: contexto.empresaId, documento, tipo: { in: ['VENDA', 'DEVOLUCAO'] } },
      select: { tipo: true },
    });
    const baixado = movimentos.some((m) => m.tipo === 'VENDA');
    const devolvido = movimentos.some((m) => m.tipo === 'DEVOLUCAO');

    // Reserva/baixa qualquer pedido ainda ativo para que a próxima publicação
    // automática de estoque não devolva ao anúncio uma unidade já vendida.
    if (contexto.aplicarEstoque && novoStatus !== 'CANCELADA' && !baixado) {
      for (const item of atual.itens) {
        await aplicarMovimento(tx, {
          empresaId: contexto.empresaId, filialId: contexto.filialId,
          produtoId: item.produtoId, usuarioId: contexto.usuarioId, tipo: 'VENDA',
          quantidade: Number(item.quantidade), motivo: `Pedido Mercado Livre ${contexto.pedidoId}`,
          documento, origem: 'INTEGRACAO',
        });
      }
    }
    // Cancelamento devolve ao saldo apenas uma vez, na mesma transação da
    // mudança de estado. Devoluções físicas seguem como fluxo pós-venda.
    if (novoStatus === 'CANCELADA' && baixado && !devolvido) {
      for (const item of atual.itens) {
        await aplicarMovimento(tx, {
          empresaId: contexto.empresaId, filialId: contexto.filialId,
          produtoId: item.produtoId, usuarioId: contexto.usuarioId, tipo: 'DEVOLUCAO',
          quantidade: Number(item.quantidade), motivo: `Cancelamento Mercado Livre ${contexto.pedidoId}`,
          documento, origem: 'INTEGRACAO',
        });
      }
    }

    if (novoStatus === atual.status) return 'semAlteracao';
    const transicaoPermitida = novoStatus === 'CANCELADA' || (atual.status === 'ABERTA' && novoStatus === 'FINALIZADA');
    if (!transicaoPermitida) return 'semAlteracao';
    await tx.venda.update({ where: { id: venda.id }, data: { status: novoStatus } });
    return 'atualizada';
  });
}

/**
 * Importa UM pedido com idempotência em DUAS camadas:
 * 1) `Venda.idempotencyKey` = 'ml:order:<id>' (índice auxiliar, caminho rápido);
 * 2) tabela `IdempotencyKey` (fonte normativa, mesmo mecanismo do PDV PRO:
 *    acquire → transação → CONFIRMADA/REJEITADA; P2002 impede dupla criação).
 *
 * NÃO cria financeiro, movimentação de caixa, baixa de estoque nem indicadores:
 * a importação REGISTRA a venda; efeitos contábeis são decisão do vendedor e a
 * reconciliação de estoque (ETAPA 3) cobre a divergência de saldo.
 */
export async function importarPedidoML(params: {
  empresaId: string;
  cadastroId: string;
  filialId: string;
  fusoHorario: string | null;
  usuarioId: string;
  order: OrderML;
}): Promise<{ acao: RelatorioItemPedido['acao']; vendaId: string | null; detalhe?: string }> {
  const { empresaId, cadastroId, filialId, fusoHorario, usuarioId, order } = params;
  const pedidoId = String(order.id);
  const key = `ml:order:${pedidoId}`;
  const aplicarEstoque = await pedidoPosteriorAoInicioDaIntegracao(empresaId, order);

  // Camada 1 — venda já importada? Atualiza só o desfecho, se o ML mudou.
  const vendaExistente = await prisma.venda.findFirst({
    where: { empresaId, idempotencyKey: key },
    select: { id: true, status: true },
  });
  if (vendaExistente) {
    const desfecho = await atualizarDesfechoPedido(vendaExistente, order, { empresaId, filialId, usuarioId, pedidoId, aplicarEstoque });
    return {
      acao: desfecho === 'atualizada' ? 'atualizada' : 'duplicada',
      vendaId: vendaExistente.id,
      ...(desfecho === 'atualizada' ? { detalhe: 'Status da venda já importada atualizado conforme o ML.' } : {}),
    };
  }

  // Moeda: não existe conversão de moeda no projeto → recusa explícita.
  if (order.currency_id && order.currency_id !== 'BRL') {
    return { acao: 'moedaNaoSuportada', vendaId: null, detalhe: `Moeda ${order.currency_id} não suportada (projeto opera em BRL).` };
  }

  const orderItems = order.order_items ?? [];
  if (orderItems.length === 0) {
    return { acao: 'semItens', vendaId: null, detalhe: 'Pedido sem itens na resposta (possível HTTP 206/incompleto); reexecute mais tarde.' };
  }

  // Resolve os produtos ANTES de adquirir idempotência: se faltar vínculo,
  // nada fica "preso" em PROCESSANDO por causa de dado incompleto.
  const itens: Array<{ produtoId: string; custoUnitario: number; quantidade: number; unitPrice: number }> = [];
  for (const oi of orderItems) {
    const quantidade = Math.max(1, Math.trunc(oi.quantity ?? 1));
    const unitPrice = typeof oi.unit_price === 'number' && Number.isFinite(oi.unit_price) && oi.unit_price >= 0 ? oi.unit_price : null;
    if (unitPrice === null) {
      return { acao: 'erro', vendaId: null, detalhe: 'Item do pedido sem preço unitário válido.' };
    }
    const produto = await resolverProdutoDoItemPedido(empresaId, cadastroId, oi);
    if (!produto) {
      return {
        acao: 'semVinculoProduto',
        vendaId: null,
        detalhe: `Anúncio ${oi.item?.id ?? '?'} sem produto interno; rode a sincronização de produtos ou vincule o SKU manualmente.`,
      };
    }
    itens.push({ produtoId: produto.produtoId, custoUnitario: produto.custoUnitario, quantidade, unitPrice });
  }

  // Camada 2 — tabela IdempotencyKey (fonte normativa de unicidade).
  const inputAquisicao = { key, empresaId, filialId, operadorId: usuarioId };
  let aquisicao = await adquirirIdempotencia(inputAquisicao);
  if (aquisicao.duplicada && aquisicao.status === 'REJEITADA') {
    // Tentativa anterior falhou SEM criar venda: libera reprocessamento com
    // a MESMA chave (nunca uma segunda venda — camada 1 já garantiu isso).
    await prisma.idempotencyKey.delete({ where: { id: aquisicao.id } }).catch(() => undefined);
    aquisicao = await adquirirIdempotencia(inputAquisicao);
  }
  if (aquisicao.duplicada) {
    const vendaPorChave = await prisma.venda.findFirst({ where: { empresaId, idempotencyKey: key }, select: { id: true } });
    return { acao: 'duplicada', vendaId: vendaPorChave?.id ?? null };
  }

  try {
    const subtotal = itens.reduce((acc, i) => acc + i.unitPrice * i.quantidade, 0);
    const totalPedido = typeof order.total_amount === 'number' && Number.isFinite(order.total_amount) && order.total_amount > 0
      ? order.total_amount
      : subtotal;
    const desconto = subtotal > totalPedido ? subtotal - totalPedido : 0;
    const status = statusVendaDoPedido(order);
    const pago = status === 'FINALIZADA';
    const forma = mapearFormaPagamento(order);
    const dataCriacao = order.date_created ? new Date(order.date_created) : new Date();
    const instante = Number.isNaN(dataCriacao.getTime()) ? new Date() : dataCriacao;
    const dataOperacional = dataOperacionalDate(instante, fusoHorario);

    const vendaId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.venda.create({
        data: {
          id: vendaId,
          empresaId,
          filialId,
          formaPagamento: forma,
          status,
          subtotal,
          desconto,
          total: totalPedido,
          origem: 'INTEGRACAO',
          idempotencyKey: key,
          dataOperacional,
          itens: {
            create: itens.map((i) => ({
              produtoId: i.produtoId,
              quantidade: i.quantidade,
              preco: i.unitPrice,
              custoUnitario: i.custoUnitario,
              desconto: 0,
              total: i.unitPrice * i.quantidade,
            })),
          },
          // Pagamento gravado SOMENTE com evidência do provedor. A linha
          // VendaPagamento é histórica: NÃO movimenta caixa nem financeiro.
          ...(pago
            ? {
                pagamentos: {
                  create: [{ empresaId, forma, valor: totalPedido, referencia: `ML order ${pedidoId}`, status: 'CONFIRMADO' }],
                },
              }
            : {}),
        },
      });
      if (aplicarEstoque && status !== 'CANCELADA') {
        // O movimento nasce no mesmo commit da venda. A idempotência do pedido
        // impede que webhook/polling retirem estoque duas vezes.
        for (const item of itens) {
          await aplicarMovimento(tx, {
            empresaId, filialId, produtoId: item.produtoId, usuarioId,
            tipo: 'VENDA', quantidade: item.quantidade,
            motivo: `Pedido Mercado Livre ${pedidoId}`,
            documento: key, origem: 'INTEGRACAO',
          });
        }
      }
    });
    await concluirIdempotencia(aquisicao.id, {
      status: 'CONFIRMADA',
      vendaId,
      responseStatus: 201,
      responseBody: { pedidoId, vendaId },
    });
    return { acao: 'importada', vendaId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha ao gravar a venda importada.';
    await concluirIdempotencia(aquisicao.id, {
      status: 'REJEITADA',
      responseStatus: 400,
      responseBody: { erro: msg },
    }).catch(() => undefined);
    return { acao: 'erro', vendaId: null, detalhe: msg };
  }
}

interface ListagemPedidosML {
  paging?: { total?: number; offset?: number; size?: number };
  results?: Array<string | { id: string | number }>;
}

/**
 * ETAPA 4 — Sincroniza pedidos da conta autorizada.
 *
 * Endpoints: GET /orders/search (paginação offset/limit, teto 50/página;
 * sem filtro de data — o parâmetro `limite` restringe o recorte, decisão
 * documentada) + GET /orders/{id} (HTTP 206 Partial Content tratado como
 * sucesso; corpo incompleto é detectado pela ausência de `order_items` e
 * registrado para reprocessamento, sem inventar dados).
 */
export async function sincronizarPedidos(params: {
  empresaId: string;
  usuarioId: string;
  filialId: string;
  /** Quantidade máxima de pedidos a consultar (padrão 50, teto 500). */
  limite?: number;
}): Promise<ResultadoSyncPedidos> {
  const { empresaId, usuarioId, filialId } = params;
  const limite = Math.min(Math.max(params.limite ?? 50, 1), 500);
  const cadastro = await cadastroConectadoML(empresaId);
  const filial = await prisma.filial.findFirst({ where: { id: filialId, empresaId, status: 'ATIVO' } });
  if (!filial) {
    throw NaoEncontrado('Filial não encontrada ou inativa.');
  }

  const relatorio: RelatorioItemPedido[] = [];
  const falhas: Array<{ pedidoId: string; erro: string }> = [];
  let consultados = 0;

  try {
    let offset = 0;
    const tamanhoPagina = 50;
    while (consultados < limite) {
      const listagem = await chamarML(empresaId, cadastro.id, 'GET', '/orders/search', {
        query: `?seller=${encodeURIComponent(cadastro.accountId)}&sort=date_desc&offset=${offset}&limit=${tamanhoPagina}`,
      });
      if (!listagem.ok) {
        throw new ErroDeNegocio(
          `Falha ao listar pedidos no Mercado Livre (HTTP ${listagem.status}).`,
          listagem.status === 401 ? 401 : 502,
        );
      }
      const corpoListagem = (listagem.dados ?? {}) as ListagemPedidosML;
      const ids = (corpoListagem.results ?? [])
        .map((r) => (typeof r === 'string' ? r : String(r?.id ?? '')))
        .filter((id) => id && id !== 'undefined');
      if (ids.length === 0) break;

      for (const idPedido of ids) {
        if (consultados >= limite) break;
        consultados++;
        try {
          const resp = await chamarML(empresaId, cadastro.id, 'GET', `/orders/${encodeURIComponent(idPedido)}`);
          if (resp.status === 404) {
            falhas.push({ pedidoId: idPedido, erro: 'Pedido inexistente/revogado no ML (HTTP 404).' });
            relatorio.push({ pedidoId: idPedido, vendaId: null, acao: 'erro', detalhe: 'HTTP 404' });
            continue;
          }
          if (!resp.ok || !resp.dados) {
            falhas.push({ pedidoId: idPedido, erro: `Consulta do pedido falhou (HTTP ${resp.status}).` });
            relatorio.push({ pedidoId: idPedido, vendaId: null, acao: 'erro', detalhe: `HTTP ${resp.status}` });
            continue;
          }
          const resultado = await importarPedidoML({
            empresaId,
            cadastroId: cadastro.id,
            filialId,
            fusoHorario: filial.fusoHorario,
            usuarioId,
            order: resp.dados as OrderML,
          });
          relatorio.push({
            pedidoId: idPedido,
            vendaId: resultado.vendaId,
            acao: resultado.acao,
            ...(resultado.detalhe ? { detalhe: resultado.detalhe } : {}),
          });
          if (resultado.acao === 'erro' || resultado.acao === 'semVinculoProduto' || resultado.acao === 'semItens') {
            falhas.push({ pedidoId: idPedido, erro: resultado.detalhe ?? 'Falha ao importar pedido.' });
          }
        } catch (err) {
          const msg = err instanceof ErroDeNegocio ? err.message : 'Falha inesperada ao processar o pedido.';
          falhas.push({ pedidoId: idPedido, erro: msg });
          relatorio.push({ pedidoId: idPedido, vendaId: null, acao: 'erro', detalhe: msg });
        }
      }

      const total = corpoListagem.paging?.total;
      offset += ids.length;
      if (ids.length < tamanhoPagina) break;
      if (typeof total === 'number' && offset >= total) break;
    }

    const contadores = {
      importados: relatorio.filter((r) => r.acao === 'importada').length,
      atualizados: relatorio.filter((r) => r.acao === 'atualizada').length,
      duplicados: relatorio.filter((r) => r.acao === 'duplicada').length,
      pulados: relatorio.filter((r) => r.acao === 'moedaNaoSuportada' || r.acao === 'semVinculoProduto' || r.acao === 'semItens').length,
      erros: falhas.length,
    };
    await registrarImportacaoML({
      empresaId,
      usuarioId,
      tipo: 'MERCADO_LIVRE_PEDIDOS',
      status: falhas.length > 0 && relatorio.length === 0 ? 'ERRO' : 'IMPORTADO',
      mapeamento: { filialId, relatorio },
      erros: falhas,
      qtdTotal: consultados,
      qtdImportada: contadores.importados + contadores.atualizados + contadores.duplicados,
      qtdErro: contadores.erros,
    });
    await marcarSyncConcluida(cadastro.id, falhas);
    await registrarAuditoria({
      usuarioId,
      empresaId,
      acao: 'SINCRONIZAR',
      entidade: 'Venda',
      entidadeId: filialId,
      valorNovo: { operacao: 'pedidos', filialId, ...contadores },
      origem: 'INTEGRACAO',
      ip: undefined,
    });
    return { pedidosConsultados: consultados, ...contadores, relatorio, falhas };
  } catch (err) {
    const msg = err instanceof ErroDeNegocio ? err.message : 'Falha inesperada na sincronização de pedidos.';
    await registrarImportacaoML({
      empresaId,
      usuarioId,
      tipo: 'MERCADO_LIVRE_PEDIDOS',
      status: 'ERRO',
      mapeamento: { filialId, relatorio },
      erros: [{ erro: msg }],
      qtdTotal: consultados,
      qtdImportada: 0,
      qtdErro: Math.max(falhas.length, 1),
    }).catch(() => undefined);
    throw err;
  }
}






