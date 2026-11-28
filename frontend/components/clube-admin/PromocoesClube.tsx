'use client';
/**
 * Sub-aba "Promoções" do NEXUS CLUB (Fase 7, mockup 05): lista com situação e o painel
 * "Nova promoção" (produto do cadastro, quem pode usar, preço, filiais, período, limite).
 * O servidor confere tudo de novo: preço menor que o atual, nunca abaixo do custo e a alçada
 * de desconto de quem publica (mesmas faixas do PDV).
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
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
type Situacao = 'RASCUNHO' | 'AGENDADA' | 'ATIVA' | 'VENCIDA' | 'ENCERRADA' | 'CANCELADA';
const SIT: Record<Situacao, { texto: string; cor: string }> = {
  RASCUNHO: { texto: 'Rascunho', cor: 'text-[var(--nexus-muted)] border-[var(--nexus-border)]' },
  AGENDADA: { texto: 'Agendada', cor: 'text-amber-400 border-amber-400/40' },
  ATIVA: { texto: 'Ativa', cor: 'text-[var(--nx-green)] border-[rgba(var(--nx-green-rgb),0.35)]' },
  VENCIDA: { texto: 'Vencida', cor: 'text-[var(--nexus-muted)] border-[var(--nexus-border)]' },
  ENCERRADA: { texto: 'Encerrada', cor: 'text-[var(--nexus-muted)] border-[var(--nexus-border)]' },
  CANCELADA: { texto: 'Cancelada', cor: 'text-[var(--nx-red)] border-[rgba(var(--nx-red-rgb),0.35)]' },
};
type Linha = { id: string; tipo: 'TODOS' | 'MEMBROS'; titulo: string | null; produto: { id: string; nome: string }; de: number; por: number; desconto: number; inicio: string; fim: string; situacao: Situacao; limitePorCliente: number | null; todasFiliais: boolean; filiais: Array<{ id: string; nome: string }> };
type Produto = { id: string; nome: string; precoVenda: number; custo?: number | null; estoque: number; unidade: string; foto: string | null };
const erroDe = (e: unknown) => (e as Error)?.message || 'Não foi possível concluir.';
const paraLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function PromocoesClube({ pode }: { pode: (modulo: string, acao: string) => boolean }) {
  const podeMarketing = pode('clientes', 'editar') && pode('produtos', 'editar');
  const [lista, setLista] = useState<Linha[] | null>(null);
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);
  const [aberto, setAberto] = useState(false);
  const carregar = useCallback(() => api.get<Linha[]>('/clientes/clube/promocoes').then((r) => setLista(r.data)).catch((e) => setMsg({ tom: 'erro', texto: erroDe(e) })), []);
  useEffect(() => { void carregar(); }, [carregar]);

  const acao = async (id: string, qual: 'publicar' | 'encerrar' | 'cancelar') => {
    if (qual !== 'publicar' && !window.confirm(qual === 'encerrar' ? 'Encerrar esta promoção agora?' : 'Cancelar esta promoção?')) return;
    try { await api.post(`/clientes/clube/promocoes/${id}/${qual}`, {}); setMsg({ tom: 'ok', texto: { publicar: 'Promoção publicada.', encerrar: 'Promoção encerrada.', cancelar: 'Promoção cancelada.' }[qual] }); void carregar(); }
    catch (e) { setMsg({ tom: 'erro', texto: erroDe(e) }); }
  };

  return (
    <div className="space-y-3">
      {msg && <div role={msg.tom === 'erro' ? 'alert' : 'status'} className={`border border-dashed rounded-[12px] px-4 py-3 text-[12.5px] ${msg.tom === 'erro' ? 'border-[rgba(var(--nx-red-rgb),0.4)] text-[var(--nx-red)]' : 'border-[rgba(var(--nx-green-rgb),0.4)] text-[var(--nx-green)]'}`}>{msg.texto}</div>}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[12px] text-[var(--nexus-muted)] flex-1 min-w-[260px]">Toda promoção nasce de um produto do cadastro. O preço “de” é o preço atual do produto. No app do cliente ela aparece já; no caixa, passa a valer na etapa do PDV, com a mesma regra de preço.</p>
        {podeMarketing ? <button type="button" className={s.btn} onClick={() => setAberto(true)}>+ Nova promoção</button> : <span className="text-[12px] text-[var(--nexus-muted)]">Criar exige clientes.editar e produtos.editar.</span>}
      </div>
      <div className={`${s.card} !p-0 overflow-x-auto`}>
        <table className="w-full min-w-[760px]">
          <thead><tr><th className={s.th}>Produto</th><th className={s.th}>Tipo</th><th className={s.th}>Preço</th><th className={s.th}>Validade</th><th className={s.th}>Situação</th><th className={s.th} /></tr></thead>
          <tbody>
            {lista == null && <tr><td className={s.td} colSpan={6}>Carregando…</td></tr>}
            {lista?.length === 0 && <tr><td className={s.td} colSpan={6}>Nenhuma promoção ainda.</td></tr>}
            {lista?.map((p) => (
              <tr key={p.id}>
                <td className={s.td}><strong>{p.titulo || p.produto.nome}</strong>{p.titulo && <span className="block text-[11.5px] text-[var(--nexus-muted)]">{p.produto.nome}</span>}{!p.todasFiliais && <span className="block text-[11.5px] text-[var(--nexus-muted)]">Só em: {p.filiais.map((f) => f.nome).join(', ')}</span>}</td>
                <td className={s.td}>{p.tipo === 'MEMBROS' ? '★ Só membros' : 'Todos'}</td>
                <td className={`${s.td} whitespace-nowrap`}>{formatBRL(p.de)} → <strong>{formatBRL(p.por)}</strong> <span className="text-[11px] text-[var(--nexus-muted)]">(-{p.desconto.toLocaleString('pt-BR')}%)</span></td>
                <td className={`${s.td} whitespace-nowrap`}>{new Date(p.inicio).toLocaleDateString('pt-BR')} até {new Date(p.fim).toLocaleDateString('pt-BR')}</td>
                <td className={s.td}><span className={`text-[11px] font-semibold border rounded-full px-2 py-0.5 ${SIT[p.situacao].cor}`}>{SIT[p.situacao].texto}</span></td>
                <td className={`${s.td} text-right whitespace-nowrap`}>
                  {podeMarketing && p.situacao === 'RASCUNHO' && <button type="button" className={s.btn2} onClick={() => acao(p.id, 'publicar')}>Publicar</button>}
                  {podeMarketing && p.situacao === 'ATIVA' && <button type="button" className={s.btn2} onClick={() => acao(p.id, 'encerrar')}>Encerrar</button>}
                  {podeMarketing && (p.situacao === 'RASCUNHO' || p.situacao === 'AGENDADA') && <button type="button" className={`${s.btn2} ml-2`} onClick={() => acao(p.id, 'cancelar')}>Cancelar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {aberto && <NovaPromocao fechar={() => setAberto(false)} salvo={(t) => { setAberto(false); setMsg({ tom: 'ok', texto: t }); void carregar(); }} pode={pode} />}
    </div>
  );
}

function NovaPromocao({ fechar, salvo, pode }: { fechar: () => void; salvo: (t: string) => void; pode: (m: string, a: string) => boolean }) {
  const agora = new Date();
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<Produto[]>([]);
  const [produto, setProduto] = useState<Produto | null>(null);
  const [filiais, setFiliais] = useState<Array<{ id: string; nome: string }>>([]);
  const [f, setF] = useState({ tipo: 'MEMBROS' as 'TODOS' | 'MEMBROS', preco: '', inicio: paraLocal(agora), fim: paraLocal(new Date(agora.getTime() + 7 * 864e5)), filialIds: [] as string[], limite: '', titulo: '', descricao: '' });
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { api.get<{ filiais: Array<{ id: string; nome: string; status: string }> }>('/produtos/catalogos').then((r) => setFiliais(r.data.filiais.filter((x) => x.status === 'ATIVO'))).catch(() => setFiliais([])); }, []);
  useEffect(() => {
    if (produto || busca.trim().length < 2) { setAchados([]); return; }
    const t = setTimeout(() => api.get<Produto[]>(`/clientes/clube/promocoes/produtos?busca=${encodeURIComponent(busca.trim())}`).then((r) => setAchados(r.data)).catch(() => setAchados([])), 250);
    return () => clearTimeout(t);
  }, [busca, produto]);

  const por = Number(f.preco.replace(',', '.'));
  const conta = useMemo(() => {
    if (!produto || !(por > 0)) return null;
    const desconto = Math.round(((produto.precoVenda - por) / produto.precoVenda) * 1000) / 10;
    const margem = (pv: number) => (produto.custo != null && pv > 0 ? Math.round(((pv - produto.custo) / pv) * 1000) / 10 : null);
    return { desconto, margem: margem(por), margemAntes: margem(produto.precoVenda), abaixoCusto: produto.custo != null && por < produto.custo, naoBaixa: por >= produto.precoVenda };
  }, [produto, por]);
  const alcada = conta ? (conta.desconto <= 10 ? 'operador' : conta.desconto <= 30 ? 'supervisor' : 'gerente') : null;
  const temAlcada = alcada === 'operador' || (alcada === 'supervisor' && (pode('vendas', 'editar') || pode('vendas', 'desconto_supervisor') || pode('vendas', 'desconto_gerente'))) || (alcada === 'gerente' && (pode('vendas', 'desconto_gerente') || pode('vendas', 'gerente') || pode('vendas', 'desconto')));

  const salvar = async (publicar: boolean, e?: FormEvent) => {
    e?.preventDefault(); setErro('');
    if (!produto) { setErro('Escolha o produto.'); return; }
    setEnviando(true);
    try {
      await api.post('/clientes/clube/promocoes', {
        produtoId: produto.id, tipo: f.tipo, precoPromocional: por, inicio: new Date(f.inicio).toISOString(), fim: new Date(f.fim).toISOString(),
        filialIds: f.filialIds, limitePorCliente: f.limite ? Number(f.limite) : null, titulo: f.titulo.trim() || null, descricao: f.descricao.trim() || null, publicar,
      });
      salvo(publicar ? 'Promoção publicada.' : 'Promoção salva como rascunho.');
    } catch (err) { setErro(erroDe(err)); } finally { setEnviando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Nova promoção" onClick={fechar}>
      <form onSubmit={(e) => salvar(true, e)} onClick={(e) => e.stopPropagation()} className="w-full max-w-[460px] h-full overflow-y-auto bg-[var(--nexus-panel)] border-l border-[var(--nexus-border)] p-5 space-y-4">
        <div><p className="text-[18px] font-bold text-[var(--nexus-text)]">Nova promoção</p><p className="text-[12px] text-[var(--nexus-muted)]">Toda promoção nasce de um produto do cadastro. O preço “de” é o real de hoje.</p></div>
        {erro && <div role="alert" className="border border-dashed rounded-[12px] px-3 py-2 text-[12.5px] border-[rgba(var(--nx-red-rgb),0.4)] text-[var(--nx-red)]">{erro}</div>}
        <label className="block"><span className={s.rotulo}>Produto *</span>
          {produto ? (
            <div className="mt-1 flex items-center gap-3 border border-[var(--nexus-border)] rounded-[10px] p-2.5">
              {produto.foto ? <img src={produto.foto} alt="" className="w-10 h-10 rounded object-contain bg-[var(--nexus-panel-2)]" /> : null}
              <div className="flex-1 text-[12.5px] text-[var(--nexus-text)]"><strong>{produto.nome}</strong><span className="block text-[var(--nexus-muted)]">Preço atual: {formatBRL(produto.precoVenda)}{produto.custo != null ? ` · Custo: ${formatBRL(produto.custo)}` : ''} · Estoque: {produto.estoque.toLocaleString('pt-BR')} {produto.unidade}</span></div>
              <button type="button" className={s.btn2} onClick={() => { setProduto(null); setBusca(''); }}>Trocar</button>
            </div>
          ) : (
            <>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} className={`${s.input} mt-1`} placeholder="🔍 Buscar por nome, SKU ou código de barras" />
              {achados.length > 0 && <div className="mt-1 border border-[var(--nexus-border)] rounded-[10px] max-h-[220px] overflow-y-auto">{achados.map((p) => (
                <button key={p.id} type="button" onClick={() => setProduto(p)} className="w-full text-left px-3 py-2 text-[12.5px] text-[var(--nexus-text)] hover:bg-[var(--nexus-panel-2)] border-b border-[var(--nexus-border)] last:border-0">{p.nome} <span className="text-[var(--nexus-muted)]">· {formatBRL(p.precoVenda)}</span></button>
              ))}</div>}
            </>
          )}
        </label>
        <div><span className={s.rotulo}>Quem pode usar *</span>
          <div className="grid grid-cols-2 gap-2 mt-1">{(['TODOS', 'MEMBROS'] as const).map((tp) => (
            <button key={tp} type="button" onClick={() => setF({ ...f, tipo: tp })} aria-pressed={f.tipo === tp} className={`h-[40px] rounded-[10px] border text-[12.5px] font-semibold ${f.tipo === tp ? 'border-[var(--nexus-accent)] text-[var(--nexus-accent)] bg-[var(--nexus-panel-2)]' : 'border-[var(--nexus-border)] text-[var(--nexus-text)]'}`}>{tp === 'TODOS' ? 'Todos os clientes' : '★ Só membros do clube'}</button>
          ))}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={s.rotulo}>Preço promocional *</span><input value={f.preco} onChange={(e) => setF({ ...f, preco: e.target.value })} inputMode="decimal" className={`${s.input} mt-1`} placeholder="R$ 0,00" /></label>
          <label className="block"><span className={s.rotulo}>Limite por compra</span><input value={f.limite} onChange={(e) => setF({ ...f, limite: e.target.value.replace(/\D/g, '') })} inputMode="numeric" className={`${s.input} mt-1`} placeholder="Sem limite" /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={s.rotulo}>Início *</span><input type="datetime-local" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} className={`${s.input} mt-1`} /></label>
          <label className="block"><span className={s.rotulo}>Fim *</span><input type="datetime-local" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} className={`${s.input} mt-1`} /></label>
        </div>
        <div><span className={s.rotulo}>Filiais</span>
          <div className="mt-1 flex flex-wrap gap-2">
            <button type="button" onClick={() => setF({ ...f, filialIds: [] })} aria-pressed={f.filialIds.length === 0} className={`${s.btn2} ${f.filialIds.length === 0 ? '!border-[var(--nexus-accent)]' : ''}`}>Todas</button>
            {filiais.map((fl) => { const on = f.filialIds.includes(fl.id); return <button key={fl.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, filialIds: on ? f.filialIds.filter((x) => x !== fl.id) : [...f.filialIds, fl.id] })} className={`${s.btn2} ${on ? '!border-[var(--nexus-accent)]' : ''}`}>{fl.nome}</button>; })}
          </div>
        </div>
        <label className="block"><span className={s.rotulo}>Título (opcional)</span><input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} maxLength={80} className={`${s.input} mt-1`} placeholder="Ex.: Café do clube" /></label>
        {conta && (
          <div className="rounded-[12px] bg-[var(--nexus-panel-2)] border border-[var(--nexus-border)] p-3 text-[12.5px] text-[var(--nexus-text)]">
            Desconto: <strong>{conta.desconto.toLocaleString('pt-BR')}%</strong>{conta.margem != null ? <> · Margem na promoção: <strong>{conta.margem.toLocaleString('pt-BR')}%</strong> (antes {conta.margemAntes?.toLocaleString('pt-BR')}%)</> : null}
            {f.limite && <span className="block">Limite por cliente: <strong>{f.limite} por compra</strong></span>}
          </div>
        )}
        {conta?.naoBaixa && <p className="text-[12px] text-[var(--nx-red)]">O preço promocional precisa ser menor que o preço atual.</p>}
        {conta?.abaixoCusto && <p className="text-[12px] text-[var(--nx-red)]">Abaixo do custo: bloqueado.</p>}
        {conta && !conta.naoBaixa && alcada !== 'operador' && (
          <div className="rounded-[12px] border border-amber-400/40 bg-amber-400/10 p-3 text-[12px] text-amber-300">⚠ Desconto acima de {alcada === 'supervisor' ? '10' : '30'}% precisa de quem tem alçada de {alcada} (mesma regra de desconto do PDV).{temAlcada ? ' Você tem essa alçada.' : ' Você não tem: salve como rascunho para alguém com a alçada publicar.'}</div>
        )}
        <div className="flex gap-2 pt-2 sticky bottom-0 bg-[var(--nexus-panel)] pb-1">
          <button type="button" className={`${s.btn2} flex-1`} onClick={fechar}>Cancelar</button>
          <button type="button" className={`${s.btn2} flex-1`} disabled={enviando || !produto || !(por > 0)} onClick={() => salvar(false)}>Salvar rascunho</button>
          <button type="submit" className={`${s.btn} flex-1`} disabled={enviando || !produto || !(por > 0) || !!conta?.abaixoCusto || !!conta?.naoBaixa || !temAlcada}>Publicar</button>
        </div>
      </form>
    </div>
  );
}
