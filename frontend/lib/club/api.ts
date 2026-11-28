/**
 * NEXUS CLUB — cliente HTTP do consumidor.
 *
 * Sessão SEPARADA da sessão de funcionário: o crachá do cliente fica em `nexus_club_token`
 * (nunca em `nexus_token`) e não cria o cookie `nexus_auth` do painel. Assim o painel da
 * empresa nunca enxerga o cliente como logado, e o servidor recusa o crachá de um lado no outro.
 */
import { getApiBaseUrl } from '@/lib/api';

const CHAVE_TOKEN = 'nexus_club_token';
const CHAVE_CONTA = 'nexus_club_conta';

export interface TermoResumo { id: string; tipo: 'TERMOS_USO' | 'POLITICA_PRIVACIDADE' | string; versao: number; publicadoEm?: string }
export interface Termo extends TermoResumo { texto: string }
export interface ContaResumo { id: string; nome: string; email: string }
export interface Eu {
  id: string; nome: string; email: string; cpf: string | null; celular: string | null; whatsapp: string | null;
  nascimento: string | null; status: string; criadaEm: string; termosPendentes: TermoResumo[];
}

export class ErroClube extends Error {
  constructor(public status: number, mensagem: string, public dados: any = {}) { super(mensagem); }
  get codigo(): string | undefined { return this.dados?.codigo; }
}

function lerLocal(chave: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(chave); } catch { return null; }
}

export function tokenClube(): string | null {
  const t = lerLocal(CHAVE_TOKEN);
  return t && t !== 'undefined' && t !== 'null' ? t : null;
}

export function contaClube(): ContaResumo | null {
  try { return JSON.parse(lerLocal(CHAVE_CONTA) || 'null'); } catch { return null; }
}

export function salvarSessaoClube(token: string, conta?: ContaResumo) {
  try {
    localStorage.setItem(CHAVE_TOKEN, token);
    if (conta) localStorage.setItem(CHAVE_CONTA, JSON.stringify(conta));
  } catch { /* navegador sem armazenamento: a sessão dura só esta página */ }
}

export function limparSessaoClube() {
  try { localStorage.removeItem(CHAVE_TOKEN); localStorage.removeItem(CHAVE_CONTA); } catch { /* sem armazenamento */ }
}

async function pedir<T>(metodo: string, caminho: string, corpo?: unknown, autenticado = false): Promise<T> {
  const token = autenticado ? tokenClube() : null;
  if (autenticado && !token) throw new ErroClube(401, 'Entre na sua conta do NEXUS CLUB.');
  const res = await fetch(`${getApiBaseUrl()}${caminho}`, {
    method: metodo,
    headers: { ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    cache: 'no-store',
  });
  const texto = await res.text();
  let dados: any = {};
  try { dados = texto ? JSON.parse(texto) : {}; } catch { dados = { error: texto }; }
  if (!res.ok) {
    if (res.status === 401 && autenticado) limparSessaoClube();
    throw new ErroClube(res.status, dados?.error || dados?.message || `Erro ${res.status}`, dados);
  }
  return dados as T;
}

export const clubApi = {
  status: () => pedir<{ habilitado: boolean }>('GET', '/club/status'),
  termosVigentes: () => pedir<{ termos: Termo[]; completos: boolean }>('GET', '/club/termos/vigentes'),
  cadastro: (d: { nome: string; email: string; cpf: string; senha: string; celular?: string; whatsapp?: string; aceites: string[] }) =>
    pedir<{ message: string }>('POST', '/club/auth/cadastro', d),
  verificarEmail: (token: string) => pedir<{ ok: true }>('POST', '/club/auth/verificar-email', { token }),
  reenviarVerificacao: (email: string) => pedir<{ message: string }>('POST', '/club/auth/reenviar-verificacao', { email }),
  login: (login: string, senha: string) =>
    pedir<{ token: string; expiraEm: string; consumidor: ContaResumo; termosPendentes: TermoResumo[] }>('POST', '/club/auth/login', { login, senha }),
  logout: () => pedir<{ ok: true }>('POST', '/club/auth/logout', undefined, true),
  recuperarSenha: (email: string) => pedir<{ message: string }>('POST', '/club/auth/recuperar-senha', { email }),
  redefinirSenha: (token: string, novaSenha: string) => pedir<{ ok: true }>('POST', '/club/auth/redefinir-senha', { token, novaSenha }),
  eu: () => pedir<Eu>('GET', '/club/eu', undefined, true),
  atualizarEu: (d: { nome?: string; celular?: string | null; whatsapp?: string | null }) => pedir<Partial<Eu>>('PUT', '/club/eu', d, true),
  trocarSenha: (senhaAtual: string, novaSenha: string) => pedir<{ token: string }>('POST', '/club/eu/senha', { senhaAtual, novaSenha }, true),
  aceitarTermos: (aceites: string[]) => pedir<{ ok: true }>('POST', '/club/termos/aceitar', { aceites }, true),
};

export const ROTULO_TERMO: Record<string, string> = { TERMOS_USO: 'Termos de Uso', POLITICA_PRIVACIDADE: 'Política de Privacidade' };

/** Mesma regra do servidor: 8 a 72 caracteres, com letras e números. */
export function problemaSenha(s: string): string | null {
  if (s.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (s.length > 72) return 'A senha pode ter no máximo 72 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return 'A senha precisa ter letras e números.';
  return null;
}

/** Formata o CPF enquanto digita (000.000.000-00). */
export function mascaraCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

/** Dígitos verificadores do CPF (mesma conta do servidor), para avisar antes de enviar. */
export function cpfValido(v: string): boolean {
  const c = v.replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dig = (n: number) => {
    const soma = c.slice(0, n).split('').reduce((a, d, i) => a + Number(d) * (n + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dig(9) === Number(c[9]) && dig(10) === Number(c[10]);
}
