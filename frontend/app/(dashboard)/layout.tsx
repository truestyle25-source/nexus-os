'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Sparkles, ShoppingCart, TrendingUp, Package, Boxes,
  ShoppingBag, Truck, Users, DollarSign, FileBarChart, UserCog, Clock,
  Target, Upload, Search, GitBranch, Bell, Plug,
  Settings, LogOut, Menu, X, FileText, Gauge, Receipt, CreditCard, Building2,
  ChevronLeft, ChevronRight, BadgeCheck, User, Radar,
} from 'lucide-react';
import api, { getToken } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { definirIdioma, t as traduzir, tMenu, tGrupo, getIdioma } from '@/lib/i18n';
import { lerPrefs } from '@/lib/prefs';

/**
 * Shell do dashboard — fiel ao Layout Mestre V2.1:
 * sidebar única #121221, grupos em caixa alta, accent #7C3AED.
 * Todos os módulos existentes do NEXUS OS estão preservados; os itens
 * novos (Relatórios, Indicadores, Fiscal, Assinatura, Plataforma,
 * Configurações) apontam para telas com estado vazio honesto até a fase
 * de integração correspondente.
 */
const menuPrincipal = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'IA NEXUS', href: '/ia', icon: Sparkles },
  { name: 'PDV', href: '/pdv', icon: ShoppingCart },
  { name: 'Vendas', href: '/vendas', icon: TrendingUp },
  { name: 'Produtos', href: '/produtos', icon: Package },
  { name: 'Estoque', href: '/estoque', icon: Boxes },
  { name: 'Compras', href: '/compras', icon: ShoppingBag },
  { name: 'Fornecedores', href: '/fornecedores', icon: Truck },
  { name: 'Clientes', href: '/clientes', icon: Users },
];

const menuGestao = [
  { name: 'Financeiro', href: '/financeiro', icon: DollarSign },
  { name: 'Fluxo de Caixa', href: '/fluxo', icon: GitBranch },
  { name: 'DRE', href: '/dre', icon: FileBarChart },
  { name: 'Metas', href: '/metas', icon: Target },
  { name: 'RH', href: '/rh', icon: UserCog },
  { name: 'Radar Organizacional', href: '/radar-organizacional', icon: Radar },
  { name: 'Ponto', href: '/ponto', icon: Clock },
  { name: 'Relatórios', href: '/relatorios', icon: FileText },
  { name: 'Indicadores', href: '/indicadores', icon: Gauge },
  { name: 'Fiscal Brasil', href: '/fiscal', icon: Receipt },
];

const menuSistema = [
  { name: 'Importação', href: '/importacao', icon: Upload },
  { name: 'Alertas', href: '/alertas', icon: Bell },
  { name: 'Integrações', href: '/central-integracoes', icon: Plug },
  { name: 'Assinatura', href: '/assinatura', icon: CreditCard },
  { name: 'Plataforma', href: '/plataforma', icon: Building2 },
  { name: 'Configurações', href: '/configuracoes', icon: Settings },
];

const grupos = [
  { titulo: 'Principal', itens: menuPrincipal },
  { titulo: 'Gestão', itens: menuGestao },
  { titulo: 'Sistema', itens: menuSistema },
];

/** Todos os itens de menu em lista única — usado no título do topbar. */
const todosOsItens = grupos.flatMap((g) => g.itens);

/** Rota de destino de cada grupo retornado por GET /pesquisa-global. */
const GRUPOS_BUSCA: Array<{ chave: keyof ResultadosBusca; label: string; href: string }> = [
  { chave: 'produtos', label: 'Produtos', href: '/produtos' },
  { chave: 'clientes', label: 'Clientes', href: '/clientes' },
  { chave: 'funcionarios', label: 'Funcionários', href: '/rh' },
  { chave: 'fornecedores', label: 'Fornecedores', href: '/fornecedores' },
  { chave: 'vendas', label: 'Vendas', href: '/vendas' },
];

interface ResultadosBusca {
  produtos: Array<{ id: string; nome?: string }>;
  clientes: Array<{ id: string; nome?: string }>;
  funcionarios: Array<{ id: string; nome?: string }>;
  fornecedores: Array<{ id: string; nome?: string }>;
  vendas: Array<{ id: string; total?: string | number }>;
}

const RESULTADOS_VAZIOS: ResultadosBusca = {
  produtos: [],
  clientes: [],
  funcionarios: [],
  fornecedores: [],
  vendas: [],
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  /**
   * Versão de render do rótulo. Trocar o idioma em Configurações dispara
   * `nexus:prefs`; sem este contador, o menu continuaria em português até a
   * próxima navegação. Incrementar `idiomaRev` força o redesenho dos rótulos.
   */
  const [idiomaRev, setIdiomaRev] = useState(0);
  useEffect(() => {
    const aoMudar = () => setIdiomaRev((n) => n + 1);
    window.addEventListener('nexus:prefs', aoMudar);
    window.addEventListener('nexus:aparencia', aoMudar);
    window.addEventListener('storage', aoMudar);
    return () => {
      window.removeEventListener('nexus:prefs', aoMudar);
      window.removeEventListener('nexus:aparencia', aoMudar);
      window.removeEventListener('storage', aoMudar);
    };
  }, []);
  // `idiomaRev` é lido aqui para participates da lista de dependências acima.
  void idiomaRev;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [user, setUser] = useState<{ nome?: string; email?: string } | null>(null);
  const [notificacoes, setNotificacoes] = useState<Array<{ id: string; lida?: boolean; titulo?: string }>>([]);
  const notifRef = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLDivElement>(null);
  const inputBuscaRef = useRef<HTMLInputElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [marcandoLida, setMarcandoLida] = useState<string | null>(null);
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<ResultadosBusca | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);

  // Idioma da interface: definido antes de qualquer renderizacao de texto.
  useEffect(() => {
    definirIdioma(lerPrefs().idioma);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('nexus_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const u = localStorage.getItem('nexus_user');
      if (u) setUser(JSON.parse(u));
    } catch {
      setUser(null);
    }
    let ativo = true;
    api
      .get<Array<{ id: string; lida?: boolean; titulo?: string }>>('/notificacoes')
      .then(({ data }) => { if (ativo) setNotificacoes(data); })
      .catch(() => {})
      .finally(() => { if (ativo) { /* dados vazios são aceitáveis */ } });
    return () => { ativo = false; };
  }, [router]);

  const unreadCount = notificacoes.filter((n) => n.lida !== true).length;

  // Fecha o sino e a busca ao clicar fora (o clique no próprio painel não fecha).
  useEffect(() => {
    function aoClicarFora(e: MouseEvent) {
      const alvo = e.target as Node;
      if (notifRef.current && !notifRef.current.contains(alvo)) setNotifOpen(false);
      if (buscaRef.current && !buscaRef.current.contains(alvo)) setBuscaAberta(false);
    }
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, []);

  // ⌘K / Ctrl+K foca a busca de verdade (atalho real, não decorativo).
  useEffect(() => {
    function atalho(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setBuscaAberta(true);
        inputBuscaRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setBuscaAberta(false);
        setNotifOpen(false);
      }
    }
    window.addEventListener('keydown', atalho);
    return () => window.removeEventListener('keydown', atalho);
  }, []);

  // Busca global real: GET /pesquisa-global, com 400ms de espera entre teclas.
  useEffect(() => {
    const limpo = termo.trim();
    if (limpo.length < 2) {
      setResultados(null);
      setErroBusca(null);
      setBuscando(false);
      return;
    }

    let ativo = true;
    setBuscando(true);
    const timer = setTimeout(() => {
      api
        .get<ResultadosBusca>(`/pesquisa-global?q=${encodeURIComponent(limpo)}`)
        .then(({ data }) => {
          if (!ativo) return;
          setResultados({ ...RESULTADOS_VAZIOS, ...data });
          setErroBusca(null);
        })
        .catch((err: any) => {
          if (!ativo) return;
          setResultados(null);
          setErroBusca(err?.message || 'Não foi possível pesquisar.');
        })
        .finally(() => {
          if (ativo) setBuscando(false);
        });
    }, 400);

    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [termo]);

  const totalResultados = resultados
    ? GRUPOS_BUSCA.reduce((soma, g) => soma + (resultados[g.chave]?.length ?? 0), 0)
    : 0;

  /** Marca a notificação como lida no backend (POST /notificacoes/:id/lida). */
  async function marcarComoLida(id: string) {
    setMarcandoLida(id);
    try {
      await api.post(`/notificacoes/${id}/lida`, {});
      setNotificacoes((atual) =>
        atual.map((n) => (n.id === id ? { ...n, lida: true } : n)),
      );
    } catch {
      // Sem efeito visual: se o backend recusar, o badge continua com o número real.
    } finally {
      setMarcandoLida(null);
    }
  }

  function abrirResultado(href: string) {
    setBuscaAberta(false);
    setTermo('');
    router.push(href);
  }

  // Título do topbar acompanha a rota atual (não é mais fixo em "Dashboard").
  const itemAtual =
    todosOsItens.find((i) => i.href === pathname) ??
    todosOsItens
      .filter((i) => i.href !== '/' && pathname.startsWith(i.href))
      .sort((a, b) => b.href.length - a.href.length)[0];
  const tituloAtual = itemAtual?.name ?? 'Dashboard';

  const fusoHorario =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : '';

  function renderLink(item: { name: string; href: string; icon: any }) {
    // "/" (Dashboard) só fica ativo na rota exata; os demais por prefixo.
    const isActive =
      item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
    return (
      <Link
        key={item.name}
        href={item.href}
        onClick={() => setSidebarOpen(false)}
        className={`relative flex items-center gap-3 px-3 py-2 rounded-[10px] text-[13.5px] font-medium transition-colors ${sidebarCollapsed ? 'justify-center px-2' : ''}
          ${
            isActive
              ? 'bg-[var(--nx-accent)]/15 text-[var(--nx-ink)]'
              : 'text-[var(--nx-ink-2)] hover:text-[var(--nx-ink)] hover:bg-[var(--nx-surface-3)]'
          }`}
      >
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full bg-[var(--nx-accent)] shadow-[0_0_10px_rgba(124,92,255,0.8)]"
          />
        )}
        <item.icon
          className={`w-[18px] h-[18px] shrink-0 ${
            isActive ? 'text-[var(--nx-accent-2)]' : ''
          }`}
        />
        {!sidebarCollapsed && <span className="truncate">{tMenu(item.name)}</span>}
      </Link>
    );
  }

  const handleLogout = async () => {
    // Higiene do PDV local: remove catálogo/confirmados, PRESERVA vendas
    // pendentes de sincronização (elas precisam sobreviver ao logout para
    // serem reconciliadas com a mesma idempotency key após o próximo login).
    try {
      const { limparDadosLocaisSeguro } = await import('@/lib/pdv');
      await limparDadosLocaisSeguro();
    } catch {
      // Sem IndexedDB (SSR/exclusão) ou erro de storage: saída segue mesmo assim.
    }
    try {
      await api.logout();
    } catch {
      // Backend fora do ar ou token já inválido: garante a saída local.
    }
    router.replace('/login');
  };

  return (
    <div className="min-h-screen bg-[var(--nx-canvas)] text-[var(--nx-ink)] flex">
      {/* Sidebar Desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 bg-[var(--nx-surface)] border-r border-[var(--nx-border)] transform ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 transition-transform duration-200 ease-in-out lg:static lg:inset-auto flex flex-col ${sidebarCollapsed ? 'w-16' : 'w-64'}`}
      >
        {/* Brand com badge V2.1 + botão recolher (<) */}
        <div className="flex items-center justify-between gap-3 px-4 py-5 border-b border-[var(--nx-border)]">
          <div className="flex items-center gap-3 min-w-0">
            {!sidebarCollapsed && (
              <>
                <div className="w-9 h-9 rounded-[10px] bg-[var(--nx-accent)] flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(124,92,255,0.5)]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-5 h-5 text-white fill-white"
                  >
                    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-[var(--nx-ink)] font-bold text-[14px] leading-tight truncate">NEXUS OS</p>
                  <p className="text-[9px] tracking-[0.14em] text-[var(--nx-ink-3)] uppercase">Central de comando</p>
                </div>
                <span className="flex items-center gap-1 rounded-full bg-[var(--nx-accent)]/15 border border-[var(--nx-accent)]/30 px-2 py-0.5 text-[10px] font-medium text-[var(--nx-accent-2)] tracking-[0.14em] uppercase shrink-0">
                  <BadgeCheck className="w-3 h-3" />
                  V2.1
                </span>
              </>
            )}
            {sidebarCollapsed && (
              <div className="w-9 h-9 rounded-[10px] bg-[var(--nx-accent)] flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(124,92,255,0.5)]">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-5 h-5 text-white fill-white"
                >
                  <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
                </svg>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="text-[var(--nx-ink-3)] hover:text-[var(--nx-ink)] transition-colors"
              aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
            >
              {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-[var(--nx-ink-2)] hover:text-[var(--nx-ink)] shrink-0"
              aria-label="Fechar menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navegação */}
        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto nx-scroll">
          {grupos.map((g) => (
            <div key={g.titulo}>
              {!sidebarCollapsed && (
                <p className="px-3 mb-1.5 text-[10px] tracking-[0.14em] text-[var(--nx-ink-3)] font-semibold uppercase">
                  {tGrupo(g.titulo)}
                </p>
              )}
              <div className="space-y-0.5">{g.itens.map(renderLink)}</div>
            </div>
          ))}
        </nav>

        {/* Card do usuário + Logout */}
        <div className="p-3 border-t border-[var(--nx-border)] space-y-2">
          {!sidebarCollapsed && user && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-[10px] bg-[var(--nx-surface-2)] border border-[var(--nx-border)]">
              <div className="w-8 h-8 rounded-full bg-[var(--nx-accent)] flex items-center justify-center shrink-0 text-[var(--nx-ink)] font-bold text-[12px]">
                {(user.nome || '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[var(--nx-ink)] truncate">{user.nome || 'Usuário'}</p>
                <p className="text-[10px] text-[var(--nx-ink-2)] truncate">{user.email || '—'}</p>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-[10px] text-[13.5px] font-medium text-[var(--nx-ink-2)] hover:text-[var(--nx-ink)] hover:bg-[var(--nx-surface-3)] transition-colors"
          >
            <LogOut className="w-[18px] h-[18px]" />
            {!sidebarCollapsed && <span>{traduzir('acao_sair', 'Sair')}</span>}
          </button>
        </div>
      </aside>

      {/* Overlay mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar desktop: busca global real, notificações reais e exportação real */}
        <header className="hidden lg:flex items-center justify-between gap-4 px-6 py-4 bg-[var(--nx-canvas)] border-b border-[var(--nx-border)]">
          <div className="flex items-center gap-4 min-w-0">
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold text-[var(--nx-ink)] leading-snug truncate">
                {tituloAtual}
              </h1>
              <p className="text-[11px] text-[var(--nx-ink-3)] mt-0.5 truncate">
                {pathname === '/'
                  ? traduzir('topbar_indicadores', 'Indicadores gerais do negócio')
                  : traduzir('topbar_modulo', `Módulo ${tituloAtual} • dados reais da empresa`, { nome: tMenu(tituloAtual) })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Busca global — GET /pesquisa-global (mesmo endpoint do módulo Pesquisa) */}
            <div className="relative" ref={buscaRef}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--nx-ink-3)]" />
              <input
                ref={inputBuscaRef}
                type="search"
                value={termo}
                onChange={(e) => {
                  setTermo(e.target.value);
                  setBuscaAberta(true);
                }}
                onFocus={() => setBuscaAberta(true)}
                placeholder={traduzir('buscar_placeholder', 'Buscar no NEXUS…')}
                className="w-64 pl-9 pr-12 py-2 rounded-[10px] bg-[var(--nx-surface-3)] border border-[var(--nx-border)] text-[13px] text-[var(--nx-ink)] placeholder-[var(--nx-ink-3)] focus:outline-none focus:border-[var(--nx-accent)]/40 focus:bg-[var(--nx-surface-3)] transition-colors"
              />
              {!termo && (
                <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] tracking-[0.14em] text-[var(--nx-ink-3)] bg-[var(--nx-surface-3)] border border-[var(--nx-border)] rounded px-1.5 py-0.5">
                  ⌘K
                </kbd>
              )}
              {termo && (
                <button
                  type="button"
                  onClick={() => setTermo('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--nx-ink-3)] hover:text-[var(--nx-ink)] p-0.5"
                  aria-label="Limpar busca"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {buscaAberta && termo.trim().length >= 2 && (
                <div className="absolute right-0 top-full mt-2 w-[26rem] rounded-[14px] bg-[var(--nx-surface)] border border-[var(--nx-border)] shadow-[0_20px_60px_var(--nx-shadow-pop)] overflow-hidden z-50">
                  <div className="px-4 py-2.5 border-b border-[var(--nx-border)] flex items-center justify-between">
                    <span className="text-[11px] text-[var(--nx-ink-2)]">
                      {traduzir('busca_titulo', 'Pesquisa global — produtos, clientes, RH, fornecedores e vendas')}
                    </span>
                    {buscando && <span className="text-[10px] text-[var(--nx-accent-2)]">Buscando…</span>}
                  </div>

                  {erroBusca ? (
                    <p className="px-4 py-5 text-[12px] text-amber-300/80">{erroBusca}</p>
                  ) : !buscando && totalResultados === 0 ? (
                    <p className="px-4 py-5 text-[12px] text-[var(--nx-ink-3)]">
                      {traduzir('busca_vazio', `Nenhum registro encontrado para “${termo.trim()}”.`, { termo: termo.trim() })}
                    </p>
                  ) : (
                    <div className="max-h-80 overflow-y-auto nx-scroll">
                      {GRUPOS_BUSCA.map((g) => {
                        const itens = resultados?.[g.chave] ?? [];
                        if (itens.length === 0) return null;
                        return (
                          <div key={g.chave} className="py-1">
                            <div className="px-4 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--nx-ink)]/25">
                              {g.label} ({itens.length})
                            </div>
                            {itens.slice(0, 5).map((item) => (
                              <button
                                key={`${g.chave}-${item.id}`}
                                type="button"
                                onClick={() => abrirResultado(g.href)}
                                className="w-full text-left px-4 py-2 hover:bg-[var(--nx-surface-2)] transition-colors"
                              >
                                <span className="block text-[12.5px] text-[var(--nx-ink)] truncate">
                                  {(item as any).nome || `Venda ${String(item.id).slice(0, 8)}`}
                                </span>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => abrirResultado(`/pesquisa`)}
                    className="w-full text-center text-[11.5px] text-[var(--nx-accent-2)] hover:text-[var(--nx-ink)] border-t border-[var(--nx-border)] py-2.5 transition-colors"
                  >
                    {traduzir('busca_completa', 'Abrir pesquisa completa')}
                  </button>
                </div>
              )}
            </div>
            {/* Sino de notificações com badge */}
            <div className="relative" ref={notifRef as any}>
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className={`relative w-9 h-9 flex items-center justify-center rounded-full transition-colors ${notifOpen ? 'bg-[var(--nx-surface-3)]' : 'hover:bg-[var(--nx-surface-3)]'}`}
                aria-label={`Notificações (${unreadCount} não lidas)`}
                aria-expanded={notifOpen}
              >
                <Bell className="w-5 h-5 text-[var(--nx-ink-2)]" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-[0_0_12px_rgba(239,68,68,0.6)]">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {/* Dropdown de notificações */}
              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 rounded-[14px] bg-[var(--nx-surface)] border border-[var(--nx-border)] shadow-[0_20px_60px_var(--nx-shadow-pop)] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--nx-border)]">
                    <span className="text-[12px] font-medium text-[var(--nx-ink)]">{traduzir('notif_titulo', 'Notificações')}</span>
                    {unreadCount > 0 && (
                      <span className="text-[10px] text-[var(--nx-accent-2)] font-medium">{traduzir('notif_nova', `${unreadCount} nova(s)`, { n: unreadCount })}</span>
                    )}
                  </div>
                  {notificacoes.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <Bell className="w-5 h-5 text-[var(--nx-ink-3)] mx-auto mb-2" />
                      <p className="text-[12px] text-[var(--nx-ink-3)]">{traduzir('notif_vazia', 'Nenhuma notificação')}</p>
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto nx-scroll">
                      {notificacoes.map((n) => (
                        <div
                          key={n.id}
                          className={`px-4 py-3 border-b border-[var(--nx-border)] hover:bg-[var(--nx-surface-2)] transition-colors ${
                            n.lida !== true ? 'bg-[var(--nx-accent)]/5' : ''
                          }`}
                        >
                          <p className="text-[12px] text-[var(--nx-ink)] truncate">{n.titulo || 'Notificação'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="px-4 py-2.5 border-t border-[var(--nx-border)]">
                    <Link href="/alertas" className="block text-center text-[12px] text-[var(--nx-accent-2)] hover:text-[var(--nx-ink)] transition-colors">
                      Ver todas
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Topbar mobile (mantido) */}
        <header className="lg:hidden flex items-center justify-between p-4 bg-[var(--nx-surface)] border-b border-[var(--nx-border)]">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-[var(--nx-ink)]"
            aria-label="Abrir menu"
          >
            <Menu className="w-6 h-6" />
          </button>
          <span className="font-bold text-[var(--nx-ink)]">NEXUS OS</span>
          <div className="w-6" />
        </header>

        <main className="flex-1 overflow-auto bg-[var(--nx-canvas)]">
          {children}
        </main>
      </div>
    </div>
  );
}


