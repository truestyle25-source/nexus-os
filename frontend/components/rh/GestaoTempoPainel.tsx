'use client';

/**
 * Painel de Gestão de Tempo — Ciclo 3.
 *
 * NÃO É UM CRONÔMETRO. Ele não cronometra nada, não registra nada e não
 * escreve nada: só LÊ o `Ponto` que já existe e compara com a jornada prevista
 * que vem do cadastro. Toda linha aqui é número real.
 *
 * O QUE A TELHA DIZ, E O QUE NÃO DIZ
 * ---------------------------------
 * Diz: "Vendas acumula 1080 minutos de hora extra no período".
 * NÃO diz: "O time de Vendas não sabe se organizar".
 *
 * A diferença entre as duas frases é a diferença entre indicador e julgamento.
 * A segunda não existe em lugar nenhum deste arquivo — nem do backend, nem do
 * schema, nem da IA.
 *
 * SEM DADO, A TELHA DIZ QUE FALTA DADO
 * ------------------------------------
 * Sem jornada prevista cadastrada, a comparação não é feita e a tela escreve
 * "sem horário". Sem batida, os dias aparecem como 0 trabalhados em vez de
 * serem preenchidos com um número plausível.
 */
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Pessoa = {
  funcionarioId: string; nome: string; departamento: string | null;
  temJornadaPrevista: boolean; horarioPrevisto: string | null;
  diasTrabalhados: number;
  minutosPrevistos: number | null; minutosTrabalhados: number;
  minutosExtras: number; minutosAtraso: number;
  diasAtraso: number; faltas: number; intervalosIrregulares: number;
};

type Departamento = {
  nome: string; pessoas: number;
  minutosTrabalhados: number; minutosExtras: number; minutosAtraso: number;
  diasAtraso: number; faltas: number; minutosPrevistos: number;
};

type Resumo = {
  periodo: string;
  intervalo: { de: string; ate: string };
  fuso: string;
  consolidado: {
    pessoas: number; comJornadaPrevista: number; diasTrabalhados: number;
    minutosTrabalhados: number; minutosExtras: number; minutosAtraso: number;
    diasAtraso: number; faltas: number; intervalosIrregulares: number;
    minutosPrevistos: number | null;
  };
  porDepartamento: Departamento[];
  pessoas: Pessoa[];
};

/** Minutos → "12h30". Devolve "—" quando não há número. */
function hm(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  if (m === 0) return '0h';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, '0')}`;
}

const mesAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function GestaoTempoPainel() {
  const [periodo, setPeriodo] = useState(mesAtual);
  const [dados, setDados] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (p: string) => {
    setCarregando(true);
    setErro(null);
    try {
      const { data } = await api.get<Resumo>('/rh/gestao-tempo/resumo', { params: { periodo: p } });
      // `api.get` já devolve `{ data }` (api.ts). Desembrulhar de novo com
      // `(r as any).data ?? r` pegava o corpo CRU e, como o resumo não tem
      // chave `data`, caía no `?? r` — funcionando por acidente. Se o
      // endpoint passasse a devolver `{ data: ... }` dentro do corpo, a tela
      // leria a camada errada e os KPIs zerariam sem erro visível.
      setDados(data);
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível ler o resumo de jornada.');
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(periodo); }, [periodo, carregar]);

  // Todos os tons neutros vêm do tema global. Assim, cartões, texto, tabela e
  // controles acompanham automaticamente data-theme="claro" e o tema escuro.
  const card = 'rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)] p-4';
  const kpiRot = 'text-[10px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-2)]';
  const kpiVal = 'mt-1 text-[20px] font-bold text-[var(--nx-ink)]';
  const textoSecundario = 'text-[var(--nx-ink-2)]';
  const textoSuave = 'text-[var(--nx-ink-3)]';
  const tabelaCabecalho = 'sticky top-0 bg-[var(--nx-surface-2)] text-[10px] uppercase tracking-wide text-[var(--nx-ink-2)]';
  const tabelaCorpo = 'text-[var(--nx-ink)]';
  const bordaLinha = 'border-t border-[var(--nx-border)]';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-bold text-[var(--nx-ink)]">Gestão de Tempo</h3>
          <p className={`mt-0.5 text-[11px] ${textoSecundario}`}>
            Jornada prevista x registrada, a partir do Espelho de Ponto. Nenhum registro é criado aqui.
          </p>
        </div>
        <input
          type="month"
          value={periodo}
          max={mesAtual()}
          onChange={(e) => setPeriodo(e.target.value)}
          className="h-[36px] rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-3 text-[12px] text-[var(--nx-ink)] outline-none transition focus:border-[var(--nx-accent)]"
        />
      </div>

      {erro && (
        <p className="rounded-[12px] border border-[var(--nx-red)] bg-[var(--nx-surface)] p-3 text-[12px] text-[var(--nx-red)]">
          {erro}
        </p>
      )}

      {carregando ? (
        <p className={`text-[12px] ${textoSecundario}`}>Carregando jornada do período…</p>
      ) : dados ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={card}>
              <p className={kpiRot}>Jornada prevista</p>
              <p className={kpiVal}>{hm(dados.consolidado.minutosPrevistos)}</p>
              {dados.consolidado.minutosPrevistos === null ? (
                <p className="mt-1 text-[10px] text-[var(--nx-amber)]">
                  Nenhum horário previsto cadastrado. A comparação não foi feita.
                </p>
              ) : (
                <p className={`mt-1 text-[10px] ${textoSuave}`}>
                  {dados.consolidado.comJornadaPrevista} de {dados.consolidado.pessoas} com horário
                </p>
              )}
            </div>
            <div className={card}>
              <p className={kpiRot}>Horas trabalhadas</p>
              <p className={kpiVal}>{hm(dados.consolidado.minutosTrabalhados)}</p>
              <p className={`mt-1 text-[10px] ${textoSuave}`}>{dados.consolidado.diasTrabalhados} dias com batida</p>
            </div>
            <div className={card}>
              <p className={kpiRot}>Horas extras</p>
              <p className={kpiVal} style={{ color: dados.consolidado.minutosExtras > 0 ? 'var(--nx-amber)' : undefined }}>
                {hm(dados.consolidado.minutosExtras)}
              </p>
              <p className={`mt-1 text-[10px] ${textoSuave}`}>Somadas no período</p>
            </div>
            <div className={card}>
              <p className={kpiRot}>Atrasos</p>
              <p className={kpiVal}>{hm(dados.consolidado.minutosAtraso)}</p>
              <p className={`mt-1 text-[10px] ${textoSuave}`}>
                {dados.consolidado.diasAtraso} dia(s) • {dados.consolidado.faltas} falta(s)
              </p>
            </div>
            <div className={card}>
              <p className={kpiRot}>Intervalos</p>
              <p className={kpiVal}>{dados.consolidado.intervalosIrregulares}</p>
              <p className={`mt-1 text-[10px] ${textoSuave}`}>Fora do padrão de referência</p>
            </div>
            <div className={card}>
              <p className={kpiRot}>Dias trabalhados</p>
              <p className={kpiVal}>{dados.consolidado.diasTrabalhados}</p>
              <p className={`mt-1 text-[10px] ${textoSuave}`}>Dias com batida registrada</p>
            </div>
          </div>

          {/* O texto de atenção é sobre o DEPARTAMENTO, nunca sobre a pessoa. */}
          {dados.porDepartamento.filter((d) => d.minutosExtras > 0).length > 0 && (
            <div className={card}>
              <p className={kpiRot}>Atenção</p>
              <ul className="mt-2 space-y-1.5">
                {dados.porDepartamento.filter((d) => d.minutosExtras > 0).map((d) => (
                  <li key={d.nome} className={`text-[12px] ${textoSecundario}`}>
                    Foram identificadas <strong className="text-[var(--nx-ink)]">{hm(d.minutosExtras)}</strong> de hora
                    extra no período para <strong className="text-[var(--nx-ink)]">{d.nome}</strong>
                    ({d.pessoas} pessoa(s)).
                  </li>
                ))}
              </ul>
              <p className={`mt-2 text-[10.5px] ${textoSuave}`}>
                Este é um dado do departamento. O NEXUS não o converte em conclusão sobre as pessoas
                que trabalham nele.
              </p>
            </div>
          )}

          <div className={card}>
            <p className={kpiRot}>Por departamento</p>
            {dados.porDepartamento.length === 0 ? (
              <p className={`mt-2 text-[12px] ${textoSecundario}`}>Nenhum departamento com pessoas ativas.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className={tabelaCabecalho}>
                    <tr>
                      <th className="py-2 pr-3 font-bold">Departamento</th>
                      <th className="py-2 pr-3 font-bold">Pessoas</th>
                      <th className="py-2 pr-3 font-bold">Previsto</th>
                      <th className="py-2 pr-3 font-bold">Trabalhado</th>
                      <th className="py-2 pr-3 font-bold">Extras</th>
                      <th className="py-2 pr-3 font-bold">Atraso</th>
                      <th className="py-2 font-bold">Faltas</th>
                    </tr>
                  </thead>
                  <tbody className={tabelaCorpo}>
                    {dados.porDepartamento.map((d) => (
                      <tr key={d.nome} className={bordaLinha}>
                        <td className="py-2 pr-3 font-bold text-[var(--nx-ink)]">{d.nome}</td>
                        <td className="py-2 pr-3">{d.pessoas}</td>
                        <td className="py-2 pr-3">{hm(d.minutosPrevistos)}</td>
                        <td className="py-2 pr-3">{hm(d.minutosTrabalhados)}</td>
                        <td className="py-2 pr-3" style={{ color: d.minutosExtras > 0 ? 'var(--nx-amber)' : undefined }}>
                          {hm(d.minutosExtras)}
                        </td>
                        <td className="py-2 pr-3">{hm(d.minutosAtraso)}</td>
                        <td className="py-2">{d.faltas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={card}>
            <p className={kpiRot}>Por funcionário</p>
            {dados.pessoas.length === 0 ? (
              <p className={`mt-2 text-[12px] ${textoSecundario}`}>Nenhum funcionário ativo.</p>
            ) : (
              <div className="mt-2 max-h-[420px] overflow-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className={tabelaCabecalho}>
                    <tr>
                      <th className="py-2 pr-3 font-bold">Funcionário</th>
                      <th className="py-2 pr-3 font-bold">Previsto</th>
                      <th className="py-2 pr-3 font-bold">Trabalhado</th>
                      <th className="py-2 pr-3 font-bold">Extras</th>
                      <th className="py-2 pr-3 font-bold">Atrasos</th>
                      <th className="py-2 pr-3 font-bold">Intervalos</th>
                      <th className="py-2 font-bold">Dias</th>
                    </tr>
                  </thead>
                  <tbody className={tabelaCorpo}>
                    {dados.pessoas.map((p) => (
                      <tr key={p.funcionarioId} className={bordaLinha}>
                        <td className="py-2 pr-3">
                          <span className="font-bold text-[var(--nx-ink)]">{p.nome}</span>
                          {p.departamento && <span className={`ml-1 text-[10px] ${textoSuave}`}>{p.departamento}</span>}
                        </td>
                        <td className="py-2 pr-3">
                          {p.temJornadaPrevista ? hm(p.minutosPrevistos) : <span className={textoSuave}>sem horário</span>}
                        </td>
                        <td className="py-2 pr-3">{hm(p.minutosTrabalhados)}</td>
                        <td className="py-2 pr-3" style={{ color: p.minutosExtras > 0 ? 'var(--nx-amber)' : undefined }}>
                          {hm(p.minutosExtras)}
                        </td>
                        <td className="py-2 pr-3">
                          {hm(p.minutosAtraso)}
                          {p.diasAtraso > 0 && <span className={`ml-1 text-[10px] ${textoSuave}`}>{p.diasAtraso}d</span>}
                        </td>
                        <td className="py-2 pr-3">{p.intervalosIrregulares}</td>
                        <td className="py-2">{p.diasTrabalhados}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={`mt-2 text-[10.5px] ${textoSuave}`}>
              Estas linhas são números do Espelho de Ponto. Nenhuma delas é avaliação de desempenho.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
