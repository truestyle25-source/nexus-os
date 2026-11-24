'use client';
// Central NEXUS AI — Conversar e Histórico (Fase 02). Toda resposta mostra as fontes (ferramentas
// consultadas), se os números foram conferidos com os dados e as limitações. Visual nos tokens
// --nx-* do sistema (mesma linguagem da Central de Integrações).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, History, Loader2, MessageSquarePlus, RefreshCw, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { mensagemDeErroApi } from '@/lib/erros-api';
import { formatDateTime } from '@/lib/format';
import { nexusAi, NOME_FERRAMENTA, novaChaveIA, type AgenteIA, type ConsumoIA, type MensagemIA, type ResultadoIA } from '@/lib/nexus-ai';

type Aba = 'conversar' | 'historico';
const SUGESTOES: Record<string, string[]> = {
  estoque: ['Quais produtos estão abaixo do mínimo?', 'Quais produtos estão em ruptura nos últimos 30 dias?', 'O que está parado há 60 dias e quanto vale?', 'Quanto devo repor para cobrir 15 dias?'],
  geral: ['Me dê um resumo da empresa nos últimos 30 dias.'],
};

function Detalhes({ d }: { d: ResultadoIA['detalhes'] }) {
  if (!d) return null;
  const fontes = [...new Set(d.fontes.map((f) => NOME_FERRAMENTA[f.ferramenta] ?? f.ferramenta))];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--nx-ink-3)]">
      {d.verificacao && (d.verificacao.aprovada
        ? <span className="inline-flex items-center gap-1 text-[var(--nx-green)]"><ShieldCheck className="w-3.5 h-3.5" />{d.verificacao.numeros.length ? `${d.verificacao.numeros.length} número(s) conferido(s) com os dados` : 'Resposta verificada'}</span>
        : <span className="inline-flex items-center gap-1 text-[var(--nx-amber)]"><AlertTriangle className="w-3.5 h-3.5" />Números não confirmados</span>)}
      {fontes.length > 0 && <span>Fontes: {fontes.join(' · ')}</span>}
    </div>
  );
}

export default function NexusAiPage() {
  const [aba, setAba] = useState<Aba>('conversar');
  const [agentes, setAgentes] = useState<AgenteIA[]>([]);
  const [provedorOk, setProvedorOk] = useState(true);
  const [agente, setAgente] = useState('estoque');
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<MensagemIA[]>([]);
  const [pergunta, setPergunta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [consumo, setConsumo] = useState<ConsumoIA | null>(null);
  const [conversas, setConversas] = useState<{ id: string; titulo: string; updatedAt: string }[] | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  const carregarConsumo = useCallback(() => { nexusAi.consumo().then(setConsumo).catch(() => {}); }, []);
  useEffect(() => {
    nexusAi.agentes().then((r) => {
      setAgentes(r.agentes); setProvedorOk(r.provedor.configurado && !r.provedor.circuito.aberto);
      setAgente((a) => (r.agentes.find((x) => x.id === a && x.disponivel) ? a : r.agentes.find((x) => x.disponivel)?.id ?? a));
    }).catch((e) => setErro(mensagemDeErroApi(e, 'Não foi possível carregar a NEXUS AI.')));
    carregarConsumo();
  }, [carregarConsumo]);
  useEffect(() => { fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [mensagens, enviando]);
  useEffect(() => { if (aba === 'historico') nexusAi.conversas().then(setConversas).catch(() => setConversas([])); }, [aba]);

  async function enviar(texto?: string) {
    const q = (texto ?? pergunta).trim();
    if (!q || enviando) return;
    setErro(null); setEnviando(true); setPergunta('');
    setMensagens((m) => [...m, { id: `u-${Date.now()}`, papel: 'USUARIO', conteudo: q, detalhes: null, execucaoId: null, createdAt: new Date().toISOString() }]);
    try {
      const r = await nexusAi.perguntar({ pergunta: q, agente, ...(conversaId ? { conversaId } : {}), idempotencyKey: novaChaveIA() });
      if (r.conversaId) setConversaId(r.conversaId);
      setMensagens((m) => [...m, { id: r.execucaoId, papel: 'NEXUS', conteudo: r.resposta ?? '', detalhes: r.detalhes, execucaoId: r.status === 'AGUARDANDO_PROVEDOR' ? r.execucaoId : null, createdAt: new Date().toISOString() }]);
    } catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível consultar a NEXUS AI.')); }
    finally { setEnviando(false); carregarConsumo(); }
  }

  async function retomar(execucaoId: string) {
    setEnviando(true); setErro(null);
    try {
      const r = await nexusAi.retomar(execucaoId);
      setMensagens((m) => m.map((x) => (x.execucaoId === execucaoId ? { ...x, conteudo: r.resposta ?? x.conteudo, detalhes: r.detalhes, execucaoId: r.status === 'AGUARDANDO_PROVEDOR' ? execucaoId : null } : x)));
    } catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível retomar.')); } finally { setEnviando(false); carregarConsumo(); }
  }

  async function abrirConversa(id: string) {
    try { const c = await nexusAi.conversa(id); setConversaId(c.id); setMensagens(c.mensagens); setAba('conversar'); }
    catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível abrir a conversa.')); }
  }

  const agenteAtual = agentes.find((a) => a.id === agente);
  return (
    <div className="min-h-full bg-[var(--nx-canvas)] px-4 lg:px-8 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold text-[var(--nx-ink)] inline-flex items-center gap-2"><Sparkles className="w-6 h-6 text-[var(--nx-accent)]" />NEXUS AI</h1>
          <p className="mt-1 text-[13px] text-[var(--nx-ink-2)]">Inteligência empresarial sobre os dados reais da sua empresa. Toda resposta mostra de onde vieram os números.</p>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <span className={`inline-flex items-center gap-1.5 ${provedorOk ? 'text-[var(--nx-green)]' : 'text-[var(--nx-amber)]'}`}><span className="w-1.5 h-1.5 rounded-full bg-current" />{provedorOk ? 'Conectada' : 'Provedor indisponível'}</span>
          {consumo && <span className={consumo.bloqueado || consumo.alerta ? 'text-[var(--nx-amber)]' : 'text-[var(--nx-ink-3)]'} title={`${consumo.uso.execucoes} de ${consumo.limites.execucoesMes} investigações no mês`}>Uso do mês: {consumo.percentual}%</span>}
        </div>
      </div>

      <div className="mt-5 flex gap-4 border-b border-[var(--nx-border)]" role="tablist">
        {([['conversar', 'Conversar', Bot], ['historico', 'Histórico', History]] as const).map(([id, rot, Ic]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className={`h-10 inline-flex items-center gap-1.5 text-[13px] font-medium border-b-2 ${aba === id ? 'border-[var(--nx-accent)] text-[var(--nx-ink)]' : 'border-transparent text-[var(--nx-ink-3)] hover:text-[var(--nx-ink-2)]'}`}><Ic className="w-4 h-4" />{rot}</button>
        ))}
      </div>

      {erro && <p role="alert" className="mt-4 rounded-[10px] border border-[color-mix(in_srgb,var(--nx-amber)_40%,var(--nx-border))] px-3 py-2 text-[12px] text-[var(--nx-amber)]">{erro}</p>}
      {consumo?.bloqueado && <p role="alert" className="mt-4 rounded-[10px] border border-[color-mix(in_srgb,var(--nx-amber)_40%,var(--nx-border))] px-3 py-2 text-[12px] text-[var(--nx-amber)]">{consumo.motivo} O restante do NEXUS OS continua funcionando normalmente.</p>}

      {aba === 'conversar' ? (
        <div className="mt-4 flex flex-col rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)] min-h-[60vh]">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--nx-border)]">
            <label className="text-[12px] text-[var(--nx-ink-2)]">Especialista</label>
            <select value={agente} onChange={(e) => { setAgente(e.target.value); setConversaId(null); setMensagens([]); }} aria-label="Especialista" className="h-9 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[13px] text-[var(--nx-ink)]">
              {agentes.map((a) => <option key={a.id} value={a.id} disabled={!a.disponivel}>{a.nome}{a.disponivel ? '' : ' (sem permissão)'}</option>)}
            </select>
            {agenteAtual && <span className="text-[11px] text-[var(--nx-ink-3)] hidden sm:inline">{agenteAtual.descricao}</span>}
            <button type="button" onClick={() => { setConversaId(null); setMensagens([]); }} className="ml-auto h-9 px-3 rounded-[10px] border border-[var(--nx-border)] text-[12px] text-[var(--nx-ink-2)] inline-flex items-center gap-1.5 hover:border-[var(--nx-border-strong)]"><MessageSquarePlus className="w-4 h-4" />Nova conversa</button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" aria-live="polite">
            {mensagens.length === 0 && (
              <div className="py-6">
                <p className="text-[15px] font-semibold text-[var(--nx-ink)]">O que você gostaria de investigar?</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(SUGESTOES[agente] ?? []).map((s) => <button key={s} type="button" onClick={() => void enviar(s)} disabled={enviando || !agenteAtual?.disponivel} className="rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 py-1.5 text-[12px] text-[var(--nx-ink-2)] hover:border-[var(--nx-border-strong)] disabled:opacity-40">{s}</button>)}
                </div>
              </div>
            )}
            {mensagens.map((m) => (
              <div key={m.id} className={m.papel === 'USUARIO' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[92%] sm:max-w-[80%] rounded-[14px] px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${m.papel === 'USUARIO' ? 'bg-[var(--nx-accent)] text-[var(--nx-ink)]' : 'bg-[var(--nx-surface-2)] border border-[var(--nx-border)] text-[var(--nx-ink)]'}`}>
                  {m.conteudo.replace(/\*\*/g, '').replace(/`/g, '').replace(/^(\s*)\* /gm, '$1• ')}
                  {m.papel === 'NEXUS' && <Detalhes d={m.detalhes} />}
                  {m.papel === 'NEXUS' && m.execucaoId && <button type="button" onClick={() => void retomar(m.execucaoId!)} disabled={enviando} className="mt-2 h-8 px-3 rounded-[10px] border border-[var(--nx-border)] text-[12px] inline-flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" />Retomar investigação</button>}
                </div>
              </div>
            ))}
            {enviando && <div className="inline-flex items-center gap-2 text-[12px] text-[var(--nx-ink-3)]"><Loader2 className="w-4 h-4 animate-spin" />Consultando os dados da empresa…</div>}
            <div ref={fim} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); void enviar(); }} className="flex gap-2 px-4 py-3 border-t border-[var(--nx-border)]">
            <input value={pergunta} onChange={(e) => setPergunta(e.target.value)} maxLength={2000} placeholder="Pergunte sobre a sua empresa…" aria-label="Pergunta para a NEXUS AI" disabled={enviando || !agenteAtual?.disponivel || consumo?.bloqueado} className="flex-1 min-w-0 h-11 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[13px] text-[var(--nx-ink)] placeholder:text-[var(--nx-ink-3)] focus:outline-none focus:border-[var(--nx-accent)]" />
            <button type="submit" disabled={enviando || !pergunta.trim() || !agenteAtual?.disponivel || consumo?.bloqueado} className="h-11 px-4 rounded-[10px] bg-[var(--nx-accent)] text-[13px] font-medium text-[var(--nx-ink)] inline-flex items-center gap-2 disabled:opacity-50"><Send className="w-4 h-4" /><span className="hidden sm:inline">Perguntar</span></button>
          </form>
        </div>
      ) : (
        <div className="mt-4 rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)] p-4">
          {conversas === null ? <p className="text-[13px] text-[var(--nx-ink-3)]">Carregando…</p> : conversas.length === 0 ? <p className="text-[13px] text-[var(--nx-ink-3)]">Nenhuma conversa ainda.</p> : (
            <ul className="divide-y divide-[var(--nx-border)]">
              {conversas.map((c) => (
                <li key={c.id}><button type="button" onClick={() => void abrirConversa(c.id)} className="w-full text-left py-3 flex items-center justify-between gap-3 hover:opacity-80"><span className="text-[13px] text-[var(--nx-ink)] truncate">{c.titulo}</span><span className="text-[11px] text-[var(--nx-ink-3)] shrink-0 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{formatDateTime(c.updatedAt)}</span></button></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
