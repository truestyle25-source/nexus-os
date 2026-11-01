"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Module = { id: string; label: string; description: string };
type RecordItem = { id: string; module: string; title: string; status: string; data: Record<string, unknown>; updatedAt: string };
const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
/** Mesmo esquema do restante do Nexus OS: token guardado em localStorage e enviado como Bearer. */
function cabecalhos(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = typeof window !== "undefined" ? localStorage.getItem("nexus_token") : null;
  if (token && token !== "undefined" && token !== "null" && token.trim() !== "") {
    h.Authorization = `Bearer ${token}`;
  }
  return h;
}

export default function EnterprisePackPage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [moduleId, setModuleId] = useState("financeiro");
  const [items, setItems] = useState<RecordItem[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<RecordItem | null>(null);
  const [title, setTitle] = useState("");
  const [json, setJson] = useState("{}");
  const [showForm, setShowForm] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  const activeModule = useMemo(() => modules.find(m => m.id === moduleId), [modules, moduleId]);
  const load = useCallback(async () => {
    setBusy(true); setMessage("");
    try {
      const [mRes, rRes, sRes] = await Promise.all([
        fetch(`${API}/api/enterprise/modules`, { headers: cabecalhos() }),
        fetch(`${API}/api/enterprise/records?module=${encodeURIComponent(moduleId)}&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&page=1&pageSize=50`, { headers: cabecalhos(), credentials: "include" }),
        fetch(`${API}/api/enterprise/reports/summary`, { headers: cabecalhos(), credentials: "include" })
      ]);
      if (!mRes.ok || !rRes.ok) throw new Error((await rRes.json().catch(() => ({}))).message || "Não foi possível carregar os dados. Verifique login e API.");
      setModules(await mRes.json());
      setItems((await rRes.json()).items || []);
      if (sRes.ok) setSummary(await sRes.json());
    } catch (e: any) { setMessage(e.message || "Erro ao carregar."); }
    finally { setBusy(false); }
  }, [moduleId, search, status]);

  useEffect(() => { load(); }, [load]);

  function startNew() { setEditing(null); setTitle(""); setJson("{}"); setShowForm(true); }
  function startEdit(item: RecordItem) { setEditing(item); setTitle(item.title); setJson(JSON.stringify(item.data, null, 2)); setShowForm(true); }

  async function save() {
    let data: Record<string, unknown>;
    try { data = JSON.parse(json); if (!data || Array.isArray(data) || typeof data !== "object") throw new Error(); }
    catch { setMessage("O campo Dados precisa conter um objeto JSON válido."); return; }
    setBusy(true); setMessage("");
    try {
      const url = editing ? `${API}/api/enterprise/records/${editing.id}` : `${API}/api/enterprise/records`;
      const res = await fetch(url, { method: editing ? "PATCH" : "POST", headers: cabecalhos(), credentials: "include", body: JSON.stringify(editing ? { title, data } : { module: moduleId, title, data }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Não foi possível salvar.");
      setShowForm(false); setMessage("Registro salvo com sucesso."); await load();
    } catch (e: any) { setMessage(e.message || "Falha ao salvar."); }
    finally { setBusy(false); }
  }

  async function action(id: string, actionName: string) {
    const comment = actionName === "reject" ? window.prompt("Motivo da rejeição:") : undefined;
    if (actionName === "reject" && comment === null) return;
    setBusy(true); setMessage("");
    try {
      const res = await fetch(`${API}/api/enterprise/records/${id}/${actionName}`, { method: "POST", headers: cabecalhos(), credentials: "include", body: JSON.stringify(comment ? { comment } : {}) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Ação não concluída.");
      setMessage("Fluxo atualizado."); await load();
    } catch (e: any) { setMessage(e.message || "Erro na ação."); }
    finally { setBusy(false); }
  }

  async function archive(item: RecordItem) {
    if (!window.confirm(`Arquivar "${item.title}"?`)) return;
    const res = await fetch(`${API}/api/enterprise/records/${item.id}`, { method: "DELETE", headers: cabecalhos(), credentials: "include" });
    if (!res.ok) { setMessage("Não foi possível arquivar."); return; }
    setMessage("Registro arquivado."); await load();
  }

  return <main className="min-h-screen bg-[#0b0b14] p-4 text-zinc-100 md:p-8">
    <div className="mx-auto max-w-7xl">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div><div className="text-xs font-bold uppercase tracking-[.25em] text-violet-300">NEXUS OS • Enterprise</div><h1 className="mt-2 text-3xl font-bold">Gestão empresarial</h1><p className="mt-2 max-w-2xl text-sm text-zinc-400">Módulos complementares com persistência no banco, histórico e fluxo de aprovação.</p></div>
        <button onClick={startNew} className="rounded-xl bg-violet-500 px-5 py-3 text-sm font-semibold hover:bg-violet-400">+ Novo registro</button>
      </header>
      {summary && <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Registros ativos" value={summary.total ?? 0}/><Metric label="Aprovações pendentes" value={summary.pendingApprovals ?? 0}/>
        <Metric label="Contas a pagar" value={money(summary.financial?.payable ?? 0)}/><Metric label="Contas a receber" value={money(summary.financial?.receivable ?? 0)}/>
      </section>}
      <section className="mb-5 grid gap-3 rounded-2xl border border-white/10 bg-[#141421] p-4 md:grid-cols-[1fr_1fr_180px]">
        <label className="text-xs text-zinc-400">Módulo<select value={moduleId} onChange={e => setModuleId(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b0b14] p-3 text-sm text-white">{modules.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <label className="text-xs text-zinc-400">Buscar<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Título ou descrição" className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b0b14] p-3 text-sm text-white"/></label>
        <label className="text-xs text-zinc-400">Status<select value={status} onChange={e => setStatus(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b0b14] p-3 text-sm text-white"><option value="">Todos</option>{["rascunho","aguardando_aprovacao","aprovado","rejeitado","em_andamento","concluido","pago","recebido","cancelado"].map(s => <option key={s}>{s}</option>)}</select></label>
      </section>
      {activeModule && <p className="mb-4 text-sm text-zinc-400">{activeModule.description}</p>}
      {message && <div role="status" className="mb-4 rounded-xl border border-violet-400/30 bg-violet-400/10 p-3 text-sm">{message}</div>}
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#141421]">
        <div className="flex items-center justify-between border-b border-white/10 p-4"><h2 className="font-semibold">{activeModule?.label || "Registros"}</h2><button onClick={load} className="text-sm text-violet-300">Atualizar</button></div>
        {busy && <p className="p-5 text-sm text-zinc-400">Carregando…</p>}
        {!busy && items.length === 0 && <p className="p-8 text-center text-sm text-zinc-500">Nenhum registro encontrado neste módulo.</p>}
        <div className="divide-y divide-white/5">{items.map(item => <article key={item.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0"><div className="font-medium">{item.title}</div><div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500"><span className="rounded-full bg-white/5 px-2 py-1">{item.status}</span><span>Atualizado {new Date(item.updatedAt).toLocaleString("pt-BR")}</span></div><pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap break-words text-xs text-zinc-500">{JSON.stringify(item.data, null, 2)}</pre></div>
          <div className="flex shrink-0 flex-wrap gap-2"><button onClick={() => startEdit(item)} className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/5">Editar</button>{!["aprovado","concluido","arquivado"].includes(item.status) && <button onClick={() => action(item.id,"submit")} className="rounded-lg border border-violet-400/30 px-3 py-2 text-xs text-violet-200 hover:bg-violet-400/10">Enviar aprovação</button>}{item.status === "aguardando_aprovacao" && <><button onClick={() => action(item.id,"approve")} className="rounded-lg border border-emerald-400/30 px-3 py-2 text-xs text-emerald-200">Aprovar</button><button onClick={() => action(item.id,"reject")} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs text-red-200">Rejeitar</button></>}<button onClick={() => archive(item)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-400">Arquivar</button></div>
        </article>)}</div>
      </section>
      {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"><section className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-[#141421] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">{editing ? "Editar registro" : "Novo registro"} • {activeModule?.label}</h2><button onClick={() => setShowForm(false)} className="text-zinc-400">Fechar</button></div>
        <label className="block text-xs text-zinc-400">Título<input value={title} onChange={e => setTitle(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b0b14] p-3 text-sm text-white" placeholder="Ex.: Conta de fornecedor"/></label>
        <label className="mt-4 block text-xs text-zinc-400">Dados do módulo (JSON)<textarea value={json} onChange={e => setJson(e.target.value)} rows={15} spellCheck={false} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b0b14] p-3 font-mono text-xs text-white"/></label>
        <div className="mt-3 rounded-xl bg-white/5 p-3 text-xs leading-5 text-zinc-400">Campos obrigatórios para este módulo são validados pelo backend. Consulte README.md para exemplos e regras.</div>
        <div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowForm(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm">Cancelar</button><button disabled={busy || !title.trim()} onClick={save} className="rounded-xl bg-violet-500 px-5 py-2 text-sm font-semibold disabled:opacity-50">{busy ? "Salvando…" : "Salvar registro"}</button></div>
      </section></div>}
    </div>
  </main>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border border-white/10 bg-[#141421] p-4"><div className="text-xs text-zinc-500">{label}</div><div className="mt-2 text-2xl font-bold">{value}</div></div>;
}
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0); }
