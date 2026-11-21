/**
 * Agendador embutido do processo backend (fecha DEBITO-TECNICO item 8).
 *
 * Antes: nada disparava `gerarSnapshotDoDia` sozinho — dependia 100% de um
 * cron externo (systemd timer, GitHub Action, cron do provedor de
 * hospedagem) chamando `npm run estoque:snapshot` ou
 * `POST /estoque/snapshot/gerar`. Se ninguém configurasse esse cron, o giro
 * de estoque ficava preso no fallback aproximado para sempre.
 *
 * Desde 2026-11-21 a execução é verificada a cada 15 min e protegida por uma trava
 * no banco (TarefaAgendada): roda UMA vez por dia entre todas as instâncias e é
 * retomada se o processo estava parado no horário (reinício, Render Free dormindo).
 *
 * Antes disso, se `SNAPSHOT_AUTO_ENABLED=true` (padrão), o próprio processo do
 * backend agenda a execução diária via `setTimeout`/`setInterval` — sem
 * dependência nova, sem precisar de cron externo. Isso só funciona enquanto
 * o processo do backend estiver rodando continuamente (não serve para
 * ambientes serverless que hibernam entre requisições — nesse caso, use o
 * cron externo do provedor apontando para o script ou o endpoint, e deixe
 * `SNAPSHOT_AUTO_ENABLED=false` para não haver ambiguidade sobre qual
 * mecanismo está de fato rodando).
 */
import { prisma } from '../lib/prisma.js';
import { gerarSnapshotDoDia } from '../modules/estoque/estoque-indicadores.service.js';
import { fecharExpediente } from '../modules/rh/ponto-fechamento.service.js';
import { executarUmaVezPorDia } from '../lib/tarefa-agendada.js';
import { logDe } from '../lib/logger.js';

const log = logDe('agendador');

/** Nomes das tarefas diárias (chave da trava em TarefaAgendada; usados também pelo /health/ready). */
export const TAREFAS_DIARIAS = ['snapshot-estoque', 'fechamento-expediente'] as const;

/**
 * Fecha o expediente de todas as empresas ativas, marcando as faltas.
 *
 * Roda DEPOIS do snapshot, no mesmo horário: os dois leem o dia anterior e são
 * idempotentes, mas o snapshot de estoque não depende de ponto — se o
 * fechamento falhar, o giro de estoque já foi salvo.
 *
 * Falha de UMA empresa não interrompe as outras; no fim, se alguma falhou, a
 * tarefa é registrada como falha (para o monitor e para ser retomada).
 */
async function fecharExpedientesDeTodasAsEmpresas(): Promise<void> {
  const empresas = await prisma.empresa.findMany({ where: { status: 'ATIVO' }, select: { id: true } });
  let total = 0;
  const falhas: string[] = [];
  for (const empresa of empresas) {
    try {
      const { faltasMarcadas } = await fecharExpediente(empresa.id);
      total += faltasMarcadas;
    } catch (err) {
      falhas.push(empresa.id);
      log.error({ err, empresaId: empresa.id, tarefa: 'fechamento-expediente' }, 'fechamento de expediente falhou para a empresa');
    }
  }
  log.info({ tarefa: 'fechamento-expediente', empresas: empresas.length, faltasMarcadas: total, falhas: falhas.length }, 'fechamento de expediente processado');
  if (falhas.length) throw new Error(`fechamento de expediente falhou em ${falhas.length} de ${empresas.length} empresa(s)`);
}

async function executarSnapshotDeTodasAsEmpresas(): Promise<void> {
  const empresas = await prisma.empresa.findMany({ where: { status: 'ATIVO' }, select: { id: true } });
  let total = 0;
  const falhas: string[] = [];
  for (const empresa of empresas) {
    try {
      const { processados } = await gerarSnapshotDoDia(empresa.id);
      total += processados;
    } catch (err) {
      falhas.push(empresa.id);
      log.error({ err, empresaId: empresa.id, tarefa: 'snapshot-estoque' }, 'snapshot de estoque falhou para a empresa');
    }
  }
  log.info({ tarefa: 'snapshot-estoque', empresas: empresas.length, linhas: total, falhas: falhas.length }, 'snapshot diário processado');
  if (falhas.length) throw new Error(`snapshot falhou em ${falhas.length} de ${empresas.length} empresa(s)`);
}

/** A tarefa do dia já deveria ter rodado? (passou do horário configurado, em UTC) */
export function passouDoHorario(horaUtc: number, agora = new Date()): boolean {
  return agora.getUTCHours() >= horaUtc;
}

let verificador: NodeJS.Timeout | null = null;

/** Uma verificação: se já passou do horário, executa cada tarefa diária (no máximo 1x/dia entre instâncias). */
export async function verificarTarefasDiarias(horaUtc = Number(process.env.SNAPSHOT_HOUR_UTC ?? 3)): Promise<void> {
  if (!passouDoHorario(horaUtc)) return;
  await executarUmaVezPorDia('snapshot-estoque', executarSnapshotDeTodasAsEmpresas);
  await executarUmaVezPorDia('fechamento-expediente', fecharExpedientesDeTodasAsEmpresas);
}

/**
 * Inicia o agendador: verifica 1 minuto depois do boot e, depois, a cada 15 min.
 * Chamado uma vez no boot do servidor (server.ts). Não bloqueia o boot.
 */
export function iniciarAgendadorDeSnapshot(): void {
  if (process.env.SNAPSHOT_AUTO_ENABLED === 'false') {
    log.info('SNAPSHOT_AUTO_ENABLED=false — tarefas diárias embutidas desativadas (use cron externo)');
    return;
  }
  const horaUtc = Number(process.env.SNAPSHOT_HOUR_UTC ?? 3);
  const rodar = () => void verificarTarefasDiarias(horaUtc).catch((err) => log.error({ err, evento: 'tarefa_falhou' }, 'verificação das tarefas diárias falhou'));
  setTimeout(rodar, 60_000).unref();
  verificador = setInterval(rodar, 15 * 60_000);
  verificador.unref();
  log.info({ horaUtc, intervaloMin: 15 }, 'agendador de tarefas diárias iniciado (trava distribuída no banco)');
}

/** Para o verificador (encerramento gracioso). */
export function pararAgendadorDeSnapshot(): void {
  if (verificador) clearInterval(verificador);
  verificador = null;
}
