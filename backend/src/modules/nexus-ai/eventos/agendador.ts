/**
 * Agendador do monitoramento (Fase 06).
 *  - A cada NEXUS_AI_MONITOR_SEG (padrão 120 s): varredura das regras de segurança + fila.
 *    Seguro com várias instâncias: eventos têm chave única e o worker usa lease.
 *  - Uma vez por dia (todas as instâncias juntas): insights de anomalias por empresa, com o
 *    cálculo determinístico de detectar_anomalias (sem chamar o modelo).
 * Não chama o provedor de IA: continua funcionando com o Gemini fora do ar.
 * NEXUS_AI_MONITOR=false desliga.
 */
import { createHash } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import { comoSistema } from '../../../lib/tenant-context.js';
import { executarUmaVezPorDia } from '../../../lib/tarefa-agendada.js';
import { logDe } from '../../../lib/logger.js';
import { detectarAnomalias } from '../ferramentas/analise.js';
import { contexto } from '../motor.js';
import { registrarEventos, varrer, type EventoDetectado } from './regras.js';
import { processarFila } from './worker.js';

const log = logDe('nexus-ai-monitor');
let timer: NodeJS.Timeout | null = null;
let rodando = false;

export async function cicloMonitor(): Promise<{ novos: number; processados: number; falhas: string[] }> {
  const v = await varrer();
  const processados = await processarFila();
  if (v.falhas.length) log.warn({ regras: v.falhas }, 'regras do monitor falharam neste ciclo');
  return { novos: v.novos, processados, falhas: v.falhas };
}

/** Anomalias de negócio do dia → eventos (um por anomalia por dia). */
export async function insightsDiarios(agora = new Date()): Promise<number> {
  const dia = agora.toISOString().slice(0, 10);
  const empresas = await comoSistema('nexus-ai:insights:empresas', () => prisma.empresa.findMany({ select: { id: true } }));
  const eventos: EventoDetectado[] = [];
  for (const e of empresas) {
    try {
      const r: any = await comoSistema('nexus-ai:insights:anomalias', () => detectarAnomalias.executar(contexto(e.id, null, { sistema: true }), { dias: 7, diasBase: 56 }));
      // Sem período-base (empresa nova ou área sem histórico) não há padrão para comparar: não alerta.
      for (const a of (r.anomalias ?? []).filter((x: any) => Number(x.esperado) > 0)) {
        const id = createHash('sha256').update(`${a.tipo}|${a.descricao}`).digest('hex').slice(0, 16);
        eventos.push({ empresaId: e.id, tipo: 'ANOMALIA', chave: `anom:${dia}:${id}`, severidade: a.severidade, dados: { ...a, metodo: r.metodo, dia } });
      }
    } catch (err) { log.warn({ err: err instanceof Error ? err.message : 'erro', empresaId: e.id }, 'insights diários falharam para a empresa'); }
  }
  const novos = await registrarEventos(eventos);
  await processarFila();
  return novos;
}

export function iniciarMonitorNexusAI() {
  if (process.env.NEXUS_AI_MONITOR === 'false' || timer) return;
  const intervalo = Math.max(30, Number(process.env.NEXUS_AI_MONITOR_SEG || 120)) * 1000;
  const tique = async () => {
    if (rodando) return;
    rodando = true;
    try {
      await cicloMonitor();
      await executarUmaVezPorDia('nexus-ai-insights', async () => { await insightsDiarios(); });
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : 'erro' }, 'ciclo do monitor da NEXUS AI falhou');
    } finally { rodando = false; }
  };
  timer = setInterval(() => void comoSistema('agendador:nexus-ai-monitor', tique), intervalo);
  timer.unref?.();
  setTimeout(() => void comoSistema('agendador:nexus-ai-monitor', tique), 15_000).unref?.();
}

export function pararMonitorNexusAI() { if (timer) clearInterval(timer); timer = null; }
