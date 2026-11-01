/**
 * Mensagens de erro SEGURAS para os toasts da Central de Integrações.
 *
 * O cliente `lib/api.ts` é fetch-based: falhas HTTP viram `ApiHttpError`
 * ({ status, message, data }) — `message` já carrega `data.error` do backend.
 * O formato axios (`err.response.data.erro`) NÃO existe neste projeto.
 *
 * Redige defensivamente qualquer `code`/`state`/token que uma mensagem venha
 * a carregar, para nada sensível chegar à tela do usuário.
 */
const RE_PARAMETRO_SENSIVEL = /(?:([?&])|\b)((?:code|state|access_token|refresh_token|token)=)[^&\s]*/gi;
const RE_BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const RE_JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;

/** Substitui valores sensíveis por `[REDACTED]`, preservando o resto da frase. */
export function redigirMensagemDeErro(texto: string): string {
  return texto
    .replace(RE_PARAMETRO_SENSIVEL, '$1$2[REDACTED]')
    .replace(RE_BEARER, '$1[REDACTED]')
    .replace(RE_JWT, '[REDACTED]');
}

/**
 * Extrai a mensagem exibida no toast a partir do erro lançado por `lib/api`.
 * Ordem: `message` (o `ApiHttpError` já sintetiza `data.error`), `data.error`,
 * `data.message` e por fim o texto padrão — nunca `undefined` na tela.
 * O resultado é limitado a 300 caracteres para não despejar páginas de erro.
 */
export function mensagemDeErroApi(erro: unknown, padrao: string): string {
  const e = erro as
    | { message?: unknown; data?: { error?: unknown; message?: unknown } }
    | null
    | undefined;
  const candidatos = [e?.message, e?.data?.error, e?.data?.message];
  const bruto =
    candidatos.find((c): c is string => typeof c === 'string' && c.trim().length > 0) ?? padrao;
  return redigirMensagemDeErro(bruto).slice(0, 300);
}