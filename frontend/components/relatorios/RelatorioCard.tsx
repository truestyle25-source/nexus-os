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

  // Chart.js: cores sincronizadas automaticamente com o tema do NEXUS OS.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grafico || grafico.labels.length === 0) return;

    const ehDoughnut = grafico.tipo === 'doughnut';
    const ehBarra = grafico.tipo === 'bar';

    const lerCores = () => {
      const estilo = getComputedStyle(document.documentElement);
      const ler = (token: string, fallback: string) =>
        estilo.getPropertyValue(token).trim() || fallback;

      return {
        surface: ler('--nx-surface', '#15151f'),
        surface2: ler('--nx-surface-2', '#1c1c2a'),
        border: ler('--nx-border', '#2a2a3a'),
        borderStrong: ler('--nx-border-strong', '#3a3a4a'),
        ink: ler('--nx-ink', '#f4f4f5'),
        ink2: ler('--nx-ink-2', '#c1c1cc'),
        ink3: ler('--nx-ink-3', '#8888a0'),
        accent: ler('--nx-accent', CORES_IA[0]),
        green: ler('--nx-green', CORES_IA[1]),
        amber: ler('--nx-amber', CORES_IA[2]),
        red: ler('--nx-red', CORES_IA[3]),
      };
    };

    const corComAlpha = (cor: string, alpha: number) => {
      const hex = cor.startsWith('#') ? cor.slice(1) : '';

      if (hex.length !== 3 && hex.length !== 6) return cor;

      const completo = hex.length === 3
        ? hex.split('').map((parte) => parte + parte).join('')
        : hex;

      const numero = parseInt(completo, 16);
      const r = (numero >> 16) & 255;
      const g = (numero >> 8) & 255;
      const b = numero & 255;

      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const coresIniciais = lerCores();
    const paleta = [
      coresIniciais.accent,
      coresIniciais.green,
      coresIniciais.amber,
      coresIniciais.red,
    ];

    const config = {
      type: grafico.tipo,
      data: {
        labels: grafico.labels,
        datasets: [
          {
            label: relatorio.titulo,
            data: grafico.values,
            backgroundColor: ehDoughnut
              ? grafico.labels.map((_, i) => paleta[i % paleta.length])
              : ehBarra
                ? corComAlpha(coresIniciais.accent, 0.85)
                : corComAlpha(coresIniciais.accent, 0.15),
            borderColor: ehDoughnut ? coresIniciais.surface : coresIniciais.accent,
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
            labels: {
              color: coresIniciais.ink3,
              boxWidth: 10,
              font: { size: 11 },
            },
          },
          tooltip: {
            backgroundColor: coresIniciais.surface2,
            titleColor: coresIniciais.ink,
            bodyColor: coresIniciais.ink2,
            borderColor: coresIniciais.borderStrong,
            borderWidth: 1,
          },
        },
        scales: ehDoughnut
          ? {}
          : {
              x: {
                ticks: { color: coresIniciais.ink3, font: { size: 10 } },
                grid: { color: coresIniciais.border },
              },
              y: {
                beginAtZero: true,
                ticks: { color: coresIniciais.ink3, font: { size: 10 } },
                grid: { color: coresIniciais.border },
              },
            },
      },
    };

    chartRef.current?.destroy();
    chartRef.current = new Chart(canvas, config as never);

    const atualizarCoresGraficos = () => {
      const chart = chartRef.current;
      if (!chart) return;

      const cores = lerCores();
      const dataset = chart.data.datasets[0];

      if (dataset) {
        dataset.backgroundColor = ehDoughnut
          ? grafico.labels.map((_, i) => {
              const coresPaleta = [cores.accent, cores.green, cores.amber, cores.red];
              return coresPaleta[i % coresPaleta.length];
            })
          : ehBarra
            ? corComAlpha(cores.accent, 0.85)
            : corComAlpha(cores.accent, 0.15);

        dataset.borderColor = ehDoughnut ? cores.surface : cores.accent;
      }

      const legenda = chart.options.plugins?.legend?.labels;

      if (legenda && typeof legenda !== 'boolean') {
        legenda.color = cores.ink3;
      }

      const tooltip = chart.options.plugins?.tooltip;

      if (tooltip && typeof tooltip !== 'boolean') {
        tooltip.backgroundColor = cores.surface2;
        tooltip.titleColor = cores.ink;
        tooltip.bodyColor = cores.ink2;
        tooltip.borderColor = cores.borderStrong;
      }

      const escalas = chart.options.scales;

      if (escalas?.x) {
        if (escalas.x.ticks) {
          escalas.x.ticks.color = cores.ink3;
        }

        if (escalas.x.grid) {
          escalas.x.grid.color = cores.border;
        }
      }

      if (escalas?.y) {
        if (escalas.y.ticks) {
          escalas.y.ticks.color = cores.ink3;
        }

        if (escalas.y.grid) {
          escalas.y.grid.color = cores.border;
        }
      }

      chart.update('none');
    };

    let frame: number | null = null;

    const observador = new MutationObserver(() => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }

      frame = requestAnimationFrame(() => {
        frame = null;
        atualizarCoresGraficos();
      });
    });

    const opcoes: MutationObserverInit = {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    };

    observador.observe(document.documentElement, opcoes);

    if (document.body) {
      observador.observe(document.body, opcoes);
    }

    atualizarCoresGraficos();

    return () => {
      observador.disconnect();

      if (frame !== null) {
        cancelAnimationFrame(frame);
      }

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
  .rc-card {
    background: var(--nx-surface, #15151f);
    border: 1px solid var(--nx-border, #2a2a3a);
    border-radius: 16px;
    overflow: hidden;
  }
  .rc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 13px 18px;
    flex-wrap: wrap;
    background: linear-gradient(135deg,
      color-mix(in srgb, var(--nx-accent) 8%, var(--nx-surface-2)),
      var(--nx-surface-2));
    border-bottom: 1px solid var(--nx-border);
  }
  .rc-head-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .rc-ia-chip {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    flex-shrink: 0;
    background: var(--nx-accent);
    display: grid;
    place-items: center;
    color: var(--nx-accent-ink, #fff);
    font-size: 14px;
  }
  .rc-gen {
    font-size: 11px;
    font-weight: 700;
    color: var(--nx-accent-ink, var(--nx-accent));
    letter-spacing: 0.05em;
  }
  .rc-exemplo {
    display: inline-block;
    margin-left: 8px;
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--nx-amber) 12%, var(--nx-surface));
    border: 1px solid color-mix(in srgb, var(--nx-amber) 40%, var(--nx-border));
    color: var(--nx-amber);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0;
  }
  .rc-time { font-size: 11px; color: var(--nx-ink-3); white-space: nowrap; }
  .rc-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
  .rc-perg { font-size: 12px; color: var(--nx-ink-2); font-style: italic; margin: 0; }
  .rc-title { font-size: 16px; font-weight: 700; color: var(--nx-ink); margin: 0; line-height: 1.35; }
  .rc-resumo { font-size: 13px; line-height: 1.55; color: var(--nx-ink-2); margin: 0; }
  .rc-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .rc-kpi {
    background: var(--nx-surface-2);
    border: 1px solid var(--nx-border);
    border-radius: 12px;
    padding: 12px 14px;
    min-width: 0;
  }
  .rc-kpi-label {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--nx-ink-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rc-kpi-valor {
    font-size: 17px;
    font-weight: 700;
    color: var(--nx-ink);
    margin-top: 4px;
    word-break: break-word;
  }
  .rc-kpi-delta { font-size: 11px; margin-top: 3px; }
  .rc-kpi-delta.up { color: var(--nx-green); }
  .rc-kpi-delta.down { color: var(--nx-red); }
  @media (max-width: 900px) {
    .rc-kpis { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 480px) {
    .rc-kpis { grid-template-columns: 1fr; }
    .rc-body { padding: 14px; }
  }
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
  .rc-panel {
    background: var(--nx-surface-2);
    border: 1px solid var(--nx-border);
    border-radius: 12px;
    padding: 14px;
    min-width: 0;
  }
  .rc-panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }
  .rc-panel-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--nx-accent-ink, var(--nx-accent));
  }
  .rc-panel-sub { font-size: 11px; color: var(--nx-ink-3); }
  .rc-chart-wrap { position: relative; height: 240px; }
  .rc-empty { font-size: 12px; color: var(--nx-ink-3); margin: 0; }
  .rc-insights {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rc-insights li {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--nx-ink-2);
    background: color-mix(in srgb, var(--nx-accent) 10%, var(--nx-surface));
    border: 1px solid color-mix(in srgb, var(--nx-accent) 28%, var(--nx-border));
    border-radius: 10px;
    padding: 9px 12px;
  }
  .rc-insights li.rc-empty {
    background: none;
    border: none;
    color: var(--nx-ink-3);
    padding: 0;
  }
  .rc-table-wrap {
    overflow: auto;
    max-height: 320px;
    border: 1px solid var(--nx-border);
    border-radius: 10px;
  }
  .rc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .rc-table th {
    position: sticky;
    top: 0;
    background: var(--nx-surface-3);
    color: var(--nx-ink);
    text-align: left;
    font-weight: 600;
    padding: 9px 12px;
    white-space: nowrap;
  }
  .rc-table td {
    padding: 8px 12px;
    border-top: 1px solid var(--nx-border);
    color: var(--nx-ink-2);
    white-space: nowrap;
  }
  .rc-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .rc-table tbody tr:hover td {
    background: color-mix(in srgb, var(--nx-accent) 8%, var(--nx-surface));
  }
  .rc-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .rc-foot-info { display: flex; gap: 10px; flex-wrap: wrap; min-width: 0; }
  .rc-fallback { font-size: 11px; color: var(--nx-amber); }
  .rc-erro-export { font-size: 11px; color: var(--nx-red); }
  .rc-actions { display: flex; gap: 8px; }
  .rc-btn {
    height: 34px;
    padding: 0 16px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: filter 0.15s ease, background 0.15s ease;
  }
  .rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .rc-btn-ghost {
    background: var(--nx-surface-2);
    border: 1px solid var(--nx-border);
    color: var(--nx-ink-2);
  }
  .rc-btn-ghost:hover:not(:disabled) { background: var(--nx-surface-3); }
  .rc-btn-primary {
    background: var(--nx-accent);
    border: 1px solid var(--nx-accent);
    color: var(--nx-accent-ink, #fff);
  }
  .rc-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
  @media (max-width: 860px) {
    .rc-grid2 { grid-template-columns: 1fr; }
  }
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