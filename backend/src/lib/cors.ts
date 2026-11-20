import type { FastifyCorsOptions } from '@fastify/cors';

/**
 * Configuração de CORS do backend.
 *
 * `methods` é declarado explicitamente: desde o @fastify/cors 10/11 o padrão é
 * só 'GET,HEAD,POST', e o navegador passou a bloquear no preflight todo PUT,
 * PATCH e DELETE vindo do frontend (editar, mudar status, excluir).
 *
 * `FRONTEND_URLS` (lista separada por vírgula) é normalizada: espaços e barra
 * final são removidos, porque o navegador envia a origem sem barra
 * ("https://app.exemplo.com") e a comparação é exata.
 */
export const METODOS_CORS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export function origensPermitidas(valor: string | undefined = process.env.FRONTEND_URLS): string[] {
  const lista = (valor || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return [...new Set(lista)];
}

export function opcoesCors(valor?: string): FastifyCorsOptions {
  return {
    origin: origensPermitidas(valor),
    credentials: true,
    methods: METODOS_CORS,
  };
}
