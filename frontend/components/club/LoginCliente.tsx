'use client';
/**
 * Aba "Sou cliente NEXUS" da tela de login (Fase 4 do NEXUS CLUB, mockup 01).
 * Só acrescenta esta aba: as abas "Entrar" e "Criar conta" da empresa ficam iguais.
 * Sem campo "API URL" (o consumidor não precisa vê-lo).
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { clubApi, ErroClube, salvarSessaoClube } from '@/lib/club/api';
import { Aviso, BotaoPrimario, Campo, LinkClube } from './ui';

export function LoginCliente() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [precisaConfirmar, setPrecisaConfirmar] = useState(false);
  const [reenviado, setReenviado] = useState('');

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(''); setPrecisaConfirmar(false); setReenviado('');
    setCarregando(true);
    try {
      const r = await clubApi.login(login.trim(), senha);
      salvarSessaoClube(r.token, r.consumidor);
      router.push(r.termosPendentes?.length ? '/club/termos' : '/club/inicio');
    } catch (err) {
      const e2 = err as ErroClube;
      if (e2.codigo === 'EMAIL_NAO_VERIFICADO') setPrecisaConfirmar(true);
      setErro(e2.message || 'Não foi possível entrar.');
    } finally {
      setCarregando(false);
    }
  };

  const reenviar = async () => {
    if (!login.includes('@')) { setReenviado('Digite o seu e-mail no campo acima para reenviarmos a confirmação.'); return; }
    try { setReenviado((await clubApi.reenviarVerificacao(login.trim())).message); }
    catch (err) { setReenviado((err as Error).message); }
  };

  return (
    <div className="px-7 md:px-8 pb-8 pt-2">
      <h1 className="text-white font-bold text-[26px] md:text-[28px] leading-tight tracking-tight">
        Bem-vindo ao <span className="text-[#A78BFA]">NEXUS CLUB</span>
      </h1>
      <p className="text-[#8B8BA7] text-[14px] mt-2 mb-7">
        Veja as promoções e benefícios das lojas onde você é cliente. Uma única conta vale para todas elas.
      </p>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {precisaConfirmar && (
        <div className="mb-5 -mt-2 text-[13px] text-[#8B8BA7]">
          Não recebeu o e-mail?{' '}
          <button type="button" onClick={reenviar} className="text-[#A78BFA] hover:text-white font-semibold">Reenviar confirmação</button>
          {reenviado && <p className="mt-2 text-[#C4B5FD]">{reenviado}</p>}
        </div>
      )}

      <form onSubmit={entrar} noValidate>
        <Campo rotulo="E-mail ou CPF *" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" inputMode="email" placeholder="voce@email.com ou 000.000.000-00" required />
        <Campo rotulo="Senha *" value={senha} onChange={(e) => setSenha(e.target.value)} type="password" autoComplete="current-password" placeholder="••••••••" required />
        <BotaoPrimario type="submit" carregando={carregando} disabled={!login.trim() || !senha}>Entrar no NEXUS CLUB →</BotaoPrimario>
      </form>

      <div className="mt-5 text-center text-[14px] text-[#8B8BA7] space-y-2">
        <p>Ainda não tem conta? <LinkClube href="/club/cadastro">Criar minha conta de cliente</LinkClube></p>
        <p><LinkClube href="/club/esqueci-senha">Esqueci minha senha</LinkClube></p>
      </div>

      <div className="mt-6 rounded-xl border border-[#7C3AED]/30 bg-[#7C3AED]/10 p-3 text-[12px] text-[#C4B5FD] leading-relaxed">
        🔒 Esta área é só para consumidores. Ela <strong>não</strong> dá acesso ao sistema das empresas (estoque, caixa, financeiro).
      </div>
    </div>
  );
}
