/**
 * Redação de parâmetros sensíveis nas URLs de log (Fastify + Pino).
 *
 * Contexto: o callback OAuth do Mercado Livre (`GET /integracoes/mercadolivre/callback`)
 * recebe `code` e `state` na query string; com o serializer padrão do Fastify
 * esses valores apareciam na linha de "incoming request". Este módulo pluga um
 * serializer de request que MASCARA somente valores de chaves sensíveis — o
 * caminho e os demais parâmetros seguem legíveis, mantendo o diagnóstico.
 *
 * Efeito nas demais rotas (configuração aplicada no server.ts): apenas valores
 * dessas chaves conhecidas são substituídos por `[REDACTED]`; nenhum log é
 * desativado e nenhuma validação de rota é afetada.
 */

const PARAMETROS_SENSIVEIS = [
  'code',
  'state',
  'access_token',
  'refresh_token',
  'token',
  'client_secret',
  'secret',
  'api_key',
  'apikey',
  'authorization',
  'password',
  'senha',
];

const RE_PARAMETRO_SENSIVEL = new RegExp(
  `([?&](?:${PARAMETROS_SENSIVEIS.join('|')})=)[^&]*`,
  'gi',
);

/** Mascara o valor de parâmetros sensíveis numa URL de log. */
export function redigirUrlSensiveis(url: string): string {
  if (!url || url.indexOf('?') === -1) return url;
  return url.replace(RE_PARAMETRO_SENSIVEL, '$1[REDACTED]');
}

/** Shape mínimo do request que o serializer do Pino enxerga. */
export interface RequestLogavel {
  method?: string;
  url?: string;
  hostname?: string;
  remoteAddress?: string;
  ip?: string;
}

/** Serializer `req` do logger do server.ts (mesma forma do padrão do Fastify). */
export function serializerDeRequest(req: RequestLogavel) {
  return {
    method: req?.method,
    url: redigirUrlSensiveis(String(req?.url ?? '')),
    hostname: req?.hostname,
    remoteAddress: req?.remoteAddress ?? req?.ip,
  };
}