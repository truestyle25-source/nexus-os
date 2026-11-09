'use client';

/**
 * Painel de Liderança Empática — Ciclo 4.
 *
 * Fica na aba BEM-ESTAR do Radar, junto do card "Sugestões de Treinamento" —
 * é a decisão de escopo do ciclo, e não cria aba nova.
 *
 * Os indicadores vêm de `GET /rh/lideranca/indicadores` (Ciclo 3). O que este
 * painel acrescenta é a PARTE VISUAL que faltava, mais a lista de feedback
 * com a ação de marcar o acompanhamento como realizado.
 *
 * SEM DADO, A TELHA DIZ QUE FALTA DADO
 * ------------------------------------
 * Sem cargo de liderança cadastrado, a cobertura é `null` (não 0%) e a tela
 * escreve que nenhum cargo é reconhecido como liderança. Sem feedback
 * registrado, escreve "nenhum feedback registrado" — nunca um exemplo.
 */
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Resumo = {
  liderancas: number;
  feedbacks: number;
  acompanhamentosPendentes: number;
  proximosVencidos: number;
  planosAtivos: number;
  treinamentosConcluidos: number;
  liderancasComFeedback: number;
  /** `null` quando não há ninguém identificado como líder. */
  coberturaFeedback: number | null;
};

type Indicadores = {
  resumo: Resumo;
  lideres: Array<{ id: string; nome: string; cargo: string | null; departamento: string | null }>;
  criterioLideranca: { termos: string[]; fonte: string };
};

type Feedback = {
  id: string; funcionario: string; departamento: string | null; cargo: string | null;
  lideranca: boolean; aplicadoPor: string | null; data: string; tipoRotulo: string;
  pontosPositivos: string; pontosADesenvolver: string; acordos: string | null;
  proximoAcompanhamento: string | null; status: string; statusRotulo: string;
  vencido: boolean; realizadoEm: string | null;
};

export default function LiderancaEmpaticPainel({
  onToast,
}: {
  onToast: (t: string, m: string, k?: 'ok' | 'warn') => void;
}) {
  const [dados, setDados] = useState<Indicadores | null>(null);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [analisando, setAnalisando] = useState(false);
  const [sugestao, setSugestao] = useState<Record<string, any> | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const [i, f] = await Promise.all([
        api.get<Indicadores>('/rh/lideranca/indicadores'),
        api.get<{ feedbacks: Feedback[] }>('/rh/lideranca/feedbacks'),
      ]);
      setDados(i.data);
      setFeedbacks(f.data?.feedbacks ?? []);
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível ler os indicadores de liderança.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const pedirSugestao = useCallback(async () => {
    setAnalisando(true); setMotivo(null);
    try {
      const r = await api.post<any>('/rh/lideranca/analisar', {});
      const d = r.data;
      if (d?.sugestao) setSugestao(d.sugestao);
      else { setSugestao(null); setMotivo(d?.motivo ?? 'A IA não retornou sugestão.'); }
    } catch (e: any) {
      setSugestao(null); setMotivo(e?.message ?? 'Não foi possível consultar a IA.');
    } finally { setAnalisando(false); }
  }, []);

  const marcarRealizado = useCallback(async (id: string) => {
    try {
      await api.patch('/rh/lideranca/feedbacks/' + id, { status: 'REALIZADO' });
      onToast('Acompanhamento registrado', 'Marcado como realizado.');
      await carregar();
    } catch (e: any) {
      onToast('Não foi possível atualizar', e?.message ?? 'Tente de novo.', 'warn');
    }
  }, [carregar, onToast]);

  const card = 'rounded-[16px] border border-[#2a2a4a] bg-[#1c1c32] p-4';
  const kpiRot = 'text-[10px] font-bold uppercase tracking-[0.8px] text-[#6a6a8a]';
  const kpiVal = 'mt-1 text-[20px] font-bold text-white';

  if (carregando) return <p className="text-[12px] text-white/50">Carregando indicadores de liderança…</p>;

  const r = dados?.resumo;
  const pendentes = feedbacks.filter((f) => f.status === 'PENDENTE');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-bold text-white">Liderança Empática</h2>
          <p className="mt-1 text-[11px] text-[#6a6a8a]">
            Práticas de relação com a equipe, acompanhadas por dado — não por julgamento.
          </p>
        </div>
        <button type="button" onClick={pedirSugestao} disabled={analisando}
          className="h-8 rounded-[10px] border border-\[#7C3AED\]/40 bg-\[#7C3AED\]/10 px-3 text-[11px] font-bold text-white disabled:opacity-50">
          {analisando ? 'Analisando…' : sugestao ? 'Analisar de novo' : 'Sugestão da IA'}
        </button>
      </div>

      {erro && <p className="rounded-[12px] border border-[#4a1a1a] bg-[#1f1010] p-3 text-[12px] text-[#f0a0a0]">{erro}</p>}

      {r && r.liderancas === 0 && (
        <p className="rounded-[12px] border border-dashed border-[#2a2a4a] bg-[#121224] p-4 text-[11.5px] leading-relaxed text-[#8a8ab0]">
          Nenhum cargo desta empresa é reconhecido como liderança, então não há indicadores a
          mostrar. Cadastre um cargo como <strong className="text-white/70">Líder</strong>,
          {' '}<strong className="text-white/70">Coordenador</strong> ou
          {' '}<strong className="text-white/70">Gestor</strong> e o painel passa a ler os dados reais.
        </p>
      )}

      {r && r.liderancas > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div className={card}>
              <p className={kpiRot}>Feedbacks realizados</p>
              <p className={kpiVal}>{r.feedbacks}</p>
            </div>
            <div className={card}>
              <p className={kpiRot}>Acompanhamentos pendentes</p>
              <p className={kpiVal} style={{ color: r.proximosVencidos > 0 ? '#f59e0b' : undefined }}>
                {r.acompanhamentosPendentes}
              </p>
              {r.proximosVencidos > 0 && (
                <p className="mt-1 text-[10px] text-[#f59e0b]">{r.proximosVencidos} já vencido(s)</p>
              )}
            </div>
            <div className={card}>
              <p className={kpiRot}>Cobertura de feedback</p>
              <p className={kpiVal}>{r.coberturaFeedback === null ? '—' : `${r.coberturaFeedback}%`}</p>
              <p className="mt-1 text-[10px] text-white/40">{r.liderancasComFeedback} de {r.liderancas} líderes</p>
            </div>
            <div className={card}>
              <p className={kpiRot}>Planos de desenvolvimento</p>
              <p className={kpiVal}>{r.planosAtivos}</p>
            </div>
            <div className={card}>
              <p className={kpiRot}>Treinamentos com presença</p>
              <p className={kpiVal}>{r.treinamentosConcluidos}</p>
            </div>
            <div className={card}>
              <p className={kpiRot}>Líderes identificados</p>
              <p className={kpiVal}>{r.liderancas}</p>
              <p className="mt-1 text-[10px] text-white/40">pelo cargo cadastrado</p>
            </div>
          </div>

          {sugestao && (
            <div className={card}>
              <p className={kpiRot}>Sugestão da IA</p>
              <p className="mt-2 text-[12px] text-white/85">{sugestao.sugestao}</p>
              {sugestao.publico && <p className="mt-1.5 text-[11px] text-[#8a8ab0]">Público: {sugestao.publico}</p>}
              {sugestao.justificativa ? (
                <p className="mt-2 rounded-[10px] border border-[#23233f] bg-[#121224] p-2.5 text-[10.5px] leading-relaxed text-[#8a8ab0]">
                  <span className="font-bold text-white/70">Base nos dados: </span>{sugestao.justificativa}
                </p>
              ) : (
                <p className="mt-2 text-[10.5px] italic text-[#6a6a8a]">
                  A justificativa foi descartada: a IA citou número que não existe nos dados enviados.
                </p>
              )}
              <p className="mt-2 text-[10.5px] leading-relaxed text-[#6a6a8a]">
                A IA sugere onde olhar. Ela não avalia pessoas, não diagnostica e não recomenda
                decisão sobre ninguém.
              </p>
            </div>
          )}
          {motivo && (
            <p className="rounded-[12px] border border-dashed border-[#2a2a4a] bg-[#121224] p-4 text-[11.5px] leading-relaxed text-[#8a8ab0]">
              {motivo} Nenhuma sugestão é exibida sem dado real por trás.
            </p>
          )}
        </>
      )}

      {/* Feedbacks registrados. Lista real — quando não há nenhum, a tela
          escreve isso, em vez de mostrar um exemplo de conversa. */}
      <div className={card}>
        <p className={kpiRot}>Feedbacks registrados</p>
        {feedbacks.length === 0 ? (
          <p className="mt-2 text-[12px] text-white/50">
            Nenhum feedback registrado. O botão "Enviar reconhecimento" no perfil do colaborador
            abre o registro.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {feedbacks.slice(0, 12).map((f) => (
              <li key={f.id} className="rounded-[12px] border border-[#23233f] bg-[#121224] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-bold text-white">
                      {f.funcionario}
                      {f.lideranca && <span className="ml-1.5 text-[10px] font-normal text-[#7C3AED]">liderança</span>}
                    </p>
                    <p className="text-[10px] text-white/35">
                      {f.data} • {f.tipoRotulo} • por {f.aplicadoPor ?? '—'}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] font-bold"
                    style={{ color: f.status === 'REALIZADO' ? '#22c55e' : f.vencido ? '#f59e0b' : '#8a8ab0' }}>
                    {f.statusRotulo}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[#a0a0c0]">
                  <span className="text-[#22c55e]">Reconhecido:</span> {f.pontosPositivos}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#a0a0c0]">
                  <span className="text-[#f59e0b]">A desenvolver:</span> {f.pontosADesenvolver}
                </p>
                {f.acordos && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#a0a0c0]">
                    <span className="text-[#7C3AED]">Acordos:</span> {f.acordos}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10.5px] text-white/40">
                    {f.status === 'PENDENTE' && f.proximoAcompanhamento
                      ? `Próximo acompanhamento: ${f.proximoAcompanhamento}${f.vencido ? ' (vencido)' : ''}`
                      : f.status === 'REALIZADO' && f.realizadoEm
                        ? `Acompanhamento realizado em ${f.realizadoEm}`
                        : 'Sem acompanhamento marcado'}
                  </p>
                  {f.status === 'PENDENTE' && f.proximoAcompanhamento && (
                    <button type="button" onClick={() => marcarRealizado(f.id)}
                      className="h-7 rounded-[8px] border border-[#23233f] px-2.5 text-[10.5px] font-bold text-white/70 hover:text-white">
                      Marcar realizado
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {pendentes.length > 0 && (
          <p className="mt-2 text-[10.5px] text-white/40">
            {pendentes.length} acompanhamento(s) marcado(s) e ainda pendente(s).
          </p>
        )}
      </div>

      <p className="text-[10.5px] leading-relaxed text-[#6a6a8a]">
        Feedback registra conversa. Não é avaliação de desempenho, não gera pontuação e não
        alimenta decisão sobre a pessoa.
      </p>
    </div>
  );
}


