'use client';
/**
 * Minha conta (mockup 04): dados, autorizações de mensagens por loja e por canal (nascem
 * desligadas; autorizar mostra o texto da loja e grava a versão), histórico que não se apaga,
 * baixar meus dados, sair do clube, trocar senha e excluir a conta.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { clubApi, limparSessaoClube, problemaSenha, ROTULO_CANAL, salvarSessaoClube, type Canal, type DetalheClube } from '@/lib/club/api';
import { AppClube, Caixa, Secao, SeletorClube, useMeusClubes, useSessaoClube } from '@/components/club/AppClube';
import { Aviso, BotaoPrimario, BotaoSecundario, Campo, TextoTermo } from '@/components/club/ui';

type Historico = Awaited<ReturnType<typeof clubApi.historico>>;

function Interruptor({ ligado, onClick, rotulo, desabilitado }: { ligado: boolean; onClick: () => void; rotulo: string; desabilitado?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} onClick={onClick} disabled={desabilitado}
      className={`relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50 ${ligado ? 'bg-[#7C3AED]' : 'bg-[#3A3A52]'}`}>
      <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${ligado ? 'translate-x-5' : ''}`} />
    </button>
  );
}

export default function ContaClube() {
  const router = useRouter();
  const { eu, setEu, erro, sair } = useSessaoClube();
  const { clubes, selecionado, clube, escolher, recarregar } = useMeusClubes(!!eu);
  const [detalhe, setDetalhe] = useState<DetalheClube | null>(null);
  const [historico, setHistorico] = useState<Historico | null>(null);
  const [pedindo, setPedindo] = useState<Canal | null>(null);
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);
  const [edit, setEdit] = useState<{ nome: string; celular: string; whatsapp: string } | null>(null);
  const [senhas, setSenhas] = useState<{ atual: string; nova: string } | null>(null);
  const [excluir, setExcluir] = useState<{ senha: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregarClube = (id: string) => {
    clubApi.clube(id).then(setDetalhe).catch(() => setDetalhe(null));
    clubApi.historico(id).then(setHistorico).catch(() => setHistorico([]));
  };
  useEffect(() => { setDetalhe(null); setHistorico(null); if (selecionado) carregarClube(selecionado); }, [selecionado]);

  const avisar = (tom: 'ok' | 'erro', texto: string) => setMsg({ tom, texto });

  const mudarCanal = async (canal: Canal, autorizar: boolean) => {
    if (!selecionado || !detalhe) return;
    setOcupado(true); setMsg(null);
    try {
      await clubApi.consentir(selecionado, canal, autorizar, autorizar ? detalhe.autorizacao?.id : undefined);
      setPedindo(null); carregarClube(selecionado);
      avisar('ok', autorizar ? `${ROTULO_CANAL[canal].nome} autorizado.` : `${ROTULO_CANAL[canal].nome} desligado. Os envios param na hora.`);
    } catch (e) { avisar('erro', (e as Error).message); }
    finally { setOcupado(false); }
  };

  const salvarDados = async (e: FormEvent) => {
    e.preventDefault(); if (!edit) return;
    setOcupado(true); setMsg(null);
    try {
      const r = await clubApi.atualizarEu({ nome: edit.nome.trim(), celular: edit.celular.trim() || null, whatsapp: edit.whatsapp.trim() || null });
      setEu((v) => (v ? { ...v, ...r } as typeof v : v)); setEdit(null); avisar('ok', 'Dados atualizados.');
    } catch (err) { avisar('erro', (err as Error).message); } finally { setOcupado(false); }
  };

  const trocarSenha = async (e: FormEvent) => {
    e.preventDefault(); if (!senhas) return;
    const p = problemaSenha(senhas.nova); if (p) { avisar('erro', p); return; }
    setOcupado(true); setMsg(null);
    try { const r = await clubApi.trocarSenha(senhas.atual, senhas.nova); salvarSessaoClube(r.token); setSenhas(null); avisar('ok', 'Senha trocada. As sessões em outros aparelhos foram encerradas.'); }
    catch (err) { avisar('erro', (err as Error).message); } finally { setOcupado(false); }
  };

  const baixarDados = async () => {
    setOcupado(true); setMsg(null);
    try {
      const dados = await clubApi.exportar();
      const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'meus-dados-nexus-club.json' });
      a.click(); URL.revokeObjectURL(url);
      avisar('ok', 'Arquivo com os seus dados baixado.');
    } catch (e) { avisar('erro', (e as Error).message); } finally { setOcupado(false); }
  };

  const sairDoClube = async () => {
    if (!selecionado || !clube || !window.confirm(`Sair do clube ${clube.nome}? As autorizações de mensagens desta loja serão desligadas.`)) return;
    setOcupado(true); setMsg(null);
    try { await clubApi.sair(selecionado); await recarregar(); avisar('ok', 'Você saiu do clube.'); }
    catch (e) { avisar('erro', (e as Error).message); } finally { setOcupado(false); }
  };

  const excluirConta = async (e: FormEvent) => {
    e.preventDefault(); if (!excluir) return;
    setOcupado(true); setMsg(null);
    try { await clubApi.encerrar(excluir.senha); limparSessaoClube(); router.replace('/login?aba=cliente'); }
    catch (err) { avisar('erro', (err as Error).message); setOcupado(false); }
  };

  return (
    <AppClube eu={eu} titulo="Minha conta" carregando={!eu && !erro}>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
      {eu && (
        <>
          <Caixa className="p-4 flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#7C3AED] flex items-center justify-center text-[18px] font-bold shrink-0">{eu.nome.charAt(0).toUpperCase()}</div>
            <div className="min-w-0">
              <p className="font-semibold text-[16px] truncate">{eu.nome}</p>
              <p className="text-[12px] text-[#8B8BA7]">CPF {eu.cpf ?? '—'} · e-mail verificado ✓</p>
            </div>
          </Caixa>

          {!edit && !senhas && (
            <div className="flex flex-wrap gap-2 mt-3">
              <BotaoSecundario type="button" onClick={() => { setMsg(null); setEdit({ nome: eu.nome, celular: eu.celular ?? '', whatsapp: eu.whatsapp ?? '' }); }}>Editar dados</BotaoSecundario>
              <BotaoSecundario type="button" onClick={() => { setMsg(null); setSenhas({ atual: '', nova: '' }); }}>Trocar senha</BotaoSecundario>
              <BotaoSecundario type="button" onClick={sair}>Sair</BotaoSecundario>
            </div>
          )}
          {edit && (
            <Caixa className="p-4 mt-3"><form onSubmit={salvarDados}>
              <Campo rotulo="Nome" value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} />
              <Campo rotulo="Celular" value={edit.celular} onChange={(e) => setEdit({ ...edit, celular: e.target.value })} type="tel" inputMode="tel" />
              <Campo rotulo="WhatsApp" value={edit.whatsapp} onChange={(e) => setEdit({ ...edit, whatsapp: e.target.value })} type="tel" inputMode="tel" ajuda="E-mail e CPF não mudam por aqui." />
              <div className="flex gap-2"><BotaoPrimario type="submit" carregando={ocupado}>Salvar</BotaoPrimario><BotaoSecundario type="button" onClick={() => setEdit(null)}>Cancelar</BotaoSecundario></div>
            </form></Caixa>
          )}
          {senhas && (
            <Caixa className="p-4 mt-3"><form onSubmit={trocarSenha}>
              <Campo rotulo="Senha atual" value={senhas.atual} onChange={(e) => setSenhas({ ...senhas, atual: e.target.value })} type="password" autoComplete="current-password" />
              <Campo rotulo="Nova senha" value={senhas.nova} onChange={(e) => setSenhas({ ...senhas, nova: e.target.value })} type="password" autoComplete="new-password" ajuda="Pelo menos 8 caracteres, com letras e números." />
              <div className="flex gap-2"><BotaoPrimario type="submit" carregando={ocupado}>Trocar senha</BotaoPrimario><BotaoSecundario type="button" onClick={() => setSenhas(null)}>Cancelar</BotaoSecundario></div>
            </form></Caixa>
          )}

          {clubes && clubes.length > 0 && (
            <>
              <div className="mt-6"><SeletorClube clubes={clubes} selecionado={selecionado} escolher={escolher} /></div>
              <Secao titulo={`Comunicações — ${clube?.nome ?? ''}`}>
                <Caixa>
                  {!detalhe && <p className="p-4 text-[13px] text-[#8B8BA7]">Carregando…</p>}
                  {detalhe?.consentimentos.map((c, i) => (
                    <div key={c.canal} className={`px-4 py-3 ${i ? 'border-t border-[#2A2A3E]' : ''}`}>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <p className="text-[14px] font-semibold">{ROTULO_CANAL[c.canal].nome}</p>
                          <p className="text-[12px] text-[#8B8BA7]">{ROTULO_CANAL[c.canal].ajuda}{c.autorizado && c.atualizadoEm ? ` · autorizado em ${new Date(c.atualizadoEm).toLocaleDateString('pt-BR')}` : ''}</p>
                        </div>
                        <Interruptor ligado={c.autorizado} rotulo={ROTULO_CANAL[c.canal].nome} desabilitado={ocupado || detalhe.membro.status !== 'ATIVO' || (!c.autorizado && !detalhe.autorizacao)}
                          onClick={() => (c.autorizado ? mudarCanal(c.canal, false) : setPedindo(c.canal))} />
                      </div>
                      {pedindo === c.canal && detalhe.autorizacao && (
                        <div className="mt-3">
                          <p className="text-[12px] text-[#8B8BA7] mb-2">Leia o texto da loja (versão {detalhe.autorizacao.versao}) antes de autorizar:</p>
                          <TextoTermo texto={detalhe.autorizacao.texto} altura={160} />
                          <div className="flex gap-2 mt-3">
                            <BotaoPrimario type="button" carregando={ocupado} onClick={() => mudarCanal(c.canal, true)}>Autorizar {ROTULO_CANAL[c.canal].nome}</BotaoPrimario>
                            <BotaoSecundario type="button" onClick={() => setPedindo(null)}>Agora não</BotaoSecundario>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {detalhe && !detalhe.autorizacao && <p className="px-4 pb-3 text-[12px] text-[#8B8BA7]">Esta loja ainda não publicou o texto de autorização de mensagens.</p>}
                  {detalhe?.membro.status === 'PENDENTE_VINCULO' && <p className="px-4 pb-3 text-[12px] text-[#8B8BA7]">A loja está confirmando o seu cadastro.</p>}
                </Caixa>
                <p className="text-[12px] text-[#6B6B88] mt-2">Autorizar numa loja não autoriza nas outras. Desligar vale na hora.</p>
              </Secao>

              <Secao titulo="Histórico de autorizações">
                <Caixa className="p-4">
                  {historico == null && <p className="text-[13px] text-[#8B8BA7]">Carregando…</p>}
                  {historico?.length === 0 && <p className="text-[13px] text-[#8B8BA7]">Nenhuma autorização registrada nesta loja.</p>}
                  <ul className="space-y-1.5">
                    {historico?.map((h) => (
                      <li key={h.id} className="text-[13px] text-[#C9C9E0]">
                        {h.acao === 'CONCEDIDO' ? '✅' : '❌'} {new Date(h.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} — {ROTULO_CANAL[h.canal].nome} {h.acao === 'CONCEDIDO' ? 'autorizado' : 'desligado'}{h.versaoTexto ? ` (texto v${h.versaoTexto})` : ''}
                      </li>
                    ))}
                  </ul>
                </Caixa>
              </Secao>
            </>
          )}

          <Secao titulo="Meus dados (LGPD)">
            <Caixa>
              <button type="button" onClick={baixarDados} disabled={ocupado} className="w-full text-left px-4 py-3 text-[14px] hover:bg-white/5">📄 Baixar meus dados</button>
              {clube && <button type="button" onClick={sairDoClube} disabled={ocupado} className="w-full text-left px-4 py-3 text-[14px] border-t border-[#2A2A3E] hover:bg-white/5">🚪 Sair do clube {clube.nome}</button>}
              <button type="button" onClick={() => { setMsg(null); setExcluir({ senha: '' }); }} className="w-full text-left px-4 py-3 text-[14px] text-red-300 border-t border-[#2A2A3E] hover:bg-white/5">🗑 Excluir minha conta NEXUS CLUB</button>
            </Caixa>
            {excluir && (
              <Caixa className="p-4 mt-3 border-red-500/40">
                <form onSubmit={excluirConta}>
                  <p className="text-[13px] text-[#C9C9E0] mb-3">Você sai de todos os clubes, as autorizações são desligadas e seus dados pessoais da conta são apagados. As compras continuam no cadastro de cada loja (obrigação fiscal). Não dá para desfazer.</p>
                  <Campo rotulo="Confirme com a sua senha" value={excluir.senha} onChange={(e) => setExcluir({ senha: e.target.value })} type="password" autoComplete="current-password" />
                  <div className="flex gap-2">
                    <button type="submit" disabled={!excluir.senha || ocupado} className="flex-1 h-[48px] rounded-[16px] bg-red-600 hover:bg-red-700 font-semibold disabled:opacity-50">Excluir minha conta</button>
                    <BotaoSecundario type="button" onClick={() => setExcluir(null)}>Cancelar</BotaoSecundario>
                  </div>
                </form>
              </Caixa>
            )}
          </Secao>
        </>
      )}
    </AppClube>
  );
}
