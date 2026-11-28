'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { clubApi, limparSessaoClube, problemaSenha } from '@/lib/club/api';
import { parametroUrl } from '@/components/club/sessao';
import { Aviso, BotaoPrimario, Campo, Cartao, LinkClube, PaginaClube, Titulo } from '@/components/club/ui';

/** Link do e-mail "redefinir senha": cria a nova senha e encerra as sessões abertas. */
export default function RedefinirSenhaClube() {
  const [token, setToken] = useState('');
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [tocado, setTocado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [estado, setEstado] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);

  useEffect(() => { setToken(parametroUrl('token')); }, []);
  const erroSenha = problemaSenha(senha);
  const erroConfere = senha2 === senha ? null : 'As senhas não conferem.';

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setTocado(true); setEstado(null);
    if (erroSenha || erroConfere) return;
    setCarregando(true);
    try {
      await clubApi.redefinirSenha(token, senha);
      limparSessaoClube();
      setEstado({ tom: 'ok', texto: 'Senha alterada. Por segurança, as sessões abertas em outros aparelhos foram encerradas.' });
    } catch (err) {
      setEstado({ tom: 'erro', texto: (err as Error).message });
    } finally {
      setCarregando(false);
    }
  };

  return (
    <PaginaClube>
      <Cartao>
        <Titulo sub="Escolha uma senha nova para a sua conta do NEXUS CLUB.">Criar nova senha</Titulo>
        {!token && <Aviso tom="erro">Link incompleto. Abra o link do e-mail de novo ou peça outro em “Esqueci minha senha”.</Aviso>}
        {estado && <Aviso tom={estado.tom}>{estado.texto}</Aviso>}
        {estado?.tom === 'ok' ? (
          <LinkClube href="/login?aba=cliente">Entrar com a nova senha →</LinkClube>
        ) : (
          <form onSubmit={enviar} noValidate>
            <Campo rotulo="Nova senha *" value={senha} onChange={(e) => setSenha(e.target.value)} type="password" autoComplete="new-password" erro={tocado ? erroSenha : null} ajuda="Pelo menos 8 caracteres, com letras e números." />
            <Campo rotulo="Confirmar nova senha *" value={senha2} onChange={(e) => setSenha2(e.target.value)} type="password" autoComplete="new-password" erro={tocado ? erroConfere : null} />
            <BotaoPrimario type="submit" carregando={carregando} disabled={!token}>Salvar nova senha</BotaoPrimario>
          </form>
        )}
        {estado?.tom !== 'ok' && <p className="mt-5 text-center text-[14px] text-[#8B8BA7]"><LinkClube href="/club/esqueci-senha">Pedir outro link</LinkClube></p>}
      </Cartao>
    </PaginaClube>
  );
}
