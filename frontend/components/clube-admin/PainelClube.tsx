'use client';
/**
 * Aba "★ NEXUS CLUB" do módulo Clientes (Fase 6, mockup 05): Visão geral, Membros, Termos e
 * Configurações. Promoções (Fase 7) e Campanhas (Fase 8) entram como sub-abas próprias.
 * Indicadores só com dados reais do banco: sem dado, mostra 0 ou "—", nunca valor de exemplo.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import api from '@/lib/api';
import { formatBRL } from '@/lib/format';

const s = {
  card: 'bg-[var(--nexus-panel)] border border-[var(--nexus-border)] rounded-[16px] p-[18px]',
  input: 'w-full bg-[var(--nexus-panel-2)] border border-[var(--nexus-border)] rounded-[8px] h-[40px] px-[12px] text-[var(--nexus-text)] text-[13px] placeholder:text-[var(--nexus-muted)] focus:border-[var(--nexus-accent)] focus:outline-none',
  btn: 'bg-[var(--nexus-accent)] hover:bg-[var(--nexus-accent-2)] text-white text-[12px] font-bold rounded-[8px] px-[16px] h-[36px] disabled:opacity-50',
  btn2: 'bg-[var(--nexus-panel-2)] border border-[var(--nexus-border)] text-[var(--nexus-text)] rounded-[8px] text-[12px] px-[12px] h-[34px] hover:border-[var(--nexus-accent)] disabled:opacity-50',
  rotulo: 'text-[10px] uppercase tracking-[0.14em] text-[var(--nexus-muted)] font-semibold',
  th: 'text-left text-[10px] uppercase tracking-[0.12em] text-[var(--nexus-muted)] font-semibold px-3 py-2',
  td: 'px-3 py-2.5 text-[13px] text-[var(--nexus-text)] border-t border-[var(--nexus-border)] align-middle',
};

type Aba = 'visao' | 'membros' | 'termos' | 'config';
type Config = { id: string; nome: string; ativo: boolean; publico: boolean; cor: string | null; beneficioPercentual: number | null; limiteBeneficio: number | null };
type Visao = {
  plataformaLigada: boolean; config: Config | null; textoAutorizacao: { versao: number; publicadoEm: string } | null;
  indicadores: { membrosAtivos: number; aguardandoVinculo: number; sairam: number; bloqueados: number; novos30dias: number; autorizamWhatsapp: number; autorizamEmail: number; autorizamApp: number; comprasMembros30dias: number; valorMembros30dias: number };
};
type Membro = {
  id: string; status: 'ATIVO' | 'PENDENTE_VINCULO' | 'SAIU' | 'BLOQUEADO'; entrouEm: string; saiuEm: string | null;
  cliente: { id: string; nome: string; documento: string | null; telefone: string | null; email: string | null; ultimaCompra: string | null } | null;
  autoriza: { WHATSAPP: boolean; EMAIL: boolean; APP: boolean };
};
const STATUS: Record<Membro['status'], { texto: string; cor: string }> = {
  ATIVO: { texto: 'Ativo', cor: 'text-[var(--nx-green)] border-[rgba(var(--nx-green-rgb),0.35)]' },
  PENDENTE_VINCULO: { texto: 'Escolher cadastro', cor: 'text-amber-400 border-amber-400/40' },
  SAIU: { texto: 'Saiu', cor: 'text-[var(--nexus-muted)] border-[var(--nexus-border)]' },
  BLOQUEADO: { texto: 'Bloqueado', cor: 'text-[var(--nx-red)] border-[rgba(var(--nx-red-rgb),0.35)]' },
};
const erroDe = (e: unknown) => (e as Error)?.message || 'Não foi possível concluir.';

function Aviso({ tom = 'info', children }: { tom?: 'info' | 'erro' | 'ok'; children: ReactNode }) {
  const cor = { info: 'border-[var(--nexus-border)] text-[var(--nexus-muted)]', erro: 'border-[rgba(var(--nx-red-rgb),0.4)] text-[var(--nx-red)]', ok: 'border-[rgba(var(--nx-green-rgb),0.4)] text-[var(--nx-green)]' }[tom];
  return <div role={tom === 'erro' ? 'alert' : 'status'} className={`border border-dashed rounded-[12px] px-4 py-3 text-[12.5px] ${cor}`}>{children}</div>;
}

export default function PainelClube({ permissoes }: { permissoes: Set<string> }) {
  const pode = (a: string) => permissoes.has(`clientes:${a}`);
  const [aba, setAba] = useState<Aba>('visao');
  const [visao, setVisao] = useState<Visao | null>(null);
  const [erro, setErro] = useState('');
  const carregarVisao = useCallback(() => api.get<Visao>('/clientes/clube/visao-geral').then((r) => setVisao(r.data)).catch((e) => setErro(erroDe(e))), []);
  useEffect(() => { void carregarVisao(); }, [carregarVisao]);

  const abas: Array<[Aba, string]> = [['visao', 'Visão geral'], ['membros', 'Membros'], ['termos', 'Termos'], ['config', 'Configurações']];
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1 border-b border-[var(--nexus-border)]" aria-label="NEXUS CLUB">
        {abas.map(([k, rotulo]) => (
          <button key={k} type="button" onClick={() => setAba(k)} aria-current={aba === k ? 'page' : undefined}
            className={`px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px ${aba === k ? 'border-[var(--nexus-accent)] text-[var(--nexus-text)]' : 'border-transparent text-[var(--nexus-muted)] hover:text-[var(--nexus-text)]'}`}>{rotulo}</button>
        ))}
      </nav>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {visao && !visao.plataformaLigada && <Aviso>O NEXUS CLUB ainda está desligado na plataforma: você já pode configurar o clube e o texto de autorização; os clientes só conseguem entrar quando ele for ligado.</Aviso>}
      {aba === 'visao' && <VisaoGeral visao={visao} irPara={setAba} />}
      {aba === 'membros' && <Membros pode={pode} aoMudar={carregarVisao} />}
      {aba === 'termos' && <Termos pode={pode} aoMudar={carregarVisao} />}
      {aba === 'config' && <Configuracao pode={pode} atual={visao?.config ?? null} aoSalvar={carregarVisao} />}
    </div>
  );
}

function VisaoGeral({ visao, irPara }: { visao: Visao | null; irPara: (a: Aba) => void }) {
  if (!visao) return <p className="text-[13px] text-[var(--nexus-muted)]">Carregando…</p>;
  const i = visao.indicadores;
  const kpis: Array<[string, string, string]> = [
    ['Membros ativos', String(i.membrosAtivos), 'calculado do banco'],
    ['Entraram (30 dias)', String(i.novos30dias), 'novas carteirinhas'],
    ['Aceitam WhatsApp', String(i.autorizamWhatsapp), 'com autorização válida'],
    ['Aceitam e-mail', String(i.autorizamEmail), 'com autorização válida'],
    ['Compras de membros (30 dias)', String(i.comprasMembros30dias), i.comprasMembros30dias ? formatBRL(i.valorMembros30dias) : '—'],
    ['Escolher cadastro', String(i.aguardandoVinculo), 'mesmo CPF em 2+ cadastros'],
  ];
  return (
    <div className="space-y-4">
      {!visao.config && <Aviso>Esta loja ainda não tem clube. <button type="button" className="underline font-semibold" onClick={() => irPara('config')}>Criar o clube</button></Aviso>}
      {visao.config && (
        <div className={`${s.card} flex flex-wrap items-center gap-3`}>
          <span className="text-[16px] font-bold text-[var(--nexus-text)]">★ {visao.config.nome}</span>
          <span className={`text-[11px] font-semibold border rounded-full px-2 py-0.5 ${visao.config.ativo ? 'text-[var(--nx-green)] border-[rgba(var(--nx-green-rgb),0.35)]' : 'text-[var(--nexus-muted)] border-[var(--nexus-border)]'}`}>{visao.config.ativo ? 'Ativo' : 'Desligado'}</span>
          <span className="text-[12px] text-[var(--nexus-muted)]">{visao.config.publico ? 'Aparece na busca de lojas' : 'Fora da busca de lojas'}</span>
          <span className="text-[12px] text-[var(--nexus-muted)]">Benefício: {visao.config.beneficioPercentual ? `${visao.config.beneficioPercentual}%` : '—'}</span>
          <span className="text-[12px] text-[var(--nexus-muted)]">Texto de autorização: {visao.textoAutorizacao ? `versão ${visao.textoAutorizacao.versao}` : 'não publicado'}</span>
        </div>
      )}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(([rotulo, valor, ajuda]) => (
          <div key={rotulo} className={s.card}>
            <p className={s.rotulo}>{rotulo}</p>
            <p className="text-[22px] font-bold text-[var(--nexus-text)] mt-1.5">{valor === '0' ? '—' : valor}</p>
            <p className="text-[11px] text-[var(--nexus-muted)] mt-1">{ajuda}</p>
          </div>
        ))}
      </section>
      <p className="text-[11.5px] text-[var(--nexus-muted)]">Os números “—” só aparecem quando há dados reais. Nada de valor de exemplo nos indicadores.</p>
    </div>
  );
}

function Membros({ pode, aoMudar }: { pode: (a: string) => boolean; aoMudar: () => void }) {
  const [filtro, setFiltro] = useState<'' | Membro['status']>('');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<Membro[] | null>(null);
  const [escolhendo, setEscolhendo] = useState<{ membro: Membro; candidatos: any[] } | null>(null);
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);
  const carregar = useCallback(() => {
    const q = new URLSearchParams({ ...(filtro ? { status: filtro } : {}), ...(busca.trim() ? { busca: busca.trim() } : {}) }).toString();
    api.get<Membro[]>(`/clientes/clube/membros${q ? `?${q}` : ''}`).then((r) => setLista(r.data)).catch((e) => setMsg({ tom: 'erro', texto: erroDe(e) }));
  }, [filtro, busca]);
  useEffect(() => { const t = setTimeout(carregar, 250); return () => clearTimeout(t); }, [carregar]);

  const abrirEscolha = async (m: Membro) => {
    try { setEscolhendo({ membro: m, candidatos: (await api.get<any[]>(`/clientes/clube/membros/${m.id}/candidatos`)).data }); }
    catch (e) { setMsg({ tom: 'erro', texto: erroDe(e) }); }
  };
  const vincular = async (clienteId: string) => {
    if (!escolhendo) return;
    try { await api.post(`/clientes/clube/membros/${escolhendo.membro.id}/vincular`, { clienteId }); setEscolhendo(null); setMsg({ tom: 'ok', texto: 'Cadastro escolhido. A carteirinha está ativa.' }); carregar(); aoMudar(); }
    catch (e) { setMsg({ tom: 'erro', texto: erroDe(e) }); }
  };
  const bloqueio = async (m: Membro, bloquear: boolean) => {
    if (bloquear && !window.confirm('Bloquear esta carteirinha? As mensagens desta loja para a pessoa serão desligadas.')) return;
    try { await api.post(`/clientes/clube/membros/${m.id}/${bloquear ? 'bloquear' : 'desbloquear'}`, {}); setMsg({ tom: 'ok', texto: bloquear ? 'Carteirinha bloqueada.' : 'Carteirinha desbloqueada.' }); carregar(); aoMudar(); }
    catch (e) { setMsg({ tom: 'erro', texto: erroDe(e) }); }
  };

  return (
    <div className="space-y-3">
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
      <div className="flex flex-wrap gap-2">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou CPF" className={`${s.input} max-w-[280px]`} aria-label="Buscar membro" />
        <select value={filtro} onChange={(e) => setFiltro(e.target.value as any)} className={`${s.input} max-w-[220px]`} aria-label="Situação">
          <option value="">Todas as situações</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
        </select>
      </div>
      <div className={`${s.card} !p-0 overflow-x-auto`}>
        <table className="w-full min-w-[720px]">
          <thead><tr><th className={s.th}>Cliente</th><th className={s.th}>CPF</th><th className={s.th}>Situação</th><th className={s.th}>Entrou em</th><th className={s.th}>Autoriza</th><th className={s.th} /></tr></thead>
          <tbody>
            {lista == null && <tr><td className={s.td} colSpan={6}>Carregando…</td></tr>}
            {lista?.length === 0 && <tr><td className={s.td} colSpan={6}>Nenhum membro{filtro || busca ? ' com este filtro' : ' ainda'}.</td></tr>}
            {lista?.map((m) => (
              <tr key={m.id}>
                <td className={s.td}>{m.cliente?.nome ?? <span className="text-[var(--nexus-muted)]">aguardando a loja escolher o cadastro</span>}</td>
                <td className={s.td}>{m.cliente?.documento ?? '—'}</td>
                <td className={s.td}><span className={`text-[11px] font-semibold border rounded-full px-2 py-0.5 ${STATUS[m.status].cor}`}>{STATUS[m.status].texto}</span></td>
                <td className={s.td}>{new Date(m.entrouEm).toLocaleDateString('pt-BR')}</td>
                <td className={s.td}>{[m.autoriza.WHATSAPP && 'WhatsApp', m.autoriza.EMAIL && 'E-mail', m.autoriza.APP && 'App'].filter(Boolean).join(' · ') || '—'}</td>
                <td className={`${s.td} text-right whitespace-nowrap`}>
                  {m.status === 'PENDENTE_VINCULO' && pode('editar') && <button type="button" className={s.btn2} onClick={() => abrirEscolha(m)}>Escolher cadastro</button>}
                  {m.status !== 'BLOQUEADO' && m.status !== 'SAIU' && pode('administrar') && <button type="button" className={`${s.btn2} ml-2`} onClick={() => bloqueio(m, true)}>Bloquear</button>}
                  {m.status === 'BLOQUEADO' && pode('administrar') && <button type="button" className={`${s.btn2} ml-2`} onClick={() => bloqueio(m, false)}>Desbloquear</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {escolhendo && (
        <div className={s.card}>
          <p className="text-[14px] font-bold text-[var(--nexus-text)] mb-1">Qual cadastro é desta pessoa?</p>
          <p className="text-[12px] text-[var(--nexus-muted)] mb-3">Há mais de um cadastro com o mesmo CPF nesta loja. As compras e autorizações vão para o cadastro escolhido.</p>
          <div className="space-y-2">
            {escolhendo.candidatos.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 border border-[var(--nexus-border)] rounded-[10px] px-3 py-2">
                <div className="flex-1 min-w-[200px] text-[13px] text-[var(--nexus-text)]">
                  <strong>{c.nome}</strong> · {c.documento ?? '—'} · {c.telefone || c.email || 'sem contato'}
                  <p className="text-[11.5px] text-[var(--nexus-muted)]">Cadastrado em {new Date(c.criadoEm).toLocaleDateString('pt-BR')} · comprou {formatBRL(c.valorTotalComprado)}{c.ultimaCompra ? ` · última compra ${new Date(c.ultimaCompra).toLocaleDateString('pt-BR')}` : ''}</p>
                </div>
                <button type="button" className={s.btn} onClick={() => vincular(c.id)}>Usar este</button>
              </div>
            ))}
          </div>
          <button type="button" className={`${s.btn2} mt-3`} onClick={() => setEscolhendo(null)}>Cancelar</button>
        </div>
      )}
    </div>
  );
}

function Termos({ pode, aoMudar }: { pode: (a: string) => boolean; aoMudar: () => void }) {
  const [lista, setLista] = useState<Array<{ id: string; versao: number; texto: string; publicadoEm: string; autorizacoes: number }> | null>(null);
  const [texto, setTexto] = useState('');
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);
  const carregar = useCallback(() => api.get<any[]>('/clientes/clube/termos').then((r) => { setLista(r.data); if (!texto && r.data[0]) setTexto(r.data[0].texto); }).catch((e) => setMsg({ tom: 'erro', texto: erroDe(e) })), [texto]);
  useEffect(() => { void carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const publicar = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.post<{ versao: number; igual?: boolean }>('/clientes/clube/termos', { texto });
      setMsg({ tom: 'ok', texto: r.data.igual ? 'Este texto já é a versão atual.' : `Versão ${r.data.versao} publicada. Novas autorizações usam esta versão.` });
      void carregar(); aoMudar();
    } catch (err) { setMsg({ tom: 'erro', texto: erroDe(err) }); }
  };
  return (
    <div className="space-y-3">
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
      <div className={s.card}>
        <p className="text-[14px] font-bold text-[var(--nexus-text)]">Texto de autorização de mensagens</p>
        <p className="text-[12px] text-[var(--nexus-muted)] mb-3">É o que o cliente lê antes de ligar WhatsApp, e-mail ou avisos no app para esta loja. Cada mudança vira uma versão nova; cada autorização guarda a versão que a pessoa leu.</p>
        {pode('administrar') ? (
          <form onSubmit={publicar}>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} className={`${s.input} !h-auto py-2 leading-relaxed`} placeholder="Ex.: Autorizo a [nome da loja] a me enviar ofertas e avisos pelos canais que eu escolher. Posso desligar quando quiser." aria-label="Texto de autorização" />
            <p className="text-[11px] text-[var(--nexus-muted)] mt-1">Mínimo de 80 caracteres. Não publique com campos entre colchetes.</p>
            <button type="submit" className={`${s.btn} mt-3`} disabled={texto.trim().length < 80}>Publicar nova versão</button>
          </form>
        ) : <p className="text-[12px] text-[var(--nexus-muted)]">Publicar exige a permissão clientes.administrar.</p>}
      </div>
      <div className={`${s.card} !p-0 overflow-x-auto`}>
        <table className="w-full min-w-[560px]">
          <thead><tr><th className={s.th}>Versão</th><th className={s.th}>Publicada em</th><th className={s.th}>Autorizações registradas</th><th className={s.th}>Texto</th></tr></thead>
          <tbody>
            {lista == null && <tr><td className={s.td} colSpan={4}>Carregando…</td></tr>}
            {lista?.length === 0 && <tr><td className={s.td} colSpan={4}>Nenhuma versão publicada.</td></tr>}
            {lista?.map((t) => <tr key={t.id}><td className={s.td}>v{t.versao}</td><td className={s.td}>{new Date(t.publicadoEm).toLocaleString('pt-BR')}</td><td className={s.td}>{t.autorizacoes || '—'}</td><td className={`${s.td} max-w-[420px] truncate`} title={t.texto}>{t.texto}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Configuracao({ pode, atual, aoSalvar }: { pode: (a: string) => boolean; atual: Config | null; aoSalvar: () => void }) {
  const [f, setF] = useState({ nome: '', ativo: false, publico: false, beneficio: '', limite: '' });
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);
  useEffect(() => {
    if (atual) setF({ nome: atual.nome, ativo: atual.ativo, publico: atual.publico, beneficio: atual.beneficioPercentual?.toString() ?? '', limite: atual.limiteBeneficio?.toString() ?? '' });
  }, [atual]);
  const editavel = pode('administrar');
  const numero = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null);
  const salvar = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    try {
      await api.put('/clientes/clube/config', { nome: f.nome.trim(), ativo: f.ativo, publico: f.publico, beneficioPercentual: numero(f.beneficio), limiteBeneficio: numero(f.limite) });
      setMsg({ tom: 'ok', texto: 'Configuração salva.' }); aoSalvar();
    } catch (err) { setMsg({ tom: 'erro', texto: erroDe(err) }); }
  };
  const Chave = ({ campo, rotulo, ajuda }: { campo: 'ativo' | 'publico'; rotulo: string; ajuda: string }) => (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={f[campo]} disabled={!editavel} onChange={(e) => setF({ ...f, [campo]: e.target.checked })} className="mt-1 h-4 w-4 accent-[var(--nexus-accent)]" />
      <span><span className="text-[13px] font-semibold text-[var(--nexus-text)]">{rotulo}</span><span className="block text-[12px] text-[var(--nexus-muted)]">{ajuda}</span></span>
    </label>
  );
  return (
    <form onSubmit={salvar} className={`${s.card} space-y-4 max-w-[640px]`}>
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
      {!editavel && <Aviso>Somente leitura: alterar exige a permissão clientes.administrar.</Aviso>}
      <label className="block"><span className={s.rotulo}>Nome do clube *</span><input value={f.nome} disabled={!editavel} onChange={(e) => setF({ ...f, nome: e.target.value })} className={`${s.input} mt-1`} placeholder="Ex.: Clube da Loja" /></label>
      <Chave campo="ativo" rotulo="Clube ativo" ajuda="Desligado, ninguém novo entra e o clube some do app dos clientes." />
      <Chave campo="publico" rotulo="Aparecer na busca de lojas" ajuda="Sem isso, o clube não aparece em “Encontrar loja”." />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block"><span className={s.rotulo}>Benefício para membros (%)</span><input value={f.beneficio} disabled={!editavel} onChange={(e) => setF({ ...f, beneficio: e.target.value })} inputMode="decimal" className={`${s.input} mt-1`} placeholder="Ex.: 5" /></label>
        <label className="block"><span className={s.rotulo}>Limite do benefício por compra (R$)</span><input value={f.limite} disabled={!editavel} onChange={(e) => setF({ ...f, limite: e.target.value })} inputMode="decimal" className={`${s.input} mt-1`} placeholder="Ex.: 20" /></label>
      </div>
      <p className="text-[11.5px] text-[var(--nexus-muted)]">O benefício aparece para o cliente no app. A aplicação do desconto no caixa entra na etapa do PDV, sempre calculada pelo servidor.</p>
      {editavel && <button type="submit" className={s.btn} disabled={f.nome.trim().length < 2}>{atual ? 'Salvar' : 'Criar clube'}</button>}
    </form>
  );
}
