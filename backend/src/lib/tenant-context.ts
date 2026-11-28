import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de empresa (tenant) da execução atual.
 *
 * É o que o backend informa ao Postgres em cada operação (via `set_config`,
 * ver `lib/prisma.ts`) para que as policies de RLS saibam qual empresa está
 * operando. A origem do `empresaId` é SEMPRE o valor revalidado no banco pelo
 * middleware de autenticação, nunca algo enviado pelo cliente.
 *
 * Escopos:
 *  - 'nenhum'  : requisição ainda não autenticada. Nenhum contexto é enviado ao
 *                banco; com o papel `nexus_app` as tabelas protegidas retornam
 *                0 linhas.
 *  - 'tenant'  : usuário autenticado (ou job processando uma empresa).
 *  - 'sistema' : operações legítimas sem empresa definida (login, cadastro de
 *                empresa, recuperação de senha, validação de chave de API,
 *                webhooks, agendadores). Use só em código do servidor, nunca
 *                com base em entrada do cliente. Sempre com um `motivo`, para
 *                auditoria.
 */
export type EscopoTenant = 'nenhum' | 'tenant' | 'sistema' | 'consumidor';

export type ContextoTenant = {
  escopo: EscopoTenant;
  empresaId?: string;
  usuarioId?: string;
  /**
   * NEXUS CLUB: conta do consumidor autenticado (`app.consumidor_id` no banco). No escopo
   * 'consumidor' só ela vale: a pessoa enxerga a própria conta e o que é dela (regras da Fase 2).
   */
  consumidorId?: string;
  motivo?: string;
  /** Transação interativa aberta pelo wrapper de `lib/prisma.ts` (uso interno). */
  tx?: unknown;
};

const armazenamento = new AsyncLocalStorage<ContextoTenant>();

export function contextoAtual(): ContextoTenant | undefined {
  return armazenamento.getStore();
}

/**
 * Executa `fn` com um contexto próprio (não herda nem altera o contexto externo).
 * Aguarda o resultado DENTRO do contexto (ver nota sobre PrismaPromise abaixo).
 */
export function executarComContexto<T>(ctx: ContextoTenant, fn: () => T | PromiseLike<T>): Promise<T> {
  return armazenamento.run(ctx, async () => await fn());
}

/*
 * IMPORTANTE: as PrismaPromises são preguiçosas — só executam quando alguém
 * chama `.then`. Por isso `comTenant`/`comoSistema` AGUARDAM o resultado de
 * `fn` dentro do contexto: `comoSistema('x', () => prisma.y.findFirst())`
 * executa a consulta no escopo certo. (Devolver a promise sem aguardar faria a
 * consulta rodar depois, já fora do contexto.)
 */

/** Executa `fn` no contexto da empresa informada (jobs, scripts, testes). */
export function comTenant<T>(empresaId: string, fn: () => T | PromiseLike<T>, usuarioId?: string): Promise<T> {
  if (!empresaId) return Promise.reject(new Error('comTenant: empresaId obrigatório.'));
  return armazenamento.run({ escopo: 'tenant', empresaId, usuarioId }, async () => await fn());
}

/** Executa `fn` em escopo de sistema (sem empresa). Ver comentário do tipo. */
export function comoSistema<T>(motivo: string, fn: () => T | PromiseLike<T>): Promise<T> {
  return armazenamento.run({ escopo: 'sistema', motivo }, async () => await fn());
}

/**
 * Abre o contexto de uma requisição HTTP (hook `onRequest`, estilo callback,
 * para que o contexto se propague por todo o ciclo da requisição).
 */
export function abrirContextoRequisicao(done: () => void): void {
  armazenamento.run({ escopo: 'nenhum' }, done);
}

/**
 * Marca a requisição atual (rota pública: login, cadastro de empresa,
 * recuperação de senha, callbacks OAuth, webhooks) como escopo de sistema.
 * Chame no início do handler; nunca com base em algo enviado pelo cliente.
 */
export function definirSistemaDaRequisicao(motivo: string): void {
  const ctx = armazenamento.getStore();
  if (!ctx) return;
  ctx.escopo = 'sistema';
  ctx.motivo = motivo;
  ctx.empresaId = undefined;
  ctx.usuarioId = undefined;
  ctx.consumidorId = undefined;
}

/** Marca a requisição atual como autenticada para a empresa/usuário validados. */
export function definirTenantDaRequisicao(empresaId: string, usuarioId: string): void {
  const ctx = armazenamento.getStore();
  if (!ctx) return; // fora de uma requisição (ex.: teste chamando o handler direto)
  ctx.escopo = 'tenant';
  ctx.empresaId = empresaId;
  ctx.usuarioId = usuarioId;
  ctx.consumidorId = undefined;
  ctx.motivo = undefined;
}

/**
 * NEXUS CLUB: marca a requisição atual como do consumidor validado (rotas /club). Ele não
 * enxerga nada das empresas: só a própria conta e o que é dele (regras da Fase 2).
 */
export function definirConsumidorDaRequisicao(consumidorId: string): void {
  const ctx = armazenamento.getStore();
  if (!ctx) return;
  ctx.escopo = 'consumidor';
  ctx.consumidorId = consumidorId;
  ctx.empresaId = undefined;
  ctx.usuarioId = undefined;
  ctx.motivo = undefined;
}

/** Executa `fn` como o consumidor (fora de requisição: testes, tarefas). */
export function comConsumidor<T>(consumidorId: string, fn: () => T | PromiseLike<T>): Promise<T> {
  if (!consumidorId) return Promise.reject(new Error('comConsumidor: consumidorId obrigatório.'));
  return armazenamento.run({ escopo: 'consumidor', consumidorId }, async () => await fn());
}
