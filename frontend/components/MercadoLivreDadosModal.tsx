'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import {
  TravaEnvio,
  atualizarUsuarioML,
  consultarAplicacaoML,
  consultarEnderecosML,
  consultarMarcasML,
  consultarMeiosPagamentoML,
  consultarNotificacoesPerdidasML,
  consultarPacotesPromocaoML,
  consultarUsuarioLogadoML,
  consultarUsuarioPorIdML,
  dadosDeSucesso,
  montarCorpoAtualizacaoML,
  type AplicacaoML,
  type EnderecoML,
  type EstadoSecao,
  type MarcaML,
  type MeioPagamentoML,
  type NotificacaoPerdidaML,
  type PacotePromocaoML,
  type UsuarioML,
} from '@/lib/mercadolivre-dados';

type Aba = 'conta' | 'porId' | 'editar' | 'enderecos' | 'pagamentos' | 'aplicacao' | 'marcas' | 'promocoes' | 'notificacoes';

const ABAS: Array<{ id: Aba; rotulo: string }> = [
  { id: 'conta', rotulo: 'Conta' },
  { id: 'porId', rotulo: 'Por ID' },
  { id: 'editar', rotulo: 'Editar' },
  { id: 'enderecos', rotulo: 'Endereços' },
  { id: 'pagamentos', rotulo: 'Pagamentos' },
  { id: 'aplicacao', rotulo: 'Aplicação' },
  { id: 'marcas', rotulo: 'Marcas' },
  { id: 'promocoes', rotulo: 'Promoções' },
  { id: 'notificacoes', rotulo: 'Notificações' },
];

const OCioso: EstadoSecao = { estado: 'ocioso' };

function valorTexto(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '—';
  }
}

function BlocoEstado({ secao, vazioTexto = 'Nenhum registro retornado.' }: { secao: EstadoSecao; vazioTexto?: string }) {
  if (secao.estado === 'ocioso') return <p className="text-[12px] text-zinc-500">Aguardando consulta.</p>;
  if (secao.estado === 'carregando') return <p className="text-[12px] text-zinc-400">Carregando…</p>;
  if (secao.estado === 'vazio') return <p className="text-[12px] text-zinc-400">{vazioTexto}</p>;
  if (secao.estado === 'sucesso') return null;
  return (
    <p className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
      {(secao as { mensagem: string }).mensagem}
    </p>
  );
}

function ListaGenerica({ itens, campos }: { itens: unknown[]; campos: string[] }) {
  return (
    <ul className="space-y-2">
      {itens.map((item, i) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        return (
          <li key={i} className="rounded-[10px] border border-[#2A2A35] bg-[#0F0F14] px-3 py-2">
            {campos.map((c) => (
              <p key={c} className="text-[12px] text-zinc-300">
                <span className="text-zinc-500">{c}: </span>
                {valorTexto(obj[c])}
              </p>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
export default function MercadoLivreDadosModal({ onClose, contaId = null, contaNome = null }: {
  onClose: () => void;
  contaId?: string | null;
  contaNome?: string | null;
}) {
  const [aba, setAba] = useState<Aba>('conta');
  const [conta, setConta] = useState<EstadoSecao>(OCioso);
  const [porId, setPorId] = useState<EstadoSecao>(OCioso);
  const [enderecos, setEnderecos] = useState<EstadoSecao>(OCioso);
  const [pagamentos, setPagamentos] = useState<EstadoSecao>(OCioso);
  const [aplicacao, setAplicacao] = useState<EstadoSecao>(OCioso);
  const [marcas, setMarcas] = useState<EstadoSecao>(OCioso);
  const [promocoes, setPromocoes] = useState<EstadoSecao>(OCioso);
  const [notificacoes, setNotificacoes] = useState<EstadoSecao>(OCioso);
  const [appId, setAppId] = useState('');
  const [userId, setUserId] = useState(contaId ?? '');
  const [buscando, setBuscando] = useState(false);
  const trava = useRef(new TravaEnvio());
  const [form, setForm] = useState<Record<string, string>>({});
  const [editando, setEditando] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [editErro, setEditErro] = useState<string | null>(null);

  const carregarConta = useCallback(async () => {
    setConta({ estado: 'carregando' });
    setConta(await consultarUsuarioLogadoML(api));
  }, []);

  useEffect(() => { void carregarConta(); }, [carregarConta]);
  useEffect(() => {
    const t = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', t);
    return () => window.removeEventListener('keydown', t);
  }, [onClose]);

  async function buscarPorId() {
    setBuscando(true);
    setPorId({ estado: 'carregando' });
    setPorId(await consultarUsuarioPorIdML(api, userId));
    setBuscando(false);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEditMsg(null);
    setEditErro(null);
    const montado = montarCorpoAtualizacaoML({
      first_name: form.first_name,
      last_name: form.last_name,
      phone_area_code: form.phone_area_code,
      phone_number: form.phone_number,
      address_address: form.address_address,
      address_city: form.address_city,
      address_state: form.address_state,
      address_zip_code: form.address_zip_code,
      company_corporate_name: form.company_corporate_name,
      company_brand_name: form.company_brand_name,
    });
    if (montado.erro || !montado.corpo) { setEditErro(montado.erro ?? 'Nada para atualizar.'); return; }
    if (editando) return;
    setEditando(true);
    try {
      const r = await trava.current.executar(() => atualizarUsuarioML(api, montado.corpo!));
      if (!r.executou) return;
      const estado = r.resultado!;
      if (estado.estado === 'sucesso') {
        setEditMsg('Dados atualizados no Mercado Livre.');
        setConta(estado);
        setForm({});
      } else {
        setEditErro((estado as { mensagem?: string }).mensagem ?? 'Falha ao atualizar.');
      }
    } finally {
      setEditando(false);
    }
  }

  const usuario = dadosDeSucesso<UsuarioML>(conta);
  const usuarioPorId = dadosDeSucesso<UsuarioML>(porId);
  const campo = (id: string, rotulo: string, ph?: string) => (
    <label className="block">
      <span className="block text-[11px] font-medium text-zinc-400 mb-1">{rotulo}</span>
      <input
        value={form[id] ?? ''}
        onChange={(ev) => setForm((f) => ({ ...f, [id]: ev.target.value }))}
        placeholder={ph ?? '—'}
        className="w-full h-9 rounded-[10px] bg-[#0F0F14] border border-[#2A2A35] px-3 text-[12px] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#7C3AED]"
      />
    </label>
  );


  async function carregarAba(id: Aba) {
    setAba(id);
    const uid = (userId || contaId || '').trim();
    if (id === 'enderecos' && enderecos.estado === 'ocioso') {
      setEnderecos({ estado: 'carregando' });
      setEnderecos(await consultarEnderecosML(api, uid));
    }
    if (id === 'pagamentos' && pagamentos.estado === 'ocioso') {
      setPagamentos({ estado: 'carregando' });
      setPagamentos(await consultarMeiosPagamentoML(api, uid));
    }
    if (id === 'marcas' && marcas.estado === 'ocioso') {
      setMarcas({ estado: 'carregando' });
      setMarcas(await consultarMarcasML(api, uid));
    }
    if (id === 'promocoes' && promocoes.estado === 'ocioso') {
      setPromocoes({ estado: 'carregando' });
      setPromocoes(await consultarPacotesPromocaoML(api, uid));
    }
    if (id === 'notificacoes' && notificacoes.estado === 'ocioso') {
      setNotificacoes({ estado: 'carregando' });
      setNotificacoes(await consultarNotificacoesPerdidasML(api, uid || undefined));
    }
  }

  async function buscarAplicacao() {
    setAplicacao({ estado: 'carregando' });
    setAplicacao(await consultarAplicacaoML(api, appId));
  }

  const listaEnd = dadosDeSucesso<EnderecoML[]>(enderecos);
  const listaPag = dadosDeSucesso<MeioPagamentoML[]>(pagamentos);
  const app = dadosDeSucesso<AplicacaoML>(aplicacao);
  const listaMarcas = dadosDeSucesso<MarcaML[]>(marcas);
  const listaPromo = dadosDeSucesso<PacotePromocaoML[]>(promocoes);
  const listaNotif = dadosDeSucesso<NotificacaoPerdidaML[]>(notificacoes);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Dados da conta Mercado Livre" className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-[16px] bg-[#1A1A23] border border-[#2A2A35] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#2A2A35]">
          <div className="min-w-0">
            <h2 className="text-[14px] font-bold text-white">Dados da conta Mercado Livre</h2>
            <p className="text-[11px] text-zinc-500 truncate">{contaNome ? `Conta: ${contaNome}` : 'Dados reais via /integracoes/mercadolivre'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="h-8 w-8 shrink-0 rounded-[10px] border border-[#2A2A35] text-zinc-400 hover:text-zinc-100">X</button>
        </div>
        <div className="flex flex-wrap gap-1.5 px-5 py-3 border-b border-[#2A2A35]/60">
          {ABAS.map((a) => (
            <button key={a.id} type="button" onClick={() => void carregarAba(a.id)} aria-pressed={aba === a.id} className={aba === a.id ? 'h-7 px-2.5 rounded-full text-[11px] font-medium bg-[#7C3AED] text-white' : 'h-7 px-2.5 rounded-full text-[11px] font-medium bg-[#12121A] border border-[#2A2A35] text-zinc-400'}>{a.rotulo}</button>
          ))}
        </div>
        <div className="overflow-y-auto px-5 py-4 text-[12px]">
          {aba === 'conta' && (
            <div className="space-y-2">
              <BlocoEstado secao={conta} />
              {usuario && <ListaGenerica itens={[usuario]} campos={['id', 'nickname', 'first_name', 'last_name', 'email']} />}
              <button type="button" onClick={() => void carregarConta()} className="h-8 px-3 rounded-[10px] border border-[#2A2A35] text-zinc-300">Recarregar</button>
            </div>
          )}
          {aba === 'porId' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="ID do usuário" aria-label="ID do usuário" className="flex-1 h-9 rounded-[10px] bg-[#0F0F14] border border-[#2A2A35] px-3 text-zinc-100" />
                <button type="button" onClick={() => void buscarPorId()} disabled={buscando} className="h-9 px-3 rounded-[10px] bg-[#7C3AED] text-white disabled:opacity-50">{buscando ? 'Buscando...' : 'Buscar'}</button>
              </div>
              <BlocoEstado secao={porId} />
              {usuarioPorId && <ListaGenerica itens={[usuarioPorId]} campos={['id', 'nickname', 'first_name', 'last_name', 'email']} />}
            </div>
          )}
          {aba === 'editar' && (
            <form onSubmit={(e) => void salvar(e)} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {campo('first_name', 'Nome', usuario?.first_name as string | undefined)}
                {campo('last_name', 'Sobrenome', usuario?.last_name as string | undefined)}
                {campo('phone_area_code', 'DDD')}
                {campo('phone_number', 'Telefone')}
                {campo('address_address', 'Endereço')}
                {campo('address_city', 'Cidade')}
                {campo('address_state', 'Estado')}
                {campo('address_zip_code', 'CEP')}
                {campo('company_corporate_name', 'Razão social')}
                {campo('company_brand_name', 'Nome fantasia')}
              </div>
              {editErro && <p className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{editErro}</p>}
              {editMsg && <p className="rounded-[10px] border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-200">{editMsg}</p>}
              <button type="submit" disabled={editando} className="h-9 px-4 rounded-[10px] bg-[#7C3AED] text-white text-[12px] font-medium disabled:opacity-50">{editando ? 'Salvando...' : 'Salvar'}</button>
            </form>
          )}
          {aba === 'enderecos' && (
            <div className="space-y-2">
              <BlocoEstado secao={enderecos} />
              {listaEnd && <ListaGenerica itens={listaEnd} campos={['id', 'address', 'city', 'state', 'zip_code']} />}
            </div>
          )}
          {aba === 'pagamentos' && (
            <div className="space-y-2">
              <BlocoEstado secao={pagamentos} />
              {listaPag && <ListaGenerica itens={listaPag} campos={['id', 'name', 'payment_type_id']} />}
            </div>
          )}
          {aba === 'aplicacao' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="ID da aplicação" aria-label="ID da aplicação" className="flex-1 h-9 rounded-[10px] bg-[#0F0F14] border border-[#2A2A35] px-3 text-zinc-100" />
                <button type="button" onClick={() => void buscarAplicacao()} className="h-9 px-3 rounded-[10px] bg-[#7C3AED] text-white">Buscar</button>
              </div>
              <BlocoEstado secao={aplicacao} />
              {app && <ListaGenerica itens={[app]} campos={['id', 'name', 'client_id']} />}
            </div>
          )}
          {aba === 'marcas' && (
            <div className="space-y-2">
              <BlocoEstado secao={marcas} />
              {listaMarcas && <ListaGenerica itens={listaMarcas} campos={['id', 'name']} />}
            </div>
          )}
          {aba === 'promocoes' && (
            <div className="space-y-2">
              <BlocoEstado secao={promocoes} />
              {listaPromo && <ListaGenerica itens={listaPromo} campos={['id', 'description']} />}
            </div>
          )}
          {aba === 'notificacoes' && (
            <div className="space-y-2">
              <BlocoEstado secao={notificacoes} vazioTexto="Nenhuma notificação perdida." />
              {listaNotif && <ListaGenerica itens={listaNotif} campos={['id', 'topic', 'resource', 'user_id']} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
