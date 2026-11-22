/**
 * Integrações configuradas no SERVIDOR (variáveis de ambiente, iguais para todas as empresas):
 * Google Gemini (GEMINI_API_KEY) e e-mail transacional Resend (RESEND_API_KEY).
 *
 * Antes, o card mostrava "Conectado" só porque a variável existia. Agora:
 *  - sem a variável → NAO_CONFIGURADO;
 *  - com a variável e sem teste recente → CREDENCIAIS_SALVAS (não comprovado);
 *  - teste real nas últimas 24 h → CONECTADO (sucesso) ou ERRO (falha).
 * O teste faz uma leitura oficial e é registrado no histórico da empresa que testou.
 *
 *  Gemini: GET https://generativelanguage.googleapis.com/v1beta/models?key=…&pageSize=1
 *  Resend: GET https://api.resend.com/domains (Bearer). Chave "só envio" responde 401 com
 *          name "restricted_api_key": a chave existe e é válida para enviar — conta como OK.
 * A chave nunca sai do servidor nem aparece em resposta, log ou histórico.
 */
import { prisma } from '../../../lib/prisma.js';
import { ErroDeNegocio } from '../../../lib/erros.js';
import { registrarEvento } from './central.service.js';

export const INTEGRACOES_SERVIDOR = { gemini: 'GEMINI_API_KEY', 'email-transacional': 'RESEND_API_KEY' } as const;
export type IdServidor = keyof typeof INTEGRACOES_SERVIDOR;
const VALIDADE_MS = 24 * 3600_000;

export async function statusServidor(empresaId: string, id: IdServidor): Promise<'NAO_CONFIGURADO' | 'CREDENCIAIS_SALVAS' | 'CONECTADO' | 'ERRO'> {
  if (!process.env[INTEGRACOES_SERVIDOR[id]]) return 'NAO_CONFIGURADO';
  const ultimo = await prisma.integracaoEvento.findFirst({ where: { empresaId, provedor: id, operacao: 'TESTAR', createdAt: { gte: new Date(Date.now() - VALIDADE_MS) } }, orderBy: { createdAt: 'desc' }, select: { resultado: true } });
  if (!ultimo) return 'CREDENCIAIS_SALVAS';
  return ultimo.resultado === 'SUCESSO' ? 'CONECTADO' : 'ERRO';
}

export async function testarServidor(empresaId: string, usuarioId: string, id: IdServidor) {
  const chave = process.env[INTEGRACOES_SERVIDOR[id]];
  if (!chave) throw new ErroDeNegocio(`${INTEGRACOES_SERVIDOR[id]} não está configurada no servidor.`, 409);
  const inicio = Date.now();
  let ok = false; let mensagem = ''; let codigo: string | null = null;
  try {
    if (id === 'gemini') {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(chave)}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      ok = r.ok;
      if (!ok) codigo = r.status === 400 || r.status === 403 ? 'CREDENCIAL_INVALIDA' : `HTTP_${r.status}`;
      mensagem = ok ? 'Chave do Gemini aceita pela API do Google.' : codigo === 'CREDENCIAL_INVALIDA' ? 'A API do Google recusou a GEMINI_API_KEY.' : `Google respondeu HTTP ${r.status}.`;
    } else {
      const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${chave}` }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      const corpo = (await r.json().catch(() => ({}))) as { name?: string; message?: string };
      const restrita = r.status === 401 && corpo.name === 'restricted_api_key';
      ok = r.ok || restrita;
      // Observado na API real: chave inválida → 400 {name: 'validation_error', message: 'API key is invalid'}.
      const chaveInvalida = r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(corpo.message ?? ''));
      if (!ok) codigo = chaveInvalida ? 'CREDENCIAL_INVALIDA' : `HTTP_${r.status}`;
      mensagem = r.ok ? 'Chave do Resend aceita.' : restrita ? 'Chave do Resend válida (restrita a envio).' : codigo === 'CREDENCIAL_INVALIDA' ? 'O Resend recusou a RESEND_API_KEY.' : `Resend respondeu HTTP ${r.status}.`;
    }
  } catch {
    codigo = 'FALHA_COMUNICACAO'; mensagem = 'Sem comunicação com o provedor (timeout ou rede).';
  }
  await registrarEvento({ empresaId, provedor: id, operacao: 'TESTAR', ok, codigoErro: codigo, mensagem, duracaoMs: Date.now() - inicio, usuarioId });
  return { ok, codigo: ok ? 'OK' : codigo, mensagem, status: await statusServidor(empresaId, id) };
}
