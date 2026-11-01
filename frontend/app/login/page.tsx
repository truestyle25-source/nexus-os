'use client';

import { useEffect, useState } from 'react';
import { api, API_URL, saveToken, clearToken } from '@/lib/api';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
const router = useRouter();
const [tab, setTab] = useState<'entrar' | 'criar'>('entrar');
const [showSenha, setShowSenha] = useState(false);
const [showSenha2, setShowSenha2] = useState(false);

// Mantemos vazio durante a renderização inicial para evitar
// diferença entre HTML do servidor e HTML do navegador.
const [apiUrl, setApiUrl] = useState('');
const [editingApi, setEditingApi] = useState(false);
const [loading, setLoading] = useState(false);
const [error, setError] = useState('');

// Carrega a URL da API somente depois que o componente monta no navegador.
useEffect(() => {
setApiUrl(API_URL);

// Sessão antiga: token no localStorage mas sem o cookie nexus_auth
// (ex.: login feito antes do middleware existir). Renova o cookie
// e manda direto para o dashboard em vez de forçar novo login.
const token = localStorage.getItem('nexus_token');
if (token && token !== 'undefined' && token !== 'null' && token.trim() !== '') {
  try {
    saveToken(token);
    router.replace('/');
  } catch {
    clearToken();
  }
} else if (token) {
  clearToken();
}
}, []);

// Login form
const [email, setEmail] = useState('');
const [senha, setSenha] = useState('');

// Register form
const [form, setForm] = useState({
nomeEmpresa: '',
cnpj: '',
nomeResponsavel: '',
email: '',
senha: '',
confirmarSenha: ''
});

const handleLogin = async (e: React.FormEvent) => {
e.preventDefault();
setError('');
setLoading(true);

try {
  const data = await api.login(email, senha);

  if (!data?.token) {
    setError('Resposta de login inválida.');
    return;
  }

  const usuarioLogin = data.usuario || data.user;

  if (!usuarioLogin) {
    setError('Resposta de login inválida.');
    return;
  }

  saveToken(data.token); // grava nexus_token no localStorage + cookie nexus_auth do middleware
  localStorage.setItem(
    'nexus_companyId',
    usuarioLogin?.empresaId ||
      data.companyId ||
      data.company?.id ||
      ''
  );
  localStorage.setItem(
    'nexus_user',
    JSON.stringify(usuarioLogin)
  );

  router.push('/');
} catch (err: any) {
  setError(
    err?.message || 'Não foi possível concluir a operação.'
  );
} finally {
  setLoading(false);
}

};

const handleRegister = async (e: React.FormEvent) => {
e.preventDefault();
setError('');

if (form.senha !== form.confirmarSenha) {
  setError('Senhas não conferem');
  return;
}

if (form.senha.length < 8) {
  setError('Senha mínimo 8 caracteres');
  return;
}

setLoading(true);

try {
  const data = await api.registerCompany(form);

  if (!data?.token) {
    setError('Resposta de cadastro inválida.');
    return;
  }

  const usuarioCadastro = data.usuario || data.user;

  if (!usuarioCadastro) {
    setError('Resposta de cadastro inválida.');
    return;
  }

  saveToken(data.token); // grava nexus_token no localStorage + cookie nexus_auth do middleware
  localStorage.setItem(
    'nexus_companyId',
    usuarioCadastro?.empresaId || data.companyId || ''
  );
  localStorage.setItem(
    'nexus_user',
    JSON.stringify(usuarioCadastro)
  );

  router.push('/');
} catch (err: any) {
  setError(
    err?.message || 'Não foi possível concluir a operação.'
  );
} finally {
  setLoading(false);
}

};

return ( <div className="min-h-screen w-full bg-[#0B0B18] flex flex-col items-center justify-start px-4 py-8 md:py-12 relative overflow-hidden selection:bg-[#7C3AED]/30">

  {/* glows de fundo */}
  <div className="pointer-events-none absolute inset-0">
    <div
      className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[1200px] h-[700px] rounded-full opacity-[0.22] blur-[90px]"
      style={{
        background:
          'radial-gradient(rgb(124, 92, 255) 0%, rgb(74, 46, 158) 25%, transparent 70%)'
      }}
    />

    <div
      className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full opacity-[0.15] blur-[80px]"
      style={{
        background:
          'radial-gradient(rgb(155, 140, 255) 0%, transparent 65%)'
      }}
    />
  </div>

  {/* header */}
  <header className="relative z-10 w-full flex flex-col items-center gap-3 mb-8 md:mb-10">
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-[10px] bg-[#7C3AED] flex items-center justify-center shadow-[0_0_20px_rgba(124,92,255,0.5)]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5 text-white fill-white"
        >
          <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
        </svg>
      </div>

      <span className="text-white font-bold text-[22px] tracking-tight">
        NEXUS OS
      </span>

      <span className="ml-1 px-2.5 py-0.5 rounded-full bg-[#1F1F2E] border border-[#2A2A3E] text-[10px] font-semibold tracking-widest text-[#8B8BA7]">
        V2.1
      </span>
    </div>

    <p className="text-[#8B8BA7] text-[13px] font-medium tracking-wide text-center">
      SaaS multi-tenant • Gestão completa da sua empresa
    </p>
  </header>

  {/* card principal */}
  <main className="relative z-10 w-full max-w-[480px]">
    <div className="w-full rounded-[32px] bg-[#1A1A2E] border border-[#2A2A3E] shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_0_1px_rgba(42,42,62,0.5)_inset] overflow-hidden">

      {/* tabs */}
      <div className="p-2.5">
        <div className="flex bg-[#12121F] rounded-full p-1.5 border border-[#1E1E32]">
          <button
            type="button"
            onClick={() => setTab('entrar')}
            className={`flex-1 h-10 rounded-full text-[14px] font-semibold transition-all duration-300 flex items-center justify-center ${
              tab === 'entrar'
                ? 'bg-[#2A2A35] text-white shadow-[0_2px_8px_rgba(0,0,0,0.3)]'
                : 'text-[#8B8BA7] hover:text-[#A0A0BB]'
            }`}
          >
            Entrar
          </button>

          <button
            type="button"
            onClick={() => setTab('criar')}
            className={`flex-1 h-10 rounded-full text-[14px] font-semibold transition-all duration-300 flex items-center justify-center ${
              tab === 'criar'
                ? 'bg-[#2A2A35] text-white shadow-[0_2px_8px_rgba(0,0,0,0.3)]'
                : 'text-[#8B8BA7] hover:text-[#A0A0BB]'
            }`}
          >
            Criar Conta
          </button>
        </div>
      </div>

      {tab === 'entrar' ? (
        <div className="px-7 md:px-8 pb-8 pt-2">
          <h1 className="text-white font-bold text-[26px] md:text-[28px] leading-tight tracking-tight">
            Bem-vindo ao NEXUS OS
          </h1>

          <p className="text-[#8B8BA7] text-[14px] mt-2 mb-7">
            Entre com suas credenciais para acessar
          </p>

          {error && (
            <div className="mb-5 bg-red-500/10 border border-red-500/30 text-red-400 text-[12px] p-3 rounded-xl">
              {error}
            </div>
          )}

          <form action="#" onSubmit={handleLogin}>
            <div className="mb-5">
              <label className="block text-[11px] font-semibold tracking-[0.14em] text-[#8B8BA7] mb-2.5 uppercase">
                E-mail corporativo *
              </label>

              <div className="flex items-center rounded-[16px] bg-[#12121F] border border-[#2A2A3E] transition-all duration-200 focus-within:border-[#7C3AED] focus-within:shadow-[0_0_0_3px_rgba(124,92,255,0.15)]">
                <div className="pl-4 pr-3 text-[#5A5A78]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </div>

                <input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  type="email"
                  required
                  placeholder="seu@email.com"
                  className="w-full h-[48px] bg-transparent text-white text-[14px] placeholder:text-[#4A4A6A] outline-none pr-4"
                />
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-[11px] font-semibold tracking-[0.14em] text-[#8B8BA7] mb-2.5 uppercase">
                Senha *
              </label>

              <div className="flex items-center rounded-[16px] bg-[#12121F] border border-[#2A2A3E] transition-all duration-200 focus-within:border-[#7C3AED] focus-within:shadow-[0_0_0_3px_rgba(124,92,255,0.15)]">
                <div className="pl-4 pr-3 text-[#5A5A78]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>

                <input
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  type={showSenha ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  className="w-full h-[48px] bg-transparent text-white text-[14px] placeholder:text-[#4A4A6A] outline-none"
                />

                <button
                  type="button"
                  onClick={() => setShowSenha(!showSenha)}
                  className="pr-4 pl-2 text-[#5A5A78] hover:text-[#8B8BA7] transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mb-7">
              <label className="block text-[11px] font-semibold tracking-[0.14em] text-[#8B8BA7] mb-2.5 uppercase">
                API URL
              </label>

              <div className="flex items-center justify-between gap-3 rounded-[16px] bg-[#12121F] border border-[#2A2A3E] px-4 h-[44px]">
                {editingApi ? (
                  <input
                    value={apiUrl}
                    onChange={e => setApiUrl(e.target.value)}
                    className="bg-transparent text-[#8B8BA7] text-[12.5px] outline-none w-full border-b border-[#7C3AED]"
                    autoFocus
                  />
                ) : (
                  <span className="text-[#8B8BA7] text-[12.5px] truncate">
                    {apiUrl}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (editingApi) {
                      try {
                        const parsed = new URL(apiUrl.trim());
                        if (
                          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
                          parsed.origin !== window.location.origin
                        ) {
                          localStorage.setItem('nexus_api_url', parsed.origin);
                          setApiUrl(parsed.origin);
                        }
                      } catch {
                        // Entrada inválida: mantém a URL atual.
                      }
                      setEditingApi(false);
                    } else {
                      setEditingApi(true);
                    }
                  }}
                  className="shrink-0 px-3.5 h-7 rounded-full bg-[#232330] border border-[#2E2E44] text-[#A0A0BB] text-[12px] font-medium hover:bg-[#2A2A3A] hover:text-white transition-all"
                >
                  {editingApi ? 'Salvar' : 'Editar'}
                </button>
              </div>
            </div>

            <button
              disabled={loading}
              type="submit"
              className="w-full h-[52px] rounded-[16px] bg-[#7C3AED] hover:bg-[#6D4EFF] active:bg-[#6245E6] text-white font-semibold text-[15px] flex items-center justify-center gap-2.5 transition-all shadow-[0_8px_24px_rgba(124,92,255,0.35),0_0_0_1px_rgba(124,92,255,0.2)_inset] disabled:opacity-60 group"
            >
              {loading
                ? 'Entrando...'
                : (
                  <>
                    Entrar no NEXUS OS
                    <span className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
                      →
                    </span>
                  </>
                )}
            </button>

            <div className="mt-6 text-center space-y-2.5">
              <p className="text-[13px] text-[#8B8BA7]">
                Não possui uma conta?{' '}
                <button
                  type="button"
                  onClick={() => setTab('criar')}
                  className="text-white font-semibold hover:text-[#7C3AED] transition-colors"
                >
                  Criar conta
                </button>
              </p>

              <button
                type="button"
                onClick={() => setTab('criar')}
                className="text-[13px] text-[#5A5A78] hover:text-[#8B8BA7] transition-colors"
              >
                Primeira vez?{' '}
                <span className="text-[#8B8BA7] underline underline-offset-4 decoration-[#3A3A55] hover:decoration-[#7C3AED]">
                  Criar minha empresa
                </span>
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="px-7 md:px-8 pb-8 pt-2">
          <h1 className="text-white font-bold text-[26px] md:text-[28px] leading-tight tracking-tight">
            Criar sua empresa
          </h1>

          <p className="text-[#8B8BA7] text-[14px] mt-2 mb-7">
            Preencha os dados para iniciar seu trial de 7 dias
          </p>

          {error && (
            <div className="mb-5 bg-red-500/10 border border-red-500/30 text-red-400 text-[12px] p-3 rounded-xl">
              {error}
            </div>
          )}

          <form action="#" onSubmit={handleRegister}>
            <div className="mb-4">
              <label className="block text-[11px] font-semibold tracking-[0.14em] text-[#8B8BA7] mb-2.5 uppercase">
                Nome da empresa *
              </label>

              <div className="flex items-center rounded-[16px] bg-[#12121F] border border-[#2A2A3E] transition-all focus-within:border-[#7C3AED] focus-within:shadow-[0_0_0_3px_rgba(124,92,255,0.15)]">
                <div className="pl-4 pr-3 text-[#5A5A78]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
                    <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
                    <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
                    <path d="M10 6h4" />
                    <path d="M10 10h4" />
                    <path d="M10 14h4" />
                    <path d="M10 18h4" />
                  </svg>
                </div>

                <input
                  value={form.nomeEmpresa}
                  onChange={e =>
                    setForm({
                      ...form,
                      nomeEmpresa: e.target.value
                    })
                  }
                  placeholder="Ex: Duarte Comércio LTDA"
                  required
                  className="w-full h-[48px] bg-transparent text-white text-[14px] placeholder:text-[#4A4A6A] outline-none pr-4"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-[11px] font-semibold tracking-[0.14em] text-[#8B8BA7] mb-2.5 uppercase">
                CNPJ *
              </label>

              <div className="flex items-center rounded-[16px] bg-[#12121F] border border-[#2A2A3E] transition-all focus-within:border-[#7C3AED] focus-within:shadow-[0_0_0_3px_rgba(124,92,255,0.15)]">
                <div className="pl-4 pr-3 text-[#5A5A78]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                    <path d="M10 9H8" />
                    <path d="M16 13H8" />
                    <path d="M16 17H8" />
                  </svg>
                </div>

                <input
                  value={form.cnpj}
                  onChange={e =>
                    setForm({
                      ...form,
                      cnpj: e.target.value
                    })
                  }
                  placeholder="00.000.000/0000-00"
                  required
                  className="w-full h-[48px] bg-transparent text-white text-[14px] placeholder:text-[#4A4A6A] outline-none pr-4"
                />
              </div>

              <p className="mt-2 text-[11px] text-[#5A5A78] leading-relaxed">
                Aceita com ou sem pontuação • Validado no backend
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-[11px] font-semibold tracking-[0.14em] text-[#8B8BA7] mb-2.5 uppercase">
                Nome do responsável *
              </label>

              <div className="flex items-center rounded-[16px] bg-[#12121F] border border-[#2A2A3E] transition-all focus-within:border-[#7C3AED] focus-within:shadow-[0_0_0_3px_rgba(124,92,255,0.15)]">
                <div className="pl-4 pr-3 text-[#5A5A78]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>

                <input
                  value={form.nomeResponsavel}
                  onChange={e =>
                    setForm({
                      ...form,
                      nomeResponsavel: e.target.value
                    })
                  }
                  placeholder="Ex: Samuel Santos Duarte"
                  required
                  className="w-full h-[48px] bg-transparent text-white text-[14px] placeholder:text-[#4A4A6A] outline-none pr-4"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-[11px] font-semibold tracking-[0.14em] text-[#8B8BA7] mb-2.5 uppercase">
                E-mail corporativo *
              </label>

              <div className="flex items-center rounded-[16px] bg-[#12121F] border border-[#2A2A3E] transition-all focus-within:border-[#7C3AED] focus-within:shadow-[0_0_0_3px_rgba(124,92,255,0.15)]">
                <div className="pl-4 pr-3 text-[#5A5A78]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </div>

                <input
                  value={form.email}
                  onChange={e =>
                    setForm({
                      ...form,
                      email: e.target.value
                    })
                  }
                  placeholder="contato@suaempresa.com"
                  type="email"
                  required
                  className="w-full h-[48px] bg-transparent text-white text-[14px] placeholder:text-[#4A4A6A] outline-none pr-4"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-[11px] font-semibold tracking-[0.14em] text-[#8B8BA7] mb-2.5 uppercase">
                Senha *
              </label>

              <div className="flex items-center rounded-[16px] bg-[#12121F] border border-[#2A2A3E] transition-all focus-within:border-[#7C3AED] focus-within:shadow-[0_0_0_3px_rgba(124,92,255,0.15)]">
                <div className="pl-4 pr-3 text-[#5A5A78]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>

                <input
                  value={form.senha}
                  onChange={e =>
                    setForm({
                      ...form,
                      senha: e.target.value
                    })
                  }
                  placeholder="Mínimo 6 caracteres"
                  type={showSenha ? 'text' : 'password'}
                  required
                  className="w-full h-[48px] bg-transparent text-white text-[14px] placeholder:text-[#4A4A6A] outline-none"
                />

                <button
                  type="button"
                  onClick={() => setShowSenha(!showSenha)}
                  className="pr-4 pl-2 text-[#5A5A78] hover:text-[#8B8BA7]"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-[11px] font-semibold tracking-[0.14em] text-[#8B8BA7] mb-2.5 uppercase">
                Confirmar senha *
              </label>

              <div className="flex items-center rounded-[16px] bg-[#12121F] border border-[#2A2A3E] transition-all focus-within:border-[#7C3AED] focus-within:shadow-[0_0_0_3px_rgba(124,92,255,0.15)]">
                <div className="pl-4 pr-3 text-[#5A5A78]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>

                <input
                  value={form.confirmarSenha}
                  onChange={e =>
                    setForm({
                      ...form,
                      confirmarSenha: e.target.value
                    })
                  }
                  placeholder="Repita a senha"
                  type={showSenha2 ? 'text' : 'password'}
                  required
                  className="w-full h-[48px] bg-transparent text-white text-[14px] placeholder:text-[#4A4A6A] outline-none"
                />

                <button
                  type="button"
                  onClick={() => setShowSenha2(!showSenha2)}
                  className="pr-4 pl-2 text-[#5A5A78] hover:text-[#8B8BA7]"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </div>
            </div>

            <button
              disabled={loading}
              type="submit"
              className="w-full h-[52px] rounded-[16px] bg-[#7C3AED] hover:bg-[#6D4EFF] text-white font-semibold text-[15px] flex items-center justify-center gap-2.5 transition-all shadow-[0_8px_24px_rgba(124,92,255,0.35)] disabled:opacity-60"
            >
              {loading
                ? 'Criando...'
                : 'Criar conta e iniciar trial de 7 dias'}
            </button>

            <p className="mt-4 text-[11px] leading-relaxed text-[#5A5A78] text-center px-2">
              companyId gerado exclusivamente no backend • CNPJ normalizado • Senha com hash seguro • Trial 7 dias automático
            </p>

            <div className="mt-6 text-center">
              <p className="text-[13px] text-[#8B8BA7]">
                Já possui conta?{' '}
                <button
                  type="button"
                  onClick={() => setTab('entrar')}
                  className="text-white font-semibold hover:text-[#7C3AED] transition-colors"
                >
                  Entrar
                </button>
              </p>
            </div>
          </form>
        </div>
      )}
    </div>
  </main>

  <div className="mt-8 flex justify-center relative z-10">
    <div className="h-px w-24 bg-gradient-to-r from-transparent via-[#2A2A3E] to-transparent" />
  </div>
</div>

);
}


