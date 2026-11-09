'use client';

import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import api from '@/lib/api';

export interface KpiItem {
  label: string;
  valor: string;
  delta: string;
  subiu: boolean;
}

export interface GraficoRelatorio {
  tipo: 'doughnut' | 'bar' | 'line';
  labels: string[];
  values: number[];
}

export interface RelatorioGerado {
  id: string;
  empresaId: string;
  perguntaOriginal: string;
  titulo: string;
  tipo: string;
  dados: {
    resumo?: string;
    kpis?: KpiItem[];
    tabela?: Array<Record<string, string | number>>;
    grafico?: GraficoRelatorio;
    fonte?: string;
    periodo?: { de: string | null; ate: string | null };
    fallback?: boolean;
  };
  insights: string[];
  criadoEm: string;
  /** true = card de exemplo local (não vem do backend, não exporta). */
  exemplo?: boolean;
}

/** Paleta da IA: ['#7c3aed', '#22c55e', '#f59e0b', '#ef4444']. */
const CORES_IA = ['#7c3aed', '#22c55e', '#f59e0b', '#ef4444'];

function formatarCelula(v: string | number): string {
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  return v;
}

/** base64 (do backend) → Blob → download nativo do navegador. */
async function baixarBase64(base64: string, nome: string): Promise<void> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function RelatorioCard({ relatorio }: { relatorio: RelatorioGerado }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const [exportando, setExportando] = useState<'excel' | 'csv' | null>(null);
  const [erroExport, setErroExport] = useState<string | null>(null);

  const { kpis = [], tabela = [], grafico } = relatorio.dados;
  const insights = relatorio.insights ?? [];
  const colunas = tabela.length > 0 ? Object.keys(tabela[0]) : [];

  // Chart.js: recria por relatório e destrói no cleanup (sem vazamento).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grafico || grafico.labels.length === 0) return;

    const ehDoughnut = grafico.tipo === 'doughnut';
    const ehBarra = grafico.tipo === 'bar';

    const config = {
      type: grafico.tipo,
      data: {
        labels: grafico.labels,
        datasets: [
          {
            label: relatorio.titulo,
            data: grafico.values,
            backgroundColor: ehDoughnut
              ? grafico.labels.map((_, i) => CORES_IA[i % CORES_IA.length])
              : ehBarra
                ? 'rgba(124, 58, 237, 0.85)'
                : 'rgba(124, 58, 237, 0.15)',
            borderColor: ehDoughnut ? '#15152b' : '#7c3aed',
            borderWidth: ehDoughnut ? 2 : ehBarra ? 0 : 2,
            borderRadius: ehBarra ? 6 : 0,
            fill: !ehDoughnut && !ehBarra,
            tension: 0.35,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: ehDoughnut,
            position: 'bottom' as const,
            labels: { color: '#b9b9d0', boxWidth: 10, font: { size: 11 } },
          },
          tooltip: {
            backgroundColor: '#23233f',
            titleColor: '#ffffff',
            bodyColor: '#dddddd',
            borderColor: '#3a3a6a',
            borderWidth: 1,
          },
        },
        scales: ehDoughnut
          ? {}
          : {
              x: {
                ticks: { color: '#7b7b9a', font: { size: 10 } },
                grid: { color: 'rgba(255,255,255,0.05)' },
              },
              y: {
                beginAtZero: true,
                ticks: { color: '#7b7b9a', font: { size: 10 } },
                grid: { color: 'rgba(255,255,255,0.06)' },
              },
            },
      },
    };

    chartRef.current = new Chart(canvas, config as never);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [relatorio, grafico]);

  /** POST /relatorios/export → { base64, nome } → atob → blob → download. */
  async function exportar(formato: 'excel' | 'csv') {
    setExportando(formato);
    setErroExport(null);
    try {
      const { data } = await api.post<{ base64: string; nome: string }>('/relatorios/export', {
        formato,
        relatorioId: relatorio.id,
      });
      await baixarBase64(data.base64, data.nome);
    } catch (e: unknown) {
      setErroExport(e instanceof Error ? e.message : 'Falha ao exportar o relatório.');
    } finally {
      setExportando(null);
    }
  }

  return (
    <article className="rc-card">
      <style>{`
        .rc-card { background: #15152b; border: 1px solid #23233f; border-radius: 16px; overflow: hidden; }
        .rc-head {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 13px 18px; flex-wrap: wrap;
          background: linear-gradient(135deg, #1c1c3a, #252550);
          border-bottom: 1px solid #3a3a6a;
        }
        .rc-head-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .rc-ia-chip {
          width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          display: grid; place-items: center; color: #ffffff; font-size: 14px;
        }
        .rc-gen { font-size: 11px; font-weight: 700; color: #a78bfa; letter-spacing: 0.05em; }
        .rc-exemplo {
          display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 999px;
          background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4);
          color: #f59e0b; font-size: 10px; font-weight: 700; letter-spacing: 0;
        }
        .rc-time { font-size: 11px; color: #7b7b9a; white-space: nowrap; }
        .rc-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
        .rc-perg { font-size: 12px; color: #8a8ab0; font-style: italic; margin: 0; }
        .rc-title { font-size: 16px; font-weight: 700; color: #ffffff; margin: 0; line-height: 1.35; }
        .rc-resumo { font-size: 13px; line-height: 1.55; color: #b9b9d0; margin: 0; }
        .rc-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
        .rc-kpi { background: #23233f; border: 1px solid #2e2e52; border-radius: 12px; padding: 12px 14px; min-width: 0; }
        .rc-kpi-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #7b7b9a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rc-kpi-valor { font-size: 17px; font-weight: 700; color: #ffffff; margin-top: 4px; word-break: break-word; }
        .rc-kpi-delta { font-size: 11px; margin-top: 3px; }
        .rc-kpi-delta.up { color: var(--nx-green); }
        .rc-kpi-delta.down { color: #ef4444; }
        @media (max-width: 900px) { .rc-kpis { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 480px) { .rc-kpis { grid-template-columns: 1fr; } }
      `}</style>

      <header className="rc-head">
        <div className="rc-head-left">
          <span className="rc-ia-chip" aria-hidden="true">✦</span>
          <div className="rc-gen">
            GERADO POR IA NEXUS
            {relatorio.exemplo && <span className="rc-exemplo">EXEMPLO — sem números fictícios</span>}
          </div>
        </div>
        <span className="rc-time">
          {relatorio.criadoEm ? new Date(relatorio.criadoEm).toLocaleString('pt-BR') : ''}
        </span>
      </header>

      <div className="rc-body">
        {relatorio.perguntaOriginal ? (
          <p className="rc-perg">“{relatorio.perguntaOriginal}”</p>
        ) : null}
        <h3 className="rc-title">{relatorio.titulo}</h3>
        {relatorio.dados.resumo ? (
          <p className="rc-resumo">{relatorio.dados.resumo}</p>
        ) : null}

        {kpis.length > 0 && (
          <div className="rc-kpis">
            {kpis.slice(0, 4).map((k, i) => (
              <div className="rc-kpi" key={`${k.label}-${i}`}>
                <div className="rc-kpi-label">{k.label}</div>
                <div className="rc-kpi-valor">{k.valor}</div>
                <div className={`rc-kpi-delta ${k.subiu ? 'up' : 'down'}`}>
                  {k.subiu ? '▲' : '▼'} {k.delta}
                </div>
              </div>
            ))}
          </div>
        )}
        <style>{`
          .rc-grid2 { display: grid; grid-template-columns: 1.5fr 1fr; gap: 14px; }
          .rc-panel { background: #111124; border: 1px solid #23233f; border-radius: 12px; padding: 14px; min-width: 0; }
          .rc-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
          .rc-panel-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #a78bfa; }
          .rc-panel-sub { font-size: 11px; color: #7b7b9a; }
          .rc-chart-wrap { position: relative; height: 240px; }
          .rc-empty { font-size: 12px; color: #7b7b9a; margin: 0; }
          .rc-insights { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
          .rc-insights li {
            font-size: 12.5px; line-height: 1.5; color: #c9c9e2;
            background: rgba(124, 58, 237, 0.10); border: 1px solid rgba(124, 58, 237, 0.3);
            border-radius: 10px; padding: 9px 12px;
          }
          .rc-insights li.rc-empty { background: none; border: none; color: #7b7b9a; padding: 0; }
          .rc-table-wrap { overflow: auto; max-height: 320px; border: 1px solid #23233f; border-radius: 10px; }
          .rc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
          .rc-table th {
            position: sticky; top: 0; background: #23233f; color: #a7b0d0;
            text-align: left; font-weight: 600; padding: 9px 12px; white-space: nowrap;
          }
          .rc-table td { padding: 8px 12px; border-top: 1px solid #23233f; color: #c7c7dc; white-space: nowrap; }
          .rc-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
          .rc-table tbody tr:hover td { background: rgba(124, 58, 237, 0.08); }
          .rc-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
          .rc-foot-info { display: flex; gap: 10px; flex-wrap: wrap; min-width: 0; }
          .rc-fallback { font-size: 11px; color: #f59e0b; }
          .rc-erro-export { font-size: 11px; color: #ef4444; }
          .rc-actions { display: flex; gap: 8px; }
          .rc-btn { height: 34px; padding: 0 16px; border-radius: 10px; font-size: 12px; font-weight: 600; cursor: pointer; transition: filter 0.15s ease, background 0.15s ease; }
          .rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .rc-btn-ghost { background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); color: #d6d6e6; }
          .rc-btn-ghost:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); }
          .rc-btn-primary { background: linear-gradient(135deg, #7c3aed, #4f46e5); border: none; color: #ffffff; }
          .rc-btn-primary:hover:not(:disabled) { filter: brightness(1.12); }
          @media (max-width: 860px) { .rc-grid2 { grid-template-columns: 1fr; } }
        `}</style>
        <div className="rc-grid2">
          <div className="rc-panel">
            <div className="rc-panel-head">
              <span className="rc-panel-title">Gráfico</span>
              <span className="rc-panel-sub">{grafico ? grafico.tipo : ''}</span>
            </div>
            <div className="rc-chart-wrap">
              {grafico && grafico.labels.length > 0 ? (
                <canvas ref={canvasRef} aria-label="Gráfico do relatório" />
              ) : (
                <p className="rc-empty">Sem dados suficientes para gráfico no período.</p>
              )}
            </div>
          </div>
          <div className="rc-panel">
            <div className="rc-panel-head">
              <span className="rc-panel-title">Insights da IA</span>
            </div>
            <ul className="rc-insights">
              {insights.length > 0 ? (
                insights.map((t, i) => <li key={i}>{t}</li>)
              ) : (
                <li className="rc-empty">Nenhum insight gerado.</li>
              )}
            </ul>
          </div>
        </div>

        {tabela.length > 0 && (
          <div className="rc-panel">
            <div className="rc-panel-head">
              <span className="rc-panel-title">Detalhamento</span>
              <span className="rc-panel-sub">{tabela.length} linhas</span>
            </div>
            <div className="rc-table-wrap">
              <table className="rc-table">
                <thead>
                  <tr>
                    {colunas.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabela.map((linha, i) => (
                    <tr key={i}>
                      {colunas.map((c) => (
                        <td key={c} className={typeof linha[c] === 'number' ? 'num' : undefined}>
                          {formatarCelula(linha[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <footer className="rc-foot">
          <div className="rc-foot-info">
            {relatorio.dados.fallback && (
              <span className="rc-fallback">Estrutura local (Gemini indisponível)</span>
            )}
            {erroExport && <span className="rc-erro-export">{erroExport}</span>}
          </div>
          <div className="rc-actions">
            <button
              className="rc-btn rc-btn-ghost"
              type="button"
              onClick={() => void exportar('csv')}
              disabled={exportando !== null || relatorio.exemplo === true}
            >
              {exportando === 'csv' ? 'Exportando…' : 'CSV'}
            </button>
            <button
              className="rc-btn rc-btn-primary"
              type="button"
              onClick={() => void exportar('excel')}
              disabled={exportando !== null || relatorio.exemplo === true}
            >
              {exportando === 'excel' ? 'Exportando…' : 'Excel'}
            </button>
          </div>
        </footer>
      </div>
    </article>
  );
}