'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  FileWarning,
  Flame,
  Info,
  Loader2,
  MessageCircle,
  Package,
  Play,
  Plus,
  Search,
  ShieldAlert,
  ShoppingCart,
  Target,
  Timer,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import api, { getToken } from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';
import { formatDateTime, formatTime, shortId } from '@/lib/format';
import { t as traduzir, tMenu } from '@/lib/i18n';

/**
 * Alertas, notificacoes e automacao - Layout Mestre V2.1.
 *
 * Refator visual + funcional da tela que ja existia: nenhum arquivo novo,
 * nenhuma pagina de configuracoes paralela. A tela continua lendo os mesmos
 * endpoints (GET /alertas, GET /notificacoes, GET /automacao/regras) e
 * escrevendo nos mesmos (POST /automacao/executar,
 * POST /automacao/executar-compras-paradas, POST /automacao/regras e
 * POST /notificacoes/:id/lida).
 *
 * Duas regras inegociaveis desta tela:
 *
 * 1. Nenhum numero ficticio. Metricas, abas e contadores derivam sempre dos
 *    dados reais da empresa; quando nao ha dado, a tela mostra estado vazio
 *    honesto em vez de numero inventado.
 * 2. Nenhum botao decorativo. A API ainda nao expoe
 *    PUT/DELETE /automacao/regras/:id nem PATCH /alertas/:id, entao as acoes
 *    oferecidas ao usuario sao apenas as que gravam de verdade: executar o
 *    motor, verificar compras paradas, criar regra, marcar notificacao como
 *    lida, abrir a entidade citada no alerta e copiar o identificador.
 *
 * O construtor SE/ENTAO do modal usa exatamente as cinco condicoes que
 * POST /automacao/executar ja verifica no motor, cada uma apontando para o
 * valor real do enum TipoAlerta do Prisma.
 */

type Prioridade = 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA';
type StatusAlerta = 'ABERTO' | 'LIDO' | 'RESOLVIDO';
type Icone = ComponentType<{ className?: string; style?: CSSProperties }>;

interface Alerta {
  id: string;
  tipo: string;
  prioridade: Prioridade;
  titulo: string;
  descricao: string;
  status: StatusAlerta;
  entidade?: string | null;
  entidadeId?: string | null;
  origem?: string | null;
  createdAt: string;
}

interface Notificacao {
  id: string;
  tipo: string;
  prioridade: Prioridade;
  titulo: string;
  mensagem: string;
  lida: boolean;
  origem?: string | null;
  link?: string | null;
  createdAt: string;
}

interface Regra {
  id: string;
  nome: string;
  condicao: string;
  acao: string;
  ativa: boolean;
  origem?: string | null;
  createdAt: string;
}

type AbaAlerta = 'todos' | 'critico' | 'aviso' | 'baixo';

/* ------------------------------------------------------------------ *
 * Design System da tela                                               *
 * Tokens da auditoria concentrados em constantes, para que nenhuma      *
 * classe da lista do padrao mestre seja repetida a mao.                 *
 * ------------------------------------------------------------------ */

const CARD = 'rounded-[20px] bg-[var(--nx-surface-3)] border border-white/[0.06] min-w-0';

const BTN_PRIMARIO =
  'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[12px] text-[12.5px] font-bold text-white bg-[var(--nx-accent)] hover:bg-[var(--nx-accent-2)] active:scale-[0.98] transition-all shadow-[0_8px_24px_rgba(108,92,231,0.35),inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-50 disabled:cursor-not-allowed';

const BTN_SECUNDARIO =
  'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[12px] text-[12.5px] font-semibold text-white/70 bg-white/[0.06] border border-white/[0.06] hover:bg-white/[0.10] hover:text-white active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const BTN_ICONO =
  'w-8 h-8 rounded-[10px] grid place-items-center text-white/40 border border-transparent hover:text-white hover:bg-white/[0.06] hover:border-white/10 transition';

const FIELD =
  'w-full h-11 px-4 rounded-[12px] bg-[#0D0D14] border border-white/[0.08] text-[13px] text-white placeholder:text-white/25 outline-none transition focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20';

const ROTULO = 'text-[10px] uppercase tracking-[0.16em] text-white/30 font-bold';

/* ------------------------------ niveis ------------------------------ */

const NIVEL: Record<Prioridade, { label: string; chip: string; ponto: string }> = {
  CRITICA: {
    label: 'CRÍTICO',
    chip: 'bg-[var(--nx-red)]/10 border-[var(--nx-red)]/25 text-[var(--nx-red)]',
    ponto: 'bg-[var(--nx-red)]',
  },
  ALTA: {
    label: 'ALTO',
    chip: 'bg-[var(--nx-amber)]/10 border-[var(--nx-amber)]/25 text-[var(--nx-amber)]',
    ponto: 'bg-[var(--nx-amber)]',
  },
  MEDIA: {
    label: 'MÉDIO',
    chip: 'bg-[var(--nx-green)]/10 border-[var(--nx-green)]/25 text-[var(--nx-green)]',
    ponto: 'bg-[var(--nx-green)]',
  },
  BAIXA: {
    label: 'BAIXO',
    chip: 'bg-[var(--nx-surface-2)]/10 border-white/10 text-white/50',
    ponto: 'bg-white/30',
  },
};

/* --------------------- tipos de alerta (enum real) ------------------- */

const TIPO_META: Record<string, { label: string; icone: Icone; cor: string }> = {
  ESTOQUE_BAIXO: { label: 'Estoque baixo', icone: Package, cor: 'var(--nx-red)' },
  ESTOQUE_ZERADO: { label: 'Estoque zerado', icone: Package, cor: 'var(--nx-red)' },
  VALIDADE: { label: 'Validade', icone: Clock, cor: 'var(--nx-amber)' },
  META_BAIXA: { label: 'Meta abaixo', icone: Target, cor: 'var(--nx-accent)' },
  DESPESA_ALTA: { label: 'Despesa alta', icone: CreditCard, cor: 'var(--nx-amber)' },
  COMPRA_PENDENTE: { label: 'Compra parada', icone: Timer, cor: 'var(--nx-green)' },
  QUEDA_VENDAS: { label: 'Queda de vendas', icone: Target, cor: 'var(--nx-amber)' },
  CONTA_VENCIDA: { label: 'Conta vencida', icone: FileWarning, cor: 'var(--nx-red)' },
  FALTA: { label: 'Falta de registro', icone: AlertTriangle, cor: 'var(--nx-amber)' },
  ATRASO: { label: 'Atraso', icone: Clock, cor: 'var(--nx-amber)' },
  HORA_EXTRA: { label: 'Hora extra', icone: Clock, cor: 'var(--nx-green)' },
  ANOMALIA_IA: { label: 'Anomalia IA', icone: Zap, cor: 'var(--nx-accent)' },
};

const TIPO_PADRAO = { label: 'Alerta', icone: AlertTriangle, cor: '#6C5CE7' };

/** Destino real de cada entidade que o motor referencia no alerta. */
const ROTA_ENTIDADE: Record<string, string> = {
  Produto: '/produtos',
  Compra: '/compras',
  Meta: '/metas',
  Venda: '/vendas',
};

/* ------------------------------------------------------------------ *
 * Construtor SE/ENTAO                                                 *
 * As cinco condicoes SAO as mesmas cinco verificacoes executadas por     *
 * POST /automacao/executar. `padrao` e o valor que o motor ja usa hoje,  *
 * entao a regra criada nasce coerente com o comportamento real.          *
 * ------------------------------------------------------------------ */

const SE_OPTIONS: Array<{
  id: string;
  rotulo: string;
  curto: string;
  descricao: string;
  icone: Icone;
  cor: string;
  unidade: string;
  padrao: number;
  tipo: string;
}> = [
  {
    id: 'estoque_min',
    rotulo: 'Estoque abaixo do minimo',
    curto: 'estoque < minimo',
    descricao: 'Saldo do produto menor ou igual ao minimo cadastrado',
    icone: Package,
    cor: '#FF5A5F',
    unidade: 'un',
    padrao: 10,
    tipo: 'ESTOQUE_BAIXO',
  },
  {
    id: 'validade',
    rotulo: 'Validade proxima',
    curto: 'validade < dias',
    descricao: 'Produto vence dentro do prazo definido',
    icone: Clock,
    cor: '#FFB020',
    unidade: 'dias',
    padrao: 7,
    tipo: 'VALIDADE',
  },
  {
    id: 'meta_70',
    rotulo: 'Meta abaixo do percentual',
    curto: 'meta < %',
    descricao: 'Meta do periodo abaixo do percentual definido',
    icone: Target,
    cor: '#6C5CE7',
    unidade: '%',
    padrao: 70,
    tipo: 'META_BAIXA',
  },
  {
    id: 'despesa_up',
    rotulo: 'Despesas acima da media',
    curto: 'despesa > media',
    descricao: 'Despesa do dia acima da media dos ultimos 7 dias',
    icone: CreditCard,
    cor: '#FFB020',
    unidade: '%',
    padrao: 30,
    tipo: 'DESPESA_ALTA',
  },
  {
    id: 'compra_parada',
    rotulo: 'Compra parada ha dias',
    curto: 'compra parada > dias',
    descricao: 'Compra em SOLICITADA/PEDIDO sem confirmacao',
    icone: Timer,
    cor: '#22C55E',
    unidade: 'dias',
    padrao: 5,
    tipo: 'COMPRA_PENDENTE',
  },
];

const ACAO_OPTIONS: Array<{
  id: string;
  rotulo: string;
  descricao: string;
  icone: Icone;
  cor: string;
}> = [
  {
    id: 'notificar_gestor',
    rotulo: 'Notificar gestor',
    descricao: 'Gera notificacao na central',
    icone: Bell,
    cor: '#6C5CE7',
  },
  {
    id: 'alerta_critico',
    rotulo: 'Alerta critico',
    descricao: 'Abre alerta com prioridade alta',
    icone: Flame,
    cor: '#FF5A5F',
  },
  {
    id: 'ordem_compra',
    rotulo: 'Ordem de compra',
    descricao: 'Registra a sugestao de reposicao na regra',
    icone: ShoppingCart,
    cor: '#22C55E',
  },
  {
    id: 'whatsapp',
    rotulo: 'WhatsApp',
    descricao: 'Guarda a intencao de avisar (sem envio integrado)',
    icone: MessageCircle,
    cor: '#38BDF8',
  },
  {
    id: 'pausar_produto',
    rotulo: 'Pausar produto',
    descricao: 'Guarda a intencao de pausa (nao altera o cadastro)',
    icone: Ban,
    cor: '#FFB020',
  },
  {
    id: 'bloquear_categoria',
    rotulo: 'Bloquear categoria',
    descricao: 'Guarda a intencao de bloqueio (nao altera lancamentos)',
    icone: ShieldAlert,
    cor: '#FF5A5F',
  },
];

/** Severidade escolhida no modal - define a `prioridade` do alerta gerado. */
const SEVERIDADES: Array<{ id: Prioridade; rotulo: string; descricao: string }> = [
  { id: 'CRITICA', rotulo: 'Critico', descricao: 'Interrompe a operacao' },
  { id: 'ALTA', rotulo: 'Aviso', descricao: 'Exige atencao' },
  { id: 'MEDIA', rotulo: 'Info', descricao: 'Apenas informativo' },
];

/* ------------------------------------------------------------------ *
 * Serializacao da regra (colunas String do Prisma)                   *
 * ------------------------------------------------------------------ */

interface RegraPayload {
  nome: string;
  condicao: string;
  acao: string;
}

/**
 * `RegraAutomacao.condicao` e `.acao` sao colunas String no Prisma. Para que
 * a tela consiga ler de volta o que gravou (e o motor consiga, no futuro,
 * executar sem parsing humano), gravamos JSON estavel. Como o banco pode
 * conter regras antigas em texto livre, a leitura sempre cai no texto cru
 * quando o JSON nao bate.
 */
function serializarRegra(
  nome: string,
  seId: string,
  param: number,
  acaoIds: string[],
  severidade: Prioridade,
): RegraPayload {
  const se = SE_OPTIONS.find((o) => o.id === seId);
  return {
    nome: nome.trim(),
    condicao: JSON.stringify({
      se: seId,
      param,
      tipo: se?.tipo ?? 'ESTOQUE_BAIXO',
      // Severidade do modal: antes existia só no estado local e era descartada
      // no salvamento. O motor lê este campo para dar a prioridade ao alerta.
      severidade,
    }),
    acao: JSON.stringify(acaoIds),
  };
}

interface CondicaoLida {
  rotulo: string;
  resumo: string;
  tipo: string | null;
}

/** Le a coluna `condicao` tolerando JSON novo e texto livre legado. */
function lerCondicao(texto: string | null | undefined): CondicaoLida {
  if (!texto) {
    return { rotulo: 'Condicao livre', resumo: 'nao informada', tipo: null };
  }
  try {
    const dados = JSON.parse(texto) as { se?: string; param?: number; tipo?: string };
    const se = SE_OPTIONS.find((o) => o.id === dados?.se);
    if (!se) throw new Error('formato desconhecido');
    const valor = typeof dados.param === 'number' ? dados.param : se.padrao;
    const unidade = se.unidade === 'un' ? '' : se.unidade;
    return {
      rotulo: se.rotulo,
      resumo: `${se.curto} ${valor}${unidade}`,
      tipo: dados.tipo ?? se.tipo,
    };
  } catch {
    return { rotulo: 'Condicao livre', resumo: texto, tipo: null };
  }
}

/** Le a coluna `acao` devolvendo os rotulos conhecidos (ou o texto cru). */
function lerAcoes(texto: string | null | undefined): string[] {
  if (!texto) return [];
  try {
    const ids = JSON.parse(texto) as string[];
    if (!Array.isArray(ids)) throw new Error('formato desconhecido');
    return ids.map((id) => ACAO_OPTIONS.find((a) => a.id === id)?.rotulo ?? id);
  } catch {
    return [texto];
  }
}

/** Aplica o filtro de aba e de busca sobre os alertas reais. */
function filtrarAlertas(
  alertas: Alerta[],
  aba: AbaAlerta,
  busca: string,
): Alerta[] {
  const termo = busca.trim().toLowerCase();
  return alertas.filter((a) => {
    const prioridade = (a.prioridade ?? 'MEDIA') as Prioridade;
    const passaAba =
      aba === 'todos' ||
      (aba === 'critico' && prioridade === 'CRITICA') ||
      (aba === 'aviso' && (prioridade === 'ALTA' || prioridade === 'MEDIA')) ||
      (aba === 'baixo' && prioridade === 'BAIXA');
    if (!passaAba) return false;
    if (termo === '') return true;
    return (
      a.titulo.toLowerCase().includes(termo) ||
      (a.descricao ?? '').toLowerCase().includes(termo) ||
      (a.entidade ?? '').toLowerCase().includes(termo)
    );
  });
}

/* ------------------------------ toasts ------------------------------ */

type ToastTipo = 'sucesso' | 'alerta' | 'erro';

interface ToastItem {
  id: number;
  tipo: ToastTipo;
  mensagem: string;
}

const TOAST_ESTILO: Record<ToastTipo, { borda: string; barra: string; icone: Icone }> = {
  sucesso: { borda: 'border-[#22C55E]/30', barra: 'bg-[#22C55E]', icone: CheckCircle2 },
  alerta: { borda: 'border-[#FFB020]/30', barra: 'bg-[#FFB020]', icone: AlertTriangle },
  erro: { borda: 'border-[#FF5A5F]/35', barra: 'bg-[#FF5A5F]', icone: X },
};

/** Pilha de toasts no canto inferior direito, com barra de progresso. */
function Toasts({
  toasts,
  onRemove,
}: {
  toasts: ToastItem[];
  onRemove: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-5 right-5 z-[60] flex w-[330px] max-w-[calc(100vw-2.5rem)] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const estilo = TOAST_ESTILO[toast.tipo];
        const Icone = estilo.icone;
        return (
          <button
            key={toast.id}
            type="button"
            onClick={() => onRemove(toast.id)}
            className={`nx-toast relative overflow-hidden text-left rounded-[14px] border ${estilo.borda} bg-[#151528] shadow-[0_16px_40px_rgba(0,0,0,0.55)] px-4 py-3`}
          >
            <span className="flex items-start gap-2.5">
              <Icone className="w-4 h-4 shrink-0 mt-[1px] text-white/70" />
              <span className="text-[12.5px] text-white/90 leading-snug flex-1">
                {toast.mensagem}
              </span>
            </span>
            <span
              className={`absolute bottom-0 left-0 h-[3px] nx-toast-bar ${estilo.barra}`}
            />
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------ modal ------------------------------- */

interface FormRegra {
  nome: string;
  seId: string;
  param: number;
  acaoIds: string[];
  severidade: Prioridade;
}

const FORM_VAZIO: FormRegra = {
  nome: '',
  seId: SE_OPTIONS[0].id,
  param: SE_OPTIONS[0].padrao,
  acaoIds: [],
  severidade: 'ALTA',
};

interface ModalRegraProps {
  form: FormRegra;
  erro: string | null;
  salvando: boolean;
  onChange: (patch: Partial<FormRegra>) => void;
  onAlternarAcao: (id: string) => void;
  onSalvar: () => void;
  onFechar: () => void;
}

/**
 * Construtor de regra SE/ENTAO. Trava o foco dentro do dialogo (mesmo padrao
 * ja usado em Configuracoes) para que a criacao da regra seja acessivel por
 * teclado, e fecha com Esc ou no clique do fundo.
 */
function ModalRegra({
  form,
  erro,
  salvando,
  onChange,
  onAlternarAcao,
  onSalvar,
  onFechar,
}: ModalRegraProps) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const seSelecionada = SE_OPTIONS.find((o) => o.id === form.seId) ?? SE_OPTIONS[0];

  // `onFechar` é arrow inline no pai: usá-lo como dependência fazia o efeito
  // re-executar a cada tecla e o `focaveis()[0]?.focus()` roubar o foco do
  // campo em edição. O callback vai para um ref e o efeito não depende dele.
  const onFecharRef = useRef(onFechar);
  onFecharRef.current = onFechar;

  useEffect(() => {
    const node = caixaRef.current;
    if (!node) return;

    const focaveis = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

    focaveis()[0]?.focus();

    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.stopPropagation();
        onFecharRef.current();
        return;
      }
      if (evento.key !== 'Tab') return;
      const itens = focaveis();
      if (itens.length === 0) return;
      const primeiro = itens[0];
      const ultimo = itens[itens.length - 1];
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    };

    node.addEventListener('keydown', aoTeclar);
    return () => node.removeEventListener('keydown', aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const podeSalvar =
    form.nome.trim().length >= 3 && form.acaoIds.length > 0 && !salvando;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onFechar}
        aria-hidden="true"
      />
      <div
        ref={caixaRef}
        role="dialog"
        aria-modal="true"
        aria-label="Criar nova regra de automacao"
        className="nx-modal relative w-full max-w-[660px] max-h-[88vh] rounded-[24px] bg-[#151528] border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className={ROTULO}>Automacao</div>
            <h3 className="text-[17px] font-bold text-white tracking-tight mt-1.5">
              Criar nova regra de automacao
            </h3>
            <p className="text-[12.5px] text-white/50 mt-1">
              Defina quando o sistema deve agir sozinho
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label={traduzir('fechar', "Fechar")}
            className={`${BTN_ICONO} shrink-0`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto nx-scroll px-6 py-5 space-y-5">
          <div>
            <label htmlFor="regra-nome" className={`${ROTULO} block mb-2`}>
              Nome da regra
            </label>
            <input
              id="regra-nome"
              type="text"
              value={form.nome}
              onChange={(e) => onChange({ nome: e.target.value })}
              placeholder="Ex: Repor estoque critico de filamentos"
              className={FIELD}
            />
          </div>

          {/* SE */}
          <div className="rounded-2xl bg-[#0D0D14] border border-white/[0.07] p-4 space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-1 rounded-full bg-white text-[#0D0D14] font-bold text-[10px] tracking-[0.16em]">
                SE
              </span>
              <span className="text-[12px] text-white/50">
                Condicao que dispara a regra
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SE_OPTIONS.map((op) => {
                const ativo = form.seId === op.id;
                const Icone = op.icone;
                return (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => onChange({ seId: op.id, param: op.padrao })}
                    aria-pressed={ativo}
                    className={`text-left px-3.5 py-3 rounded-xl border flex gap-2.5 items-start transition-all ${
                      ativo
                        ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40'
                        : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/15'
                    }`}
                  >
                    <span
                      className="w-8 h-8 rounded-lg grid place-items-center shrink-0 border"
                      style={{
                        backgroundColor: `${op.cor}${ativo ? '22' : '14'}`,
                        borderColor: `${op.cor}${ativo ? '55' : '30'}`,
                      }}
                    >
                      <Icone className="w-4 h-4" style={{ color: op.cor }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-semibold text-white">
                        {op.rotulo}
                      </span>
                      <span className="block text-[10.5px] text-white/40 mt-0.5 leading-snug">
                        {op.descricao}
                      </span>
                    </span>
                    {ativo && (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-1 text-[#A99CFF]" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label
                htmlFor="regra-param"
                className="text-[11px] text-white/50 font-medium"
              >
                Parametro
              </label>
              <input
                id="regra-param"
                type="number"
                min={0}
                value={form.param}
                onChange={(e) => onChange({ param: Number(e.target.value) || 0 })}
                className="w-24 h-10 px-3 rounded-xl bg-[#0D0D14] border border-white/[0.08] text-[13px] text-white outline-none focus:border-[#6C5CE7]/50"
              />
              <span className="text-[11px] text-white/40">
                {seSelecionada.unidade}
              </span>
            </div>
          </div>

          {/* ENTAO */}
          <div className="rounded-2xl bg-[#0D0D14] border border-white/[0.07] p-4 space-y-4">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="px-2.5 py-1 rounded-full bg-[#6C5CE7] text-white font-bold text-[10px] tracking-[0.16em]">
                ENTAO
              </span>
              <span className="text-[12px] text-white/50">Acoes automaticas</span>
              <span className="ml-auto text-[11px] text-white/40">
                {form.acaoIds.length} selecionada{form.acaoIds.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ACAO_OPTIONS.map((op) => {
                const ativo = form.acaoIds.includes(op.id);
                const Icone = op.icone;
                return (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => onAlternarAcao(op.id)}
                    aria-pressed={ativo}
                    className={`text-left px-3.5 py-3 rounded-xl border flex gap-2.5 items-start transition-all ${
                      ativo
                        ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40'
                        : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/15'
                    }`}
                  >
                    <span
                      className="w-8 h-8 rounded-lg grid place-items-center shrink-0 border"
                      style={{
                        backgroundColor: `${op.cor}${ativo ? '22' : '14'}`,
                        borderColor: `${op.cor}${ativo ? '55' : '30'}`,
                      }}
                    >
                      <Icone className="w-4 h-4" style={{ color: op.cor }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-semibold text-white">
                        {op.rotulo}
                      </span>
                      <span className="block text-[10.5px] text-white/40 mt-0.5 leading-snug">
                        {op.descricao}
                      </span>
                    </span>
                    {ativo && (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-1 text-[#A99CFF]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Severidade */}
          <div>
            <div className={`${ROTULO} mb-2`}>Severidade</div>
            <div className="grid grid-cols-3 gap-2">
              {SEVERIDADES.map((sev) => {
                const ativo = form.severidade === sev.id;
                const nivel = NIVEL[sev.id];
                return (
                  <button
                    key={sev.id}
                    type="button"
                    onClick={() => onChange({ severidade: sev.id })}
                    aria-pressed={ativo}
                    className={`px-3 py-2.5 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                      ativo
                        ? 'bg-[#6C5CE7]/15 border-[#6C5CE7]/40'
                        : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${nivel.ponto}`} />
                      <span className="text-[12px] font-semibold text-white">
                        {sev.rotulo}
                      </span>
                    </span>
                    <span className="text-[10.5px] text-white/40 text-center leading-tight">
                      {sev.descricao}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-2xl bg-gradient-to-br from-[#1A1A2E] to-[#12121F] border border-white/[0.08] p-4 space-y-3">
            <div className={ROTULO}>Preview da regra</div>
            <div className="flex flex-wrap items-center gap-2 gap-y-1.5">
              <span className="px-2.5 py-1 rounded-full bg-white text-[#0D0D14] font-bold text-[10px] tracking-[0.16em]">
                SE
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#12121F] border border-white/10 text-[11.5px] font-medium text-white/80">
                {(() => {
                  const Icone = seSelecionada.icone;
                  return (
                    <Icone
                      className="w-3.5 h-3.5"
                      style={{ color: seSelecionada.cor }}
                    />
                  );
                })()}
                {seSelecionada.curto} {form.param}
                {seSelecionada.unidade === 'un' ? '' : seSelecionada.unidade}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-white/20" />
              <span className="px-2.5 py-1 rounded-full bg-[#6C5CE7] text-white font-bold text-[10px] tracking-[0.16em]">
                ENTAO
              </span>
              {form.acaoIds.length === 0 ? (
                <span className="text-[11.5px] text-white/30">
                  nenhuma acao escolhida
                </span>
              ) : (
                form.acaoIds.map((id) => {
                  const op = ACAO_OPTIONS.find((a) => a.id === id);
                  if (!op) return null;
                  const Icone = op.icone;
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#12121F] border border-white/10 text-[11.5px] font-medium"
                      style={{ color: op.cor }}
                    >
                      <Icone className="w-3.5 h-3.5" />
                      {op.rotulo}
                    </span>
                  );
                })
              )}
            </div>
            <p className="text-[10.5px] text-white/35 leading-relaxed">
              A regra e gravada em <span className="text-white/50">POST /automacao/regras</span>{' '}
              e passa a constar do catalogo da empresa. O motor SE/ENTAO roda sob demanda (botao
              &quot;Executar automacao agora&quot;): quando a condicao e atingida ele abre o alerta
              com a severidade escolhida e, se &quot;Notificar gestor&quot; estiver marcado, gera a
              notificacao na central. As demais acoes ficam registradas na regra, sem efeito
              automatico.
            </p>
          </div>

          {erro && (
            <div
              role="alert"
              className="rounded-xl bg-[#FF5A5F]/10 border border-[#FF5A5F]/25 p-3 text-[12px] text-[#FF8A8E] flex items-start gap-2"
            >
              <Info className="w-4 h-4 shrink-0 mt-[1px]" />
              <span>{erro}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-white/[0.06] bg-[#0D0D14]/80 backdrop-blur-xl">
          <span className="text-[11px] text-white/35">
            {form.acaoIds.length === 0
              ? 'Escolha ao menos uma acao para criar a regra.'
              : `${form.acaoIds.length} acao(oes) selecionada(s) e gravadas na regra.`}
          </span>
          <div className="flex items-center gap-3 ml-auto">
            <button type="button" onClick={onFechar} className={BTN_SECUNDARIO}>{traduzir('cancelar', "Cancelar")}</button>
            <button
              type="button"
              onClick={onSalvar}
              disabled={!podeSalvar}
              className={BTN_PRIMARIO}
            >
              {salvando ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Criar regra
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== *
 * Pagina                                                             *
 * ================================================================== */

export default function Alertas() {
  const router = useRouter();

  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [aba, setAba] = useState<AbaAlerta>('todos');
  const [busca, setBusca] = useState('');

  const [executando, setExecutando] = useState(false);
  const [marcandoLida, setMarcandoLida] = useState<string | null>(null);

  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState<FormRegra>(FORM_VAZIO);
  const [formErro, setFormErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);
  // Timers rastreados para limpar no unmount: sem isto, o setState do toast
  // disparava depois que a tela ja tinha saido da arvore.
  const timersToast = useRef<number[]>([]);

  const removerToast = useCallback((id: number) => {
    setToasts((atual) => atual.filter((t) => t.id !== id));
  }, []);

  const notificar = useCallback(
    (mensagem: string, tipo: ToastTipo = 'sucesso') => {
      toastId.current += 1;
      const id = toastId.current;
      setToasts((atual) => [...atual.slice(-3), { id, tipo, mensagem }]);
      timersToast.current.push(window.setTimeout(() => removerToast(id), 3600));
    },
    [removerToast],
  );

  useEffect(() => {
    const pendentes = timersToast.current;
    return () => pendentes.forEach((t) => window.clearTimeout(t));
  }, []);

  /**
   * Carrega os tres recursos reais da tela. A leitura de `regras` e tolerante
   * a falha: um erro no catalogo nao derruba a pagina. Ela tambem NAO apaga a
   * lista que ja esta em tela — um usuario pode ter `alertas.visualizar` sem
   * ter `automacao.visualizar` (403 legitimo, sem inventar "vazio"), ou a
   * falha pode ser transitória de rede/servidor: em nenhum dos dois casos
   * esconder tudo e dizer "nenhuma regra" seria verdade.
   */
  async function load() {
    try {
      const [resAlertas, resNotifs] = await Promise.all([
        api.get<Alerta[]>('/alertas'),
        api.get<Notificacao[]>('/notificacoes'),
      ]);
      setAlertas(Array.isArray(resAlertas.data) ? resAlertas.data : []);
      setNotificacoes(Array.isArray(resNotifs.data) ? resNotifs.data : []);
      setErro(null);
    } catch (err) {
      const mensagem =
        (err as { message?: string })?.message ||
        'Não foi possível carregar alertas e notificações.';
      setErro(mensagem);
    }

    try {
      const { data } = await api.get<Regra[]>('/automacao/regras');
      setRegras(Array.isArray(data) ? data : []);
    } catch {
      // Mantem a lista atual (ver comentario de `load`): nao inventa "vazio".
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    let ativo = true;
    (async () => {
      await load();
      if (ativo) setLoading(false);
    })();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function executarAutomacao() {
    setExecutando(true);
    setErro(null);
    setAviso(null);
    try {
      const { data } = await api.post<{ alertasCriados?: number; motor?: string }>(
        '/automacao/executar',
        {},
      );
      const total = data?.alertasCriados ?? 0;
      setAviso(
        `Automação executada — ${total} alerta(s) gerado(s) pelas regras SE/ENTÃO${
          data?.motor ? ` (${data.motor})` : ''
        }.`,
      );
      notificar(
        total > 0
          ? `Motor executado: ${total} alerta(s) gerado(s).`
          : 'Motor executado: nenhum alerta novo — as condições não foram atingidas.',
        total > 0 ? 'sucesso' : 'alerta',
      );
      await load();
    } catch (err) {
      const mensagem =
        (err as { message?: string })?.message || 'Não foi possível executar a automação.';
      setErro(mensagem);
      notificar(mensagem, 'erro');
    } finally {
      setExecutando(false);
    }
  }

  async function executarComprasParadas() {
    setExecutando(true);
    setErro(null);
    setAviso(null);
    try {
      const { data } = await api.post<{ alertasCriados?: number }>(
        '/automacao/executar-compras-paradas',
        {},
      );
      const total = data?.alertasCriados ?? 0;
      setAviso(
        `Verificação de compras paradas concluída — ${total} alerta(s) gerado(s).`,
      );
      notificar(
        total > 0
          ? `${total} compra(s) parada(s) viraram alerta.`
          : 'Nenhuma compra parada acima do prazo.',
        total > 0 ? 'sucesso' : 'alerta',
      );
      await load();
    } catch (err) {
      const mensagem =
        (err as { message?: string })?.message ||
        'Não foi possível verificar compras paradas.';
      setErro(mensagem);
      notificar(mensagem, 'erro');
    } finally {
      setExecutando(false);
    }
  }

  /** Marca a notificação como lida no backend (POST /notificacoes/:id/lida). */
  async function marcarComoLida(id: string) {
    setMarcandoLida(id);
    try {
      await api.post(`/notificacoes/${id}/lida`, {});
      setNotificacoes((atual) =>
        atual.map((n) => (n.id === id ? { ...n, lida: true } : n)),
      );
    } catch (err) {
      // Sem efeito visual: se o backend recusar, o selo continua marcando
      // a notificação como não lida (estado real, nunca inventado).
      notificar(
        (err as { message?: string })?.message ||
          'Não foi possível marcar a notificação como lida.',
        'erro',
      );
    } finally {
      setMarcandoLida(null);
    }
  }

  /**
   * Copia o ID do alerta. Antes o clique chamava `writeText` sem await e
   * mostrava "ID do alerta copiado." mesmo se a promise fosse rejeitada — e,
   * sem clipboard no navegador, o botão nao fazia NADA em silencio. Agora o
   * toast so afirma copiado quando de fato copiou.
   */
  async function copiarIdAlerta(id: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      notificar('Este navegador não permite copiar para a área de transferência.', 'erro');
      return;
    }
    try {
      await navigator.clipboard.writeText(id);
      notificar('ID do alerta copiado.');
    } catch {
      notificar('Não foi possível copiar o ID do alerta (permissão negada pelo navegador).', 'erro');
    }
  }

  function abrirModal() {
    setForm(FORM_VAZIO);
    setFormErro(null);
    setModalAberto(true);
  }

  // Ref rather than state so the close handler stays referentially stable:
  // ModalRegra uses it inside a focus-trap effect, and an inline function
  // would re-run that effect (and steal focus) on every render.
  const salvandoRef = useRef(false);
  salvandoRef.current = salvando;

  const fecharModal = useCallback(() => {
    if (salvandoRef.current) return;
    setModalAberto(false);
    setFormErro(null);
  }, []);

  function alternarAcao(id: string) {
    setForm((atual) => ({
      ...atual,
      acaoIds: atual.acaoIds.includes(id)
        ? atual.acaoIds.filter((a) => a !== id)
        : [...atual.acaoIds, id],
    }));
  }

  async function salvarRegra() {
    const nome = form.nome.trim();
    if (nome.length < 3) {
      setFormErro('Dê um nome com pelo menos 3 caracteres para a regra.');
      return;
    }
    if (form.acaoIds.length === 0) {
      setFormErro('Selecione ao menos uma ação em ENTAO.');
      return;
    }

    setSalvando(true);
    setFormErro(null);
    try {
      const payload = serializarRegra(
        form.nome,
        form.seId,
        form.param,
        form.acaoIds,
        form.severidade,
      );
      const { data } = await api.post<Regra>('/automacao/regras', payload);
      // Insere no topo porque GET /automacao/regras ordena por createdAt desc:
      // a regra nova é a mais recente e a lista não "pula" no reload seguinte.
      setRegras((atual) => [data, ...atual]);
      setModalAberto(false);
      setForm(FORM_VAZIO);
      notificar(`Regra "${nome}" criada. Ela já consta no catálogo da empresa.`);
      await load();
    } catch (err) {
      setFormErro(
        (err as { message?: string })?.message || 'Não foi possível criar a regra.',
      );
    } finally {
      setSalvando(false);
    }
  }

  /* ------------------------------ derivados ------------------------------ */

  const alertasAbertos = useMemo(
    () => alertas.filter((a) => a.status === 'ABERTO'),
    [alertas],
  );

  const contagem = useMemo(
    () => ({
      criticos: alertasAbertos.filter((a) => a.prioridade === 'CRITICA').length,
      avisos: alertasAbertos.filter(
        (a) => a.prioridade === 'ALTA' || a.prioridade === 'MEDIA',
      ).length,
      automacoesHoje: alertas.filter((a) => {
        if (a.origem !== 'AUTOMATICO' || !a.createdAt) return false;
        const quando = new Date(a.createdAt);
        if (Number.isNaN(quando.getTime())) return false;
        const hoje = new Date();
        return (
          quando.getFullYear() === hoje.getFullYear() &&
          quando.getMonth() === hoje.getMonth() &&
          quando.getDate() === hoje.getDate()
        );
      }).length,
      naoLidas: notificacoes.filter((n) => !n.lida).length,
    }),
    [alertas, alertasAbertos, notificacoes],
  );

  const alertasFiltrados = useMemo(
    () => filtrarAlertas(alertas, aba, busca),
    [alertas, aba, busca],
  );

  const ABAS: Array<{ id: AbaAlerta; label: string }> = [
    { id: 'todos', label: 'Todos' },
    { id: 'critico', label: 'Críticos' },
    { id: 'aviso', label: 'Avisos' },
    { id: 'baixo', label: 'Baixa' },
  ];

  /* ------------------------------ carregando ------------------------------ */

  if (loading) {
    return (
      <main className="px-5 sm:px-8 py-6 max-w-[1700px] mx-auto">
        <ModuleHeader title="Alertas, notificações e automação" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[92px] rounded-2xl bg-[#12121F] border border-white/[0.06] animate-pulse"
            />
          ))}
        </div>
        <div className="mt-6 h-[360px] rounded-[20px] bg-[#12121F] border border-white/[0.06] animate-pulse" />
      </main>
    );
  }

  return (
    <div className="min-h-full bg-[#0D0D14] text-white font-['Inter',sans-serif] -m-6 lg:-m-6">
      <style jsx global>{`
        @keyframes nxToastBar {
          from { width: 0%; }
          to { width: 100%; }
        }
        @keyframes nxToastIn {
          from { transform: translateY(12px) scale(0.97); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes nxModalIn {
          from { transform: translateY(12px) scale(0.985); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        .nx-toast { animation: nxToastIn 0.22s ease-out both; }
        .nx-toast-bar { animation: nxToastBar 3.4s linear forwards; }
        .nx-modal { animation: nxModalIn 0.18s ease-out both; }
      `}</style>

      <main className="px-5 sm:px-8 py-6 max-w-[1700px] mx-auto space-y-6">
        <ModuleHeader
          kicker="Central de comando"
          title="Alertas, notificações e automação"
          subtitle="Regras SE/ENTÃO: estoque abaixo do mínimo, meta abaixo de 70%, aumento de despesas e outras condições geram alertas automaticamente."
        />

        {erro && (
          <div
            role="alert"
            className="rounded-2xl border border-[#FF5A5F]/25 bg-[#FF5A5F]/10 px-4 py-3 text-[12.5px] text-[#FF8A8E] flex items-start gap-2.5"
          >
            <Info className="w-4 h-4 shrink-0 mt-[1px]" />
            <span>{erro}</span>
          </div>
        )}

        {aviso && !erro && (
          <div
            role="status"
            className="rounded-2xl border border-[#22C55E]/25 bg-[#22C55E]/10 px-4 py-3 text-[12.5px] text-[#6EE7A0] flex items-start gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-[1px]" />
            <span>{aviso}</span>
          </div>
        )}

        {/* ------------------------------ métricas ------------------------------ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              rotulo: 'Alertas Críticos',
              valor: contagem.criticos,
              detalhe: contagem.criticos === 1 ? 'alerta crítico aberto' : 'alertas críticos abertos',
              Icone: AlertTriangle,
              cor: '#FF5A5F',
            },
            {
              rotulo: 'Avisos',
              valor: contagem.avisos,
              detalhe: 'prioridade alta ou média',
              Icone: Info,
              cor: '#FFB020',
            },
            {
              rotulo: 'Automações Hoje',
              valor: contagem.automacoesHoje,
              detalhe: 'alertas gerados pelo motor',
              Icone: Zap,
              cor: '#6C5CE7',
            },
            {
              rotulo: 'Não Lidas',
              valor: contagem.naoLidas,
              detalhe: 'notificações aguardando leitura',
              Icone: Bell,
              cor: '#38BDF8',
            },
          ].map((kpi) => (
            <div key={kpi.rotulo} className={`${CARD} p-4`}>
              <div className="flex items-start justify-between gap-2">
                <span className={ROTULO}>{kpi.rotulo}</span>
                <span
                  className="w-8 h-8 rounded-[10px] grid place-items-center shrink-0 border"
                  style={{
                    backgroundColor: `${kpi.cor}1A`,
                    borderColor: `${kpi.cor}33`,
                  }}
                >
                  <kpi.Icone className="w-4 h-4" style={{ color: kpi.cor }} />
                </span>
              </div>
              <div className="text-[26px] font-black text-white mt-2 leading-none">
                {kpi.valor}
              </div>
              <div className="text-[11px] text-white/40 mt-1.5">{kpi.detalhe}</div>
            </div>
          ))}
        </div>

        {/* ------------------------------ acoes ------------------------------ */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={executarAutomacao}
            disabled={executando}
            className={BTN_PRIMARIO}
          >
            {executando ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {executando ? 'Executando...' : 'Executar automação agora'}
          </button>

          <button
            type="button"
            onClick={executarComprasParadas}
            disabled={executando}
            className={BTN_SECUNDARIO}
          >
            {executando ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Timer className="w-4 h-4" />
            )}
            Verificar compras paradas
          </button>

          <button type="button" onClick={abrirModal} className={BTN_SECUNDARIO}>
            <Plus className="w-4 h-4" />
            Nova Regra
          </button>

          <div className="ml-auto relative w-full sm:w-[280px]">
            <Search
              className="w-4 h-4 text-white/30 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar alerta, descrição ou entidade"
              aria-label="Buscar alertas"
              className={`${FIELD} pl-10`}
            />
          </div>
        </div>

        {/* --------------------------- grid principal --------------------------- */}
        <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6 items-start">
          {/* Coluna esquerda: alertas + notificacoes */}
          <div className="space-y-6 min-w-0">
            <section className={CARD} aria-labelledby="titulo-alertas">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]">
                <h2
                  id="titulo-alertas"
                  className="text-[12.5px] font-semibold text-white min-w-0"
                >
                  Alertas ({alertas.length})
                </h2>
                <div className="flex items-center gap-1 p-1 rounded-full bg-[#0D0D14] border border-white/[0.07]">
                  {ABAS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setAba(item.id)}
                      aria-pressed={aba === item.id}
                      className={`h-8 px-3 rounded-full text-[11.5px] font-medium transition ${
                        aba === item.id
                          ? 'bg-white text-[#0D0D14]'
                          : 'text-white/50 hover:text-white hover:bg-white/[0.06]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-5 py-4 space-y-3">
                {alertasFiltrados.length === 0 ? (
                  <div className="rounded-2xl bg-[#0D0D14] border border-dashed border-white/10 px-5 py-9 text-center">
                    <div
                      className={`w-11 h-11 rounded-full grid place-items-center mx-auto ${
                        erro ? 'bg-[#FF5A5F]/10' : 'bg-[#22C55E]/10'
                      }`}
                    >
                      {erro ? (
                        <X className="w-5 h-5 text-[#FF5A5F]" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-[#22C55E]" />
                      )}
                    </div>
                    <p className="text-[12.5px] font-medium text-white/60 mt-3">
                      {erro
                        ? 'Não foi possível carregar os alertas'
                        : alertas.length === 0
                          ? 'Tudo sob controle ✅'
                          : 'Nenhum alerta neste filtro'}
                    </p>
                    <p className="text-[11px] text-white/30 mt-1.5 max-w-sm mx-auto leading-relaxed">
                      {erro
                        ? erro
                        : alertas.length === 0
                          ? 'Nenhum alerta gerado pelo motor até agora. Rode a automação para verificar as condições.'
                          : 'Ajuste a busca ou troque de aba para ver os demais alertas.'}
                    </p>
                  </div>
                ) : (
                  alertasFiltrados.map((alerta) => {
                    const nivel = NIVEL[alerta.prioridade] ?? NIVEL.MEDIA;
                    const meta = TIPO_META[alerta.tipo] ?? TIPO_PADRAO;
                    const IconeTipo = meta.icone;
                    const rota = alerta.entidade
                      ? ROTA_ENTIDADE[alerta.entidade]
                      : undefined;
                    return (
                      <article
                        key={alerta.id}
                        className="px-4 py-3.5 rounded-xl bg-[#0D0D14] border border-white/[0.06] flex items-start gap-3.5 transition hover:border-white/[0.12]"
                      >
                        <span
                          className="w-9 h-9 rounded-[10px] grid place-items-center shrink-0 border"
                          style={{
                            backgroundColor: `${meta.cor}1A`,
                            borderColor: `${meta.cor}33`,
                          }}
                        >
                          <IconeTipo className="w-4 h-4" style={{ color: meta.cor }} />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-[12.5px] font-semibold text-white min-w-0">
                              {alerta.titulo}
                            </h3>
                            <span
                              className={`px-2.5 py-1 rounded-full border text-[9.5px] font-bold tracking-[0.12em] ${nivel.chip}`}
                            >
                              {nivel.label}
                            </span>
                            {alerta.status === 'RESOLVIDO' && (
                              <span className="px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.06] text-[9.5px] font-bold tracking-[0.12em] text-white/50">
                                RESOLVIDO
                              </span>
                            )}
                          </div>

                          <p className="text-[11.5px] text-white/50 mt-1 leading-relaxed">
                            {alerta.descricao}
                          </p>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10.5px] text-white/40">
                            <span className="inline-flex items-center gap-1.5">
                              <IconeTipo className="w-3 h-3" />
                              {meta.label}
                            </span>
                            {alerta.entidade && (
                              <span className="inline-flex items-center gap-1.5">
                                {alerta.entidade}
                                {alerta.entidadeId
                                  ? ` ${shortId(alerta.entidadeId)}`
                                  : ''}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1.5">
                              <Clock className="w-3 h-3" />
                              {formatDateTime(alerta.createdAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {rota ? (
                            <a
                              href={rota}
                              className={BTN_ICONO}
                              aria-label={`Abrir ${alerta.entidade}`}
                              title={`Abrir ${alerta.entidade}`}
                            >
                              <ArrowRight className="w-4 h-4" />
                            </a>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => copiarIdAlerta(alerta.id)}
                            className={BTN_ICONO}
                            aria-label="Copiar ID do alerta"
                            title={`ID ${shortId(alerta.id)}`}
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>

            <section className={CARD} aria-labelledby="titulo-notificacoes">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]">
                <h2
                  id="titulo-notificacoes"
                  className="text-[12.5px] font-semibold text-white"
                >
                  Notificações ({notificacoes.length})
                </h2>
                {contagem.naoLidas > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-[#38BDF8]/10 border border-[#38BDF8]/25 text-[#38BDF8] text-[10px] font-bold tracking-[0.12em]">
                    {contagem.naoLidas} NÃO LIDA{contagem.naoLidas === 1 ? '' : 'S'}
                  </span>
                )}
              </div>

              <div className="px-5 py-4">
                {notificacoes.length === 0 ? (
                  <div className="rounded-2xl bg-[#0D0D14] border border-dashed border-white/10 px-5 py-9 text-center">
                    <div className="w-11 h-11 rounded-full bg-white/[0.06] grid place-items-center mx-auto">
                      <Bell className="w-5 h-5 text-white/30" />
                    </div>
                    <p className="text-[12.5px] font-medium text-white/60 mt-3">
                      Nenhuma notificação
                    </p>
                    <p className="text-[11px] text-white/30 mt-1.5 max-w-sm mx-auto leading-relaxed">
                      As notificações do motor e dos módulos aparecem aqui assim que forem geradas.
                    </p>
                  </div>
                ) : (
                  <ol className="relative space-y-3.5 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-white/[0.08]">
                    {notificacoes.map((notificacao) => {
                      const nivel =
                        NIVEL[notificacao.prioridade] ?? NIVEL.MEDIA;
                      return (
                        <li key={notificacao.id} className="relative pl-7">
                          <span
                            className={`absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full border-2 border-[#12121F] ${
                              notificacao.lida ? 'bg-white/20' : nivel.ponto
                            }`}
                            aria-hidden="true"
                          />
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3
                                  className={`text-[12.5px] min-w-0 ${
                                    notificacao.lida
                                      ? 'font-medium text-white/50'
                                      : 'font-semibold text-white'
                                  }`}
                                >
                                  {notificacao.titulo}
                                </h3>
                                {notificacao.link ? (
                                  <a
                                    href={notificacao.link}
                                    className="px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-medium text-white/50 hover:text-white hover:border-white/20 transition"
                                  >
                                    {notificacao.tipo}
                                  </a>
                                ) : (
                                  <span className="px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-medium text-white/50">
                                    {notificacao.tipo}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11.5px] text-white/50 mt-1 leading-relaxed">
                                {notificacao.mensagem}
                              </p>
                              <span className="inline-flex items-center gap-1.5 text-[10.5px] text-white/40 mt-1.5">
                                <Clock className="w-3 h-3" />
                                {formatTime(notificacao.createdAt)} ·{' '}
                                {formatDateTime(notificacao.createdAt)}
                              </span>
                            </div>

                            {!notificacao.lida && (
                              <button
                                type="button"
                                onClick={() => marcarComoLida(notificacao.id)}
                                disabled={marcandoLida === notificacao.id}
                                className={`${BTN_ICONO} shrink-0`}
                                aria-label={`Marcar notificação como lida: ${notificacao.titulo}`}
                                title="Marcar como lida"
                              >
                                {marcandoLida === notificacao.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Check className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </section>
          </div>

          {/* Coluna direita: regras de automacao */}
          <div className="space-y-6 min-w-0">
            <section className={CARD} aria-labelledby="titulo-regras">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06]">
                <h2
                  id="titulo-regras"
                  className="text-[12.5px] font-semibold text-white"
                >
                  Regras de Automação ({regras.length})
                </h2>
                <button
                  type="button"
                  onClick={abrirModal}
                  className="h-8 px-3 rounded-[10px] inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-white bg-[#6C5CE7] hover:bg-[#7A6EF0] active:scale-[0.98] transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nova Regra
                </button>
              </div>

              <div className="px-5 py-4 space-y-3">
                {regras.length === 0 ? (
                  <div className="rounded-2xl bg-[#0D0D14] border border-dashed border-white/10 px-5 py-9 text-center">
                    <div className="w-11 h-11 rounded-full bg-[#6C5CE7]/15 grid place-items-center mx-auto">
                      <Workflow className="w-5 h-5 text-[#A99CFF]" />
                    </div>
                    <p className="text-[12.5px] font-medium text-white/60 mt-3">
                      Nenhuma regra cadastrada
                    </p>
                    <p className="text-[11px] text-white/30 mt-1.5 max-w-xs mx-auto leading-relaxed">
                      Crie a primeira regra SE/ENTÃO para documentar quando o sistema deve agir
                      sozinho nesta empresa.
                    </p>
                    <button
                      type="button"
                      onClick={abrirModal}
                      className={`${BTN_SECUNDARIO} h-10 px-4 mt-4`}
                    >
                      <Plus className="w-4 h-4" />
                      Criar primeira regra
                    </button>
                  </div>
                ) : (
                  regras.map((regra) => {
                    const condicao = lerCondicao(regra.condicao);
                    const acoes = lerAcoes(regra.acao);
                    const opcao = SE_OPTIONS.find((o) => o.id === condicao.tipo);
                    const cor = opcao?.cor ?? '#6C5CE7';
                    return (
                      <article
                        key={regra.id}
                        className="px-4 py-3.5 rounded-xl bg-[#0D0D14] border border-white/[0.06] flex items-start gap-3.5 transition hover:border-white/[0.12]"
                      >
                        <span
                          className="w-9 h-9 rounded-[10px] grid place-items-center shrink-0 border"
                          style={{
                            backgroundColor: `${cor}1A`,
                            borderColor: `${cor}33`,
                          }}
                        >
                          <Workflow className="w-4 h-4" style={{ color: cor }} />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-[12.5px] font-semibold text-white min-w-0">
                              {regra.nome}
                            </h3>
                            <span
                              className={`px-2.5 py-1 rounded-full border text-[9.5px] font-bold tracking-[0.12em] ${
                                regra.ativa
                                  ? 'bg-[#22C55E]/10 border-[#22C55E]/25 text-[#22C55E]'
                                  : 'bg-white/[0.06] border-white/10 text-white/40'
                              }`}
                            >
                              {regra.ativa ? 'ATIVA' : 'INATIVA'}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 gap-y-1 mt-2">
                            <span className="px-2 py-0.5 rounded-full bg-white text-[#0D0D14] font-bold text-[9px] tracking-[0.12em]">
                              SE
                            </span>
                            <span className="text-[11px] text-white/60">
                              {condicao.resumo}
                            </span>
                            <ArrowRight className="w-3 h-3 text-white/20" />
                            <span className="px-2 py-0.5 rounded-full bg-[#6C5CE7] text-white font-bold text-[9px] tracking-[0.12em]">
                              ENTAO
                            </span>
                            {acoes.length === 0 ? (
                              <span className="text-[11px] text-white/30">
                                sem ação definida
                              </span>
                            ) : (
                              acoes.map((acao) => (
                                <span
                                  key={acao}
                                  className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10.5px] font-medium text-white/60"
                                >
                                  {acao}
                                </span>
                              ))
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10.5px] text-white/40">
                            <span className="inline-flex items-center gap-1.5">
                              <Workflow className="w-3 h-3" />
                              {condicao.rotulo}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Clock className="w-3 h-3" />
                              {formatDateTime(regra.createdAt)}
                            </span>
                            {regra.origem && (
                              <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[9.5px] font-medium">
                                {regra.origem}
                              </span>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </div>
      </main>

      {modalAberto && (
        <ModalRegra
          form={form}
          erro={formErro}
          salvando={salvando}
          onChange={(patch) => setForm((atual) => ({ ...atual, ...patch }))}
          onAlternarAcao={alternarAcao}
          onSalvar={salvarRegra}
          onFechar={fecharModal}
        />
      )}

      <Toasts toasts={toasts} onRemove={removerToast} />
    </div>
  );
}
