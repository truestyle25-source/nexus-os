/**
 * Model Router: escolhe o provedor. Hoje só o Gemini; outro provedor entra implementando a
 * interface `Provedor` e sendo registrado aqui — agentes e ferramentas não mudam.
 * Em testes, `definirProvedorDeTeste` injeta um provedor determinístico (roteiro fixo) para
 * validar o motor sem gastar chamadas reais; a avaliação com o modelo real é separada.
 */
import type { Provedor } from '../tipos.js';
import { gemini } from './gemini.js';

let provedorDeTeste: Provedor | null = null;
export function definirProvedorDeTeste(p: Provedor | null) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Provedor de teste só é permitido em NODE_ENV=test.');
  provedorDeTeste = p;
}

export function provedorAtual(): Provedor {
  return provedorDeTeste ?? gemini;
}
