// =============================================================================
// Consulta de dados do usuário — API oficial do Mercado Livre
//
// Expõe os endpoints de leitura (e uma atualização) de dados do vendedor:
//   1. GET  /users/{USER_ID}               — dados da conta
//   2. PUT  /users/{USER_ID}               — atualizar dados da conta
//   3. GET  /users/me                      — dados do usuário logado (pelo token)
//   4. GET  /users/{USER_ID}/addresses     — endereços
//   5. GET  /users/{USER_ID}/accepted_payment_methods — meios de pagamento aceitos
//   6. GET  /applications/{APPLICATION_ID} — dados da aplicação
//   7. GET  /users/{USER_ID}/brands        — marcas
//   8. GET  /users/{USER_ID}/classifieds_promotion_packs — pacotes de promoção
//   9. GET  /missed_feeds?app_id={APP_ID}  — notificações perdidas (sincronização)
//
// Reutiliza o cliente autenticado `chamarML` (renovação de token, retry, backoff,
// 429/RateLimit) para que todas as chamadas herdem as mesmas regras de segurança.
// =============================================================================

import { chamarML } from './mercadolivre-api.client.js';
import { prisma } from '../../lib/prisma.js';
import { ErroDeNegocio } from '../../lib/erros.js';

/** Cadastro ML conectado da empresa (único por empresa+tipo). */
async function obterCadastroConectado(empresaId: string) {
  const cadastro = await prisma.integracaoExterno.findFirst({
    where: { empresaId, tipo: 'MERCADO_LIVRE', status: 'CONECTADO' },
  });
  if (!cadastro || !cadastro.accountId) {
    throw new ErroDeNegocio(
      'Conta Mercado Livre não conectada. Vincule a conta na Central de Integrações.',
      400,
    );
  }
  return cadastro;
}

/** Monta o caminho do usuário a partir do cadastro (accountId = user_id do ML). */
function caminhoUsuario(accountId: string): string {
  return `/users/${accountId}`;
}

// ---------------------------------------------------------------------------
// 1. Informação da conta do usuário (qualquer usuário pelo ID)
// ---------------------------------------------------------------------------

export interface UsuarioML {
  id: string;
  nickname?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: { area_code?: string | null; number?: string | null } | null;
  address?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip_code?: string | null;
  } | null;
  company?: {
    corporate_name?: string | null;
    brand_name?: string | null;
  } | null;
  site_id?: string | null;
  permalink?: string | null;
  registration_date?: string | null;
  [key: string]: unknown;
}

/** GET /users/{USER_ID} */
export async function consultarUsuarioML(
  empresaId: string,
  userId: string,
): Promise<UsuarioML> {
  const cadastro = await obterCadastroConectado(empresaId);
  const resposta = await chamarML(
    empresaId,
    cadastro.id,
    'GET',
    `/users/${userId}`,
  );
  if (!resposta.ok || !resposta.dados) {
    throw new ErroDeNegocio(
      `Não foi possível consultar o usuário ${userId} no Mercado Livre (HTTP ${resposta.status}).`,
      resposta.status >= 500 ? 502 : 400,
    );
  }
  return resposta.dados as UsuarioML;
}

// ---------------------------------------------------------------------------
// 2. Atualizar informação do usuário
// ---------------------------------------------------------------------------

export interface AtualizarUsuarioMLInput {
  first_name?: string;
  last_name?: string;
  phone?: { area_code?: string; number?: string };
  address?: {
    address?: string;
    city?: string;
    state?: string;
    zip_code?: string;
  };
  company?: {
    corporate_name?: string;
    brand_name?: string;
  };
}

/** PUT /users/{USER_ID} — atualiza dados do usuário logado (accountId do cadastro). */
export async function atualizarUsuarioML(
  empresaId: string,
  dados: AtualizarUsuarioMLInput,
): Promise<UsuarioML> {
  const cadastro = await obterCadastroConectado(empresaId);
  const resposta = await chamarML(
    empresaId,
    cadastro.id,
    'PUT',
    `/users/${cadastro.accountId}`,
    { corpo: dados },
  );
  if (!resposta.ok || !resposta.dados) {
    throw new ErroDeNegocio(
      `Não foi possível atualizar o usuário no Mercado Livre (HTTP ${resposta.status}).`,
      resposta.status >= 500 ? 502 : 400,
    );
  }
  return resposta.dados as UsuarioML;
}

// ---------------------------------------------------------------------------
// 3. Informação do usuário logado (pelo próprio token, sem ID)
// ---------------------------------------------------------------------------

/** GET /users/me — dados do usuário autenticado pelo access token. */
export async function consultarUsuarioLogadoML(
  empresaId: string,
): Promise<UsuarioML> {
  const cadastro = await obterCadastroConectado(empresaId);
  if (!cadastro.accountId) {
    throw new ErroDeNegocio('Conta sem accountId do Mercado Livre. Reautentique a conta.', 400);
  }
  return consultarUsuarioML(empresaId, cadastro.accountId);
}

// ---------------------------------------------------------------------------
// 4. Endereços do usuário
// ---------------------------------------------------------------------------

export interface EnderecoML {
  id?: string | null;
  address?: string | null;
  address_line?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  zip_code?: string | null;
  neighborhood?: string | null;
  municipality?: string | null;
  [key: string]: unknown;
}

/** GET /users/{USER_ID}/addresses */
export async function consultarEnderecosML(
  empresaId: string,
  userId: string,
): Promise<EnderecoML[]> {
  const cadastro = await obterCadastroConectado(empresaId);
  const resposta = await chamarML(
    empresaId,
    cadastro.id,
    'GET',
    `/users/${userId}/addresses`,
  );
  if (!resposta.ok) {
    throw new ErroDeNegocio(
      `Não foi possível consultar endereços do usuário ${userId} (HTTP ${resposta.status}).`,
      resposta.status >= 500 ? 502 : 400,
    );
  }
  return (Array.isArray(resposta.dados) ? resposta.dados : []) as EnderecoML[];
}

// ---------------------------------------------------------------------------
// 5. Métodos de pagamento que o vendedor aceita
// ---------------------------------------------------------------------------

export interface MeioPagamentoML {
  id?: string | null;
  description?: string | null;
  type?: string | null;
  [key: string]: unknown;
}

/** GET /users/{USER_ID}/accepted_payment_methods */
export async function consultarMetodosPagamentoML(
  empresaId: string,
  userId: string,
): Promise<MeioPagamentoML[]> {
  const cadastro = await obterCadastroConectado(empresaId);
  const resposta = await chamarML(
    empresaId,
    cadastro.id,
    'GET',
    `/users/${userId}/accepted_payment_methods`,
  );
  if (!resposta.ok) {
    throw new ErroDeNegocio(
      `Não foi possível consultar meios de pagamento do usuário ${userId} (HTTP ${resposta.status}).`,
      resposta.status >= 500 ? 502 : 400,
    );
  }
  return (Array.isArray(resposta.dados) ? resposta.dados : []) as MeioPagamentoML[];
}

// ---------------------------------------------------------------------------
// 6. Dados da sua aplicação
// ---------------------------------------------------------------------------

export interface AplicacaoML {
  id?: string | null;
  name?: string | null;
  client_id?: string | null;
  redirect_uri?: string[] | null;
  [key: string]: unknown;
}

/** GET /applications/{APPLICATION_ID} */
export async function consultarAplicacaoML(
  empresaId: string,
  applicationId: string,
): Promise<AplicacaoML> {
  const cadastro = await obterCadastroConectado(empresaId);
  const resposta = await chamarML(
    empresaId,
    cadastro.id,
    'GET',
    `/applications/${applicationId}`,
  );
  if (!resposta.ok || !resposta.dados) {
    throw new ErroDeNegocio(
      `Não foi possível consultar a aplicação ${applicationId} (HTTP ${resposta.status}).`,
      resposta.status >= 500 ? 502 : 400,
    );
  }
  return resposta.dados as AplicacaoML;
}

// ---------------------------------------------------------------------------
// 7. Marcas do usuário
// ---------------------------------------------------------------------------

export interface MarcaML {
  id?: string | null;
  name?: string | null;
  [key: string]: unknown;
}

/** GET /users/{USER_ID}/brands */
export async function consultarMarcasML(
  empresaId: string,
  userId: string,
): Promise<MarcaML[]> {
  const cadastro = await obterCadastroConectado(empresaId);
  const resposta = await chamarML(
    empresaId,
    cadastro.id,
    'GET',
    `/users/${userId}/brands`,
  );
  if (!resposta.ok) {
    throw new ErroDeNegocio(
      `Não foi possível consultar marcas do usuário ${userId} (HTTP ${resposta.status}).`,
      resposta.status >= 500 ? 502 : 400,
    );
  }
  return (Array.isArray(resposta.dados) ? resposta.dados : []) as MarcaML[];
}

// ---------------------------------------------------------------------------
// 8. Pacotes de promoção (anúncios)
// ---------------------------------------------------------------------------

export interface PacotePromocaoML {
  id?: string | null;
  description?: string | null;
  [key: string]: unknown;
}

/** GET /users/{USER_ID}/classifieds_promotion_packs */
export async function consultarPacotesPromocaoML(
  empresaId: string,
  userId: string,
): Promise<PacotePromocaoML[]> {
  const cadastro = await obterCadastroConectado(empresaId);
  const resposta = await chamarML(
    empresaId,
    cadastro.id,
    'GET',
    `/users/${userId}/classifieds_promotion_packs`,
  );
  if (!resposta.ok) {
    throw new ErroDeNegocio(
      `Não foi possível consultar pacotes de promoção do usuário ${userId} (HTTP ${resposta.status}).`,
      resposta.status >= 500 ? 502 : 400,
    );
  }
  return (Array.isArray(resposta.dados) ? resposta.dados : []) as PacotePromocaoML[];
}

// ---------------------------------------------------------------------------
// 9. Buscar notificações perdidas (sincronização)
// ---------------------------------------------------------------------------

export interface NotificacaoPerdidaML {
  id?: string | null;
  user_id?: string | number | null;
  topic?: string | null;
  resource?: string | null;
  [key: string]: unknown;
}

/** GET /missed_feeds?app_id={APP_ID} — notificações perdidas da aplicação.
 *  Se userId for informado, filtra por vendedor específico.
 */
export async function consultarNotificacoesPerdidasML(
  empresaId: string,
  userId?: string,
): Promise<NotificacaoPerdidaML[]> {
  const cadastro = await obterCadastroConectado(empresaId);
  const appId = process.env.MERCADOLIVRE_CLIENT_ID;
  if (!appId) {
    throw new ErroDeNegocio(
      'MERCADOLIVRE_CLIENT_ID não configurado no ambiente.',
      500,
    );
  }
  const query = userId
    ? `?app_id=${encodeURIComponent(appId)}&user_id=${encodeURIComponent(userId)}`
    : `?app_id=${encodeURIComponent(appId)}`;
  const resposta = await chamarML(
    empresaId,
    cadastro.id,
    'GET',
    `/missed_feeds${query}`,
  );
  if (!resposta.ok) {
    throw new ErroDeNegocio(
      `Não foi possível consultar notificações perdidas (HTTP ${resposta.status}).`,
      resposta.status >= 500 ? 502 : 400,
    );
  }
  // A API oficial do Mercado Livre retorna { messages: [...] }. Não converter
  // um formato inesperado em []: isso faria a interface afirmar que não há
  // notificações perdidas quando, na verdade, não conseguimos interpretá-las.
  const messages = resposta.dados && typeof resposta.dados === 'object' && !Array.isArray(resposta.dados)
    ? (resposta.dados as { messages?: unknown }).messages
    : undefined;
  if (!Array.isArray(messages)) {
    throw new ErroDeNegocio(
      'Resposta inválida do Mercado Livre ao consultar notificações perdidas.',
      502,
    );
  }
  return messages as NotificacaoPerdidaML[];
}
