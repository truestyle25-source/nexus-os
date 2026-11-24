'use client';
// NEXUS AI — Memória empresarial e Documentos (Fase 04). Leitura para quem usa a IA;
// gravar/excluir exige ia.administrar (o backend recusa com 403 e a mensagem aparece aqui).
import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import { mensagemDeErroApi } from '@/lib/erros-api';
import { formatDateTime } from '@/lib/format';
import { nexusAi, TIPOS_MEMORIA, type DocumentoIA, type MemoriaIA } from '@/lib/nexus-ai';

const campo = 'w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[13px] text-[var(--nx-ink)] placeholder:text-[var(--nx-ink-3)] focus:outline-none focus:border-[var(--nx-accent)]';
const botao = 'h-10 px-4 rounded-[10px] bg-[var(--nx-accent)] text-[13px] font-medium text-[var(--nx-ink)] inline-flex items-center gap-2 disabled:opacity-50';
const cartao = 'mt-4 rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)] p-4';

function Aviso({ erro }: { erro: string | null }) {
  return erro ? <p role="alert" className="text-[12px] text-[var(--nx-danger,#dc2626)] mt-2">{erro}</p> : null;
}

export function MemoriaEmpresa() {
  const [itens, setItens] = useState<MemoriaIA[] | null>(null);
  const [form, setForm] = useState({ tipo: 'META', titulo: '', conteudo: '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => { nexusAi.memoria().then(setItens).catch((e) => { setItens([]); setErro(mensagemDeErroApi(e, 'Não foi possível carregar a memória.')); }); }, []);
  useEffect(carregar, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setSalvando(true); setErro(null);
    try { await nexusAi.salvarMemoria(form); setForm({ tipo: form.tipo, titulo: '', conteudo: '' }); carregar(); }
    catch (er) { setErro(mensagemDeErroApi(er, 'Não foi possível salvar.')); } finally { setSalvando(false); }
  }
  async function excluir(id: string) {
    setErro(null);
    try { await nexusAi.excluirMemoria(id); carregar(); } catch (er) { setErro(mensagemDeErroApi(er, 'Não foi possível excluir.')); }
  }

  return (
    <div className={cartao}>
      <p className="text-[13px] text-[var(--nx-ink-2)]">Metas, políticas e critérios que a NEXUS AI considera nas análises. Escreva só a informação da empresa.</p>
      <form onSubmit={salvar} className="mt-3 grid gap-2 sm:grid-cols-[160px_1fr]">
        <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} aria-label="Tipo" className={`${campo} h-10`}>
          {TIPOS_MEMORIA.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} maxLength={120} placeholder="Título (ex.: Margem mínima)" aria-label="Título" className={`${campo} h-10`} />
        <textarea value={form.conteudo} onChange={(e) => setForm({ ...form, conteudo: e.target.value })} maxLength={2000} rows={2} placeholder="Conteúdo (ex.: A margem bruta mínima aceitável é 35%.)" aria-label="Conteúdo" className={`${campo} py-2 sm:col-span-2`} />
        <div className="sm:col-span-2"><button type="submit" disabled={salvando || form.titulo.trim().length < 2 || form.conteudo.trim().length < 2} className={botao}>{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Adicionar</button></div>
      </form>
      <Aviso erro={erro} />
      {itens === null ? <p className="mt-4 text-[13px] text-[var(--nx-ink-3)]">Carregando…</p> : itens.length === 0 ? <p className="mt-4 text-[13px] text-[var(--nx-ink-3)]">Nenhum item na memória.</p> : (
        <ul className="mt-4 divide-y divide-[var(--nx-border)]">
          {itens.map((m) => (
            <li key={m.id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] text-[var(--nx-ink)]"><span className="text-[11px] uppercase tracking-wide text-[var(--nx-ink-3)] mr-2">{TIPOS_MEMORIA.find(([v]) => v === m.tipo)?.[1] ?? m.tipo}</span>{m.titulo}</p>
                <p className="text-[12px] text-[var(--nx-ink-2)] break-words">{m.conteudo}</p>
              </div>
              <button type="button" onClick={() => void excluir(m.id)} aria-label={`Excluir ${m.titulo}`} className="shrink-0 p-2 text-[var(--nx-ink-3)] hover:text-[var(--nx-ink)]"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DocumentosEmpresa() {
  const [docs, setDocs] = useState<DocumentoIA[] | null>(null);
  const [form, setForm] = useState({ titulo: '', conteudo: '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => { nexusAi.documentos().then(setDocs).catch((e) => { setDocs([]); setErro(mensagemDeErroApi(e, 'Não foi possível carregar os documentos.')); }); }, []);
  useEffect(carregar, [carregar]);

  async function lerArquivo(f: File | undefined) {
    if (!f) return;
    if (f.size > 1_500_000) { setErro('Arquivo grande demais (máximo 1,5 MB de texto).'); return; }
    const texto = await f.text();
    setForm({ titulo: form.titulo || f.name.replace(/\.[^.]+$/, ''), conteudo: texto });
  }
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setSalvando(true); setErro(null);
    try { await nexusAi.adicionarDocumento(form); setForm({ titulo: '', conteudo: '' }); carregar(); }
    catch (er) { setErro(mensagemDeErroApi(er, 'Não foi possível adicionar.')); } finally { setSalvando(false); }
  }
  async function excluir(id: string) {
    setErro(null);
    try { await nexusAi.excluirDocumento(id); carregar(); } catch (er) { setErro(mensagemDeErroApi(er, 'Não foi possível excluir.')); }
  }

  return (
    <div className={cartao}>
      <p className="text-[13px] text-[var(--nx-ink-2)]">Manuais, procedimentos e políticas em texto. A NEXUS AI busca os trechos relevantes e cita o documento.</p>
      <form onSubmit={salvar} className="mt-3 grid gap-2">
        <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} maxLength={200} placeholder="Título do documento" aria-label="Título do documento" className={`${campo} h-10`} />
        <textarea value={form.conteudo} onChange={(e) => setForm({ ...form, conteudo: e.target.value })} rows={5} placeholder="Cole o texto aqui ou escolha um arquivo .txt / .md" aria-label="Texto do documento" className={`${campo} py-2`} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="h-10 px-3 rounded-[10px] border border-[var(--nx-border)] text-[13px] text-[var(--nx-ink-2)] inline-flex items-center gap-2 cursor-pointer"><FileText className="w-4 h-4" />Arquivo de texto<input type="file" accept=".txt,.md,text/plain,text/markdown" className="sr-only" onChange={(e) => void lerArquivo(e.target.files?.[0])} /></label>
          <button type="submit" disabled={salvando || form.titulo.trim().length < 2 || form.conteudo.trim().length < 20} className={botao}>{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Adicionar</button>
        </div>
      </form>
      <Aviso erro={erro} />
      {docs === null ? <p className="mt-4 text-[13px] text-[var(--nx-ink-3)]">Carregando…</p> : docs.length === 0 ? <p className="mt-4 text-[13px] text-[var(--nx-ink-3)]">Nenhum documento ainda.</p> : (
        <ul className="mt-4 divide-y divide-[var(--nx-border)]">
          {docs.map((d) => (
            <li key={d.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] text-[var(--nx-ink)] truncate">{d.titulo}</p>
                <p className="text-[11px] text-[var(--nx-ink-3)]">{d.trechos} trechos · {d.caracteres.toLocaleString('pt-BR')} caracteres · {formatDateTime(d.createdAt)}</p>
              </div>
              <button type="button" onClick={() => void excluir(d.id)} aria-label={`Excluir ${d.titulo}`} className="shrink-0 p-2 text-[var(--nx-ink-3)] hover:text-[var(--nx-ink)]"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
