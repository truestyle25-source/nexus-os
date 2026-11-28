'use client';
/**
 * Criar conta de cliente do NEXUS CLUB.
 * Termos de Uso e Política de Privacidade (versão vigente) para ler e aceitar, caixas DESMARCADAS.
 * O servidor confere tudo de novo (CPF, senha, aceite da versão atual) e não revela se o e-mail
 * ou o CPF já têm conta: a resposta é sempre "enviamos um e-mail".
 */
import { useEffect, useState, type FormEvent } from 'react';
import { clubApi, cpfValido, mascaraCpf, problemaSenha, ROTULO_TERMO, type Termo } from '@/lib/club/api';
import { Aviso, BotaoPrimario, Campo, Cartao, LinkClube, PaginaClube, TextoTermo, Titulo } from '@/components/club/ui';

export default function CadastroClube() {
  const [termos, setTermos] = useState<Termo[] | null>(null);
  const [indisponivel, setIndisponivel] = useState('');
  const [f, setF] = useState({ nome: '', email: '', cpf: '', celular: '', whatsapp: '', senha: '', senha2: '' });
  const [aceites, setAceites] = useState<Record<string, boolean>>({});
  const [aberto, setAberto] = useState<string | null>(null);
  const [tocado, setTocado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [enviado, setEnviado] = useState('');

  useEffect(() => {
    clubApi.status()
      .then((s) => (s.habilitado ? clubApi.termosVigentes() : Promise.reject(new Error('O NEXUS CLUB ainda não está disponível.'))))
      .then((r) => (r.completos ? setTermos(r.termos) : setIndisponivel('O cadastro ainda não está aberto: os termos do NEXUS CLUB não foram publicados.')))
      .catch((e) => setIndisponivel((e as Error).message));
  }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((v) => ({ ...v, [k]: k === 'cpf' ? mascaraCpf(e.target.value) : e.target.value }));

  const erros = {
    nome: f.nome.trim().length < 2 ? 'Informe seu nome.' : null,
    email: /^\S+@\S+\.\S+$/.test(f.email.trim()) ? null : 'Informe um e-mail válido.',
    cpf: cpfValido(f.cpf) ? null : 'CPF inválido.',
    senha: problemaSenha(f.senha),
    senha2: f.senha2 === f.senha ? null : 'As senhas não conferem.',
    termos: termos && termos.every((t) => aceites[t.id]) ? null : 'É preciso aceitar os Termos de Uso e a Política de Privacidade.',
  };
  const valido = Object.values(erros).every((e) => !e);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setTocado(true); setErro('');
    if (!valido || !termos) return;
    setCarregando(true);
    try {
      const r = await clubApi.cadastro({
        nome: f.nome.trim(), email: f.email.trim(), cpf: f.cpf, senha: f.senha,
        celular: f.celular.trim() || undefined, whatsapp: f.whatsapp.trim() || undefined,
        aceites: termos.filter((t) => aceites[t.id]).map((t) => t.id),
      });
      setEnviado(r.message);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  if (enviado) {
    return (
      <PaginaClube>
        <Cartao>
          <Titulo sub={<>Abra o e-mail <strong className="text-white">{f.email.trim()}</strong> e clique no link para ativar a conta (vale por 24 horas).</>}>Confira seu e-mail</Titulo>
          <Aviso tom="ok">{enviado}</Aviso>
          <p className="text-[14px] text-[#8B8BA7]">Não chegou? Veja a caixa de spam ou peça um novo e-mail na tela de entrada. <LinkClube href="/login?aba=cliente">Ir para a entrada</LinkClube></p>
        </Cartao>
      </PaginaClube>
    );
  }

  return (
    <PaginaClube largura={520}>
      <Cartao>
        <Titulo sub="Uma única conta vale para todas as lojas que usam o NEXUS CLUB.">Criar minha conta de cliente</Titulo>
        {indisponivel && <Aviso tom="erro">{indisponivel}</Aviso>}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {!indisponivel && !termos && <p className="text-[#8B8BA7] text-[14px]">Carregando…</p>}
        {termos && (
          <form onSubmit={enviar} noValidate>
            <Campo rotulo="Nome completo *" value={f.nome} onChange={set('nome')} autoComplete="name" erro={tocado ? erros.nome : null} />
            <Campo rotulo="E-mail *" value={f.email} onChange={set('email')} type="email" autoComplete="email" inputMode="email" erro={tocado ? erros.email : null} ajuda="Você vai receber um link para confirmar." />
            <Campo rotulo="CPF *" value={f.cpf} onChange={set('cpf')} inputMode="numeric" placeholder="000.000.000-00" erro={tocado ? erros.cpf : null} ajuda="Identifica a sua conta nas lojas. Guardado de forma cifrada." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
              <Campo rotulo="Celular" value={f.celular} onChange={set('celular')} type="tel" autoComplete="tel" inputMode="tel" placeholder="(00) 00000-0000" />
              <Campo rotulo="WhatsApp" value={f.whatsapp} onChange={set('whatsapp')} type="tel" inputMode="tel" placeholder="(00) 00000-0000" ajuda="Opcional." />
            </div>
            <Campo rotulo="Senha *" value={f.senha} onChange={set('senha')} type="password" autoComplete="new-password" erro={tocado ? erros.senha : null} ajuda="Pelo menos 8 caracteres, com letras e números." />
            <Campo rotulo="Confirmar senha *" value={f.senha2} onChange={set('senha2')} type="password" autoComplete="new-password" erro={tocado ? erros.senha2 : null} />

            <div className="mt-2 mb-5 space-y-3">
              {termos.map((t) => (
                <div key={t.id} className="rounded-[16px] border border-[#2A2A3E] p-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={!!aceites[t.id]} onChange={(e) => setAceites((a) => ({ ...a, [t.id]: e.target.checked }))} className="mt-1 h-4 w-4 accent-[#7C3AED]" />
                    <span className="text-[14px] text-[#C9C9E0]">Li e aceito os <strong className="text-white">{ROTULO_TERMO[t.tipo] ?? t.tipo}</strong> (versão {t.versao}).</span>
                  </label>
                  <button type="button" onClick={() => setAberto(aberto === t.id ? null : t.id)} className="mt-2 ml-7 text-[13px] text-[#A78BFA] hover:text-white font-semibold">
                    {aberto === t.id ? 'Fechar texto' : 'Ler o texto'}
                  </button>
                  {aberto === t.id && <div className="mt-3"><TextoTermo texto={t.texto} /></div>}
                </div>
              ))}
              {tocado && erros.termos && <p className="text-[12px] text-red-400">{erros.termos}</p>}
              <p className="text-[12px] text-[#6B6B88]">Mensagens com promoções das lojas só com a sua autorização, escolhida depois, em cada clube.</p>
            </div>

            <BotaoPrimario type="submit" carregando={carregando}>Criar minha conta</BotaoPrimario>
          </form>
        )}
        <p className="mt-5 text-center text-[14px] text-[#8B8BA7]">Já tem conta? <LinkClube href="/login?aba=cliente">Entrar</LinkClube></p>
      </Cartao>
    </PaginaClube>
  );
}
