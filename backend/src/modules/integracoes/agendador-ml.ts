/**
 * AGENDADOR PERSISTENTE DE SINCRONIZAÇÃO — MERCADO LIVRE
 * =====================================================
 *
 * Por que NÃO `setInterval` em memória: o estado real da sincronização vive
 * na tabela `SincronizacaoTarefa` (migration 202610130900). O timer daqui é
 * apenas o "despertador" de cada processo — ele só decide QUANDO olhar o
 * banco. Reinicialização não perde nada (tarefa vencida permanece vencida no
 * banco e o próximo tick a executa) e múltiplas instâncias convivem: a tomada
 * de execução é um `updateMany` condicional atômico (linhas abaixo).
 *
 * Ciclo de vida de uma tarefa (estado em `status`):
 *
 *   AGUARDANDO ──(vencida + tomada por updateMany)──▶ EXECUTANDO
 *        ▲                                               │
 *        │   sucesso → reagenda (período da tarefa)       │
 *        │   falha transitória → backoff exponencial      │
 *        │   falha permanente → PAUSADA                  │
 *        └───────────────────────────────────────────────┘
 *   PAUSADA ──(conta reconectada / provisionar com reativar)──▶ AGUARDANDO
 *
 *   EXECUTANDO com leaseExpiraEm vencido (processo caiu) → qualquer tick
 *   desengata e incrementa `recuperadas` (recuperação pós-restart).
 *
 * Cobertura funcional (mesmos serviços do sync manual — nenhuma lógica
 * duplicada): produtos/anúncios, estoque (empurra saldo NEXUS→ML) e pedidos
 * (importação idempotente). Notificações do webhook passam por cima destes
 * caminhos; eventos perdidos no webhook são recuperados justamente pela
 * reconsulta periódica destes mesmos serviços (dedupe garantido por
 * IdempotencyKey/Venda.idempotencyKey, não pelo agendador).
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ErroDeNegocio } from '../../lib/erros.js';
import {
  executarComTravaDeSync,
  sincronizarProdutos,
  sincronizarEstoque,
  sincronizarPedidos,
} from './mercadolivre-sync.service.js';

export type TipoTarefaML = 'MERCADO_LIVRE_PRODUTOS' | 'MERCADO_LIVRE_ESTOQUE' | 'MERCADO_LIVRE_PEDIDOS';

const TIPOS_TAREFA: TipoTarefaML[] = ['MERCADO_LIVRE_PRODUTOS', 'MERCADO_LIVRE_ESTOQUE', 'MERCADO_LIVRE_PEDIDOS'];

/** Identidade estável do processo atual (trava de lease + diagnóstico). */
const INSTANCIA_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

/** Lê uma env numérica inteira >= 0; inválida/negativa volta ao padrão. */
function envInteiro(chave: string, padrao: number): number {
  const bruto = Number(process.env[chave]);
  return Number.isFinite(bruto) && bruto >= 0 ? Math.floor(bruto) : padrao;
}

/**
 * Períodos operacionais (minutos). 0 = executar no próximo tick (usado em
 * testes; em produção 0 faria o ciclo completo a cada tick — a API do ML tem
 * rate limit e o `chamarML` já faz retry/backoff, mas desperdiça cota).
 *
 * Defaults (necessidades operacionais + limites da API):
 *  - pedidos: 5 min   — oportunidade de venda exige reatividade
 *  - estoque: 15 min  — divergência de saldo é resolvida pela ETAPA 3
 *  - produtos: 6 h    — catálogo muda pouco; economiza cota de requisições
 */
export function periodosML(): { produtosMin: number; estoqueMin: number; pedidosMin: number } {
  return {
    produtosMin: envInteiro('ML_SYNC_PRODUTOS_MIN', 360),
    estoqueMin: envInteiro('ML_SYNC_ESTOQUE_MIN', 15),
    pedidosMin: envInteiro('ML_SYNC_PEDIDOS_MIN', 5),
  };
}

function periodoDoTipo(tipo: TipoTarefaML): number {
  const p = periodosML();
  if (tipo === 'MERCADO_LIVRE_PRODUTOS') return p.produtosMin;
  if (tipo === 'MERCADO_LIVRE_ESTOQUE') return p.estoqueMin;
  return p.pedidosMin;
}

/** Backoff exponencial: base * 2^(tentativa-1), teto (cap) + jitter ±20%. */
function backoffMs(tentativa: number): number {
  const baseS = envInteiro('ML_SYNC_BACKOFF_BASE_S', 30);
  const capMin = envInteiro('ML_SYNC_BACKOFF_MAX_MIN', 60);
  const crescido = baseS * 1000 * 2 ** Math.max(0, tentativa - 1);
  const comTeto = Math.min(crescido, capMin * 60_000);
  const jitter = comTeto * 0.2 * (Math.random() * 2 - 1);
  return Math.max(1_000, Math.round(comTeto + jitter));
}

/**
 * Mensagem de erro REDIGIDA para persistir: apenas texto curto vindo de
 * código da aplicação, com padrões de credencial mascarados por garantia.
 * Nunca grava token, cabeçalho, corpo ou URL com query sensível.
 */
function motivoRedigido(err: unknown): string {
  const bruto = err instanceof Error ? err.message : 'Falha inesperada na sincronização.';
  return bruto
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]')
    .replace(/(access_token|refresh_token|client_secret|authorization)=([^\s&"']+)/gi, '$1=[REDACTED]')
    .slice(0, 300);
}

/**
 * Erro PERMANENTE = condição estrutural que retentar não resolve (conta
 * desconectada, credencial/escopo recusado, filial inexistente). Nesses casos
 * a tarefa vira PAUSADA sem consumir tentativa — reativa quando a conta for
 * reconectada (provisionar com reativar) e nada fica martelando a API.
 * 429/5xx/rede (502/504) são transitórios => backoff.
 */
function ehErroPermanente(err: unknown): boolean {
  if (err instanceof ErroDeNegocio) {
    return err.status === 400 || err.status === 401 || err.status === 403 || err.status === 404;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Provisionamento (tarefas persistidas; nenhum clique manual para existirem)
// ---------------------------------------------------------------------------

/**
 * Garante as 3 tarefas da empresa (upsert idempotente por
 * `@@unique(empresaId, tipo)`).
 *
 * - Nunca reescreve uma agenda existente (`update: {}`): preserva lease,
 *   backoff e histórico de tentativas de quem já está rodando.
 * - `reativar: true` reativa PAUSADAS e zera tentativas — usado quando a
 *   conta acaba de passar pelo OAuth (reconectar é evidência de novo ciclo).
 */
export async function provisionarTarefasML(empresaId: string, opcoes?: { reativar?: boolean }): Promise<void> {
  const agora = Date.now();
  for (const tipo of TIPOS_TAREFA) {
    const proxima = new Date(agora + periodoDoTipo(tipo) * 60_000);
    await prisma.sincronizacaoTarefa.upsert({
      where: { empresaId_tipo: { empresaId, tipo } },
      create: { empresaId, tipo, proximaExecucaoEm: proxima },
      update: opcoes?.reativar
        ? { status: 'AGUARDANDO', proximaExecucaoEm: proxima, tentativas: 0, ultimoErro: Prisma.JsonNull, createdAt: new Date(agora) }
        : {},
    });
  }
}

/**
 * Bootstrap automático: provisiona tarefas para TODAS as contas ML
 * CONECTADAS (independente de clique). Chamado na inicialização do backend —
 * é o que garante "sincronização que não depende de interação manual".
 */
export async function provisionarTarefasDeContasConectadas(): Promise<number> {
  const contas = await prisma.integracaoExterno.findMany({
    where: { tipo: 'MERCADO_LIVRE', status: 'CONECTADO' },
    select: { empresaId: true },
    distinct: ['empresaId'],
  });
  for (const conta of contas) {
    await provisionarTarefasML(conta.empresaId);
  }
  return contas.length;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

/** Operador de referência para Importacao.usuarioId (mesma convenção do webhook). */
async function operadorReferencia(empresaId: string): Promise<{ id: string } | null> {
  return prisma.usuario.findFirst({
    where: { empresaId, status: 'ATIVO' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
}

/** Filial de referência (mesma convenção do webhook: ATIVA mais antiga). */
async function filialReferencia(empresaId: string): Promise<{ id: string } | null> {
  return prisma.filial.findFirst({
    where: { empresaId, status: 'ATIVO' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
}

async function pausarTarefa(tarefaId: string, motivo: string): Promise<void> {
  await prisma.sincronizacaoTarefa.update({
    where: { id: tarefaId },
    data: {
      status: 'PAUSADA',
      ultimoErro: { motivo, em: new Date().toISOString() },
      leaseExpiraEm: null,
      instanciaId: null,
    },
  });
}

async function reagendarComSucesso(
  tarefaId: string,
  tipo: TipoTarefaML,
  processados: number,
  falhas: number,
): Promise<void> {
  await prisma.sincronizacaoTarefa.update({
    where: { id: tarefaId },
    data: {
      status: 'AGUARDANDO',
      proximaExecucaoEm: new Date(Date.now() + periodoDoTipo(tipo) * 60_000),
      tentativas: 0,
      ultimoErro: Prisma.JsonNull,
      ultimoSucessoEm: new Date(),
      processadosUltima: processados,
      falhasUltima: falhas,
      leaseExpiraEm: null,
      instanciaId: null,
    },
  });
}

async function reagendarComErro(
  tarefaId: string,
  err: unknown,
  tentativa: number,
  falhas: number,
): Promise<void> {
  const permanente = ehErroPermanente(err);
  const motivo = motivoRedigido(err);
  if (permanente) {
    await prisma.sincronizacaoTarefa.update({
      where: { id: tarefaId },
      data: {
        status: 'PAUSADA',
        ultimoErro: { motivo, em: new Date().toISOString(), permanente: true },
        falhasUltima: Math.max(falhas, 1),
        leaseExpiraEm: null,
        instanciaId: null,
      },
    });
    console.warn(`[ml-agendador] tarefa ${tarefaId} PAUSADA (erro permanente): ${motivo}`);
    return;
  }
  await prisma.sincronizacaoTarefa.update({
    where: { id: tarefaId },
    data: {
      status: 'AGUARDANDO',
      proximaExecucaoEm: new Date(Date.now() + backoffMs(tentativa)),
      tentativas: tentativa,
      ultimoErro: { motivo, em: new Date().toISOString() },
      falhasUltima: Math.max(falhas, 1),
      leaseExpiraEm: null,
      instanciaId: null,
    },
  });
  console.warn(`[ml-agendador] tarefa ${tarefaId} retentativa ${tentativa} agendada: ${motivo}`);
}

/** Mede processados/falhas do resultado do serviço pelo tipo da tarefa. */
function medirResultado(
  tipo: TipoTarefaML,
  resultado: unknown,
): { processados: number; falhas: number } {
  const r = resultado as {
    anunciosConsultados?: number;
    anunciosAvaliados?: number;
    pedidosConsultados?: number;
    falhas?: unknown[];
  };
  const falhas = Array.isArray(r?.falhas) ? r.falhas.length : 0;
  if (tipo === 'MERCADO_LIVRE_PRODUTOS') return { processados: r?.anunciosConsultados ?? 0, falhas };
  if (tipo === 'MERCADO_LIVRE_ESTOQUE') return { processados: r?.anunciosAvaliados ?? 0, falhas };
  return { processados: r?.pedidosConsultados ?? 0, falhas };
}

/**
 * Executa UMA tarefa vencida.
 *
 * TRAVA ATÔMICA (multi-instância): o `updateMany` condicional
 * (id + AGUARDANDO + vencida → EXECUTANDO) vale um row-lock do PostgreSQL —
 * de duas instâncias concorrentes, exatamente UMA recebe count=1; a outra
 * desiste sem sequer tentar (não duplica requisição à API nem duplica
 * escrita). A trava em processo de `executarComTravaDeSync` adiciona a
 * segunda camada para o caso de o agendador colidir com um sync MANUAL em
 * andamento (mesma empresa+operação => a mesma promise é compartilhada).
 *
 * Nunca lança: toda falha vira backoff/pausa registrados na própria linha.
 */
async function executarTarefa(tarefa: {
  id: string;
  empresaId: string;
  tipo: TipoTarefaML;
  tentativas: number;
}): Promise<boolean> {
  const agora = new Date();
  const leaseMin = envInteiro('ML_SYNC_LEASE_MIN', 15);
  const tomada = await prisma.sincronizacaoTarefa.updateMany({
    where: { id: tarefa.id, status: 'AGUARDANDO', proximaExecucaoEm: { lte: agora } },
    data: {
      status: 'EXECUTANDO',
      ultimaExecucaoEm: agora,
      leaseExpiraEm: new Date(Date.now() + Math.max(leaseMin, 1) * 60_000),
      instanciaId: INSTANCIA_ID,
    },
  });
  if (tomada.count !== 1) return false; // outra instância venceu a corrida

  try {
    // Conta sem conexão (ou sem accountId) => pausa sem martelar a API e sem
    // consumir tentativa: condição estrutural, não falha transitória.
    const cadastro = await prisma.integracaoExterno.findFirst({
      where: { empresaId: tarefa.empresaId, tipo: 'MERCADO_LIVRE', status: 'CONECTADO' },
      select: { accountId: true },
    });
    if (!cadastro || !cadastro.accountId) {
      await pausarTarefa(tarefa.id, 'Conta Mercado Livre desconectada. Reconecte na Central de Integrações.');
      return true;
    }
    const operador = await operadorReferencia(tarefa.empresaId);
    if (!operador) {
      await pausarTarefa(tarefa.id, 'Sem usuário ativo na empresa para registrar a importação.');
      return true;
    }

    const resultado = await executarComTravaDeSync(tarefa.empresaId, tarefa.tipo, async () => {
      if (tarefa.tipo === 'MERCADO_LIVRE_PRODUTOS') {
        return sincronizarProdutos({ empresaId: tarefa.empresaId, usuarioId: operador.id });
      }
      const filial = await filialReferencia(tarefa.empresaId);
      if (!filial) {
        throw new ErroDeNegocio('Filial não encontrada ou inativa.', 404);
      }
      if (tarefa.tipo === 'MERCADO_LIVRE_ESTOQUE') {
        return sincronizarEstoque({ empresaId: tarefa.empresaId, usuarioId: operador.id, filialId: filial.id });
      }
      return sincronizarPedidos({ empresaId: tarefa.empresaId, usuarioId: operador.id, filialId: filial.id });
    });

    const { processados, falhas } = medirResultado(tarefa.tipo, resultado);
    await reagendarComSucesso(tarefa.id, tarefa.tipo, processados, falhas);
    return true;
  } catch (err) {
    try {
      await reagendarComErro(tarefa.id, err, tarefa.tentativas + 1, 0);
    } catch (falhaDeGravacao) {
      // Última linha de defesa: libera a execução para não ficar presa em
      // EXECUTANDO até expirar o lease (a recuperação por lease cobriria,
      // mas evitamos a espera desnecessária).
      console.error(`[ml-agendador] falha ao registrar erro da tarefa ${tarefa.id}:`, falhaDeGravacao);
      await prisma.sincronizacaoTarefa
        .update({ where: { id: tarefa.id }, data: { status: 'AGUARDANDO', leaseExpiraEm: null, instanciaId: null } })
        .catch(() => undefined);
    }
    return true;
  }
}

export interface ResumoTick {
  /** Execuções órfãs desengatadas (lease vencido = processo caiu antes). */
  desengatadas: number;
  /** Tarefas vencidas encontradas no banco (após desengatar). */
  candidatas: number;
  /** Tarefas vencidas que ESTA instância tomou e executou. */
  execucoes: number;
}

/**
 * Um "tick" do agendador: 100% orientado ao banco (sem estado em memória).
 *
 * 1) DESENGATA ÓRFÃS: EXECUTANDO com lease vencido volta a AGUARDANDO com
 *    `proximaExecucaoEm = agora` (execução imediata — era trabalho devido
 *    quando o processo caiu) e incrementa `recuperadas`; é assim que o
 *    restart recupera trabalho interrompido sem duplicar (a idempotência
 *    dos serviços cobre o overlap).
 * 2) Busca até 10 tarefas AGUARDANDO vencidas (fila por proximaExecucaoEm).
 * 3) Executa cada uma sob a trava atômica (só 1 vence por tarefa).
 *
 * Exportada para os testes: o ciclo real do timer chama exatamente esta
 * função — mesma linha de código, mesma semântica.
 */
export async function executarTickML(opcoes?: { empresaIds?: string[] }): Promise<ResumoTick> {
  // Escopo opcional de empresa: usado pelos testes para isolar o mundo do
  // teste quando vários arquivos rodam em paralelo no mesmo banco. O loop
  // real (ciclo) NÃO passa filtro — em produção o tick é global de propósito.
  const escopo = opcoes?.empresaIds?.length ? { empresaId: { in: opcoes.empresaIds } } : {};
  const agora = new Date();
  const desengatadas = await prisma.sincronizacaoTarefa.updateMany({
    where: { status: 'EXECUTANDO', leaseExpiraEm: { lt: agora }, ...escopo },
    data: {
      status: 'AGUARDANDO',
      proximaExecucaoEm: agora,
      leaseExpiraEm: null,
      instanciaId: null,
      recuperadas: { increment: 1 },
    },
  });
  const candidatas = await prisma.sincronizacaoTarefa.findMany({
    where: { status: 'AGUARDANDO', proximaExecucaoEm: { lte: agora }, ...escopo },
    orderBy: { proximaExecucaoEm: 'asc' },
    take: 10,
    select: { id: true, empresaId: true, tipo: true, tentativas: true },
  });
  let execucoes = 0;
  for (const tarefa of candidatas) {
    const executou = await executarTarefa(tarefa as { id: string; empresaId: string; tipo: TipoTarefaML; tentativas: number });
    if (executou) execucoes++;
  }
  return { desengatadas: desengatadas.count, candidatas: candidatas.length, execucoes };
}

// ---------------------------------------------------------------------------
// Loop do processo (despertador do banco — NÃO é a fonte de verdade)
// ---------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null;
let rodando = false;
let inicializacaoEmAndamento: Promise<void> | null = null;
let cicloEmAndamento: Promise<void> | null = null;

function agendarProximoCiclo(): void {
  if (!rodando) return;
  timer = setTimeout(() => {
    timer = null;
    const execucao = ciclo();
    cicloEmAndamento = execucao;
    void execucao.finally(() => {
      if (cicloEmAndamento === execucao) cicloEmAndamento = null;
    });
  }, proximoIntervaloMs());
}

/**
 * Intervalo do próximo despertar com jitter (evita thundering herd quando
 * várias instâncias sobem juntas). `setTimeout` RECURSIVO (nunca setInterval:
 * nenhum tick se sobrepõe ao anterior — o próximo só é agendado quando o
 * atual termina).
 */
function proximoIntervaloMs(): number {
  const base = Math.max(1_000, envInteiro('ML_SYNC_TICK_MS', 30_000));
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(1_000, Math.round(base + jitter));
}

async function ciclo(): Promise<void> {
  try {
    const { executarFilaNotificacoesML } = await import('./mercadolivre-notificacoes.service.js');
    const fila = await executarFilaNotificacoesML();
    if (fila.processadas > 0 || fila.ignoradas > 0 || fila.falhasPermanentes > 0 || fila.retentativas > 0 || fila.recuperadas > 0) {
      console.log(`[ml-agendador] fila de webhooks: ${JSON.stringify(fila)}`);
    }
    const resumo = await executarTickML();
    if (resumo.execucoes > 0 || resumo.desengatadas > 0) {
      console.log(`[ml-agendador] tick: ${JSON.stringify(resumo)}`);
    }
  } catch (err) {
    // O loop NÃO morre por um erro do tick (ex.: banco reiniciando).
    console.error('[ml-agendador] tick falhou (próxima tentativa no próximo ciclo):', err);
  } finally {
    agendarProximoCiclo();
  }
}

/**
 * Inicialização chamada pelo server.ts:
 *  1) provisiona tarefas das contas já CONECTADAS (autostart pós-restart);
 *  2) inicia o despertador recursivo.
 * Desabilitável com ML_SYNC_AUTO=false (infra desligada sem mudar código).
 */
async function iniciarAgendadorMLInterno(): Promise<void> {
  if (process.env.ML_SYNC_AUTO === 'false') {
    console.log('[ml-agendador] desabilitado via ML_SYNC_AUTO=false.');
    return;
  }
  if (rodando) return;
  try {
    const contas = await provisionarTarefasDeContasConectadas();
    console.log(`[ml-agendador] iniciado (instancia ${INSTANCIA_ID}, ${contas} conta(s) conectada(s) provisionada(s)).`);
  } catch (err) {
    // Sem banco no boot: loga e inicia mesmo assim — tarefas JÁ existentes
    // continuam executando normalmente pelo tick.
    console.error('[ml-agendador] provisionamento de boot falhou:', err);
  }
  rodando = true;
  agendarProximoCiclo();
}

export function iniciarAgendadorML(): Promise<void> {
  if (rodando) return Promise.resolve();
  if (inicializacaoEmAndamento) return inicializacaoEmAndamento;
  const inicializacao = iniciarAgendadorMLInterno();
  inicializacaoEmAndamento = inicializacao;
  void inicializacao.finally(() => {
    if (inicializacaoEmAndamento === inicializacao) inicializacaoEmAndamento = null;
  });
  return inicializacao;
}

/** Para novas execuções e aguarda o ciclo atual antes da desconexão do Prisma. */
export async function pararAgendadorML(): Promise<void> {
  rodando = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  // A inicialização consulta o banco antes de marcar `rodando`; espere-a e
  // cancele novamente para cobrir SIGTERM durante o provisionamento do boot.
  await inicializacaoEmAndamento;
  rodando = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await cicloEmAndamento;
}

// ---------------------------------------------------------------------------
// Observabilidade (rota GET .../sync/agendamento — por empresa, sem segredos)
// ---------------------------------------------------------------------------

export interface EstadoAgendamentoML {
  ativo: boolean;
  instancia: string;
  periodos: { produtosMin: number; estoqueMin: number; pedidosMin: number };
  resumo: { pendentes: number; executando: number; pausadas: number; comFalha: number; recuperadas: number };
  tarefas: Array<{
    tipo: TipoTarefaML;
    status: string;
    proximaExecucaoEm: Date;
    ultimaExecucaoEm: Date | null;
    ultimoSucessoEm: Date | null;
    tentativas: number;
    recuperadas: number;
    processadosUltima: number;
    falhasUltima: number;
    ultimoErro: unknown;
  }>;
}

/** Consulta agregada da sincronização da EMPRESA (isolamento por query). */
export async function consultarAgendamentoML(empresaId: string): Promise<EstadoAgendamentoML> {
  const tarefas = await prisma.sincronizacaoTarefa.findMany({
    where: { empresaId },
    orderBy: { tipo: 'asc' },
    select: {
      tipo: true,
      status: true,
      proximaExecucaoEm: true,
      ultimaExecucaoEm: true,
      ultimoSucessoEm: true,
      tentativas: true,
      recuperadas: true,
      processadosUltima: true,
      falhasUltima: true,
      ultimoErro: true,
    },
  });
  const resumo = {
    pendentes: tarefas.filter((t) => t.status === 'AGUARDANDO').length,
    executando: tarefas.filter((t) => t.status === 'EXECUTANDO').length,
    pausadas: tarefas.filter((t) => t.status === 'PAUSADA').length,
    comFalha: tarefas.filter((t) => t.tentativas > 0).length,
    recuperadas: tarefas.reduce((acc, t) => acc + t.recuperadas, 0),
  };
  return {
    ativo: process.env.ML_SYNC_AUTO !== 'false',
    instancia: INSTANCIA_ID,
    periodos: periodosML(),
    resumo,
    tarefas: tarefas.map((t) => ({
      ...t,
      tipo: t.tipo as TipoTarefaML, // coluna String no banco; contrato do DTO é a união
      // `ultimoErro` já nasce redigido; normalizar aqui é garantia extra
      // (só motivo/em/permanente chegam ao cliente — nunca segredo).
      ultimoErro: normalizarErroObservavel(t.ultimoErro),
    })),
  };
}

function normalizarErroObservavel(valor: unknown): unknown {
  if (!valor || typeof valor !== 'object') return null;
  const v = valor as Record<string, unknown>;
  const motivo = typeof v.motivo === 'string' ? v.motivo.slice(0, 300) : 'Erro desconhecido.';
  return {
    motivo,
    em: typeof v.em === 'string' ? v.em : null,
    permanente: v.permanente === true,
  };
}




