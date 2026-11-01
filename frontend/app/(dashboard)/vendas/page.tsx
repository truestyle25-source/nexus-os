'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  CreditCard,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Package,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  TrendingUp,
  User,
  X,
} from 'lucide-react';
import api, { getToken } from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';
import Badge, { toneForStatus } from '@/components/ui/Badge';
import DataTable, { type DataColumn } from '@/components/ui/DataTable';
import KpiCard from '@/components/ui/KpiCard';
import TabsPill from '@/components/ui/TabsPill';
import { formatBRL, formatDate, formatDateTime, formatPct, formatTime, shortId } from '@/lib/format';
import { t as traduzir, tMenu } from '@/lib/i18n';

/**
 * CSS local (mesmo padrão do PDV): o visual do layout de referência —
 * pílulas de filtro, linha clicável, drawer lateral e impressão do cupom —
 * fica aqui, sem espalhar regra específica desta tela em globals.css.
 */
const vendasCss = `
.vendas-root input, .vendas-root select { transition: border-color .15s ease, box-shadow .15s ease; }
.vendas-root input:focus, .vendas-root select:focus { outline: none; border-color: rgba(var(--nx-accent-rgb), .6); box-shadow: 0 0 0 3px rgba(var(--nx-accent-rgb), .18); }
.vendas-filtro { height: 38px; border-radius: 999px; background: #121221; border: 1px solid rgba(255,255,255,.08); padding: 0 14px; font-size: 12.5px; color: rgba(255,255,255,.78); }
.vendas-filtro option { background: #121221; color: #f4f2fb; }
.vendas-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 999px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); color: rgba(255,255,255,.55); transition: all .15s ease; }
.vendas-icon-btn:hover:not(:disabled) { color: #fff; background: rgba(124,92,240,.18); border-color: rgba(124,92,240,.45); }
.vendas-icon-btn:disabled { opacity: .3; cursor: not-allowed; }
.vendas-pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 999px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.06); color: rgba(255,255,255,.7); font-size: 11px; }
.vendas-btn-claro { height: 38px; padding: 0 14px; border-radius: 999px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.08); color: rgba(255,255,255,.85); font-size: 12.5px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; transition: all .15s ease; }
.vendas-btn-claro:hover:not(:disabled) { background: rgba(255,255,255,.1); }
.vendas-btn-branco { height: 38px; padding: 0 14px; border-radius: 999px; background: #fff; color: #0b0911; font-size: 12.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; transition: all .15s ease; }
.vendas-btn-branco:hover:not(:disabled) { background: rgba(255,255,255,.9); }
.vendas-btn-claro:disabled, .vendas-btn-branco:disabled { opacity: .45; cursor: not-allowed; }
.vendas-drawer { animation: vendasSlide .22s cubic-bezier(.2,.9,.3,1.05) both; }
@keyframes vendasSlide { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
.vendas-modal { animation: vendasPop .2s cubic-bezier(.2,.9,.3,1.15) both; }
@keyframes vendasPop { from { opacity: 0; transform: scale(.96) translateY(10px); } to { opacity: 1; transform: none; } }
/* Impressão: sai só o detalhe da venda — o restante da tela e os controles
   de navegação saem, mas o drawer de venda continua visível e formatado como
   o comprovante impresso. */
@media print {
  header, .vendas-noprint, .vendas-drawer-backdrop { display: none !important; }
  main { overflow: visible !important; height: auto !important; }
  body * { visibility: hidden !important; }
  .vendas-drawer-root, .vendas-drawer-root * { visibility: visible !important; }
  .vendas-drawer-root { position: static !important; display: block !important; inset: auto !important; }
  .vendas-print-area { position: static !important; width: 100% !important; max-width: none !important; height: auto !important; overflow: visible !important; border: 0 !important; box-shadow: none !important; background: #14111f !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

const POR_PAGINA = 20;

const PERIODOS = [
  { key: '1', label: 'Hoje' },
  { key: '7', label: '7 dias' },
  { key: '30', label: '30 dias' },
] as const;
type Periodo = (typeof PERIODOS)[number]['key'];

const STATUS_FILTRO = ['Todas', 'FINALIZADA', 'ABERTA', 'CANCELADA', 'ESTORNADA', 'DEVOLVIDA'] as const;
const PAGAMENTO_FILTRO = ['Todos', 'DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA'] as const;

const FORMA_LABEL: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'PIX',
  CARTAO_CREDITO: 'Cartão crédito',
  CARTAO_DEBITO: 'Cartão débito',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferência',
  OUTRO: 'Outro',
};

/** Colunas do arquivo exportado — as mesmas da tabela (inclui Vendedor). */
const COLUNAS_EXPORT = ['ID', 'Data', 'Hora', 'Cliente', 'Total', 'Pagamento', 'Status', 'Vendedor'];

function formaPagamentoLabel(f?: string | null): string {
  if (!f) return '—';
  return FORMA_LABEL[f] ?? f;
}

/**
 * O cliente HTTP do projeto (`lib/api.ts`) é baseado em `fetch` e lança
 * `Error` — não existe `err.response.data.error`. Isso era um bug silencioso
 * aqui: toda falha caía na mensagem genérica.
 */
function msgErro(err: unknown, padrao: string): string {
  const m = (err as { message?: unknown })?.message;
  return typeof m === 'string' && m.trim() ? m : padrao;
}

/** YYYY-MM-DD no fuso local (nunca UTC — senão o dia "pula"). */
function diaISO(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Janela do seletor Hoje/7 dias/30 dias: `de` e `ate` inclusivos. */
function intervaloPeriodo(dias: number): { de: string; ate: string } {
  const fim = new Date();
  fim.setHours(0, 0, 0, 0);
  const inicio = new Date(fim);
  inicio.setDate(inicio.getDate() - (dias - 1));
  return { de: diaISO(inicio), ate: diaISO(fim) };
}

function unidadesDaVenda(venda: { itens?: Array<{ quantidade?: number }> }): number {
  return (venda?.itens ?? []).reduce((soma, item) => soma + Number(item.quantidade || 0), 0);
}

/** Linha do arquivo exportado: as 8 colunas, na mesma ordem da tabela. */
function celulasExport(venda: any): string[] {
  return [
    venda?.id ?? '',
    formatDate(venda?.createdAt),
    formatTime(venda?.createdAt),
    venda?.cliente?.nome ?? '—',
    Number(venda?.total ?? 0).toFixed(2).replace('.', ','),
    formaPagamentoLabel(venda?.formaPagamento),
    venda?.status ?? '',
    venda?.vendedorNome ?? '—',
  ];
}

function campoCSV(valor: unknown): string {
  const s = valor == null ? '' : String(valor);
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escaparHtml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function baixarArquivo(partes: BlobPart[], tipo: string, nome: string): void {
  const url = URL.createObjectURL(new Blob(partes, { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** BOM (\uFEFF) para o Excel abrir os acentos corretamente. */
function exportarCSV(vendas: any[]): void {
  const linhas = vendas.map((v) => celulasExport(v).map(campoCSV).join(','));
  baixarArquivo(
    [`\uFEFF${[COLUNAS_EXPORT.join(','), ...linhas].join('\r\n')}`],
    'text/csv;charset=utf-8',
    `vendas-${Date.now()}.csv`,
  );
}

/**
 * Excel sem dependência nova: planilha HTML com extensão .xls, que o Excel e
 * o LibreOffice abrem nativamente — mesma ideia do botão do layout de
 * referência, mas com dado real. .xlsx binário ficaria como débito novo
 * (DEBITO-TECNICO.md item 23.5) por exigir biblioteca adicional.
 */
function exportarExcel(vendas: any[]): void {
  const th = COLUNAS_EXPORT.map((c) => `<th>${escaparHtml(c)}</th>`).join('');
  const tr = vendas
    .map((v) => `<tr>${celulasExport(v).map((c) => `<td>${escaparHtml(c)}</td>`).join('')}</tr>`)
    .join('');
  const html = `<html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></body></html>`;
  baixarArquivo([`\uFEFF${html}`], 'application/vnd.ms-excel;charset=utf-8', `vendas-${Date.now()}.xls`);
}

function StatusVendaBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-white/30">—</span>;
  return <Badge tone={toneForStatus(status)}>{status}</Badge>;
}

/** Passo do histórico do detalhe (timeline do layout de referência). */
function PassoHistorico({ label, time, done, hint }: { label: string; time: string; done: boolean; hint?: string }) {
  return (
    <div className="flex">
      <div className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500/15 border-emerald-500/20' : 'bg-white/[0.04] border-white/[0.06]'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${done ? 'bg-emerald-400' : 'bg-white/25'}`} />
      </div>
      <div className="pb-4 border-l border-dashed border-white/[0.08] ml-3 pl-4 -mt-1">
        <div className={`text-[12.5px] ${done ? 'text-white/85' : 'text-white/45'}`}>{label}</div>
        <div className="text-[11px] text-white/35 mono">{time}</div>
        {hint && <div className="text-[10.5px] text-white/25 mt-0.5 leading-relaxed">{hint}</div>}
      </div>
    </div>
  );
}

/**
 * Detalhe da venda (drawer lateral do layout de referência), com dado real de
 * `GET /vendas/:id`. O que o backend não tem fica explícito em vez de
 * inventado: troco e observação não existem no schema, e a NF-e depende de
 * integração fiscal (DEBITO-TECNICO.md item 23.1).
 */
function VendaDrawer({
  venda,
  produtos,
  carregando,
  podeEstornar,
  onClose,
  onImprimir,
  onEstornar,
}: {
  venda: any | null;
  produtos: any[];
  carregando: boolean;
  podeEstornar: boolean;
  onClose: () => void;
  onImprimir: () => void;
  onEstornar: (venda: any) => void;
}) {
  const nomeProduto = (produtoId: string) =>
    produtos.find((p: any) => p.id === produtoId)?.nome ?? `Produto ${shortId(produtoId)}`;
  const encerramento = venda && ['CANCELADA', 'ESTORNADA', 'DEVOLVIDA'].includes(venda.status) ? venda.status : null;

  return (
    <div className="vendas-drawer-root fixed inset-0 z-40 flex justify-end">
      <div className="vendas-drawer-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="vendas-drawer vendas-print-area relative w-full max-w-[460px] bg-[#1A1A2E] border-l border-white/[0.08] h-full overflow-auto nx-scroll shadow-2xl">
        <div className="sticky top-0 z-10 bg-[#1A1A2E] border-b border-white/[0.06] p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#7C3AED]/15 border border-[#7C3AED]/20 flex items-center justify-center text-[#A78BFA] shrink-0">
              <Receipt className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="mono text-[14px] font-bold truncate">#{shortId(venda?.id)}</div>
              <div className="text-[11px] text-white/40 flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {formatDate(venda?.createdAt)} • {formatTime(venda?.createdAt)}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="vendas-icon-btn vendas-noprint" aria-label="Fechar detalhe">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {carregando && !venda ? (
            <p className="text-[12.5px] text-white/40">Carregando venda…</p>
          ) : !venda ? null : (
            <>
              <StatusVendaBadge status={venda.status} />

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#121221] rounded-[12px] border border-white/[0.05] p-3 min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">{traduzir('cliente', "Cliente")}</div>
                  <div className="text-[13px] font-medium mt-1 flex items-center gap-1.5 min-w-0">
                    <User className="h-3 w-3 text-white/30 shrink-0" />
                    <span className="truncate">{venda.cliente?.nome ?? 'Consumidor não identificado'}</span>
                  </div>
                </div>
                <div className="bg-[#121221] rounded-[12px] border border-white/[0.05] p-3 min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">{traduzir('vendedor', "Vendedor")}</div>
                  <div className="text-[13px] font-medium mt-1 truncate">{venda.vendedorNome ?? '—'}</div>
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-white/35 mb-2">{traduzir('produtos', "Produtos")}</div>
                <div className="bg-[#121221] rounded-[12px] border border-white/[0.05] divide-y divide-white/[0.06]">
                  {(venda.itens ?? []).length === 0 ? (
                    <div className="p-3 text-[12px] text-white/35">{traduzir('nenhum_item_registrado', "Nenhum item registrado.")}</div>
                  ) : (
                    (venda.itens ?? []).map((item: any) => (
                      <div key={item.id ?? item.produtoId} className="p-3 flex justify-between gap-3 text-[12.5px]">
                        <span className="text-white/70 min-w-0 truncate">
                          {item.quantidade}x {nomeProduto(item.produtoId)}
                        </span>
                        <span className="mono text-white/90 shrink-0">{formatBRL(item.total)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="bg-[#121221] rounded-[12px] border border-white/[0.05] p-4 space-y-2 text-[13px]">
                <div className="flex justify-between text-white/50">
                  <span>{traduzir('subtotal', "Subtotal")}</span>
                  <span className="mono text-white/85">{formatBRL(venda.subtotal)}</span>
                </div>
                <div className="flex justify-between text-white/50">
                  <span>{traduzir('desconto', "Desconto")}</span>
                  <span className="mono text-emerald-300">- {formatBRL(venda.desconto)}</span>
                </div>
                <div className="h-px bg-white/[0.06] my-2" />
                <div className="flex justify-between font-semibold text-[15px]">
                  <span>{traduzir('total', "Total")}</span>
                  <span className="mono">{formatBRL(venda.total)}</span>
                </div>
                <div className="flex justify-between text-[12px] text-white/40">
                  <span>{traduzir('pagamento', "Pagamento")}</span>
                  <span className="text-white/75">{formaPagamentoLabel(venda.formaPagamento)}</span>
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-white/35 mb-2">Histórico</div>
                <div>
                  <PassoHistorico label="Venda criada" time={formatDateTime(venda.createdAt)} done />
                  <PassoHistorico
                    label="Pagamento confirmado"
                    time={venda.status === 'ABERTA' ? '—' : formatDateTime(venda.updatedAt ?? venda.createdAt)}
                    done={venda.status !== 'ABERTA'}
                  />
                  {encerramento && (
                    <PassoHistorico
                      label={`Venda ${encerramento.toLowerCase()}`}
                      time={formatDateTime(venda.updatedAt ?? venda.createdAt)}
                      done
                    />
                  )}
                  <PassoHistorico
                    label="NF-e emitida"
                    time="não disponível"
                    done={false}
                    hint="Depende da integração fiscal — débito registrado em DEBITO-TECNICO.md item 23.1."
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1 vendas-noprint">
                <button type="button" onClick={onImprimir} className="flex-1 h-10 rounded-full bg-white text-black text-[13px] font-semibold flex items-center justify-center gap-2 hover:bg-white/90 transition">
                  <Printer className="h-3.5 w-3.5" /> Imprimir
                </button>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  title="Ver NF-e — exige integração fiscal (DEBITO-TECNICO.md item 23.1)"
                  className="h-10 px-4 rounded-full bg-white/[0.06] border border-white/[0.06] text-[12.5px] text-white/40 flex items-center gap-1.5 opacity-60 cursor-not-allowed"
                >
                  <FileText className="h-3.5 w-3.5" /> NF-e{' '}
                  <span className="text-[10px] text-white/30">em breve</span>
                </button>
                {podeEstornar && venda.status === 'FINALIZADA' && (
                  <button
                    type="button"
                    onClick={() => onEstornar(venda)}
                    className="h-10 px-4 rounded-full bg-white/[0.06] border border-white/[0.06] text-[12.5px] text-white/80 hover:border-red-500/40 hover:text-red-300 flex items-center gap-1.5 transition"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Estornar
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * Modal de estorno (layout de referência): motivo obrigatório, escolha do que
 * estornar e aviso de irreversibilidade. O motivo vai para a movimentação de
 * estoque e para a auditoria — antes era fixo e não havia como registrar a
 * razão real do cancelamento.
 */
function EstornoModal({
  venda,
  enviando,
  onClose,
  onConfirmar,
}: {
  venda: any;
  enviando: boolean;
  onClose: () => void;
  onConfirmar: (dados: { motivo: string; estornarEstoque: boolean; estornarFinanceiro: boolean }) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [estornarEstoque, setEstornarEstoque] = useState(true);
  const [estornarFinanceiro, setEstornarFinanceiro] = useState(true);
  const valido = motivo.trim().length >= 3 && !enviando;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="vendas-modal relative w-full max-w-[420px] rounded-[20px] bg-[#1A1A2E] border border-white/[0.08] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="flex gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-red-500/15 border border-red-500/20 flex items-center justify-center text-red-300 shrink-0">
              <RotateCcw className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold">Estornar #{shortId(venda?.id)}</div>
              <div className="text-[11px] text-white/40 truncate">
                {venda?.cliente?.nome ?? 'Consumidor não identificado'} • {formatBRL(venda?.total)}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="vendas-icon-btn" aria-label="Fechar estorno">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="motivo-estorno" className="text-[11px] uppercase tracking-[0.14em] text-white/40">
              Motivo do estorno
            </label>
            <textarea
              id="motivo-estorno"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: produto com defeito, desistência do cliente..."
              className="mt-2 w-full min-h-[76px] rounded-[12px] bg-[#121221] border border-white/[0.08] p-3 text-[13px] text-white/85 placeholder:text-white/25 outline-none focus:border-red-400/40 resize-none"
            />
            <p className="text-[11px] text-white/30 mt-1">Use ao menos 3 caracteres — o motivo fica registrado na auditoria.</p>
          </div>

          <div className="rounded-[12px] bg-[#121221] border border-white/[0.05] p-3 space-y-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-[13px] text-white/80">Estornar estoque</span>
              <input
                type="checkbox"
                checked={estornarEstoque}
                onChange={(e) => setEstornarEstoque(e.target.checked)}
                className="w-4 h-4 accent-[#7C3AED]"
              />
            </label>
            <div className="h-px bg-white/[0.06]" />
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-[13px] text-white/80">Estornar financeiro</span>
              <input
                type="checkbox"
                checked={estornarFinanceiro}
                onChange={(e) => setEstornarFinanceiro(e.target.checked)}
                className="w-4 h-4 accent-[#7C3AED]"
              />
            </label>
            <p className="text-[11px] text-white/30 leading-relaxed">
              O estorno financeiro também reverte indicadores do dia, metas, agregados do cliente e o dinheiro na gaveta do turno.
            </p>
          </div>

          <div className="rounded-[10px] bg-amber-400/10 border border-amber-400/20 p-2.5 text-[11px] text-amber-200 leading-relaxed">
            Ação irreversível. A venda fica com status CANCELADA e não é possível reabri-la.
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-full bg-white/[0.06] border border-white/[0.08] text-[13px] font-medium hover:bg-white/[0.1] transition">{traduzir('cancelar', "Cancelar")}</button>
            <button
              type="button"
              disabled={!valido}
              onClick={() => onConfirmar({ motivo: motivo.trim(), estornarEstoque, estornarFinanceiro })}
              className="flex-1 h-10 rounded-full bg-red-500 hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-[13px] font-semibold transition"
            >
              {enviando ? 'Estornando…' : 'Confirmar estorno'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Vendas() {
  const router = useRouter();

  // Cadastros de apoio (nomes de produto no detalhe, filiais e vendedores)
  const [produtos, setProdutos] = useState<any[]>([]);
  const [filiais, setFiliais] = useState<any[]>([]);
  const [erroProdutosCadastro, setErroProdutosCadastro] = useState<string | null>(null);
  const [erroFiliaisCadastro, setErroFiliaisCadastro] = useState<string | null>(null);
  const [vendedores, setVendedores] = useState<Array<{ id: string; nome: string }>>([]);
  const [permissoes, setPermissoes] = useState<string[] | null>(null);

  // Filtros (período, status, pagamento, vendedor, filial e busca)
  const [periodo, setPeriodo] = useState<Periodo>('1');
  const [status, setStatus] = useState<string>('Todas');
  const [pagamento, setPagamento] = useState<string>('Todos');
  const [vendedor, setVendedor] = useState<string>('Todos');
  const [filialFiltro, setFilialFiltro] = useState('');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [pagina, setPagina] = useState(1);

  // Dados
  const [lista, setLista] = useState<{ vendas: any[]; total: number }>({ vendas: [], total: 0 });
  const [dashboard, setDashboard] = useState<any>(null);
  const [carregandoLista, setCarregandoLista] = useState(true);

  // Detalhe (drawer) e estorno (modal)
  const [detalheAberto, setDetalheAberto] = useState(false);
  const [detalhe, setDetalhe] = useState<any>(null);
  const [detalheCarregando, setDetalheCarregando] = useState(false);
  const [estorno, setEstorno] = useState<any>(null);
  const [estornando, setEstornando] = useState(false);

  // Nova venda (registro manual — comportamento preservado)
  const [produtoId, setProdutoId] = useState('');
  const [filialId, setFilialId] = useState('');
  const [qtd, setQtd] = useState(1);
  const [carrinho, setCarrinho] = useState<any[]>([]);
  const [finalizando, setFinalizando] = useState(false);

  // Mensagens e exportação
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportando, setExportando] = useState<false | 'csv' | 'excel'>(false);
  const [dataRodape, setDataRodape] = useState('');

  const { de, ate } = useMemo(() => intervaloPeriodo(Number(periodo)), [periodo]);

  const filtros = useMemo(
    () => ({
      de,
      ate,
      status: status === 'Todas' ? undefined : status,
      formaPagamento: pagamento === 'Todos' ? undefined : pagamento,
      funcionarioId: vendedor === 'Todos' ? undefined : vendedor,
      filialId: filialFiltro || undefined,
      busca: buscaAplicada || undefined,
    }),
    [de, ate, status, pagamento, vendedor, filialFiltro, buscaAplicada],
  );

  const carregarLista = useCallback(async () => {
    setCarregandoLista(true);
    try {
      const { data } = await api.get('/vendas', {
        params: { ...filtros, take: POR_PAGINA, skip: (pagina - 1) * POR_PAGINA },
      });
      setLista({ vendas: data?.vendas ?? [], total: Number(data?.total ?? 0) });
    } catch (err) {
      setError(msgErro(err, 'Não foi possível carregar as vendas.'));
    } finally {
      setCarregandoLista(false);
    }
  }, [filtros, pagina]);

  const carregarDashboard = useCallback(async () => {
    try {
      const { data } = await api.get('/vendas/dashboard', { params: { dias: Number(periodo) } });
      setDashboard(data);
    } catch (err) {
      setError(msgErro(err, 'Não foi possível carregar os indicadores de vendas.'));
    }
  }, [periodo]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    void (async () => {
      const [produtosResult, filiaisResult] = await Promise.allSettled([
        api.get('/produtos', { params: { status: 'ATIVO', take: 200 } }),
        api.get('/filiais'),
      ]);
      if (produtosResult.status === 'fulfilled') {
        setProdutos(produtosResult.value.data?.produtos ?? []);
        setErroProdutosCadastro(null);
      } else {
        setProdutos([]);
        setErroProdutosCadastro(msgErro(produtosResult.reason, 'Sem acesso para carregar produtos.'));
      }
      if (filiaisResult.status === 'fulfilled') {
        setFiliais(filiaisResult.value.data?.filiais ?? []);
        setErroFiliaisCadastro(null);
      } else {
        setFiliais([]);
        setErroFiliaisCadastro(msgErro(filiaisResult.reason, 'Sem acesso para carregar filiais.'));
      }
      // Melhor esforço: sem `usuarios.visualizar` a lista de vendedores é
      // completada pelos nomes que vêm nas próprias vendas (efeito abaixo).
      try {
        const { data: u } = await api.get('/usuarios');
        const listaUsuarios = Array.isArray(u) ? u : u?.usuarios ?? [];
        setVendedores(
          listaUsuarios.map((x: any) => ({ id: x.id, nome: x.nome ?? x.name ?? x.email ?? '—' })),
        );
      } catch {
        /* opcional: a listagem de vendas já traz vendedorNome */
      }
      try {
        const { data: me } = await api.get('/auth/me');
        setPermissoes(Array.isArray(me?.permissions) ? me.permissions : []);
      } catch {
        setPermissoes(null); // sem resposta: não esconde a ação, o servidor decide
      }
    })();
  }, [router]);

  useEffect(() => { void carregarLista(); }, [carregarLista]);
  useEffect(() => { void carregarDashboard(); }, [carregarDashboard]);

  // Busca com atraso, como no layout de referência (filtra enquanto digita).
  useEffect(() => {
    const timer = setTimeout(() => setBuscaAplicada(busca.trim()), 350);
    return () => clearTimeout(timer);
  }, [busca]);

  // Data do rodapé só no cliente, para não divergir na hidratação.
  useEffect(() => { setDataRodape(formatDate(new Date())); }, []);

  // Vendedores visíveis na listagem entram no filtro mesmo sem GET /usuarios.
  useEffect(() => {
    setVendedores((atual) => {
      const mapa = new Map(atual.map((v) => [v.id, v.nome]));
      for (const v of lista.vendas) {
        if (v.funcionarioId && v.vendedorNome) mapa.set(v.funcionarioId, v.vendedorNome);
      }
      const proximo = [...mapa]
        .map(([id, nome]) => ({ id, nome }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      return proximo.length === atual.length ? atual : proximo;
    });
  }, [lista.vendas]);

  // ---- Derivados dos KPIs (todos com dado real do backend) ----
  const podeEstornar = permissoes === null || permissoes.includes('vendas:editar');
  const podeCriarVenda = permissoes === null || permissoes.includes('vendas:criar') || permissoes.includes('pdv:criar');
  const kpis = dashboard ?? {};
  const porStatus = kpis.porStatus ?? {};
  const totalPaginas = Math.max(1, Math.ceil((lista.total || 0) / POR_PAGINA));
  const rotuloPeriodo = PERIODOS.find((p) => p.key === periodo)?.label ?? 'Hoje';
  const nomeVendedorFiltro = vendedores.find((v) => v.id === vendedor)?.nome;

  const comSinal = (n: number) => `${n > 0 ? '+' : ''}${formatPct(n)}`;
  const tomAlta = (n: number): 'good' | 'bad' | 'neutral' => (n > 0 ? 'good' : n < 0 ? 'bad' : 'neutral');
  // Cancelamento subindo é ruim — por isso a cor é invertida no KPI 4.
  const tomRuim = (n: number): 'good' | 'bad' | 'neutral' => (n > 0 ? 'bad' : n < 0 ? 'good' : 'neutral');

  const crescimentoDia = Number(kpis.crescimento) || 0;
  const crescimentoTicket = kpis.crescimentoTicketMedio == null ? null : Number(kpis.crescimentoTicketMedio);
  const crescimentoCanceladas = kpis.crescimentoCanceladas == null ? null : Number(kpis.crescimentoCanceladas);

  const deltaDia = crescimentoDia === 0 ? 'sem comparativo' : `${comSinal(crescimentoDia)} vs dia anterior`;
  const deltaTicket = crescimentoTicket == null ? 'sem base anterior' : `${comSinal(crescimentoTicket)} vs período anterior`;
  const deltaCanceladas = crescimentoCanceladas == null ? 'sem base anterior' : `${comSinal(crescimentoCanceladas)} vs período anterior`;

  // ---- Exportação (as mesmas 8 colunas da tabela, com Vendedor) ----
  async function exportar(formato: 'csv' | 'excel') {
    setExportando(formato);
    setError(null);
    try {
      const { data } = await api.get('/vendas', { params: { ...filtros, take: 1000, skip: 0 } });
      const linhas: any[] = data?.vendas ?? [];
      if (linhas.length === 0) {
        setError('Nenhuma venda encontrada para exportar com estes filtros.');
        return;
      }
      if (formato === 'csv') exportarCSV(linhas);
      else exportarExcel(linhas);
      setNotice(`${linhas.length} venda(s) exportada(s) em ${formato === 'csv' ? 'CSV' : 'Excel'}.`);
    } catch (err) {
      setError(msgErro(err, 'Não foi possível exportar as vendas.'));
    } finally {
      setExportando(false);
    }
  }

  // ---- Detalhe da venda ----
  async function abrirDetalhe(venda: any) {
    setDetalheAberto(true);
    setDetalhe(venda); // mostra o que a listagem já tem, sem tela vazia
    setDetalheCarregando(true);
    try {
      const { data } = await api.get(`/vendas/${venda.id}`);
      setDetalhe(data);
    } catch (err) {
      setError(msgErro(err, 'Não foi possível carregar o detalhe da venda.'));
    } finally {
      setDetalheCarregando(false);
    }
  }

  function fecharDetalhe() {
    setDetalheAberto(false);
    setDetalhe(null);
  }

  /** Imprime só o detalhe: o CSS de `@media print` esconde o resto da tela. */
  async function imprimirVenda(venda: any) {
    await abrirDetalhe(venda);
    setTimeout(() => window.print(), 150);
  }

  // ---- Estorno (modal) ----
  async function confirmarEstorno(dados: { motivo: string; estornarEstoque: boolean; estornarFinanceiro: boolean }) {
    if (!estorno) return;
    setEstornando(true);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/vendas/${estorno.id}/cancelar`, dados);
      const partes = [
        dados.estornarEstoque ? 'estoque' : null,
        dados.estornarFinanceiro ? 'financeiro, indicadores, metas, cliente e caixa' : null,
      ].filter(Boolean);
      setNotice(
        partes.length
          ? `Venda #${shortId(estorno.id)} cancelada — estorno de ${partes.join(' e ')}.`
          : `Venda #${shortId(estorno.id)} cancelada sem estorno de estoque/financeiro.`,
      );
      setEstorno(null);
      fecharDetalhe();
      await Promise.all([carregarLista(), carregarDashboard()]);
    } catch (err) {
      setError(msgErro(err, 'Não foi possível cancelar a venda.'));
    } finally {
      setEstornando(false);
    }
  }

  // ---- Nova venda (registro manual) ----
  function addCarrinho() {
    const prod = produtos.find((p: any) => p.id === produtoId);
    if (!prod) return;
    if (!Number.isInteger(qtd) || qtd < 1) {
      setError('A quantidade deve ser um número inteiro maior que zero.');
      return;
    }
    setCarrinho([...carrinho, { produtoId, nome: prod.nome, quantidade: qtd, preco: Number(prod.precoVenda) }]);
  }

  async function finalizar() {
    setError(null);
    setNotice(null);
    if (!filialId || carrinho.length === 0) {
      setError('Selecione a filial e adicione ao menos um item ao carrinho.');
      return;
    }
    setFinalizando(true);
    try {
      const { data } = await api.post('/vendas', {
        filialId,
        itens: carrinho.map((c) => ({ produtoId: c.produtoId, quantidade: c.quantidade })),
        origem: 'MANUAL',
      });
      setNotice(
        `Venda #${shortId(data?.venda?.id)} finalizada: baixa de estoque, faturamento, ticket médio, metas e financeiro atualizados automaticamente.`,
      );
      setCarrinho([]);
      await Promise.all([carregarLista(), carregarDashboard()]);
    } catch (err) {
      setError(msgErro(err, 'Não foi possível finalizar a venda.'));
    } finally {
      setFinalizando(false);
    }
  }

  // ---- Colunas da tabela (mesma ordem do layout de referência) ----
  const colunas: DataColumn<any>[] = [
    {
      key: 'id',
      label: 'ID Venda',
      render: (v) => <span className="mono text-[12px] text-white/70">#{shortId(v.id)}</span>,
    },
    {
      key: 'data',
      label: 'Data/Hora',
      render: (v) => (
        <span className="whitespace-nowrap text-white/60 text-[12px]">
          {formatDate(v.createdAt)} <span className="text-white/25">{formatTime(v.createdAt)}</span>
        </span>
      ),
    },
    {
      key: 'cliente',
      label: 'Cliente',
      render: (v) => (
        <span className="inline-block max-w-[160px] truncate align-middle text-white/90">
          {v.cliente?.nome ?? 'Consumidor não identificado'}
        </span>
      ),
    },
    {
      key: 'itens',
      label: 'Itens',
      render: (v) => (
        <span className="inline-flex items-center gap-1.5 text-white/60">
          <Package className="h-3 w-3 text-white/25" />
          {v.itens?.length ?? 0} • {unidadesDaVenda(v)} un
        </span>
      ),
    },
    {
      key: 'total',
      label: 'Total',
      render: (v) => <span className="mono font-semibold text-white">{formatBRL(v.total)}</span>,
    },
    {
      key: 'pagamento',
      label: 'Pagamento',
      render: (v) => (
        <span className="vendas-pill">
          <CreditCard className="h-3 w-3" />
          {formaPagamentoLabel(v.formaPagamento)}
        </span>
      ),
    },
    { key: 'status', label: 'Status', render: (v) => <StatusVendaBadge status={v.status} /> },
    {
      key: 'vendedor',
      label: 'Vendedor',
      cellClassName: 'hidden lg:table-cell',
      render: (v) => <span className="text-[12px] text-white/50">{v.vendedorNome ?? '—'}</span>,
    },
    {
      key: 'acoes',
      label: 'Ações',
      align: 'right',
      render: (v) => (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            className="vendas-icon-btn"
            title="Ver detalhe da venda"
            onClick={(e) => { e.stopPropagation(); void abrirDetalhe(v); }}
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="vendas-icon-btn"
            title="Imprimir detalhe"
            onClick={(e) => { e.stopPropagation(); void imprimirVenda(v); }}
          >
            <Printer className="h-3.5 w-3.5" />
          </button>
          {/* Botão só de ícone: sem rótulo, o `disabled` é quase invisível e
              ele parece clicável como o "Imprimir" ao lado. A opacidade baixa
              deixa claro que não é um controle ativo — o `title` segue
              explicando o motivo no desktop. */}
          <button
            type="button"
            className="vendas-icon-btn opacity-40"
            disabled
            aria-disabled="true"
            title="Ver NF-e — indisponível por enquanto (exige integração fiscal, DEBITO-TECNICO.md item 23.1)"
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
          {podeEstornar && v.status !== 'CANCELADA' && (
            <button
              type="button"
              className="vendas-icon-btn"
              title="Estornar venda"
              onClick={(e) => { e.stopPropagation(); setEstorno(v); }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <main className="admin-page vendas-root">
      <style>{vendasCss}</style>

      <div className="vendas-noprint">
        <ModuleHeader
          title={traduzir('vendas', "Vendas")}
          kicker="Gestão"
          subtitle="Controle completo das vendas — não é o PDV. Fechar uma venda atualiza estoque, financeiro, ticket médio e metas automaticamente."
          action={
            <div className="flex items-center gap-2">
              <a href="#nova-venda" className="vendas-btn-claro">
                <Package className="h-4 w-4" /> Nova venda
              </a>
              <a
                href="/pdv"
                target="_blank"
                rel="noopener noreferrer"
                className="h-9 px-4 rounded-full bg-[#7C3AED] hover:bg-[#6D4AFF] text-white text-[13px] font-medium flex items-center gap-2 transition"
              >
                <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[11px]">↗</span>
                Ir para PDV
              </a>
            </div>
          }
        />

        {error && <p className="admin-message admin-error">{error}</p>}
        {notice && <p className="admin-message admin-success">{notice}</p>}

        {/* KPIs — 4 cards do layout de referência, com dado real */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <KpiCard
            title="Vendas Hoje"
            value={dashboard ? formatBRL(kpis.faturamentoHoje) : '—'}
            icon={TrendingUp}
            iconTone="emerald"
            delta={deltaDia}
            deltaTone={tomAlta(crescimentoDia)}
          />
          <KpiCard
            title="Ticket Médio"
            value={dashboard ? formatBRL(kpis.ticketMedioPeriodo) : '—'}
            icon={Receipt}
            iconTone="neutral"
            delta={deltaTicket}
            deltaTone={crescimentoTicket == null ? 'neutral' : tomAlta(crescimentoTicket)}
            sub={`${kpis.qtdVendasPeriodo ?? 0} vendas no período`}
          />
          <KpiCard
            title="Vendas em Aberto"
            value={dashboard ? String(porStatus.ABERTA ?? 0) : '—'}
            icon={Clock}
            iconTone="amber"
            sub="Pendentes de fechamento"
          />
          <KpiCard
            title="Canceladas / Estornos"
            value={dashboard ? String(kpis.canceladasEstornos ?? 0) : '—'}
            icon={CircleAlert}
            iconTone="red"
            delta={deltaCanceladas}
            deltaTone={crescimentoCanceladas == null ? 'neutral' : tomRuim(crescimentoCanceladas)}
          />
        </section>

        {/* Filtros + exportação */}
        <section className="bg-[#1A1A2E] rounded-[16px] border border-white/[0.06] p-3 mb-4 flex flex-wrap items-center gap-2">
          <TabsPill
            items={PERIODOS.map((p) => ({ key: p.key, label: p.label }))}
            value={periodo}
            onChange={(k) => { setPeriodo(k); setPagina(1); }}
          />
          <div className="h-6 w-px bg-white/[0.06] mx-1 hidden sm:block" />

          <select
            aria-label={traduzir('filtrar_por_status', "Filtrar por status")}
            className="vendas-filtro"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPagina(1); }}
          >
            {STATUS_FILTRO.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            aria-label="Filtrar por forma de pagamento"
            className="vendas-filtro"
            value={pagamento}
            onChange={(e) => { setPagamento(e.target.value); setPagina(1); }}
          >
            {PAGAMENTO_FILTRO.map((p) => <option key={p} value={p}>{p === 'Todos' ? 'Todos' : formaPagamentoLabel(p)}</option>)}
          </select>

          <select
            aria-label="Filtrar por vendedor"
            className="vendas-filtro"
            value={vendedor}
            onChange={(e) => { setVendedor(e.target.value); setPagina(1); }}
          >
            <option value="Todos">Todos vendedores</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
          </select>

          <select
            aria-label="Filtrar por filial"
            className="vendas-filtro"
            value={filialFiltro}
            onChange={(e) => { setFilialFiltro(e.target.value); setPagina(1); }}
          >
            <option value="">Todas as filiais</option>
            {filiais.map((f: any) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>

          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
            <input
              value={busca}
              onChange={(e) => { setBusca(e.target.value); setPagina(1); }}
              placeholder="Buscar cliente, ID..."
              aria-label="Buscar cliente ou ID da venda"
              className="vendas-filtro w-full pl-9"
            />
          </div>

          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="vendas-btn-claro"
              disabled={exportando !== false || carregandoLista}
              onClick={() => void exportar('csv')}
            >
              <Download className="h-3.5 w-3.5" /> {exportando === 'csv' ? 'Gerando…' : 'CSV'}
            </button>
            <button
              type="button"
              className="vendas-btn-branco"
              disabled={exportando !== false || carregandoLista}
              onClick={() => void exportar('excel')}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> {exportando === 'excel' ? 'Gerando…' : 'Excel'}
            </button>
          </div>
        </section>

        {/* Tabela + paginação */}
        <section className="bg-[#1A1A2E] rounded-[16px] border border-white/[0.06] overflow-hidden mb-4">
          {carregandoLista && lista.vendas.length === 0 ? (
            <p className="empty-state px-5 py-8 text-center">Carregando vendas…</p>
          ) : (
            <DataTable
              columns={colunas}
              rows={lista.vendas}
              keyOf={(v) => v.id}
              onRowClick={(v) => void abrirDetalhe(v)}
              empty={
                <p className="empty-state px-5 py-8 text-center">
                  Nenhuma venda encontrada para estes filtros.
                </p>
              }
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-white/[0.06]">
            <span className="text-[12px] text-white/40">
              {lista.total} vendas • {rotuloPeriodo} • {status === 'Todas' ? 'todos os status' : status}
              {nomeVendedorFiltro ? ` • ${nomeVendedorFiltro}` : ''}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="vendas-icon-btn"
                disabled={pagina <= 1 || carregandoLista}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                aria-label="Página anterior"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-[12px] mono text-white/50 px-1">{pagina} / {totalPaginas}</span>
              <button
                type="button"
                className="vendas-icon-btn"
                disabled={pagina >= totalPaginas || carregandoLista}
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                aria-label="Próxima página"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </section>

        <div className="text-[10px] text-white/25 tracking-[0.18em] uppercase text-center mb-6">
          NEXUS OS • Vendas Gestão • Integração PDV ativa • {dataRodape}
        </div>

        {/* Nova venda (registro manual — o balcão é o PDV) */}
        <section id="nova-venda" className="admin-panel admin-wide">
          <h2>Nova venda</h2>
          <p className="admin-note">
            Registro manual de venda. Ao finalizar, o NEXUS dá baixa no estoque, grava a receita no
            financeiro e atualiza ticket médio, indicadores diários e metas numa única transação.
          </p>
          <div className="admin-inline">
            <label>Filial
              <select required value={filialId} onChange={(e) => setFilialId(e.target.value)}>
                <option value="">Selecione</option>
                {filiais.map((f: any) => (
                  <option key={f.id} value={f.id}>{f.nome}</option>
                ))}
              </select>
            </label>
            <label>{traduzir('produto', "Produto")}<select value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
                <option value="">Selecione</option>
                {produtos.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.nome} — {formatBRL(p.precoVenda)}</option>
                ))}
              </select>
            </label>
            <label>{traduzir('quantidade', "Quantidade")}<input type="number" min={1} value={qtd} onChange={(e) => setQtd(Number(e.target.value))} />
            </label>
            <button className="admin-primary" type="button" onClick={addCarrinho} disabled={!produtoId}>
              Adicionar
            </button>
          </div>
          {erroFiliaisCadastro && <p className="admin-message admin-error">{erroFiliaisCadastro}</p>}
          {erroProdutosCadastro && <p className="admin-message admin-error">{erroProdutosCadastro}</p>}
          {!podeCriarVenda && <p className="admin-message admin-error">Sem permissão para registrar vendas. Solicite `vendas:criar` ou `pdv:criar` ao administrador.</p>}

          {carrinho.length > 0 && (
            <div className="admin-table" style={{ marginBottom: 14 }}>
              {carrinho.map((c, i) => (
                <div key={`${c.produtoId}-${i}`} className="admin-list-row">
                  <span>{c.nome} × {c.quantidade}</span>
                  <span>{formatBRL(c.preco * c.quantidade)}</span>
                </div>
              ))}
            </div>
          )}

          <button
            className="admin-primary"
            type="button"
            onClick={() => void finalizar()}
            disabled={carrinho.length === 0 || finalizando || !podeCriarVenda || !filialId}
          >
            {finalizando ? 'Finalizando…' : 'Finalizar venda'}
          </button>
        </section>
      </div>

      {/* Detalhe da venda (drawer lateral) */}
      {detalheAberto && (
        <VendaDrawer
          venda={detalhe}
          produtos={produtos}
          carregando={detalheCarregando}
          podeEstornar={podeEstornar}
          onClose={fecharDetalhe}
          onImprimir={() => window.print()}
          onEstornar={(v) => setEstorno(v)}
        />
      )}

      {/* Estorno da venda (modal) */}
      {estorno && (
        <EstornoModal
          venda={estorno}
          enviando={estornando}
          onClose={() => setEstorno(null)}
          onConfirmar={(dados) => void confirmarEstorno(dados)}
        />
      )}
    </main>
  );
}

