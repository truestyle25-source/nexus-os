import type { FastifyRequest } from 'fastify';

/**
 * IP do cliente usado nos limites de requisição e na auditoria.
 *
 * Por padrão vale `req.ip`, que o Fastify extrai do `X-Forwarded-For` conforme
 * `trustProxy` (ver `configuracaoTrustProxy`). Com `trustProxy: true` o Fastify
 * confia em QUALQUER valor do cabeçalho — um cliente pode forjar o IP enviando
 * `X-Forwarded-For` próprio. Por isso o comportamento é configurável:
 *
 * - `TRUST_PROXY_HOPS=N`: confia só nos N proxies mais próximos (o IP vem da
 *   N-ésima posição a partir da direita, que o cliente não controla).
 * - `CLIENT_IP_HEADER=<nome>`: usa um cabeçalho que o PROXY sobrescreve sempre
 *   (ex.: `cf-connecting-ip` atrás do Cloudflare). Só configure depois de
 *   confirmar nos logs de produção que o cabeçalho existe e não vem do cliente.
 *
 * Sem nenhuma das duas variáveis, o comportamento anterior é mantido.
 */
export function ipDoCliente(req: FastifyRequest): string {
  const nome = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (nome) {
    const bruto = req.headers[nome];
    const valor = (Array.isArray(bruto) ? bruto[0] : bruto)?.split(',')[0]?.trim();
    if (valor && /^[0-9a-fA-F:.]{3,45}$/.test(valor)) return valor;
  }
  return req.ip || 'desconhecido';
}

/**
 * Valor de `trustProxy` do Fastify: com `TRUST_PROXY_HOPS=N`, confia só nos N saltos
 * mais próximos (função `(endereço, salto) => salto < N`, o mesmo que o número de
 * saltos do proxy-addr); sem a variável, `true` (comportamento anterior).
 */
export function configuracaoTrustProxy(valor = process.env.TRUST_PROXY_HOPS): boolean | ((endereco: string, salto: number) => boolean) {
  const n = Number(valor);
  if (valor !== undefined && valor !== '' && Number.isInteger(n) && n >= 0) return (_endereco: string, salto: number) => salto < n;
  return true;
}
