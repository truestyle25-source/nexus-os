'use client';

/**
 * As 9 abas do /fluxo. Cada aba busca o próprio dado em `/fluxo/*`; nenhuma
 * mostra número que o servidor não devolveu. Ações (conferir, decidir,
 * importar, conciliar) são validadas de novo no servidor.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, FileText, Info, Upload } from 'lucide-react';
import api from '@/lib/api';
import { Badge, DataTable, EmptyState, Panel, SectionTitle, type BadgeTone, type DataColumn } from '@/components/ui';
import { formatBRL, formatDate, formatDateTime } from '@/lib/format';
import FluxoFinanceiro from './FluxoFinanceiro';

/* ─────────────────────────── tipos e utilitários ─────────────────────────── */

export type PeriodoDias = 7 | 30 | 90;
export const PERIODOS: Array<{ dias: PeriodoDias; label: string }> = [
  { dias: 7, label: '7 dias' }, { dias: 30, label: '30 dias' }, { dias: 90, label: '90 dias' },
];
type Params = { inicio: string; fim: string };

export type CaixaLinha = {
  id: string; numero: number | null; filial: string | null; operador: string | null; status: string;
  abertoEm: string; fechadoEm: string | null; totalVendas: number; dinheiroEsperado: number;
  valorContado: number | null; diferenca: number | null; conferido: boolean; pendencias: number;
};

const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'Pix', CARTAO_CREDITO: 'Cartão de crédito', CARTAO_DEBITO: 'Cartão de débito',
  BOLETO: 'Boleto', TRANSFERENCIA: 'Transferência', OUTRO: 'Outro',
};
const STATUS_CAIXA: Record<string, [string, BadgeTone]> = {
  ABERTO: ['Aberto', 'emerald'], FECHADO: ['Fechado', 'neutral'], BLOQUEADO: ['Bloqueado', 'red'],
  EM_FECHAMENTO: ['Em fechamento', 'amber'], DIVERGENCIA: ['Divergência', 'amber'],
};
const STATUS_APROV: Record<string, [string, BadgeTone]> = {
  PENDENTE: ['Pendente', 'amber'], AUTORIZADA: ['Autorizada', 'emerald'], APROVADA: ['Aprovada', 'emerald'], REJEITADA: ['Rejeitada', 'red'],
};
const TIPO_MOV: Record<string, string> = {
  ABERTURA: 'Abertura', SANGRIA: 'Sangria', SUPRIMENTO: 'Suprimento', VENDA: 'Venda', ESTORNO: 'Estorno',
  DEVOLUCAO: 'Devolução', AJUSTE: 'Ajuste', FECHAMENTO: 'Fechamento',
};

const nomeCaixa = (c: { numero: number | null; filial?: string | null }) => `Caixa ${c.numero ?? '—'}${c.filial ? ` · ${c.filial}` : ''}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Não foi possível concluir.');

function Diferenca({ valor }: { valor: number | null | undefined }) {
  if (valor == null) return <span className="text-white/30">—</span>;
  if (valor === 0) return <span className="text-emerald-300">{formatBRL(0)}</span>;
  return <span className={valor > 0 ? 'text-amber-300' : 'text-red-300'}>{valor > 0 ? 'Sobra ' : 'Falta '}{formatBRL(Math.abs(valor))}</span>;
}

export function Aviso({ tom = 'info', children }: { tom?: 'info' | 'erro' | 'ok'; children: ReactNode }) {
  const cls = tom === 'erro' ? 'border-red-500/25 bg-red-500/10 text-red-200' : tom === 'ok' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : 'border-white/[0.08] bg-white/[0.03] text-white/60';
  const Icone = tom === 'erro' ? CircleAlert : Info;
  return (
    <div className={`mb-4 flex items-start gap-2.5 rounded-[12px] border px-4 py-3 text-[12.5px] ${cls}`}>
      <Icone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

const btn = 'h-8 rounded-[10px] border border-white/[0.08] bg-[#1A1A2E] px-3 text-[12.5px] text-white/70 transition hover:text-white disabled:opacity-40';
const btnPrimario = 'h-8 rounded-[10px] border border-white bg-white px-4 text-[12.5px] font-medium text-black transition hover:bg-white/90 disabled:opacity-40';
const campo = 'h-9 w-full rounded-[10px] border border-white/[0.08] bg-[#121221] px-3 text-[13px] text-white placeholder:text-white/30 focus:border-[var(--nx-accent)] focus:outline-none';
const rotulo = 'mb-1 block text-[11px] uppercase tracking-[0.12em] text-white/40';

/** Busca simples com estado de carga/erro, recarregável. */
function useDados<T>(url: string | null, params?: Record<string, string>) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const chave = JSON.stringify(params ?? {});
  const recarregar = useCallback(async () => {
    if (!url) { setDados(null); return; }
    setCarregando(true); setErro(null);
    try { setDados((await api.get<T>(url, { params: JSON.parse(chave) })).data); }
    catch (e) { setDados(null); setErro(msg(e)); }
    finally { setCarregando(false); }
  }, [url, chave]);
  useEffect(() => { void recarregar(); }, [recarregar]);
  return { dados, erro, carregando, recarregar };
}

function SeletorCaixa({ caixas, caixaId, onCaixa, filtro }: { caixas: CaixaLinha[]; caixaId: string; onCaixa: (id: string) => void; filtro?: (c: CaixaLinha) => boolean }) {
  const lista = filtro ? caixas.filter(filtro) : caixas;
  return (
    <select value={caixaId} onChange={(e) => onCaixa(e.target.value)} className={`${campo} max-w-[360px]`} aria-label="Escolher caixa">
      <option value="">Escolha um caixa…</option>
      {lista.map((c) => <option key={c.id} value={c.id}>{nomeCaixa(c)} — {c.operador ?? 'sem operador'} — {formatDate(c.abertoEm)}</option>)}
    </select>
  );
}

/* ─────────────────────────────── 1. Visão geral ─────────────────────────────── */

export function AbaVisaoGeral({ caixas, carregado, onAbrir, comFinanceiro }: { caixas: CaixaLinha[]; carregado: boolean; onAbrir: (id: string) => void; comFinanceiro: boolean }) {
  const colunas: DataColumn<CaixaLinha>[] = [
    { key: 'caixa', label: 'Caixa', render: (c) => <span className="font-medium text-white">Caixa {c.numero ?? '—'}</span> },
    { key: 'filial', label: 'Filial', render: (c) => c.filial ?? '—' },
    { key: 'operador', label: 'Operador', render: (c) => c.operador ?? '—' },
    { key: 'status', label: 'Status', render: (c) => { const [t, tom] = STATUS_CAIXA[c.status] ?? [c.status, 'neutral']; return <Badge tone={tom} dot>{t}</Badge>; } },
    { key: 'abertura', label: 'Abertura', render: (c) => formatDateTime(c.abertoEm) },
    { key: 'fechamento', label: 'Fechamento', render: (c) => (c.fechadoEm ? formatDateTime(c.fechadoEm) : '—') },
    { key: 'vendido', label: 'Vendido', align: 'right', render: (c) => formatBRL(c.totalVendas) },
    { key: 'dif', label: 'Diferença', align: 'right', render: (c) => <Diferenca valor={c.diferenca} /> },
    { key: 'pend', label: 'Pendências', align: 'center', render: (c) => (c.pendencias ? <Badge tone="amber">{c.pendencias}</Badge> : c.conferido ? <Badge tone="emerald">Conferido</Badge> : <span className="text-white/30">—</span>) },
  ];
  return (
    <>
      <Panel>
        <SectionTitle kicker="Monitoramento" right={<span className="text-[12px] text-white/40">Clique num caixa para ver os detalhes</span>}>Caixas do período</SectionTitle>
        <DataTable className="mt-4" columns={colunas} rows={caixas} keyOf={(c) => c.id} onRowClick={(c) => onAbrir(c.id)}
          empty={carregado ? <EmptyState title="Nenhum caixa no período" description="Os caixas aparecem aqui quando são abertos no PDV." /> : <p className="mt-4 text-[13px] text-white/40">Carregando…</p>} />
      </Panel>
      {comFinanceiro && <FluxoFinanceiro embutido />}
    </>
  );
}

/* ─────────────────────────────── 2. Caixa ─────────────────────────────── */

type Detalhe = {
  caixa: { id: string; numero: number | null; filial: string | null; operador: string | null; status: string; abertoEm: string; fechadoEm: string | null; fundoTroco: number; valorContado: number | null; diferenca: number | null };
  ocultarEsperado: boolean;
  resumo: null | { totalVendas: number; qtdVendas: number; dinheiroVendas: number; sangrias: number; suprimentos: number; estornos: number; dinheiroEsperado: number; porForma: Record<string, number> };
  esperadoPorForma: Record<string, number> | null;
  movimentacoes: Array<{ id: string; tipo: string; valor: number; motivo: string | null; origem: string; usuario: string | null; createdAt: string }>;
  vendas: Array<{ id: string; total: number; status: string; createdAt: string; formas: Array<{ forma: string; valor: number }> }>;
  conferencias: Array<{ id: string; cega: boolean; responsavel: string | null; createdAt: string; justificativa: string | null; totalEsperado: number; totalContado: number; diferenca: number; itens: Array<{ forma: string; esperado: number; contado: number; diferenca: number }> }>;
  turnos: Array<{ id: string; operador: string | null; entradaEm: string; saidaEm: string | null; diferenca: number | null }>;
  aprovacoes: Array<{ id: string; descricao: string; status: string; nivelExigido: string; valor: number }>;
};

function Numero({ titulo, valor, destaque }: { titulo: string; valor: ReactNode; destaque?: boolean }) {
  return (
    <div className="rounded-[12px] border border-white/[0.05] bg-[#121221] p-3">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-white/40">{titulo}</div>
      <div className={`mt-1 text-[17px] font-semibold ${destaque ? 'text-[var(--nx-accent-ink)]' : 'text-white'}`}>{valor}</div>
    </div>
  );
}

export function AbaCaixa({ caixas, caixaId, onCaixa }: { caixas: CaixaLinha[]; caixaId: string; onCaixa: (id: string) => void }) {
  const { dados: d, erro, carregando } = useDados<Detalhe>(caixaId ? `/fluxo/caixas/${caixaId}` : null);
  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle kicker="Consulta individual" right={<SeletorCaixa caixas={caixas} caixaId={caixaId} onCaixa={onCaixa} />}>
          {d ? nomeCaixa(d.caixa) : 'Escolha um caixa'}
        </SectionTitle>
        {erro && <div className="mt-4"><Aviso tom="erro">{erro}</Aviso></div>}
        {carregando && <p className="mt-4 text-[13px] text-white/40">Carregando…</p>}
        {d && (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Numero titulo="Operador" valor={d.caixa.operador ?? '—'} />
            <Numero titulo="Abertura" valor={formatDateTime(d.caixa.abertoEm)} />
            <Numero titulo="Fechamento" valor={d.caixa.fechadoEm ? formatDateTime(d.caixa.fechadoEm) : 'Aberto'} />
            <Numero titulo="Fundo de troco" valor={formatBRL(d.caixa.fundoTroco)} />
            <Numero titulo="Dinheiro esperado" valor={d.resumo ? formatBRL(d.resumo.dinheiroEsperado) : 'Oculto até a conferência'} destaque />
            <Numero titulo="Diferença no fechamento" valor={<Diferenca valor={d.caixa.diferenca} />} />
          </div>
        )}
        {d?.resumo && (
          <p className="mt-3 text-[12px] text-white/40">
            Dinheiro esperado = fundo {formatBRL(d.caixa.fundoTroco)} + vendas em dinheiro {formatBRL(d.resumo.dinheiroVendas)} − sangrias {formatBRL(d.resumo.sangrias)} + suprimentos {formatBRL(d.resumo.suprimentos)} − estornos {formatBRL(d.resumo.estornos)}.
          </p>
        )}
      </Panel>
      {d && (
        <>
          <Panel>
            <SectionTitle kicker="Somente leitura">Movimentações da sessão</SectionTitle>
            <DataTable className="mt-3" rows={d.movimentacoes} keyOf={(m) => m.id} empty={<p className="mt-3 text-[13px] text-white/40">Sem movimentações.</p>} columns={[
              { key: 'h', label: 'Data/hora', render: (m) => formatDateTime(m.createdAt) },
              { key: 't', label: 'Tipo', render: (m) => `${TIPO_MOV[m.tipo] ?? m.tipo}${m.origem === 'AUTOMATICO' ? ' (automático)' : ''}` },
              { key: 'm', label: 'Motivo', render: (m) => m.motivo ?? '—' },
              { key: 'u', label: 'Usuário', render: (m) => m.usuario ?? '—' },
              { key: 'v', label: 'Valor', align: 'right', render: (m) => formatBRL(m.valor) },
            ]} />
          </Panel>
          <Panel>
            <SectionTitle kicker={`${d.vendas.length} vendas`}>Vendas da sessão</SectionTitle>
            <DataTable className="mt-3" rows={d.vendas} keyOf={(v) => v.id} empty={<p className="mt-3 text-[13px] text-white/40">Sem vendas.</p>} columns={[
              { key: 'h', label: 'Data/hora', render: (v) => formatDateTime(v.createdAt) },
              { key: 'f', label: 'Pagamento', render: (v) => v.formas.map((f) => `${FORMA[f.forma] ?? f.forma} ${formatBRL(f.valor)}`).join(' + ') },
              { key: 's', label: 'Status', render: (v) => <Badge tone={v.status === 'FINALIZADA' ? 'emerald' : v.status === 'CANCELADA' ? 'red' : 'neutral'}>{v.status === 'CANCELADA' ? 'Cancelada (não conta)' : v.status}</Badge> },
              { key: 't', label: 'Total', align: 'right', render: (v) => formatBRL(v.total) },
            ]} />
          </Panel>
          <Panel>
            <SectionTitle>Sessões de turno, conferências e aprovações</SectionTitle>
            <div className="mt-3 grid gap-3 lg:grid-cols-3 text-[13px] text-white/70">
              <ListaSimples titulo="Turnos" vazio="Sem turnos registrados." itens={d.turnos.map((t) => `${t.operador ?? '—'}: ${formatDateTime(t.entradaEm)} → ${t.saidaEm ? formatDateTime(t.saidaEm) : 'ativo'}`)} />
              <ListaSimples titulo="Conferências" vazio="Ainda não conferido." itens={d.conferencias.map((c) => `${c.responsavel ?? '—'} em ${formatDateTime(c.createdAt)}${c.cega ? ' (cega)' : ''}: diferença ${formatBRL(c.diferenca)}`)} />
              <ListaSimples titulo="Aprovações" vazio="Nenhuma solicitação." itens={d.aprovacoes.map((a) => `${STATUS_APROV[a.status]?.[0] ?? a.status} — ${a.descricao}`)} />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function ListaSimples({ titulo, itens, vazio }: { titulo: string; itens: string[]; vazio: string }) {
  return (
    <div className="rounded-[12px] border border-white/[0.05] bg-[#121221] p-3">
      <div className="mb-2 text-[10.5px] uppercase tracking-[0.12em] text-white/40">{titulo}</div>
      {itens.length ? <ul className="space-y-1.5">{itens.map((i, n) => <li key={n}>{i}</li>)}</ul> : <p className="text-white/30">{vazio}</p>}
    </div>
  );
}

/* ─────────────────────────────── 3. Conferência ─────────────────────────────── */

type Resultado = { itens: Array<{ forma: string; esperado: number; contado: number; diferenca: number }>; diferenca: number; aprovacao: null | { nivelExigido: string } };

export function AbaConferencia({ caixas, caixaId, onCaixa, onMudou }: { caixas: CaixaLinha[]; caixaId: string; onCaixa: (id: string) => void; onMudou: () => void }) {
  const { dados: d, erro, recarregar } = useDados<Detalhe>(caixaId ? `/fluxo/caixas/${caixaId}` : null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [justificativa, setJustificativa] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { setValores({}); setResultado(null); setFalha(null); setJustificativa(''); }, [caixaId]);

  // Cego: o operador informa todas as formas; com o esperado visível, as que têm valor.
  const formas = d?.esperadoPorForma ? Array.from(new Set(['DINHEIRO', ...Object.keys(d.esperadoPorForma)])) : ['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO'];

  async function enviar() {
    setFalha(null);
    const itens = formas.map((forma) => ({ forma, valor: Number((valores[forma] ?? '').replace(',', '.')) }));
    if (itens.some((i) => !Number.isFinite(i.valor) || i.valor < 0 || (valores[i.forma] ?? '').trim() === '')) { setFalha('Preencha o valor contado de cada forma (use 0 quando não houver).'); return; }
    setEnviando(true);
    try {
      const { data } = await api.post<Resultado>(`/fluxo/caixas/${caixaId}/conferencias`, { itens, justificativa: justificativa.trim() || undefined });
      setResultado(data); void recarregar(); onMudou();
    } catch (e) { setFalha(msg(e)); } finally { setEnviando(false); }
  }

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle kicker="Esperado × contado" right={<SeletorCaixa caixas={caixas} caixaId={caixaId} onCaixa={onCaixa} filtro={(c) => c.status !== 'ABERTO'} />}>Conferência e fechamento cego</SectionTitle>
        <p className="mt-2 text-[12.5px] text-white/40">Dinheiro, Pix e cartões são conferidos separados. A conferência nunca altera vendas nem movimentações; qualquer diferença vira uma solicitação na aba Aprovações.</p>
        {erro && <div className="mt-4"><Aviso tom="erro">{erro}</Aviso></div>}
        {d && !resultado && (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-3">
              {d.ocultarEsperado && <Aviso>Fechamento cego: o valor esperado fica oculto até você registrar a contagem.</Aviso>}
              {formas.map((f) => (
                <label key={f} className="block">
                  <span className={rotulo}>{FORMA[f] ?? f} contado (R$)</span>
                  <input inputMode="decimal" className={campo} placeholder="0,00" value={valores[f] ?? ''} onChange={(e) => setValores((v) => ({ ...v, [f]: e.target.value }))} />
                </label>
              ))}
              <label className="block">
                <span className={rotulo}>Observação ou justificativa</span>
                <input className={campo} maxLength={500} placeholder="Opcional" value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
              </label>
              {falha && <Aviso tom="erro">{falha}</Aviso>}
              <button type="button" className={btnPrimario} disabled={enviando} onClick={enviar}>{enviando ? 'Registrando…' : 'Registrar contagem'}</button>
            </div>
            {d.esperadoPorForma && (
              <div className="rounded-[12px] border border-white/[0.05] bg-[#121221] p-4 text-[13px]">
                <div className={rotulo}>Esperado pelo sistema</div>
                {Object.entries(d.esperadoPorForma).map(([f, v]) => <div key={f} className="flex justify-between border-t border-white/[0.05] py-2 text-white/70"><span>{FORMA[f] ?? f}</span><span>{formatBRL(v)}</span></div>)}
              </div>
            )}
          </div>
        )}
        {resultado && (
          <div className="mt-4">
            <Aviso tom={resultado.aprovacao ? 'info' : 'ok'}>
              {resultado.aprovacao ? `Contagem registrada com diferença. Solicitação enviada para aprovação (nível ${resultado.aprovacao.nivelExigido === 'GESTOR' ? 'Gestor' : 'Supervisor'}).` : 'Contagem registrada: tudo confere.'}
            </Aviso>
            <TabelaItens itens={resultado.itens} />
          </div>
        )}
      </Panel>
      {d && d.conferencias.length > 0 && (
        <Panel>
          <SectionTitle kicker="Histórico imutável">Conferências registradas</SectionTitle>
          {d.conferencias.map((c) => (
            <div key={c.id} className="mt-4">
              <div className="mb-1 text-[12.5px] text-white/60">{c.responsavel ?? '—'} · {formatDateTime(c.createdAt)} {c.cega && <Badge tone="accent">Cega</Badge>} {c.justificativa && <span className="text-white/40">— {c.justificativa}</span>}</div>
              <TabelaItens itens={c.itens} />
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}

function TabelaItens({ itens }: { itens: Resultado['itens'] }) {
  return (
    <DataTable rows={itens} keyOf={(i) => i.forma} columns={[
      { key: 'f', label: 'Forma', render: (i) => FORMA[i.forma] ?? i.forma },
      { key: 'e', label: 'Esperado', align: 'right', render: (i) => formatBRL(i.esperado) },
      { key: 'c', label: 'Contado', align: 'right', render: (i) => formatBRL(i.contado) },
      { key: 'd', label: 'Sobra / falta', align: 'right', render: (i) => <Diferenca valor={i.diferenca} /> },
    ]} />
  );
}

/* ─────────────────────────────── 4. Documentos fiscais ─────────────────────────────── */

export function AbaFiscal() {
  const { dados, erro } = useDados<{ disponivel: boolean; motivo: string }>('/fluxo/documentos-fiscais');
  return (
    <Panel>
      <SectionTitle kicker="Integração com o módulo Fiscal">Documentos fiscais das vendas</SectionTitle>
      {erro && <div className="mt-4"><Aviso tom="erro">{erro}</Aviso></div>}
      {dados && !dados.disponivel && (
        <div className="mt-4">
          <EmptyState icon={FileText} title="Emissão fiscal ainda não disponível" description={dados.motivo} />
        </div>
      )}
    </Panel>
  );
}

/* ─────────────────────────────── 5. Histórico ─────────────────────────────── */

type Registro = { id: string; createdAt: string; acao: string; entidade: string; usuario: string | null; origem: string; contexto: string | null };
const ENTIDADE: Record<string, string> = {
  Caixa: 'Caixa', MovimentacaoCaixa: 'Movimentação', Venda: 'Venda', ConferenciaCaixa: 'Conferência', AprovacaoCaixa: 'Aprovação',
  TurnoCaixa: 'Turno', ConciliacaoBancaria: 'Conciliação bancária', ExtratoImportacao: 'Extrato importado', Adquirente: 'Adquirente',
  ContaBancaria: 'Conta bancária', DivergenciaCaixa: 'Divergência',
};

export function AbaHistorico({ caixas, caixaId, onCaixa, params }: { caixas: CaixaLinha[]; caixaId: string; onCaixa: (id: string) => void; params: Params }) {
  const { dados, erro, carregando } = useDados<{ registros: Registro[] }>('/fluxo/historico', { ...params, ...(caixaId ? { caixaId } : {}) });
  return (
    <Panel>
      <SectionTitle kicker="Auditoria avançada" right={<SeletorCaixa caixas={caixas} caixaId={caixaId} onCaixa={onCaixa} />}>Quem fez o quê</SectionTitle>
      <p className="mt-2 text-[12.5px] text-white/40">Registro cronológico de operações, conferências, decisões e ajustes. Nada aqui pode ser editado ou apagado pela tela.</p>
      {erro && <div className="mt-4"><Aviso tom="erro">{erro}</Aviso></div>}
      {carregando && <p className="mt-4 text-[13px] text-white/40">Carregando…</p>}
      {dados && (
        <DataTable className="mt-4" rows={dados.registros} keyOf={(r) => r.id} empty={<EmptyState title="Sem registros no período" />} columns={[
          { key: 'h', label: 'Data/hora', render: (r) => formatDateTime(r.createdAt) },
          { key: 'u', label: 'Usuário', render: (r) => r.usuario ?? 'Sistema' },
          { key: 'e', label: 'Evento', render: (r) => `${ENTIDADE[r.entidade] ?? r.entidade} · ${r.acao.toLowerCase()}` },
          { key: 'c', label: 'Detalhe', render: (r) => <span className="text-white/50">{r.contexto ?? '—'}</span> },
          { key: 'o', label: 'Origem', render: (r) => (r.origem === 'AUTOMATICO' ? 'Automático' : 'Manual') },
        ]} />
      )}
    </Panel>
  );
}

/* ─────────────────────────────── 6. Conciliação bancária ─────────────────────────────── */

type Conta = { id: string; nome: string; banco: string | null; agencia: string | null; numero: string | null };
type TelaConc = {
  totalExtrato: number; totalSistema: number;
  extrato: Array<{ id: string; data: string; descricao: string; valor: number; conciliacao: null | { id: string; tipo: string; justificativa: string | null; aprovacaoStatus: string | null } }>;
  sistema: Array<{ id: string; data: string; descricao: string; valor: number; conciliado: boolean }>;
};

export function AbaBancaria({ params }: { params: Params }) {
  const contas = useDados<{ contas: Conta[] }>('/fluxo/contas-bancarias');
  const [contaId, setContaId] = useState('');
  const tela = useDados<TelaConc>(contaId ? `/fluxo/contas-bancarias/${contaId}/conciliacao` : null, params);
  const [nova, setNova] = useState({ nome: '', banco: '', agencia: '', numero: '' });
  const [aviso, setAviso] = useState<{ tom: 'erro' | 'ok'; texto: string } | null>(null);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [justif, setJustif] = useState<Record<string, string>>({});

  useEffect(() => { if (!contaId && contas.dados?.contas[0]) setContaId(contas.dados.contas[0].id); }, [contas.dados, contaId]);

  async function acao(fn: () => Promise<string>) {
    setAviso(null);
    try { setAviso({ tom: 'ok', texto: await fn() }); await Promise.all([tela.recarregar(), contas.recarregar()]); }
    catch (e) { setAviso({ tom: 'erro', texto: msg(e) }); }
  }
  const criarConta = () => acao(async () => {
    if (nova.nome.trim().length < 2) throw new Error('Informe o nome da conta.');
    const { data } = await api.post<Conta>('/fluxo/contas-bancarias', { nome: nova.nome.trim(), banco: nova.banco.trim() || undefined, agencia: nova.agencia.trim() || undefined, numero: nova.numero.trim() || undefined });
    setNova({ nome: '', banco: '', agencia: '', numero: '' }); setContaId(data.id);
    return 'Conta cadastrada.';
  });
  const importar = (arquivo: File) => acao(async () => {
    if (arquivo.size > 5_000_000) throw new Error('Arquivo maior que 5 MB.');
    const { data } = await api.post<{ linhasNovas: number; linhasRepetidas: number; formato: string }>(`/fluxo/contas-bancarias/${contaId}/extrato`, { arquivoNome: arquivo.name, conteudo: await arquivo.text() });
    return `Extrato ${data.formato} importado: ${data.linhasNovas} lançamentos novos, ${data.linhasRepetidas} já existiam.`;
  });
  const conciliar = (linhaId: string) => acao(async () => {
    const { data } = await api.post<{ aprovacao: unknown }>('/fluxo/conciliacoes', { extratoLinhaId: linhaId, financeiroId: escolha[linhaId] || undefined, justificativa: justif[linhaId]?.trim() || undefined });
    return data.aprovacao ? 'Ajuste registrado e enviado para aprovação. O lançamento original não foi alterado.' : 'Conciliado.';
  });
  const desfazer = (id: string) => acao(async () => {
    const j = window.prompt('Por que desfazer esta conciliação?') ?? '';
    if (j.trim().length < 5) throw new Error('Informe o motivo (mínimo 5 letras).');
    await api.post(`/fluxo/conciliacoes/${id}/desfazer`, { justificativa: j.trim() });
    return 'Conciliação desfeita (o registro continua no histórico).';
  });

  const t = tela.dados;
  const livres = t?.sistema.filter((s) => !s.conciliado) ?? [];
  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle kicker="Sistema × extrato" right={
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${campo} w-[240px]`} value={contaId} onChange={(e) => setContaId(e.target.value)} aria-label="Conta bancária">
              <option value="">Escolha a conta…</option>
              {contas.dados?.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.banco ? ` · ${c.banco}` : ''}</option>)}
            </select>
            {contaId && (
              <label className={`${btn} inline-flex cursor-pointer items-center gap-1.5`}>
                <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Importar OFX/CSV
                <input type="file" accept=".ofx,.csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importar(f); }} />
              </label>
            )}
          </div>
        }>Conciliação bancária</SectionTitle>
        <p className="mt-2 text-[12.5px] text-white/40">Sem integração direta com bancos: importe o extrato em OFX ou CSV (colunas data; descrição; valor). Reimportar o mesmo arquivo não duplica. O lado “sistema” são os lançamentos pagos do Financeiro.</p>
        {aviso && <div className="mt-3"><Aviso tom={aviso.tom}>{aviso.texto}</Aviso></div>}
        {(contas.erro || tela.erro) && <div className="mt-3"><Aviso tom="erro">{contas.erro ?? tela.erro}</Aviso></div>}
        {contas.dados && contas.dados.contas.length === 0 && <p className="mt-3 text-[13px] text-white/50">Cadastre a primeira conta bancária abaixo.</p>}
        <div className="mt-4 grid gap-2 md:grid-cols-5">
          <input className={campo} placeholder="Nome da conta" value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} />
          <input className={campo} placeholder="Banco" value={nova.banco} onChange={(e) => setNova({ ...nova, banco: e.target.value })} />
          <input className={campo} placeholder="Agência" value={nova.agencia} onChange={(e) => setNova({ ...nova, agencia: e.target.value })} />
          <input className={campo} placeholder="Conta" value={nova.numero} onChange={(e) => setNova({ ...nova, numero: e.target.value })} />
          <button type="button" className={btn} onClick={criarConta}>Cadastrar conta</button>
        </div>
      </Panel>
      {t && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Numero titulo="Total no sistema" valor={formatBRL(t.totalSistema)} />
            <Numero titulo="Total no extrato" valor={formatBRL(t.totalExtrato)} />
            <Numero titulo="Diferença" valor={<Diferenca valor={Math.round((t.totalExtrato - t.totalSistema) * 100) / 100} />} />
          </div>
          <Panel>
            <SectionTitle kicker={`${t.extrato.length} lançamentos do extrato`}>Conciliar</SectionTitle>
            <DataTable className="mt-3" rows={t.extrato} keyOf={(l) => l.id} empty={<EmptyState title="Nenhum lançamento de extrato no período" description="Importe um arquivo OFX ou CSV da conta." />} columns={[
              { key: 'd', label: 'Data', render: (l) => formatDate(l.data) },
              { key: 'ds', label: 'Descrição', render: (l) => l.descricao },
              { key: 'v', label: 'Banco', align: 'right', render: (l) => formatBRL(l.valor) },
              { key: 's', label: 'Status / ação', render: (l) => l.conciliacao ? (
                <div className="flex items-center gap-2">
                  <Badge tone={l.conciliacao.tipo === 'VINCULO' ? 'emerald' : l.conciliacao.aprovacaoStatus === 'REJEITADA' ? 'red' : 'amber'}>
                    {l.conciliacao.tipo === 'VINCULO' ? 'Conciliado' : `Ajuste · ${STATUS_APROV[l.conciliacao.aprovacaoStatus ?? 'PENDENTE']?.[0] ?? '—'}`}
                  </Badge>
                  <button type="button" className={btn} onClick={() => desfazer(l.conciliacao!.id)}>Desfazer</button>
                </div>
              ) : (
                <div className="flex min-w-[420px] flex-wrap items-center gap-2">
                  <select className={`${campo} w-[220px]`} value={escolha[l.id] ?? ''} onChange={(e) => setEscolha({ ...escolha, [l.id]: e.target.value })} aria-label="Lançamento do sistema">
                    <option value="">Sem lançamento no sistema</option>
                    {livres.map((s) => <option key={s.id} value={s.id}>{formatDate(s.data)} · {s.descricao} · {formatBRL(s.valor)}</option>)}
                  </select>
                  <input className={`${campo} w-[160px]`} placeholder="Justificativa (se diferir)" value={justif[l.id] ?? ''} onChange={(e) => setJustif({ ...justif, [l.id]: e.target.value })} />
                  <button type="button" className={btn} onClick={() => conciliar(l.id)}>Conciliar</button>
                </div>
              ) },
            ]} />
          </Panel>
          <Panel>
            <SectionTitle kicker={`${livres.length} sem par no extrato`}>Lançamentos do sistema</SectionTitle>
            <DataTable className="mt-3" rows={t.sistema} keyOf={(s) => s.id} empty={<p className="mt-3 text-[13px] text-white/40">Nenhum lançamento pago no período.</p>} columns={[
              { key: 'd', label: 'Data', render: (s) => formatDate(s.data) },
              { key: 'ds', label: 'Descrição', render: (s) => s.descricao },
              { key: 'v', label: 'Sistema', align: 'right', render: (s) => formatBRL(s.valor) },
              { key: 's', label: 'Status', render: (s) => (s.conciliado ? <Badge tone="emerald">Conciliado</Badge> : <Badge tone="amber">Pendente</Badge>) },
            ]} />
          </Panel>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────── 7. Cartões ─────────────────────────────── */

type Adq = { id: string; nome: string; taxaDebito: number; taxaCredito: number; prazoDebitoDias: number; prazoCreditoDias: number; padrao: boolean };
type TelaCartoes = {
  adquirente: Adq | null; avisos: string[];
  totais: { bruto: number; taxas: number; liquido: number; credito: number; debito: number };
  linhas: Array<{ id: string; data: string; forma: string; bruto: number; taxa: number | null; liquido: number | null; previsao: string | null; referencia: string | null }>;
};

export function AbaCartoes({ params }: { params: Params }) {
  const tela = useDados<TelaCartoes>('/fluxo/cartoes', params);
  const adqs = useDados<{ adquirentes: Adq[] }>('/fluxo/adquirentes');
  const [f, setF] = useState({ nome: '', taxaDebito: '', taxaCredito: '', prazoDebitoDias: '1', prazoCreditoDias: '30' });
  const [aviso, setAviso] = useState<{ tom: 'erro' | 'ok'; texto: string } | null>(null);
  async function salvar() {
    setAviso(null);
    const n = (v: string) => Number(v.replace(',', '.'));
    try {
      if (f.nome.trim().length < 2) throw new Error('Informe o nome da adquirente.');
      await api.post('/fluxo/adquirentes', { nome: f.nome.trim(), taxaDebito: n(f.taxaDebito || '0'), taxaCredito: n(f.taxaCredito || '0'), prazoDebitoDias: Math.round(n(f.prazoDebitoDias)), prazoCreditoDias: Math.round(n(f.prazoCreditoDias)), padrao: true });
      setF({ nome: '', taxaDebito: '', taxaCredito: '', prazoDebitoDias: '1', prazoCreditoDias: '30' });
      setAviso({ tom: 'ok', texto: 'Adquirente cadastrada como padrão.' });
      await Promise.all([tela.recarregar(), adqs.recarregar()]);
    } catch (e) { setAviso({ tom: 'erro', texto: msg(e) }); }
  }
  const t = tela.dados;
  return (
    <div className="space-y-4">
      {tela.erro && <Aviso tom="erro">{tela.erro}</Aviso>}
      {t && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Numero titulo="Crédito" valor={formatBRL(t.totais.credito)} />
            <Numero titulo="Débito" valor={formatBRL(t.totais.debito)} />
            <Numero titulo="Bruto" valor={formatBRL(t.totais.bruto)} />
            <Numero titulo="Taxas" valor={t.adquirente ? formatBRL(t.totais.taxas) : '—'} />
            <Numero titulo="Líquido previsto" valor={t.adquirente ? formatBRL(t.totais.liquido) : '—'} destaque />
          </div>
          {t.avisos.map((a) => <Aviso key={a}>{a}</Aviso>)}
          <Panel>
            <SectionTitle kicker={t.adquirente ? `Adquirente padrão: ${t.adquirente.nome}` : 'Sem adquirente padrão'}>Vendas em cartão</SectionTitle>
            <DataTable className="mt-3" rows={t.linhas} keyOf={(l) => l.id} empty={<EmptyState title="Nenhuma venda em cartão no período" description="O PDV só registra cartão quando há um provedor TEF configurado." />} columns={[
              { key: 'd', label: 'Data', render: (l) => formatDateTime(l.data) },
              { key: 'm', label: 'Modalidade', render: (l) => (l.forma === 'CARTAO_DEBITO' ? 'Débito' : 'Crédito à vista') },
              { key: 'b', label: 'Bruto', align: 'right', render: (l) => formatBRL(l.bruto) },
              { key: 't', label: 'Taxa', align: 'right', render: (l) => (l.taxa == null ? '—' : formatBRL(l.taxa)) },
              { key: 'l', label: 'Líquido', align: 'right', render: (l) => (l.liquido == null ? '—' : formatBRL(l.liquido)) },
              { key: 'p', label: 'Previsão', render: (l) => (l.previsao ? formatDate(l.previsao) : '—') },
            ]} />
          </Panel>
        </>
      )}
      <Panel>
        <SectionTitle kicker="Taxas do seu contrato">Adquirentes</SectionTitle>
        {aviso && <div className="mt-3"><Aviso tom={aviso.tom}>{aviso.texto}</Aviso></div>}
        <div className="mt-3 text-[13px] text-white/60">
          {adqs.dados?.adquirentes.length ? adqs.dados.adquirentes.map((a) => (
            <div key={a.id} className="flex flex-wrap justify-between gap-2 border-t border-white/[0.05] py-2">
              <span>{a.nome} {a.padrao && <Badge tone="accent">Padrão</Badge>}</span>
              <span>Débito {a.taxaDebito}% em {a.prazoDebitoDias}d · Crédito {a.taxaCredito}% em {a.prazoCreditoDias}d</span>
            </div>
          )) : <p className="text-white/40">Nenhuma adquirente cadastrada.</p>}
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-6">
          <input className={campo} placeholder="Nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
          <input className={campo} inputMode="decimal" placeholder="Taxa débito %" value={f.taxaDebito} onChange={(e) => setF({ ...f, taxaDebito: e.target.value })} />
          <input className={campo} inputMode="decimal" placeholder="Taxa crédito %" value={f.taxaCredito} onChange={(e) => setF({ ...f, taxaCredito: e.target.value })} />
          <input className={campo} inputMode="numeric" placeholder="Prazo débito (dias)" value={f.prazoDebitoDias} onChange={(e) => setF({ ...f, prazoDebitoDias: e.target.value })} />
          <input className={campo} inputMode="numeric" placeholder="Prazo crédito (dias)" value={f.prazoCreditoDias} onChange={(e) => setF({ ...f, prazoCreditoDias: e.target.value })} />
          <button type="button" className={btn} onClick={salvar}>Salvar como padrão</button>
        </div>
      </Panel>
    </div>
  );
}

/* ─────────────────────────────── 8. Aprovações ─────────────────────────────── */

type Aprov = {
  id: string; tipo: string; descricao: string; valor: number; nivelExigido: string; status: string; solicitante: string | null; solicitanteId: string; createdAt: string;
  decisoes: Array<{ id: string; decisor: string | null; nivel: string; decisao: string; justificativa: string; createdAt: string }>;
};
const TIPO_APROV: Record<string, string> = { DIVERGENCIA_CONFERENCIA: 'Divergência na conferência', DIVERGENCIA_TURNO: 'Divergência na passagem de turno', AJUSTE_CONCILIACAO_BANCARIA: 'Ajuste de conciliação bancária' };

function LimiteGestor({ atual, onSalvo }: { atual: number; onSalvo: () => Promise<void> | void }) {
  const [valor, setValor] = useState(String(atual).replace('.', ','));
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<{ tom: 'erro' | 'ok'; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setValor(String(atual).replace('.', ',')); }, [atual]);
  async function salvar() {
    setAviso(null);
    const n = Number(valor.replace(/./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) { setAviso({ tom: 'erro', texto: 'Informe um valor válido.' }); return; }
    setSalvando(true);
    try {
      const { data } = await api.put<{ limiteGestor: number }>('/fluxo/configuracao/limite-gestor', { valor: n, justificativa: motivo.trim() });
      setMotivo('');
      setAviso({ tom: 'ok', texto: `Limite salvo: acima de ${formatBRL(data.limiteGestor)} exige o gestor.` });
      await onSalvo();
    } catch (e) { setAviso({ tom: 'erro', texto: msg(e) }); } finally { setSalvando(false); }
  }
  return (
    <div className="mt-4 rounded-[12px] border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-white/40">Limite de aprovação · só o gestor vê</div>
      <div className="mt-2 flex flex-wrap items-end gap-2.5">
        <label className="block w-32">
          <span className="mb-1 block text-[12px] text-white/50">Diferença que exige o gestor (acima de R$)</span>
          <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className={campo} aria-label="Limite em reais" />
        </label>
        <label className="block min-w-[200px] flex-1">
          <span className="mb-1 block text-[12px] text-white/50">Motivo da mudança</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: movimento maior no fim de ano" className={campo} />
        </label>
        <button type="button" className={btnPrimario} onClick={() => void salvar()} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar limite'}</button>
      </div>
      <p className="mt-2 text-[12px] text-white/40">Vale para as próximas solicitações. As que já existem não mudam. A troca fica no histórico.</p>
      {aviso && <div className="mt-2"><Aviso tom={aviso.tom}>{aviso.texto}</Aviso></div>}
    </div>
  );
}

export function AbaAprovacoes({ onMudou }: { onMudou: () => void }) {
  const [filtro, setFiltro] = useState<'ABERTAS' | ''>('ABERTAS');
  const { dados, erro, recarregar } = useDados<{ aprovacoes: Aprov[]; meuNivel: string | null; limiteGestor: number }>('/fluxo/aprovacoes', filtro ? { status: filtro } : {});
  const [texto, setTexto] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<{ tom: 'erro' | 'ok'; texto: string } | null>(null);
  async function decidir(a: Aprov, decisao: 'AUTORIZAR' | 'APROVAR' | 'REJEITAR') {
    setAviso(null);
    try {
      const { data } = await api.post<{ status: string }>(`/fluxo/aprovacoes/${a.id}/decidir`, { decisao, justificativa: (texto[a.id] ?? '').trim() });
      setAviso({ tom: 'ok', texto: `Decisão registrada: ${STATUS_APROV[data.status]?.[0] ?? data.status}.` });
      await recarregar(); onMudou();
    } catch (e) { setAviso({ tom: 'erro', texto: msg(e) }); }
  }
  const nivel = dados?.meuNivel;
  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle kicker="Por níveis" right={
          <div className="flex gap-1.5">
            <button type="button" className={filtro === 'ABERTAS' ? btnPrimario : btn} onClick={() => setFiltro('ABERTAS')}>Em aberto</button>
            <button type="button" className={filtro === '' ? btnPrimario : btn} onClick={() => setFiltro('')}>Todas</button>
          </div>
        }>Central de aprovações</SectionTitle>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>Operador: solicita</Badge><Badge>Supervisor: autoriza</Badge><Badge>Gestor: aprova exceções (acima de {formatBRL(dados?.limiteGestor ?? 50)})</Badge>
          {nivel ? <Badge tone="accent">Seu nível: {nivel === 'GESTOR' ? 'Gestor' : 'Supervisor'}</Badge> : <Badge tone="neutral">Você só acompanha</Badge>}
        </div>
        <p className="mt-2 text-[12.5px] text-white/40">Nada é aprovado automaticamente. Quem pediu não decide; cada decisão exige justificativa e fica registrada para sempre.</p>
        {nivel === 'GESTOR' && dados && <LimiteGestor atual={dados.limiteGestor} onSalvo={recarregar} />}
        {aviso && <div className="mt-3"><Aviso tom={aviso.tom}>{aviso.texto}</Aviso></div>}
        {erro && <div className="mt-3"><Aviso tom="erro">{erro}</Aviso></div>}
      </Panel>
      {dados?.aprovacoes.length === 0 && <Panel><EmptyState title="Nenhuma solicitação" description="As divergências de conferência, de turno e os ajustes de conciliação aparecem aqui." /></Panel>}
      {dados?.aprovacoes.map((a) => {
        const [st, tom] = STATUS_APROV[a.status] ?? [a.status, 'neutral' as BadgeTone];
        const aberta = a.status === 'PENDENTE' || (a.status === 'AUTORIZADA' && a.nivelExigido === 'GESTOR');
        const podeAgir = aberta && nivel && !(a.status === 'AUTORIZADA' && nivel !== 'GESTOR');
        return (
          <Panel key={a.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-white/40">{TIPO_APROV[a.tipo] ?? a.tipo} · nível {a.nivelExigido === 'GESTOR' ? 'Gestor' : 'Supervisor'}</div>
                <div className="mt-1 text-[14px] text-white">{a.descricao}</div>
                <div className="mt-1 text-[12px] text-white/40">Solicitado por {a.solicitante ?? '—'} em {formatDateTime(a.createdAt)} · {formatBRL(a.valor)}</div>
              </div>
              <Badge tone={tom} dot>{st}{a.status === 'AUTORIZADA' && a.nivelExigido === 'GESTOR' ? ' · falta o gestor' : ''}</Badge>
            </div>
            {a.decisoes.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-white/[0.05] pt-3 text-[12.5px] text-white/60">
                {a.decisoes.map((d) => <li key={d.id}>{formatDateTime(d.createdAt)} — {d.decisor ?? '—'} ({d.nivel === 'GESTOR' ? 'Gestor' : 'Supervisor'}): {d.decisao.toLowerCase()} — “{d.justificativa}”</li>)}
              </ul>
            )}
            {podeAgir && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.05] pt-3">
                <input className={`${campo} max-w-[420px]`} placeholder="Justificativa da decisão (obrigatória)" value={texto[a.id] ?? ''} onChange={(e) => setTexto({ ...texto, [a.id]: e.target.value })} />
                <button type="button" className={btnPrimario} onClick={() => decidir(a, nivel === 'GESTOR' && a.nivelExigido === 'GESTOR' ? 'APROVAR' : 'AUTORIZAR')}>{nivel === 'GESTOR' && a.nivelExigido === 'GESTOR' ? 'Aprovar' : 'Autorizar'}</button>
                <button type="button" className={btn} onClick={() => decidir(a, 'REJEITAR')}>Rejeitar</button>
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────── 9. Turnos ─────────────────────────────── */

type Turno = { id: string; caixaId: string; caixaNumero: number | null; operador: string | null; recebidoPor: string | null; operadorId: string; entradaEm: string; saidaEm: string | null; valorEsperado: number | null; valorConferido: number | null; diferenca: number | null };

export function AbaTurnos({ caixas, params }: { caixas: CaixaLinha[]; params: Params }) {
  const { dados, erro, recarregar } = useDados<{ turnos: Turno[] }>('/fluxo/turnos', params);
  const ops = useDados<{ usuarios: Array<{ id: string; nome: string }>; eu: string; nivel: string }>('/fluxo/operadores');
  const [caixaNovo, setCaixaNovo] = useState('');
  const [passagem, setPassagem] = useState<Record<string, { valor: string; recebe: string }>>({});
  const [aviso, setAviso] = useState<{ tom: 'erro' | 'ok'; texto: string } | null>(null);
  async function acao(fn: () => Promise<string>) {
    setAviso(null);
    try { setAviso({ tom: 'ok', texto: await fn() }); await recarregar(); } catch (e) { setAviso({ tom: 'erro', texto: msg(e) }); }
  }
  const iniciar = () => acao(async () => {
    if (!caixaNovo) throw new Error('Escolha o caixa.');
    await api.post('/fluxo/turnos', { caixaId: caixaNovo });
    return 'Turno iniciado.';
  });
  const passar = (t: Turno) => acao(async () => {
    const p = passagem[t.id] ?? { valor: '', recebe: '' };
    const valor = Number(p.valor.replace(',', '.'));
    if (p.valor.trim() === '' || !Number.isFinite(valor) || valor < 0) throw new Error('Informe o dinheiro contado na passagem.');
    const { data } = await api.post<{ diferenca: number }>(`/fluxo/turnos/${t.id}/passagem`, { valorConferido: valor, recebidoPorId: p.recebe || undefined });
    return data.diferenca === 0 ? 'Passagem registrada: valores conferem.' : `Passagem registrada com diferença de ${formatBRL(data.diferenca)}. Enviado para aprovação.`;
  });
  const podeAgir = (t: Turno) => !t.saidaEm && (ops.dados?.nivel !== 'OPERADOR' || t.operadorId === ops.dados?.eu);
  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle kicker="Passagem de responsabilidade" right={
          <div className="flex flex-wrap gap-2">
            <SeletorCaixa caixas={caixas} caixaId={caixaNovo} onCaixa={setCaixaNovo} filtro={(c) => c.status === 'ABERTO'} />
            <button type="button" className={btn} onClick={iniciar}>Iniciar turno</button>
          </div>
        }>Turnos</SectionTitle>
        <p className="mt-2 text-[12.5px] text-white/40">Na passagem, quem entrega conta o dinheiro da gaveta; o sistema compara com o esperado naquele momento, abre o turno de quem recebe e manda qualquer diferença para aprovação.</p>
        {aviso && <div className="mt-3"><Aviso tom={aviso.tom}>{aviso.texto}</Aviso></div>}
        {(erro || ops.erro) && <div className="mt-3"><Aviso tom="erro">{erro ?? ops.erro}</Aviso></div>}
        {dados && (
          <DataTable className="mt-4" rows={dados.turnos} keyOf={(t) => t.id} empty={<EmptyState title="Nenhum turno no período" description="Inicie um turno num caixa aberto." />} columns={[
            { key: 'c', label: 'Caixa', render: (t) => `Caixa ${t.caixaNumero ?? '—'}` },
            { key: 'o', label: 'Operador', render: (t) => t.operador ?? '—' },
            { key: 'e', label: 'Entrada', render: (t) => formatDateTime(t.entradaEm) },
            { key: 's', label: 'Saída', render: (t) => (t.saidaEm ? formatDateTime(t.saidaEm) : '—') },
            { key: 'r', label: 'Recebido por', render: (t) => t.recebidoPor ?? '—' },
            { key: 'd', label: 'Divergência', align: 'right', render: (t) => <Diferenca valor={t.diferenca} /> },
            { key: 'st', label: 'Status / ação', render: (t) => !t.saidaEm ? (podeAgir(t) ? (
              <div className="flex min-w-[360px] flex-wrap items-center gap-2">
                <input className={`${campo} w-[110px]`} inputMode="decimal" placeholder="Contado R$" value={passagem[t.id]?.valor ?? ''} onChange={(e) => setPassagem({ ...passagem, [t.id]: { valor: e.target.value, recebe: passagem[t.id]?.recebe ?? '' } })} />
                <select className={`${campo} w-[150px]`} value={passagem[t.id]?.recebe ?? ''} onChange={(e) => setPassagem({ ...passagem, [t.id]: { valor: passagem[t.id]?.valor ?? '', recebe: e.target.value } })} aria-label="Quem recebe">
                  <option value="">Ninguém (encerra)</option>
                  {ops.dados?.usuarios.filter((u) => u.id !== t.operadorId).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
                <button type="button" className={btn} onClick={() => passar(t)}>Passar turno</button>
              </div>
            ) : <Badge tone="emerald" dot>Ativo</Badge>) : <Badge tone={t.diferenca ? 'amber' : 'neutral'}>{t.diferenca ? 'Com divergência' : 'Encerrado'}</Badge> },
          ]} />
        )}
      </Panel>
    </div>
  );
}
