// =============================================================================
// Cliente HTTP da API oficial do Mercado Livre (sync de catálogo/estoque/pedidos)
//
// CONCENTRA as chamadas autenticadas do módulo para que TODA a sincronização
// herde as mesmas regras:
//   - access token SEMPRE decifrado em memória (repouso cifrado, ver secrets.ts)
//   - renovação automática quando o token está por vencer (< 60s) ou 401
//   - retry com backoff exponencial para falha de REDE e 5xx
//   - 429 (rate limit) respeitando `Retry-After` quando o provedor envia
//   - NUNCA loga token, code ou segredo
//
// O host é configurável (MERCADOLIVRE_API_URL) EXCLUSIVAMENTE para os
// testes usarem um servidor local simulado; em produção o padrão é a API
// oficial. Nenhum valor simulado existe fora de backend/tests/.
// =============================================================================
import { decryptSecret } from '../../lib/secrets.js';
import { ErroDeNegocio } from '../../lib/erros.js';
import { renovarToken, obterCadastro } from './mercadolivre.service.js';

export const MERCADOLIVRE_API_PADRAO = 'https://api.mercadolivre.com';

/** Host da API (override de teste via MERCADOLIVRE_API_URL). */
export function baseUrlApi(): string {
  return (process.env.MERCADOLIVRE_API_URL || MERCADOLIVRE_API_PADRAO).replace(/\/+$/, '');
}

/** Backoff inicial entre retentativas (env de teste encurta). */
function backoffBaseMs(): number {
  const bruto = Number(process.env.ML_SYNC_BACKOFF_MS ?? 250);
  return Number.isFinite(bruto) && bruto >= 0 ? bruto : 250;
}

export interface RespostaML {
  status: number;
  ok: boolean;
  dados: unknown;
}

export interface OpcoesChamada {
  corpo?: unknown;
  /** Query string já montada (ex.: '?offset=0&limit=50'). */
  query?: string;
  /** Máximo de tentativas (inclui a primeira). Padrão 3. */
  tentativas?: number;
}

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Obtém o access token atualizado, renovando antes se o token expira em
 * menos de 60 segundos. A trava de concorrência vive em renovarToken
 * (mesma promessa compartilhada): chamadas paralelas renovam UMA vez.
 */
async function obterTokenAcesso(empresaId: string, cadastroId: string): Promise<string> {
  const registro = await obterCadastro(empresaId, cadastroId);
  if (!registro.accessToken) {
    throw new ErroDeNegocio('Conta não conectada. Inicie a autenticação novamente.', 400);
  }
  const proximo = registro.tokenExpiry ? registro.tokenExpiry.getTime() - Date.now() : Infinity;
  if (proximo < 60_000 && registro.refreshToken) {
    await renovarToken(empresaId, cadastroId);
    const renovado = await obterCadastro(empresaId, cadastroId);
    if (!renovado.accessToken) {
      throw new ErroDeNegocio('Token ausente após a renovação. Reautentique a conta.', 401);
    }
    return decryptSecret(renovado.accessToken) as string;
  }
  try {
    return decryptSecret(registro.accessToken) as string;
  } catch {
    throw new ErroDeNegocio('Credenciais ilegíveis. Reautentique a conta.', 500);
  }
}

/**
 * Chamada autenticada à API do Mercado Livre com retentativas.
 *
 * - Falha de rede: retenta (backoff exponencial) e, no fim, 502.
 * - 5xx: retenta da mesma forma (erro transitório do provedor).
 * - 429: espera `Retry-After` (ou backoff) e retenta dentro do teto.
 * - 401: renova o token UMA vez e repete; se falhar de novo, devolve a
 *   resposta 401 para o chamador tratar como reautenticação.
 * - 206 (Partial Content, ex.: /orders/{id}): `ok=true` — o chamador decide
 *   se prossegue com os campos disponíveis.
 *
 * Erros de negócio do provedor (400/403/404...) NÃO são lançados: a
 * resposta é devolvida e cada serviço decide o tratamento item a item.
 */
export async function chamarML(
  empresaId: string,
  cadastroId: string,
  metodo: 'GET' | 'PUT' | 'POST',
  caminho: string,
  opcoes: OpcoesChamada = {},
): Promise<RespostaML> {
  const url = `${baseUrlApi()}${caminho}${opcoes.query ?? ''}`;
  const tentativas = Math.max(1, opcoes.tentativas ?? 3);
  const base = backoffBaseMs();
  let token = await obterTokenAcesso(empresaId, cadastroId);
  let tokenRenovado = false;
  let ultimaFoiRede = false;

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(opcoes.corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
      });
      ultimaFoiRede = false;
    } catch {
      // Falha de rede (DNS, conexão recusada, timeout).
      ultimaFoiRede = true;
      if (tentativa < tentativas) {
        await dormir(base * 2 ** (tentativa - 1));
        continue;
      }
      throw new ErroDeNegocio('Falha de rede ao consultar o Mercado Livre. Tente novamente.', 502);
    }

    if (resp.status === 401 && !tokenRenovado) {
      // Access token expirado entre a leitura e a chamada: renova UMA vez
      // (trava compartilhada em renovarToken) e repete sem consumir tentativa.
      tokenRenovado = true;
      await renovarToken(empresaId, cadastroId);
      token = await obterTokenAcesso(empresaId, cadastroId);
      tentativa--;
      continue;
    }

    if (resp.status === 429 && tentativa < tentativas) {
      const retryAfter = Number(resp.headers.get('retry-after'));
      const esperaMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 10_000)
        : base * 2 ** (tentativa - 1);
      await dormir(esperaMs);
      continue;
    }

    if (resp.status >= 500 && tentativa < tentativas) {
      await dormir(base * 2 ** (tentativa - 1));
      continue;
    }

    let dados: unknown = null;
    if (resp.status !== 204) {
      dados = await resp.json().catch(() => null);
    }
    return { status: resp.status, ok: resp.ok || resp.status === 206, dados };
  }

  throw new ErroDeNegocio(
    ultimaFoiRede
      ? 'Falha de rede ao consultar o Mercado Livre. Tente novamente.'
      : 'Mercado Livre indisponível (rate limit/erro do servidor). Tente novamente.',
    502,
  );
}

