'use client';
/**
 * Área do cliente — Fase 4: a conta (dados, telefone, senha, sair).
 * Os clubes, promoções e benefícios entram aqui na Fase 5.
 */
import { useState, type FormEvent } from 'react';
import { clubApi, problemaSenha, salvarSessaoClube } from '@/lib/club/api';
import { useSessaoClube } from '@/components/club/sessao';
import { Aviso, BotaoPrimario, BotaoSecundario, Campo, Cartao, PaginaClube, Titulo } from '@/components/club/ui';

export default function InicioClube() {
  const { eu, setEu, erro, sair } = useSessaoClube();
  const [edit, setEdit] = useState<{ nome: string; celular: string; whatsapp: string } | null>(null);
  const [senhas, setSenhas] = useState<{ atual: string; nova: string } | null>(null);
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);
  const [carregando, setCarregando] = useState(false);

  const salvarDados = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setCarregando(true); setMsg(null);
    try {
      const r = await clubApi.atualizarEu({ nome: edit.nome.trim(), celular: edit.celular.trim() || null, whatsapp: edit.whatsapp.trim() || null });
      setEu((v) => (v ? { ...v, ...r } as typeof v : v));
      setEdit(null); setMsg({ tom: 'ok', texto: 'Dados atualizados.' });
    } catch (err) { setMsg({ tom: 'erro', texto: (err as Error).message }); }
    finally { setCarregando(false); }
  };

  const trocarSenha = async (e: FormEvent) => {
    e.preventDefault();
    if (!senhas) return;
    const p = problemaSenha(senhas.nova);
    if (p) { setMsg({ tom: 'erro', texto: p }); return; }
    setCarregando(true); setMsg(null);
    try {
      const r = await clubApi.trocarSenha(senhas.atual, senhas.nova);
      salvarSessaoClube(r.token);
      setSenhas(null); setMsg({ tom: 'ok', texto: 'Senha trocada. As sessões em outros aparelhos foram encerradas.' });
    } catch (err) { setMsg({ tom: 'erro', texto: (err as Error).message }); }
    finally { setCarregando(false); }
  };

  return (
    <PaginaClube largura={560}>
      <Cartao>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {!eu && !erro && <p className="text-[#8B8BA7] text-[14px]">Carregando…</p>}
        {eu && (
          <>
            <Titulo sub="Sua conta vale para todas as lojas que usam o NEXUS CLUB.">Olá, {eu.nome.split(' ')[0]}!</Titulo>
            {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}

            {!edit ? (
              <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[14px] mb-5">
                <dt className="text-[#8B8BA7]">Nome</dt><dd className="text-white">{eu.nome}</dd>
                <dt className="text-[#8B8BA7]">E-mail</dt><dd className="text-white break-all">{eu.email}</dd>
                <dt className="text-[#8B8BA7]">CPF</dt><dd className="text-white">{eu.cpf ?? '—'}</dd>
                <dt className="text-[#8B8BA7]">Celular</dt><dd className="text-white">{eu.celular || '—'}</dd>
                <dt className="text-[#8B8BA7]">WhatsApp</dt><dd className="text-white">{eu.whatsapp || '—'}</dd>
              </dl>
            ) : (
              <form onSubmit={salvarDados} className="mb-4">
                <Campo rotulo="Nome" value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} />
                <Campo rotulo="Celular" value={edit.celular} onChange={(e) => setEdit({ ...edit, celular: e.target.value })} type="tel" inputMode="tel" />
                <Campo rotulo="WhatsApp" value={edit.whatsapp} onChange={(e) => setEdit({ ...edit, whatsapp: e.target.value })} type="tel" inputMode="tel" ajuda="E-mail e CPF não mudam por aqui." />
                <div className="flex gap-2"><BotaoPrimario type="submit" carregando={carregando}>Salvar</BotaoPrimario><BotaoSecundario type="button" onClick={() => setEdit(null)}>Cancelar</BotaoSecundario></div>
              </form>
            )}

            {senhas && (
              <form onSubmit={trocarSenha} className="mb-4">
                <Campo rotulo="Senha atual" value={senhas.atual} onChange={(e) => setSenhas({ ...senhas, atual: e.target.value })} type="password" autoComplete="current-password" />
                <Campo rotulo="Nova senha" value={senhas.nova} onChange={(e) => setSenhas({ ...senhas, nova: e.target.value })} type="password" autoComplete="new-password" ajuda="Pelo menos 8 caracteres, com letras e números." />
                <div className="flex gap-2"><BotaoPrimario type="submit" carregando={carregando}>Trocar senha</BotaoPrimario><BotaoSecundario type="button" onClick={() => setSenhas(null)}>Cancelar</BotaoSecundario></div>
              </form>
            )}

            {!edit && !senhas && (
              <div className="flex flex-wrap gap-2">
                <BotaoSecundario type="button" onClick={() => { setMsg(null); setEdit({ nome: eu.nome, celular: eu.celular ?? '', whatsapp: eu.whatsapp ?? '' }); }}>Editar dados</BotaoSecundario>
                <BotaoSecundario type="button" onClick={() => { setMsg(null); setSenhas({ atual: '', nova: '' }); }}>Trocar senha</BotaoSecundario>
                <BotaoSecundario type="button" onClick={sair}>Sair</BotaoSecundario>
              </div>
            )}
          </>
        )}
      </Cartao>
    </PaginaClube>
  );
}
