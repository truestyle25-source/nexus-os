/**
 * NEXUS OS - Etapa 2 - Camada de dados do Mercado Livre (frontend).
 * Reutiliza lib/api.ts por injecao ({ get, put }). Base real
 * /integracoes/mercadolivre, resposta { ok: true, dados }.
 */

import { mensagemDeErroApi } from './erros-api';

export const BASE_ML = '/integracoes/mercadolivre';

export interface ClienteApiML {
  get<T = unknown>(path: string, config?: { params?: Record<string, unknown> }): Promise<{ data: T }>;
  put<T = unknown>(path: string, body?: unknown): Promise<{ data: T }>;
}

export interface UsuarioML {
  id?: number | string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  nickname?: string | null;
  [key: string]: unknown;
}

export interface EnderecoML {
  id?: string | number | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  [key: string]: unknown;
}

export interface MeioPagamentoML {
  id?: string | null;
  name?: string | null;
  [key: string]: unknown;
}

export interface AplicacaoML {
  id?: string | null;
  name?: string | null;
  client_id?: string | null;
  redirect_uri?: string[] | null;
  [key: string]: unknown;
}

export interface MarcaML {
  id?: string | null;
  name?: string | null;
  [key: string]: unknown;
}

export interface PacotePromocaoML {
  id?: string | null;
  description?: string | null;
  [key: string]: unknown;
}

export interface NotificacaoPerdidaML {
  id?: string | null;
  user_id?: string | number | null;
  topic?: string | null;
  resource?: string | null;
  [key: string]: unknown;
}

/** Allowlist do PUT - espelho do strictObject da rota (corpo parcial). */
export interface AtualizarUsuarioMLInput {
  first_name?: string;
  last_name?: string;
  phone?: { area_code?: string; number?: string };
  address?: { address?: string; city?: string; state?: string; zip_code?: string };
  company?: { corporate_name?: string; brand_name?: string };
}

export interface FormAtualizacaoML {
  first_name?: unknown;
  last_name?: unknown;
  phone_area_code?: unknown;
  phone_number?: unknown;
  address_address?: unknown;
  address_city?: unknown;
  address_state?: unknown;
  address_zip_code?: unknown;
  company_corporate_name?: unknown;
  company_brand_name?: unknown;
}

export type EstadoSecao =
  | { estado: 'ocioso' }
  | { estado: 'carregando' }
  | { estado: 'sucesso'; dados: unknown }
  | { estado: 'vazio' }
  | { estado: 'nao_conectado'; mensagem: string }
  | { estado: 'sessao_invalida'; mensagem: string }
  | { estado: 'sem_permissao'; mensagem: string }
  | { estado: 'validacao'; mensagem: string }
  | { estado: 'falha_comunicacao'; mensagem: string }
  | { estado: 'inesperado'; mensagem: string }
  | { estado: 'erro'; mensagem: string };

export type TipoResposta = 'objeto' | 'lista';

export function classificarErroML(erro: unknown, padrao: string): EstadoSecao {
  const status = (erro as { status?: unknown } | null | undefined)?.status;
  if (typeof status !== 'number') {
    return { estado: 'falha_comunicacao', mensagem: 'Falha de comunicacao com o servidor.' };
  }
  const mensagem = mensagemDeErroApi(erro, padrao);
  if (status === 401) {
    return { estado: 'sessao_invalida', mensagem: 'Sessao invalida ou expirada. Entre novamente.' };
  }
  if (status === 403) {
    return { estado: 'sem_permissao', mensagem };
  }
  if (status === 400 && /n[aã]o conectada/i.test(mensagem)) {
    return { estado: 'nao_conectado', mensagem };
  }
  if (status === 400 && /dados inv[aá]lidos/i.test(mensagem)) {
    return { estado: 'validacao', mensagem };
  }
  return { estado: 'erro', mensagem };
}

export async function executarConsulta(
  chamada: () => Promise<{ data: { ok?: unknown; dados?: unknown } }>,
  opcoes: { tipo: TipoResposta; padrao?: string } = { tipo: 'objeto' },
): Promise<EstadoSecao> {
  let data: { ok?: unknown; dados?: unknown };
  try {
    ({ data } = await chamada());
  } catch (erro) {
    return classificarErroML(erro, opcoes.padrao ?? 'Nao foi possivel consultar os dados.');
  }
  const corpo = data ?? {};
  if (corpo.ok !== true || corpo.dados === undefined || corpo.dados === null) {
    return { estado: 'inesperado', mensagem: 'Resposta inesperada do servidor.' };
  }
  if (opcoes.tipo === 'lista') {
    if (!Array.isArray(corpo.dados)) {
      return { estado: 'inesperado', mensagem: 'Resposta inesperada do servidor (lista malformada).' };
    }
    return corpo.dados.length === 0 ? { estado: 'vazio' } : { estado: 'sucesso', dados: corpo.dados };
  }
  if (typeof corpo.dados !== 'object' || Array.isArray(corpo.dados)) {
    return { estado: 'inesperado', mensagem: 'Resposta inesperada do servidor.' };
  }
  return { estado: 'sucesso', dados: corpo.dados };
}

export class TravaEnvio {
  private ocupada = false;
  get emAndamento(): boolean {
    return this.ocupada;
  }
  async executar<T>(fn: () => Promise<T>): Promise<{ executou: boolean; resultado?: T }> {
    if (this.ocupada) return { executou: false };
    this.ocupada = true;
    try {
      return { executou: true, resultado: await fn() };
    } finally {
      this.ocupada = false;
    }
  }
}

export function dadosDeSucesso<T>(secao: EstadoSecao): T | null {
  return secao.estado === 'sucesso' ? (secao.dados as T) : null;
}

function limpa(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function montarCorpoAtualizacaoML(form: FormAtualizacaoML): { corpo?: AtualizarUsuarioMLInput; erro?: string } {
  const corpo: AtualizarUsuarioMLInput = {};
  const fn = limpa(form.first_name);
  const ln = limpa(form.last_name);
  if (fn) corpo.first_name = fn;
  if (ln) corpo.last_name = ln;
  const ac = limpa(form.phone_area_code);
  const nb = limpa(form.phone_number);
  if (ac || nb) {
    corpo.phone = {};
    if (ac) corpo.phone.area_code = ac;
    if (nb) corpo.phone.number = nb;
  }
  const ad = limpa(form.address_address);
  const ci = limpa(form.address_city);
  const st = limpa(form.address_state);
  const zp = limpa(form.address_zip_code);
  if (ad || ci || st || zp) {
    corpo.address = {};
    if (ad) corpo.address.address = ad;
    if (ci) corpo.address.city = ci;
    if (st) corpo.address.state = st;
    if (zp) corpo.address.zip_code = zp;
  }
  const cn = limpa(form.company_corporate_name);
  const bn = limpa(form.company_brand_name);
  if (cn || bn) {
    corpo.company = {};
    if (cn) corpo.company.corporate_name = cn;
    if (bn) corpo.company.brand_name = bn;
  }
  if (Object.keys(corpo).length === 0) {
    return { erro: 'Preencha ao menos um campo para atualizar.' };
  }
  return { corpo };
}

/** 1. GET /users/{userId} - dados de qualquer usuario pelo ID. */
export async function consultarUsuarioPorIdML(cliente: ClienteApiML, userId: string): Promise<EstadoSecao> {
  const id = typeof userId === 'string' ? userId.trim() : '';
  if (!id) return { estado: 'validacao', mensagem: 'Informe o ID do usuario do Mercado Livre.' };
  return executarConsulta(() => cliente.get(`${BASE_ML}/users/${encodeURIComponent(id)}`), { tipo: 'objeto' });
}

/** 2. PUT /users/me - atualizacao parcial (allowlist, sem extras). */
export async function atualizarUsuarioML(cliente: ClienteApiML, corpo: AtualizarUsuarioMLInput): Promise<EstadoSecao> {
  try {
    const { data } = await cliente.put(`${BASE_ML}/users/me`, corpo);
    const ok = (data as { ok?: unknown } | null | undefined)?.ok;
    const dados = (data as { dados?: unknown } | null | undefined)?.dados;
    if (ok !== true || dados === undefined || dados === null || typeof dados !== 'object' || Array.isArray(dados)) {
      return { estado: 'inesperado', mensagem: 'Resposta inesperada do servidor.' };
    }
    return { estado: 'sucesso', dados };
  } catch (erro) {
    return classificarErroML(erro, 'Nao foi possivel atualizar os dados no Mercado Livre.');
  }
}

/** 3. GET /users/me - usuario autenticado (pelo token da conta). */
export async function consultarUsuarioLogadoML(cliente: ClienteApiML): Promise<EstadoSecao> {
  return executarConsulta(() => cliente.get(`${BASE_ML}/users/me`), { tipo: 'objeto' });
}

/** 4. GET /users/{userId}/addresses - enderecos (lista). */
export async function consultarEnderecosML(cliente: ClienteApiML, userId: string): Promise<EstadoSecao> {
  const id = typeof userId === 'string' ? userId.trim() : '';
  if (!id) return { estado: 'validacao', mensagem: 'Informe o ID do usuario do Mercado Livre.' };
  return executarConsulta(() => cliente.get(`${BASE_ML}/users/${encodeURIComponent(id)}/addresses`), { tipo: 'lista' });
}

/** 5. GET /users/{userId}/accepted_payment_methods - meios de pagamento (lista). */
export async function consultarMeiosPagamentoML(cliente: ClienteApiML, userId: string): Promise<EstadoSecao> {
  const id = typeof userId === 'string' ? userId.trim() : '';
  if (!id) return { estado: 'validacao', mensagem: 'Informe o ID do usuario do Mercado Livre.' };
  const path = `${BASE_ML}/users/${encodeURIComponent(id)}/accepted_payment_methods`;
  return executarConsulta(() => cliente.get(path), { tipo: 'lista' });
}

/** 6. GET /applications/{applicationId} - detalhes da aplicacao. */
export async function consultarAplicacaoML(cliente: ClienteApiML, applicationId: string): Promise<EstadoSecao> {
  const id = typeof applicationId === 'string' ? applicationId.trim() : '';
  if (!id) return { estado: 'validacao', mensagem: 'Informe o ID da aplicacao do Mercado Livre.' };
  return executarConsulta(() => cliente.get(`${BASE_ML}/applications/${encodeURIComponent(id)}`), { tipo: 'objeto' });
}

/** 7. GET /users/{userId}/brands - marcas (lista). */
export async function consultarMarcasML(cliente: ClienteApiML, userId: string): Promise<EstadoSecao> {
  const id = typeof userId === 'string' ? userId.trim() : '';
  if (!id) return { estado: 'validacao', mensagem: 'Informe o ID do usuario do Mercado Livre.' };
  return executarConsulta(() => cliente.get(`${BASE_ML}/users/${encodeURIComponent(id)}/brands`), { tipo: 'lista' });
}

/** 8. GET /users/{userId}/classifieds_promotion_packs - pacotes (lista). */
export async function consultarPacotesPromocaoML(cliente: ClienteApiML, userId: string): Promise<EstadoSecao> {
  const id = typeof userId === 'string' ? userId.trim() : '';
  if (!id) return { estado: 'validacao', mensagem: 'Informe o ID do usuario do Mercado Livre.' };
  const path = `${BASE_ML}/users/${encodeURIComponent(id)}/classifieds_promotion_packs`;
  return executarConsulta(() => cliente.get(path), { tipo: 'lista' });
}

/** 9. GET /missed_feeds?user_id= - notificacoes perdidas (somente leitura). */
export async function consultarNotificacoesPerdidasML(cliente: ClienteApiML, userId?: string): Promise<EstadoSecao> {
  const id = typeof userId === 'string' ? userId.trim() : '';
  const params = id ? { user_id: id } : undefined;
  return executarConsulta(() => cliente.get(`${BASE_ML}/missed_feeds`, params ? { params } : undefined), {
    tipo: 'lista',
    padrao: 'Nao foi possivel consultar as notificacoes do Mercado Livre.',
  });
}
