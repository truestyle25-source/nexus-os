/**
 * Provedor Google Gemini (REST generateContent) com chamada de ferramentas.
 *
 * - Chave e modelo SÓ no servidor: GEMINI_API_KEY; GEMINI_MODEL (avançado) e
 *   GEMINI_MODEL_ECONOMICO (perguntas do dia a dia; padrão gemini-3.5-flash-lite — medido ~1 s,
 *   contra 30–60 s dos modelos com raciocínio).
 * - Ferramentas como `functionDeclarations`; o histórico reenvia as partes ORIGINAIS do modelo
 *   (inclui as assinaturas de raciocínio que os modelos novos exigem entre chamadas).
 * - Resiliência: tentativas com espera crescente para 429/5xx/rede; circuito aberto após
 *   5 falhas seguidas (60 s sem chamar o provedor). Nada disso afeta o ERP: só a NEXUS AI.
 */
import type { Ferramenta, MensagemIA, Provedor, RespostaProvedor } from '../tipos.js';
import { ProvedorIndisponivel, ProvedorRecusou } from '../tipos.js';

// Modelos avançados (com raciocínio) podem levar dezenas de segundos; o econômico responde em ~1 s.
const TIMEOUT_MS = { ECONOMICO: 30_000, AVANCADO: 90_000 } as const;
export const MODELO_ECONOMICO_PADRAO = 'gemini-3.5-flash-lite';
const TENTATIVAS = 3;
const LIMIAR_CIRCUITO = 5;
const CIRCUITO_ABERTO_MS = 60_000;

let falhasSeguidas = 0;
let circuitoAteMs = 0;

export function estadoCircuito() {
  return { falhasSeguidas, aberto: Date.now() < circuitoAteMs, ateMs: circuitoAteMs };
}
/** Só para testes. */
export function reiniciarCircuito() { falhasSeguidas = 0; circuitoAteMs = 0; }
function registrarFalha() { falhasSeguidas++; if (falhasSeguidas >= LIMIAR_CIRCUITO) circuitoAteMs = Date.now() + CIRCUITO_ABERTO_MS; }
function registrarSucesso() { falhasSeguidas = 0; circuitoAteMs = 0; }

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function paraConteudos(mensagens: MensagemIA[]) {
  return mensagens.map((m) => {
    if (m.tipo === 'usuario') return { role: 'user', parts: [{ text: m.texto }] };
    if (m.tipo === 'modelo') {
      if (Array.isArray(m.bruto)) return { role: 'model', parts: m.bruto };
      const parts: unknown[] = [];
      if (m.texto) parts.push({ text: m.texto });
      for (const c of m.chamadas ?? []) parts.push({ functionCall: { name: c.nome, args: c.args } });
      return { role: 'model', parts };
    }
    return { role: 'user', parts: m.resultados.map((r) => ({ functionResponse: { name: r.nome, response: { resultado: r.resposta } } })) };
  });
}

export const gemini: Provedor = {
  nome: 'gemini',
  configurado: () => Boolean(process.env.GEMINI_API_KEY),
  async gerar({ sistema, mensagens, ferramentas, nivel, maxTokens }): Promise<RespostaProvedor> {
    const chave = process.env.GEMINI_API_KEY;
    if (!chave) throw new ProvedorRecusou('GEMINI_API_KEY não configurada no servidor.');
    if (Date.now() < circuitoAteMs) throw new ProvedorIndisponivel('Provedor de IA temporariamente indisponível (muitas falhas seguidas). Tente em instantes.');
    const modelo = nivel === 'ECONOMICO' ? (process.env.GEMINI_MODEL_ECONOMICO || MODELO_ECONOMICO_PADRAO) : (process.env.GEMINI_MODEL || 'gemini-3.6-flash');
    const corpo = {
      systemInstruction: { parts: [{ text: sistema }] },
      contents: paraConteudos(mensagens),
      ...(ferramentas.length ? { tools: [{ functionDeclarations: ferramentas.map((f: Ferramenta) => ({ name: f.nome, description: f.descricao, parameters: f.parametros })) }] } : {}),
      generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens ?? 2048 },
    };
    let ultimoErro = 'falha desconhecida';
    for (let t = 1; t <= TENTATIVAS; t++) {
      let r: Response;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(TIMEOUT_MS[nivel]),
        });
      } catch {
        ultimoErro = 'sem comunicação com o provedor (timeout ou rede)';
        if (t < TENTATIVAS) { await espera(500 * 2 ** (t - 1)); continue; }
        registrarFalha(); throw new ProvedorIndisponivel(ultimoErro);
      }
      if (r.status === 429 || r.status >= 500) {
        ultimoErro = `provedor respondeu HTTP ${r.status}`;
        if (t < TENTATIVAS) { await espera(800 * 2 ** (t - 1)); continue; }
        registrarFalha(); throw new ProvedorIndisponivel(ultimoErro);
      }
      const json = (await r.json().catch(() => ({}))) as any;
      if (!r.ok) {
        registrarSucesso(); // o provedor respondeu: não é indisponibilidade
        throw new ProvedorRecusou(`Provedor recusou a requisição (HTTP ${r.status}): ${String(json?.error?.message ?? '').slice(0, 200)}`);
      }
      registrarSucesso();
      const partes = (json?.candidates?.[0]?.content?.parts ?? []) as any[];
      const texto = partes.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
      const chamadas = partes.filter((p) => p.functionCall).map((p) => ({ nome: String(p.functionCall.name), args: (p.functionCall.args ?? {}) as Record<string, unknown> }));
      return {
        ...(texto ? { texto } : {}), ...(chamadas.length ? { chamadas } : {}), bruto: partes,
        tokensEntrada: Number(json?.usageMetadata?.promptTokenCount ?? 0), tokensSaida: Number(json?.usageMetadata?.candidatesTokenCount ?? 0) + Number(json?.usageMetadata?.thoughtsTokenCount ?? 0), modelo,
      };
    }
    throw new ProvedorIndisponivel(ultimoErro);
  },
};
