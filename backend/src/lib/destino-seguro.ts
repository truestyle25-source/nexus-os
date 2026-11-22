/**
 * Proteção contra SSRF para destinos informados pelo usuário (URL da loja WooCommerce,
 * servidores SMTP/IMAP). Antes de qualquer conexão:
 *  - o host é resolvido por DNS e TODOS os endereços precisam ser públicos (bloqueia
 *    loopback, redes privadas, link-local/metadados de nuvem 169.254.0.0/16, CGNAT,
 *    multicast, reservados e equivalentes IPv6, inclusive IPv4 mapeado em IPv6);
 *  - URLs só em HTTPS, sem usuário/senha embutidos, portas restritas;
 *  - quem chama não segue redirecionamentos (redirect: 'manual').
 * Limitação conhecida: entre a checagem e a conexão o DNS pode mudar (rebinding); o
 * risco é reduzido por não seguir redirecionamentos e por timeouts curtos.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class DestinoBloqueado extends Error {}

function ipv4Privado(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19));
}

export function enderecoPrivado(ip: string): boolean {
  if (isIP(ip) === 4) return ipv4Privado(ip);
  const v = ip.toLowerCase();
  const mapeado = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeado) return ipv4Privado(mapeado[1]);
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff') || v.startsWith('64:ff9b') || v.startsWith('2001:db8');
}

/**
 * Garante que o host só resolve para endereços públicos e devolve o primeiro deles.
 * Quem conecta deve usar ESSE endereço (com o nome original no TLS/SNI): resolver de novo
 * na hora da conexão abriria espaço para DNS rebinding (público na checagem, interno depois).
 */
export async function exigirHostPublico(host: string): Promise<string> {
  const h = host.trim().replace(/^\[|\]$/g, '');
  if (!h || h.length > 253) throw new DestinoBloqueado('Endereço do servidor inválido.');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(h)) throw new DestinoBloqueado('Endereços internos não são permitidos.');
  let enderecos: { address: string }[];
  try {
    enderecos = isIP(h) ? [{ address: h }] : await lookup(h, { all: true, verbatim: true });
  } catch {
    throw new DestinoBloqueado('Não foi possível localizar o servidor (DNS).');
  }
  if (!enderecos.length || enderecos.some((e) => enderecoPrivado(e.address))) {
    throw new DestinoBloqueado('Endereços internos ou privados não são permitidos.');
  }
  return enderecos[0].address;
}

/** Normaliza e valida uma URL base HTTPS pública. Devolve a origem + caminho sem barra final. */
export async function exigirUrlHttpsPublica(bruta: string): Promise<URL> {
  let url: URL;
  try { url = new URL(bruta.trim()); } catch { throw new DestinoBloqueado('URL inválida.'); }
  if (url.protocol !== 'https:') throw new DestinoBloqueado('Use um endereço https://.');
  if (url.username || url.password) throw new DestinoBloqueado('A URL não pode conter usuário ou senha.');
  if (url.port && !['443', '8443'].includes(url.port)) throw new DestinoBloqueado('Porta não permitida (use 443).');
  url.hash = ''; url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  await exigirHostPublico(url.hostname);
  return url;
}

export const PORTAS_SMTP = [25, 465, 587, 2525];
export const PORTAS_IMAP = [143, 993];
