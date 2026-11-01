// NEXUS OS - Cliente HTTP centralizado

const DEFAULT_API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3333'
    : 'https://nexus-os-7u4g.onrender.com');

function getApiUrl(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_API_URL;
  }

  const stored = localStorage.getItem('nexus_api_url')?.trim();

  if (stored) {
    try {
      const url = new URL(stored);

      if (url.protocol === 'http:' || url.protocol === 'https:') {
        // AUTO-CURA: se a URL salva aponta para o próprio frontend
        // (mesma origin, ex.: http://localhost:3000 ou com caminho
        // /login/...), ela é inválida — o backend nunca é o Next.
        // Apaga e volta para o padrão (http://localhost:3333).
        if (url.origin === window.location.origin) {
          localStorage.removeItem('nexus_api_url');
          return DEFAULT_API_URL;
        }

        // Usa só a origin (protocolo + host + porta), ignorando
        // qualquer caminho que o usuário tenha colado sem querer
        // (ex.: http://localhost:3333/clientes -> http://localhost:3333).
        return url.origin;
      }
    } catch {
      // Valor inválido: limpa e usa a URL padrão.
      localStorage.removeItem('nexus_api_url');
    }
  }

  return DEFAULT_API_URL;
}

export const API_URL =
  typeof window !== 'undefined'
    ? getApiUrl()
    : DEFAULT_API_URL;

function baseUrl(): string {
  return getApiUrl();
}

/** Exposes the same effective origin used by API calls for health checks. */
export function getApiBaseUrl(): string {
  return baseUrl();
}

async function requestFull<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data: T; headers: Headers }> {
  // Usa o token já higienizado (nunca "undefined"/"null" como string).
  const token = getToken();

  const companyId =
    typeof window !== 'undefined'
      ? localStorage.getItem('nexus_companyId')
      : null;

  const normalizedPath = path.startsWith('/')
    ? path
    : `/${path}`;

  const res = await fetch(
    `${baseUrl()}${normalizedPath}`,
    {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {}),
        ...(companyId
          ? { 'x-company-id': companyId }
          : {}),
        ...(options.headers || {}),
      },
      cache: 'no-store',
    },
  );

  const text = await res.text();

  let data: any = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!res.ok) {
    // 401 no próprio login (credencial errada/limiter) NÃO pode limpar
    // sessão nem redirecionar — só informa o erro na tela de login.
    const isAuthAttempt =
      normalizedPath === '/auth/login' ||
      normalizedPath === '/auth/register-company';
    if (res.status === 401 && typeof window !== 'undefined' && !isAuthAttempt) {
      clearToken();
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    throw new ApiHttpError(
      res.status,
      data?.error ||
      data?.message ||
      `Erro HTTP ${res.status}`,
      data,
    );
  }

  return { data: data as T, headers: res.headers };
}

/**
 * Atalho de `requestFull` que devolve só o corpo.
 *
 * Existe para que a nova informação de headers NÃO quebre nenhum dos chamadores
 * existentes: todos continuam recebendo o corpo puro, como sempre.
 */
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return (await requestFull<T>(path, options)).data;
}

export interface ApiError {
  error: string;
  code?: string;
}

export class ApiHttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly data: unknown) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

export interface Product {
  id: string;
  empresaId: string;
  nome: string;
  sku: string | null;
  codigoBarras?: string | null;
  custo?: number;
  precoVenda: number;
  unidade: string;
  estoqueMinimo: number;
  estoqueMaximo?: number;
  status: string;
  createdAt: string;
  updatedAt: string;

  estoques?: Array<{
    quantidade: number;
    filialId: string;
  }>;

  name: string;
  cost?: number;
  salePrice: number;
  unit: string;
  currentStock: number;
  minimumStock: number;
}

export interface AdminUser {
  id: string;
  empresaId?: string;
  setorId?: string | null;
  roleId?: string;
  nome: string;
  email: string;
  status: string;
  createdAt: string;
  name: string;
}

export interface AdminRole {
  id: string;
  empresaId?: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
}

export interface AuditEntry {
  id: string;
  usuarioId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  origin: string;
  createdAt: string;
}

function mapProduct(p: any): Product {
  const currentStock = Array.isArray(p.estoques)
    ? p.estoques.reduce(
        (n: number, e: any) =>
          n + Number(e.quantidade || 0),
        0,
      )
    : Number(p.estoqueAtual || 0);

  return {
    ...p,
    name: p.nome,
    cost: p.custo,
    salePrice: Number(p.precoVenda || 0),
    unit: p.unidade || 'UN',
    currentStock,
    minimumStock: Number(p.estoqueMinimo || 0),
  };
}

function mapUser(u: any): AdminUser {
  return {
    ...u,
    name: u.nome,
  };
}

function mapAudit(a: any): AuditEntry {
  return {
    ...a,
    action: a.acao,
    entity: a.entidade,
    entityId: a.entidadeId,
    origin: a.origem,
  };
}

export function getToken() {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = localStorage.getItem('nexus_token');

  // Higieniza valores inválidos que quebram o Bearer (ex.: string
  // "undefined"/"null" gravada por um saveToken sem validação).
  if (!raw || raw === 'undefined' || raw === 'null' || raw.trim() === '') {
    if (raw) {
      clearToken();
    }

    return null;
  }

  return raw;
}

export function saveToken(token: string) {
  // Nunca persiste token ausente/inválido: evita o "Bearer undefined"
  // que gerava 401 ("Não autenticado") em todas as chamadas.
  if (!token || token === 'undefined' || token === 'null' || token.trim() === '') {
    throw new Error('Token de autenticação inválido.');
  }

  localStorage.setItem('nexus_token', token);
  // Flag de sessão para o middleware de rota (frontend/middleware.ts).
  // Não é o token JWT — apenas indica que existe uma sessão ativa.
  document.cookie = 'nexus_auth=1; path=/; max-age=28800; SameSite=Lax';
}

export function clearToken() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('nexus_token');
    localStorage.removeItem('nexus_companyId');
    localStorage.removeItem('nexus_user');
    // Remove a flag do middleware.
    document.cookie = 'nexus_auth=; path=/; max-age=0; SameSite=Lax';
  }
}

export async function login(
  email: string,
  password: string,
) {
  const data = await request<any>(
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({
        email,
        senha: password,
      }),
    },
  );

  if (!data?.token) {
    throw new Error('Resposta de login inválida.');
  }

  return data;
}

export async function registerCompany(input: any) {
  const data = await request<any>(
    '/auth/register-company',
    {
      method: 'POST',
      body: JSON.stringify({
        nomeEmpresa:
          input.companyName ??
          input.nomeEmpresa,

        cnpj:
          String(input.cnpj || '')
            .replace(/\D/g, '') ||
          undefined,

        nome:
          input.responsibleName ??
          input.nomeResponsavel ??
          input.nome,

        email: input.email,

        senha:
          input.password ??
          input.senha,
      }),
    },
  );

  if (!data?.token) {
    throw new Error('Resposta de cadastro inválida.');
  }

  return {
    companyId: data.usuario?.empresaId,
    ...data,
  };
}

export async function logout() {
  try {
    await request('/auth/logout', {
      method: 'POST',
    });
  } catch {}

  clearToken();
}

export async function fetchProducts() {
  const data = await request<any>(
    '/produtos?take=200',
  );

  return (data.produtos || [])
    .map(mapProduct) as Product[];
}

export async function fetchAllProducts(filters: { search?: string } = {}) {
  const pageSize = 200;
  const products: Product[] = [];
  let skip = 0;
  let total = Number.POSITIVE_INFINITY;
  let metadata: { total: number; podeVerCusto: boolean; podeEditarCusto: boolean; valorEstoque: number | null; fusoHorario: string; contagens: { total: number; ativos: number; inativos: number; semEstoque: number; estoqueBaixo: number } } = {
    total: 0,
    podeVerCusto: false,
    podeEditarCusto: false,
    valorEstoque: null,
    fusoHorario: 'America/Sao_Paulo',
    contagens: { total: 0, ativos: 0, inativos: 0, semEstoque: 0, estoqueBaixo: 0 },
  };

  while (skip < total) {
    const params = new URLSearchParams({ take: String(pageSize), skip: String(skip) });
    if (filters.search?.trim()) params.set('search', filters.search.trim());
    const data = await request<any>(`/produtos?${params.toString()}`);
    if (skip === 0) {
      metadata = {
        total: Number(data.total || 0),
        podeVerCusto: Boolean(data.podeVerCusto),
        podeEditarCusto: Boolean(data.podeEditarCusto),
        valorEstoque: data.valorEstoque == null ? null : Number(data.valorEstoque),
        fusoHorario: data.fusoHorario || 'America/Sao_Paulo',
        contagens: data.contagens || metadata.contagens,
      };
    }
    const page = (data.produtos || []).map(mapProduct) as Product[];
    products.push(...page);
    total = Number(data.total || 0);
    if (page.length === 0) break;
    skip += page.length;
  }

  return { products, ...metadata };
}

export async function fetchProductCategories() {
  return request<Array<{ id: string; nome: string }>>('/categorias');
}

export async function createProduct(input: {
  name: string;
  sku: string;
  cost: number;
  salePrice: number;
  minimumStock: number;
  maximumStock?: number;
  barcode?: string;
  categoryId?: string;
  unit?: string;
  description?: string;
  brand?: string;
  reorderPoint?: number;
  location?: string;
  weight?: string;
  ncm?: string;
}) {
  const p = await request<any>(
    '/produtos',
    {
      method: 'POST',
      body: JSON.stringify({
        nome: input.name,
        marca: input.brand || undefined,
        sku: input.sku,
        codigoBarras: input.barcode || undefined,
        categoriaId: input.categoryId || undefined,
        custo: input.cost,
        precoVenda: input.salePrice,
        unidade: input.unit || 'UN',
        estoqueMinimo: input.minimumStock,
        estoqueMaximo: Math.max(input.minimumStock, input.maximumStock ?? 100),
        pontoPedido: input.reorderPoint ?? 0,
        local: input.location || undefined,
        peso: input.weight || undefined,
        ncm: input.ncm || undefined,
        descricao: input.description || undefined,
      }),
    },
  );

  return mapProduct(p);
}

export async function createInventoryMovement(
  productId: string,
  input: any,
) {
  const typeMap: Record<string, string> = {
    entry: 'ENTRADA',
    exit: 'SAIDA',
    adjustment: 'AJUSTE',
    loss: 'PERDA',
    return: 'DEVOLUCAO',
  };

  return request(
    '/estoque/movimentar',
    {
      method: 'POST',
      body: JSON.stringify({
        produtoId: productId,
        filialId: input.filialId,
        quantidade: Math.max(
          1,
          Math.trunc(input.quantity),
        ),
        tipo:
          typeMap[input.type] ||
          input.type,
        motivo:
          input.reason ||
          undefined,
      }),
    },
  );
}

export async function fetchAdminUsers() {
  const data = await request<any[]>(
    '/usuarios',
  );

  return data.map(mapUser);
}

export async function fetchAdminAudit() {
  const data = await request<any[]>(
    '/auditoria',
  );

  return data.map(mapAudit);
}

export async function createAdminUser(input: {
  name: string;
  email: string;
  password: string;
  roleId?: string;
}) {
  const u = await request<any>(
    '/usuarios',
    {
      method: 'POST',
      body: JSON.stringify({
        nome: input.name,
        email: input.email,
        senha: input.password,
      }),
    },
  );

  return mapUser(u);
}

export const api = {
  login,
  registerCompany,
  logout,

  setToken: saveToken,

  getToken,

  getAuthHeaders() {
    const token = getToken();

    return {
      'Content-Type': 'application/json',

      ...(token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {}),

      'x-company-id':
        typeof window !== 'undefined'
          ? localStorage.getItem(
              'nexus_companyId',
            ) || ''
          : '',
    };
  },

  async get<T = any>(
    path: string,
    config?: {
      params?: Record<string, unknown>;
    },
  ): Promise<{ data: T }> {
    const qs = config?.params
      ? Object.entries(config.params)
          .filter(
            ([, v]) =>
              v !== undefined &&
              v !== '',
          )
          .map(
            ([k, v]) =>
              `${encodeURIComponent(k)}=${encodeURIComponent(
                String(v),
              )}`,
          )
          .join('&')
      : '';

    return {
      data: await request<T>(
        qs
          ? `${path}${
              path.includes('?')
                ? '&'
                : '?'
            }${qs}`
          : path,
      ),
    };
  },

  /**
   * Igual ao `get`, mas devolve também os headers da resposta.
   *
   * Existe para quando o servidor precisa sinalizar algo que não cabe no corpo —
   * hoje, `X-Truncated`/`X-Total-Count` de `/ponto`, para a tela avisar que o
   * histórico veio cortado em vez de fingir que é tudo. Nenhum chamador antigo
   * muda de comportamento: quem usa `get` continua recebendo só o corpo.
   */
  async getComHeaders<T = any>(
    path: string,
    config?: { params?: Record<string, unknown> },
  ): Promise<{ data: T; headers: Headers }> {
    const qs = config?.params
      ? Object.entries(config.params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return requestFull<T>(
      qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path,
    );
  },

  /**
   * Baixa um arquivo binário protegido pelo token de sessão.
   *
   * Existe porque `request` faz `res.json()` em toda resposta, e um PDF não é
   * JSON: o parse lançaria antes de o arquivo chegar ao navegador. Abrir a URL
   * numa aba nova também não serve — o cabeçalho `Authorization` não acompanharia
   * e o servidor responderia 401. Então a chamada é feita por aqui, com o token,
   * e o corpo volta como `Blob` já com o nome de arquivo de `Content-Disposition`.
   *
   * POR QUE O MÉTODO É UM PARÂMETRO
   * ------------------------------
   * As rotas de documento não são todas iguais: o PDF da folha e o recibo são
   * `GET` (`/rh/folhas/:id/completa`, `/rh/folhas/:id/recibo/:id`), enquanto o
   * termo de advertência, a notificação de suspensão, o termo de desligamento e o
   * dossiê são `POST` (a geração é uma ação, não uma leitura).
   *
   * Com o método fixo em POST, o botão "Exportar folha" recebia
   * `404 Route POST:/rh/folhas/... not found` — o Fastify não casa o verbo, e o
   * download nunca acontecia. Com o método fixo em GET, o oposto: os cinco
   * documentos que hoje funcionam passariam a dar 405.
   *
   * Por isso o verbo viaja com a chamada, e o padrão é GET: leitura é o caso
   * comum de um download, e quem gera documento passa a declarar `post: true`.
   */
  async download(
    path: string,
    opts: { post?: boolean; body?: unknown } = {},
  ): Promise<{ blob: Blob; nome: string }> {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: opts.post ? 'POST' : 'GET',
      headers: {
        // Só no POST. Um GET com `Content-Type: application/json` e sem corpo
        // é recusado pelo Fastify com 400 ("Body cannot be empty when
        // content-type is set to 'application/json'") — a checagem de corpo
        // vazio acontece antes do roteamento, então o verbo nem é considerado.
        ...(opts.post ? { 'Content-Type': 'application/json' } : {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      // O corpo {} é obrigatório no POST: as rotas de documento leem `req.body`
      // e recusam corpo vazio. O chamador pode sobrepor, mas o padrão serve.
      ...(opts.post ? { body: JSON.stringify(opts.body ?? {}) } : {}),
    });

    if (!res.ok) {
      // A resposta de erro é JSON mesmo quando o sucesso seria PDF.
      let mensagem = `Falha ao baixar o arquivo (HTTP ${res.status}).`;
      try {
        const corpo = await res.json();
        // `message` vem antes de `error`: é o campo que diz o que aconteceu
        // ("Route POST:/rh/... not found"). Preferir `error` devolvia só o
        // genérico "Not Found", que não diz nada ao operador.
        if (corpo?.message) mensagem = String(corpo.message);
        else if (corpo?.error) mensagem = String(corpo.error);
      } catch {
        /* corpo não-JSON: fica a mensagem com o status */
      }
      throw new Error(mensagem);
    }

    const disposicao = res.headers.get('content-disposition') ?? '';
    const nome =
      disposicao.match(/filename="([^"]+)"/)?.[1] ??
      path.split('/').pop() ??
      'documento.pdf';
    return { blob: await res.blob(), nome };
  },

  async post<T = any>(
    path: string,
    body?: unknown,
    config?: { headers?: Record<string, string> },
  ): Promise<{ data: T }> {
    return {
      data: await request<T>(
        path,
        {
          method: 'POST',
          body:
            body === undefined
              ? undefined
              : JSON.stringify(body),
          headers: config?.headers,
        },
      ),
    };
  },

  async put<T = any>(
    path: string,
    body?: unknown,
  ): Promise<{ data: T }> {
    return {
      data: await request<T>(
        path,
        {
          method: 'PUT',
          body:
            body === undefined
              ? undefined
              : JSON.stringify(body),
        },
      ),
    };
  },

  async patch<T = any>(
    path: string,
    body?: unknown,
  ): Promise<{ data: T }> {
    return {
      data: await request<T>(
        path,
        {
          method: 'PATCH',
          body:
            body === undefined
              ? undefined
              : JSON.stringify(body),
        },
      ),
    };
  },

  async delete<T = any>(
    path: string,
  ): Promise<{ data: T }> {
    return {
      data: await request<T>(
        path,
        {
          method: 'DELETE',
        },
      ),
    };
  },
};

export default api;
