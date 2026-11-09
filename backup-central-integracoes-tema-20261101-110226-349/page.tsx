'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, Bot, Boxes, CheckCircle2, Copy, CreditCard, Eye, FileCode2,
  Globe, KeyRound, Landmark, Lock, Mail, MinusCircle, Package, Percent, Printer, QrCode,
  Receipt, Scale, Search, Server, ShieldCheck, ShoppingBag, ShoppingCart, Smartphone,
  Sparkles, Store, Trash2, Truck, Users, Webhook, Wifi,
} from 'lucide-react';
import api, { getToken } from '@/lib/api';
import MercadoLivreDadosModal from '@/components/MercadoLivreDadosModal';
import { mensagemDeErroApi, redigirMensagemDeErro } from '@/lib/erros-api';
import { formatDateTime } from '@/lib/format';
import { t as traduzir, tMenu } from '@/lib/i18n';

/**
 * Central de Integrações (rota /central-integracoes).
 *
 * Refactor de design: antes a tela listava as integrações em três
 * "admin-list-row" e o formulário de chave em HTML cru. Agora é a central
 * modular enterprise do Layout Mestre — KPIs, filtros, 7 categorias com
 * cards, API pública com escopos por card, expiração, IP whitelist, modal
 * de chave gerada e toast.
 *
 * Regra do projeto: **nada de dado fictício**. Os KPIs e os status dos
 * cards vêm de `GET /integracoes`; as chaves vêm de `GET /api-publica/chaves`
 * e são criadas/revogadas no backend de verdade. O catálogo de vendors
 * (Mercado Livre, Shopify, Ahgora...) é a integração *disponível* na central:
 * aparece como NÃO CONFIGURADO até a empresa configurar de fato, sem simular
 * "última sincronização" falsa.
 *
 * A sidebar e o header NÃO são reimplementados aqui: moram em
 * app/(dashboard)/layout.tsx e já seguem o Layout Mestre V2.1.
 */

type StatusIntegracao = 'CONECTADO' | 'ERRO' | 'NAO_CONFIGURADO';
type Categoria = 'vendas' | 'financeiro' | 'logistica' | 'time' | 'inteligencia' | 'hardware' | 'infra';
type FiltroAtivo = 'todos' | Categoria;

type ItemIntegracao = {
  categoria: string;
  nome: string;
  status: StatusIntegracao;
  configurado?: boolean;
  /**
   * Só no item do Mercado Livre: o servidor tem (ou não) as 3 variáveis
   * oficiais no .env. Permite à UI distinguir "aguardando configuração no
   * servidor" de um simples "desconectado" — sem nunca expor valor de
   * credencial (é booleano).
   */
  configuradoAmbiente?: boolean;
  ultimaSincronizacao?: string | null;
  qtdRegistros?: number | null;
  erros?: unknown;
};

type ShopeeConnection = {
  id: string;
  shopId: string;
  shopName: string | null;
  status: string;
  connectedAt: string;
  tokenExpiry: string;
  ultimoTesteEm: string | null;
  ultimoSyncEm: string | null;
};

type ResumoIntegracoes = {
  conectadas: number;
  comErro: number;
  naoConfiguradas: number;
  total: number;
};

type TarefaAgendadaML = {
  tipo: 'MERCADO_LIVRE_PRODUTOS' | 'MERCADO_LIVRE_ESTOQUE' | 'MERCADO_LIVRE_PEDIDOS';
  status: string;
  proximaExecucaoEm: string;
  ultimoSucessoEm: string | null;
  falhasUltima: number;
  tentativas: number;
  ultimoErro: { motivo?: string; permanente?: boolean } | null;
};

type AgendamentoML = {
  ativo: boolean;
  periodos: { produtosMin: number; estoqueMin: number; pedidosMin: number };
  resumo: { pausadas: number; comFalha: number };
  tarefas: TarefaAgendadaML[];
};

type ChaveApi = {
  id: string;
  nome: string;
  prefixo: string;
  escopos: string[];
  status: string;
  ultimoUso?: string | null;
  createdAt: string;
  revogadaEm?: string | null;
};

type Vendor = {
  id: string;
  nome: string;
  descricao: string;
  categoria: Categoria;
  icone: typeof Store;
  meta?: string;
  badge?: string;
  /** Vincula o card ao registro real vindo de GET /integracoes. */
  match?: (item: ItemIntegracao) => boolean;
  /**
   * Tela onde a integração é CONFIGURADA de verdade (e gravada no PostgreSQL).
   *
   * Ausente = o NEXUS OS não tem integração para este item. Nesse caso o card
   * não mostra botão de ação nenhum: mostrar um "Conectar" que só abre um toast
   * seria ação decorativa. Ver o comentário no JSX do botão.
   */
  destino?: string;
};

type Escopo = {
  id: string;
  rotulo: string;
  descricao: string;
  icone: typeof Package;
  modo: 'leitura' | 'escrita';
};

const FILTROS: Array<{ id: FiltroAtivo; rotulo: string }> = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'vendas', rotulo: 'Vendas' },
  { id: 'financeiro', rotulo: 'Financeiro' },
  { id: 'logistica', rotulo: 'Logística' },
  { id: 'time', rotulo: 'Time' },
  { id: 'inteligencia', rotulo: 'IA' },
  { id: 'hardware', rotulo: 'Hardware' },
  { id: 'infra', rotulo: 'Infra' },
];

const SECOES: Array<{ id: Categoria; titulo: string; descricao: string }> = [
  { id: 'vendas', titulo: 'CONECTE SUAS VENDAS', descricao: 'Marketplaces e e-commerces' },
  { id: 'financeiro', titulo: 'CONECTE SEU FINANCEIRO', descricao: 'Bancos, cobranças e conciliação automática' },
  { id: 'logistica', titulo: 'CONECTE SUA LOGÍSTICA', descricao: 'Cotação de frete e rastreio' },
  { id: 'time', titulo: 'CONECTE SEU TIME', descricao: 'Relógios que alimentam os módulos Ponto e RH' },
  { id: 'inteligencia', titulo: 'INTELIGÊNCIA', descricao: 'Motores de IA e visão computacional' },
  { id: 'hardware', titulo: 'HARDWARE & PDV', descricao: 'Balanças, coletores e equipamentos locais' },
  { id: 'infra', titulo: 'INFRA & SEGURANÇA', descricao: 'E-mail transacional, webhooks e eventos' },
];

/** Catálogo do que a central sabe conectar. O status nunca é inventado aqui. */
const VENDORS: Vendor[] = [
  // ---- Vendas ----
  { id: 'mercadolivre', nome: 'Mercado Livre', descricao: 'Anúncios, pedidos e estoque sincronizados com Vendas e Estoque.', categoria: 'vendas', icone: Store, meta: 'OAuth 2.0 • API oficial', match: (i) => /mercado\s*livre|mercadolivre/i.test(i.nome) },
  { id: 'shopee', nome: 'Shopee', descricao: 'Conecte lojas, consulte produtos e monitore automaticamente o status dos pedidos.', categoria: 'vendas', icone: ShoppingBag, meta: 'Open Platform v2', match: (i) => i.categoria === 'SHOPEE' },
  { id: 'shopify', nome: 'Shopify', descricao: 'Catálogo, pedidos e webhooks de estoque em tempo real.', categoria: 'vendas', icone: Globe, meta: 'Admin API • Webhooks' },
  { id: 'nuvemshop', nome: 'Nuvemshop', descricao: 'Loja online integrada a Produtos, Estoque e Vendas.', categoria: 'vendas', icone: Globe, meta: 'API pública' },
  { id: 'woocommerce', nome: 'WooCommerce', descricao: 'Loja WordPress com sync de produtos e pedidos.', categoria: 'vendas', icone: ShoppingCart, meta: 'REST API • chave de consumidor' },
  // ---- Financeiro ----
  { id: 'open-banking', nome: 'Bancos Open Banking', descricao: 'Conciliação automática de extratos e movimentações.', categoria: 'financeiro', icone: Landmark, meta: 'Pluggy / Belvo • Open Banking', badge: 'Financeiro' },
  { id: 'asaas', nome: 'Asaas', descricao: 'Cobrança, boletos e conciliação de recebimentos.', categoria: 'financeiro', icone: Receipt, meta: 'API REST • OAuth', badge: 'Financeiro' },
  { id: 'mercadopago', nome: 'Mercado Pago', descricao: 'Recebimentos e estornos conciliados no Financeiro.', categoria: 'financeiro', icone: CreditCard, meta: 'API REST • OAuth', badge: 'Financeiro' },
  { id: 'pix', nome: 'PIX', descricao: 'Recebimento BR Code (EMV BACEN) direto na conta da empresa.', categoria: 'financeiro', icone: QrCode, meta: 'BR Code • EMV • BACEN', badge: 'Financeiro', destino: '/configuracoes' },
  // ---- Logística ----
  { id: 'melhor-envio', nome: 'Melhor Envio', descricao: 'Cotação e compra de frete direto no PDV.', categoria: 'logistica', icone: Truck, meta: 'API pública', badge: 'Logística' },
  { id: 'correios', nome: 'Correios', descricao: 'Rastreio de encomendas e cálculo de prazo.', categoria: 'logistica', icone: Package, meta: 'Rastreio • PAC/SEDEX', badge: 'Logística' },
  { id: 'jadlog', nome: 'Jadlog', descricao: 'Coleta e rastreio Jadlog com leitura de código de barras.', categoria: 'logistica', icone: Truck, meta: 'Rastreio • Jadlog', badge: 'Logística' },
  // ---- Time ----
  { id: 'ahgora', nome: 'Ahgora', descricao: 'Conecta direto com os módulos Ponto e RH do NEXUS.', categoria: 'time', icone: Users, meta: 'API oficial', badge: 'RH/Ponto', match: (i) => /ahgora/i.test(i.nome), destino: '/rh' },
  { id: 'pontotel', nome: 'Pontotel', descricao: 'Sincroniza batidas direto para o módulo de Ponto.', categoria: 'time', icone: Users, meta: 'API oficial', badge: 'RH/Ponto', match: (i) => /pontotel/i.test(i.nome), destino: '/ponto' },
  { id: 'solides', nome: 'Sólides', descricao: 'Apontações e batidas tratadas no RH do NEXUS.', categoria: 'time', icone: Users, meta: 'API oficial', badge: 'RH/Ponto', match: (i) => /s[oó]lides/i.test(i.nome), destino: '/rh' },
  // ---- Inteligência ----
  { id: 'gemini', nome: 'Google Gemini', descricao: 'Motor de IA oficial do NEXUS: relatórios, cadastros e Command Center.', categoria: 'inteligencia', icone: Sparkles, meta: 'GEMINI_API_KEY • somente no backend', match: (i) => i.categoria === 'IA_GEMINI' },
  { id: 'openai', nome: 'OpenAI', descricao: 'Modelo alternativo para geração de relatórios.', categoria: 'inteligencia', icone: Bot, meta: 'OPENAI_API_KEY' },
  { id: 'claude', nome: 'Claude', descricao: 'Segundo modelo de linguagem para análise de dados.', categoria: 'inteligencia', icone: Bot, meta: 'ANTHROPIC_API_KEY' },
  { id: 'vision', nome: 'NEXUS Vision', descricao: 'Leitura de documentos e notas fiscais por visão computacional.', categoria: 'inteligencia', icone: Eye, meta: 'Módulo NEXUS' },
  // ---- Hardware ----
  { id: 'balanca', nome: 'Balança', descricao: 'Toledo, Filizola ou Urano lidas via porta COM/USB serial.', categoria: 'hardware', icone: Scale, meta: 'COM/USB serial • requer NEXUS Bridge', badge: 'NOVO' },
  { id: 'coletores', nome: 'Coletores Zebra/Honeywell', descricao: 'Modo offline com fila que sincroniza quando o sinal volta.', categoria: 'hardware', icone: Smartphone, meta: 'Android • fila offline' },
  { id: 'gaveta-impressora', nome: 'Gaveta / Impressora Térmica', descricao: 'Abertura de gaveta e cupom fiscal no fechamento do PDV.', categoria: 'hardware', icone: Printer, meta: 'ESC/POS • USB', match: (i) => i.categoria === 'PDV', destino: '/pdv' },
  // ---- Infra ----
  { id: 'email', nome: 'E-mail Transacional', descricao: 'Resend: recuperação de senha e avisos de venda.', categoria: 'infra', icone: Mail, meta: 'RESEND_API_KEY • somente no backend', match: (i) => i.categoria === 'EMAIL_TRANSACIONAL' },
];

const ESCOPOS: Escopo[] = [
  { id: 'produtos:leitura', rotulo: 'Produtos', descricao: 'Consultar catálogo, preços e códigos', icone: Package, modo: 'leitura' },
  { id: 'estoque:leitura', rotulo: 'Estoque', descricao: 'Consultar saldos por filial e produto', icone: Boxes, modo: 'leitura' },
  { id: 'vendas:leitura', rotulo: 'Vendas', descricao: 'Consultar vendas, itens e totais', icone: Receipt, modo: 'leitura' },
  { id: 'clientes:leitura', rotulo: 'Clientes', descricao: 'Consultar cadastro de clientes', icone: Users, modo: 'leitura' },
  { id: 'produtos:escrita', rotulo: 'Produtos', descricao: 'Criar e alterar produtos', icone: Package, modo: 'escrita' },
  { id: 'estoque:escrita', rotulo: 'Estoque', descricao: 'Movimentar entradas e saídas', icone: Boxes, modo: 'escrita' },
  { id: 'vendas:escrita', rotulo: 'Vendas', descricao: 'Registrar vendas pelo endpoint', icone: Receipt, modo: 'escrita' },
  { id: 'clientes:escrita', rotulo: 'Clientes', descricao: 'Criar e alterar clientes', icone: Users, modo: 'escrita' },
];

/** O backend valida com z.enum — hoje só leitura existe (api-publica.routes.ts). */
const ESCOPOS_ACEITOS = ESCOPOS.filter((e) => e.modo === 'leitura').map((e) => e.id);

/**
 * Exemplo de uso da API pública, copiável.
 *
 * Antes o botão "Ver endpoints" só mostrava um toast com uma frase solta
 * ("Authorization: Bearer <chave> em /api/v1/*"), sem listar o que existe. Os
 * quatro endpoints abaixo são os REAIS declarados em
 * `backend/src/modules/api-publica/api-publica.routes.ts`, cada um com o escopo
 * de leitura que o `apiKeyAuth` exige — copiar isto já produz uma chamada
 * correta.
 */
const EXEMPLO_API = [
  '# Autenticação: header Authorization com a chave criada nesta tela',
  'curl "<BASE_URL>/api/v1/produtos" \\',
  '  -H "Authorization: Bearer <SUA_CHAVE>"',
  '',
  '# Endpoints disponíveis (todos somente leitura, um escopo por chamada):',
  '#   GET /api/v1/produtos   -> escopo produtos:leitura  (nome, sku, precoVenda, unidade)',
  '#   GET /api/v1/estoque    -> escopo estoque:leitura   (por produto e filial)',
  '#   GET /api/v1/vendas     -> escopo vendas:leitura    (total, status, data; 100 mais recentes)',
  '#   GET /api/v1/clientes   -> escopo clientes:leitura  (nome, e-mail, telefone; ativos)',
].join('\n');

const EXPIRACOES = [
  { id: '30d', rotulo: '30 dias' },
  { id: '90d', rotulo: '90 dias' },
  { id: '1ano', rotulo: '1 ano' },
  { id: 'nunca', rotulo: 'Nunca' },
];

export default function CentralIntegracoes() {
  const router = useRouter();

  // ---- Dados reais da API ----
  const [integracoes, setIntegracoes] = useState<{ itens: ItemIntegracao[]; resumo: ResumoIntegracoes } | null>(null);
  const [agendamentoML, setAgendamentoML] = useState<AgendamentoML | null>(null);
  const [chaves, setChaves] = useState<ChaveApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Estado da UI ----
  const [filtro, setFiltro] = useState<FiltroAtivo>('todos');
  const [busca, setBusca] = useState('');
  const [escopos, setEscopos] = useState<string[]>([]);
  const [nomeChave, setNomeChave] = useState('');
  const [expiracao, setExpiracao] = useState('90d');
  const [ipWhitelist, setIpWhitelist] = useState('');
  const [chaveGerada, setChaveGerada] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Trava os botões do card Mercado Livre durante a requisição em voo.
  const [acaoMl, setAcaoMl] = useState<'conectar' | 'testar' | 'desconectar' | null>(null);
  const [acaoShopee, setAcaoShopee] = useState<'conectar' | 'testar' | 'desconectar' | null>(null);
  const [lojasShopee, setLojasShopee] = useState<ShopeeConnection[]>([]);
  // Etapa 2 — modal "Dados da conta ML" (9 endpoints de consulta + PUT).
  const [mostrarDadosML, setMostrarDadosML] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data: i }, { data: c }] = await Promise.all([
        api.get('/integracoes'),
        api.get('/api-publica/chaves'),
      ]);
      let shopeeItems: ItemIntegracao[] = [];
      try {
        const [{ data: connections }, { data: central }] = await Promise.all([
          api.get<{ lojas: ShopeeConnection[] }>('/integracoes/shopee'),
          api.get<ItemIntegracao[]>('/integracoes/shopee/central'),
        ]);
        setLojasShopee(Array.isArray(connections?.lojas) ? connections.lojas : []);
        shopeeItems = Array.isArray(central) ? central : [];
      } catch {
        setLojasShopee([]);
      }
      const itens = [...(Array.isArray(i?.itens) ? i.itens : []), ...shopeeItems];
      setIntegracoes({
        ...i,
        itens,
        resumo: {
          conectadas: itens.filter((item) => item.status === 'CONECTADO').length,
          comErro: itens.filter((item) => item.status === 'ERRO').length,
          naoConfiguradas: itens.filter((item) => item.status === 'NAO_CONFIGURADO').length,
          total: itens.length,
        },
      });
      setChaves(Array.isArray(c) ? c : []);
      const ml = (i?.itens ?? []).some((item: ItemIntegracao) => item.categoria === 'MERCADO_LIVRE' && item.configurado);
      if (ml) {
        try {
          const { data } = await api.get<AgendamentoML>('/integracoes/mercadolivre/sync/agendamento');
          setAgendamentoML(data);
        } catch {
          setAgendamentoML(null);
        }
      } else {
        setAgendamentoML(null);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Não foi possível carregar as integrações.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return; }
    void load();
  }, [router, load]);

  // O estado automático é operacional: atualiza sem exigir que o usuário
  // recarregue a Central para perceber tarefas pausadas ou falhas recentes.
  useEffect(() => {
    if (!integracoes?.itens.some((item) => item.categoria === 'MERCADO_LIVRE' && item.configurado)) return;
    const atualizar = () => {
      void api.get<AgendamentoML>('/integracoes/mercadolivre/sync/agendamento')
        .then(({ data }) => setAgendamentoML(data))
        .catch(() => setAgendamentoML(null));
    };
    const timer = setInterval(atualizar, 30_000);
    return () => clearInterval(timer);
  }, [integracoes]);

  /**
   * Retorno do OAuth do Mercado Livre: o callback do backend redireciona o
   * browser para cá com ?ml=conectado|erro (&motivo=...). Trata o resultado,
   * exibe na tela e limpa a query para não reprocessar a cada render.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shopee = params.get('shopee');
    if (shopee) {
      if (shopee === 'connected') {
        showToast('Loja Shopee autorizada e validada.');
        void load();
      } else {
        setError('Não foi possível concluir a autorização Shopee. Verifique as credenciais e tente novamente.');
      }
      params.delete('shopee');
      const query = params.toString();
      router.replace(query ? `/central-integracoes?${query}` : '/central-integracoes');
      return;
    }
    const ml = params.get('ml');
    if (!ml) return;
    if (ml === 'conectado') {
      showToast('Mercado Livre conectado com sucesso.');
      void load();
    } else {
      // O motivo vem do redirect do backend (que já limita o tamanho), mas
      // trafega por query string forjável: redige code/state/Bearer antes de
      // exibir, igual ao restante da tela.
      setError(redigirMensagemDeErro(params.get('motivo') ?? '') || 'Não foi possível concluir a conexão com o Mercado Livre.');
    }
    params.delete('ml');
    params.delete('motivo');
    const resto = params.toString();
    router.replace(resto ? `/central-integracoes?${resto}` : '/central-integracoes');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Limpa o timer do toast para não vazar timeout entre mensagens.
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function showToast(mensagem: string) {
    setToast(mensagem);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  async function copiar(texto: string, mensagem: string) {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      // Navegador sem permissão de clipboard: o texto segue selecionável na tela.
      showToast('Não foi possível copiar automaticamente — selecione e copie manualmente.');
      return;
    }
    setCopiado(true);
    showToast(mensagem);
    setTimeout(() => setCopiado(false), 2000);
  }

  /**
   * Liga/desliga um escopo.
   *
   * A guarda no `id` é deliberada mesmo com o card já `disabled`: `escopos`
   * é estado, e estado pode vir de outra origem (um escopo de escrita já
   * marcado antes desta correção, um `localStorage` antigo, um teste). Sem
   * isto, o filtro do `criarChave` continuaria descartando a escolha em
   * silêncio — que é exatamente o defeito que estamos fechando.
   */
  function toggleEscopo(escopo: string) {
    if (!ESCOPOS_ACEITOS.includes(escopo)) return;
    setEscopos((prev) => (prev.includes(escopo) ? prev.filter((e) => e !== escopo) : [...prev, escopo]));
  }

  async function criarChave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nomeChave.trim()) { setError('Dê um nome para a chave — é como ela aparece na tabela.'); return; }

    // O backend só aceita escopos de leitura (z.enum em api-publica.routes.ts).
    //
    // O filtro não pode sumir com a escolha em silêncio: se houver algum escopo
    // de escrita marcado, avisa. Com o card agora desabilitado isso não deve
    // ocorrer pela UI, mas um estado antigo (navegador já aberto antes da
    // correção) ainda poderia chegar aqui — e o usuário precisa saber que a
    // chave foi criada com menos escopos do que ele viu marcados.
    const validos = escopos.filter((s) => ESCOPOS_ACEITOS.includes(s));
    const ignorados = escopos.filter((s) => !ESCOPOS_ACEITOS.includes(s));
    if (validos.length === 0) { setError('Selecione ao menos um escopo de leitura.'); return; }
    if (ignorados.length > 0) {
      setError(
        `Os escopos de escrita não estão disponíveis e não serão incluídos: ` +
          `${ignorados.join(', ')}. A chave será criada só com leitura.`
      );
      return;
    }

    try {
      const { data } = await api.post('/api-publica/chaves', { nome: nomeChave.trim(), escopos: validos });
      setChaveGerada(data.chave);
      setNomeChave(''); setEscopos([]); setIpWhitelist('');
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Não foi possível criar a chave.');
    }
  }

  async function revogar(id: string) {
    setError(null);
    try {
      await api.post(`/api-publica/chaves/${id}/revogar`, {});
      showToast('Chave revogada.');
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Não foi possível revogar a chave.');
    }
  }

  /* ===== Mercado Livre (OAuth real) ==================================== */

  /**
   * Vai para o backend iniciar o OAuth: o servidor grava `state` (nonce de uso
   * único com expiração) e devolve a authUrl oficial do Mercado Livre — o
   * navegador navega para lá e o ML nos devolve em GET /callback (público).
   */
  async function conectarMercadoLivre() {
    setAcaoMl('conectar');
    setError(null);
    try {
      const { data } = await api.post<{ authUrl: string }>('/integracoes/mercadolivre/conectar', { nome: 'Mercado Livre' });
      if (!data?.authUrl) throw new Error('Resposta sem authUrl.');
      window.location.href = data.authUrl;
    } catch (e: any) {
      setAcaoMl(null);
      showToast(mensagemDeErroApi(e, 'Não foi possível iniciar a conexão.'));
    }
  }

  /** Testa o token gravado contra /users/me — sem rede externa não há sucesso. */
  async function testarMercadoLivre() {
    setAcaoMl('testar');
    setError(null);
    try {
      const { data } = await api.post('/integracoes/mercadolivre/testar', {});
      showToast(data?.conta
        ? `Conexão OK com a conta ${data.conta.accountName || data.conta.accountId}.`
        : 'Conexão com o Mercado Livre confirmada.');
      await load();
    } catch (e: any) {
      showToast(mensagemDeErroApi(e, 'Teste de conexão falhou.'));
      await load();
    } finally {
      setAcaoMl(null);
    }
  }

  /** Desvincula a conta: apaga tokens criptografados e registra auditoria. */
  async function desconectarMercadoLivre() {
    if (!confirm('Desvincular a conta do Mercado Livre? Os tokens serão apagados e a sincronização para imediatamente.')) return;
    setAcaoMl('desconectar');
    setError(null);
    try {
      await api.delete('/integracoes/mercadolivre');
      showToast('Conta do Mercado Livre desvinculada.');
      await load();
    } catch (e: any) {
      showToast(mensagemDeErroApi(e, 'Não foi possível desvincular.'));
    } finally {
      setAcaoMl(null);
    }
  }

  async function conectarShopee() {
    setAcaoShopee('conectar');
    setError(null);
    try {
      const { data } = await api.post<{ authUrl: string }>('/integracoes/shopee/conectar', {});
      if (!data?.authUrl) throw new Error('O servidor não retornou o endereço de autorização.');
      window.location.href = data.authUrl;
    } catch (e: any) {
      setAcaoShopee(null);
      showToast(mensagemDeErroApi(e, 'Não foi possível iniciar a autorização da Shopee.'));
    }
  }

  async function testarShopee() {
    const loja = lojasShopee.find((item) => item.status === 'CONECTADO');
    if (!loja) return;
    setAcaoShopee('testar');
    try {
      const { data } = await api.post(`/integracoes/shopee/${encodeURIComponent(loja.id)}/testar`, {});
      showToast(`Conexão Shopee confirmada${data?.shopName ? `: ${data.shopName}` : ''}.`);
      await load();
    } catch (e: any) {
      showToast(mensagemDeErroApi(e, 'O teste real de conexão Shopee falhou.'));
      await load();
    } finally {
      setAcaoShopee(null);
    }
  }

  async function desconectarShopee() {
    const loja = lojasShopee.find((item) => item.status === 'CONECTADO');
    if (!loja || !confirm(`Remover localmente a loja ${loja.shopName || loja.shopId}? Os tokens serão removidos do NEXUS; a revogação na Shopee não está disponível nesta etapa.`)) return;
    setAcaoShopee('desconectar');
    try {
      await api.delete(`/integracoes/shopee/${encodeURIComponent(loja.id)}`);
      showToast('Tokens locais removidos. A autorização externa pode continuar ativa na Shopee.');
      await load();
    } catch (e: any) {
      showToast(mensagemDeErroApi(e, 'Não foi possível remover a conexão local.'));
    } finally {
      setAcaoShopee(null);
    }
  }

  /** Junta o catálogo estático com o registro real que o backend devolveu. */
  const cards = useMemo(() => {
    const itens = integracoes?.itens ?? [];
    return VENDORS.map((v) => {
      const real = v.match ? itens.find(v.match) : undefined;
      return {
        vendor: v,
        status: (real?.status ?? 'NAO_CONFIGURADO') as StatusIntegracao,
        configuradoAmbiente: real?.configuradoAmbiente,
        ultimaSincronizacao: real?.ultimaSincronizacao ?? null,
        qtdRegistros: real?.qtdRegistros ?? null,
        erros: real?.erros ?? null,
        nomeReal: real?.nome ?? null,
      };
    });
  }, [integracoes]);

  const cardsVisiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return cards.filter(({ vendor }) => {
      if (filtro !== 'todos' && vendor.categoria !== filtro) return false;
      if (!termo) return true;
      return (
        vendor.nome.toLowerCase().includes(termo) ||
        vendor.descricao.toLowerCase().includes(termo) ||
        (vendor.meta ?? '').toLowerCase().includes(termo)
      );
    });
  }, [cards, filtro, busca]);

  const secoesVisiveis = SECOES.filter((s) => filtro === 'todos' || s.id === filtro);

  const statusDoCard = (id: string) => cards.find((c) => c.vendor.id === id)?.status ?? 'NAO_CONFIGURADO';
  const geminiConectado = statusDoCard('gemini') === 'CONECTADO';
  const emailConectado = statusDoCard('email') === 'CONECTADO';

  const acoes = useMemo(() => {
    const mapa = new Map<string, ItemIntegracao>();
    for (const i of integracoes?.itens ?? []) {
      if (i.ultimaSincronizacao) mapa.set(i.categoria, i);
    }
    return [...mapa.values()].sort(
      (a, b) => new Date(b.ultimaSincronizacao!).getTime() - new Date(a.ultimaSincronizacao!).getTime(),
    );
  }, [integracoes]);

  const resumo = integracoes?.resumo;
  const total = resumo?.total ?? 0;
  const saude = total === 0 ? 0 : Math.round(((resumo?.conectadas ?? 0) / total) * 100);

  const STATUS_LABEL: Record<StatusIntegracao, string> = {
    CONECTADO: 'CONECTADO',
    ERRO: 'ERRO',
    NAO_CONFIGURADO: 'NÃO CONFIGURADO',
  };

  if (loading) {
    return (
      <div className="min-h-full bg-[#0F0F14] px-4 lg:px-8 py-6">
        <div className="h-3 w-40 rounded bg-[#1A1A23] animate-pulse" />
        <div className="mt-4 h-8 w-80 max-w-full rounded bg-[#1A1A23] animate-pulse" />
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-[16px] bg-[#1A1A23] border border-[#2A2A35] animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#0F0F14] text-zinc-100 antialiased">
      <div className="px-4 lg:px-8 py-6">
        {/* Breadcrumb */}
        <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          Dashboard
        </Link>

        {/* Título */}
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] lg:text-[28px] font-bold tracking-tight text-white">
              Central de integrações
            </h1>
            <p className="mt-1.5 text-[13px] text-zinc-400">
              Um só lugar para vender, cobrar, enviar, bater ponto e expor o NEXUS — tudo com o status real de cada conexão.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar integração…"
              aria-label="Buscar integração"
              className="w-full h-9 pl-9 pr-3 rounded-full bg-[#1A1A23] border border-[#2A2A35] text-[12px] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-[#7C3AED] transition-colors"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-[12px] border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[12px] text-red-300">
            {error}
          </p>
        )}

        {/* KPIs — todos vindos de GET /integracoes (resumo real) */}
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Conectadas"
            valor={String(resumo?.conectadas ?? 0)}
            icone={Wifi}
            cor="#10b981"
            pulso
          />
          <KpiCard label="Com erro" valor={String(resumo?.comErro ?? 0)} icone={AlertTriangle} cor="#f59e0b" />
          <KpiCard label="Não configuradas" valor={String(resumo?.naoConfiguradas ?? 0)} icone={MinusCircle} cor="#71717a" />
          <KpiCard label="Saúde" valor={`${saude}%`} icone={Percent} cor="#7C3AED" sufixo="da central" />
        </div>

        {/* Filtros sticky */}
        <div className="sticky top-0 z-30 -mx-4 lg:-mx-8 mt-6 px-4 lg:px-8 py-3 bg-[#0F0F14]/90 backdrop-blur-md border-b border-[#1E1E28] flex flex-wrap gap-2">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              aria-pressed={filtro === f.id}
              className={`h-8 px-4 rounded-full text-[12px] font-medium border transition-colors ${
                filtro === f.id
                  ? 'bg-white text-black border-white'
                  : 'bg-[#1A1A23] border-[#2A2A35] text-zinc-400 hover:border-[#3A3A4A] hover:text-zinc-200'
              }`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>

        {/* Categorias */}
        {secoesVisiveis.map((secao) => {
          const daSecao = cardsVisiveis.filter((c) => c.vendor.categoria === secao.id);
          if (daSecao.length === 0) return null;
          return (
            <section key={secao.id} className="mt-8">
              <h2 className="text-[12px] font-bold tracking-[0.18em] text-zinc-400 uppercase">
                <span className="text-zinc-600">[</span> {secao.titulo} <span className="text-zinc-600">]</span>
              </h2>
              <p className="mt-1.5 text-[13px] text-zinc-500">{secao.descricao}</p>

              {/* Gemini conectado ganha o pill verde de destaque da spec. */}
              {secao.id === 'inteligencia' && geminiConectado && (
                <span className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-[11px] font-medium text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  IA GEMINI CONECTADO
                </span>
              )}

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {daSecao.map(({ vendor, status, ultimaSincronizacao, nomeReal, configuradoAmbiente }) => {
                  const Icone = vendor.icone;
                  const corStatus =
                    status === 'CONECTADO' ? '#10b981' : status === 'ERRO' ? '#f59e0b' : '#71717a';
                  return (
                    <article
                      key={vendor.id}
                      className="flex flex-col gap-3 rounded-[16px] bg-[#1A1A23] border border-[#2A2A35] p-4 transition-colors hover:border-[#3A3A4A]"
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 shrink-0 rounded-[12px] bg-[#12121A] border border-[#2A2A35] flex items-center justify-center">
                          <Icone className="w-[18px] h-[18px] text-zinc-300" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-zinc-100">
                              {vendor.nome}
                            </h3>
                            {vendor.badge && (
                              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
                                {vendor.badge}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[12px] text-zinc-400 line-clamp-2">{vendor.descricao}</p>
                        </div>
                      </div>

                      {vendor.meta && (
                        <p className="text-[10px] font-mono text-zinc-500 truncate">{vendor.meta}</p>
                      )}

                      <div className="mt-auto flex items-center justify-between gap-3 pt-1 border-t border-[#2A2A35]/60">
                        <div className="min-w-0">
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === 'CONECTADO' ? 'bg-emerald-500 animate-pulse' : ''}`}
                              style={status !== 'CONECTADO' ? { backgroundColor: corStatus } : undefined}
                            />
                            {STATUS_LABEL[status]}
                          </span>
                          <p className={`mt-1 text-[10px] truncate ${(vendor.id === 'mercadolivre' || vendor.id === 'shopee') && configuradoAmbiente === false ? 'text-amber-300/70' : 'text-zinc-500'}`}>
                            {ultimaSincronizacao
                              ? `sync ${formatDateTime(ultimaSincronizacao)}`
                              : status === 'CONECTADO'
                                ? `ativo${nomeReal ? ` • ${nomeReal}` : ''}`
                                : vendor.id === 'mercadolivre'
                                  ? configuradoAmbiente === false
                                    ? 'aguardando credenciais no servidor'
                                    : 'pronto para autorizar'
                                  : vendor.id === 'shopee'
                                    ? configuradoAmbiente === false ? 'aguardando credenciais do app no servidor' : 'pronto para autorizar uma loja'
                                    : 'sem sincronização'}
                          </p>
                        </div>
                        {/*
                          Botão de ação — só aparece quando existe um CAMINHO
                          REAL para configurar aquele item.

                          Antes havia um botão "Conectar"/"Gerenciar" em TODOS os
                          cards que só disparava um toast ("Conectando OAuth…
                          fluxo em preparação") e nenhuma requisição. Isso é ação
                          decorativa: o usuário clicava e não acontecia nada.

                          Agora cada card aponta para a tela onde a integração é
                          de fato configurada e persistida no PostgreSQL:
                            • PDV        -> /pdv           (POST /pdv/integracoes)
                            • Ponto/RH   -> /rh            (POST /ponto/integracao)
                            • PIX        -> /configuracoes (PUT /api/v1/settings/pix)
                            • API/chaves -> /configuracoes (POST /api-publica/chaves)
                          E os itens sem backend (marketplaces, logistics, Open
                          AI/Claude, hardware serial) perdem o botão e mostram,
                          no lugar, que não há integração disponível — em vez de
                          fingir um fluxo de conexão.
                        */}
                        {/*
                          Mercado Livre: é o ÚNICO card de marketplace com
                          integração real — OAuth 2.0 gravado no backend
                          (POST /integracoes/mercadolivre/conectar devolve a
                          authUrl oficial; testar/desconectar batem em
                          endpoints autenticados com o token criptografado).
                        */}
                        {vendor.id === 'shopee' ? (
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={conectarShopee}
                              disabled={acaoShopee !== null || loading || configuradoAmbiente === false}
                              title={configuradoAmbiente === false ? 'Configure as credenciais Shopee e aplique a migration no backend.' : 'Autorizar uma loja Shopee'}
                              className="h-8 px-3 rounded-[10px] bg-[#7C3AED] text-white text-[12px] font-medium hover:bg-[#6B4FE0] transition-colors disabled:opacity-50 inline-flex items-center"
                            >
                              {acaoShopee === 'conectar' ? 'Abrindo…' : status === 'CONECTADO' ? 'Adicionar loja' : 'Conectar'}
                            </button>
                            <button
                              type="button"
                              onClick={testarShopee}
                              disabled={acaoShopee !== null || loading || !lojasShopee.some((item) => item.status === 'CONECTADO')}
                              title="Faz uma chamada real de leitura à API Shopee"
                              className="h-8 px-3 rounded-[10px] border border-[#2A2A35] text-zinc-300 text-[12px] font-medium hover:border-[#3A3A4A] transition-colors disabled:opacity-40 inline-flex items-center"
                            >
                              {acaoShopee === 'testar' ? 'Testando…' : 'Testar'}
                            </button>
                            <button
                              type="button"
                              onClick={desconectarShopee}
                              disabled={acaoShopee !== null || loading || !lojasShopee.some((item) => item.status === 'CONECTADO')}
                              title="Remove os tokens locais; não revoga a autorização na Shopee"
                              className="h-8 px-3 rounded-[10px] border border-[#2A2A35] text-zinc-500 text-[12px] font-medium hover:border-red-500/40 hover:text-red-300 transition-colors disabled:opacity-40 inline-flex items-center"
                            >
                              {acaoShopee === 'desconectar' ? 'Removendo…' : 'Remover'}
                            </button>
                          </div>
                        ) : vendor.id === 'mercadolivre' ? (
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={conectarMercadoLivre}
                              disabled={acaoMl !== null || loading || configuradoAmbiente === false}
                              title={configuradoAmbiente === false
                                ? 'Servidor sem credenciais oficiais do Mercado Livre — preencha MERCADOLIVRE_CLIENT_ID, MERCADOLIVRE_CLIENT_SECRET e MERCADOLIVRE_REDIRECT_URI no .env do backend (docs/MERCADO-LIVRE.md)'
                                : undefined}
                              className="h-8 px-3 rounded-[10px] bg-[#7C3AED] text-white text-[12px] font-medium hover:bg-[#6B4FE0] transition-colors disabled:opacity-50 inline-flex items-center"
                            >
                              {acaoMl === 'conectar' ? 'Abrindo…' : status === 'CONECTADO' ? 'Reconectar' : 'Conectar'}
                            </button>
                            <button
                              type="button"
                              onClick={testarMercadoLivre}
                              disabled={acaoMl !== null || loading || status !== 'CONECTADO'}
                              title={status !== 'CONECTADO' ? 'Conecte a conta antes de testar' : 'Valida o token contra a API oficial'}
                              className="h-8 px-3 rounded-[10px] border border-[#2A2A35] text-zinc-300 text-[12px] font-medium hover:border-[#3A3A4A] transition-colors disabled:opacity-40 inline-flex items-center"
                            >
                              {acaoMl === 'testar' ? 'Testando…' : 'Testar'}
                            </button>
                            <button
                              type="button"
                              onClick={desconectarMercadoLivre}
                              disabled={acaoMl !== null || loading || status !== 'CONECTADO'}
                              title="Desvincular a conta e apagar os tokens"
                              className="h-8 px-3 rounded-[10px] border border-[#2A2A35] text-zinc-500 text-[12px] font-medium hover:border-red-500/40 hover:text-red-300 transition-colors disabled:opacity-40 inline-flex items-center"
                            >
                              {acaoMl === 'desconectar' ? 'Saindo…' : 'Sair'}
                            </button>
                            {status === 'CONECTADO' && (
                              <button
                                type="button"
                                onClick={() => setMostrarDadosML(true)}
                                disabled={acaoMl !== null || loading}
                                title="Ver dados da conta no Mercado Livre"
                                aria-label="Ver dados da conta no Mercado Livre"
                                className="h-8 w-8 rounded-[10px] border border-[#2A2A35] text-zinc-300 hover:border-[#3A3A4A] transition-colors disabled:opacity-40 inline-flex items-center justify-center"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ) : vendor.destino ? (
                          <Link
                            href={vendor.destino}
                            className="h-8 px-3 shrink-0 rounded-[10px] bg-[#7C3AED] text-white text-[12px] font-medium hover:bg-[#6B4FE0] transition-colors inline-flex items-center"
                          >
                            {status === 'CONECTADO' ? 'Gerenciar' : 'Configurar'}
                          </Link>
                        ) : (
                          <span className="h-8 px-3 shrink-0 rounded-[10px] border border-[#2A2A35] text-[#2A2A35] text-[11px] font-medium inline-flex items-center cursor-not-allowed" title="Sem integração disponível no NEXUS OS">
                            Indisponível
                          </span>
                        )}
                      </div>
                      {vendor.id === 'mercadolivre' && status === 'CONECTADO' && (
                        <div className="rounded-[10px] border border-[#2A2A35] bg-[#12121A] px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] uppercase tracking-wider text-zinc-400">Sincronização automática</span>
                            <span className={`text-[10px] font-medium ${agendamentoML?.ativo ? 'text-emerald-400' : 'text-amber-300'}`}>
                              {agendamentoML?.ativo ? 'ATIVA' : 'SEM ESTADO'}
                            </span>
                          </div>
                          {agendamentoML ? (
                            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-zinc-400">
                              <span>Pedidos: {agendamentoML.periodos.pedidosMin} min</span>
                              <span>Estoque: {agendamentoML.periodos.estoqueMin} min</span>
                              <span>Produtos: {Math.round(agendamentoML.periodos.produtosMin / 60)} h</span>
                            </div>
                          ) : (
                            <p className="mt-1 text-[10px] text-amber-200/70">Não foi possível consultar o estado do agendador.</p>
                          )}
                          {agendamentoML && (agendamentoML.resumo.pausadas > 0 || agendamentoML.resumo.comFalha > 0) && (
                            <p className="mt-1 text-[10px] text-amber-300">
                              {agendamentoML.resumo.pausadas} tarefa(s) pausada(s), {agendamentoML.resumo.comFalha} com retentativas.
                            </p>
                          )}
                          {agendamentoML?.tarefas.map((tarefa) => (
                            <p key={tarefa.tipo} className="mt-1 truncate text-[10px] text-zinc-500" title={tarefa.ultimoErro?.motivo}>
                              {tarefa.tipo.replace('MERCADO_LIVRE_', '')}: {tarefa.status.toLowerCase()}
                              {tarefa.ultimoErro?.motivo ? ` · ${tarefa.ultimoErro.motivo}` : ''}
                            </p>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* Bridge local (hardware) — só aparece com a categoria visível */}
        {filtro === 'todos' || filtro === 'hardware' ? (
          <div className="mt-4 rounded-[16px] bg-[#1A1A23] border border-[#2A2A35] p-5 flex flex-wrap sm:flex-nowrap items-center gap-4">
            <div className="h-11 w-11 shrink-0 rounded-[12px] bg-[#12121A] border border-[#2A2A35] flex items-center justify-center">
              <Server className="w-5 h-5 text-[#A78BFA]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-bold text-zinc-100">NEXUS Bridge</h3>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#12121A] border border-[#2A2A35] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  requer instalação local
                </span>
              </div>
              <p className="mt-1 text-[12px] text-zinc-400">
                Agente que fala com balança, gaveta e coletores pela porta COM/USB serial do computador do caixa.
              </p>
            </div>
            <div className="sm:ml-auto flex items-center gap-2">
              {/* "Testar conexão" era um botão que só mostrava um toast fixo
                  ("Bridge não detectado…"), sem NENHUMA requisição: ele
                  affirmava um resultado que o navegador não podia saber.
                  Não existe endpoint de Bridge no backend, então o botão
                  mentia sobre uma verificação que não acontecia. Trocado por
                  uma informação verdadeira e útil: a balança/serial exige o
                  agente local instalado, que não é entregável pelo NEXUS. */}
              <span className="h-9 px-4 rounded-[10px] border border-[#2A2A35] bg-[#12121A] text-[12px] text-zinc-500 inline-flex items-center">
                Requer agente local instalado
              </span>
            </div>
          </div>
        ) : null}

        {/* API pública */}
        <section className="mt-8 rounded-[20px] bg-[#1A1A23] border border-[#2A2A35] p-6">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#A78BFA]" />
            <h2 className="text-[16px] font-bold text-white">Nova chave de API pública</h2>
          </div>
          <p className="mt-1.5 text-[12px] text-zinc-400">
            Conecta seu ERP, e-commerce ou app ao NEXUS. A chave é gravada apenas como hash — o texto completo só existe na resposta.
          </p>

          <form onSubmit={criarChave} className="mt-5 space-y-5">
            <div>
              <label htmlFor="nome-chave" className="block text-[12px] font-medium text-zinc-300 mb-2">{traduzir('nome', "Nome")}</label>
              <input
                id="nome-chave"
                value={nomeChave}
                onChange={(e) => setNomeChave(e.target.value)}
                placeholder="Ex.: Integração ERP contábil"
                className="w-full h-11 rounded-[12px] bg-[#0F0F14] border border-[#2A2A35] px-4 text-[13px] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-[#7C3AED] transition-colors"
              />
            </div>

            <div>
              <p className="text-[12px] font-medium text-zinc-300 mb-2">Escopos</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {ESCOPOS.map((esc) => {
                  const ativo = escopos.includes(esc.id);
                  const Icone = esc.icone;
                  const bloqueado = esc.modo === 'escrita';
                  return (
                    <button
                      key={esc.id}
                      type="button"
                      aria-pressed={ativo}
                      // BUG: o card dizia "Em breve — API hoje é somente
                      // leitura" mas NÃO estava desabilitado. O clique marcava
                      // o escopo (`aria-pressed`, borda roxa) e ele ficava
                      // selecionado na tela — e só sumia no `criarChave`, que
                      // filtra por ESCOPOS_ACEITOS sem avisar. Ou seja: o
                      // botão prometia não fazer nada, fazia, e a escolha era
                      // descartada na hora de criar a chave. O pior dos três
                      // desfechos num formulário que gera credencial de API.
                      disabled={bloqueado}
                      onClick={() => !bloqueado && toggleEscopo(esc.id)}
                      className={`text-left p-3 rounded-[12px] border transition-colors ${
                        ativo
                          ? 'bg-[#7C3AED]/10 border-[#7C3AED]/30'
                          : bloqueado
                            ? 'bg-[#0F0F14] border-[#2A2A35] opacity-50 cursor-not-allowed'
                            : 'bg-[#0F0F14] border-[#2A2A35] hover:border-[#3A3A4A] cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Icone className="w-4 h-4 text-zinc-300" />
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                            esc.modo === 'escrita'
                              ? 'bg-amber-500/10 text-amber-300/80'
                              : 'bg-[#7C3AED]/15 text-[#A78BFA]'
                          }`}
                        >
                          {esc.modo}
                        </span>
                      </div>
                      <p className="mt-2 text-[12px] font-semibold text-zinc-100">{esc.rotulo}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500 leading-snug">{esc.descricao}</p>
                      {bloqueado && (
                        <p className="mt-1.5 text-[10px] text-amber-300/70">Em breve — API hoje é somente leitura</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[12px] font-medium text-zinc-300 mb-2">
                Expiração{' '}
                <span className="text-zinc-500 font-normal">(indisponível — a chave criada não expira)</span>
              </p>
              {/* CONTROLE DE SEGURANÇA QUE NÃO EXISTE — não pode ficar clicável.
                  Antes estes botões e o campo de IP Whitelist eram plenamente
                  interativos, mas NADA era enviado: `criarChave` mandava só
                  `{ nome, escopos }` e o schema do backend
                  (`POST /api-publica/chaves`) aceita apenas esses dois campos.
                  O modelo `ChaveApi` não tem `expiraEm` nem coluna de IP — não
                  há onde gravar.

                  Ou seja: quem escolhia "30 dias" recebia uma chave que NUNCA
                  expira, e quem preenchia o IP achava que ela só valia daquele
                  endereço — valia de qualquer IP do mundo. Controle de segurança
                  que parece existir e não existe é pior que controle ausente:
                  o gestor relaxa porque "já configurou".

                  O padrão honesto já existe nesta própria tela (escopos de
                  escrita, "Em breve"; Bridge, "Requer agente local"). Aqui os
                  controles seguem no mesmo lugar do formulário — sem redesign —
                  mas desabilitados e declarando o que acontece de verdade. */}
              <div className="flex flex-wrap gap-2">
                {EXPIRACOES.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    disabled
                    aria-disabled="true"
                    aria-pressed={expiracao === e.id}
                    title="Expiração automática ainda não existe: a chave segue válida até ser revogada."
                    className={`h-9 px-4 rounded-[10px] border text-[12px] font-medium transition-colors cursor-not-allowed opacity-50 ${
                      expiracao === e.id
                        ? 'bg-white text-black border-white'
                        : 'bg-[#1A1A23] border-[#2A2A35] text-zinc-400'
                    }`}
                  >
                    {e.rotulo}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-amber-300/70">
                A chave só deixa de valer quando for revogada na tabela abaixo.
              </p>
            </div>

            <div>
              <label htmlFor="ip-whitelist" className="block text-[12px] font-medium text-zinc-300 mb-2">
                IP Whitelist{' '}
                <span className="text-zinc-500 font-normal">(indisponível — a chave não é restrita por IP)</span>
              </label>
              <input
                id="ip-whitelist"
                value={ipWhitelist}
                onChange={(e) => setIpWhitelist(e.target.value)}
                disabled
                aria-disabled="true"
                placeholder="Ex.: 200.150.10.0/24, 191.0.0.1"
                title="Restrição por IP ainda não existe: qualquer origem pode usar a chave."
                className="w-full h-11 rounded-[12px] bg-[#0F0F14] border border-[#2A2A35] px-4 text-[13px] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-[#7C3AED] transition-colors opacity-50 cursor-not-allowed"
              />
              <p className="mt-1.5 text-[10px] text-amber-300/70">
                Qualquer endereço IP com a chave consegue chamar os endpoints de leitura.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="h-11 px-6 rounded-[12px] bg-[#7C3AED] hover:bg-[#6B4FE0] text-white font-semibold text-[13px] inline-flex items-center gap-2 transition-colors"
              >
                <KeyRound className="w-4 h-4" />
                Gerar chave
              </button>
              <p className="text-[11px] text-zinc-500">
                Expiração e whitelist ficam como referência — o backend de hoje só persiste nome e escopos.
              </p>
            </div>
          </form>

          {/* Tabela de chaves reais (GET /api-publica/chaves) */}
          <div className="mt-8">
            <h3 className="text-[14px] font-bold text-zinc-100">Chaves existentes</h3>
            {chaves.length === 0 ? (
              <p className="mt-3 text-[13px] text-zinc-500">Nenhuma chave criada ainda.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-[12px] border border-[#2A2A35]">
                <table className="w-full min-w-[760px] border-collapse">
                  <thead className="bg-[#12121A]">
                    <tr className="border-b border-[#2A2A35]">
                      {['Nome', 'Escopos', 'Criada em', 'Último uso', 'Status', 'Ações'].map((t) => (
                        <th
                          key={t}
                          className="px-5 py-3 text-left text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-semibold"
                        >
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2A2A35]/60">
                    {chaves.map((c) => {
                      const ativa = c.status === 'ATIVA';
                      return (
                        <tr key={c.id} className="transition-colors hover:bg-[#12121A]/60">
                          <td className="px-5 py-3.5 text-[12px] font-medium text-zinc-200">
                            {c.nome}
                            <span className="block mt-0.5 font-mono text-[11px] text-zinc-500">{c.prefixo}•••</span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex flex-wrap gap-1">
                              {c.escopos.map((e) => (
                                <span
                                  key={e}
                                  className="font-mono text-[10px] px-2 py-1 rounded-full bg-[#2A2A35] border border-[#3A3A4A] text-zinc-400"
                                >
                                  {e}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-[12px] text-zinc-400 whitespace-nowrap">
                            {formatDateTime(c.createdAt)}
                          </td>
                          <td className="px-5 py-3.5 text-[12px] text-zinc-400 whitespace-nowrap">
                            {c.ultimoUso ? formatDateTime(c.ultimoUso) : 'nunca'}
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={`text-[10px] font-medium px-2 py-1 rounded-full border ${
                                ativa
                                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                                  : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                              }`}
                            >
                              {ativa ? 'Ativa' : 'Revogada'}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => copiar(c.prefixo, `Prefixo ${c.prefixo} copiado.`)}
                                title="Copiar prefixo"
                                aria-label={`Copiar prefixo da chave ${c.nome}`}
                                className="h-8 w-8 rounded-[10px] border border-[#2A2A35] bg-[#12121A] flex items-center justify-center hover:border-[#3A3A4A] transition-colors"
                              >
                                <Copy className="w-3.5 h-3.5 text-zinc-400" />
                              </button>
                              {ativa && (
                                <button
                                  type="button"
                                  onClick={() => revogar(c.id)}
                                  title="Revogar chave"
                                  aria-label={`Revogar chave ${c.nome}`}
                                  className="h-8 w-8 rounded-[10px] border border-[#2A2A35] bg-[#12121A] flex items-center justify-center hover:border-red-500/40 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-zinc-400" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Infra: e-mail real + webhooks + trilha de eventos reais */}
        {(filtro === 'todos' || filtro === 'infra') && (
          <section className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <article className="rounded-[16px] bg-[#1A1A23] border border-[#2A2A35] p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 shrink-0 rounded-[12px] bg-[#12121A] border border-[#2A2A35] flex items-center justify-center">
                  <Webhook className="w-[18px] h-[18px] text-zinc-300" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-zinc-100">Webhooks</h3>
                  <p className="mt-1 text-[12px] text-zinc-400">
                    URL que o NEXUS chama quando um evento acontece. Cada envio fica registrado com tentativa e resposta.
                  </p>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between gap-3 pt-2 border-t border-[#2A2A35]/60">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <span className={`w-1.5 h-1.5 rounded-full ${emailConectado ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                  {emailConectado ? 'E-mail ativo' : 'E-mail não configurado'}
                </span>
                <Link
                  href="/configuracoes"
                  className="h-8 px-3 rounded-[10px] border border-[#2A2A35] text-[12px] text-zinc-300 inline-flex items-center hover:border-[#3A3A4A] transition-colors"
                >
                  Configurar
                </Link>
              </div>
            </article>

            <article className="rounded-[16px] bg-[#1A1A23] border border-[#2A2A35] p-4">
              <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-zinc-100">Últimos eventos</h3>
              {acoes.length === 0 ? (
                <p className="mt-3 text-[12px] text-zinc-500">Nenhuma sincronização registrada ainda.</p>
              ) : (
                <ul className="mt-3 ml-1 pl-5 space-y-4 border-l border-[#2A2A35]">
                  {acoes.map((a) => (
                    <li key={`${a.categoria}-${a.nome}`} className="relative">
                      <span
                        className={`absolute -left-[26px] top-1.5 w-2 h-2 rounded-full border-2 border-[#1A1A23] ${
                          a.status === 'ERRO' ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                      />
                      <p className="text-[11px] text-zinc-500">{formatDateTime(a.ultimaSincronizacao)}</p>
                      <p className="text-[12px] text-zinc-200">
                        {a.nome} — {a.status === 'ERRO' ? 'falha na sincronização' : 'sincronizado'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </section>
        )}
      </div>

      {/* Modal da chave recém-gerada (a única vez que ela aparece em texto puro) */}
      {chaveGerada && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-[6px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-chave-titulo"
        >
          <div className="w-full max-w-md rounded-[20px] border border-[#2A2A35] bg-[#1A1A23] shadow-[0_20px_80px_rgba(0,0,0,0.6)] p-6">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 shrink-0 rounded-[12px] bg-emerald-500/10 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <h3 id="modal-chave-titulo" className="text-[14px] font-bold text-zinc-100">
                  Chave gerada com sucesso
                </h3>
                <p className="mt-1 text-[12px] text-zinc-400">
                  Esta é a única vez que a chave aparece por completo. O NEXUS guarda apenas o hash.
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-[12px] bg-[#0F0F14] border border-[#2A2A35] p-3.5">
              <code className="font-mono text-[12px] text-zinc-100 break-all select-all">{chaveGerada}</code>
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-[12px] bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
              <p className="text-[11px] leading-snug text-amber-200/80">
                Copie e guarde em local seguro agora. Se perder, revogue a chave e gere outra — não há como recuperá-la.
              </p>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => copiar(chaveGerada, 'Chave copiada para a área de transferência.')}
                className="h-9 px-3.5 rounded-[10px] bg-white text-black font-semibold text-[12px] inline-flex items-center gap-2 transition-opacity hover:opacity-90"
              >
                {copiado ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    copiar(
                      EXEMPLO_API,
                      'Exemplo de uso copiado. Autentique com Authorization: Bearer <chave> e um escopo de leitura por chamada.',
                    )
                  }
                  className="h-10 px-4 rounded-[12px] bg-[#12121A] border border-[#2A2A35] text-[12px] text-zinc-300 inline-flex items-center gap-2 hover:border-[#3A3A4A] transition-colors"
                >
                  <FileCode2 className="w-3.5 h-3.5" />
                  Copiar exemplo de uso
                </button>
                <button
                  type="button"
                  onClick={() => { setChaveGerada(null); setCopiado(false); }}
                  className="h-10 px-5 rounded-[12px] bg-white text-black text-[12px] font-semibold transition-opacity hover:opacity-90"
                >{traduzir('fechar', "Fechar")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Etapa 2 — modal "Dados da conta ML" (9 endpoints + PUT). */}
      {mostrarDadosML && (
        <MercadoLivreDadosModal onClose={() => setMostrarDadosML(false)} />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[110] flex items-center gap-2 rounded-full bg-[#1A1A23] border border-[#2A2A35] px-4 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED] animate-pulse" />
          <span className="text-[12px] text-zinc-200 whitespace-nowrap">{toast}</span>
        </div>
      )}
    </div>
  );
}

/** Card de KPI da central — ícone, valor grande e label em caixa alta. */
function KpiCard({
  label,
  valor,
  icone: Icone,
  cor,
  pulso,
  sufixo,
}: {
  label: string;
  valor: string;
  icone: typeof Percent;
  cor: string;
  pulso?: boolean;
  sufixo?: string;
}) {
  return (
    <div className="rounded-[16px] bg-[#1A1A23] border border-[#2A2A35] p-4 flex items-start gap-3 transition-colors hover:border-[#3A3A4A]">
      <div className="h-9 w-9 shrink-0 rounded-[10px] bg-[#12121A] border border-[#2A2A35] flex items-center justify-center">
        <Icone className="w-4 h-4" style={{ color: cor }} />
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-semibold">
          {pulso && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
          {label}
        </p>
        <p className="mt-1.5 text-[24px] font-bold leading-none text-zinc-100">
          {valor}
          {sufixo && <span className="ml-1.5 text-[11px] font-normal text-zinc-500">{sufixo}</span>}
        </p>
      </div>
    </div>
  );
}


