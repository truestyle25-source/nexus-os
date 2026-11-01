'use client';

/**
 * Formul�rio DISC � aba do m�dulo Relat�rios.
 *
 * Este componente � a FONTE REAL dos dados que o Radar mostra em "PERFIL DISC".
 * Sem avalia��o gravada aqui, o Radar exibe "DISC n�o preenchido" � nunca um
 * n�mero de exemplo.
 *
 * Princ�pios que o formul�rio respeita:
 *  - o question�rio vem do BACKEND (`GET /radar/disc/questionario`): o texto
 *    das perguntas � conte�do versionado e o c�lculo precisa ser o do servidor;
 *  - as alternativas chegam SEM o fator que alimentam. Se o respondente soubesse,
 *    marcaria a alternativa que o resultado favorece, e a avalia��o deixaria de
 *    medir comportamento para medir inten��o;
 *  - o frontend NUNCA calcula percentual. Ele envia as respostas e mostra o
 *    que o servidor devolveu � se calculasse, os dois n�meros divergiriam;
 *  - nada de dado fict�cio: sem funcion�rio real, o formul�rio avisa e n�o
 *    habilita a avalia��o.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
// Ciclo 1 � mesmo modal usado no Radar. Um componente s�, para as duas telas
// n�o divergirem no que exigem e no que permitem.
import PlanoDesenvolvimentoModal from '@/components/rh/PlanoDesenvolvimentoModal';

type FatorDisc = 'D' | 'I' | 'S' | 'C';

type Pergunta = {
  id: string;
  texto: string;
  /** SEM `fator`: o mapeamento � interno do backend. */
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
   * `false` quando a avalia��o foi lan�ada com data anterior � que j� estava
   * valendo. Ela entra no hist�rico, mas o Radar continua mostrando a mais
   * recente � e o gestor precisa saber disso, sen�o parece que o registro n�o
   * salvou.
   */
  vigente: boolean;
  vigenteId: string;
};

/** Uma linha do hist�rico, como devolvida por GET /radar/disc/historico. */
type LinhaHistorico = {
  id: string;
  perfil: FatorDisc | null;
  dataAvaliacao: string;
  vigente: boolean;
  aplicadoPor: string | null;
  observacoes: string | null;
  /** O JSON `scores` guardado; traz D/I/S/C quando a avalia��o � do question�rio. */
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
  /** Ciclo 1: abre o Plano de Desenvolvimento ancorado na avalia��o salva. */
  const [planoAberto, setPlanoAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  /**
   * Hist�rico do funcion�rio selecionado. Carregado por demanda (e recarregado
   * ap�s cada grava��o) em vez de junto com o question�rio: ele s� existe depois
   * que algu�m � escolhido, e a lista completa de funcion�rios com hist�rico
   * seria uma consulta por pessoa.
   */
  const [historico, setHistorico] = useState<LinhaHistorico[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  /**
   * Contexto profissional sobre a avalia��o. O schema e a API j� aceitam
   * `observacoes`; sem campo aqui, o gestor nunca tinha como preencher � e o
   * campo serve para registrar o contexto que o perfil n�o mede (cargo, fase
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
          // Lista M�NIMA espec�fica do DISC (id, nome, departamento). Chamar
          // `GET /funcionarios` exigiria `rh:visualizar` e devolveria o
          // cadastro inteiro � cargo, sal�rio, contato � para algo que s�
          // precisa de um nome no seletor.
          api.get<Array<{ id: string; nome: string; departamento: string | null }>>('/radar/disc/funcionarios'),
        ]);
        if (!vivo) return;
        setQuestionario(q.data);
        setFuncionarios(f.data ?? []);
      } catch (e) {
        if (!vivo) return;
        // Distingue "sem permiss�o" de "servidor fora": antes as duas mostravam
        // a mesma mensagem gen�rica, e o gestor n�o sabia se era problema da
        // tela ou dele n�o ter acesso.
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) {
          setErro('Voc� n�o tem permiss�o para aplicar avalia��es DISC. � preciso ter acesso a Relat�rios ou ao RH.');
        } else if (status === undefined) {
          setErro('N�o foi poss�vel falar com o servidor. Verifique a conex�o.');
        } else {
          setErro('N�o foi poss�vel carregar o question�rio.');
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
   * Carrega o hist�rico do funcion�rio escolhido.
   *
   * Falha aqui N�O interrompe o preenchimento: o hist�rico � informativo, e
   * esconder o question�rio porque a lista de avalia��es anteriores n�o veio
   * seria trocarem uma informa��o a menos por nenhuma. O erro fica restrito ao
   * bloco de hist�rico.
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

  // Recarrega ao trocar de funcion�rio. O `historico` tamb�m � zerado aqui para
  // que o bloco n�o mostre por um instante as avalia��es da pessoa anterior.
  useEffect(() => {
    setHistorico([]);
    void carregarHistorico(funcionarioId);
  }, [funcionarioId, carregarHistorico]);

  /**
   * Pede o c�lculo ao servidor antes de confirmar. Serve para o passo de
   * confirma��o mostrar a pr�via E para o backend recusar qualquer coisa que ele
   * n�o consiga fechar em 100%.
   */
  const revisar = useCallback(async () => {
    if (!funcionarioId || !completo) return;
    setErro(null);
    try {
      const r = await api.post<{ resultado: Resultado; completo: boolean }>('/radar/disc/calcular', {
        respostas: Object.entries(respostas).map(([perguntaId, alternativaId]) => ({ perguntaId, alternativaId })),
      });
      if (r.data.resultado.D + r.data.resultado.I + r.data.resultado.S + r.data.resultado.C !== 100) {
        setErro('O servidor devolveu um resultado que n�o fecha 100%. Avalia��o cancelada.');
        return;
      }
      setResultado(r.data.resultado);
      setConfirmando(true);
    } catch (e) {
      setErro((e as Error)?.message ?? 'N�o foi poss�vel calcular o resultado.');
    }
  }, [funcionarioId, completo, respostas]);

  const confirmar = useCallback(async () => {
    if (!funcionarioId || !resultado) return;
    setSalvando(true);
    setErro(null);
    try {
      // A data � decidida pelo SERVIDOR (`radar.routes.ts`). Enviar a daqui
      // moveria o registro para o dia errado quando o navegador do gestor
      // est� em outro fuso, e a data � o que decide a vig�ncia.
      const r = await api.post<AvaliacaoSalva>('/radar/disc/avaliar', {
        funcionarioId,
        respostas: Object.entries(respostas).map(([perguntaId, alternativaId]) => ({ perguntaId, alternativaId })),
        observacoes: observacoes.trim() || null,
      });
      setSalvo(r.data);
      setConfirmando(false);
      setResultado(null);
      setObservacoes('');
      // Recarrega para que a avalia��o rec�m-gravada apare�a no hist�rico com a
      // marca de vigente, sem exigir recarregar a p�gina.
      void carregarHistorico(funcionarioId);
    } catch (e) {
      setErro((e as Error)?.message ?? 'N�o foi poss�vel gravar a avalia��o.');
    } finally {
      setSalvando(false);
    }
  }, [funcionarioId, resultado, respostas, observacoes, carregarHistorico]);

  if (carregando) {
    return <p className="mt-4 text-[12px] text-white/50">Carregando question�rio�</p>;
  }
  if (erro && !carregando && !questionario) {
    return <p className="mt-4 text-[12px] text-[#ef4444]">{erro}</p>;
  }
  if (!questionario) return null;

  return (
    <div className="mt-4 space-y-4">
      {/* -- 1. Funcion�rio ---------------------------------------------- */}
      <div className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--card2,var(--nx-surface-2))] p-4">
        <label className="block text-[10px] font-bold uppercase tracking-[0.8px] text-[var(--label2)]">
          Funcion�rio
        </label>
        {funcionarios.length === 0 ? (
          <p className="mt-2 text-[12px] text-[#f59e0b]">
            Nenhum funcion�rio cadastrado no RH. Cadastre em RH &gt; Funcion�rios antes de
            aplicar uma avalia��o.
          </p>
        ) : (
          <select
            value={funcionarioId}
            onChange={(e) => {
              setFuncionarioId(e.target.value);
              // Zerar TUDO ao trocar de funcion�rio. Sem `setRespostas({})` as
              // 12 respostas do funcion�rio anterior continuavam marcadas e o
              // c�lculo misturava dois perfis � o novo recebia um resultado
              // baseado nas respostas de quem o gestor acabara de entrevistar.
              setRespostas({});
              setSalvo(null);
              setResultado(null);
              setErro(null);
            }}
            className="mt-2 h-[44px] w-full rounded-[12px] border border-[var(--border3)] bg-[var(--card3)] px-3 text-[12px] text-white outline-none focus:border-[#7C3AED]"
          >
            <option value="">Selecionar funcion�rio�</option>
            {funcionarios.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}{f.departamento ? ` � ${f.departamento}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* -- Confirma��o salva ------------------------------------------ */}
      {salvo && (
        <div className="rounded-[12px] border border-[#1a4a2a] bg-[#0f2a1a] p-4">
          <p className="text-[13px] font-bold text-[#22c55e]">Avalia��o registrada</p>
          <p className="mt-1 text-[12px] text-[#c8e6d0]">
            Perfil predominante: <strong>{salvo.perfil}</strong> � D {salvo.resultado.D}% �
            I {salvo.resultado.I}% � S {salvo.resultado.S}% � C {salvo.resultado.C}%
          </p>
          <p className="mt-1 text-[11px] text-[#8ab89a]">
            Salva em {salvo.dataAvaliacao}. A avalia��o anterior, se houver, continua no hist�rico.
          </p>
          {salvo.vigente ? (
            <p className="mt-1 text-[11px] text-[#8ab89a]">
              Ela j� aparece na se��o PERFIL DISC do Radar Organizacional.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-[#f0c987">
              Guardada no hist�rico, mas <strong>n�o</strong> � a que vale no Radar: existe uma
              avalia��o mais recente. O Radar continua exibindo a dela.
            </p>
          )}

          {/* Ciclo 1: o plano se ancora NESTA avalia��o. O bot�o s� aparece
              quando ela � a vigente � o plano deve descrever o perfil de hoje,
              n�o o de uma avalia��o que j� foi substitu�da. */}
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
          funcionarioNome={funcionarios.find((f) => f.id === funcionarioId)?.nome ?? 'Funcion�rio'}
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

      {/* -- 2. Question�rio -------------------------------------------- */}
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
              Selecione o funcion�rio para come�ar a responder.
            </p>
          )}

          {/* -- 3. Observa��es (opcional) ------------------------------- */}
          <div className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--card2,var(--nx-surface-2))] p-4">
            <label className="block text-[10px] font-bold uppercase tracking-[0.8px] text-[var(--label2)]">
              Observa��es (opcional)
            </label>
            <p className="mt-1 text-[11px] text-white/45">
              Contexto profissional sobre esta avalia��o � cargo atual, fase da equipe,
              quem aplicou. N�o altera o resultado e n�o substitui o parecer do gestor.
            </p>
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Ex.: avalia��o aplicada na promo��o a lideran�a, ap�s 8 meses no cargo."
              className="mt-2 w-full resize-y rounded-[10px] border border-[var(--border3)] bg-[var(--card3)] p-3 text-[12px] text-white outline-none focus:border-[#7C3AED]"
            />
            <p className="mt-1 text-right text-[10px] text-white/30">{observacoes.length}/2000</p>
          </div>

          {/* -- 4. Finaliza��o ------------------------------------------- */}
          <div className="flex flex-col items-center gap-2 rounded-[12px] border border-[var(--nx-border)] bg-[var(--card2,var(--nx-surface-2))] p-4">
            <p className="text-[12px] text-white/70">
              {completo
                ? 'Voc� respondeu todas as perguntas. Revise o resultado antes de confirmar.'
                : `Faltam ${total - respondidas} pergunta(s). A avalia��o s� � gravada quando todas forem respondidas.`}
            </p>
            {erro && <p className="text-[12px] text-[#ef4444]">{erro}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={revisar}
                disabled={!funcionarioId || !completo}
                className="h-[40px] rounded-[10px] bg-white px-4 text-[12px] font-bold text-[#111] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Finalizar avalia��o
              </button>
            </div>
            <p className="max-w-[520px] text-center text-[10.5px] leading-relaxed text-[var(--label2)]">
              {questionario.aviso}
            </p>
          </div>
        </div>
      )}

      {/* -- 4. Confirma��o (inline, sem sair do layout) ---------------- */}
      {confirmando && resultado && (
        <div className="rounded-[12px] border border-[#7C3AED]/40 bg-[#7C3AED]/8 p-4">
          <p className="text-[13px] font-bold text-white">Confirma��o da avalia��o</p>
          <p className="mt-1 text-[12px] text-white/70">
            Voc� respondeu todas as {resultado.total} perguntas? Confira o resultado antes de
            confirmar � depois de gravado, ele fica dispon�vel no Radar Organizacional.
          </p>

          <div className="mt-3 space-y-2">
            {(['D', 'I', 'S', 'C'] as FatorDisc[]).map((f) => (
              <div key={f} className="flex items-center gap-3">
                <span className="w-[120px] text-[12px]" style={{ color: CORES[f] }}>
                  {f} � {rotulos.get(f) ?? f}
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
            � Perfil predominante:{' '}
            <strong style={{ color: CORES[resultado.predominante] }}>
              {resultado.predominante} � {rotulos.get(resultado.predominante) ?? resultado.predominante}
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
              {salvando ? 'Confirmando�' : 'Confirmar avalia��o'}
            </button>
          </div>
        </div>
      )}

      {/* -- 5. Hist�rico do funcion�rio -------------------------------
          S� aparece com um funcion�rio selecionado. Sem avalia��o anterior,
          o texto diz isso explicitamente em vez de mostrar um espa�o vazio
          que poderia ser lido como falha. */}
      {funcionarioId && (
        <div className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--card2,var(--nx-surface-2))] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.8px] text-[var(--label2)]">
            Hist�rico de avalia��es
          </p>
          {carregandoHistorico ? (
            <p className="mt-2 text-[12px] text-white/50">Carregando hist�rico�</p>
          ) : historico.length === 0 ? (
            <p className="mt-2 text-[12px] text-white/50">
              Nenhuma avalia��o registrada para este funcion�rio. A primeira que voc�
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
                      {h.perfil} � {rotulos.get(h.perfil) ?? h.perfil}
                    </span>
                  ) : (
                    <span className="text-white/40">Sem perfil definido</span>
                  )}
                  {h.scores && h.scores.D !== undefined && (
                    <span className="text-white/50">
                      D {h.scores.D}% � I {h.scores.I}% � S {h.scores.S}% � C {h.scores.C}%
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
            Apenas a avalia��o marcada como vigente alimenta a se��o PERFIL DISC do
            Radar. As demais permanecem registradas para compara��o.
          </p>
        </div>
      )}
    </div>
  );
}

