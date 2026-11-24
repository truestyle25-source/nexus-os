/**
 * Tool Registry. Toda ferramenta passa por aqui antes de executar:
 *  1) existe e está na lista do agente;  2) o usuário tem a permissão declarada (cache por
 *  execução);  3) argumentos validados por Zod;  4) execução com a empresa do contexto;
 *  5) resultado neutralizado contra instruções embutidas (seguranca.ts).
 * Ferramentas com efeito não existem neste registro de leitura: na Fase 06 elas geram
 * propostas no motor de aprovação, nunca execução direta.
 */
import { temPermissao } from '../../../lib/permissoes.js';
import type { ContextoIA, Ferramenta } from '../tipos.js';
import { neutralizarDados } from '../seguranca.js';

const FERRAMENTAS = new Map<string, Ferramenta>();

export function registrarFerramentas(lista: Ferramenta[]) {
  for (const f of lista) {
    if (FERRAMENTAS.has(f.nome)) throw new Error(`Ferramenta duplicada: ${f.nome}`);
    if (!/^[a-z][a-z0-9_]{2,60}$/.test(f.nome)) throw new Error(`Nome de ferramenta inválido: ${f.nome}`);
    FERRAMENTAS.set(f.nome, f);
  }
}

export function ferramenta(nome: string): Ferramenta | undefined { return FERRAMENTAS.get(nome); }
export function todasFerramentas(): Ferramenta[] { return [...FERRAMENTAS.values()]; }

export class FerramentaNegada extends Error {}

export async function podeUsar(ctx: ContextoIA, f: Ferramenta): Promise<boolean> {
  if (ctx.sistema) return true; // execuções de sistema (eventos) usam só ferramentas de leitura do agente
  if (!ctx.usuarioId) return false;
  const chave = `${f.permissao.modulo}.${f.permissao.acao}`;
  if (!ctx.permissoes.has(chave)) ctx.permissoes.set(chave, await temPermissao(ctx.usuarioId, f.permissao.modulo, f.permissao.acao));
  return ctx.permissoes.get(chave)!;
}

export async function executarFerramenta(ctx: ContextoIA, nome: string, permitidas: string[], argsBrutos: unknown) {
  const f = FERRAMENTAS.get(nome);
  if (!f || !permitidas.includes(nome)) throw new FerramentaNegada(`Ferramenta "${nome}" não disponível para este agente.`);
  if (!(await podeUsar(ctx, f))) throw new FerramentaNegada(`Sem permissão (${f.permissao.modulo}.${f.permissao.acao}) para "${nome}".`);
  const args = f.validar.parse(argsBrutos ?? {});
  const bruto = await f.executar(ctx, args);
  const { valor, achados } = neutralizarDados(bruto);
  return { args, resultado: valor, injecoes: achados };
}
