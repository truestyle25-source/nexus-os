'use client';
import { useEffect, useRef, useState } from 'react';
import { clubApi } from '@/lib/club/api';
import { parametroUrl } from '@/components/club/sessao';
import { Aviso, Cartao, LinkClube, PaginaClube, Titulo } from '@/components/club/ui';

/** Link do e-mail de confirmação: ativa a conta (uso único). */
export default function VerificarEmailClube() {
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [mensagem, setMensagem] = useState('');
  const feito = useRef(false);

  useEffect(() => {
    if (feito.current) return; // StrictMode chama duas vezes: o link é de uso único
    feito.current = true;
    const token = parametroUrl('token');
    if (!token) { setEstado('erro'); setMensagem('Link incompleto. Abra o link do e-mail de novo.'); return; }
    clubApi.verificarEmail(token)
      .then(() => setEstado('ok'))
      .catch((e) => { setEstado('erro'); setMensagem((e as Error).message); });
  }, []);

  return (
    <PaginaClube>
      <Cartao>
        {estado === 'carregando' && <Titulo>Confirmando seu e-mail…</Titulo>}
        {estado === 'ok' && (
          <>
            <Titulo sub="Sua conta do NEXUS CLUB está ativa.">E-mail confirmado</Titulo>
            <Aviso tom="ok">Pronto! Agora é só entrar com seu e-mail ou CPF e a senha.</Aviso>
            <LinkClube href="/login?aba=cliente">Entrar no NEXUS CLUB →</LinkClube>
          </>
        )}
        {estado === 'erro' && (
          <>
            <Titulo>Não foi possível confirmar</Titulo>
            <Aviso tom="erro">{mensagem}</Aviso>
            <p className="text-[14px] text-[#8B8BA7]">Na tela de entrada você pode pedir um novo e-mail de confirmação. <LinkClube href="/login?aba=cliente">Ir para a entrada</LinkClube></p>
          </>
        )}
      </Cartao>
    </PaginaClube>
  );
}
