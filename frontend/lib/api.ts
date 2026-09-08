const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

const TOKEN_KEY = 'nexus_os_access_token';

export interface ApiError {
  error: string;
  code?: string;
}

export function saveToken(token: string) {
  if (typeof window !== 'undefined') localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  if (typeof window !== 'undefined') localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

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
