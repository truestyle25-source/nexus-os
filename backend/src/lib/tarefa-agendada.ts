import { randomUUID } from 'node:crypto';
import { prisma } from './prisma.js';
import { comoSistema } from './tenant-context.js';
import { logDe } from './logger.js';

const log = logDe('tarefa-agendada');

/** Identidade deste processo nas travas (diagnóstico de qual instância executou). */
export const INSTANCIA_ATUAL = `${process.env.RENDER_INSTANCE_ID || process.pid}-${randomUUID().slice(0, 8)}`;

const diaUtc = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Tenta reivindicar a execução DIÁRIA de `nome` para esta instância.
 *
 * Um único comando SQL atômico (INSERT ... ON CONFLICT DO UPDATE ... WHERE):
 * - só reivindica se nenhuma outra instância segura a trava (`leaseExpiraEm` vencido ou nulo);
 * - e se a tarefa ainda não teve SUCESSO hoje (uma execução que falhou pode ser retomada).
 * Com N instâncias disparando no mesmo horário, exatamente uma recebe `true`.
 */
export async function reivindicarExecucaoDiaria(nome: string, leaseMs = 2 * 60 * 60 * 1000, agora = new Date()): Promise<boolean> {
  const dia = diaUtc(agora);
  const inicioDoDia = new Date(`${dia}T00:00:00.000Z`);
  const lease = new Date(agora.getTime() + leaseMs);
  const linhas = await comoSistema(`tarefa:${nome}:reivindicar`, () => prisma.$queryRaw<{ nome: string }[]>`
    INSERT INTO "TarefaAgendada" ("nome", "ultimoDia", "leaseExpiraEm", "instancia", "ultimaExecucaoEm", "updatedAt")
    VALUES (${nome}, ${dia}, ${lease}, ${INSTANCIA_ATUAL}, ${agora}, ${agora})
    ON CONFLICT ("nome") DO UPDATE SET
      "ultimoDia" = EXCLUDED."ultimoDia",
      "leaseExpiraEm" = EXCLUDED."leaseExpiraEm",
      "instancia" = EXCLUDED."instancia",
      "ultimaExecucaoEm" = EXCLUDED."ultimaExecucaoEm",
      "updatedAt" = EXCLUDED."updatedAt"
    WHERE ("TarefaAgendada"."leaseExpiraEm" IS NULL OR "TarefaAgendada"."leaseExpiraEm" < ${agora})
      AND ("TarefaAgendada"."ultimoSucessoEm" IS NULL OR "TarefaAgendada"."ultimoSucessoEm" < ${inicioDoDia})
    RETURNING "nome"`);
  return linhas.length > 0;
}

/** Libera a trava e registra o resultado (sucesso ou a mensagem do erro). */
export async function concluirExecucao(nome: string, resultado: { sucesso: boolean; erro?: string }, agora = new Date()): Promise<void> {
  await comoSistema(`tarefa:${nome}:concluir`, () => prisma.tarefaAgendada.update({
    where: { nome },
    data: {
      leaseExpiraEm: null,
      ...(resultado.sucesso ? { ultimoSucessoEm: agora, ultimoErro: null } : { ultimoErro: (resultado.erro ?? 'erro').slice(0, 1000) }),
    },
  }));
}

/**
 * Executa `tarefa` no máximo uma vez por dia entre TODAS as instâncias.
 * Devolve `executou: false` quando outra instância já fez (ou está fazendo).
 */
export async function executarUmaVezPorDia(nome: string, tarefa: () => Promise<void>): Promise<{ executou: boolean; sucesso?: boolean }> {
  let reivindicou = false;
  try {
    reivindicou = await reivindicarExecucaoDiaria(nome);
  } catch (err) {
    log.error({ err, tarefa: nome, evento: 'tarefa_falhou' }, 'não foi possível reivindicar a tarefa (banco)');
    return { executou: false, sucesso: false };
  }
  if (!reivindicou) {
    log.info({ tarefa: nome, instancia: INSTANCIA_ATUAL }, 'tarefa já executada hoje ou em execução em outra instância; pulando');
    return { executou: false };
  }
  const inicio = Date.now();
  try {
    await tarefa();
    await concluirExecucao(nome, { sucesso: true });
    log.info({ tarefa: nome, duracaoMs: Date.now() - inicio, evento: 'tarefa_concluida' }, 'tarefa diária concluída');
    return { executou: true, sucesso: true };
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    await concluirExecucao(nome, { sucesso: false, erro: mensagem }).catch(() => undefined);
    log.error({ err, tarefa: nome, duracaoMs: Date.now() - inicio, evento: 'tarefa_falhou' }, 'tarefa diária falhou');
    return { executou: true, sucesso: false };
  }
}

/** Tarefas diárias sem sucesso há mais de `limiteHoras` (para o health check e o monitor). */
export async function tarefasAtrasadas(nomes: string[], limiteHoras = 26, agora = new Date()): Promise<string[]> {
  const linhas = await comoSistema('tarefa:atrasadas', () => prisma.tarefaAgendada.findMany({
    where: { nome: { in: nomes } },
    select: { nome: true, ultimoSucessoEm: true },
  }));
  const limite = agora.getTime() - limiteHoras * 60 * 60 * 1000;
  // Tarefa que nunca rodou não conta como atrasada (ex.: servidor recém-publicado).
  return linhas.filter((l) => l.ultimoSucessoEm && l.ultimoSucessoEm.getTime() < limite).map((l) => l.nome);
}
