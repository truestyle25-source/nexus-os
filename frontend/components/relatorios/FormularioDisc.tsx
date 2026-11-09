'use client';

/**
 * Formulï¿½rio DISC ï¿½ aba do mï¿½dulo Relatï¿½rios.
 *
 * Este componente ï¿½ a FONTE REAL dos dados que o Radar mostra em "PERFIL DISC".
 * Sem avaliaï¿½ï¿½o gravada aqui, o Radar exibe "DISC nï¿½o preenchido" ï¿½ nunca um
 * nï¿½mero de exemplo.
 *
 * Princï¿½pios que o formulï¿½rio respeita:
 *  - o questionï¿½rio vem do BACKEND (`GET /radar/disc/questionario`): o texto
 *    das perguntas ï¿½ conteï¿½do versionado e o cï¿½lculo precisa ser o do servidor;
 *  - as alternativas chegam SEM o fator que alimentam. Se o respondente soubesse,
 *    marcaria a alternativa que o resultado favorece, e a avaliaï¿½ï¿½o deixaria de
 *    medir comportamento para medir intenï¿½ï¿½o;
 *  - o frontend NUNCA calcula percentual. Ele envia as respostas e mostra o
 *    que o servidor devolveu ï¿½ se calculasse, os dois nï¿½meros divergiriam;
 *  - nada de dado fictï¿½cio: sem funcionï¿½rio real, o formulï¿½rio avisa e nï¿½o
 *    habilita a avaliaï¿½ï¿½o.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
// Ciclo 1 ï¿½ mesmo modal usado no Radar. Um componente sï¿½, para as duas telas
// nï¿½o divergirem no que exigem e no que permitem.
import PlanoDesenvolvimentoModal from '@/components/rh/PlanoDesenvolvimentoModal';

type FatorDisc = 'D' | 'I' | 'S' | 'C';

type Pergunta = {
  id: string;
  texto: string;
  /** SEM `fator`: o mapeamento ï¿½ interno do backend. */
  alternativas: Array<{ id: string; texto: string }>;
};

type Questionario = {
  total: number;
  fatores: Array<{ fator: FatorDisc; nome: string; descricao: string }>;
  perguntas: Pergunta[];
  regras: string[];
  aviso: string;
};

type Resultado = {
  D: number;
  I: number;
  S: number;
  C: number;
  predominante: FatorDisc;
  pontos: Record<FatorDisc, number>;
  answered: number;
  total: number;
};

type AvaliacaoSalva = {
  id: string;
  perfil: FatorDisc;
  resultado: { D: number; I: number; S: number; C: number };
  dataAvaliacao: string;
  /**
   * `false` quando a avaliaï¿½ï¿½o foi lanï¿½ada com data anterior ï¿½ que jï¿½ estava
   * valendo. Ela entra no histï¿½rico, mas o Radar continua mostrando a mais
   * recente ï¿½ e o gestor precisa saber disso, senï¿½o parece que o registro nï¿½o
   * salvou.
   */
  vigente: boolean;
  vigenteId: string;
};

/** Uma linha do histï¿½rico, como devolvida por GET /radar/disc/historico. */
type LinhaHistorico = {
  id: string;
  perfil: FatorDisc | null;
  dataAvaliacao: string;
  vigente: boolean;
  aplicadoPor: string | null;
  observacoes: string | null;
  /** O JSON `scores` guardado; traz D/I/S/C quando a avaliaï¿½ï¿½o ï¿½ do questionï¿½rio. */
  scores: { D?: number; I?: number; S?: number; C?: number } | null;
};

const CORES: Record<FatorDisc, string> = {
  D: 'var(--body-red)',
  I: 'var(--body-amber)',
  S: 'var(--body-green)',
  C: 'var(--body-blue)',
};

export default function FormularioDisc() {
  const [questionario, setQuestionario] = useState<Questionario | null>(null);
  const [funcionarios, setFuncionarios] = useState<Array<{ id: string; nome: string; departamento: string | null }>>([]);
  const [funcionarioId, setFuncionarioId] = useState('');
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [salvo, setSalvo] = useState<AvaliacaoSalva | null>(null);
  /** Ciclo 1: abre o Plano de Desenvolvimento ancorado na avaliaï¿½ï¿½o salva. */
  const [planoAberto, setPlanoAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  /**
   * Histï¿½rico do funcionï¿½rio selecionado. Carregado por demanda (e recarregado
   * apï¿½s cada gravaï¿½ï¿½o) em vez de junto com o questionï¿½rio: ele sï¿½ existe depois
   * que alguï¿½m ï¿½ escolhido, e a lista completa de funcionï¿½rios com histï¿½rico
   * seria uma consulta por pessoa.
   */
  const [historico, setHistorico] = useState<LinhaHistorico[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  /**
   * Contexto profissional sobre a avaliaï¿½ï¿½o. O schema e a API jï¿½ aceitam
   * `observacoes`; sem campo aqui, o gestor nunca tinha como preencher ï¿½ e o
   * campo serve para registrar o contexto que o perfil nï¿½o mede (cargo, fase
   * atual, quem aplicou), nunca para justificar o resultado.
   */
  const [observacoes, setObservacoes] = useState('');

  const rotulos = useMemo(() => {
    const m = new Map<FatorDisc, string>();
    for (const f of questionario?.fatores ?? []) m.set(f.fator, f.nome);
    return m;
  }, [questionario]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [q, f] = await Promise.all([
          api.get<Questionario>('/radar/disc/questionario'),
          // Lista Mï¿½NIMA especï¿½fica do DISC (id, nome, departamento). Chamar
          // `GET /funcionarios` exigiria `rh:visualizar` e devolveria o
          // cadastro inteiro ï¿½ cargo, salï¿½rio, contato ï¿½ para algo que sï¿½
          // precisa de um nome no seletor.
          api.get<Array<{ id: string; nome: string; departamento: string | null }>>('/radar/disc/funcionarios'),
        ]);
        if (!vivo) return;
        setQuestionario(q.data);
        setFuncionarios(f.data ?? []);
      } catch (e) {
        if (!vivo) return;
        // Distingue "sem permissï¿½o" de "servidor fora": antes as duas mostravam
        // a mesma mensagem genï¿½rica, e o gestor nï¿½o sabia se era problema da
        // tela ou dele nï¿½o ter acesso.
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) {
          setErro('Vocï¿½ nï¿½o tem permissï¿½o para aplicar avaliaï¿½ï¿½es DISC. ï¿½ preciso ter acesso a Relatï¿½rios ou ao RH.');
        } else if (status === undefined) {
          setErro('Nï¿½o foi possï¿½vel falar com o servidor. Verifique a conexï¿½o.');
        } else {
          setErro('Nï¿½o foi possï¿½vel carregar o questionï¿½rio.');
        }
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, []);

  const respondidas = Object.keys(respostas).length;
  const total = questionario?.total ?? 0;
  const completo = total > 0 && respondidas === total;

  /**
   * Carrega o histï¿½rico do funcionï¿½rio escolhido.
   *
   * Falha aqui Nï¿½O interrompe o preenchimento: o histï¿½rico ï¿½ informativo, e
   * esconder o questionï¿½rio porque a lista de avaliaï¿½ï¿½es anteriores nï¿½o veio
   * seria trocarem uma informaï¿½ï¿½o a menos por nenhuma. O erro fica restrito ao
   * bloco de histï¿½rico.
   */
  const carregarHistorico = useCallback(async (id: string) => {
    if (!id) {
      setHistorico([]);
      return;
    }
    setCarregandoHistorico(true);
    try {
      const r = await api.get<{ avaliacoes: LinhaHistorico[] }>(
        `/radar/disc/historico?funcionarioId=${encodeURIComponent(id)}`,
      );
      setHistorico(Array.isArray(r.data?.avaliacoes) ? r.data.avaliacoes : []);
    } catch {
      setHistorico([]);
    } finally {
      setCarregandoHistorico(false);
    }
  }, []);

  // Recarrega ao trocar de funcionï¿½rio. O `historico` tambï¿½m ï¿½ zerado aqui para
  // que o bloco nï¿½o mostre por um instante as avaliaï¿½ï¿½es da pessoa anterior.
  useEffect(() => {
    setHistorico([]);
    void carregarHistorico(funcionarioId);
  }, [funcionarioId, carregarHistorico]);

  /**
   * Pede o cï¿½lculo ao servidor antes de confirmar. Serve para o passo de
   * confirmaï¿½ï¿½o mostrar a prï¿½via E para o backend recusar qualquer coisa que ele
   * nï¿½o consiga fechar em 100%.
   */
  const revisar = useCallback(async () => {
    if (!funcionarioId || !completo) return;
    setErro(null);
    try {
      const r = await api.post<{ resultado: Resultado; completo: boolean }>('/radar/disc/calcular', {
        respostas: Object.entries(respostas).map(([perguntaId, alternativaId]) => ({ perguntaId, alternativaId })),
      });
      if (r.data.resultado.D + r.data.resultado.I + r.data.resultado.S + r.data.resultado.C !== 100) {
        setErro('O servidor devolveu um resultado que nï¿½o fecha 100%. Avaliaï¿½ï¿½o cancelada.');
        return;
      }
      setResultado(r.data.resultado);
      setConfirmando(true);
    } catch (e) {
      setErro((e as Error)?.message ?? 'Nï¿½o foi possï¿½vel calcular o resultado.');
    }
  }, [funcionarioId, completo, respostas]);

  const confirmar = useCallback(async () => {
    if (!funcionarioId || !resultado) return;
    setSalvando(true);
    setErro(null);
    try {
      // A data ï¿½ decidida pelo SERVIDOR (`radar.routes.ts`). Enviar a daqui
      // moveria o registro para o dia errado quando o navegador do gestor
      // estï¿½ em outro fuso, e a data ï¿½ o que decide a vigï¿½ncia.
      const r = await api.post<AvaliacaoSalva>('/radar/disc/avaliar', {
        funcionarioId,
        respostas: Object.entries(respostas).map(([perguntaId, alternativaId]) => ({ perguntaId, alternativaId })),
        observacoes: observacoes.trim() || null,
      });
      setSalvo(r.data);
      setConfirmando(false);
      setResultado(null);
      setObservacoes('');
      // Recarrega para que a avaliaï¿½ï¿½o recï¿½m-gravada apareï¿½a no histï¿½rico com a
      // marca de vigente, sem exigir recarregar a pï¿½gina.
      void carregarHistorico(funcionarioId);
    } catch (e) {
      setErro((e as Error)?.message ?? 'Nï¿½o foi possï¿½vel gravar a avaliaï¿½ï¿½o.');
    } finally {
      setSalvando(false);
    }
  }, [funcionarioId, resultado, respostas, observacoes, carregarHistorico]);

  if (carregando) {
    return <p className="mt-4 text-[12px] text-white/50">Carregando questionï¿½rioï¿½</p>;
  }
  if (erro && !carregando && !questionario) {
    return <p className="mt-4 text-[12px] text-[#ef4444]">{erro}</p>;
  }
  if (!questionario) return null;

  return (
    <div className="mt-4 space-y-4">
      {/* -- 1. Funcionï¿½rio ---------------------------------------------- */}
      <div className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--card2,var(--nx-surface-2))] p-4">
        <label className="block text-[10px] font-bold uppercase tracking-[0.8px] text-[var(--label2)]">
          Funcionï¿½rio
        </label>
        {funcionarios.length === 0 ? (
          <p className="mt-2 text-[12px] text-[#f59e0b]">
            Nenhum funcionï¿½rio cadastrado no RH. Cadastre em RH &gt; Funcionï¿½rios antes de
            aplicar uma avaliaï¿½ï¿½o.
          </p>
        ) : (
          <select
            value={funcionarioId}
            onChange={(e) => {
              setFuncionarioId(e.target.value);
              // Zerar TUDO ao trocar de funcionï¿½rio. Sem `setRespostas({})` as
              // 12 respostas do funcionï¿½rio anterior continuavam marcadas e o
              // cï¿½lculo misturava dois perfis ï¿½ o novo recebia um resultado
              // baseado nas respostas de quem o gestor acabara de entrevistar.
              setRespostas({});
              setSalvo(null);
              setResultado(null);
              setErro(null);
            }}
            className="mt-2 h-[44px] w-full rounded-[12px] border border-[var(--border3)] bg-[var(--card3)] px-3 text-[12px] text-white outline-none focus:border-[#7C3AED]"
          >
            <option value="">Selecionar funcionï¿½rioï¿½</option>
            {funcionarios.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}{f.departamento ? ` ï¿½ ${f.departamento}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* -- Confirmaï¿½ï¿½o salva ------------------------------------------ */}
      {salvo && (
        <div className="rounded-[12px] border border-[#1a4a2a] bg-[#0f2a1a] p-4">
          <p className="text-[13px] font-bold text-[#22c55e]">Avaliaï¿½ï¿½o registrada</p>
          <p className="mt-1 text-[12px] text-[#c8e6d0]">
            Perfil predominante: <strong>{salvo.perfil}</strong> ï¿½ D {salvo.resultado.D}% ï¿½
            I {salvo.resultado.I}% ï¿½ S {salvo.resultado.S}% ï¿½ C {salvo.resultado.C}%
          </p>
          <p className="mt-1 text-[11px] text-[#8ab89a]">
            Salva em {salvo.dataAvaliacao}. A avaliaï¿½ï¿½o anterior, se houver, continua no histï¿½rico.
          </p>
          {salvo.vigente ? (
            <p className="mt-1 text-[11px] text-[#8ab89a]">
              Ela jï¿½ aparece na seï¿½ï¿½o PERFIL DISC do Radar Organizacional.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-[#f0c987">
              Guardada no histï¿½rico, mas <strong>nï¿½o</strong> ï¿½ a que vale no Radar: existe uma
              avaliaï¿½ï¿½o mais recente. O Radar continua exibindo a dela.
            </p>
          )}

          {/* Ciclo 1: o plano se ancora NESTA avaliaï¿½ï¿½o. O botï¿½o sï¿½ aparece
              quando ela ï¿½ a vigente ï¿½ o plano deve descrever o perfil de hoje,
              nï¿½o o de uma avaliaï¿½ï¿½o que jï¿½ foi substituï¿½da. */}
          {salvo.vigente && (
            <button
              type="button"
              onClick={() => setPlanoAberto(true)}
              className="mt-3 h-[36px] rounded-[10px] bg-[linear-gradient(135deg,var(--primary),var(--primary2))] px-4 text-[12px] font-bold text-white transition hover:brightness-110"
            >
              Criar Plano de Desenvolvimento
            </button>
          )}
        </div>
      )}

      {planoAberto && salvo && (
        <PlanoDesenvolvimentoModal
          funcionarioId={funcionarioId}
          funcionarioNome={funcionarios.find((f) => f.id === funcionarioId)?.nome ?? 'Funcionï¿½rio'}
          avaliacaoId={salvo.id}
          perfil={salvo.perfil}
          scores={salvo.resultado}
          aoFechar={() => setPlanoAberto(false)}
          aoSalvar={() => {
            setPlanoAberto(false);
            setErro(null);
          }}
        />
      )}

      {/* -- 2. Questionï¿½rio -------------------------------------------- */}
      {!salvo && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-white/60">
              {respondidas} de {total} perguntas respondidas
            </p>
            <div className="h-[6px] w-[200px] overflow-hidden rounded-full bg-[#1e1e36]">
              <div
                className="h-full rounded-full bg-[#7C3AED] transition-all"
                style={{ width: total > 0 ? `${(respondidas / total) * 100}%` : '0%' }}
              />
            </div>
          </div>

          {funcionarioId ? questionario.perguntas.map((p, i) => (
            <div key={p.id} className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--card2,var(--nx-surface-2))] p-4">
              <p className="text-[10px] font-bold text-[var(--label2)]">{i + 1} de {total}</p>
              <p className="mt-1 text-[13px] font-bold text-white">{p.texto}</p>
              <div className="mt-3 space-y-2">
                {p.alternativas.map((a) => (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-[var(--border3)] bg-[var(--card3)] p-2.5 text-[12px] transition hover:border-[#3a3a6a]"
                    style={respostas[p.id] === a.id ? { borderColor: '#7C3AED', background: '#7C3AED14' } : undefined}
                  >
                    <input
                      type="radio"
                      name={p.id}
                      checked={respostas[p.id] === a.id}
                      onChange={() => setRespostas((r) => ({ ...r, [p.id]: a.id }))}
                      className="mt-[3px] accent-[#7C3AED]"
                    />
                    <span className="text-[#d0d0e0]">{a.texto}</span>
                  </label>
                ))}
              </div>
            </div>
          )) : (
            <p className="rounded-[12px] border border-dashed border-[var(--nx-border)] p-6 text-center text-[12px] text-white/40">
              Selecione o funcionï¿½rio para comeï¿½ar a responder.
            </p>
          )}

          {/* -- 3. Observaï¿½ï¿½es (opcional) ------------------------------- */}
          <div className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--card2,var(--nx-surface-2))] p-4">
            <label className="block text-[10px] font-bold uppercase tracking-[0.8px] text-[var(--label2)]">
              Observaï¿½ï¿½es (opcional)
            </label>
            <p className="mt-1 text-[11px] text-white/45">
              Contexto profissional sobre esta avaliaï¿½ï¿½o ï¿½ cargo atual, fase da equipe,
              quem aplicou. Nï¿½o altera o resultado e nï¿½o substitui o parecer do gestor.
            </p>
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Ex.: avaliaï¿½ï¿½o aplicada na promoï¿½ï¿½o a lideranï¿½a, apï¿½s 8 meses no cargo."
              className="mt-2 w-full resize-y rounded-[10px] border border-[var(--border3)] bg-[var(--card3)] p-3 text-[12px] text-white outline-none focus:border-[#7C3AED]"
            />
            <p className="mt-1 text-right text-[10px] text-white/30">{observacoes.length}/2000</p>
          </div>

          {/* -- 4. Finalizaï¿½ï¿½o ------------------------------------------- */}
          <div className="flex flex-col items-center gap-2 rounded-[12px] border border-[var(--nx-border)] bg-[var(--card2,var(--nx-surface-2))] p-4">
            <p className="text-[12px] text-white/70">
              {completo
                ? 'Vocï¿½ respondeu todas as perguntas. Revise o resultado antes de confirmar.'
                : `Faltam ${total - respondidas} pergunta(s). A avaliaï¿½ï¿½o sï¿½ ï¿½ gravada quando todas forem respondidas.`}
            </p>
            {erro && <p className="text-[12px] text-[#ef4444]">{erro}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={revisar}
                disabled={!funcionarioId || !completo}
                className="h-[40px] rounded-[10px] bg-white px-4 text-[12px] font-bold text-[#111] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Finalizar avaliaï¿½ï¿½o
              </button>
            </div>
            <p className="max-w-[520px] text-center text-[10.5px] leading-relaxed text-[var(--label2)]">
              {questionario.aviso}
            </p>
          </div>
        </div>
      )}

      {/* -- 4. Confirmaï¿½ï¿½o (inline, sem sair do layout) ---------------- */}
      {confirmando && resultado && (
        <div className="rounded-[12px] border border-[#7C3AED]/40 bg-[#7C3AED]/8 p-4">
          <p className="text-[13px] font-bold text-white">Confirmaï¿½ï¿½o da avaliaï¿½ï¿½o</p>
          <p className="mt-1 text-[12px] text-white/70">
            Vocï¿½ respondeu todas as {resultado.total} perguntas? Confira o resultado antes de
            confirmar ï¿½ depois de gravado, ele fica disponï¿½vel no Radar Organizacional.
          </p>

          <div className="mt-3 space-y-2">
            {(['D', 'I', 'S', 'C'] as FatorDisc[]).map((f) => (
              <div key={f} className="flex items-center gap-3">
                <span className="w-[120px] text-[12px]" style={{ color: CORES[f] }}>
                  {f} ï¿½ {rotulos.get(f) ?? f}
                </span>
                <div className="h-[8px] flex-1 overflow-hidden rounded-full bg-[#1e1e36]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${resultado[f]}%`, background: CORES[f] }}
                  />
                </div>
                <span className="w-[46px] text-right text-[12px] font-bold text-white">
                  {resultado[f]}%
                </span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[12px] text-white/60">
            Soma: <strong className="text-white">
              {resultado.D + resultado.I + resultado.S + resultado.C}%
            </strong>{' '}
            ï¿½ Perfil predominante:{' '}
            <strong style={{ color: CORES[resultado.predominante] }}>
              {resultado.predominante} ï¿½ {rotulos.get(resultado.predominante) ?? resultado.predominante}
            </strong>
          </p>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={salvando}
              className="h-[40px] rounded-[10px] border border-[var(--border3)] bg-[#1e1e36] px-4 text-[12px] font-bold text-white/70 transition hover:border-[#3a3a6a]"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={salvando}
              className="h-[40px] rounded-[10px] bg-[linear-gradient(135deg,var(--primary),var(--primary2))] px-4 text-[12px] font-bold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {salvando ? 'Confirmandoï¿½' : 'Confirmar avaliaï¿½ï¿½o'}
            </button>
          </div>
        </div>
      )}

      {/* -- 5. Histï¿½rico do funcionï¿½rio -------------------------------
          Sï¿½ aparece com um funcionï¿½rio selecionado. Sem avaliaï¿½ï¿½o anterior,
          o texto diz isso explicitamente em vez de mostrar um espaï¿½o vazio
          que poderia ser lido como falha. */}
      {funcionarioId && (
        <div className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--card2,var(--nx-surface-2))] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.8px] text-[var(--label2)]">
            Histï¿½rico de avaliaï¿½ï¿½es
          </p>
          {carregandoHistorico ? (
            <p className="mt-2 text-[12px] text-white/50">Carregando histï¿½ricoï¿½</p>
          ) : historico.length === 0 ? (
            <p className="mt-2 text-[12px] text-white/50">
              Nenhuma avaliaï¿½ï¿½o registrada para este funcionï¿½rio. A primeira que vocï¿½
              salvar aparece aqui e passa a constar no Radar Organizacional.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {historico.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-[var(--border3)] bg-[var(--card3)] px-3 py-2 text-[12px]"
                >
                  <span className="text-white/70">{h.dataAvaliacao}</span>
                  {h.perfil ? (
                    <span className="font-bold" style={{ color: CORES[h.perfil] }}>
                      {h.perfil} ï¿½ {rotulos.get(h.perfil) ?? h.perfil}
                    </span>
                  ) : (
                    <span className="text-white/40">Sem perfil definido</span>
                  )}
                  {h.scores && h.scores.D !== undefined && (
                    <span className="text-white/50">
                      D {h.scores.D}% ï¿½ I {h.scores.I}% ï¿½ S {h.scores.S}% ï¿½ C {h.scores.C}%
                    </span>
                  )}
                  {h.vigente && (
                    <span className="font-bold text-[var(--nx-green)]">Vigente no Radar</span>
                  )}
                  {h.aplicadoPor && (
                    <span className="text-white/35">aplicado por {h.aplicadoPor}</span>
                  )}
                  {h.observacoes && (
                    <span className="w-full text-white/45">{h.observacoes}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--label2)]">
            Apenas a avaliaï¿½ï¿½o marcada como vigente alimenta a seï¿½ï¿½o PERFIL DISC do
            Radar. As demais permanecem registradas para comparaï¿½ï¿½o.
          </p>
        </div>
      )}
    </div>
  );
}

