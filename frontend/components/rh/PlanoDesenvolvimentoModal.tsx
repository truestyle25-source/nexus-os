'use client';

/**
 * Modal de Plano de Desenvolvimento DISC — Ciclo 1.
 *
 * É o ÚNICO ponto de criação de plano, e é usado em dois lugares já
 * existentes: Relatórios → DISC e Radar → Perfil DISC. Um componente só,
 * porque duas telas fazendo o mesmo trabalho divergem: a segunda que passa a
 * exigir o campo que a primeira não tinha.
 *
 * PRINCÍPIOS QUE ESTE MODAL RESPETA
 * ---------------------------------
 *  - A IA SUGERE, O GESTOR DECIDE. A sugestão chega num painel separado, com
 *    cada item marcado como aceito ou recusado. Nada é gravado automaticamente
 *    e não existe botão "aplicar tudo": o gestor monta o plano, e o que ele
 *    não quiser simplesmente não entra.
 *
 *  - NENHUMA AÇÃO NASCE CONCLUÍDA. Este é o bug do `PlanoModal` antigo, que
 *    usava `useState<number[]>([0, 1])` e gravava as duas primeiras ações como
 *    feitas antes de o gestor clicar em qualquer coisa. Aqui o estado inicial é
 *    `[]`, e o backend rejeita `concluida` que não seja `true` explícito.
 *
 *  - O PERFIL E OS PERCENTUAIS NÃO SAEM DA IA NEM DO NAVEGADOR. São exibidos
 *    apenas para contexto, e o corpo enviado não os carrega: o servidor lê da
 *    avaliação e monta o snapshot. Se a IA "sugerisse" um D 90%, não haveria
 *    campo onde isso coubesse.
 *
 *  - SEM IA, O FORMULÁRIO CONTINUA INTEIRO. Se a chamada falhar, a tela diz o
 *    que houve e o gestor monta o plano à mão. Nenhum campo é desabilitado por
 *    falta de sugestão.
 *
 *  - A IA NÃO DIAGNOSTICA E NÃO DECIDE. O texto padrão do painel diz isso, e
 *    o `maxLength` impede que a sugestão vire laudo colado no plano.
 */
import { useCallback, useMemo, useState } from 'react';
import api from '@/lib/api';

type FatorDisc = 'D' | 'I' | 'S' | 'C';

const OBJETIVOS = [
  'COMUNICACAO', 'LIDERANCA', 'ORGANIZACAO', 'TRABALHO_EM_EQUIPE',
  'GESTAO_DE_CONFLITOS', 'ATENDIMENTO', 'OUTRO',
] as const;
const COMPETENCIAS = [
  'COMUNICACAO', 'LIDERANCA', 'ORGANIZACAO', 'TRABALHO_EM_EQUIPE',
  'GESTAO_DE_CONFLITOS', 'ATENDIMENTO', 'PROATIVIDADE', 'ADAPTABILIDADE', 'OUTRO',
] as const;
const TIPOS_ACAO = [
  'TREINAMENTO', 'ACOMPANHAMENTO', 'FEEDBACK', 'EXERCICIO_PRATICO', 'MENTORIA', 'OUTRO',
] as const;
const STATUS = ['PLANEJADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO'] as const;

type Objetivo = (typeof OBJETIVOS)[number];
type Competencia = (typeof COMPETENCIAS)[number];
type TipoAcao = (typeof TIPOS_ACAO)[number];
type Status = (typeof STATUS)[number];

const ROTULO_OBJETIVO: Record<string, string> = {
  COMUNICACAO: 'Comunicação', LIDERANCA: 'Liderança', ORGANIZACAO: 'Organização',
  TRABALHO_EM_EQUIPE: 'Trabalho em equipe', GESTAO_DE_CONFLITOS: 'Gestão de conflitos',
  ATENDIMENTO: 'Atendimento', OUTRO: 'Outro',
};
const ROTULO_COMPETENCIA: Record<string, string> = {
  ...ROTULO_OBJETIVO, PROATIVIDADE: 'Proatividade', ADAPTABILIDADE: 'Adaptabilidade',
};
const ROTULO_ACAO: Record<string, string> = {
  TREINAMENTO: 'Treinamento', ACOMPANHAMENTO: 'Acompanhamento', FEEDBACK: 'Feedback',
  EXERCICIO_PRATICO: 'Exercício prático', MENTORIA: 'Mentoria', OUTRO: 'Outra',
};
const ROTULO_STATUS: Record<string, string> = {
  PLANEJADO: 'Planejado', EM_ANDAMENTO: 'Em andamento', CONCLUIDO: 'Concluído', CANCELADO: 'Cancelado',
};

const CORES: Record<FatorDisc, string> = { D: 'var(--nx-red)', I: 'var(--nx-amber)', S: 'var(--nx-green)', C: 'var(--nx-accent)' };

type AcaoRascunho = { tipo: TipoAcao; descricao: string; concluida: boolean };

type Props = {
  /** Avaliação DISC que originou o plano. Vem da tela de quem abriu o modal. */
  funcionarioId: string;
  funcionarioNome: string;
  avaliacaoId: string;
  perfil: FatorDisc | null;
  scores: { D?: number; I?: number; S?: number; C?: number } | null;
  aoFechar: () => void;
  aoSalvar: (plano: { id: string }) => void;
};

const hojeIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function PlanoDesenvolvimentoModal({
  funcionarioId, funcionarioNome, avaliacaoId, perfil, scores, aoFechar, aoSalvar,
}: Props) {
  const [objetivo, setObjetivo] = useState<Objetivo>('COMUNICACAO');
  const [competencia, setCompetencia] = useState<Competencia>('COMUNICACAO');
  const [descricao, setDescricao] = useState('');
  const [acoes, setAcoes] = useState<AcaoRascunho[]>([]);
  const [dataInicio, setDataInicio] = useState(hojeIso);
  const [prazo, setPrazo] = useState('');
  const [observacoes, setObservacoes] = useState('');

  const [pedindoIA, setPedindoIA] = useState(false);
  const [sugestao, setSugestao] = useState<Record<string, any> | null>(null);
  const [motivoSemIA, setMotivoSemIA] = useState<string | null>(null);
  /** Itens que o gestor ainda não decidiu: nada entra no plano sem passar por aqui. */
  const [aceitos, setAceitos] = useState<Record<string, boolean>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // ── IA ──────────────────────────────────────────────────────────────────
  const pedirSugestao = useCallback(async () => {
    setPedindoIA(true);
    setErro(null);
    setSugestao(null);
    setMotivoSemIA(null);
    setAceitos({});
    try {
      const r = await api.post<{ sugestao: Record<string, any> | null; motivo?: string }>(
        '/rh/planos-desenvolvimento/analisar',
        { funcionarioId },
      );
      const d = r.data;
      if (d?.sugestao) {
        setSugestao(d.sugestao);
        // O perfil e os percentuais que a IA viu ficam visíveis, para o gestor
        // conferir se a sugestão parte da avaliação certa. São só contexto.
        setObjetivo((d.sugestao.objetivo as Objetivo) ?? objetivo);
        if (d.sugestao.prazoSugeridoDias && !prazo) {
          const fim = new Date(`${dataInicio}T12:00:00`);
          fim.setDate(fim.getDate() + d.sugestao.prazoSugeridoDias);
          setPrazo(fim.toISOString().slice(0, 10));
        }
      } else {
        // Falha da IA não é erro do sistema: o formulário continua utilizável.
        setMotivoSemIA(d?.motivo ?? 'A IA não retornou sugestão para esta avaliação.');
      }
    } catch (e: any) {
      setMotivoSemIA(e?.message ?? 'Não foi possível consultar a IA.');
    } finally {
      setPedindoIA(false);
    }
  }, [funcionarioId, dataInicio, prazo, objetivo]);

  const alternar = (chave: string) => setAceitos((a) => ({ ...a, [chave]: !a[chave] }));

  // ── Ações ───────────────────────────────────────────────────────────────
  const adicionarAcao = () =>
    setAcoes((a) => [...a, { tipo: 'TREINAMENTO', descricao: '', concluida: false }]);

  const alterarAcao = (i: number, patch: Partial<AcaoRascunho>) =>
    setAcoes((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  const removerAcao = (i: number) => setAcoes((a) => a.filter((_, k) => k !== i));

  /**
   * Puxa uma ação sugerida para o rascunho.
   *
   * A ação entra com `concluida: false`. Não existe caminho aqui que marque
   * como feita algo que ninguém fez — nem vindo da IA, que também não tem
   * esse campo.
   */
  const puxarAcao = (a: { tipo: TipoAcao; descricao: string }, chave: string) => {
    if (aceitos[chave]) return;
    setAcoes((atual) =>
      atual.some((x) => x.descricao === a.descricao)
        ? atual
        : [...atual, { tipo: a.tipo, descricao: a.descricao, concluida: false }],
    );
    alternar(chave);
  };

  const acoesValidas = useMemo(() => acoes.filter((a) => a.descricao.trim().length >= 3), [acoes]);
  const podeSalvar = acoesValidas.length > 0 && descricao.trim().length >= 5;

  async function salvar() {
    if (!podeSalvar || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const corpo: Record<string, unknown> = {
        funcionarioId,
        avaliacaoId,
        objetivo,
        competencia,
        descricao: descricao.trim(),
        acoes: acoesValidas.map((a) => ({ tipo: a.tipo, descricao: a.descricao.trim(), concluida: a.concluida })),
        dataInicio,
        prazo: prazo || null,
        observacoes: observacoes.trim() || null,
        // `perfil` e `scores` NÃO vão no corpo: o servidor lê da avaliação.
        analiseIA: sugestao ?? null,
      };
      const r = await api.post<{ id: string }>('/rh/planos-desenvolvimento', corpo as any);
      // `api.post` já devolve `{ data }`. A Expression anterior era
      // `r.data?.id ?? r.id`: o primeiro ramo é o correto e o segundo nunca
      // dispara, mas se a criação devolvesse um corpo sem `id` (item apagado,
      // rota nova) o `??` cairia em `undefined` e o pai receberia um plano sem
      // id — que é pior do que falhar alto. Sem id não há plano criado.
      if (!r.data?.id) throw new Error('O servidor criou o plano sem devolver o id.');
      aoSalvar({ id: r.data.id });
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível salvar o plano.');
    } finally {
      setSalvando(false);
    }
  }

  const campo = 'h-[38px] w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[13px] text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]';
  const rotulo = 'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]';

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-6">
      <div className="w-full max-w-[860px] rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)] text-[var(--nx-ink)] shadow-2xl">
        {/* Cabeçalho com a avaliação de origem — o gestor precisa ver de qual
            avaliação o plano está saindo, porque o snapshot fica congelado nela. */}
        <div className="flex items-start justify-between gap-4 border-b border-[var(--nx-border)] p-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]">
              Plano de Desenvolvimento • {funcionarioNome}
            </p>
            <h2 className="mt-1 text-[16px] font-bold text-[var(--nx-ink)]">
              {perfil ? `Perfil ${perfil} observado na avaliação` : 'Plano de desenvolvimento'}
            </h2>
          </div>
          <button type="button" onClick={aoFechar} aria-label="Fechar"
            className="rounded-[8px] border border-[var(--nx-border)] px-2.5 py-1 text-[12px] text-[var(--nx-ink-2)] hover:text-[var(--nx-ink)]">
            Fechar
          </button>
        </div>

        {scores && (
          <div className="flex gap-2 border-b border-[var(--nx-border)] px-5 py-3">
            {(['D', 'I', 'S', 'C'] as FatorDisc[]).map((e) => (
              <div key={e} className="flex-1 rounded-[8px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-2 text-center">
                <p className="text-[11px] font-bold" style={{ color: CORES[e] }}>{e}</p>
                <p className="mt-0.5 text-[13px] font-bold text-[var(--nx-ink)]">{scores[e] ?? '—'}</p>
              </div>
            ))}
            <p className="ml-2 max-w-[220px] self-center text-[11px] leading-relaxed text-[var(--nx-ink-3)]">
              Percentuais da avaliação, apenas para contexto. Não são editáveis aqui.
            </p>
          </div>
        )}

        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
          {/* ── IA ──────────────────────────────────────────────────────
              O painel é separado do formulário de propósito: a sugestão não
              preenche o plano, ela oferece itens que o gestor escolhe. */}
          <section className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-bold text-[var(--nx-ink)]">Sugestão da IA NEXUS</p>
                <p className="mt-0.5 text-[11px] text-[var(--nx-ink-2)]">
                  Analisa só esta avaliação e sugere ponto de partida. Você decide o que usar.
                </p>
              </div>
              <button type="button" onClick={pedirSugestao} disabled={pedindoIA}
                className="h-[34px] rounded-[10px] bg-[var(--nx-accent)] px-3.5 text-[12px] font-bold text-[var(--nx-ink)] hover:opacity-90 disabled:opacity-50">
                {pedindoIA ? 'Consultando…' : sugestao ? 'Pedir nova sugestão' : 'Sugerir com IA'}
              </button>
            </div>

            {motivoSemIA && (
              <p className="mt-3 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3 text-[12px] leading-relaxed text-[var(--nx-amber)]">
                A IA não respondeu: {motivoSemIA} O plano continua podendo ser montado por
                baixo, sem sugestão.
              </p>
            )}

            {sugestao && (
              <div className="mt-3 space-y-3">
                <p className="rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] p-2.5 text-[12px] leading-relaxed text-[var(--nx-ink)]">
                  A IA sugere pontos de conversa, não vereditos. Ela não avalia desempenho, não
                  diagnostica e não recomenda decisão sobre a pessoa. O perfil comportamental
                  descreve como a pessoa age, não o que ela é capaz de entregar.
                </p>

                {sugestao.dadosConsiderados && (
                  <p className="text-[11px] text-[var(--nx-ink-2)]">
                    Base da análise: perfil {sugestao.dadosConsiderados.perfil ?? '—'} de{' '}
                    {sugestao.dadosConsiderados.dataAvaliacao} — D {sugestao.dadosConsiderados.percentuais?.D ?? '—'},
                    I {sugestao.dadosConsiderados.percentuais?.I ?? '—'},
                    S {sugestao.dadosConsiderados.percentuais?.S ?? '—'},
                    C {sugestao.dadosConsiderados.percentuais?.C ?? '—'}.
                  </p>
                )}

                {Array.isArray(sugestao.competencias) && sugestao.competencias.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]">Competências sugeridas</p>
                    <ul className="space-y-1.5">
                      {sugestao.competencias.map((c: any, i: number) => {
                        const chave = `comp-${i}`;
                        return (
                          <li key={chave} className="flex items-start gap-2.5 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] p-2.5">
                            <input type="checkbox" checked={!!aceitos[chave]} onChange={() => {
                              alternar(chave);
                              if (!aceitos[chave] && c.nome) setCompetencia(c.nome);
                            }} className="mt-0.5 accent-[var(--nx-accent)]" />
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-bold text-[var(--nx-ink)]">{ROTULO_COMPETENCIA[c.nome] ?? c.nome}</p>
                              {c.justificativa && <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--nx-ink-2)]">{c.justificativa}</p>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {Array.isArray(sugestao.acoes) && sugestao.acoes.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]">Ações sugeridas</p>
                    <ul className="space-y-1.5">
                      {sugestao.acoes.map((a: any, i: number) => {
                        const chave = `acao-${i}`;
                        return (
                          <li key={chave} className="flex items-start gap-2.5 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] p-2.5">
                            <input type="checkbox" checked={!!aceitos[chave]}
                              onChange={() => puxarAcao(a, chave)} className="mt-0.5 accent-[var(--nx-accent)]" />
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--nx-accent)]">
                                {ROTULO_ACAO[a.tipo] ?? a.tipo}
                              </p>
                              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--nx-ink)]">{a.descricao}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-1.5 text-[11px] text-[var(--nx-ink-3)]">
                      Marque para copiar a ação para o plano. Todas entram como pendentes.
                    </p>
                  </div>
                )}

                {Array.isArray(sugestao.perguntasAcompanhamento) && sugestao.perguntasAcompanhamento.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]">Perguntas para o acompanhamento</p>
                    <ul className="list-inside list-disc space-y-1 text-[12px] text-[var(--nx-ink-2)]">
                      {sugestao.perguntasAcompanhamento.map((q: string, i: number) => <li key={i}>{q}</li>)}
                    </ul>
                  </div>
                )}

                {Array.isArray(sugestao.pontosAtencao) && sugestao.pontosAtencao.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]">Pontos de atenção</p>
                    <ul className="list-inside list-disc space-y-1 text-[12px] text-[var(--nx-ink-2)]">
                      {sugestao.pontosAtencao.map((q: string, i: number) => <li key={i}>{q}</li>)}
                    </ul>
                  </div>
                )}

                {Array.isArray(sugestao.descartes) && sugestao.descartes.length > 0 && (
                  <details className="rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-2.5">
                    <summary className="cursor-pointer text-[11px] font-bold text-[var(--nx-amber)]">
                      {sugestao.descartes.length} parte(s) da sugestão foi(foram) descartada(s)
                    </summary>
                    <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[11px] text-[var(--nx-amber)]/80">
                      {sugestao.descartes.map((d: string, i: number) => <li key={i}>{d}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </section>

          {/* ── Definição do gestor ────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={rotulo} htmlFor="pd-objetivo">Objetivo</label>
                <select id="pd-objetivo" className={campo} value={objetivo} onChange={(e) => setObjetivo(e.target.value as Objetivo)}>
                  {OBJETIVOS.map((o) => <option key={o} value={o}>{ROTULO_OBJETIVO[o]}</option>)}
                </select>
              </div>
              <div>
                <label className={rotulo} htmlFor="pd-competencia">Competência a desenvolver</label>
                <select id="pd-competencia" className={campo} value={competencia} onChange={(e) => setCompetencia(e.target.value as Competencia)}>
                  {COMPETENCIAS.map((c) => <option key={c} value={c}>{ROTULO_COMPETENCIA[c]}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className={rotulo} htmlFor="pd-descricao">O que será desenvolvido</label>
              <textarea id="pd-descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)}
                rows={3} maxLength={2000} placeholder="Descreva o objetivo do plano, em uma ou duas frases."
                className="w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3 text-[13px] leading-relaxed text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={rotulo} htmlFor="pd-inicio">Início</label>
                <input id="pd-inicio" type="date" className={campo} value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </div>
              <div>
                <label className={rotulo} htmlFor="pd-prazo">Prazo (opcional)</label>
                <input id="pd-prazo" type="date" className={campo} value={prazo} onChange={(e) => setPrazo(e.target.value)} />
              </div>
            </div>

            <div>
              <label className={rotulo} htmlFor="pd-obs">Observações internas (opcional)</label>
              <textarea id="pd-obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)}
                rows={2} maxLength={2000} placeholder="Contexto para quem for acompanhar."
                className="w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3 text-[13px] text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]" />
            </div>
          </section>

          {/* ── Ações ────────────────────────────────────────────────────
              Nenhuma entra marcada. A marcação é do gestor, item a item. */}
          <section className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-bold text-[var(--nx-ink)]">Ações do plano</p>
                <p className="mt-0.5 text-[11px] text-[var(--nx-ink-2)]">
                  Todas começam pendentes. Marque conforme forem concluídas no acompanhamento.
                </p>
              </div>
              <button type="button" onClick={adicionarAcao}
                className="h-[32px] rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-3 text-[12px] font-bold text-[var(--nx-ink)] hover:border-[var(--nx-accent)]">
                + Adicionar
              </button>
            </div>

            {acoes.length === 0 ? (
              <p className="mt-3 text-[12px] text-[var(--nx-ink-2)]">
                Nenhuma ação ainda. Adicione ao menos uma, ou marque as sugeridas pela IA acima.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {acoes.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] p-2.5">
                    <select value={a.tipo} onChange={(e) => alterarAcao(i, { tipo: e.target.value as TipoAcao })}
                      className="h-[32px] rounded-[8px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-2 text-[12px] text-[var(--nx-ink)]">
                      {TIPOS_ACAO.map((t) => <option key={t} value={t}>{ROTULO_ACAO[t]}</option>)}
                    </select>
                    <input value={a.descricao} maxLength={240} onChange={(e) => alterarAcao(i, { descricao: e.target.value })}
                      placeholder="O que fazer, de forma concreta"
                      className="h-[32px] min-w-[180px] flex-1 rounded-[8px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-2.5 text-[12px] text-[var(--nx-ink)]" />
                    <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--nx-ink-2)]">
                      <input type="checkbox" checked={a.concluida}
                        onChange={(e) => alterarAcao(i, { concluida: e.target.checked })}
                        className="accent-[var(--nx-accent)]" />
                      Concluída
                    </label>
                    <button type="button" onClick={() => removerAcao(i)} aria-label="Remover ação"
                      className="rounded-[8px] border border-[var(--nx-border)] px-2 py-1 text-[11px] text-[var(--nx-ink-3)] hover:text-[var(--nx-red)]">
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {erro && (
            <p className="rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3 text-[12px] text-[var(--nx-red)]">{erro}</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--nx-border)] pt-4">
            <p className="text-[11px] leading-relaxed text-[var(--nx-ink-3)]">
              O plano registra o que foi combinado no desenvolvimento. Não é avaliação de
              desempenho, não alimenta decisão sobre a pessoa e o perfil não é alterado por ele.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={aoFechar} disabled={salvando}
                className="h-[40px] rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-4 text-[12px] font-bold text-[var(--nx-ink)] hover:border-[var(--nx-accent)]">
                Cancelar
              </button>
              <button type="button" onClick={salvar} disabled={!podeSalvar || salvando}
                title={!podeSalvar ? 'Descreva o objetivo e inclua ao menos uma ação.' : undefined}
                className="h-[40px] rounded-[10px] bg-[var(--nx-accent)] px-4 text-[12px] font-bold text-[var(--nx-ink)] hover:opacity-90 disabled:opacity-50">
                {salvando ? 'Salvando…' : 'Criar plano'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

