'use client';

/**
 * Modal de Feedback de Liderança — Ciclo 3.
 *
 * É o que o botão "Enviar reconhecimento" do Radar prometia fazer e não fazia.
 * Registra a CONVERSA: o que foi reconhecido, o que precisa desenvolver, o que
 * ficou acordado e quando a conversa volta.
 *
 * POR QUE UM MODAL PRÓPRIO E NÃO O `RegistroGamificacao`
 * -------------------------------------------------------
 * Gamificação guarda PONTOS. Este modal guarda uma conversa, e transformar
 * "a pessoa conversou com o gestor" em "+20 pontos" seria o oposto de
 * liderança empática. São domínios diferentes, e o banco reflete isso.
 *
 * O QUE ESTE MODAL NÃO FAZ
 * ----------------------
 * Não diagnostica. Não rotula ninguém. O texto que o gestor escreve é
 * registro de conversa, e a tela diz isso. A IA, quando aparece, é um painel
 * separado que só sugere — e a sugestão é barrada se soar a julgamento.
 */
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

const TIPOS = ['POSITIVO', 'DESENVOLVIMENTO', 'ACORDO'] as const;
type Tipo = (typeof TIPOS)[number];

const ROTULO_TIPO: Record<string, string> = {
  POSITIVO: 'Positivo', DESENVOLVIMENTO: 'Desenvolvimento', ACORDO: 'Acordo',
};
const ROTULO_STATUS: Record<string, string> = {
  PENDENTE: 'Pendente', REALIZADO: 'Realizado', CANCELADO: 'Cancelado',
};

const hojeIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

type Props = {
  /** Linha de Employees da tela. O `id` é do FUNCIONÁRIO, não do usuario. */
  funcionarioId: string;
  funcionarioNome: string;
  cargo: string | null;
  /** `true` quando o cargo indica liderança (decisão sua, via `TERMOS_LIDERANCA`). */
  lideranca: boolean;
  aoFechar: () => void;
  aoSalvar: (f: { id: string }) => void;
};

export default function FeedbackLiderancaModal({
  funcionarioId, funcionarioNome, cargo, lideranca, aoFechar, aoSalvar,
}: Props) {
  const [tipo, setTipo] = useState<Tipo>('POSITIVO');
  const [data, setData] = useState(hojeIso);
  const [positivos, setPositivos] = useState('');
  const [desenvolver, setDesenvolver] = useState('');
  const [acordos, setAcordos] = useState('');
  const [proximo, setProximo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState<{ id: string; status: string; proximoAcompanhamento: string | null } | null>(null);

  const podeSalvar = positivos.trim().length >= 3 && desenvolver.trim().length >= 3 && !!data;

  async function salvar() {
    if (!podeSalvar || salvando) return;
    setSalvando(true); setErro(null);
    try {
      const r = await api.post<any>('/rh/lideranca/feedbacks', {
        funcionarioId, data, tipo,
        pontosPositivos: positivos.trim(),
        pontosADesenvolver: desenvolver.trim(),
        acordos: acordos.trim() || null,
        proximoAcompanhamento: proximo || null,
      });
      const fb = r.data;
      setSalvo({ id: fb.id, status: fb.status, proximoAcompanhamento: fb.proximoAcompanhamento });
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível registrar o feedback.');
    } finally {
      setSalvando(false);
    }
  }

  /** Marca o acompanhamento como realizado — grava a data de hoje no servidor. */
  const marcarRealizado = useCallback(async () => {
    if (!salvo) return;
    try {
      const r = await api.patch<any>('/rh/lideranca/feedbacks/' + salvo.id, { status: 'REALIZADO' });
      const fb = r.data;
      setSalvo({ ...salvo, status: fb.status });
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível marcar o acompanhamento.');
    }
  }, [salvo]);

  const campo = 'h-[38px] w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[13px] text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]';
  const rotulo = 'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]';

  // ── Depois de salvo: a conversa está registrada. Falta decidir se o
  //    acompanhamento marcado realmente aconteceu — e isso é do gestor.
  if (salvo) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 p-4">
        <div className="w-full max-w-[560px] rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)] text-[var(--nx-ink)] shadow-2xl">
          <div className="border-b border-[var(--nx-border)] p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]">Feedback registrado</p>
            <h2 className="mt-1 text-[16px] font-bold text-[var(--nx-ink)]">{funcionarioNome}</h2>
            <p className="mt-1 text-[12px] text-[var(--nx-ink-2)]">
              Conversa gravada em {data} • {ROTULO_TIPO[tipo]}
              {salvo.proximoAcompanhamento ? ` • acompanhamento marcado para ${salvo.proximoAcompanhamento}` : ''}
            </p>
          </div>
          <div className="space-y-3 p-5">
            <p className="rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3 text-[12px] leading-relaxed text-[var(--nx-ink-2)]">
              O registro guarda a conversa — o que foi reconhecido, o que precisa desenvolver e
              o que ficou acordado. Ele não é pontuação e não entra em ranking.
            </p>
            {erro && <p className="rounded-[10px] border border-red-500/20 bg-red-500/10 p-3 text-[12px] text-[var(--nx-red)]">{erro}</p>}
            <p className="text-[11px] leading-relaxed text-[var(--nx-ink-3)]">
              Feedback registra a conversa. Não é avaliação de desempenho, não gera ponto e não
              alimenta decisão sobre a pessoa.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--nx-border)] p-5">
            <button type="button" onClick={() => { aoSalvar({ id: salvo.id }); }}
              className="h-[40px] rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-4 text-[12px] font-bold text-[var(--nx-ink)] hover:border-[var(--nx-accent)]">
              Fechar
            </button>
            <div className="flex gap-2">
              {salvo.status === 'PENDENTE' && salvo.proximoAcompanhamento && (
                <button type="button" onClick={marcarRealizado}
                  className="h-[40px] rounded-[10px] border border-green-500/30 bg-green-500/10 px-4 text-[12px] font-bold text-[var(--nx-green)] hover:bg-green-500/20">
                  Marcar acompanhamento como realizado
                </button>
              )}
              <button type="button" onClick={() => aoSalvar({ id: salvo.id })}
                className="h-[40px] rounded-[10px] bg-[var(--nx-accent)] px-4 text-[12px] font-bold text-white hover:opacity-90">
                Concluir
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-6">
      <div className="w-full max-w-[680px] rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)] text-[var(--nx-ink)] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--nx-border)] p-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]">
              Feedback de liderança
              {lideranca && <span className="ml-2 text-[var(--nx-accent)]">• cargo de liderança</span>}
            </p>
            <h2 className="mt-1 text-[16px] font-bold text-[var(--nx-ink)]">{funcionarioNome}</h2>
            {cargo && <p className="mt-0.5 text-[12px] text-[var(--nx-ink-2)]">{cargo}</p>}
          </div>
          <button type="button" onClick={aoFechar} aria-label="Fechar"
            className="rounded-[8px] border border-[var(--nx-border)] px-2.5 py-1 text-[12px] text-[var(--nx-ink-2)] hover:text-[var(--nx-ink)]">
            Fechar
          </button>
        </div>

        <div className="max-h-[68vh] space-y-4 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={rotulo} htmlFor="fb-tipo">Tipo</label>
              <select id="fb-tipo" className={campo} value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
                {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
              </select>
            </div>
            <div>
              <label className={rotulo} htmlFor="fb-data">Data da conversa</label>
              <input id="fb-data" type="date" className={campo} value={data} onChange={(e) => setData(e.target.value)} />
            </div>
          </div>

          <div>
            <label className={rotulo} htmlFor="fb-pos">Pontos positivos</label>
            <textarea id="fb-pos" rows={3} maxLength={2000} value={positivos} onChange={(e) => setPositivos(e.target.value)}
              placeholder="O que a pessoa fez bem e que merece ser reconhecido."
              className="w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3 text-[13px] leading-relaxed text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]" />
          </div>

          <div>
            <label className={rotulo} htmlFor="fb-dev">Pontos a desenvolver</label>
            <textarea id="fb-dev" rows={3} maxLength={2000} value={desenvolver} onChange={(e) => setDesenvolver(e.target.value)}
              placeholder="O que pode crescer. Descreva a prática, não a pessoa."
              className="w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3 text-[13px] leading-relaxed text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]" />
          </div>

          <div>
            <label className={rotulo} htmlFor="fb-acordos">Acordos (opcional)</label>
            <textarea id="fb-acordos" rows={2} maxLength={2000} value={acordos} onChange={(e) => setAcordos(e.target.value)}
              placeholder="O que ficou combinado entre as partes."
              className="w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3 text-[13px] text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]" />
          </div>

          <div>
            <label className={rotulo} htmlFor="fb-prox">Próximo acompanhamento (opcional)</label>
            <input id="fb-prox" type="date" className={campo} value={proximo} onChange={(e) => setProximo(e.target.value)} />
            <p className="mt-1 text-[11px] text-[var(--nx-ink-3)]">
              Data em que a conversa deve voltar. Sem data, o registro fica sem acompanhamento marcado.
            </p>
          </div>

          {erro && <p className="rounded-[10px] border border-red-500/20 bg-red-500/10 p-3 text-[12px] text-[var(--nx-red)]">{erro}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--nx-border)] p-5">
          <p className="max-w-[380px] text-[11px] leading-relaxed text-[var(--nx-ink-3)]">
            Este registro documenta uma conversa. Não é avaliação de desempenho, não gera
            pontuação e não alimenta decisão sobre a pessoa.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={aoFechar} disabled={salvando}
              className="h-[40px] rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-4 text-[12px] font-bold text-[var(--nx-ink)] hover:border-[var(--nx-accent)]">
              Cancelar
            </button>
            <button type="button" onClick={salvar} disabled={!podeSalvar || salvando}
              title={!podeSalvar ? 'Descreva os pontos positivos e o que a desenvolver.' : undefined}
              className="h-[40px] rounded-[10px] bg-[var(--nx-accent)] px-4 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50">
              {salvando ? 'Registrando…' : 'Registrar feedback'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

