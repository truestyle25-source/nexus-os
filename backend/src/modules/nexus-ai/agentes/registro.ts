/**
 * Agent Registry: agentes são CONFIGURAÇÃO (papel + ferramentas + limites + versão), não
 * aplicações. Nenhum modelo fica rodando: o agente só é acionado quando há uma pergunta ou
 * um evento. Novos agentes entram aqui sem mudar o motor.
 */
import type { Agente } from '../tipos.js';

const AGENTES = new Map<string, Agente>();

export function registrarAgentes(lista: Agente[]) {
  for (const a of lista) {
    if (AGENTES.has(a.id)) throw new Error(`Agente duplicado: ${a.id}`);
    AGENTES.set(a.id, a);
  }
}

export function agente(id: string): Agente | undefined { return AGENTES.get(id); }
export function todosAgentes(): Agente[] { return [...AGENTES.values()]; }
