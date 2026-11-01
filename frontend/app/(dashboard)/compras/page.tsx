'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, Eye, ArrowRight, X, ShoppingCart, Package, Truck, CheckCircle2, Ban, AlertTriangle, Building2, Users, Calendar, DollarSign, TrendingDown, ChevronRight, Boxes, FileText, Zap, Clock3 } from 'lucide-react';
import api, { getToken } from '@/lib/api';
import { formatBRL as fmtBRL, formatDate as fmtDate } from '@/lib/format';
import { t as traduzir, tMenu } from '@/lib/i18n';

type Status = 'SOLICITADA' | 'PEDIDO' | 'RECEBIDA' | 'CANCELADA';
type NewItem = { produto: string; sku: string; qtd: number; valorUnit: number };
type PItem = { produto: string; sku: string; qtd: number; valorUnit: number };
type Purchase = { id: string; data: string; filialId: string; filialNome: string; fornecedorId: string; fornecedorNome: string; cnpj: string; itens: PItem[]; cond: string; status: Status };
type Toast = { id: number; msg: string; kind: 'success' | 'error' | 'info' };

// Filiais e fornecedores NÃƒO sÃ£o mais listas fixas neste arquivo. Antes havia
// `FILIAIS = [matriz, filial-rj, cd-campinas]` e `FORNECEDORES = [f1..f4]` com
// ids inventados, e o modal de "Nova Compra" enviava esses ids ao backend. Como
// o banco usa cuid, TODO envio era rejeitado com "Filial invÃ¡lida para esta
// empresa" â€” o botÃ£o "Registrar SOLICITADA" nÃ£o funcionava. Agora as duas listas
// vÃªm de `GET /compras`, que as devolve no mesmo payload.
// Ordem do fluxo de Status possÃ­veis de uma compra (SOLICITADA -> PEDIDO ->
// RECEBIDA). Ã‰ a ordem do processo, nÃ£o um dado de exemplo.
const WORKFLOW: Status[] = ['SOLICITADA', 'PEDIDO', 'RECEBIDA'];

const STATUS_CONFIG: Record<Status, { label: string; color: string; bg: string; dot: string; border: string }> = {
  SOLICITADA: { label: 'SOLICITADA', color: 'var(--nx-amber)', bg: 'rgba(var(--nx-amber-rgb), 0.10)', dot: 'var(--nx-amber)', border: 'rgba(var(--nx-amber-rgb), 0.30)' },
  PEDIDO: { label: 'PEDIDO', color: 'var(--nx-accent)', bg: 'rgba(var(--nx-accent-rgb), 0.10)', dot: 'var(--nx-accent)', border: 'rgba(var(--nx-accent-rgb), 0.35)' },
  RECEBIDA: { label: 'RECEBIDA', color: 'var(--nx-green)', bg: 'rgba(var(--nx-green-rgb), 0.10)', dot: 'var(--nx-green)', border: 'rgba(var(--nx-green-rgb), 0.30)' },
  CANCELADA: { label: 'CANCELADA', color: 'var(--nx-red)', bg: 'rgba(var(--nx-red-rgb), 0.10)', dot: 'var(--nx-red)', border: 'rgba(var(--nx-red-rgb), 0.30)' },
};
// Moeda e data seguem a preferÃªncia "Moeda" / "Formato data" da aba
// ConfiguraÃ§Ãµes (lib/format) â€” antes fixavam BRL/pt-BR aqui.
const formatBRL = (v: number | string | null | undefined): string => fmtBRL(v);
const formatDate = (iso: string | Date | null | undefined): string => {
  if (!iso) return '--';
  // Datas "2025-09-22" sem hora sÃ£o interpretadas como UTC pelo navegador e
  // podem voltar um dia; o T12:00:00 ancora no meio-dia local.
  const d = typeof iso === 'string' ? new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')) : iso;
  return fmtDate(d);
};
function totalOf(p: Purchase): number { return p.itens.reduce((s, i) => s + i.qtd * i.valorUnit, 0); }
// O painel de detalhe usava `calcNovoCustoMedio(estoqueAntes, custoMedioAntes,
// ...)`. Nem `estoqueAntes` nem `custoMedioAntes` vinham da API â€” os dois caÃ­am
// no default e o cÃ¡lculo devolvia sempre o prÃ³prio valorUnit, rotulado como
// "novo medio". Ou seja: um nÃºmero sem origem, apresentado como projeÃ§Ã£o.
// Removido â€” o custo do produto Ã© atualizado no recebimento e quem manda nele
// Ã© a aba Estoque.
function getProgressColor(pct: number): string { if (pct >= 100) return 'var(--success)'; if (pct >= 50) return 'var(--primary)'; return 'var(--warningText)'; }

function Card(p: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: 'var(--card)', border: '1px solid var(--borderLight)', borderRadius: 20, padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.10)', transition: 'all 200ms', overflow: 'hidden', position: 'relative', ...(p.style || {}) }}>{p.children}</div>;
}
function Badge(p: { status: Status }) {
  const c = STATUS_CONFIG[p.status];
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 24, borderRadius: 999, border: '1px solid ' + c.border, background: c.bg, color: c.color, fontSize: 10.5, fontWeight: 700 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: c.dot }} />{c.label}</span>;
}
function FieldLabel(p: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--nexus-muted)', marginBottom: 6 }}>{p.children}</label>;
}
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function InputInner(p, ref) {
  const { style, ...rest } = p;
  return <input ref={ref} {...rest} style={{ background: 'var(--cardInput)', border: '1px solid var(--borderLight2)', borderRadius: 12, height: 44, padding: '0 14px', fontSize: 12, color: 'var(--nexus-text)', width: '100%', outline: 'none', ...(style || {}) }} />;
});
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { style, children, ...rest } = p;
  return <select {...rest} style={{ background: 'var(--cardInput)', border: '1px solid var(--borderLight2)', borderRadius: 12, height: 44, padding: '0 12px', fontSize: 12, color: 'var(--nexus-text)', width: '100%', outline: 'none', ...(style || {}) }}>{children}</select>;
}
function Row(p: { children: React.ReactNode; onClick?: () => void }) {
  return <tr onClick={p.onClick} style={{ borderBottom: '1px solid var(--borderLight)', height: 52, transition: 'all 150ms', cursor: 'pointer' }} onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--nexus-panel-2)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'; }}>{p.children}</tr>;
}
function KPI(p: { label: string; value: string; icon: React.ReactNode; delta?: string; deltaColor?: string }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ position: 'absolute', width: 80, height: 80, right: -20, top: -20, borderRadius: 999, background: 'rgba(var(--nx-accent-rgb),0.10)', filter: 'blur(20px)' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--nexus-muted)', fontWeight: 600 }}>{p.label}</span>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(var(--nx-green-rgb),0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.icon}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--nexus-text)', marginTop: 8 }}>{p.value}</div>
      {p.delta ? <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '2px 8px', background: 'var(--nexus-panel-2)', color: p.deltaColor || 'var(--nexus-text)' }}>{p.delta}</span> : null}
    </Card>
  );
}
function Stepper(p: { current: Status }) {
  if (p.current === 'CANCELADA') return <div style={{ fontSize: 11, color: 'var(--nexus-muted)' }}>Compra cancelada</div>;
  const idx = WORKFLOW.indexOf(p.current);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {WORKFLOW.map((s, i) => {
        const done = i <= idx;
        return (
          <React.Fragment key={s}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 28, height: 28, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'monospace', background: done ? 'var(--nexus-accent)' : 'var(--nexus-panel-2)', color: '#fff', border: '1px solid ' + (done ? 'var(--nexus-accent)' : 'var(--nexus-border)') }}>{done ? 'âœ“' : (i + 1)}</span>
              <span style={{ fontSize: 10.5, color: done ? 'var(--nexus-accent-2)' : 'var(--nexus-muted)', fontWeight: 700 }}>{s}</span>
            </div>
            {i < WORKFLOW.length - 1 ? <div style={{ height: 2, flex: 1, margin: '0 8px', minWidth: 20, background: i < idx ? 'rgba(var(--nx-accent-rgb),0.60)' : 'var(--nexus-border)' }} /> : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}
function EmptyState(p: { onNew: () => void }) {
  return <div style={{ textAlign: 'center', padding: '40px 20px' }}><Package size={28} color="var(--nexus-muted)" /><p style={{ color: 'var(--nexus-muted)', fontSize: 13, margin: '10px 0' }}>Nenhuma compra encontrada.</p><button type="button" onClick={p.onNew} style={{ background: 'linear-gradient(135deg,var(--primary),var(--primaryHover))', border: 'none', borderRadius: 12, height: 40, padding: '0 18px', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Nova compra</button></div>;
}
function ErrorState(p: { msg: string; retry: () => void }) {
  return <div role="alert" style={{ textAlign: 'center', padding: '40px 20px' }}><AlertTriangle size={28} color="var(--nx-amber)" /><p style={{ color: 'var(--nexus-text)', fontSize: 13, margin: '10px 0' }}>{p.msg}</p><button type="button" onClick={p.retry} style={{ background: 'transparent', border: '1px solid var(--nexus-border)', borderRadius: 12, height: 40, padding: '0 18px', color: 'var(--nexus-text)', fontSize: 12, cursor: 'pointer' }}>Tentar novamente</button></div>;
}

export default function ComprasPage() {
  const router = useRouter();
  // ComeÃ§a VAZIO de propÃ³sito. Antes a tela nascia com `MOCKS` (cinco compras
  // fictÃ­cias) e sÃ³ trocava pela lista real quando a API devolvia alguma coisa
  // â€” ou seja, uma empresa sem compras via compras inventadas. Agora a lista
  // nasce vazia e Ã© preenchida sÃ³ com `GET /compras`.
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [search, setSearch] = useState('');
  const [searchDeb, setSearchDeb] = useState('');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [filialFilter, setFilialFilter] = useState('TODOS');
  const [fornecedorFilter, setFornecedorFilter] = useState('TODOS');
  const [periodo] = useState('30d');
  const [selected, setSelected] = useState<Purchase | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newFilial, setNewFilial] = useState('');
  const [newForn, setNewForn] = useState('');
  const [newCond, setNewCond] = useState('30 DDL');
  const [newItems, setNewItems] = useState<NewItem[]>([{ produto: '', sku: '', qtd: 1, valorUnit: 0 }]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [backendOk, setBackendOk] = useState(false);
  // CatÃ¡logos vindos do backend. `filiais`/`fornecedores` nÃ£o podem mais ter id
  // fixo, entÃ£o o valor inicial dos selects Ã© string vazia e o primeiro item real
  // que chegar vira o selecionado.
  const [filiais, setFiliais] = useState<Array<{ id: string; nome: string }>>([]);
  const [fornecedores, setFornecedores] = useState<Array<{ id: string; nome: string; cnpj: string | null; status: string }>>([]);
  // Trava de envio: sem ela, dois cliques em "Registrar SOLICITADA" criam DUAS
  // compras â€” o POST nÃ£o Ã© idempotente e o backend nÃ£o rejeita o segundo.
  const [salvando, setSalvando] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastId = useRef(0);
  const pushToast = useCallback((msg: string, kind: Toast['kind']) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2900);
  }, []);
  useEffect(() => {
    const h = window.setTimeout(() => setSearchDeb(search), 300);
    return () => window.clearTimeout(h);
  }, [search]);
  const load = useCallback(async () => {
    try {
      const res = await api.get('/compras');
      const list = (res as { data: unknown }).data as { compras?: unknown[] } | unknown[];
      const arr = Array.isArray(list) ? list : (list as { compras?: unknown[] }).compras;
      const fil = (list as { filiais?: Array<{ id: string; nome: string }> }).filiais;
      const forn = (list as { fornecedores?: Array<{ id: string; nome: string; cnpj: string | null; status: string }> }).fornecedores;
      // CatÃ¡logos: uma resposta bem-sucedida sempre repÃµe as listas, mesmo
      // quando estÃ£o vazias â€” caso contrÃ¡rio o select ficaria mostrando a filial
      // de uma empresa anterior.
      setFiliais(Array.isArray(fil) ? fil : []);
      setFornecedores(Array.isArray(forn) ? forn : []);
      // `length > 0` no if jÃ¡ era um bug: uma empresa legitimamente sem compras
      // nunca marcava o backend como conectado e nunca limpava a lista anterior.
      // Uma resposta vÃ¡lida â€” inclusive vazia â€” Ã© sucesso.
      const mapped: Purchase[] = (Array.isArray(arr) ? arr : []).map((c: unknown) => {
        const r = c as Record<string, unknown>;
        const fornRel = r.fornecedor as Record<string, unknown> | undefined;
        const filialRel = r.filial as Record<string, unknown> | undefined;
        const itens = r.itens as Array<Record<string, unknown>> | undefined;
        return {
          // Todo campo vem do banco. Antes havia um por um de defaults que
          // fabricavam registro: `sem-id-0`, data fixa '2025-09-20', filial
          // 'Matriz Sao Paulo', fornecedor 'f1' e status 'SOLICITADA' â€” se um
          // campo viesse vazio, a tela mostrava um dado inventado como se fosse real.
          id: String(r.id ?? ''),
          data: String(r.dataCompra ?? r.createdAt ?? ''),
          filialId: String(r.filialId ?? ''),
          filialNome: String(filialRel?.nome ?? 'â€”'),
          fornecedorId: String(r.fornecedorId ?? ''),
          fornecedorNome: String(fornRel?.nome ?? 'â€”'),
          cnpj: String(fornRel?.cnpj ?? 'â€”'),
          // O backend inclui `produto: { nome, sku }` no item. A tela lia
          // `it.produto` direto e caÃ­a no default 'Item', mostrando
          // "[object Object]" no painel de detalhe.
          itens: (itens ?? []).map((it) => {
            const prod = it.produto as Record<string, unknown> | undefined;
            return {
              produto: String(prod?.nome ?? 'â€”'),
              sku: String(prod?.sku ?? 'â€”'),
              qtd: Number(it.quantidade ?? 0),
              valorUnit: Number(it.valorUnit ?? 0),
            };
          }),
          cond: String(r.condPagamento ?? 'â€”'),
          status: (r.status as Status) ?? 'SOLICITADA',
        };
      });
      setPurchases(mapped);
      // Re-sincroniza o painel de detalhe com a lista recem-carregada. Sem isto,
      // quem clica em "Confirmar Recebimento" dentro do drawer continua vendo o
      // status antigo na Badge e no Stepper ate fechar e reabrir a compra.
      setSelected((s) => (s ? mapped.find((p) => p.id === s.id) ?? s : s));
      setBackendOk(true);
      setLoadError(null);
    } catch (e) {
      // Antes: `catch { setLoadError(null) }` â€” o catch fazia o CONTRARIO do
      // nome. Um 403/500 deixava a tela vazia, sem nenhuma mensagem e sem o
      // "Tentar novamente", parecendo uma empresa sem compras.
      setBackendOk(false);
      setLoadError(e instanceof Error && e.message ? e.message : 'NÃ£o foi possÃ­vel carregar as compras.');
    }
  }, []);
  useEffect(() => {
    if (!getToken()) { router.replace('/'); return; }
    void load();
  }, [router, load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowNew(false); setSelected(null); }
      if ((e.key === 'n' || e.key === 'N') && !showNew && !selected && (document.activeElement?.tagName !== 'INPUT')) { setShowNew(true); }
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNew, selected]);
  useEffect(() => {
    document.body.style.overflow = (showNew || selected) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showNew, selected]);

  const filtered = useMemo(() => {
    const q = searchDeb.trim().toLowerCase();
    return purchases.filter((p) => {
      if (statusFilter !== 'TODOS' && p.status !== statusFilter) return false;
      if (filialFilter !== 'TODOS' && p.filialId !== filialFilter) return false;
      if (fornecedorFilter !== 'TODOS' && p.fornecedorId !== fornecedorFilter) return false;
      if (!q) return true;
      return (p.id + ' ' + p.fornecedorNome + ' ' + p.itens.map((i) => i.produto + ' ' + i.sku).join(' ')).toLowerCase().includes(q);
    });
  }, [purchases, searchDeb, statusFilter, filialFilter, fornecedorFilter]);
  // "Recebidas no mes" contava TODAS as compras RECEBIDA, de qualquer data â€”
  // o rÃ³tulo prometia o mÃªs e o nÃºmero nÃ£o era do mÃªs.
  const recebidasMes = useMemo(() => {
    const hoje = new Date();
    return purchases.filter((p) => {
      if (p.status !== 'RECEBIDA') return false;
      const d = new Date(p.data);
      return !Number.isNaN(d.getTime()) && d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth();
    }).length;
  }, [purchases]);
  // A mÃ©trica real desta tela: quanto ainda estÃ¡ comprometido com o fornecedor e
  // ainda nÃ£o virou estoque. Substitui o KPI "Economia", que dependia de
  // `custoMedioAntes` â€” campo que a API nunca devolve, entÃ£o valia sempre
  // R$ 0,00 apresentado como economia real.
  const emAberto = useMemo(() => purchases.filter((p) => p.status === 'SOLICITADA' || p.status === 'PEDIDO').reduce((s, p) => s + totalOf(p), 0), [purchases]);
  const kpis = useMemo(() => {
    const totalSolicitado = purchases.filter((p) => p.status !== 'CANCELADA').reduce((s, p) => s + totalOf(p), 0);
    const aguardando = purchases.filter((p) => p.status === 'SOLICITADA' || p.status === 'PEDIDO').length;
    return { totalSolicitado, aguardando, recebidasMes, emAberto };
  }, [purchases, recebidasMes, emAberto]);
  const advanceStatus = useCallback((id: string) => {
    const atual = purchases.find((p) => p.id === id);
    if (!atual) return;
    const next = atual.status === 'SOLICITADA' ? 'PEDIDO' : atual.status === 'PEDIDO' ? 'RECEBIDA' : null;
    if (!next) return;
    api.post(`/compras/${id}/${next === 'PEDIDO' ? 'confirmar' : 'receber'}`)
      .then(() => {
        setPurchases((prev) => prev.map((p) => p.id === id ? { ...p, status: next } : p));
        setSelected((s) => (s && s.id === id ? { ...s, status: next } : s));
        pushToast(`Status atualizado para ${next}`, 'success');
      })
      .catch((error) => {
        pushToast(error instanceof Error ? error.message : 'NÃ£o foi possÃ­vel atualizar a compra', 'error');
      });
  }, [purchases, pushToast]);
  const cancelPurchase = useCallback((id: string) => {
    api.post(`/compras/${id}/cancelar`)
      .then(() => {
        setPurchases((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'CANCELADA' as Status } : p)));
        setSelected((s) => (s && s.id === id ? { ...s, status: 'CANCELADA' as Status } : s));
        pushToast('Compra cancelada no backend.', 'info');
      })
      .catch((error) => {
        pushToast(error instanceof Error ? error.message : 'NÃ£o foi possÃ­vel cancelar a compra', 'error');
      });
  }, [pushToast]);
  const confirmRecebimento = useCallback((id: string) => {
    api.post(`/compras/${id}/receber`)
      .then(() => {
        // Receber muda estoque, custo do produto e financeiro no servidor. A
        // atualizaÃ§Ã£o otimista de status sozinha deixaria a tela com dado velho,
        // entÃ£o recarrega a lista para o que aparece ser o que estÃ¡ gravado.
        setPurchases((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'RECEBIDA' as Status } : p)));
        void load();
        pushToast('Recebimento confirmado: estoque, custo e despesa gravados.', 'success');
      })
      .catch((error) => {
        pushToast(error instanceof Error ? error.message : 'NÃ£o foi possÃ­vel confirmar o recebimento', 'error');
      });
  }, [pushToast, load]);
  const handleAddNew = useCallback(() => {
    if (salvando) return;
    if (!newFilial) { pushToast('Selecione a filial da compra.', 'error'); return; }
    if (!newForn) { pushToast('Selecione um fornecedor cadastrado.', 'error'); return; }
    const valid = newItems.filter((i) => i.qtd > 0 && i.valorUnit > 0 && (i.produto.trim() || i.sku.trim()));
    if (valid.length === 0) { pushToast('Adicione ao menos 1 item valido.', 'error'); return; }
    // A validaÃ§Ã£o do fornecedor olha a lista REAL do backend. Antes apontava
    // para a constante FORNECEDORES (f1..f4), que passava sempre e deixava o
    // prÃ³prio id invÃ¡lido ser enviado para o banco.
    const forn = fornecedores.find((f) => f.id === newForn);
    if (!forn) {
      pushToast('Selecione um fornecedor cadastrado no backend antes de registrar a compra.', 'error');
      return;
    }
    // O POST /compras sÃ³ aceita fornecedor Ativo (regra do prÃ³prio backend).
    if (forn.status && forn.status !== 'Ativo') {
      pushToast(`O fornecedor ${forn.nome} estÃ¡ ${forn.status} e nÃ£o aceita nova compra.`, 'error');
      return;
    }
    setSalvando(true);
    api.get('/produtos?take=200')
      .then((resp) => {
        const produtos = (resp.data as { produtos?: Array<Record<string, unknown>> })?.produtos ?? [];
        const itens = valid.map((item) => {
          const alvoNome = item.produto.trim().toLowerCase();
          const alvoSku = item.sku.trim().toLowerCase();
          // Casamento por SKU exato tem prioridade; o nome sÃ³ entra como
          // segunda opÃ§Ã£o, e SEM o `includes()` que existia antes. Com ele, um
          // item sem nome ("") casava com o primeiro produto da lista porque
          // `nome.includes('')` Ã© sempre verdadeiro â€” a compra saÃ­a com o
          // produto errado, sem aviso.
          const match = produtos.find((p) => String(p.sku ?? '').toLowerCase() === alvoSku && alvoSku !== '')
            ?? (alvoNome ? produtos.find((p) => String(p.nome ?? '').toLowerCase() === alvoNome) : undefined);
          if (!match) throw new Error(`Produto nÃ£o encontrado: ${item.produto || item.sku || 'item'}`);
          return { produtoId: String(match.id), quantidade: Number(item.qtd), valorUnit: Number(item.valorUnit) };
        });

        return api.post('/compras', {
          filialId: newFilial,
          fornecedorId: newForn,
          condPagamento: newCond,
          itens,
          origem: 'MANUAL',
        });
      })
      .then(() => {
        void load();
        setShowNew(false);
        setNewItems([{ produto: '', sku: '', qtd: 1, valorUnit: 0 }]);
        pushToast('Compra registrada como SOLICITADA no backend.', 'success');
      })
      .catch((error) => {
        pushToast(error instanceof Error ? error.message : 'NÃ£o foi possÃ­vel registrar a compra', 'error');
      })
      .finally(() => { setSalvando(false); });
  }, [newItems, newFilial, newForn, newCond, load, pushToast, salvando, fornecedores]);
  const newTotal = useMemo(() => newItems.reduce((s, i) => s + Number(i.qtd || 0) * Number(i.valorUnit || 0), 0), [newItems]);

  const btnP: React.CSSProperties = { background: 'linear-gradient(135deg,var(--primary),var(--primaryHover))', boxShadow: 'var(--shadowPrimary)', borderRadius: 12, height: 44, padding: '0 20px', fontSize: 12, fontWeight: 700, color: '#fff', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 };
  const iconBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: '1px solid var(--borderLight2)', background: 'transparent', color: 'var(--nexus-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', fontFamily: "'Inter',sans-serif" }}>
      <style>{':root{--card:var(--nexus-panel);--card2:var(--nexus-panel-2);--card3:var(--nexus-panel);--cardInput:var(--nexus-panel-2);--borderLight:var(--nexus-border);--borderLight2:var(--nexus-border);--primary:var(--nexus-accent);--primaryHover:var(--nexus-accent-2);--warningText:var(--nx-amber);--shadowPrimary:0 0 20px rgba(var(--nx-accent-rgb),0.25)}'}</style>
      <nav style={{ position: 'sticky', top: 0, zIndex: 20, backdropFilter: 'blur(20px)', background: 'var(--nexus-panel)', borderBottom: '1px solid var(--borderLight)' }}>
        <div style={{ maxWidth: 1320, margin: '0 auto', padding: '0 24px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--nexus-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800 }}>N</span>
            <strong style={{ color: 'var(--nexus-text)', fontSize: 14 }}>NEXUS OS <span style={{ color: 'var(--nexus-muted)', fontWeight: 400 }}>/ Compras</span></strong>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--nexus-muted)', background: 'var(--nexus-panel-2)', border: '1px solid var(--borderLight)', borderRadius: 999, padding: '0 12px', height: 28, display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--nx-green)' }} />API ERP v2.4</span>
          </div>
          <span style={{ fontSize: 11, color: backendOk ? 'var(--nx-green)' : 'var(--nx-amber)', fontFamily: 'monospace' }}>{backendOk ? 'backend conectado' : 'backend indisponivel'} {periodo}</span>
        </div>
      </nav>
      <main style={{ maxWidth: 1320, margin: '0 auto', padding: '28px 24px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--nexus-text)', margin: 0 }}>Compras</h1>
            <p style={{ fontSize: 13, color: 'var(--nexus-muted)', margin: '6px 0 0' }}>Solicitada para Pedido para Recebida ou Cancelada.</p>
          </div>
          <button type="button" onClick={() => setShowNew(true)} style={{ ...btnP, height: 40 }}><Plus size={15} /> Nova Compra</button>
        </div>

        <div role="tablist" aria-label="Workflow" style={{ display: 'flex', gap: 6, marginBottom: 16, fontSize: 12.5, color: 'var(--nexus-muted)' }}>
          {WORKFLOW.map((s, i) => (
            <span key={s} role="tab" aria-selected={false} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: i === 0 ? 'var(--nx-amber)' : i === 1 ? 'var(--nexus-accent)' : 'var(--nx-green)' }} />
              <span style={{ fontFamily: 'monospace' }}>{s}</span>
              {i < 2 ? <ChevronRight size={12} /> : null}
            </span>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          <KPI label="Total Solicitado" value={formatBRL(kpis.totalSolicitado)} icon={<DollarSign size={16} color="var(--nx-green)" />} delta={filtered.length + ' registros'} />
          <KPI label={traduzir('aguardando', "Aguardando")} value={String(kpis.aguardando)} icon={<Clock3 size={16} color="var(--nx-amber)" />} delta="solicitada + pedido" deltaColor="var(--nx-amber)" />
          <KPI label="Recebidas no mes" value={String(kpis.recebidasMes)} icon={<CheckCircle2 size={16} color="var(--nx-green)" />} delta="baixa OK" deltaColor="var(--nx-green)" />
          <KPI label="A receber" value={formatBRL(kpis.emAberto)} icon={<TrendingDown size={16} color="var(--nexus-accent-2)" />} delta="solicitada + pedido" deltaColor="var(--nexus-accent-2)" />
        </div>
        <Card style={{ padding: 12, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--nexus-muted)' }} />
              <Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar ID, fornecedor, produto, SKU..." aria-label="Buscar compras" style={{ paddingLeft: 36, height: 36 }} />
            </div>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filtro status" style={{ height: 36 }}><option value="TODOS">TODOS</option><option value="SOLICITADA">SOLICITADA</option><option value="PEDIDO">PEDIDO</option><option value="RECEBIDA">RECEBIDA</option><option value="CANCELADA">CANCELADA</option></Select>
            <Select value={filialFilter} onChange={(e) => setFilialFilter(e.target.value)} aria-label="Filtro filial" style={{ height: 36 }}><option value="TODOS">TODOS</option>{filiais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</Select>
            <Select value={fornecedorFilter} onChange={(e) => setFornecedorFilter(e.target.value)} aria-label="Filtro fornecedor" style={{ height: 36 }}><option value="TODOS">TODOS</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</Select>
          </div>
        </Card>

        <div style={{ background: 'var(--card)', border: '1px solid var(--borderLight)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table role="table" aria-label="Compras" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--card)', zIndex: 10 }}>
                <tr style={{ height: 36 }}>
                  {['ID', 'Data', 'Filial', 'Fornecedor', 'Itens', 'Total', 'Cond', 'Status', 'Acoes'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '0 16px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--nexus-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <Row key={p.id} onClick={() => setSelected(p)}>
                    <td style={{ padding: '0 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--nexus-text)' }}>{p.id}</td>
                    <td style={{ padding: '0 16px', fontSize: 12.5, color: 'var(--nexus-muted)' }}>{formatDate(p.data)}</td>
                    <td style={{ padding: '0 16px', fontSize: 12, color: 'var(--nexus-muted)' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Building2 size={14} />{p.filialNome}</span></td>
                    <td style={{ padding: '8px 16px' }}><div style={{ fontSize: 12.5, color: 'var(--nexus-text)' }}>{p.fornecedorNome}</div><div style={{ fontSize: 10.5, fontFamily: 'monospace', color: 'var(--nexus-muted)' }}>{p.cnpj}</div></td>
                    <td style={{ padding: '0 16px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999, padding: '0 8px', height: 24, background: 'var(--nexus-panel-2)', fontSize: 11, color: 'var(--nexus-text)' }}><Package size={12} />{p.itens.length}</span></td>
                    <td style={{ padding: '0 16px', fontSize: 12.5, fontWeight: 600, color: 'var(--nexus-text)' }}>{formatBRL(totalOf(p))}</td>
                    <td style={{ padding: '0 16px', fontSize: 11.5, fontFamily: 'monospace', color: 'var(--nexus-muted)' }}>{p.cond}</td>
                    <td style={{ padding: '0 16px' }}><Badge status={p.status} /></td>
                    <td style={{ padding: '0 16px' }}>
                      <span style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                        <button type="button" aria-label={'Ver ' + p.id} onClick={() => setSelected(p)} style={iconBtn}><Eye size={13} /></button>
                        {p.status !== 'RECEBIDA' && p.status !== 'CANCELADA' ? <button type="button" aria-label="Avancar" onClick={() => advanceStatus(p.id)} style={iconBtn}><ArrowRight size={13} /></button> : null}
                        {p.status !== 'RECEBIDA' && p.status !== 'CANCELADA' ? <button type="button" aria-label={traduzir('cancelar', "Cancelar")} onClick={() => cancelPurchase(p.id)} style={iconBtn}><Ban size={13} /></button> : null}
                      </span>
                    </td>
                  </Row>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 ? <EmptyState onNew={() => setShowNew(true)} /> : null}
            {loadError ? <ErrorState msg={loadError} retry={() => void load()} /> : null}
          </div>
          <div style={{ borderTop: '1px solid var(--borderLight)', background: 'var(--nexus-panel-2)', padding: '12px 16px', fontSize: 11, fontFamily: 'monospace', color: 'var(--nexus-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={13} /> backend: GET /compras Â· POST /compras Â· POST /compras/:id/confirmar|receber|cancelar Â· {filtered.length} registros Â· {periodo}
          </div>
        </div>
      </main>

      {selected ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.60)', backdropFilter: 'blur(4px)' }} onClick={() => setSelected(null)}>
          <aside role="dialog" aria-label={'Detalhe ' + selected.id} onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: '92vw', height: '100%', background: 'var(--card3)', borderLeft: '1px solid var(--borderLight2)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 64, padding: '0 24px', borderBottom: '1px solid var(--borderLight)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--nexus-text)', fontWeight: 700, fontSize: 13 }}><FileText size={15} />{selected.id}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Badge status={selected.status} />
                <button type="button" aria-label={traduzir('fechar', "Fechar")} onClick={() => setSelected(null)} style={{ width: 32, height: 32, borderRadius: 999, background: 'var(--card2)', border: '1px solid var(--nexus-border)', color: 'var(--nexus-text)', cursor: 'pointer' }}>X</button>
              </span>
            </div>
            <div style={{ padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 24, flex: 1 }}>
              <div style={{ background: 'var(--cardInput)', border: '1px solid var(--borderLight)', borderRadius: 12, padding: 12 }}>
                <FieldLabel>Workflow</FieldLabel>
                <Stepper current={selected.status} />
              </div>
              <div>
                <FieldLabel>Explicacao</FieldLabel>
                <p style={{ fontSize: 12.5, color: 'var(--nexus-muted)', lineHeight: 1.6, margin: 0 }}>O recebimento da baixa no estoque, atualiza o custo do produto para o ultimo valor pago e gera a despesa no financeiro.</p>
              </div>
              <div>
                <FieldLabel>Itens</FieldLabel>
                <div style={{ background: 'var(--cardInput)', border: '1px solid var(--borderLight)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selected.itens.map((it, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--nexus-text)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{it.produto}</strong><span>{formatBRL(it.qtd * it.valorUnit)}</span></div>
                      <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--nexus-muted)', marginTop: 4 }}>{it.sku} Â· {it.qtd}x {formatBRL(it.valorUnit)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ borderLeft: '1px solid var(--borderLight2)', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--nexus-muted)' }}>
                <span>Filial: {selected.filialNome}</span>
                <span>Condicao: {selected.cond}</span>
                <span>Data: {formatDate(selected.data)}</span>
                <span>Total: {formatBRL(totalOf(selected))}</span>
              </div>
              <div style={{ background: 'var(--cardInput)', border: '1px solid var(--borderLight)', borderRadius: 12, padding: 12 }}>
                <FieldLabel>{traduzir('fornecedor', "Fornecedor")}</FieldLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--nexus-text)', fontSize: 13 }}><Truck size={14} />{selected.fornecedorNome}</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--nexus-muted)', marginTop: 4 }}>{selected.cnpj}</div>
              </div>
            </div>
            <div style={{ padding: 16, borderTop: '1px solid var(--borderLight)', background: 'var(--nexus-panel-2)', display: 'flex', gap: 10 }}>
              {selected.status !== 'RECEBIDA' && selected.status !== 'CANCELADA' ? <button type="button" onClick={() => advanceStatus(selected.id)} style={{ ...btnP, height: 44, flex: 1, justifyContent: 'center' }}><ArrowRight size={15} /> Avancar etapa</button> : null}
              {selected.status !== 'RECEBIDA' && selected.status !== 'CANCELADA' ? <button type="button" onClick={() => confirmRecebimento(selected.id)} style={{ ...btnP, height: 44, flex: 1, justifyContent: 'center' }}><CheckCircle2 size={15} /> Confirmar Recebimento</button> : null}
              {selected.status !== 'RECEBIDA' && selected.status !== 'CANCELADA' ? <button type="button" onClick={() => cancelPurchase(selected.id)} style={{ height: 44, borderRadius: 12, background: 'transparent', border: '1px solid var(--borderLight2)', color: 'var(--nexus-text)', padding: '0 16px', cursor: 'pointer' }}>{traduzir('cancelar', "Cancelar")}</button> : null}
            </div>
          </aside>
        </div>
      ) : null}

      {showNew ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.60)', backdropFilter: 'blur(12px)' }} onClick={() => setShowNew(false)}>
          <div role="dialog" aria-label="Nova compra" onClick={(e) => e.stopPropagation()} style={{ width: 640, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', background: 'var(--card2)', border: '1px solid var(--borderLight2)', borderRadius: 24, boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
            <div style={{ height: 56, padding: '0 20px', borderBottom: '1px solid var(--borderLight)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--nexus-text)', fontSize: 14, fontWeight: 700 }}><ShoppingCart size={15} /> Nova Compra</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Badge status="SOLICITADA" />
                <button type="button" aria-label="Fechar modal" onClick={() => setShowNew(false)} style={{ width: 32, height: 32, borderRadius: 999, background: 'var(--card2)', border: '1px solid var(--nexus-border)', color: 'var(--nexus-text)', cursor: 'pointer' }}><X size={14} /></button>
              </span>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><FieldLabel>Filial</FieldLabel><Select value={newFilial} onChange={(e) => setNewFilial(e.target.value)} aria-label="Filial da nova compra"><option value="">Escolha a filial...</option>{filiais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</Select></div>
                <div><FieldLabel>{traduzir('fornecedor', "Fornecedor")}</FieldLabel><Select value={newForn} onChange={(e) => setNewForn(e.target.value)} aria-label="Fornecedor da nova compra"><option value="">Escolha o fornecedor...</option>{fornecedores.map((f) => <option key={f.id} value={f.id} disabled={f.status !== 'Ativo'}>{f.nome}{f.status !== 'Ativo' ? ` (${f.status})` : ''}</option>)}</Select></div>
              </div>
              <div><FieldLabel><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Calendar size={12} /> Condicao pagamento</span></FieldLabel><Input value={newCond} onChange={(e) => setNewCond(e.target.value)} /></div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <FieldLabel>Itens</FieldLabel>
                  <button type="button" onClick={() => setNewItems((p) => [...p, { produto: '', sku: '', qtd: 1, valorUnit: 0 }])} style={{ background: 'none', border: 'none', color: 'var(--nexus-accent-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ Adicionar item</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {newItems.map((it, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '5fr 3fr 2fr 2fr auto', gap: 8, background: 'var(--cardInput)', borderRadius: 10, padding: 10 }}>
                      <Input value={it.produto} onChange={(e) => setNewItems((p) => p.map((x, i) => (i === idx ? { ...x, produto: e.target.value } : x)))} placeholder={traduzir('produto', "Produto")} style={{ height: 32 }} />
                      <Input value={it.sku} onChange={(e) => setNewItems((p) => p.map((x, i) => (i === idx ? { ...x, sku: e.target.value } : x)))} placeholder="SKU" style={{ height: 32 }} />
                      <Input type="number" min={1} value={it.qtd} onChange={(e) => setNewItems((p) => p.map((x, i) => (i === idx ? { ...x, qtd: Number(e.target.value) } : x)))} style={{ height: 32 }} />
                      <Input type="number" min={0} step="0.01" value={it.valorUnit} onChange={(e) => setNewItems((p) => p.map((x, i) => (i === idx ? { ...x, valorUnit: Number(e.target.value) } : x)))} style={{ height: 32 }} />
                      <button type="button" aria-label="Remover item" onClick={() => setNewItems((p) => p.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: 'var(--nexus-muted)', cursor: 'pointer' }}><X size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ borderRadius: 12, background: 'var(--cardInput)', padding: 12, display: 'flex', justifyContent: 'space-between', color: 'var(--nexus-text)', fontSize: 13 }}>
                <span>{traduzir('total', "Total")}</span><strong>{formatBRL(newTotal)}</strong>
              </div>
              <div style={{ borderRadius: 10, background: 'rgba(var(--nx-accent-rgb),0.10)', border: '1px solid rgba(var(--nx-accent-rgb),0.20)', padding: 12, fontSize: 12, color: 'var(--nexus-muted)', display: 'flex', gap: 8 }}>
                <Clock3 size={14} /> A compra sera registrada como SOLICITADA e podera avancar para PEDIDO e RECEBIDA.
              </div>
            </div>
            <div style={{ padding: 16, borderTop: '1px solid var(--borderLight)', background: 'var(--nexus-panel-2)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setShowNew(false)} style={{ height: 36, borderRadius: 12, background: 'transparent', border: '1px solid var(--borderLight2)', color: 'var(--nexus-text)', padding: '0 18px', cursor: 'pointer', fontSize: 12 }}>{traduzir('cancelar', "Cancelar")}</button>
              <button type="button" onClick={handleAddNew} disabled={salvando} style={{ ...btnP, height: 36, opacity: salvando ? 0.6 : 1, cursor: salvando ? 'wait' : 'pointer' }}>{salvando ? 'Registrando...' : 'Registrar SOLICITADA'}</button>
            </div>
          </div>
        </div>
      ) : null}

      <div aria-live="polite" style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 60 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{ minWidth: 280, maxWidth: 360, background: 'var(--nexus-panel)', border: '1px solid var(--nexus-border)', borderRadius: 14, padding: '12px 16px', fontSize: 12, color: 'var(--nexus-text)', boxShadow: '0 16px 48px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 24, height: 24, borderRadius: 999, background: t.kind === 'success' ? 'rgba(var(--nx-green-rgb),0.20)' : t.kind === 'error' ? 'rgba(var(--nx-red-rgb),0.20)' : 'rgba(var(--nx-accent-rgb),0.20)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {t.kind === 'success' ? <CheckCircle2 size={13} color="var(--nx-green)" /> : t.kind === 'error' ? <AlertTriangle size={13} color="var(--nx-red)" /> : <Zap size={13} color="var(--nexus-accent-2)" />}
              </span>
              {t.msg}
            </div>
            <div style={{ height: 2, background: 'var(--primary)', marginTop: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}




