'use client';

/**
 * Modal de Treinamento — Ciclo 2.
 *
 * É o ponto de entrada que o Radar já oferecia e que hoje mente: os botões
 * "Treinamento" e "Agendar" mostravam "não agendado" sem gravar nada. Aqui o
 * gestor preenche, confirma e o registro vai para o PostgreSQL.
 *
 * REGRAS QUE ESTE MODAL RESPETA
 * ----------------------------
 *  - A IA SUGERE, O GESTOR DECIDE. A sugestão ocupa um painel separado, com a
 *    justificativa visível, e nada é gravado sem que o gestor preencha e salve.
 *
 *  - A DURAÇÃO É CALCULADA PELO SERVIDOR a partir dos horários. O formulário
 *    mostra o resultado, mas não o envia: mandar 4h num campo cujo valor é
 *    deduzido de `09:00`–`13:00` criaria dois lugares onde a hora mora.
 *
 *  - A IA NÃO HÁ DADO PARA INVENTAR. Quando a análise volta com
 *    `dadosInsuficientes`, a tela escreve isso — e não preenche o formulário com
 *    um tema genérico para o gestor "ter o que ver".
 *
 *  - LIMITE DE PARTICIPANTES: `null` significa "sem limite" e 0 é recusado.
 *    Zero seria "ninguém pode participar", que é decisão, não omissão.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';

const CATEGORIAS = [
  'COMUNICACAO', 'LIDERANCA', 'ORGANIZACAO', 'SEGURANCA', 'TECNICO',
  'ATENDIMENTO', 'GESTAO', 'OUTRO',
] as const;
const STATUS = ['PLANEJADO', 'AGENDADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO'] as const;
const STATUS_PARTICIPANTE = ['CONVIDADO', 'CONFIRMADO', 'PRESENTE', 'AUSENTE', 'CANCELADO'] as const;

type Categoria = (typeof CATEGORIAS)[number];
type Status = (typeof STATUS)[number];
type StatusPart = (typeof STATUS_PARTICIPANTE)[number];

const ROTULO_CATEGORIA: Record<string, string> = {
  COMUNICACAO: 'Comunicação', LIDERANCA: 'Liderança', ORGANIZACAO: 'Organização',
  SEGURANCA: 'Segurança', TECNICO: 'Técnico', ATENDIMENTO: 'Atendimento',
  GESTAO: 'Gestão', OUTRO: 'Outro',
};
const ROTULO_STATUS: Record<string, string> = {
  PLANEJADO: 'Planejado', AGENDADO: 'Agendado', EM_ANDAMENTO: 'Em andamento',
  CONCLUIDO: 'Concluído', CANCELADO: 'Cancelado',
};
const ROTULO_STATUS_PART: Record<string, string> = {
  CONVIDADO: 'Convidado', CONFIRMADO: 'Confirmado', PRESENTE: 'Presente',
  AUSENTE: 'Ausente', CANCELADO: 'Não participou',
};
const ROTULO_PRIORIDADE: Record<string, string> = { BAIXA: 'Baixa', MEDIA: 'Média', ALTA: 'Alta' };
const ROTULO_FORMATO: Record<string, string> = {
  PRESENCIAL: 'Presencial', REMOTO: 'Remoto', HIBRIDO: 'Híbrido',
};

const CORES: Record<string, string> = { BAIXA: '#6b7280', MEDIA: '#f59e0b', ALTA: '#ef4444' };

type Participante = {
  id: string; funcionarioId: string; nome: string; departamento: string | null; status: string;
};

type Props = {
  aoFechar: () => void;
  aoSalvar: (t: { id: string; titulo: string }) => void;
  /**
   * Sugestão vinda da IA. Preenche o formulário, mas NÃO é gravada sozinha:
   * o gestor revisa, muda o que quiser e só então confirma.
   */
  sugestao?: Record<string, any> | null;
  /** Contexto exibido no cabeçalho (ex.: a área do alerta que originou). */
  contexto?: string;
};

const hojeIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Espelha `calcularDuracaoMinutos` do backend, só para pré-visualizar. */
function minutosDeHHMM(h: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(h ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function calcularDuracao(ini: string, fim: string): number | null {
  const a = minutosDeHHMM(ini);
  const b = minutosDeHHMM(fim);
  if (a === null || b === null) return null;
  const d = b - a;
  return d > 0 ? d : null;
}
const duracaoTexto = (m: number | null) =>
  m === null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ''}` : `${m}min`;

export default function TreinamentoModal({ aoFechar, aoSalvar, sugestao, contexto }: Props) {
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState<Categoria>('COMUNICACAO');
  const [objetivo, setObjetivo] = useState('');
  const [instrutor, setInstrutor] = useState('');
  const [data, setData] = useState(hojeIso);
  const [horaInicio, setHoraInicio] = useState('09:00');
  const [horaFim, setHoraFim] = useState('11:00');
  const [local, setLocal] = useState('');
  const [limite, setLimite] = useState('');
  const [status, setStatus] = useState<Status>('PLANEJADO');
  const [observacoes, setObservacoes] = useState('');

  const [funcionarios, setFuncionarios] = useState<Array<{ id: string; nome: string; departamento: string | null }>>([]);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [criado, setCriado] = useState<{ id: string; participantes: Participante[] } | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [analise, setAnalise] = useState<Record<string, any> | null>(null);
  const [motivoSemIA, setMotivoSemIA] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const duracao = useMemo(() => calcularDuracao(horaInicio, horaFim), [horaInicio, horaFim]);

  // Funcionários REAIS da empresa. `GET /radar/disc/funcionarios` é a rota do
  // seletor do DISC: devolve SÓ id, nome e departamento, e não o cadastro
  // inteiro — a tela de capacitação não precisa de CPF nem salário.
  useEffect(() => {
    let vivo = true;
    api.get<Array<{ id: string; nome: string; departamento: string | null }>>('/radar/disc/funcionarios')
      .then((r) => { if (vivo) setFuncionarios(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (vivo) setFuncionarios([]); });
    return () => { vivo = false; };
  }, []);

  /** Aplica a sugestão da IA no formulário — o gestor revisa antes de salvar. */
  const aplicarSugestao = useCallback((s: Record<string, any> | null) => {
    if (!s) return;
    if (s.tema) setTitulo(String(s.tema));
    if (s.objetivo) setObjetivo(String(s.objetivo));
    if (s.categoria && CATEGORIAS.includes(s.categoria)) setCategoria(s.categoria as Categoria);
    if (s.publicoRecomendado) setDescricao(String(s.publicoRecomendado));
    if (s.duracaoMinutosSugerida && typeof s.duracaoMinutosSugerida === 'number') {
      const fim = new Date(`${data}T12:00:00`);
      fim.setHours(9, 0, 0, 0);
      fim.setMinutes(fim.getMinutes() + s.duracaoMinutosSugerida);
      setHoraFim(`${String(fim.getHours()).padStart(2, '0')}:${String(fim.getMinutes()).padStart(2, '0')}`);
    }
  }, [data]);

  // Sugestão que o Radar já tinha em mãos ao abrir o modal.
  useEffect(() => { if (sugestao) aplicarSugestao(sugestao); }, [sugestao, aplicarSugestao]);

  const pedirAnalise = useCallback(async () => {
    setAnalisando(true); setErro(null); setMotivoSemIA(null);
    try {
      const r = await api.post<any>('/rh/treinamentos/analisar', {});
      const d = r.data;
      if (d?.sugestao) {
        setAnalise(d.sugestao);
        aplicarSugestao(d.sugestao);
      } else {
        // "Dados insuficientes" é RESPOSTA, não erro: a tela escreve o que a IA
        // disse e segue com o formulário em branco.
        setMotivoSemIA(d?.motivo ?? 'A IA não retornou sugestão.');
      }
    } catch (e: any) {
      setMotivoSemIA(e?.message ?? 'Não foi possível consultar a IA.');
    } finally {
      setAnalisando(false);
    }
  }, [aplicarSugestao]);

  const alternar = (id: string) =>
    setSelecionados((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const podeSalvar =
    titulo.trim().length >= 3 && descricao.trim().length >= 5 &&
    objetivo.trim().length >= 5 && instrutor.trim().length >= 2 &&
    local.trim().length >= 2 && duracao !== null;

  async function salvar() {
    if (!podeSalvar || salvando) return;
    setSalvando(true); setErro(null);
    try {
      // `duracaoMinutos` NÃO vai no corpo: o servidor deduz do horário.
      const r = await api.post<{ id: string }>('/rh/treinamentos', {
        titulo: titulo.trim(), descricao: descricao.trim(), categoria,
        objetivo: objetivo.trim(), instrutor: instrutor.trim(),
        data, horaInicio, horaFim, local: local.trim(),
        limiteParticipantes: limite ? Number(limite) : null,
        status, observacoes: observacoes.trim() || null,
        analiseIA: analise ?? null,
      } as any);
      const t = r.data;
      if (selecionados.length > 0) {
        const rp = await api.post('/rh/treinamentos/' + t.id + '/participantes', { funcionarioIds: selecionados });
        const dp = rp.data;
        setCriado({ id: t.id, participantes: dp?.participantes ?? [] });
      } else {
        setCriado({ id: t.id, participantes: [] });
      }
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível salvar o treinamento.');
    } finally {
      setSalvando(false);
    }
  }

  async function registrarPresenca(valor: StatusPart) {
    if (!criado) return;
    try {
      const registros: Record<string, string> = {};
      for (const p of criado.participantes) {
        // Só mexe em quem ainda não tem presença decidida.
        if (p.status === 'PRESENTE' || p.status === 'AUSENTE') continue;
        registros[p.funcionarioId] = valor;
      }
      if (Object.keys(registros).length === 0) return;
      const r = await api.patch<any>('/rh/treinamentos/' + criado.id + '/presenca', { registros });
      const d = r.data;
      setCriado({ ...criado, participantes: d?.participantes ?? criado.participantes });
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível registrar a presença.');
    }
  }

  const campo = 'h-[38px] w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[13px] text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]';
  const rotulo = 'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]';

  // ── Etapa 2: o treinamento já existe; falta dar presença ──────────────
  if (criado) {
    const decididos = criado.participantes.filter((p) => p.status === 'PRESENTE' || p.status === 'AUSENTE').length;
    return (
      <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-6">
        <div className="w-full max-w-[640px] rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)] text-[var(--nx-ink)] shadow-2xl">
          <div className="border-b border-[var(--nx-border)] p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]">Treinamento registrado</p>
            <h2 className="mt-1 text-[16px] font-bold text-[var(--nx-ink)]">{titulo}</h2>
            <p className="mt-1 text-[12px] text-[var(--nx-ink-2)]">
              {criado.participantes.length} participante(s) • presença registrada em {decididos}
            </p>
          </div>
          <div className="max-h-[58vh] space-y-4 overflow-y-auto p-5">
            {criado.participantes.length === 0 ? (
              <p className="text-[12px] text-[var(--nx-ink-2)]">
                Nenhum participante foi selecionado. O treinamento está gravado e pode receber
                participantes depois.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {criado.participantes.map((p) => {
                  const decidido = p.status === 'PRESENTE' || p.status === 'AUSENTE';
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-bold text-[var(--nx-ink)]">{p.nome}</p>
                        {p.departamento && <p className="text-[11px] text-[var(--nx-ink-3)]">{p.departamento}</p>}
                      </div>
                      <span className="shrink-0 text-[11px] font-bold"
                        style={{ color: decidido ? (p.status === 'PRESENTE' ? 'var(--nx-green)' : 'var(--nx-amber)') : 'var(--nx-ink-3)' }}>
                        {ROTULO_STATUS_PART[p.status] ?? p.status}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {erro && <p className="rounded-[10px] border border-red-500/20 bg-red-500/10 p-3 text-[12px] text-[var(--nx-red)]">{erro}</p>}
            <p className="text-[11px] leading-relaxed text-[var(--nx-ink-3)]">
              Presença em treinamento não gera falta, não gera hora extra e não altera o espelho
              de ponto. É informação de capacitação, registrada aqui.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--nx-border)] p-5">
            <button type="button" onClick={aoFechar}
              className="h-[40px] rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-4 text-[12px] font-bold text-[var(--nx-ink)] hover:border-[var(--nx-accent)]">
              Concluir
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => registrarPresenca('AUSENTE')}
                className="h-[40px] rounded-[10px] border border-amber-500/30 bg-amber-500/10 px-4 text-[12px] font-bold text-[var(--nx-amber)] hover:bg-amber-500/20">
                Todos ausentes
              </button>
              <button type="button" onClick={() => registrarPresenca('PRESENTE')}
                className="h-[40px] rounded-[10px] bg-[var(--nx-accent)] px-4 text-[12px] font-bold text-white hover:opacity-90">
                Todos presentes
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Etapa 1: definição do treinamento ──────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-6">
      <div className="w-full max-w-[820px] rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)] text-[var(--nx-ink)] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--nx-border)] p-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]">
              Novo treinamento{contexto ? ` • ${contexto}` : ''}
            </p>
            <h2 className="mt-1 text-[16px] font-bold text-[var(--nx-ink)]">Agendar capacitação</h2>
          </div>
          <button type="button" onClick={aoFechar} aria-label="Fechar"
            className="rounded-[8px] border border-[var(--nx-border)] px-2.5 py-1 text-[12px] text-[var(--nx-ink-2)] hover:text-[var(--nx-ink)]">
            Fechar
          </button>
        </div>

        <div className="max-h-[72vh] space-y-5 overflow-y-auto p-5">
          {/* IA: painel separado, porque a sugestão não preenche o plano —
              ela oferece, e o gestor revisa. */}
          <section className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-bold text-[var(--nx-ink)]">Análise da IA NEXUS</p>
                <p className="mt-0.5 text-[11px] text-[var(--nx-ink-2)]">
                  Lê os indicadores da empresa (atraso, hora extra, falta, registros) e sugere
                  um tema. Você decide.
                </p>
              </div>
              <button type="button" onClick={pedirAnalise} disabled={analisando}
                className="h-[34px] rounded-[10px] bg-[var(--nx-accent)] px-3.5 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50">
                {analisando ? 'Analisando…' : 'Analisar com IA'}
              </button>
            </div>

            {motivoSemIA && (
              <p className="mt-3 rounded-[10px] border border-amber-500/20 bg-amber-500/10 p-3 text-[12px] leading-relaxed text-[var(--nx-amber)]">
                {motivoSemIA} Você pode montar o treinamento por baixo — nenhum campo é obrigatório
                além dos do formulário.
              </p>
            )}

            {analise && (
              <div className="mt-3 space-y-2.5">
                <p className="rounded-[10px] border border-blue-500/20 bg-blue-500/10 p-2.5 text-[12px] leading-relaxed text-[var(--nx-ink)]">
                  A IA trabalha com números agregados por departamento e sugere um tema de
                  capacitação. Ela não avalia pessoas, não diagnostica e não recomenda decisão
                  sobre ninguém.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase"
                    style={{ color: CORES[analise.prioridade] ?? CORES.MEDIA, borderColor: `${CORES[analise.prioridade] ?? CORES.MEDIA}55` }}>
                    Prioridade {ROTULO_PRIORIDADE[analise.prioridade] ?? analise.prioridade}
                  </span>
                  <span className="rounded-full border border-[var(--nx-border)] px-2.5 py-1 text-[11px] text-[var(--nx-ink-2)]">
                    {ROTULO_FORMATO[analise.formato] ?? analise.formato}
                  </span>
                  {analise.duracaoMinutosSugerida && (
                    <span className="rounded-full border border-[var(--nx-border)] px-2.5 py-1 text-[11px] text-[var(--nx-ink-2)]">
                      {duracaoTexto(analise.duracaoMinutosSugerida)}
                    </span>
                  )}
                </div>
                {analise.publicoRecomendado && (
                  <p className="text-[12px] text-[var(--nx-ink-2)]"><strong className="text-[var(--nx-ink)]">Público:</strong> {analise.publicoRecomendado}</p>
                )}
                {analise.justificativa && (
                  <p className="rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] p-2.5 text-[12px] leading-relaxed text-[var(--nx-ink)]">
                    <strong className="text-[var(--nx-ink)]">Base nos dados:</strong> {analise.justificativa}
                  </p>
                )}
                {!analise.justificativa && (
                  <p className="text-[11px] italic text-[var(--nx-ink-3)]">
                    A justificativa foi descartada: a IA citou número que não existe nos dados enviados.
                  </p>
                )}
                {Array.isArray(analise.perguntasAcompanhamento) && analise.perguntasAcompanhamento.length > 0 && (
                  <ul className="list-inside list-disc space-y-1 text-[12px] text-[var(--nx-ink-2)]">
                    {analise.perguntasAcompanhamento.map((q: string, i: number) => <li key={i}>{q}</li>)}
                  </ul>
                )}
                {Array.isArray(analise.descartes) && analise.descartes.length > 0 && (
                  <details className="rounded-[10px] border border-amber-500/20 bg-amber-500/10 p-2.5">
                    <summary className="cursor-pointer text-[11px] font-bold text-[var(--nx-amber)]">
                      {analise.descartes.length} parte(s) da sugestão foi(foram) descartada(s)
                    </summary>
                    <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[11px] text-[var(--nx-amber)]/80">
                      {analise.descartes.map((d: string, i: number) => <li key={i}>{d}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </section>

          {/* Definição */}
          <section className="space-y-3">
            <div>
              <label className={rotulo} htmlFor="tr-titulo">Título</label>
              <input id="tr-titulo" className={campo} value={titulo} maxLength={160}
                onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Comunicação em ciclos de pressão" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={rotulo} htmlFor="tr-categoria">Categoria</label>
                <select id="tr-categoria" className={campo} value={categoria} onChange={(e) => setCategoria(e.target.value as Categoria)}>
                  {CATEGORIAS.map((c) => <option key={c} value={c}>{ROTULO_CATEGORIA[c]}</option>)}
                </select>
              </div>
              <div>
                <label className={rotulo} htmlFor="tr-status">Status</label>
                <select id="tr-status" className={campo} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                  {STATUS.map((s) => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={rotulo} htmlFor="tr-descricao">Descrição</label>
              <textarea id="tr-descricao" className="w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3 text-[13px] text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]"
                rows={2} maxLength={2000} value={descricao} onChange={(e) => setDescricao(e.target.value)}
                placeholder="O que será trabajado e para quem." />
            </div>
            <div>
              <label className={rotulo} htmlFor="tr-objetivo">Objetivo</label>
              <textarea id="tr-objetivo" className="w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3 text-[13px] text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]"
                rows={2} maxLength={600} value={objetivo} onChange={(e) => setObjetivo(e.target.value)}
                placeholder="O que a pessoa deve sair sabendo fazer." />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={rotulo} htmlFor="tr-instrutor">Instrutor</label>
                <input id="tr-instrutor" className={campo} value={instrutor} maxLength={120}
                  onChange={(e) => setInstrutor(e.target.value)} placeholder="Quem ministra" />
              </div>
              <div>
                <label className={rotulo} htmlFor="tr-local">Local</label>
                <input id="tr-local" className={campo} value={local} maxLength={160}
                  onChange={(e) => setLocal(e.target.value)} placeholder="Sala, link de video ou link" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className={rotulo} htmlFor="tr-data">Data</label>
                <input id="tr-data" type="date" className={campo} value={data} onChange={(e) => setData(e.target.value)} />
              </div>
              <div>
                <label className={rotulo} htmlFor="tr-hi">Início</label>
                <input id="tr-hi" type="time" className={campo} value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
              </div>
              <div>
                <label className={rotulo} htmlFor="tr-hf">Fim</label>
                <input id="tr-hf" type="time" className={campo} value={horaFim} onChange={(e) => setHoraFim(e.target.value)} />
              </div>
              <div>
                <label className={rotulo} htmlFor="tr-dur">Duração</label>
                <div id="tr-dur" className="flex h-[38px] items-center rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[13px] text-[var(--nx-ink)]">
                  {duracaoTexto(duracao)}
                </div>
              </div>
            </div>
            {duracao === null && (
              <p className="text-[11px] text-[var(--nx-amber)]">
                O fim precisa ser depois do início, no mesmo dia. A duração é calculada pelo servidor.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={rotulo} htmlFor="tr-limite">Limite de participantes</label>
                <input id="tr-limite" type="number" min={1} className={campo} value={limite}
                  onChange={(e) => setLimite(e.target.value)} placeholder="Em branco = sem limite" />
              </div>
              <div>
                <label className={rotulo} htmlFor="tr-obs">Observações</label>
                <input id="tr-obs" className={campo} value={observacoes} maxLength={2000}
                  onChange={(e) => setObservacoes(e.target.value)} placeholder="Opcional" />
              </div>
            </div>
          </section>

          {/* Participantes: funcionários REAIS da empresa, opcional.
              Selecionar aqui é conveniência; a lista pode ser completada
              depois. */}
          <section className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-bold text-[var(--nx-ink)]">Participantes</p>
                <p className="mt-0.5 text-[11px] text-[var(--nx-ink-2)]">
                  {selecionados.length > 0 ? `${selecionados.length} selecionado(s)` : 'Opcional. Pode incluir depois.'}
                </p>
              </div>
            </div>
            {funcionarios.length === 0 ? (
              <p className="mt-3 text-[12px] text-[var(--nx-ink-2)]">
                Nenhum funcionário ativo encontrado nesta empresa.
              </p>
            ) : (
              <ul className="mt-3 max-h-[150px] space-y-1 overflow-y-auto">
                {funcionarios.map((f) => (
                  <li key={f.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-transparent px-2 py-1.5 hover:border-[var(--nx-border)]">
                      <input type="checkbox" checked={selecionados.includes(f.id)}
                        onChange={() => alternar(f.id)} className="accent-[var(--nx-accent)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-[var(--nx-ink)]">{f.nome}</span>
                        {f.departamento && <span className="block text-[11px] text-[var(--nx-ink-3)]">{f.departamento}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {erro && (
            <p className="rounded-[10px] border border-red-500/20 bg-red-500/10 p-3 text-[12px] text-[var(--nx-red)]">{erro}</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--nx-border)] pt-4">
            <p className="text-[11px] leading-relaxed text-[var(--nx-ink-3)]">
              Este registro é um evento de capacitação. Não é avaliação de desempenho e não
              alimenta decisão sobre a pessoa.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={aoFechar} disabled={salvando}
                className="h-[40px] rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-4 text-[12px] font-bold text-[var(--nx-ink)] hover:border-[var(--nx-accent)]">
                Cancelar
              </button>
              <button type="button" onClick={salvar} disabled={!podeSalvar || salvando}
                title={!podeSalvar ? 'Preencha título, descrição, objetivo, instrutor, local e um horário válido.' : undefined}
                className="h-[40px] rounded-[10px] bg-[var(--nx-accent)] px-4 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50">
                {salvando ? 'Salvando…' : 'Criar treinamento'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
