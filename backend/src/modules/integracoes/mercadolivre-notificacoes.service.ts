/**
 * Notificações (webhooks) do Mercado Livre — NEXUS OS.
 *
 * O ML envia para a URL de notificação da app um POST enxuto:
 *   { user_id, resource, topic, application_id, at, attempts }
 * O payload NÃO traz o conteúdo do recurso — só o ponteiro. Por isso o fluxo
 * seguro é: (1) identificar a empresa pelo `user_id` (= accountId da conta
 * conectada), (2) re-consultar o recurso na API com o TOKEN PRÓPRIO dessa
 * conta e (3) importar com os mesmos mecanismos de idempotência do sync
 * completo. Nada do corpo do webhook é confiado como verdade — defesa contra
 * payloads forjados.
 *
 * Deduplicação: a fila usa (empresa, tópico, ID do evento/recurso) e a chave
 * de idempotência impede efeitos repetidos mesmo entre webhook e sync.
 * O webhook persiste o ponteiro e confirma rapidamente; o agendador processa
 * a fila com leases e backoff persistidos no banco.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ErroDeNegocio } from '../../lib/erros.js';
import { adquirirIdempotencia, concluirIdempotencia } from '../../lib/idempotencia.js';
import { chamarML } from './mercadolivre-api.client.js';
import {
  espelharAnuncioNoInterno,
  importarPedidoML,
  type ItemML,
  type OrderML,
  type RelatorioItemProduto,
} from './mercadolivre-sync.service.js';

/** Tópicos que alteram PEDIDOS (inclui pagamentos de pedidos). */
const TOPICOS_DE_PEDIDO = new Set(['order', 'orders', 'orders_v2', 'payments']);
/** Tópicos que alteram ANÚNCIOS (catálogo/estoque do item). */
const TOPICOS_DE_ITEM = new Set(['item', 'items']);

export interface NotificacaoML {
  /** Ponteiro do recurso, ex.: "/orders/123456" ou "/items/MLB987654". */
  resource: string;
  /** Identificador único do evento, disponível como `id` ou `_id` no ML. */
  id?: number | string | null;
  _id?: number | string | null;
  /** seller_id da conta notificada (bate com `accountId` do cadastro). */
  user_id: number | string;
  topic: string;
  application_id?: number | string | null;
  at?: string | null;
  attempts?: number | null;
}

export interface ResultadoNotificacaoML {
  classificacao: 'PROCESSADO' | 'IGNORADO' | 'TRANSITORIO' | 'PERMANENTE';
  processada: boolean;
  motivo?: string;
  detalhe?: string;
}

const MAX_TENTATIVAS_NOTIFICACAO_ML = 8;

export function classificarFalhaNotificacaoML(status?: number): 'TRANSITORIO' | 'PERMANENTE' {
  if (status === undefined || status === 408 || status === 425 || status === 429 || status >= 500) return 'TRANSITORIO';
  return 'PERMANENTE';
}

function eventKeyDaNotificacao(n: NotificacaoML): string {
  const recurso = String(n.resource ?? '').trim();
  const topic = String(n.topic ?? '').trim().toLowerCase();
  const eventId = n.id ?? n._id ?? n.at ?? `${topic}:${recurso}:legacy`;
  return `${topic}:${String(eventId)}:${recurso}`.slice(0, 240);
}

function erroNotificacaoRedigido(err: unknown): string {
  const mensagem = err instanceof Error ? err.message : 'Falha inesperada.';
  return mensagem
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]')
    .replace(/(access_token|refresh_token|client_secret|authorization)=([^\s&"']+)/gi, '$1=[REDACTED]')
    .slice(0, 300);
}

export async function enfileirarNotificacaoML(notificacao: NotificacaoML): Promise<{ enfileirada: boolean; duplicada: boolean; ignorada?: string }> {
  const userId = String(notificacao.user_id ?? '').trim();
  if (!userId) return { enfileirada: false, duplicada: false, ignorada: 'user_id ausente.' };
  const cadastro = await prisma.integracaoExterno.findFirst({
    where: { tipo: 'MERCADO_LIVRE', accountId: userId, status: 'CONECTADO' },
    select: { empresaId: true },
  });
  if (!cadastro) return { enfileirada: false, duplicada: false, ignorada: 'Conta Mercado Livre não conectada.' };
  try {
    await prisma.notificacaoMercadoLivre.create({
      data: {
        empresaId: cadastro.empresaId,
        eventKey: eventKeyDaNotificacao(notificacao),
        topic: String(notificacao.topic).slice(0, 60),
        resource: String(notificacao.resource).slice(0, 200),
        userId,
        payload: notificacao as unknown as Prisma.InputJsonValue,
      },
    });
    return { enfileirada: true, duplicada: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { enfileirada: true, duplicada: true };
    }
    throw err;
  }
}

function backoffNotificacaoMs(tentativa: number): number {
  return Math.min(30 * 60_000, 30_000 * 2 ** Math.min(10, Math.max(0, tentativa - 1)));
}

/** Consome notificações duráveis; leases permitem retomada após queda do processo. */
export async function executarFilaNotificacoesML(limite = 20): Promise<{ processadas: number; ignoradas: number; falhasPermanentes: number; retentativas: number; recuperadas: number }> {
  const agora = new Date();
  // `proximaExecucaoEm` usa o relógio do PostgreSQL (`now()`), enquanto o
  // consumidor fornece o cutoff pelo relógio do processo. Uma pequena margem
  // evita que um evento recém-aceito pareça futuro por poucos milissegundos e
  // fique para o próximo ciclo. Backoffs são de pelo menos 30 s, então 2 s não
  // antecipa uma retentativa operacionalmente relevante.
  const limiteExecucao = new Date(agora.getTime() + 2_000);
  const recuperadas = await prisma.notificacaoMercadoLivre.updateMany({
    where: { status: 'EXECUTANDO', leaseExpiraEm: { lt: agora } },
    data: { status: 'AGUARDANDO', leaseExpiraEm: null, proximaExecucaoEm: agora },
  });
  const fila = await prisma.notificacaoMercadoLivre.findMany({
    where: { status: 'AGUARDANDO', proximaExecucaoEm: { lte: limiteExecucao } },
    orderBy: [{ proximaExecucaoEm: 'asc' }, { createdAt: 'asc' }],
    take: Math.max(1, Math.min(100, limite)),
  });
  let processadas = 0;
  let ignoradas = 0;
  let falhasPermanentes = 0;
  let retentativas = 0;
  for (const evento of fila) {
    const lease = await prisma.notificacaoMercadoLivre.updateMany({
      where: { id: evento.id, status: 'AGUARDANDO', proximaExecucaoEm: { lte: limiteExecucao } },
      data: { status: 'EXECUTANDO', leaseExpiraEm: new Date(Date.now() + 15 * 60_000), tentativas: { increment: 1 } },
    });
    if (!lease.count) continue;
    const tentativa = evento.tentativas + 1;
    try {
      const resultado = await processarNotificacaoML(evento.payload as unknown as NotificacaoML);
      if (resultado.classificacao === 'PROCESSADO') {
        await prisma.notificacaoMercadoLivre.update({ where: { id: evento.id }, data: { status: 'PROCESSADO', leaseExpiraEm: null, processadaEm: new Date(), finalizadaEm: new Date(), ultimoErro: Prisma.JsonNull } });
        processadas++;
      } else if (resultado.classificacao === 'IGNORADO') {
        await prisma.notificacaoMercadoLivre.update({ where: { id: evento.id }, data: { status: 'IGNORADO', leaseExpiraEm: null, finalizadaEm: new Date(), ultimoErro: { motivo: (resultado.motivo ?? 'Ignorada sem motivo informado.').slice(0, 300) } } });
        ignoradas++;
      } else if (resultado.classificacao === 'PERMANENTE' || tentativa >= MAX_TENTATIVAS_NOTIFICACAO_ML) {
        const mensagem = erroNotificacaoRedigido(new Error(resultado.detalhe ?? resultado.motivo ?? 'Falha permanente.'));
        await prisma.notificacaoMercadoLivre.update({ where: { id: evento.id }, data: { status: 'FALHA_PERMANENTE', leaseExpiraEm: null, finalizadaEm: new Date(), ultimoErro: { mensagem, tentativa, classificacao: resultado.classificacao === 'PERMANENTE' ? 'PERMANENTE' : 'LIMITE_TENTATIVAS' } } });
        falhasPermanentes++;
      } else {
        const mensagem = erroNotificacaoRedigido(new Error(resultado.detalhe ?? resultado.motivo ?? 'Falha transitória.'));
        await prisma.notificacaoMercadoLivre.update({ where: { id: evento.id }, data: { status: 'AGUARDANDO', leaseExpiraEm: null, proximaExecucaoEm: new Date(Date.now() + backoffNotificacaoMs(tentativa)), ultimoErro: { mensagem, tentativa } } });
        retentativas++;
      }
    } catch (err) {
      const mensagem = erroNotificacaoRedigido(err);
      const permanente = tentativa >= MAX_TENTATIVAS_NOTIFICACAO_ML || (err instanceof ErroDeNegocio && classificarFalhaNotificacaoML(err.status) === 'PERMANENTE');
      await prisma.notificacaoMercadoLivre.update({ where: { id: evento.id }, data: permanente
        ? { status: 'FALHA_PERMANENTE', leaseExpiraEm: null, finalizadaEm: new Date(), ultimoErro: { mensagem, tentativa, classificacao: 'PERMANENTE' } }
        : { status: 'AGUARDANDO', leaseExpiraEm: null, proximaExecucaoEm: new Date(Date.now() + backoffNotificacaoMs(tentativa)), ultimoErro: { mensagem, tentativa, classificacao: 'TRANSITORIO' } } });
      if (permanente) falhasPermanentes++;
      else retentativas++;
    }
  }
  return { processadas, ignoradas, falhasPermanentes, retentativas, recuperadas: recuperadas.count };
}

/**
 * Filial ATIVA mais antiga da empresa — convenção do webhook: a matriz criada
 * no onboarding. `IntegracaoExterno` não guarda filial; sem esta convenção o
 * pedido não teria estoque/caixa para onde importar.
 */
async function filialPadraoDaEmpresa(empresaId: string) {
  return prisma.filial.findFirst({
    where: { empresaId, status: 'ATIVO' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, fusoHorario: true },
  });
}

/**
 * Operador de referência para `Importacao`/`Auditoria`: o webhook não tem
 * sessão, mas `Importacao.usuarioId` é FK obrigatória. Usa o usuário ATIVO
 * mais antigo da empresa (o dono do cadastro).
 */
async function operadorPadraoDaEmpresa(empresaId: string) {
  return prisma.usuario.findFirst({
    where: { empresaId, status: 'ATIVO' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
}

/**
 * Processa UMA notificação do ML: dedupe → identificação da empresa →
 * re-consulta autenticada → importação com idempotência.
 *
 * Payloads fora do escopo/contas sem conexão viram `processada: false` com
 * motivo. Falhas transitórias são marcadas como rejeitadas na chave; o worker
 * reexecuta a mesma notificação após backoff.
 */
export async function processarNotificacaoML(notificacao: NotificacaoML): Promise<ResultadoNotificacaoML> {
  const recurso = String(notificacao.resource ?? '').trim();
  const topic = String(notificacao.topic ?? '').trim().toLowerCase();
  const userId = String(notificacao.user_id ?? '').trim();
  const pedido = /^\/orders\/(\d+)$/.exec(recurso);
  const pagamento = /^\/collections\/(\d+)$/.exec(recurso);
  const anuncio = /^\/items\/([A-Za-z0-9]+)$/.exec(recurso);

  if (!userId || (!pedido && !pagamento && !anuncio)) {
    return { classificacao: 'IGNORADO', processada: false, motivo: 'Recurso ou user_id ausentes/irreconhecíveis.' };
  }
  const ehPedido = (Boolean(pedido) && TOPICOS_DE_PEDIDO.has(topic))
    || (Boolean(pagamento) && topic === 'payments');
  const ehAnuncio = Boolean(anuncio) && TOPICOS_DE_ITEM.has(topic);
  if (!ehPedido && !ehAnuncio) {
    return { classificacao: 'IGNORADO', processada: false, motivo: `Tópico "${topic}" fora do escopo de sincronização.` };
  }

  const cadastro = await prisma.integracaoExterno.findFirst({
    where: { tipo: 'MERCADO_LIVRE', accountId: userId, status: 'CONECTADO' },
    select: { id: true, empresaId: true },
  });
  if (!cadastro) {
    return { classificacao: 'IGNORADO', processada: false, motivo: 'Nenhuma conta CONECTADA corresponde ao user_id (empresa desconhecida ou desconectada).' };
  }
  const filial = await filialPadraoDaEmpresa(cadastro.empresaId);
  if (!filial) return { classificacao: 'PERMANENTE', processada: false, motivo: 'Empresa sem filial ativa: não há destino para importar.' };
  const operador = await operadorPadraoDaEmpresa(cadastro.empresaId);
  if (!operador) return { classificacao: 'PERMANENTE', processada: false, motivo: 'Empresa sem usuário ativo para registrar a importação.' };

  // O ID do evento (ou timestamp oficial) permite processar mudanças futuras
  // do mesmo recurso sem repetir o mesmo evento.
  const key = `ml:notificacao:${eventKeyDaNotificacao(notificacao)}`;
  let aquisicao = await adquirirIdempotencia({
    key,
    empresaId: cadastro.empresaId,
    filialId: filial.id,
    operadorId: operador.id,
  });
  // A primeira tentativa pode falhar antes de produzir efeitos e deixar a
  // chave REJEITADA. Essa situação deve permitir o retry da fila com a mesma
  // chave; tratá-la como duplicata confirmada encerraria a notificação sem
  // executar novamente a operação esperada.
  if (aquisicao.duplicada && aquisicao.status === 'REJEITADA') {
    await prisma.idempotencyKey.delete({ where: { id: aquisicao.id } });
    aquisicao = await adquirirIdempotencia({
      key,
      empresaId: cadastro.empresaId,
      filialId: filial.id,
      operadorId: operador.id,
    });
  }
  if (aquisicao.duplicada) {
    return { classificacao: 'PROCESSADO', processada: true, motivo: `Notificação duplicada (status ${aquisicao.status}).` };
  }

  try {
    if (ehPedido && (pedido || pagamento)) {
      let pedidoId = pedido?.[1] ?? null;
      if (pagamento) {
        const respostaPagamento = await chamarML(cadastro.empresaId, cadastro.id, 'GET', `/collections/${pagamento[1]}`);
        if (!respostaPagamento.ok) {
          throw new ErroDeNegocio(`Falha ao reconsultar o pagamento ${pagamento[1]} (HTTP ${respostaPagamento.status}).`, 502);
        }
        const orderId = (respostaPagamento.dados as { order_id?: number | string | null } | null)?.order_id;
        pedidoId = orderId == null ? null : String(orderId);
      }
      if (!pedidoId) {
        await concluirIdempotencia(aquisicao.id, {
          status: 'REJEITADA', responseStatus: 206,
          responseBody: { recurso, motivo: 'pagamento sem order_id; rotina periódica fará a reconciliação' },
        });
        return { classificacao: 'IGNORADO', processada: false, motivo: 'Pagamento sem pedido associado; será recuperado pela sincronização periódica.' };
      }
      const resposta = await chamarML(cadastro.empresaId, cadastro.id, 'GET', `/orders/${pedidoId}`);
      if (!resposta.ok) {
        throw new ErroDeNegocio(`Falha ao re-consultar o pedido ${pedidoId} (HTTP ${resposta.status}).`, 502);
      }
      const order = resposta.dados as OrderML | null;
      if (!order || !Array.isArray(order.order_items) || order.order_items.length === 0) {
        // HTTP 206/Partial Content: corpo incompleto — sem inventar dados;
        // REJEITADA libera a retentativa do ML com a mesma chave.
        await concluirIdempotencia(aquisicao.id, {
          status: 'REJEITADA', responseStatus: 206, responseBody: { recurso, motivo: 'corpo incompleto' },
        });
        return { classificacao: 'TRANSITORIO', processada: false, motivo: 'Corpo do pedido incompleto (206/parcial): liberado para retentativa.', detalhe: 'Corpo do pedido incompleto (206/parcial).' };
      }
      const desfecho = await importarPedidoML({
        empresaId: cadastro.empresaId,
        cadastroId: cadastro.id,
        filialId: filial.id,
        fusoHorario: filial.fusoHorario,
        usuarioId: operador.id,
        order,
      });
      if (desfecho.acao === 'moedaNaoSuportada' || desfecho.acao === 'semVinculoProduto') {
        await concluirIdempotencia(aquisicao.id, {
          status: 'REJEITADA', responseStatus: 422,
          responseBody: { recurso, acao: desfecho.acao, detalhe: desfecho.detalhe },
        });
        return { classificacao: desfecho.acao === 'moedaNaoSuportada' ? 'IGNORADO' : 'PERMANENTE', processada: false, motivo: desfecho.detalhe ?? desfecho.acao };
      }
      if (desfecho.acao === 'semItens' || desfecho.acao === 'erro') {
        await concluirIdempotencia(aquisicao.id, {
          status: 'REJEITADA', responseStatus: 502,
          responseBody: { recurso, acao: desfecho.acao, detalhe: desfecho.detalhe },
        });
        return { classificacao: 'TRANSITORIO', processada: false, detalhe: desfecho.detalhe ?? 'Falha transitória ao importar o pedido.' };
      }
      await concluirIdempotencia(aquisicao.id, {
        status: 'CONFIRMADA', vendaId: desfecho.vendaId, responseStatus: 200,
        responseBody: { recurso, acao: desfecho.acao },
      });
      return { classificacao: 'PROCESSADO', processada: true, motivo: `Pedido ${pedidoId} importado (${desfecho.acao}).` };
    }
    if (ehAnuncio && anuncio) {
      const anuncioId = anuncio[1];
      const resposta = await chamarML(cadastro.empresaId, cadastro.id, 'GET', `/items/${anuncioId}`);
      if (!resposta.ok) {
        throw new ErroDeNegocio(`Falha ao re-consultar o anúncio ${anuncioId} (HTTP ${resposta.status}).`, 502);
      }
      const relatorio: RelatorioItemProduto[] = [];
      await espelharAnuncioNoInterno(cadastro.empresaId, resposta.dados as ItemML, relatorio);
      if (relatorio.some((item) => item.acao === 'erro')) {
        await concluirIdempotencia(aquisicao.id, {
          status: 'REJEITADA', responseStatus: 422, responseBody: { recurso, relatorio },
        });
        return { classificacao: 'PERMANENTE', processada: false, motivo: relatorio.find((item) => item.acao === 'erro')?.detalhe ?? 'Anúncio sem dados suficientes para espelhamento.' };
      }
      await concluirIdempotencia(aquisicao.id, {
        status: 'CONFIRMADA', responseStatus: 200, responseBody: { recurso, relatorio },
      });
      return { classificacao: 'PROCESSADO', processada: true, motivo: `Anúncio ${anuncioId} espelhado (${relatorio[0]?.acao ?? 'semAlteracao'}).` };
    }
    return { classificacao: 'IGNORADO', processada: false, motivo: 'Combinação recurso/tópico não tratada.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha ao processar a notificação.';
    await concluirIdempotencia(aquisicao.id, {
      status: 'REJEITADA', responseStatus: 502, responseBody: { recurso, erro: msg },
    }).catch(() => undefined);
    const classificacao = classificarFalhaNotificacaoML(err instanceof ErroDeNegocio ? err.status : undefined);
    return { classificacao, processada: false, detalhe: msg };
  }
}
