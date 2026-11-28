'use client';
import { useState, type FormEvent } from 'react';
import { clubApi } from '@/lib/club/api';
import { Aviso, BotaoPrimario, Campo, Cartao, LinkClube, PaginaClube, Titulo } from '@/components/club/ui';

/** Pede o link para criar nova senha. A resposta é a mesma exista ou não a conta. */
export default function EsqueciSenhaClube() {
  const [email, setEmail] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setCarregando(true); setMsg(null);
    try { setMsg({ tom: 'ok', texto: (await clubApi.recuperarSenha(email.trim())).message }); }
    catch (err) { setMsg({ tom: 'erro', texto: (err as Error).message }); }
    finally { setCarregando(false); }
  };

  return (
    <PaginaClube>
      <Cartao>
        <Titulo sub="Informe o e-mail da sua conta. Enviaremos um link para criar uma nova senha (vale por 1 hora).">Esqueci minha senha</Titulo>
        {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
        <form onSubmit={enviar} noValidate>
          <Campo rotulo="E-mail *" value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="email" />
          <BotaoPrimario type="submit" carregando={carregando} disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}>Enviar link</BotaoPrimario>
        </form>
        <p className="mt-5 text-center text-[14px] text-[#8B8BA7]"><LinkClube href="/login?aba=cliente">Voltar para a entrada</LinkClube></p>
      </Cartao>
    </PaginaClube>
  );
}
