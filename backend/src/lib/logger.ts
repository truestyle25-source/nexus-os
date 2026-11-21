import pino, { type LoggerOptions } from 'pino';
import { serializerDeRequest } from './log-redacao.js';

/**
 * Configuração ÚNICA de log do backend (Fastify e processos fora de requisição,
 * como agendadores e integrações). Logs em JSON no stdout — o Render os coleta.
 *
 * - `redact`: valores sensíveis nunca chegam ao log, mesmo se um objeto inteiro
 *   for passado por engano (senha, token, cabeçalho Authorization, cookies).
 * - `serializers.req`: mascara parâmetros sensíveis da URL (ver log-redacao.ts).
 * - `LOG_LEVEL`: nível configurável (padrão `info`).
 */
export const opcoesDeLog: LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  base: { servico: 'nexus-backend' },
  serializers: { req: serializerDeRequest },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      '*.senha',
      '*.senhaAtual',
      '*.novaSenha',
      '*.senhaHash',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.access_token',
      '*.refresh_token',
      '*.apiKey',
      '*.client_secret',
    ],
    censor: '[REDACTED]',
  },
};

/** Logger para código que roda fora de uma requisição (agendadores, integrações, scripts). */
export const logger = pino(opcoesDeLog);

/** Logger filho com o nome do componente (ex.: `logDe('agendador')`). */
export function logDe(componente: string) {
  return logger.child({ componente });
}
