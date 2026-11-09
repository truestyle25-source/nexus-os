'use client';

/**
 * Fiscal Brasil — documentos fiscais e cobranças (SEFAZ / PSP / banco).
 *
 * Estrutura da tela (uma coluna, do topo para baixo):
 *   1. Cabeçalho — breadcrumb "Dashboard", kicker GESTÃO, H1 e subtítulo
 *   2. KPIs       — 4 cartões (1 coluna no mobile, 4 no desktop)
 *   3. Banner     — status da integração, provedor, API Key e certificado A1
 *   4. Tabs       — NF-e/NFC-e, PIX, Boleto e Relatórios fiscais
 *   5. Card       — barra de ferramentas, tabela e estado vazio
 *   6. Aviso      — texto de conformidade (Enterprise Fiscal OS)
 *   + overlays: drawer de detalhe, três modais de via de impressão e toast
 *
 * O shell (sidebar + topbar) NÃO é desenhado aqui: ele é responsabilidade de
 * `app/(dashboard)/layout.tsx`, compartilhado por todos os módulos — duplicá-lo
 * dentro da página quebraria a hierarquia do Layout Mestre.
 *
 * NOTA SOBRE OS DADOS: o backend fornece apenas diagnóstico cadastral e
 * estado de disponibilidade. Ainda não há endpoint de documentos nem emissão;
 * a tela não simula conexão ou documentos.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { t as traduzir, tMenu } from '@/lib/i18n';
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Barcode,
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileBarChart,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileX2,
  Info,
  KeyRound,
  MoreHorizontal,
  PlugZap,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  SearchX,
  ShieldAlert,
  Timer,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { formatBRL } from '@/lib/format';
import { api } from '@/lib/api';

/* =============================================================================
   1. TIPOS
   ========================================================================== */

type Aba = 'nfe' | 'pix' | 'boleto' | 'relatorios';

type NfeTipo = 'NF-e' | 'NFC-e';
type NfeStatus = 'Emitida' | 'Pendente' | 'Erro' | 'Cancelada';
type PixStatus = 'Pago' | 'Ativo' | 'Expirado';
type BoletoStatus = 'Registrado' | 'Pago' | 'Vencido';
type RelatorioStatus = 'Pronto' | 'Processando';

type ItemNfe = {
  kind: 'nfe'; id: string; numero: string; serie: string; cliente: string; doc: string;
  data: string; iso: string; valor: number; tipo: NfeTipo; status: NfeStatus; origem: string;
  chave: string; natureza: string; protocolo: string;
  itens: { descricao: string; qtd: number; valor: number }[];
};
type ItemPix = {
  kind: 'pix'; id: string; cliente: string; doc: string; data: string; iso: string; valor: number;
  tipo: 'Estático' | 'Dinâmico'; status: PixStatus; origem: string; txid: string; expira: string;
  brcode: string;
};
type ItemBoleto = {
  kind: 'boleto'; id: string; cliente: string; doc: string; data: string; iso: string; valor: number;
  tipo: 'Cobrança' | 'Registro'; status: BoletoStatus; origem: string; nossoNumero: string;
  vencimento: string; linha: string; banco: string;
};
type ItemRelatorio = {
  kind: 'relatorio'; id: string; nome: string; tipo: 'Sintético' | 'SPED' | 'Analítico';
  periodo: string; formato: 'PDF' | 'TXT' | 'XLSX' | 'CSV'; status: RelatorioStatus;
  tamanho: string; gerado: string; iso: string;
};
type Documento = ItemNfe | ItemPix | ItemBoleto | ItemRelatorio;
type DocComDados = Exclude<Documento, ItemRelatorio>;

type StatusFiscal = {
  provedor: string | null;
  integracaoConfigurada: boolean;
  emissaoHabilitada: boolean;
  motivoBloqueio: string;
  aviso: string;
  cadastro: {
    empresa: { camposCadastraisAusentes: string[] };
    filiais: Array<{ id: string; nome: string; camposCadastraisAusentes: string[] }>;
  };
  requisitosPendentes: string[];
};

/* =============================================================================
   No official fiscal integration is configured; no demo data is loaded.
   ========================================================================== */

/* =============================================================================
   4. CONFIGURAÇÃO DAS ABAS, FILTROS E STATUS
   ========================================================================== */

const TABS: { key: Aba; label: string; icone: ComponentType<{ className?: string }> }[] = [
  { key: 'nfe', label: 'NF-e / NFC-e', icone: FileText },
  { key: 'pix', label: 'PIX', icone: QrCode },
  { key: 'boleto', label: 'Boleto', icone: Barcode },
  { key: 'relatorios', label: 'Relatórios fiscais', icone: FileBarChart },
];

// Exibidos apenas nos componentes de detalhe, que só podem ser abertos a partir
// de registros reais quando a integração fiscal for implementada.
const EMITENTE = 'Emitente não configurado';
const EMITENTE_DOC = '—';

/** Textos do estado vazio por aba (mantêm a promessa "sem simulação"). */
const VAZIO: Record<
  Aba,
  { titulo: string; descricao: string; icone: ComponentType<{ className?: string }> }
> = {
  nfe: {
    titulo: 'Sem documentos de NF-e / NFC-e por enquanto',
    descricao:
      'Documentos fiscais (NF-e/NFC-e) aparecerão aqui quando houver integração fiscal oficial ativa para a empresa.',
    icone: FileX2,
  },
  pix: {
    titulo: 'Sem cobranças PIX por enquanto',
    descricao:
      'Cobranças PIX aparecerão aqui quando houver integração de recebimento oficial conectada ao Banco Central.',
    icone: QrCode,
  },
  boleto: {
    titulo: 'Sem boletos por enquanto',
    descricao:
      'Boletos e compensações aparecerão aqui quando houver integração bancária oficial conectada e cobrança registrada.',
    icone: Barcode,
  },
  relatorios: {
    titulo: 'Sem relatórios fiscais por enquanto',
    descricao:
      'Relatórios fiscais e exportações (SPED, apuração, sintético) aparecerão aqui junto com a integração fiscal.',
    icone: ScanLine,
  },
};

const PERIODOS = [
  'Todos',
  'Últimos 7 dias',
  'Últimos 30 dias',
  'Mês atual',
  'Mês anterior',
] as const;

type TomStatus = 'ok' | 'aviso' | 'erro' | 'neutro';

const TONS_STATUS: Record<
  TomStatus,
  { chip: string; icone: ComponentType<{ className?: string }> }
> = {
  ok: { chip: 'bg-[color-mix(in_srgb,var(--nx-green)_15%,transparent)] text-[var(--nx-green)] border-[color-mix(in_srgb,var(--nx-green)_20%,var(--nx-border))]', icone: CheckCircle2 },
  aviso: { chip: 'bg-[color-mix(in_srgb,var(--nx-amber)_15%,transparent)] text-[var(--nx-amber)] border-[color-mix(in_srgb,var(--nx-amber)_20%,var(--nx-border))]', icone: Clock3 },
  erro: { chip: 'bg-[color-mix(in_srgb,var(--nx-red)_15%,transparent)] text-[var(--nx-red)] border-[color-mix(in_srgb,var(--nx-red)_20%,var(--nx-border))]', icone: XCircle },
  neutro: { chip: 'bg-[var(--nx-surface-2)] text-[var(--nx-ink-3)] border-[var(--nx-border)]', icone: Ban },
};

/** Status normalizado nas quatro famílias visuais do Layout Mestre. */
function tomDoStatus(status: string): TomStatus {
  if (['Emitida', 'Pago', 'Pronto', 'Registrado'].includes(status)) return 'ok';
  if (['Pendente', 'Ativo', 'Processando'].includes(status)) return 'aviso';
  if (['Erro', 'Expirado', 'Vencido'].includes(status)) return 'erro';
  return 'neutro';
}

/** Rejeição da SEFAZ merece alerta, não cancelamento. */
const ICONE_ERRO_FISCAL: Record<string, ComponentType<{ className?: string }>> = {
  Erro: CircleAlert,
  Expirado: XCircle,
};


/* =============================================================================
   5. FILTROS E DERIVADOS
   ========================================================================== */

function dentroDoPeriodo(iso: string, periodo: string): boolean {
  if (periodo === 'Todos') return true;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return false;
  const ref = new Date();
  if (periodo === 'Últimos 7 dias') return ref.getTime() - data.getTime() <= 7 * 86400000;
  if (periodo === 'Últimos 30 dias') return ref.getTime() - data.getTime() <= 30 * 86400000;
  if (periodo === 'Mês atual')
    return data.getFullYear() === ref.getFullYear() && data.getMonth() === ref.getMonth();
  if (periodo === 'Mês anterior') {
    const anterior = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
    return data.getFullYear() === anterior.getFullYear() && data.getMonth() === anterior.getMonth();
  }
  return true;
}

/** Texto pesquisável de qualquer documento. */
function textoPesquisavel(doc: Documento): string {
  const partes: string[] = [doc.id];
  if (doc.kind === 'nfe') partes.push(doc.numero, doc.cliente, doc.doc, doc.chave, doc.tipo, doc.origem);
  if (doc.kind === 'pix') partes.push(doc.cliente, doc.doc, doc.txid, doc.tipo, doc.origem);
  if (doc.kind === 'boleto') partes.push(doc.cliente, doc.doc, doc.linha, doc.nossoNumero, doc.tipo, doc.origem);
  if (doc.kind === 'relatorio') partes.push(doc.nome, doc.tipo, doc.formato, doc.periodo);
  return partes.join(' ');
}

/** Remove acentos e caixa para a busca ("cobrança" == "cobranca"). */
const semAcento = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/* =============================================================================
   6. CSS LOCAL DA TELA
   Mesmo padrão de /vendas, /fluxo e /dre: regras com escopo `.fiscal-root`
   injetadas num <style>, para não espalhar especificidade em globals.css.
   ========================================================================== */

const fiscalCss = `
.fiscal-root { max-width: 100%; box-sizing: border-box; }
.fiscal-root ::-webkit-scrollbar { width: 8px; height: 8px; }
.fiscal-root ::-webkit-scrollbar-track { background: transparent; }
.fiscal-root ::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--nx-ink) 8%, transparent); border-radius: 999px; }
.fiscal-root ::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--nx-ink) 16%, transparent); }
.fiscal-scroll-hide { scrollbar-width: none; -ms-overflow-style: none; }
.fiscal-scroll-hide::-webkit-scrollbar { display: none; }
.fiscal-check { appearance: none; -webkit-appearance: none; width: 16px; height: 16px; border-radius: 4px; border: 1px solid var(--nx-border-strong); background: var(--nx-surface-2); cursor: pointer; position: relative; transition: all .15s ease; }
.fiscal-check:hover { border-color: var(--nx-accent); }
.fiscal-check:checked { background: var(--nx-accent); border-color: var(--nx-accent); }
.fiscal-check:checked::after { content: ''; position: absolute; left: 5px; top: 1.5px; width: 4px; height: 8px; border: solid var(--nx-ink); border-width: 0 2px 2px 0; transform: rotate(45deg); }
.fiscal-select { appearance: none; -webkit-appearance: none; }
.fiscal-select option { background: var(--nx-surface); color: var(--nx-ink); }
.fiscal-toast { animation: fiscalSlideUp .2s ease both; }
.fiscal-drawer { animation: fiscalSlideIn .2s ease both; }
.fiscal-modal { animation: fiscalScaleIn .2s ease both; }
@keyframes fiscalSlideUp { from { transform: translateY(20px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes fiscalSlideIn { from { transform: translateX(20px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes fiscalScaleIn { from { transform: scale(.96); opacity: 0; } to { transform: none; opacity: 1; } }
/* Impressão: sai apenas a via aberta (DANFE/PIX/Boleto) — o resto da tela
   some por completo, como já é feito em /vendas. */
@media print {
  .fiscal-noprint, aside, header { display: none !important; }
  body * { visibility: hidden !important; }
  .fiscal-print-area, .fiscal-print-area * { visibility: visible !important; }
  .fiscal-print-area { position: static !important; display: block !important; max-width: none !important; max-height: none !important; height: auto !important; overflow: visible !important; border: 0 !important; box-shadow: none !important; background: transparent !important; }
}
`;


/* =============================================================================
   7. COMPONENTES PEQUENOS
   ========================================================================== */

/** Badge de status fiscal: verde/amarelo/vermelho/cinza do Layout Mestre. */
function StatusBadge({ status }: { status: string }) {
  const tom = tomDoStatus(status);
  const conf = TONS_STATUS[tom];
  const Icone = ICONE_ERRO_FISCAL[status] ?? conf.icone;
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium ${conf.chip}`}
    >
      <Icone className="h-3 w-3" />
      {status}
    </span>
  );
}

/** Copia texto e aguarda o resultado real da API de clipboard. */
async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* segue para o fallback */
  }
  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

const TONS_KPI: Record<string, string> = {
  roxo: 'border border-[color-mix(in_srgb,var(--nx-accent)_20%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-accent)_10%,transparent)] text-[var(--nx-accent-ink)]',
  verde: 'border border-[color-mix(in_srgb,var(--nx-green)_20%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-green)_10%,transparent)] text-[var(--nx-green)]',
  ambar: 'border border-[color-mix(in_srgb,var(--nx-amber)_20%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-amber)_10%,transparent)] text-[var(--nx-amber)]',
  branco: 'border border-[var(--nx-border)] bg-[var(--nx-surface-2)] text-[var(--nx-ink-3)]',
};

/** Cartão de KPI: rótulo em caixa alta, ícone 32px, valor e apoio. */
function Kpi({
  titulo,
  valor,
  apoio,
  icone: Icone,
  tom,
}: {
  titulo: string;
  valor: string;
  apoio: ReactNode;
  icone: ComponentType<{ className?: string }>;
  tom: keyof typeof TONS_KPI;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] uppercase leading-snug tracking-[0.14em] text-[var(--nx-ink-3)]">
          {titulo}
        </span>
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${TONS_KPI[tom]}`}
        >
          <Icone className="h-4 w-4" />
        </span>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[22px] font-bold tracking-tight text-[var(--nx-ink)]">{valor}</div>
        <div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--nx-ink-2)]">{apoio}</div>
      </div>
    </div>
  );
}

/** Botão de ícone circular (ações de linha e cabeçalho de overlay). */
function BotaoIcone({
  rotulo,
  children,
  onClick,
  destaque,
  disabled = false,
}: {
  rotulo: string;
  children: ReactNode;
  onClick: () => void;
  destaque?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={rotulo}
      aria-label={rotulo}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
        destaque
          ? 'bg-[color-mix(in_srgb,var(--nx-accent)_15%,transparent)] text-[var(--nx-accent-ink)] hover:bg-[color-mix(in_srgb,var(--nx-accent)_25%,transparent)]'
          : 'bg-[var(--nx-surface-2)] text-[var(--nx-ink-2)] hover:bg-[var(--nx-surface-3)] hover:text-[var(--nx-ink)]'
      }`}
    >
      {children}
    </button>
  );
}

/** Select estilizado como botão-pílula, com chevron à direita. */
function Filtro({
  rotulo,
  valor,
  opcoes,
  onChange,
}: {
  rotulo: string;
  valor: string;
  opcoes: readonly string[];
  onChange: (valor: string) => void;
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label={rotulo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="fiscal-select h-8 cursor-pointer rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-3)] py-0 pl-3 pr-7 text-[12px] font-medium text-[var(--nx-ink)] outline-none transition-colors hover:border-[var(--nx-border-strong)]"
      >
        {opcoes.map((op) => (
          <option key={op} value={op}>
            {op === 'Todos' ? rotulo : op}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-ink-3)]" />
    </div>
  );
}

/** Estado vazio: ícone com glow roxo, título e descrição centrada. */
function EstadoVazio({
  titulo,
  descricao,
  icone: Icone,
  acao,
}: {
  titulo: string;
  descricao: string;
  icone: ComponentType<{ className?: string }>;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-[16px] border border-[color-mix(in_srgb,var(--nx-accent)_20%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-accent)_10%,transparent)] text-[var(--nx-accent-ink)]">
        <Icone className="h-6 w-6" />
      </span>
      <div>
        <h3 className="mb-1 mt-2 text-[14px] font-semibold text-[var(--nx-ink)]">{titulo}</h3>
        <p className="mx-auto max-w-[400px] text-[12px] leading-6 text-[var(--nx-ink-3)]">{descricao}</p>
      </div>
      {acao}
    </div>
  );
}


/* =============================================================================
   8. MODAIS DE VIA DE IMPRESSÃO
   ========================================================================== */

/** Casca comum dos três modais: overlay, cabeçalho, corpo e rodapé. */
function ModalVia({
  titulo,
  subtitulo,
  icone: Icone,
  children,
  acaoPrincipal,
  onClose,
}: {
  titulo: string;
  subtitulo: string;
  icone: ComponentType<{ className?: string }>;
  children: ReactNode;
  acaoPrincipal: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xl">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="fiscal-modal flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[20px] border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--nx-border)] bg-[var(--nx-surface)] px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[color-mix(in_srgb,var(--nx-accent)_20%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-accent)_10%,transparent)] text-[var(--nx-accent-ink)]">
              <Icone className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-[var(--nx-ink)]">{titulo}</div>
              <div className="truncate font-mono text-[11px] tracking-wide text-[var(--nx-ink-3)]">{subtitulo}</div>
            </div>
          </div>
          <BotaoIcone rotulo="Fechar via" onClick={onClose}>
            <X className="h-4 w-4" />
          </BotaoIcone>
        </header>

        <div className="fiscal-print-area nx-scroll flex-1 overflow-y-auto bg-[var(--nx-surface-2)] p-3 sm:p-4">
          {children}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--nx-border)] px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-4 text-[12px] text-[var(--nx-ink-2)] transition-all hover:bg-[var(--nx-surface-3)] hover:text-[var(--nx-ink)]"
          >{traduzir('fechar', "Fechar")}</button>
          {acaoPrincipal}
        </footer>
      </div>
    </div>
  );
}

/** Botão de ação principal dos modais. */
function BotaoPrincipal({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-2 rounded-full bg-[var(--nx-accent)] px-5 text-[12px] font-semibold text-[var(--nx-ink)] transition-all hover:brightness-105 active:brightness-95"
    >
      {children}
    </button>
  );
}

/** Par rótulo/valor usado dentro das vias em papel branco. */
function CampoPapel({ rotulo, valor, mono }: { rotulo: string; valor: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[8px] uppercase tracking-[0.12em] text-black/50">{rotulo}</div>
      <div
        className={`mt-0.5 break-words text-[11px] text-black ${mono ? 'font-mono tracking-wide' : ''}`}
      >
        {valor}
      </div>
    </div>
  );
}

/** Botão de cópia usado dentro do papel branco. */
function CopiarPapel({ rotulo, texto, onCopiar }: {
  rotulo: string;
  texto: string;
  onCopiar: (texto: string, rotulo: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopiar(texto, rotulo)}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-black/15 px-3 text-[10px] font-medium text-black/70 transition-colors hover:bg-black/5"
    >
      <Copy className="h-3 w-3" />
      Copiar
    </button>
  );
}


function DanfeModal({
  nfe,
  onClose,
  onCopiar,
  onBaixar,
}: {
  nfe: ItemNfe;
  onClose: () => void;
  onCopiar: (texto: string, rotulo: string) => void;
  onBaixar: (rotulo: string) => void;
}) {
  const total = nfe.itens.reduce((soma, item) => soma + item.qtd * item.valor, 0);
  return (
    <ModalVia
      titulo={`DANFE • ${nfe.tipo} • ${nfe.numero} • Série ${nfe.serie}`}
      subtitulo={`${nfe.id} • ${nfe.cliente}`}
      icone={FileText}
      onClose={onClose}
      acaoPrincipal={
        <BotaoPrincipal onClick={() => window.print()}>
          <Download className="h-3.5 w-3.5" />
          Imprimir / salvar como PDF
        </BotaoPrincipal>
      }
    >
      <article className="overflow-hidden rounded-[12px] bg-white text-black">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 px-5 py-3">
          <div>
            <div className="text-[13px] font-bold tracking-tight">DANFE</div>
            <div className="text-[9px] uppercase tracking-[0.14em] text-black/50">
              Documento auxiliar da nota fiscal eletrônica
            </div>
          </div>
          <div className="text-right">
            <div className="text-[13px] font-bold">{nfe.numero}</div>
            <div className="text-[9px] uppercase tracking-[0.14em] text-black/50">Série {nfe.serie}</div>
          </div>
        </header>

        <div className="border-b border-black/10 px-5 py-3">
          <div className="text-[8px] uppercase tracking-[0.12em] text-black/50">Chave de acesso</div>
          <div className="mt-1 flex items-start gap-2">
            <p className="flex-1 break-all font-mono text-[10px] tracking-wide text-black/80">
              {nfe.chave}
            </p>
            <CopiarPapel rotulo="Chave de acesso" texto={nfe.chave} onCopiar={onCopiar} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-b border-black/10 px-5 py-4 sm:grid-cols-3">
          <CampoPapel rotulo="Emitente" valor={`${EMITENTE} • ${EMITENTE_DOC}`} />
          <CampoPapel rotulo="Destinatário" valor={`${nfe.cliente} • ${nfe.doc}`} />
          <CampoPapel rotulo="Natureza da operação" valor={nfe.natureza} />
          <CampoPapel rotulo="Data de emissão" valor={nfe.data} />
          <CampoPapel rotulo="Protocolo de autorização" valor={nfe.protocolo} mono />
          <CampoPapel rotulo={traduzir('status', "Status")} valor={nfe.status} />
        </div>

        <div className="px-5 py-4">
          <div className="mb-2 text-[8px] uppercase tracking-[0.12em] text-black/50">Itens</div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-black/10 text-[8px] uppercase tracking-[0.12em] text-black/50">
                <th className="py-1.5 text-left font-medium">{traduzir('descricao', "Descrição")}</th>
                <th className="py-1.5 text-right font-medium">Qtd.</th>
                <th className="py-1.5 text-right font-medium">Vlr. unit.</th>
                <th className="py-1.5 text-right font-medium">{traduzir('total', "Total")}</th>
              </tr>
            </thead>
            <tbody>
              {nfe.itens.map((item) => (
                <tr key={item.descricao} className="border-b border-black/5">
                  <td className="py-1.5 pr-2">{item.descricao}</td>
                  <td className="py-1.5 text-right">{item.qtd}</td>
                  <td className="py-1.5 text-right">{formatBRL(item.valor)}</td>
                  <td className="py-1.5 text-right font-medium">{formatBRL(item.qtd * item.valor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-2.5 text-right font-semibold uppercase tracking-[0.12em]">
                  Total da NF-e
                </td>
                <td className="pt-2.5 text-right text-[14px] font-bold">{formatBRL(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-black/10 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 items-center justify-center rounded-[6px] border border-black/10 text-center text-[8px] text-black/50">
              QR não fornecido
            </span>
            <div className="text-[9px] leading-relaxed text-black/60">
              {nfe.tipo === 'NFC-e'
                ? 'QR Code de consulta do consumidor'
                : 'Consulta de autenticidade no portal da SEFAZ'}
              <br />
              www.nfe.fazenda.gov.br
            </div>
          </div>
          <div className="text-[9px] text-black/40">Emitido por NEXUS OS • {EMITENTE}</div>
        </footer>
      </article>
    </ModalVia>
  );
}


function PixComprovanteModal({
  pix,
  onClose,
  onCopiar,
  onBaixar,
}: {
  pix: ItemPix;
  onClose: () => void;
  onCopiar: (texto: string, rotulo: string) => void;
  onBaixar: (rotulo: string) => void;
}) {
  return (
    <ModalVia
      titulo={`Comprovante PIX • ${pix.id}`}
      subtitulo={pix.cliente}
      icone={QrCode}
      onClose={onClose}
      acaoPrincipal={
        <BotaoPrincipal onClick={() => window.print()}>
          <Download className="h-3.5 w-3.5" />
          Imprimir / salvar como PDF
        </BotaoPrincipal>
      }
    >
      <article className="overflow-hidden rounded-[12px] bg-white text-black">
        <header className="flex items-center justify-between gap-2 border-b border-black/10 px-5 py-3">
          <div>
            <div className="text-[13px] font-bold tracking-tight">Comprovante PIX</div>
            <div className="text-[9px] uppercase tracking-[0.14em] text-black/50">{pix.id}</div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22c55e]/40 bg-[#22c55e]/10 px-2.5 py-1 text-[10px] font-semibold text-[#15803d]">
            <CheckCircle2 className="h-3 w-3" />
            {pix.status}
          </span>
        </header>

        <div className="px-5 py-6 text-center">
          <div className="text-[9px] uppercase tracking-[0.14em] text-black/50">Valor pago</div>
          <div className="mt-1 text-[34px] font-black tracking-tight">{formatBRL(pix.valor)}</div>
          <div className="mt-1 text-[12px] text-black/60">
            {pix.cliente} • {pix.doc}
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 border-y border-black/10 px-5 py-5">
          <span className="flex h-40 w-40 items-center justify-center rounded-[10px] border border-black/10 px-3 text-center text-[11px] text-black/50">
            QR não fornecido pelo PSP
          </span>
          <div className="text-center text-[9px] leading-relaxed text-black/50">
            QR Code de pagamento instantâneo
            <br />
            Banco Central do Brasil • arranjo de pagamentos instantâneos
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-3">
          <CampoPapel rotulo="TXID / E2EID" valor={pix.txid} mono />
          <CampoPapel rotulo="Tipo de cobrança" valor={pix.tipo} />
          <CampoPapel rotulo="Gerado em" valor={pix.data} />
          <CampoPapel rotulo="Expira em" valor={pix.expira} />
          <CampoPapel rotulo="Recebedor" valor={`${EMITENTE} • ${EMITENTE_DOC}`} />
          <CampoPapel rotulo="Origem" valor={pix.origem} />
        </div>

        <div className="border-t border-black/10 px-5 py-3">
          <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-black/50">
            PIX copia e cola (BR Code)
          </div>
          <p className="break-all font-mono text-[9px] leading-relaxed text-black/70">{pix.brcode}</p>
          <div className="mt-2">
            <CopiarPapel rotulo="BR Code PIX" texto={pix.brcode} onCopiar={onCopiar} />
          </div>
        </div>

        <footer className="border-t border-black/10 px-5 py-3 text-[9px] text-black/40">
          Emitido por NEXUS OS • confirmação registrada em {pix.data}
        </footer>
      </article>
    </ModalVia>
  );
}


function BoletoViaModal({
  boleto,
  onClose,
  onCopiar,
  onBaixar,
}: {
  boleto: ItemBoleto;
  onClose: () => void;
  onCopiar: (texto: string, rotulo: string) => void;
  onBaixar: (rotulo: string) => void;
}) {
  return (
    <ModalVia
      titulo={`Boleto bancário • ${boleto.banco}-9 • nosso nº ${boleto.nossoNumero}`}
      subtitulo={boleto.cliente}
      icone={Barcode}
      onClose={onClose}
      acaoPrincipal={
        <BotaoPrincipal onClick={() => window.print()}>
          <Download className="h-3.5 w-3.5" />
          Imprimir / salvar como PDF
        </BotaoPrincipal>
      }
    >
      <article className="overflow-hidden rounded-[12px] bg-white text-black">
        <header className="flex items-center justify-between gap-3 border-b border-black/20 px-5 py-3">
          <div className="text-[13px] font-bold tracking-tight">{EMITENTE}</div>
          <div className="border-l border-black/20 pl-3 text-right">
            <div className="text-[16px] font-black leading-none">{boleto.banco}-9</div>
            <div className="text-[8px] uppercase tracking-[0.12em] text-black/50">Banco emissor</div>
          </div>
        </header>

        <div className="border-b border-dashed border-black/20 px-5 py-3">
          <div className="text-[8px] uppercase tracking-[0.12em] text-black/50">Linha digitável</div>
          <div className="mt-1 flex items-start gap-2">
            <p className="flex-1 break-all font-mono text-[13px] font-semibold tracking-[0.18em] text-black">
              {boleto.linha}
            </p>
            <CopiarPapel rotulo="Linha digitável" texto={boleto.linha} onCopiar={onCopiar} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-3">
          <CampoPapel rotulo="Local de pagamento" valor="Não informado pelo banco emissor" />
          <CampoPapel rotulo={traduzir('vencimento', "Vencimento")} valor={boleto.vencimento} />
          <CampoPapel rotulo="Cedente" valor={`${EMITENTE} • ${EMITENTE_DOC}`} />
          <CampoPapel
            rotulo="Agência / Código do cedente"
            valor="Não informado pelo banco emissor"
            mono
          />
          <CampoPapel rotulo="Nosso número" valor={boleto.nossoNumero} mono />
          <CampoPapel rotulo="Espécie do documento" valor="Não informada" />
          <CampoPapel rotulo="Sacado" valor={boleto.cliente} />
          <CampoPapel rotulo="Documento" valor={boleto.doc} mono />
          <CampoPapel rotulo="Emitido em" valor={boleto.data} />
        </div>

        <div className="border-y border-black/10 px-5 py-4 text-center">
          <div className="text-[8px] uppercase tracking-[0.12em] text-black/50">Valor do documento</div>
          <div className="mt-1 text-[16px] font-bold">{formatBRL(boleto.valor)}</div>
        </div>

        <div className="px-5 py-4">
          <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-black/50">Linha digitável</div>
          <p className="break-all font-mono text-[12px] tracking-[0.18em] text-black/80">
            {boleto.linha}
          </p>
          <div className="mt-3 flex h-14 w-full items-center justify-center rounded-[6px] border border-black/10 text-[10px] text-black/50">
            Representação do código de barras indisponível
          </div>
        </div>

        <footer className="border-t border-dashed border-black/20 px-5 py-3 text-[9px] leading-relaxed text-black/40">
          Instruções de pagamento não foram fornecidas pelo banco emissor.
        </footer>
      </article>
    </ModalVia>
  );
}


/* =============================================================================
   9. DRAWER DE DETALHE
   ========================================================================== */

/** Identificador "copio e cola" de cada tipo de documento. */
function identificador(doc: Documento): { texto: string; rotulo: string } {
  if (doc.kind === 'nfe') return { texto: doc.chave, rotulo: 'Chave de acesso' };
  if (doc.kind === 'pix') return { texto: doc.txid, rotulo: 'TXID PIX' };
  if (doc.kind === 'boleto') return { texto: doc.linha, rotulo: 'Linha digitável' };
  return { texto: doc.id, rotulo: 'Identificador do relatório' };
}

/** Título, subtítulo e status do drawer conforme o tipo do documento. */
function cabecalhoDoc(doc: Documento): { titulo: string; subtitulo: string; status: string } {
  if (doc.kind === 'nfe')
    return {
      titulo: `${doc.tipo} ${doc.numero}`,
      subtitulo: `Série ${doc.serie} • ${doc.data}`,
      status: doc.status,
    };
  if (doc.kind === 'pix')
    return {
      titulo: `PIX ${doc.id}`,
      subtitulo: `${doc.tipo} • gerado em ${doc.data}`,
      status: doc.status,
    };
  if (doc.kind === 'boleto')
    return {
      titulo: `Boleto ${doc.nossoNumero}`,
      subtitulo: `Banco ${doc.banco}-9 • venc. ${doc.vencimento}`,
      status: doc.status,
    };
  return { titulo: doc.nome, subtitulo: `${doc.formato} • ${doc.tamanho}`, status: doc.status };
}

function SecaoDrawer({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-[var(--nx-ink-3)]">{titulo}</h3>
      {children}
    </section>
  );
}

function LinhaDoc({ rotulo, valor, mono }: { rotulo: string; valor: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-[12.5px]">
      <span className="shrink-0 text-[var(--nx-ink-3)]">{rotulo}</span>
      <span
        className={`min-w-0 break-words text-right text-[var(--nx-ink)] ${
          mono ? 'font-mono text-[11.5px] tracking-wide' : ''
        }`}
      >
        {valor}
      </span>
    </div>
  );
}

/** Cartão de pares rótulo/valor usado no corpo do drawer. */
function BlocoLinhas({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-[var(--nx-border)] rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 py-1">
      {children}
    </div>
  );
}


function DrawerDocumento({
  doc,
  onClose,
  onCopiar,
  onImprimir,
  onBaixar,
}: {
  doc: Documento;
  onClose: () => void;
  onCopiar: (texto: string, rotulo: string) => void;
  onImprimir: (doc: Documento) => void;
  onBaixar: (rotulo: string) => void;
}) {
  const cab = cabecalhoDoc(doc);
  const id = identificador(doc);
  const totalNfe =
    doc.kind === 'nfe' ? doc.itens.reduce((soma, item) => soma + item.qtd * item.valor, 0) : 0;

  return (
    <div className="fiscal-noprint fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhe ${cab.titulo}`}
        className="fiscal-drawer nx-scroll relative flex h-full w-full max-w-[480px] flex-col overflow-y-auto border-l border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--nx-border)] bg-[var(--nx-surface)] px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-[var(--nx-ink)]">{cab.titulo}</div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--nx-ink-3)]">{cab.subtitulo}</div>
          </div>
          <BotaoIcone rotulo="Fechar detalhe" onClick={onClose}>
            <X className="h-4 w-4" />
          </BotaoIcone>
        </header>

        <div className="space-y-5 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={cab.status} />
            {doc.kind !== 'relatorio' && (
              <span className="rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-2.5 py-1 text-[11px] text-[var(--nx-ink-2)]">
                Origem: {doc.origem}
              </span>
            )}
            {doc.kind === 'nfe' && (
              <span className="rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-2.5 py-1 text-[11px] text-[var(--nx-ink-2)]">
                Série {doc.serie}
              </span>
            )}
          </div>

          <SecaoDrawer titulo={id.rotulo}>
            <div className="flex items-start gap-2 rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3">
              <p className="min-w-0 flex-1 break-all font-mono text-[11px] tracking-wide text-[var(--nx-ink-2)]">
                {id.texto}
              </p>
              <BotaoIcone rotulo={`Copiar ${id.rotulo}`} onClick={() => onCopiar(id.texto, id.rotulo)}>
                <Copy className="h-3.5 w-3.5" />
              </BotaoIcone>
            </div>
          </SecaoDrawer>

          {doc.kind === 'nfe' && (
            <SecaoDrawer titulo="Partes">
              <BlocoLinhas>
                <LinhaDoc rotulo="Emitente" valor={`${EMITENTE} • ${EMITENTE_DOC}`} />
                <LinhaDoc rotulo="Destinatário" valor={doc.cliente} />
                <LinhaDoc rotulo="CPF / CNPJ" valor={doc.doc} mono />
                <LinhaDoc rotulo="Natureza da operação" valor={doc.natureza} />
                <LinhaDoc rotulo="Emissão" valor={doc.data} />
                <LinhaDoc rotulo="Protocolo SEFAZ" valor={doc.protocolo} mono />
              </BlocoLinhas>
            </SecaoDrawer>
          )}

          {doc.kind === 'nfe' && (
            <SecaoDrawer titulo="Itens">
              <div className="overflow-hidden rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)]">
                {doc.itens.map((item) => (
                  <div
                    key={item.descricao}
                    className="flex items-start justify-between gap-3 border-b border-[var(--nx-border)] px-3 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="text-[12.5px] text-[var(--nx-ink)]">{item.descricao}</div>
                      <div className="text-[11px] text-[var(--nx-ink-3)]">{item.qtd} un.</div>
                    </div>
                    <div className="shrink-0 text-[12.5px] font-medium text-[var(--nx-ink)]">
                      {formatBRL(item.qtd * item.valor)}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 bg-[var(--nx-surface-3)] px-3 py-2.5">
                  <span className="text-[12px] font-semibold text-[var(--nx-ink)]">{traduzir('total', "Total")}</span>
                  <span className="text-[14px] font-bold text-[var(--nx-ink)]">{formatBRL(totalNfe)}</span>
                </div>
              </div>
            </SecaoDrawer>
          )}


          {doc.kind === 'pix' && (
            <SecaoDrawer titulo="Pagamento">
              <BlocoLinhas>
                <LinhaDoc rotulo={traduzir('valor', "Valor")} valor={formatBRL(doc.valor)} />
                <LinhaDoc rotulo="Recebedor" valor={`${EMITENTE} • ${EMITENTE_DOC}`} />
                <LinhaDoc rotulo="Pagador" valor={`${doc.cliente} • ${doc.doc}`} />
                <LinhaDoc rotulo={traduzir('tipo', "Tipo")} valor={doc.tipo} />
                <LinhaDoc rotulo="Gerado em" valor={doc.data} />
                <LinhaDoc rotulo="Expira em" valor={doc.expira} />
              </BlocoLinhas>
            </SecaoDrawer>
          )}

          {doc.kind === 'boleto' && (
            <SecaoDrawer titulo="Cobrança">
              <BlocoLinhas>
                <LinhaDoc rotulo="Valor do documento" valor={formatBRL(doc.valor)} />
                <LinhaDoc rotulo="Banco" valor={`${doc.banco}-9`} mono />
                <LinhaDoc rotulo="Nosso número" valor={doc.nossoNumero} mono />
                <LinhaDoc rotulo={traduzir('vencimento', "Vencimento")} valor={doc.vencimento} />
                <LinhaDoc rotulo="Sacado" valor={`${doc.cliente} • ${doc.doc}`} />
                <LinhaDoc rotulo="Registrado em" valor={doc.data} />
              </BlocoLinhas>
            </SecaoDrawer>
          )}

          {doc.kind === 'relatorio' && (
            <SecaoDrawer titulo="Geração">
              <BlocoLinhas>
                <LinhaDoc rotulo={traduzir('tipo', "Tipo")} valor={doc.tipo} />
                <LinhaDoc rotulo="Competência" valor={doc.periodo} />
                <LinhaDoc rotulo="Formato" valor={doc.formato} />
                <LinhaDoc rotulo="Tamanho" valor={doc.tamanho} />
                <LinhaDoc rotulo="Gerado em" valor={doc.gerado} />
              </BlocoLinhas>
            </SecaoDrawer>
          )}
        </div>

        <footer className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--nx-border)] bg-[var(--nx-surface)] px-5 py-4">
          {doc.kind !== 'relatorio' && (
            <button
              type="button"
              onClick={() => onImprimir(doc)}
              className="flex h-9 items-center gap-2 rounded-full bg-[var(--nx-accent)] px-4 text-[12px] font-semibold text-[var(--nx-ink)] transition-all hover:brightness-105 active:brightness-95"
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimir via
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              onBaixar(
                doc.kind === 'relatorio' ? `Relatório ${doc.nome}` : `XML do documento ${doc.id}`,
              )
            }
            className="flex h-9 items-center gap-2 rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-4 text-[12px] text-[var(--nx-ink-2)] transition-all hover:bg-[var(--nx-surface-3)] hover:text-[var(--nx-ink)]"
          >
            {doc.kind === 'relatorio' ? (
              <FileSpreadsheet className="h-3.5 w-3.5" />
            ) : (
              <FileJson className="h-3.5 w-3.5" />
            )}
            Baixar arquivo
          </button>
          <button
            type="button"
            onClick={() => onBaixar(`Consulta de ${cab.titulo}`)}
            className="flex h-9 items-center gap-2 rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-4 text-[12px] text-[var(--nx-ink-2)] transition-all hover:bg-[var(--nx-surface-3)] hover:text-[var(--nx-ink)]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Consultar
          </button>
        </footer>
      </aside>
    </div>
  );
}


/* =============================================================================
   10. TABELAS
   ========================================================================== */

const CABECALHO_CLASS = 'px-5 py-3 text-left text-[11px] uppercase tracking-[0.14em] text-white/40';

/** Checkbox de seleção (o do cabeçalho seleciona todos). */
function Check({
  marcado,
  rotulo,
  onClick,
}: {
  marcado: boolean;
  rotulo: string;
  onClick: () => void;
}) {
  return (
    <input
      type="checkbox"
      className="fiscal-check"
      checked={marcado}
      onChange={onClick}
      aria-label={rotulo}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Célula de documento: número/id em monoespaçada + linha de apoio. */
function CelulaDocumento({ doc }: { doc: DocComDados }) {
  if (doc.kind === 'nfe')
    return (
      <div className="min-w-0">
        <div className="font-mono text-[12.5px] tracking-wide text-white">{doc.numero}</div>
        <div className="text-[11px] text-white/40">Série {doc.serie}</div>
      </div>
    );
  if (doc.kind === 'pix')
    return (
      <div className="min-w-0">
        <div className="font-mono text-[12.5px] tracking-wide text-white">{doc.id}</div>
        <div className="text-[11px] text-white/40">Cobrança {doc.tipo.toLowerCase()}</div>
      </div>
    );
  return (
    <div className="min-w-0">
      <div className="font-mono text-[12.5px] tracking-wide text-white">{doc.nossoNumero}</div>
      <div className="text-[11px] text-white/40">Banco {doc.banco}-9</div>
    </div>
  );
}


function TabelaDocumentos({
  documentos,
  selecionados,
  todosSelecionados,
  onAlternarTodos,
  onAlternarLinha,
  onAbrir,
  onImprimir,
  onCopiar,
  onMais,
}: {
  documentos: DocComDados[];
  selecionados: string[];
  todosSelecionados: boolean;
  onAlternarTodos: () => void;
  onAlternarLinha: (id: string) => void;
  onAbrir: (doc: DocComDados) => void;
  onImprimir: (doc: DocComDados) => void;
  onCopiar: (texto: string, rotulo: string) => void;
  onMais: () => void;
}) {
  return (
    <div className="nx-scroll overflow-x-auto">
      <table className="w-full min-w-[1080px]">
        <thead className="border-b border-white/[0.06]">
          <tr>
            <th className={`${CABECALHO_CLASS} w-10`}>
              <Check marcado={todosSelecionados} rotulo="Selecionar todos" onClick={onAlternarTodos} />
            </th>
            <th className={CABECALHO_CLASS}>Documento</th>
            <th className={CABECALHO_CLASS}>{traduzir('cliente', "Cliente")}</th>
            <th className={CABECALHO_CLASS}>{traduzir('data', "Data")}</th>
            <th className={`${CABECALHO_CLASS} text-right`}>{traduzir('valor', "Valor")}</th>
            <th className={CABECALHO_CLASS}>{traduzir('tipo', "Tipo")}</th>
            <th className={CABECALHO_CLASS}>{traduzir('status', "Status")}</th>
            <th className={CABECALHO_CLASS}>Origem</th>
            <th className={`${CABECALHO_CLASS} text-right`}>Ação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {documentos.map((doc) => (
            <tr
              key={doc.id}
              onClick={() => onAbrir(doc)}
              className="cursor-pointer transition-colors hover:bg-white/[0.02]"
            >
              <td className="px-5 py-4 align-middle">
                <Check
                  marcado={selecionados.includes(doc.id)}
                  rotulo={`Selecionar ${doc.id}`}
                  onClick={() => onAlternarLinha(doc.id)}
                />
              </td>
              <td className="px-5 py-4 align-middle">
                <CelulaDocumento doc={doc} />
              </td>
              <td className="px-5 py-4 align-middle">
                <div className="max-w-[220px] truncate text-[12.5px] text-white/85">
                  {doc.cliente}
                </div>
                <div className="font-mono text-[11px] text-white/40">{doc.doc}</div>
              </td>
              <td className="whitespace-nowrap px-5 py-4 align-middle text-[12.5px] text-white/70">
                {doc.data}
              </td>
              <td className="whitespace-nowrap px-5 py-4 text-right align-middle text-[12.5px] font-semibold text-white">
                {formatBRL(valorDoDoc(doc))}
              </td>
              <td className="whitespace-nowrap px-5 py-4 align-middle text-[12.5px] text-white/60">
                {doc.tipo}
              </td>
              <td className="px-5 py-4 align-middle">
                <StatusBadge status={doc.status} />
              </td>
              <td className="whitespace-nowrap px-5 py-4 align-middle text-[12.5px] text-white/60">
                {'origem' in doc ? doc.origem : '—'}
              </td>
              <td className="px-5 py-4 text-right align-middle">
                <div className="flex items-center justify-end gap-2">
                  <BotaoIcone rotulo={`Ver ${doc.id}`} onClick={() => onAbrir(doc)}>
                    <Eye className="h-3.5 w-3.5" />
                  </BotaoIcone>
                  <BotaoIcone rotulo="Imprimir via" destaque onClick={() => onImprimir(doc)}>
                    <Printer className="h-3.5 w-3.5" />
                  </BotaoIcone>
                  <BotaoIcone
                    rotulo="Copiar identificador"
                    onClick={() => {
                      const alvo = identificador(doc);
                      onCopiar(alvo.texto, alvo.rotulo);
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </BotaoIcone>
                  <BotaoIcone rotulo="Mais ações" onClick={onMais}>
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </BotaoIcone>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function TabelaRelatorios({
  relatorios,
  selecionados,
  todosSelecionados,
  onAlternarTodos,
  onAlternarLinha,
  onAbrir,
  onBaixar,
  onCopiar,
}: {
  relatorios: ItemRelatorio[];
  selecionados: string[];
  todosSelecionados: boolean;
  onAlternarTodos: () => void;
  onAlternarLinha: (id: string) => void;
  onAbrir: (doc: ItemRelatorio) => void;
  onBaixar: (rotulo: string) => void;
  onCopiar: (texto: string, rotulo: string) => void;
}) {
  return (
    <div className="nx-scroll overflow-x-auto">
      <table className="w-full min-w-[980px]">
        <thead className="border-b border-white/[0.06]">
          <tr>
            <th className={`${CABECALHO_CLASS} w-10`}>
              <Check marcado={todosSelecionados} rotulo="Selecionar todos" onClick={onAlternarTodos} />
            </th>
            <th className={CABECALHO_CLASS}>Relatório</th>
            <th className={CABECALHO_CLASS}>{traduzir('tipo', "Tipo")}</th>
            <th className={CABECALHO_CLASS}>Competência</th>
            <th className={CABECALHO_CLASS}>Formato</th>
            <th className={CABECALHO_CLASS}>{traduzir('status', "Status")}</th>
            <th className={`${CABECALHO_CLASS} text-right`}>Tamanho</th>
            <th className={CABECALHO_CLASS}>Gerado</th>
            <th className={`${CABECALHO_CLASS} text-right`}>Ação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {relatorios.map((rel) => (
            <tr
              key={rel.id}
              onClick={() => onAbrir(rel)}
              className="cursor-pointer transition-colors hover:bg-white/[0.02]"
            >
              <td className="px-5 py-4 align-middle">
                <Check
                  marcado={selecionados.includes(rel.id)}
                  rotulo={`Selecionar ${rel.id}`}
                  onClick={() => onAlternarLinha(rel.id)}
                />
              </td>
              <td className="px-5 py-4 align-middle">
                <div className="flex items-center gap-2">
                  <FileBarChart className="h-3.5 w-3.5 shrink-0 text-[#7c5cfc]" />
                  <span className="text-[12.5px] text-white/85">{rel.nome}</span>
                </div>
              </td>
              <td className="whitespace-nowrap px-5 py-4 align-middle text-[12.5px] text-white/60">
                {rel.tipo}
              </td>
              <td className="whitespace-nowrap px-5 py-4 align-middle text-[12.5px] text-white/70">
                {rel.periodo}
              </td>
              <td className="whitespace-nowrap px-5 py-4 align-middle">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/70">
                  {rel.formato === 'XLSX' ? (
                    <FileSpreadsheet className="h-3 w-3" />
                  ) : rel.formato === 'PDF' ? (
                    <FileText className="h-3 w-3" />
                  ) : (
                    <FileJson className="h-3 w-3" />
                  )}
                  {rel.formato}
                </span>
              </td>
              <td className="px-5 py-4 align-middle">
                <StatusBadge status={rel.status} />
              </td>
              <td className="whitespace-nowrap px-5 py-4 text-right align-middle text-[12.5px] text-white/60">
                {rel.tamanho}
              </td>
              <td className="whitespace-nowrap px-5 py-4 align-middle text-[12.5px] text-white/70">
                {rel.gerado}
              </td>
              <td className="px-5 py-4 text-right align-middle">
                <div className="flex items-center justify-end gap-2">
                  <BotaoIcone rotulo={`Ver ${rel.id}`} onClick={() => onAbrir(rel)}>
                    <Eye className="h-3.5 w-3.5" />
                  </BotaoIcone>
                  <BotaoIcone rotulo="Baixar relatório" destaque onClick={() => onBaixar(`Relatório ${rel.nome}`)}>
                    <Download className="h-3.5 w-3.5" />
                  </BotaoIcone>
                  <BotaoIcone
                    rotulo="Copiar identificador"
                    onClick={() => onCopiar(rel.id, 'Identificador do relatório')}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </BotaoIcone>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


/* =============================================================================
   11. PÁGINA
   ========================================================================== */

/** Conjunto de documentos por aba, já tipado como união para filtros/drawer. */
const BASE: Record<Aba, Documento[]> = {
  nfe: [],
  pix: [],
  boleto: [],
  relatorios: [],
};

/** Relatórios não têm valor fiscal — não entram na soma. */
const valorDoDoc = (doc: Documento): number => (doc.kind === 'relatorio' ? 0 : doc.valor);

/** Competência (MM/AAAA) do mês corrente — derivada do relógio, sem dado fixo. */
const competenciaAtual = () => {
  const agora = new Date();
  return `${String(agora.getMonth() + 1).padStart(2, '0')}/${agora.getFullYear()}`;
};

export default function FiscalPage() {
  const router = useRouter();

  const [aba, setAba] = useState<Aba>('nfe');
  const [busca, setBusca] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [tipoFilter, setTipoFilter] = useState('Todos');
  const [periodoFilter, setPeriodoFilter] = useState<string>('Todos');
  const [origemFilter, setOrigemFilter] = useState('Todos');
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [statusFiscal, setStatusFiscal] = useState<StatusFiscal | null>(null);
  const [carregandoStatus, setCarregandoStatus] = useState(true);
  const [erroStatus, setErroStatus] = useState<string | null>(null);
  // O backend só habilitará a integração após implementar e validar o provedor.
  const integracaoConectada = statusFiscal?.integracaoConfigurada === true;

  const [drawerDoc, setDrawerDoc] = useState<Documento | null>(null);
  const [printNfe, setPrintNfe] = useState<ItemNfe | null>(null);
  const [printPix, setPrintPix] = useState<ItemPix | null>(null);
  const [printBoleto, setPrintBoleto] = useState<ItemBoleto | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const timerToast = useRef<number | null>(null);

  const carregarStatusFiscal = useCallback(async () => {
    setCarregandoStatus(true);
    setErroStatus(null);
    try {
      const resposta = await api.get<StatusFiscal>('/fiscal/status');
      setStatusFiscal(resposta.data);
    } catch (erro) {
      setStatusFiscal(null);
      setErroStatus(erro instanceof Error ? erro.message : 'Não foi possível consultar o backend fiscal.');
    } finally {
      setCarregandoStatus(false);
    }
  }, []);

  useEffect(() => {
    void carregarStatusFiscal();
  }, [carregarStatusFiscal]);

  /* ---- Ações ------------------------------------------------------------- */

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (timerToast.current) window.clearTimeout(timerToast.current);
    timerToast.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(
    () => () => {
      if (timerToast.current) window.clearTimeout(timerToast.current);
    },
    [],
  );

  const copiar = useCallback(
    async (texto: string, rotulo: string) => {
      const copiado = await copiarTexto(texto);
      showToast(copiado ? `${rotulo} copiado` : `Não foi possível copiar ${rotulo.toLowerCase()}`);
    },
    [showToast],
  );

  const baixar = useCallback(
    (rotulo: string) =>
      showToast(`${rotulo}: download indisponível sem integração fiscal oficial.`),
    [showToast],
  );

  const fecharTudo = useCallback(() => {
    setPrintNfe(null);
    setPrintPix(null);
    setPrintBoleto(null);
    setDrawerDoc(null);
  }, []);

  const imprimirVia = useCallback(
    (doc: Documento) => {
      if (doc.kind === 'nfe') setPrintNfe(doc);
      else if (doc.kind === 'pix') setPrintPix(doc);
      else if (doc.kind === 'boleto') setPrintBoleto(doc);
      else showToast('Relatórios não possuem via de impressão');
    },
    [showToast],
  );

  const alternarLinha = useCallback((id: string) => {
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );
  }, []);

  const limparFiltros = useCallback(() => {
    setBusca('');
    setStatusFilter('Todos');
    setTipoFilter('Todos');
    setOrigemFilter('Todos');
    setPeriodoFilter('Todos');
  }, []);


  /* ---- Dados derivados ---------------------------------------------------- */

  const documentos = BASE[aba];

  const filtrados = useMemo(() => {
    const termo = semAcento(busca);
    return documentos.filter((doc) => {
      if (termo && !semAcento(textoPesquisavel(doc)).includes(termo)) return false;
      if (statusFilter !== 'Todos' && doc.status !== statusFilter) return false;
      if (tipoFilter !== 'Todos' && doc.tipo !== tipoFilter) return false;
      if (origemFilter !== 'Todos' && 'origem' in doc && doc.origem !== origemFilter) return false;
      return dentroDoPeriodo(doc.iso, periodoFilter);
    });
  }, [documentos, busca, statusFilter, tipoFilter, origemFilter, periodoFilter]);

  const opcoes = useMemo(() => {
    const daAba = BASE[aba];
    const origens = daAba
      .map((doc) => ('origem' in doc ? doc.origem : null))
      .filter((valor): valor is string => Boolean(valor));
    return {
      status: ['Todos', ...Array.from(new Set(daAba.map((doc) => doc.status)))],
      tipo: ['Todos', ...Array.from(new Set(daAba.map((doc) => doc.tipo)))],
      origem: ['Todos', ...Array.from(new Set(origens))],
    };
  }, [aba]);

  const kpis = useMemo(() => {
    const docs = [...BASE.nfe, ...BASE.pix, ...BASE.boleto];
    const total = docs.length;
    const valor = docs.reduce((soma, doc) => soma + valorDoDoc(doc), 0);
    const concluidos = docs.filter((doc) => tomDoStatus(doc.status) === 'ok').length;
    const atencao = docs.filter((doc) =>
      ['aviso', 'erro'].includes(tomDoStatus(doc.status)),
    ).length;
    return {
      total,
      valor,
      taxa: total > 0 ? `${Math.round((concluidos / total) * 100)}%` : '—',
      atencao,
    };
  }, []);

  const todosSelecionados =
    filtrados.length > 0 && filtrados.every((doc) => selecionados.includes(doc.id));

  const alternarTodos = useCallback(() => {
    setSelecionados((atual) =>
      todosSelecionados
        ? atual.filter((id) => !filtrados.some((doc) => doc.id === id))
        : [...new Set([...atual, ...filtrados.map((doc) => doc.id)])],
    );
  }, [filtrados, todosSelecionados]);

  const filtrosAtivos =
    Boolean(busca) ||
    statusFilter !== 'Todos' ||
    tipoFilter !== 'Todos' ||
    origemFilter !== 'Todos' ||
    periodoFilter !== 'Todos';

  /* Trocar de aba reinicia busca, filtros e seleção — evita combinações que
     não existem no conjunto novo (ex.: "Pendente" na aba de relatórios). */
  useEffect(() => {
    limparFiltros();
    setSelecionados([]);
  }, [aba, limparFiltros]);

  /* ESC fecha o overlay e trava o scroll do body enquanto ele estiver aberto. */
  const overlayAberto = Boolean(drawerDoc || printNfe || printPix || printBoleto);
  useEffect(() => {
    if (!overlayAberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fecharTudo();
    };
    document.addEventListener('keydown', aoTeclar);
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [overlayAberto, fecharTudo]);

  /* ---- Render ------------------------------------------------------------- */

  const vazio = VAZIO[aba];
  const rotuloAba = (TABS.find((t) => t.key === aba) ?? TABS[0]).label;
  const semResultado = integracaoConectada && filtrados.length === 0 && documentos.length > 0;
  const relatoriosFiltrados = filtrados.filter(
    (doc): doc is ItemRelatorio => doc.kind === 'relatorio',
  );
  const docsFiltrados = filtrados.filter((doc): doc is DocComDados => doc.kind !== 'relatorio');


  return (
    <div className="fiscal-root">
      <style>{fiscalCss}</style>

      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* 1. Cabeçalho */}
        <header className="min-w-0">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-white/10 bg-[#1c1c2e] px-3 text-[12px] text-white/60 transition-all hover:bg-white/[0.06] hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </button>

          <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-white/40">Gestão</div>
          <h1 className="mt-1 text-[26px] font-black leading-tight tracking-tight text-white sm:text-[32px]">
            Fiscal Brasil
          </h1>
          <p className="mt-2 max-w-3xl text-[14px] leading-6 text-white/60">
            Documentos fiscais e cobranças por tipo — exibidos somente quando gerados por integração
            oficial. Sem simulação de documentos.
          </p>
        </header>

        {/* 2. KPIs */}
        <section
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Indicadores fiscais"
        >
          <Kpi
            titulo="Documentos no período"
            valor={integracaoConectada ? String(kpis.total) : '—'}
            apoio={
              integracaoConectada ? (
                <>
                  <FileText className="h-3 w-3" />
                  NF-e, PIX e boletos
                </>
              ) : (
                <>
                  <Timer className="h-3 w-3" />
                  aguarda integração fiscal
                </>
              )
            }
            icone={FileText}
            tom="roxo"
          />
          <Kpi
            titulo="Valor fiscal total"
            valor={integracaoConectada ? formatBRL(kpis.valor) : '—'}
            apoio={
              integracaoConectada ? (
                <>
                  <ArrowUpRight className="h-3 w-3 text-[#22c55e]" />
                  competência {competenciaAtual()}
                </>
              ) : (
                <>
                  <Wallet className="h-3 w-3" />
                  backend fiscal não conectado
                </>
              )
            }
            icone={Wallet}
            tom="verde"
          />
          <Kpi
            titulo="Concluídos com sucesso"
            valor={integracaoConectada ? kpis.taxa : '—'}
            apoio={
              integracaoConectada ? (
                <>
                  <CheckCircle2 className="h-3 w-3 text-[#22c55e]" />
                  emitidos, pagos e registrados
                </>
              ) : (
                <>
                  <Activity className="h-3 w-3" />
                  sem consulta à SEFAZ
                </>
              )
            }
            icone={CheckCircle2}
            tom="verde"
          />
          <Kpi
            titulo="Pendências e alertas"
            valor={integracaoConectada ? String(kpis.atencao) : '—'}
            apoio={
              integracaoConectada ? (
                <>
                  <ArrowDownRight className="h-3 w-3 text-[#eab308]" />
                  exigem ação do fiscal
                </>
              ) : (
                <>
                  <Timer className="h-3 w-3" />
                  pendências não consultadas
                </>
              )
            }
            icone={Timer}
            tom="ambar"
          />
        </section>


        {/* 3. Banner de integração */}
        <section className="flex flex-col gap-4 rounded-[20px] border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] text-[var(--nx-accent)]">
                <PlugZap className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-[var(--nx-ink)]">Integração Fiscal</span>
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${
                      integracaoConectada
                        ? 'animate-pulse bg-[#7c5cfc] shadow-[0_0_20px_rgba(124,92,252,0.3)]'
                        : 'bg-white/20'
                    }`}
                  />
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                      integracaoConectada
                        ? 'border border-[#eab308]/30 bg-[#eab308]/10 text-[#eab308]'
                        : 'border border-white/10 bg-white/[0.06] text-white/50'
                    }`}
                  >
                    {integracaoConectada ? 'Prévia' : 'Inativo'}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-white/50">
                  {carregandoStatus
                    ? 'Consultando o status fiscal no backend…'
                    : erroStatus
                      ? `Status fiscal indisponível: ${erroStatus}`
                      : statusFiscal?.emissaoHabilitada
                        ? 'Emissão habilitada conforme configuração do backend'
                        : 'Backend consultado; emissão fiscal permanece desabilitada'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="inline-flex h-8 items-center rounded-full border border-white/10 bg-[#24243a] px-3 text-[12px] text-white/60">
                {statusFiscal?.provedor ?? 'Nenhum adaptador fiscal implementado'}
              </span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
                <input
                  type="text"
                  readOnly
                  value={carregandoStatus ? 'Consultando status…' : 'Credenciais fiscais indisponíveis'}
                  aria-label="API Key do provedor fiscal"
                  className="h-9 w-full rounded-[10px] border border-white/10 bg-[#24243a] pl-9 pr-3 font-mono text-[12px] tracking-wide text-white/70 outline-none"
                />
              </div>
              <span className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/10 bg-[#24243a] px-3 text-[12px] text-white/60">
                <ShieldAlert className="h-3.5 w-3.5 text-white/40" />
                Configuração segura de certificado pendente
              </span>
            </div>
          </div>


          <div className="flex shrink-0 flex-col gap-3 lg:items-end">
            <div className="flex items-center gap-3 text-[11.5px] text-white/40">
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                {erroStatus ? 'Falha ao consultar backend' : 'Integração indisponível'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5" />
                Aguardando configuração oficial
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={carregandoStatus}
                onClick={() => void carregarStatusFiscal()}
                title="Consulta o estado atual no backend fiscal."
                className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 text-[12px] text-white/70 transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {carregandoStatus ? 'Consultando…' : 'Atualizar status'}
              </button>
              <button
                type="button"
                disabled
                title="Nenhuma integração fiscal está disponível no backend."
                className={`flex h-9 cursor-not-allowed items-center gap-2 rounded-full px-5 text-[12px] font-semibold opacity-50 transition-all ${
                  integracaoConectada
                    ? 'border border-white/10 bg-white/[0.06] text-white/80 hover:bg-white/10'
                    : 'bg-white text-black hover:bg-white/90'
                }`}
              >
                <PlugZap className="h-3.5 w-3.5" />
                Integração indisponível
              </button>
            </div>
          </div>
        </section>

        {/* 4. Tabs */}
        <nav
          className="fiscal-scroll-hide flex gap-2 overflow-x-auto pb-2"
          aria-label="Tipos de documento fiscal"
        >
          {TABS.map((tab) => {
            const ativo = aba === tab.key;
            const total = BASE[tab.key].length;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setAba(tab.key)}
                aria-current={ativo ? 'page' : undefined}
                className={`inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-all ${
                  ativo
                    ? 'bg-white text-black'
                    : 'border border-white/10 bg-[#1c1c2e] text-white/60 hover:text-white/80'
                }`}
              >
                <tab.icone className="h-3.5 w-3.5" />
                {tab.label}
                <span
                  className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
                    ativo ? 'bg-black/10 text-black' : 'bg-white/[0.06] text-white/50'
                  }`}
                >
                  {total}
                </span>
              </button>
            );
          })}
        </nav>


        {/* 5. Card de conteúdo */}
        <section className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#1c1c2e] shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <div className="flex min-h-14 flex-col gap-3 border-b border-white/[0.06] bg-[#1c1c2e]/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 sm:w-[280px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
                <input
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nº, cliente, CPF..."
                  aria-label="Buscar documentos fiscais"
                  className="h-9 w-full rounded-full border border-white/10 bg-[#24243a] pl-9 pr-3 text-[12px] text-white outline-none transition-colors placeholder:text-white/35 focus:border-[#7c5cfc]/60"
                />
              </div>
              <div className="fiscal-scroll-hide flex items-center gap-2 overflow-x-auto">
                <Filtro rotulo={traduzir('status', "Status")} valor={statusFilter} opcoes={opcoes.status} onChange={setStatusFilter} />
                <Filtro rotulo={traduzir('tipo', "Tipo")} valor={tipoFilter} opcoes={opcoes.tipo} onChange={setTipoFilter} />
                <Filtro rotulo={traduzir('periodo', "Período")} valor={periodoFilter} opcoes={PERIODOS} onChange={setPeriodoFilter} />
                {aba !== 'relatorios' && (
                  <Filtro rotulo="Origem" valor={origemFilter} opcoes={opcoes.origem} onChange={setOrigemFilter} />
                )}
                {filtrosAtivos && (
                  <button
                    type="button"
                    onClick={limparFiltros}
                    className="h-8 shrink-0 rounded-full px-3 text-[12px] font-medium text-white/50 transition-all hover:bg-white/[0.06] hover:text-white"
                  >{traduzir('limpar', "Limpar")}</button>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {selecionados.length > 0 && (
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-full border border-[#7c5cfc]/30 bg-[#7c5cfc]/10 px-2.5 py-1 text-[11px] font-medium text-[#a78bfa]">
                    {selecionados.length} selecionado{selecionados.length > 1 ? 's' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => baixar(`${selecionados.length} documentos fiscais`)}
                    className="flex h-8 items-center gap-1.5 rounded-full bg-[#7c5cfc]/15 px-3 text-[12px] font-medium text-[#7c5cfc] transition-all hover:bg-[#7c5cfc]/25"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Baixar XML
                  </button>
                </span>
              )}
              {aba === 'relatorios' && (
                <button
                  type="button"
                  disabled
                  title="A geração de relatórios fiscais ainda não está implementada."
                  className="flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-white/70 transition-all hover:bg-white/10"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Gerar relatório
                </button>
              )}
              <BotaoIcone rotulo="Atualizar listagem indisponível sem integração" disabled onClick={() => undefined}>
                <RefreshCw className="h-3.5 w-3.5" />
              </BotaoIcone>
              <BotaoIcone rotulo="Exportação indisponível sem dados" disabled onClick={() => undefined}>
                <Download className="h-3.5 w-3.5" />
              </BotaoIcone>
              <BotaoIcone
                rotulo="Mais ações indisponíveis sem integração"
                disabled
                onClick={() => undefined}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </BotaoIcone>
            </div>
          </div>


          {/* Corpo: tabela ou estado vazio */}
          {!integracaoConectada || filtrados.length === 0 ? (
            <EstadoVazio
              titulo={semResultado ? 'Nenhum documento encontrado' : vazio.titulo}
              descricao={
                semResultado
                  ? 'Ajuste a busca ou limpe os filtros para ver os documentos desta aba.'
                  : vazio.descricao
              }
              icone={semResultado ? SearchX : vazio.icone}
              acao={
                semResultado ? (
                  <button
                    type="button"
                    onClick={limparFiltros}
                    className="flex h-9 items-center gap-2 rounded-full bg-white px-5 text-[12px] font-semibold text-black transition-all hover:bg-white/90"
                  >
                    <SearchX className="h-3.5 w-3.5" />
                    Limpar filtros
                  </button>
                ) : undefined
              }
            />
          ) : aba === 'relatorios' ? (
            <TabelaRelatorios
              relatorios={relatoriosFiltrados}
              selecionados={selecionados}
              todosSelecionados={todosSelecionados}
              onAlternarTodos={alternarTodos}
              onAlternarLinha={alternarLinha}
              onAbrir={setDrawerDoc}
              onBaixar={baixar}
              onCopiar={copiar}
            />
          ) : (
            <TabelaDocumentos
              documentos={docsFiltrados}
              selecionados={selecionados}
              todosSelecionados={todosSelecionados}
              onAlternarTodos={alternarTodos}
              onAlternarLinha={alternarLinha}
              onAbrir={setDrawerDoc}
              onImprimir={imprimirVia}
              onCopiar={copiar}
              onMais={() => showToast('Ações indisponíveis sem integração oficial')}
            />
          )}
        </section>

        {/* 6. Aviso de conformidade */}
        <div className="mt-6 flex gap-3 rounded-[16px] border border-white/[0.06] bg-[#0f0f1a] px-5 py-4">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[#7c5cfc]/20 bg-[#7c5cfc]/10 text-[#7c5cfc]">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <p className="text-[11.5px] leading-relaxed text-white/40">
            <strong className="text-white/60">Fiscal Brasil</strong> • esta aba não possui conexão
            com SEFAZ, PSP ou banco no backend. Emissão de documentos, cobranças e relatórios está
            indisponível até que uma integração oficial seja implementada e configurada. Nenhum
            documento, pagamento ou certificado é simulado.
          </p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fiscal-toast fixed bottom-6 right-6 z-[60] flex h-11 max-w-[calc(100vw-48px)] items-center gap-2 rounded-full bg-white px-4 text-[12px] font-medium text-black shadow-[0_12px_40px_rgba(0,0,0,0.4)]"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#7c5cfc]" />
          <span className="truncate">{toast}</span>
        </div>
      )}

      {/* Overlays */}
      {drawerDoc && (
        <DrawerDocumento
          doc={drawerDoc}
          onClose={fecharTudo}
          onCopiar={copiar}
          onImprimir={imprimirVia}
          onBaixar={baixar}
        />
      )}
      {printNfe && (
        <DanfeModal nfe={printNfe} onClose={fecharTudo} onCopiar={copiar} onBaixar={baixar} />
      )}
      {printPix && (
        <PixComprovanteModal
          pix={printPix}
          onClose={fecharTudo}
          onCopiar={copiar}
          onBaixar={baixar}
        />
      )}
      {printBoleto && (
        <BoletoViaModal
          boleto={printBoleto}
          onClose={fecharTudo}
          onCopiar={copiar}
          onBaixar={baixar}
        />
      )}
    </div>
  );
}

