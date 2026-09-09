const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

const TOKEN_KEY = 'nexus_os_access_token';
const REFRESH_TOKEN_KEY = 'nexus_os_refresh_token';

export interface ApiError {
  error: string;
  code?: string;
}

export function saveToken(token: string) {
  if (typeof window !== 'undefined') localStorage.setItem(TOKEN_KEY, token);
}

export function saveSession(session: Pick<LoginResponse, 'accessToken' | 'refreshToken'>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, session.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;
  const res = await fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    clearToken();
    return null;
  }
  const session = await res.json() as LoginResponse;
  saveSession(session);
  return session.accessToken;
}

export async function logout() {
  const refreshToken = typeof window === 'undefined' ? null : localStorage.getItem(REFRESH_TOKEN_KEY);
  if (refreshToken) {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
  clearToken();
}

async function request<T>(path: string, options: RequestInit = {}, canRefresh = true): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && canRefresh && !path.includes('/api/auth/')) {
    const renewedToken = await refreshAccessToken();
    if (renewedToken) return request<T>(path, options, false);
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = (data as ApiError)?.error ?? 'Erro inesperado ao comunicar com o servidor';
    throw new Error(message);
  }

  return data as T;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; roleId: string; companyId: string };
  company: { id: string; name: string; cnpj: string; status: string; trialEndsAt: string };
}

export function login(email: string, password: string) {
  return request<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function registerCompany(input: {
  companyName: string;
  cnpj: string;
  responsibleName: string;
  email: string;
  password: string;
  confirmPassword: string;
}) {
  return request<LoginResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  status: string;
  role: { id: string; name: string; permissions: string[] };
}

export function fetchMe() {
  return request<MeResponse>('/api/me');
}

export interface AdminUser {
  id: string;
  companyId: string;
  sectorId: string | null;
  roleId: string;
  name: string;
  email: string;
  status: string;
  createdAt: string;
}

export interface AdminRole {
  id: string;
  companyId: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
}

export interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  origin: string;
  createdAt: string;
}

export function fetchAdminUsers() {
  return request<AdminUser[]>('/api/admin/users');
}

export function fetchAdminRoles() {
  return request<AdminRole[]>('/api/admin/roles');
}

export function fetchAdminAudit() {
  return request<AuditEntry[]>('/api/admin/audit');
}

export function createAdminUser(input: { name: string; email: string; password: string; roleId: string }) {
  return request<AdminUser>('/api/admin/users', { method: 'POST', body: JSON.stringify(input) });
}

export interface Product {
  id: string;
  companyId: string;
  name: string;
  sku: string;
  barcode: string | null;
  cost: number;
  salePrice: number;
  unit: string;
  currentStock: number;
  minimumStock: number;
  maximumStock: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function fetchProducts() {
  return request<Product[]>('/api/products');
}

export function createProduct(input: { name: string; sku: string; cost: number; salePrice: number; minimumStock: number }) {
  return request<Product>('/api/products', { method: 'POST', body: JSON.stringify(input) });
}

export function createInventoryMovement(productId: string, input: { quantity: number; type: 'entry' | 'exit' | 'adjustment' | 'loss' | 'return'; reason: string }) {
  return request(`/api/products/${productId}/movements`, { method: 'POST', body: JSON.stringify(input) });
}
