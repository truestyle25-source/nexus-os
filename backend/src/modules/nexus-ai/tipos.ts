/**
 * NEXUS AI — contratos centrais.
 *
 * Regra de ouro: o modelo NUNCA acessa o banco. Ele só pede ferramentas; cada ferramenta é
 * uma função do backend com entrada validada (Zod), permissão declarada (módulo + ação) e
 * execução SEMPRE filtrada pela empresa da sessão. Números vêm das ferramentas; o modelo
 * só interpreta.
 */
import type { z } from 'zod';
import type { Acao, Modulo } from '../../lib/permissoes-catalogo.js';

export interface ContextoIA {
  empresaId: string;
  usuarioId: string | null; // null = execução de sistema (evento), sem usuário
  filialId?: string | null;
  /** Cache de permissões da execução (evita consultar o banco a cada ferramenta). */
  permissoes: Map<string, boolean>;
  /** Permissões efetivas para execuções de sistema (eventos): só o que o agente declara. */
  sistema?: boolean;
}

/** Esquema de parâmetros no formato aceito pelos provedores (subconjunto de JSON Schema/OpenAPI). */
export interface EsquemaParametros {
  type: 'object';
  properties: Record<string, { type: 'string' | 'number' | 'integer' | 'boolean' | 'array'; description: string; enum?: string[]; items?: { type: string } }>;
  required?: string[];
}

export interface Ferramenta<Args = any, Res = any> {
  nome: string;
  descricao: string;
  parametros: EsquemaParametros;
  validar: z.ZodType<Args>;
  permissao: { modulo: Modulo; acao: Acao };
  /** Ferramentas com efeito NUNCA executam direto: viram proposta de aprovação (Fase 06). */
  efeito?: false;
  executar(ctx: ContextoIA, args: Args): Promise<Res>;
}

export interface Agente {
  id: string;
  nome: string;
  descricao: string;
  versao: string;
  /** Instruções do agente (papel). O texto dos dados nunca entra aqui. */
  papel: string;
  ferramentas: string[];
  /** O usuário precisa desta permissão para conversar com o agente. */
  permissaoMinima: { modulo: Modulo; acao: Acao };
  /** 0 observação · 1 recomenda · 2 prepara para aprovação · 3 automação controlada */
  autonomiaMax: 0 | 1 | 2 | 3;
  limites: { passos: number; tempoMs: number };
  /** Perguntas simples podem usar o modelo econômico. */
  modelo?: 'ECONOMICO' | 'AVANCADO';
}

/** Histórico neutro (independente de provedor). */
export type MensagemIA =
  | { tipo: 'usuario'; texto: string }
  | { tipo: 'modelo'; texto?: string; chamadas?: ChamadaFerramenta[]; bruto?: unknown }
  | { tipo: 'ferramenta'; resultados: { nome: string; resposta: unknown }[] };

export interface ChamadaFerramenta { nome: string; args: Record<string, unknown> }

export interface RespostaProvedor {
  texto?: string;
  chamadas?: ChamadaFerramenta[];
  /** Partes originais do provedor (ex.: assinaturas de raciocínio do Gemini) para reenviar no histórico. */
  bruto?: unknown;
  tokensEntrada: number;
  tokensSaida: number;
  modelo: string;
}

export interface Provedor {
  nome: string;
  configurado(): boolean;
  gerar(p: { sistema: string; mensagens: MensagemIA[]; ferramentas: Ferramenta[]; nivel: 'ECONOMICO' | 'AVANCADO'; maxTokens?: number }): Promise<RespostaProvedor>;
}

/** Falha passageira (timeout, 429, 5xx, circuito aberto): a investigação pode ser retomada. */
export class ProvedorIndisponivel extends Error {}
/** Falha definitiva (chave inválida, requisição recusada). */
export class ProvedorRecusou extends Error {}
