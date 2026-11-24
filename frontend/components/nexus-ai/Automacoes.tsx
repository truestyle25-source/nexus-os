'use client';
// NEXUS AI — Fase 06: Inteligência (alertas e insights do monitoramento), Aprovações (ações
// preparadas pela IA aguardando decisão) e Automações (regras ativas e políticas nível 3).
// O backend decide permissões: aqui só aparece o que o usuário pode ver e decidir.
import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, MessageSquare, ShieldAlert, UserX, X } from 'lucide-react';
import { mensagemDeErroApi } from '@/lib/erros-api';
import { formatBRL, formatDateTime } from '@/lib/format';
import { nexusAi, type AprovacaoIA, type AutomacoesIA, type InsightIA } from '@/lib/nexus-ai';

const cartao = 'mt-4 rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)] p-4';
const botao = 'h-9 px-3 rounded-[10px] text-[13px] font-medium inline-flex items-center gap-2 disabled:opacity-50';
const primario = `${botao} bg-[var(--nx-accent)] text-[var(--nx-ink)]`;
const secundario = `${botao} border border-[var(--nx-border)] text-[var(--nx-ink-2)]`;
const filtro = (ativo: boolean) => `h-8 px-3 rounded-full text-[12px] border ${ativo ? 'border-[var(--nx-accent)] text-[var(--nx-ink)] bg-[var(--nx-surface-2)]' : 'border-[var(--nx-border)] text-[var(--nx-ink-3)]'}`;

const COR_SEV: Record<string, string> = { CRITICA: 'var(--nx-danger,#dc2626)', ALTA: '#ea580c', MEDIA: '#ca8a04', BAIXA: 'var(--nx-ink-3)' };
const ROTULO_SEV: Record<string, string> = { CRITICA: 'Crítico', ALTA: 'Alto', MEDIA: 'Médio', BAIXA: 'Baixo' };
const ROTULO_STATUS: Record<string, string> = { PENDENTE: 'Aguardando decisão', EXECUTADA: 'Executada', REJEITADA: 'Rejeitada', FALHOU: 'Falhou', EXPIRADA: 'Expirada' };

/** Alertas que apontam um usuário: dá para preparar o bloqueio (a decisão fica em Aprovações). */
const alvoDoInsight = (i: InsightIA): string | null => {
  const e = (i.evidencias ?? {}) as Record<string, unknown>;
  const id = i.tipo === 'LOGIN_FALHO' ? e.usuarioId : i.tipo === 'PERMISSAO_ALTERADA' ? e.usuarioAlteradoId : i.tipo === 'EXPORTACAO_MASSA' ? e.usuarioId : null;
  return typeof id === 'string' && id !== 'desconhecido' ? id : null;
};

function Aviso({ erro }: { erro: string | null }) {
  return erro ? <p role="alert" className="text-[12px] text-[var(--nx-danger,#dc2626)] mt-2">{erro}</p> : null;
}
function Severidade({ s }: { s: string }) {
  return <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: COR_SEV[s] ?? 'var(--nx-ink-3)' }}>{ROTULO_SEV[s] ?? s}</span>;
}

export function Inteligencia({ onInvestigar }: { onInvestigar: (pergunta: string) => void }) {
  const [status, setStatus] = useState<'ABERTO' | 'LIDO' | 'DESCARTADO' | ''>('');
  const [itens, setItens] = useState<InsightIA[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const carregar = useCallback(() => { setItens(null); nexusAi.insights(status || undefined).then(setItens).catch((e) => { setItens([]); setErro(mensagemDeErroApi(e, 'Não foi possível carregar os alertas.')); }); }, [status]);
  useEffect(carregar, [carregar]);
  async function proporBloqueio(i: InsightIA) {
    setErro(null); setAviso(null);
    try { const a = await nexusAi.proporBloqueio(i.id); setAviso(`${a.titulo}: proposta aguardando decisão na tela Aprovações. Nada foi alterado ainda.`); }
    catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível preparar o bloqueio.')); }
  }
  async function marcar(i: InsightIA, s: 'LIDO' | 'DESCARTADO') {
    setErro(null);
    try { await nexusAi.marcarInsight(i.id, s); carregar(); } catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível atualizar.')); }
  }
  return (
    <div className={cartao}>
      <p className="text-[13px] text-[var(--nx-ink-2)]">Alertas do monitoramento de segurança e descobertas diárias. A detecção é feita por regras fixas do sistema e funciona mesmo com a IA fora do ar.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {([['', 'Abertos e lidos'], ['ABERTO', 'Abertos'], ['LIDO', 'Lidos'], ['DESCARTADO', 'Descartados']] as const).map(([v, r]) => <button key={v} type="button" onClick={() => setStatus(v)} className={filtro(status === v)}>{r}</button>)}
      </div>
      <Aviso erro={erro} />
      {aviso && <p role="status" className="text-[12px] text-[var(--nx-ink-2)] mt-2">{aviso}</p>}
      {itens === null ? <p className="mt-4 text-[13px] text-[var(--nx-ink-3)]">Carregando…</p> : itens.length === 0 ? <p className="mt-4 text-[13px] text-[var(--nx-ink-3)]">Nenhum alerta por aqui.</p> : (
        <ul className="mt-4 divide-y divide-[var(--nx-border)]">
          {itens.map((i) => (
            <li key={i.id} className="py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Severidade s={i.severidade} />
                <span className="text-[11px] text-[var(--nx-ink-3)]">{i.origem === 'MONITOR' ? 'Monitoramento' : 'Rotina diária'} · {formatDateTime(i.createdAt)}{i.status !== 'ABERTO' ? ` · ${i.status === 'LIDO' ? 'lido' : 'descartado'}` : ''}</span>
              </div>
              <p className="mt-1 text-[13px] text-[var(--nx-ink)] break-words">{i.titulo}</p>
              <p className="text-[12px] text-[var(--nx-ink-2)] break-words">{i.descricao}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={secundario} onClick={() => onInvestigar(`Investigue este alerta e diga o que verificar: ${i.titulo}. ${i.descricao}`)}><MessageSquare className="w-4 h-4" />Investigar com a IA</button>
                {alvoDoInsight(i) && i.status !== 'DESCARTADO' && <button type="button" className={secundario} onClick={() => void proporBloqueio(i)}><UserX className="w-4 h-4" />Preparar bloqueio do usuário</button>}
                {i.status === 'ABERTO' && <button type="button" className={secundario} onClick={() => void marcar(i, 'LIDO')}><Check className="w-4 h-4" />Marcar como lido</button>}
                {i.status !== 'DESCARTADO' && <button type="button" className={secundario} onClick={() => void marcar(i, 'DESCARTADO')}><X className="w-4 h-4" />Descartar</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Aprovacoes() {
  const [status, setStatus] = useState<string>('PENDENTE');
  const [itens, setItens] = useState<AprovacaoIA[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => { setItens(null); nexusAi.aprovacoes(status || undefined).then(setItens).catch((e) => { setItens([]); setErro(mensagemDeErroApi(e, 'Não foi possível carregar as aprovações.')); }); }, [status]);
  useEffect(carregar, [carregar]);
  async function decidir(a: AprovacaoIA, d: 'aprovar' | 'rejeitar') {
    setErro(null); setOcupado(a.id);
    try {
      const r = await nexusAi.decidir(a.id, d);
      if (r.status === 'FALHOU') setErro(`A ação falhou e nada foi alterado: ${r.erro ?? 'erro desconhecido'}`);
      carregar();
    } catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível registrar a decisão.')); } finally { setOcupado(null); }
  }
  return (
    <div className={cartao}>
      <p className="text-[13px] text-[var(--nx-ink-2)]">Ações que a NEXUS AI preparou e que só acontecem depois da sua aprovação. Aprovar duas vezes não executa duas vezes.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {([['PENDENTE', 'Aguardando'], ['EXECUTADA', 'Executadas'], ['REJEITADA', 'Rejeitadas'], ['', 'Todas']] as const).map(([v, r]) => <button key={v} type="button" onClick={() => setStatus(v)} className={filtro(status === v)}>{r}</button>)}
      </div>
      <Aviso erro={erro} />
      {itens === null ? <p className="mt-4 text-[13px] text-[var(--nx-ink-3)]">Carregando…</p> : itens.length === 0 ? <p className="mt-4 text-[13px] text-[var(--nx-ink-3)]">Nenhuma proposta {status === 'PENDENTE' ? 'aguardando decisão' : 'neste filtro'}. Peça à IA, por exemplo: “prepare a compra do que vai faltar esta semana”.</p> : (
        <ul className="mt-4 divide-y divide-[var(--nx-border)]">
          {itens.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--nx-ink-3)]">
                <span className="font-medium uppercase tracking-wide" style={{ color: a.status === 'PENDENTE' ? '#ca8a04' : a.status === 'EXECUTADA' ? 'var(--nx-ok,#16a34a)' : 'var(--nx-ink-3)' }}>{ROTULO_STATUS[a.status] ?? a.status}</span>
                <span>{formatDateTime(a.createdAt)}</span>
                {a.nivel === 3 && <span>· executada pela política de automação</span>}
              </div>
              <p className="mt-1 text-[13px] text-[var(--nx-ink)] break-words">{a.titulo}{a.valorCentavos != null ? ` — ${formatBRL(a.valorCentavos / 100)}` : ''}</p>
              {a.impacto && <p className="text-[12px] text-[var(--nx-ink-2)] break-words">{a.impacto}</p>}
              {typeof a.proposta?.motivo === 'string' && a.proposta.motivo && <p className="text-[12px] text-[var(--nx-ink-3)] break-words">Motivo: {a.proposta.motivo}</p>}
              {a.status === 'EXECUTADA' && a.resultado?.numero != null && <p className="text-[12px] text-[var(--nx-ink-2)]">Pedido CP-{String(a.resultado.numero).padStart(6, '0')} criado em rascunho no módulo Compras.</p>}
              {a.status === 'EXECUTADA' && a.acao === 'ajustar_estoque_minimo' && <p className="text-[12px] text-[var(--nx-ink-2)]">Estoque mínimo alterado de {String(a.resultado?.anterior)} para {String(a.resultado?.estoqueMinimo)}.</p>}
              {a.status === 'EXECUTADA' && a.acao === 'bloquear_usuario' && <p className="text-[12px] text-[var(--nx-ink-2)]">Usuário bloqueado e sessões encerradas. Para desfazer, reative-o no módulo Usuários.</p>}
              {a.status === 'REJEITADA' && a.motivo && <p className="text-[12px] text-[var(--nx-ink-3)]">Motivo da rejeição: {a.motivo}</p>}
              {a.status === 'FALHOU' && <p className="text-[12px] text-[var(--nx-danger,#dc2626)] break-words">Falhou, nada foi alterado: {a.erro}</p>}
              {a.status === 'PENDENTE' && (a.podeDecidir ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={ocupado === a.id} className={primario} onClick={() => void decidir(a, 'aprovar')}>{ocupado === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Aprovar e executar</button>
                  <button type="button" disabled={ocupado === a.id} className={secundario} onClick={() => void decidir(a, 'rejeitar')}><X className="w-4 h-4" />Rejeitar</button>
                </div>
              ) : <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">Você não tem permissão para decidir esta proposta.</p>)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Automacoes() {
  const [dados, setDados] = useState<AutomacoesIA | null>(null);
  const [limites, setLimites] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => { nexusAi.automacoes().then((d) => { setDados(d); setLimites(Object.fromEntries(d.acoes.map((a) => [a.acao, a.valorMaxCentavos != null ? String(a.valorMaxCentavos / 100) : '']))); }).catch((e) => setErro(mensagemDeErroApi(e, 'Não foi possível carregar as automações.'))); }, []);
  useEffect(carregar, [carregar]);
  async function salvar(acao: string, ativa: boolean) {
    setErro(null);
    const v = (limites[acao] ?? '').replace(',', '.').trim();
    const valorMaxCentavos = v ? Math.round(Number(v) * 100) : null;
    if (v && !Number.isFinite(valorMaxCentavos)) { setErro('Valor máximo inválido.'); return; }
    try { await nexusAi.salvarAutomacao(acao, { ativa, valorMaxCentavos }); carregar(); } catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível salvar.')); }
  }
  if (!dados) return <div className={cartao}>{erro ? <Aviso erro={erro} /> : <p className="text-[13px] text-[var(--nx-ink-3)]">Carregando…</p>}</div>;
  return (
    <>
      <div className={cartao}>
        <p className="text-[13px] text-[var(--nx-ink)] inline-flex items-center gap-2"><ShieldAlert className="w-4 h-4" />Monitoramento de segurança — sempre ativo</p>
        <p className="text-[12px] text-[var(--nx-ink-2)] mt-1">Regras fixas verificadas a cada poucos minutos. Cada fato gera um único alerta.{dados.filaPendente ? ` ${dados.filaPendente} evento(s) na fila.` : ''}</p>
        <ul className="mt-3 divide-y divide-[var(--nx-border)]">
          {dados.regras.map((r) => (
            <li key={r.tipo} className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-[13px] text-[var(--nx-ink)]">{r.nome} <Severidade s={r.severidade} /></p><p className="text-[12px] text-[var(--nx-ink-3)] break-words">{r.regra}</p></div>
              <span className="shrink-0 text-[12px] text-[var(--nx-ink-2)]">{r.eventos7dias} em 7 dias</span>
            </li>
          ))}
          <li className="py-2 flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="text-[13px] text-[var(--nx-ink)]">Descobertas diárias</p><p className="text-[12px] text-[var(--nx-ink-3)] break-words">{dados.insightsDiarios.regra}</p></div>
            <span className="shrink-0 text-[12px] text-[var(--nx-ink-2)]">{dados.insightsDiarios.eventos7dias} em 7 dias</span>
          </li>
        </ul>
      </div>
      <div className={cartao}>
        <p className="text-[13px] text-[var(--nx-ink)]">Qualidade das respostas (30 dias)</p>
        <p className="text-[12px] text-[var(--nx-ink-2)] mt-1">{dados.avaliacoes.corretas} marcada(s) como correta e {dados.avaliacoes.incorretas} como incorreta pelos usuários.</p>
        {dados.avaliacoes.ultimasIncorretas && dados.avaliacoes.ultimasIncorretas.length > 0 && (
          <ul className="mt-3 divide-y divide-[var(--nx-border)]">
            {dados.avaliacoes.ultimasIncorretas.map((i) => (
              <li key={i.id} className="py-2">
                <p className="text-[13px] text-[var(--nx-ink)] break-words">{i.pergunta}</p>
                <p className="text-[11px] text-[var(--nx-ink-3)] break-words">{formatDateTime(i.quando)} · agente {i.agente}{i.comentario ? ` · "${i.comentario}"` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={cartao}>
        <p className="text-[13px] text-[var(--nx-ink)]">Execução automática (nível 3) — desligada por padrão</p>
        <p className="text-[12px] text-[var(--nx-ink-3)] mt-1">Bloquear usuário e ajustar estoque mínimo sempre exigem aprovação humana e não podem ser automatizados.</p>
        <p className="text-[12px] text-[var(--nx-ink-2)] mt-1">Com a política ligada, propostas até o valor máximo são executadas sem esperar aprovação, se quem pediu tiver a permissão da ação. Acima do valor, continuam aguardando. Alterar exige permissão de administrar a IA.</p>
        <Aviso erro={erro} />
        <ul className="mt-3 divide-y divide-[var(--nx-border)]">
          {dados.acoes.map((a) => (
            <li key={a.acao} className="py-3">
              <p className="text-[13px] text-[var(--nx-ink)]">{a.nome} <span className="text-[11px] text-[var(--nx-ink-3)]">({a.ativa ? 'ligada' : 'desligada'})</span></p>
              <p className="text-[12px] text-[var(--nx-ink-3)] break-words">{a.descricao} Permissão exigida: {a.permissao}.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-[12px] text-[var(--nx-ink-2)] inline-flex items-center gap-2">Valor máximo (R$)
                  <input inputMode="decimal" value={limites[a.acao] ?? ''} onChange={(e) => setLimites({ ...limites, [a.acao]: e.target.value })} aria-label={`Valor máximo para ${a.nome}`} className="h-9 w-28 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-2 text-[13px] text-[var(--nx-ink)] focus:outline-none focus:border-[var(--nx-accent)]" />
                </label>
                {a.ativa
                  ? <><button type="button" className={secundario} onClick={() => void salvar(a.acao, true)}>Salvar limite</button><button type="button" className={secundario} onClick={() => void salvar(a.acao, false)}>Desligar</button></>
                  : <button type="button" className={primario} onClick={() => void salvar(a.acao, true)}>Ligar</button>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
