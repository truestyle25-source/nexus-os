'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, registerCompany, saveToken } from '@/lib/api';
import { maskCnpj, isValidCnpjClientSide, generateRandomValidCnpjClientSide } from '@/lib/cnpj';

type Tab = 'login' | 'signup';

export default function AuthForm() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showApiEditor, setShowApiEditor] = useState(false);

  // login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // signup
  const [companyName, setCompanyName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [cnpjSample, setCnpjSample] = useState('11.222.333/0001-81');
  const [responsibleName, setResponsibleName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(loginEmail, loginPassword);
      saveToken(result.accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isValidCnpjClientSide(cnpj)) {
      setError('CNPJ inválido — confira os dígitos ou use o CNPJ de teste gerado abaixo.');
      return;
    }
    if (signupPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const result = await registerCompany({
        companyName, cnpj, responsibleName,
        email: signupEmail, password: signupPassword, confirmPassword,
      });
      saveToken(result.accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta');
    } finally {
      setLoading(false);
    }
  }

  function fillRandomCnpj() {
    const generated = generateRandomValidCnpjClientSide();
    setCnpjSample(generated);
    setCnpj(generated);
  }

  return (
    <div className="w-full max-w-md">
      <div className="flex items-center gap-3 mb-2 justify-center">
        <div className="w-11 h-11 rounded-2xl logo-glow flex items-center justify-center shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h7l-1 8 11-14h-8l1-6z"/></svg>
        </div>
        <span className="text-white font-bold text-2xl">NEXUS OS</span>
        <span className="text-xs text-gray-300 bg-white/5 border border-white/10 rounded-full px-3 py-1">V2.1</span>
      </div>
      <p className="text-center text-gray-400 text-sm mb-8">SaaS multi-tenant • Gestão completa da sua empresa</p>

      <div className="card rounded-3xl p-7 shadow-2xl">
        <div className="flex bg-black/40 rounded-xl p-1.5 mb-7">
          <button
            type="button"
            onClick={() => { setTab('login'); setError(null); }}
            className={`flex-1 text-sm font-semibold py-3 rounded-lg transition ${tab === 'login' ? 'tab-active' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => { setTab('signup'); setError(null); }}
            className={`flex-1 text-sm font-semibold py-3 rounded-lg transition ${tab === 'signup' ? 'tab-active' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Criar Conta
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-xl px-4 py-3 mb-5">
            {error}
          </div>
        )}

        {tab === 'login' ? (
          <form onSubmit={handleLogin}>
            <h1 className="text-white text-2xl font-bold mb-1.5">Bem-vindo ao NEXUS OS</h1>
            <p className="text-gray-400 text-sm mb-6">Entre com suas credenciais para acessar</p>

            <label className="text-[11px] text-gray-500 tracking-widest font-medium">E-MAIL CORPORATIVO *</label>
            <div className="field rounded-2xl flex items-center gap-3 px-4 py-3.5 mt-2 mb-5">
              <span className="field-icon" aria-hidden="true">@</span>
              <input
                type="email" required value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)}
                className="bg-transparent text-white text-[15px] outline-none w-full placeholder-gray-500"
                placeholder="seu@empresa.com"
              />
            </div>

            <label className="text-[11px] text-gray-500 tracking-widest font-medium">SENHA *</label>
            <div className="field rounded-2xl flex items-center gap-3 px-4 py-3.5 mt-2 mb-4">
              <span className="field-icon" aria-hidden="true">*</span>
              <input
                type={showLoginPassword ? 'text' : 'password'} required value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
                className="bg-transparent text-white text-[15px] outline-none w-full placeholder-gray-500"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowLoginPassword((visible) => !visible)} className="password-toggle" aria-label={showLoginPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                {showLoginPassword ? 'ocultar' : 'mostrar'}
              </button>
            </div>

            <div className="api-row">
              <div>
                <p className="api-label">API URL</p>
                <p className="api-value">{process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333'}</p>
              </div>
              <button type="button" onClick={() => setShowApiEditor((visible) => !visible)} className="api-edit">{showApiEditor ? 'Fechar' : 'Editar'}</button>
            </div>
            {showApiEditor && <p className="api-note">Configure `NEXT_PUBLIC_API_URL` no ambiente do frontend para alterar este endereço.</p>}

            <button type="submit" disabled={loading} className="w-full btn-primary text-white text-[15px] font-semibold rounded-2xl py-3.5 transition disabled:opacity-60">
              {loading ? 'Entrando...' : 'Entrar no NEXUS OS'}
            </button>

            <div className="auth-links">
              <p>Não possui uma conta? <button type="button" onClick={() => setTab('signup')}>Criar conta</button></p>
              <p>Primeira vez? <button type="button" onClick={() => setTab('signup')}>Criar minha empresa</button></p>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSignup}>
            <h1 className="text-white text-2xl font-bold mb-1.5">Criar sua empresa</h1>
            <p className="text-gray-400 text-sm mb-6">Preencha os dados para iniciar seu trial de 7 dias</p>

            <label className="text-[11px] text-gray-500 tracking-widest font-medium">NOME DA EMPRESA *</label>
            <div className="field rounded-2xl flex items-center gap-3 px-4 py-4 mt-2 mb-5">
              <input
                type="text" required value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                className="bg-transparent text-white text-[15px] outline-none w-full placeholder-gray-600"
                placeholder="Ex: Padaria Pão Dourado"
              />
            </div>

            <label className="text-[11px] text-gray-500 tracking-widest font-medium">CNPJ *</label>
            <div className="field rounded-2xl flex items-center gap-3 px-4 py-4 mt-2">
              <input
                type="text" required value={cnpj} onChange={(e) => setCnpj(maskCnpj(e.target.value))}
                className="bg-transparent text-white text-[15px] outline-none w-full placeholder-gray-600"
                placeholder="00.000.000/0001-00"
              />
            </div>
            <p className="text-[11px] text-gray-600 mt-2 mb-1">Aceita com ou sem pontuação • Validado no backend</p>

            <div className="bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 mt-3 mb-5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] text-gray-500 mb-0.5">CNPJ válido para teste (gerado):</p>
                <p className="text-gray-300 text-sm">{cnpjSample}</p>
              </div>
              <button type="button" onClick={fillRandomCnpj} className="text-xs text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded-full px-3 py-1.5 shrink-0 hover:bg-violet-500/20 whitespace-nowrap">
                Preencher CNPJ válido aleatório
              </button>
            </div>

            <label className="text-[11px] text-gray-500 tracking-widest font-medium">NOME DO RESPONSÁVEL *</label>
            <div className="field rounded-2xl flex items-center gap-3 px-4 py-4 mt-2 mb-5">
              <input
                type="text" required value={responsibleName} onChange={(e) => setResponsibleName(e.target.value)}
                className="bg-transparent text-white text-[15px] outline-none w-full placeholder-gray-600"
                placeholder="Seu nome completo"
              />
            </div>

            <label className="text-[11px] text-gray-500 tracking-widest font-medium">E-MAIL CORPORATIVO *</label>
            <div className="field rounded-2xl flex items-center gap-3 px-4 py-4 mt-2 mb-5">
              <input
                type="email" required value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)}
                className="bg-transparent text-white text-[15px] outline-none w-full placeholder-gray-600"
                placeholder="voce@suaempresa.com"
              />
            </div>

            <label className="text-[11px] text-gray-500 tracking-widest font-medium">SENHA *</label>
            <div className="field rounded-2xl flex items-center gap-3 px-4 py-4 mt-2 mb-5">
              <input
                type="password" required minLength={8} value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)}
                className="bg-transparent text-white text-[15px] outline-none w-full placeholder-gray-600"
                placeholder="Mínimo 8 caracteres"
              />
            </div>

            <label className="text-[11px] text-gray-500 tracking-widest font-medium">CONFIRMAR SENHA *</label>
            <div className="field rounded-2xl flex items-center gap-3 px-4 py-4 mt-2 mb-6">
              <input
                type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-transparent text-white text-[15px] outline-none w-full placeholder-gray-600"
                placeholder="Repita a senha"
              />
            </div>

            <button type="submit" disabled={loading} className="w-full btn-primary text-white text-[15px] font-semibold rounded-2xl py-4 transition disabled:opacity-60">
              {loading ? 'Criando conta...' : 'Criar conta e iniciar trial de 7 dias'}
            </button>

            <p className="text-center text-gray-400 text-sm mt-5">
              Já possui conta?{' '}
              <button type="button" onClick={() => setTab('login')} className="text-violet-400 hover:text-violet-300 font-semibold">Entrar</button>
            </p>
          </form>
        )}
      </div>

      <p className="text-center text-gray-600 text-[11px] mt-6 leading-relaxed">
        {tab === 'login'
          ? 'Isolamento por company_id • JWT seguro'
          : 'companyId gerado exclusivamente no backend • CNPJ normalizado • Senha com hash seguro • Trial 7 dias automático'}
      </p>
      <p className="text-center text-gray-700 text-[10px] mt-2">Dados preservados: 0 empresa(s) • 0 usuário(s) • localStorage intacto</p>
    </div>
  );
}
