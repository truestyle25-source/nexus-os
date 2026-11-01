'use client';
// Seção 14 — PDV: operação de balcão sobre o módulo de Vendas existente.
// Nada foi recriado: a venda usa o POST /vendas que já faz baixa de estoque,
// faturamento, ticket médio, metas e financeiro — agora vinculada ao turno
// de caixa (Caixa/MovimentacaoCaixa) e com fluxo de operador no frontend.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { getApiBaseUrl, getToken } from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';
import PixQrCodeModal from '@/components/PixQrCodeModal';
// Respeita as preferências de Moeda / Formato de hora / Idioma da aba
// Configurações. Sem este import, o PDV fixa BRL e 24h no próprio código.
import { formatBRL, formatClock } from '@/lib/format';
import { t as traduzir, tMenu } from '@/lib/i18n';
import { db } from '@/lib/pdv/db';
import { atualizarCatalogoLocal, listarCatalogoLocal } from '@/lib/pdv/sincronizarCatalogo';
import { precoVigente, resolverBipagem } from '@/lib/pdv/catalogo';
import { cupomDaVenda, renderCupom } from '@/lib/pdv/cupom';
import { contextoLocalDoToken } from '@/lib/pdv/contextoLocal';
import { enfileirarVendaComCarrinho, obterOperacao, processarFila, recuperarOperacoesInterrompidas, contarPorStatus, marcar } from '@/lib/pdv/syncQueue';
import { enviarOperacaoPdv } from '@/lib/pdv/enviarOperacao';
import { novaIdempotencyKey, novoId } from '@/lib/pdv/idempotency';
import { backendAlcancavel, estaOnline } from '@/lib/pdv/offline';
import { avaliarFormaOffline } from '@/lib/pdv/politicaOffline';
import { recuperarCarrinho, salvarCarrinho, limparCarrinho as limparCarrinhoPersistido } from '@/lib/pdv/cartSession';
import { adicionarProduto, alterarQuantidade, removerProduto, subtotalDoCarrinho, totalComDesconto } from '@/lib/pdv/carrinho';
import type { ContextoLocal } from '@/lib/pdv/tipos';

const FORMAS = ['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'BOLETO'] as const;
const ROTULO_FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'PIX', CARTAO_DEBITO: 'Cartão de Débito',
  CARTAO_CREDITO: 'Cartão de Crédito', BOLETO: 'Boleto',
};
/**
 * Formata moeda respeitando a preferencia "Moeda" de Configuracoes.
 * Antes fixava BRL aqui, entao trocar para USD/EUR nao mudava o PDV.
 */
const brl = (v: number) => formatBRL(v);

/** Design system moderno do PDV — só visual, sem interferir no restante do app. */
const pdvCss = `
.pdv-root { font-feature-settings: 'tnum' 1; }
.pdv-root .admin-panel { border-radius: 16px; border: 1px solid var(--nexus-border); background: var(--nexus-panel); box-shadow: 0 12px 32px rgba(0,0,0,.10); }
.pdv-root .admin-panel h2 { font-size: 12.5px; letter-spacing: 1.6px; text-transform: uppercase; opacity: .8; }
.pdv-root .admin-secondary { border-radius: 10px; background: var(--nexus-panel-2); border: 1px solid var(--nexus-border); transition: all .15s ease; }
.pdv-root .admin-secondary:hover:not(:disabled) { border-color: rgba(139,92,246,.55); background: rgba(139,92,246,.08); transform: translateY(-1px); }
.pdv-root .admin-list-row { border-radius: 10px; padding: 9px 10px; transition: background .15s ease; }
.pdv-root .admin-list-row:hover { background: rgba(139,92,246,.07); }
.pdv-root input, .pdv-root select { border-radius: 10px; transition: border-color .15s ease, box-shadow .15s ease; }
.pdv-root input:focus, .pdv-root select:focus { outline: none; border-color: rgba(139,92,246,.6); box-shadow: 0 0 0 3px rgba(139,92,246,.18); }
.pdv-glass { background: var(--nexus-panel) !important; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
.pdv-logo { background: linear-gradient(135deg,#a78bfa,#7c3aed 55%,#5b21b6); box-shadow: 0 6px 20px rgba(124,58,237,.5), inset 0 1px 0 rgba(255,255,255,.28); }
.pdv-btn-grad { background: linear-gradient(135deg,#8b5cf6,#6d28d9) !important; border: 1px solid transparent !important; color: #fff !important; font-weight: 700; box-shadow: 0 4px 16px rgba(124,58,237,.35); transition: transform .15s ease, box-shadow .15s ease, filter .15s ease; }
.pdv-btn-grad:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(124,58,237,.5); filter: brightness(1.07); }
.pdv-btn-grad:active:not(:disabled) { transform: translateY(0); }
.pdv-btn-grad:disabled { opacity: .45; filter: grayscale(.4); box-shadow: none; }
.pdv-card { transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease; }
.pdv-card:hover:not(:disabled) { transform: translateY(-3px); border-color: rgba(139,92,246,.6) !important; box-shadow: 0 12px 28px rgba(0,0,0,.5), 0 0 0 1px rgba(139,92,246,.25); }
.pdv-plus { transition: transform .16s ease; background: linear-gradient(135deg,#8b5cf6,#6d28d9); box-shadow: 0 2px 10px rgba(124,58,237,.5); }
.pdv-card:hover .pdv-plus { transform: scale(1.18); }
.pdv-price { color: var(--nexus-accent-2); font-weight: 800; }
.pdv-total { font-size: 23px; font-weight: 800; letter-spacing: -.5px; background: none; -webkit-background-clip: initial; background-clip: initial; color: var(--nexus-accent-2); -webkit-text-fill-color: var(--nexus-accent-2); }
.pdv-chip { border-radius: 999px !important; padding: 5px 14px !important; font-size: 12.5px; }
.pdv-modal-bg { background: rgba(5,4,10,.7) !important; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); animation: pdvFade .2s ease both; }
.pdv-modal-card { animation: pdvPop .24s cubic-bezier(.2,.9,.3,1.15) both; border-radius: 18px !important; box-shadow: 0 24px 64px rgba(0,0,0,.6); }
.pdv-clock { font-variant-numeric: tabular-nums; letter-spacing: .4px; }
@keyframes pdvFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pdvPop { from { opacity: 0; transform: scale(.95) translateY(12px); } to { opacity: 1; transform: none; } }
.pdv-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.pdv-scroll::-webkit-scrollbar-thumb { background: rgba(139,92,246,.4); border-radius: 99px; }
.pdv-scroll::-webkit-scrollbar-track { background: transparent; }
.pdv-grid { display: grid; grid-template-columns: minmax(0,1fr) 400px; gap: 16px; align-items: start; }
.pdv-side { position: sticky; top: 84px; }
@media (max-width: 1120px) { .pdv-grid { grid-template-columns: 1fr; } .pdv-side { position: static; } }
.pdv-cart-scroll { max-height: 300px; overflow-y: auto; margin: 0 -4px; padding: 0 4px; }
.pdv-thumb { width: 44px; height: 44px; border-radius: 9px; object-fit: cover; flex-shrink: 0; }
.pdv-thumb-empty { width: 44px; height: 44px; border-radius: 9px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 19px; background: linear-gradient(135deg, rgba(124,58,237,.2), rgba(124,58,237,.06)); }
.pdv-empty-dash { border: 2px dashed var(--nexus-border); border-radius: 14px; padding: 26px 14px; text-align: center; }
.pdv-formas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.pdv-forma-btn { border-radius: 10px !important; padding: 8px 4px !important; font-size: 11px !important; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.pdv-troco { border-radius: 10px; padding: 10px 12px; font-size: 13px; display: flex; justify-content: space-between; align-items: center; }
.pdv-troco-ok { background: rgba(16,185,129,.12); border: 1px solid rgba(16,185,129,.4); color: #34d399; }
.pdv-troco-falta { background: rgba(245,158,11,.12); border: 1px solid rgba(245,158,11,.4); color: #fbbf24; }
.pdv-finalizar { height: 48px; font-size: 14.5px !important; letter-spacing: .5px; border-radius: 12px !important; }
.pdv-atalhos { display: flex; gap: 6px; align-items: center; justify-content: center; margin-top: 10px; font-size: 11px; opacity: 0.55; flex-wrap: wrap; }
.pdv-kbd { padding: 2px 6px; border-radius: 5px; background: rgba(139,92,246,.14); border: 1px solid rgba(139,92,246,.35); color: var(--nexus-accent-2); font-family: monospace; font-size: 10px; }
/* IMPRESSÒO DO CUPOM (P4)
   ------------------------
   O botão "Imprimir" do cupom chamava window.print(), mas a classe .pdv-noprint
   só estava no header. O modal do cupom é filho de main.pdv-root, e nenhuma das
   seções da tela tinha a classe: imprimia o cupom JUNTO com o grid de produtos,
   o carrinho, o painel do turno e as integrações. O papel do balcão saía
   ilegível — e o menu do topo promete "Impressora Térmica".

   A correção marca com .pdv-noprint tudo que é tela e mantém o cupom visível,
   com fundo branco e texto preto (o tema é escuro: sem forçar as cores, sairia
   texto claro sobre fundo escuro). Nenhum elemento de layout foi alterado — só
   a regra de impressão. */
@media print {
  .pdv-noprint { display: none !important; }
  .pdv-print-area {
    background: #fff !important; color: #000 !important;
    border: 0 !important; box-shadow: none !important;
    max-height: none !important; overflow: visible !important;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pdv-print-area * { color: #000 !important; }
  .pdv-print-area pre { background: #fff !important; border: 0 !important; overflow: visible !important; }
  .pdv-print-backdrop {
    position: static !important; inset: auto !important; z-index: auto !important;
    display: flex !important; padding: 0 !important; background: transparent !important;
    backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
  }
}
`;

export default function PDV() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contextoPdv, setContextoPdv] = useState<ContextoLocal | null>(null);
  const [pendentesSync, setPendentesSync] = useState(0);
  const [modoOffline, setModoOffline] = useState(false);
  const [operacaoCarrinhoPendente, setOperacaoCarrinhoPendente] = useState<string | null>(null);
  const catalogoAtualizadoEmRef = useRef<Record<string, number>>({});

  // Turno de caixa
  const [caixa, setCaixa] = useState<any>(null);
  const [resumo, setResumo] = useState<any>(null);
  // Forma devolvida por `GET /filiais`. Apenas o mínimo: id + nome bastam para
  // montar o seletor, e a rota deliberadamente não devolve CNPJ (dado
  // cadastral, que fica em `GET /empresas`).
  const [filiais, setFiliais] = useState<Array<{ id: string; nome: string }>>([]);
  const [erroFiliais, setErroFiliais] = useState<string | null>(null);
  const [filialId, setFilialId] = useState('');
  const [fundoTroco, setFundoTroco] = useState('0');
  const [mostrarAbrir, setMostrarAbrir] = useState(false);
  const [mostrarFechar, setMostrarFechar] = useState(false);
  const [abrindo, setAbrindo] = useState(false);
  const [fechando, setFechando] = useState(false);
  const [movimentando, setMovimentando] = useState(false);
  const abrindoRef = useRef(false);
  const fechandoRef = useRef(false);
  const movimentandoRef = useRef(false);
  const [valorContado, setValorContado] = useState('');
  const [obsFechamento, setObsFechamento] = useState('');
  const [mostrarSangria, setMostrarSangria] = useState(false);
  const [tipoMov, setTipoMov] = useState<'SANGRIA' | 'SUPRIMENTO'>('SANGRIA');
  const [valorMov, setValorMov] = useState('');
  const [motivoMov, setMotivoMov] = useState('');

  // Venda
  const [produtos, setProdutos] = useState<any[]>([]);
  const [carregandoProdutos, setCarregandoProdutos] = useState(false);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [categoriaId, setCategoriaId] = useState('');
  const [agora, setAgora] = useState<Date | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [mostrarMenu, setMostrarMenu] = useState(false);
  const [clientes, setClientes] = useState<any[]>([]);
  const [busca, setBusca] = useState('');
  const [carrinho, setCarrinho] = useState<Array<{ produtoId: string; nome: string; preco: number; quantidade: number; estoque: number; desconto: number; imagem?: string }>>([]);
  const [clienteId, setClienteId] = useState('');
  const [descontoGeral, setDescontoGeral] = useState('0');
  const [forma, setForma] = useState<string>('DINHEIRO');
  const [parcelas, setParcelas] = useState('1');
  const [valorRecebido, setValorRecebido] = useState('');
  const [cupom, setCupom] = useState<any>(null);
  const [imprimirCupomAoFinalizar, setImprimirCupomAoFinalizar] = useState(false);
  const impressaoAutomaticaRef = useRef(false);
  const sincronizandoFilaRef = useRef(false);
  const [vendasTurno, setVendasTurno] = useState<any[]>([]);
  const [erroVendasTurno, setErroVendasTurno] = useState<string | null>(null);
  const [mostrarPix, setMostrarPix] = useState(false);
// Travas e erros que antes não existiam — tudo corrigido nesta rodada.
  //
  // `finalizando` impede a VENDA DUPLICADA. `finalizarVenda` não tinha trava
  // nenhuma e o botão não era desabilitado durante o `await`, enquanto o
  // atalho F4 dependia de `carrinho.length` — que não muda no meio da
  // requisição. Dois toques no F4 (ou o teclado repetindo o evento) criavam
  // DUAS vendas, com estoque baixado duas vezes. No balcão, F4 é o botão mais
  // apertado da tela: isso acontecia.
  const [finalizando, setFinalizando] = useState(false);
  const finalizandoRef = useRef(false);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const cancelandoRef = useRef(false);
  // Erros que antes sumiam em `catch { /* silencioso */ }`. Sem isto, grid
  // vazio por falta de permissão e grid vazio por não haver produtos eram
  // a mesma tela, e o operador não tinha como saber o que fazer.
  const [erroCaixa, setErroCaixa] = useState<string | null>(null);
  const [erroProdutos, setErroProdutos] = useState<string | null>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  const { descontoAplicado: descontoNum, total, descontoInvalido } = totalComDesconto(carrinho, Number(descontoGeral) || 0);
  const subtotal = useMemo(() => subtotalDoCarrinho(carrinho), [carrinho]);
  const descontoInformado = Number(descontoGeral) || 0;
  const recebidoNum = Number(valorRecebido) || 0;
  const troco = forma === 'DINHEIRO' ? Math.max(0, recebidoNum - total) : 0;

  const carregarCaixa = useCallback(async (contextoInformado?: ContextoLocal | null) => {
    // O erro do `/pdv/caixa/atual` é o ÚNICO que significa "não há caixa" —
    // é a única chamada que responde 404 nesse caso. Qualquer outra falha é um
    // problema de permissão/rede e NÃO pode zerar o caixa.
    //
    // Antes as três viviam num `try` só: um 403 na lista de vendas do turno
    // (que exigia `vendas:visualizar`, permissão que o caixa não tem) caía no
    // catch e executava `setCaixa(null)`. A tela passava a dizer "CAIXA
    // FECHADO" com o caixa aberto, o botão de venda era barrado por
    // `if (!caixa)` e, ao tentar abrir de novo, o servidor devolvia 409
    // ("Você já tem um caixa aberto"). O operador ficava preso sem mensagem.
    let caixaRemoto: any = null;
    try {
      const { data } = await api.get('/pdv/caixa/atual');
      caixaRemoto = data;
      setCaixa(data);
      setApiOk(true);
      setModoOffline(false);
      setErroCaixa(null);
      const contexto = contextoInformado ?? contextoLocalDoToken(getToken());
      if (!data) {
        setResumo(null); setVendasTurno([]); setErroVendasTurno(null);
        if (contexto) {
          const abertas = await db().caixa.where('[empresaId+usuarioId+status]').equals([contexto.empresaId, contexto.usuarioId, 'ABERTO']).toArray();
          await db().caixa.bulkDelete(abertas.map((item) => item.id));
        }
        return null;
      }
      if (contexto && (data.empresaId !== contexto.empresaId || data.usuarioId !== contexto.usuarioId)) {
        setCaixa(null); setApiOk(false); setErroCaixa('O turno retornado não corresponde ao operador autenticado.'); return null;
      }
      try {
        await db().caixa.put({
          id: data.id, empresaId: data.empresaId, filialId: data.filialId,
          filialNome: data.filial?.nome ?? '', numero: data.numero ?? null,
          status: data.status, fundoTroco: Number(data.fundoTroco), saldo: Number(data.saldo),
          abertoEm: new Date(data.abertoEm).toISOString(), usuarioId: data.usuarioId,
          usuarioNome: data.usuario?.nome ?? '', atualizadoEm: Date.now(),
        });
      } catch { /* Cache local é auxiliar; o turno confirmado no backend prevalece. */ }
      // Ao retomar um turno aberto, a filial vem do caixa persistido. Sem
      // selecionar este id, um operador com várias filiais ficava com filialId
      // vazio e não conseguia carregar produtos nem concluir a venda.
      setFilialId(data.filialId);
      if (data.filial?.nome) setFiliais((atuais) => atuais.some((f) => f.id === data.filialId) ? atuais : [...atuais, { id: data.filialId, nome: data.filial.nome }]);
    } catch (e: any) {
      const contexto = contextoInformado ?? contextoLocalDoToken(getToken());
      if ((!e?.response || e.response.status >= 500) && contexto) {
        try {
          const local = await db().caixa.where('[empresaId+usuarioId+status]').equals([contexto.empresaId, contexto.usuarioId, 'ABERTO']).first();
          if (local) {
            const caixaOffline = {
              ...local,
              usuario: { nome: local.usuarioNome || 'Operador' },
              filial: { nome: local.filialNome || '' },
            };
            setCaixa(caixaOffline);
            setFilialId(local.filialId);
            setErroFiliais(null);
            setResumo(null); setVendasTurno([]); setErroVendasTurno(null);
            setApiOk(false);
            setModoOffline(true);
            setErroCaixa('Backend indisponível. Caixa local em modo offline; somente vendas em dinheiro ficam pendentes de sincronização.');
            if (local.filialNome) setFiliais((atuais) => atuais.some((f) => f.id === local.filialId) ? atuais : [...atuais, { id: local.filialId, nome: local.filialNome! }]);
            return caixaOffline;
          }
        } catch { /* Sem cache utilizável, mostra o erro original. */ }
      }
      setCaixa(null);
      setResumo(null);
      setVendasTurno([]);
      setErroVendasTurno(null);
      setApiOk(false);
      setModoOffline(false);
      setErroCaixa(
        e?.response?.status === 403
          ? 'Sem permissão para ver o caixa (pdv:visualizar). Fale com o administrador.'
          : e?.response?.data?.error || 'Não foi possível consultar o caixa.',
      );
      return null;
    }
    // Caixa existe: agora cada dado é buscado isoladamente. Uma lista vazia
    // degrada o painel; derrubar o turno inteiro não pode.
    setErroCaixa(null);
    const [r, v] = await Promise.allSettled([
      api.get('/pdv/caixa/resumo'),
      api.get('/pdv/caixa/vendas'),
    ]);
    setResumo(r.status === 'fulfilled' ? r.value.data : null);
    setVendasTurno(v.status === 'fulfilled' ? (v.value.data?.vendas ?? []) : []);
    setErroVendasTurno(v.status === 'rejected'
      ? (v.reason?.response?.data?.error || 'Não foi possível carregar as vendas do turno.')
      : null);
    // O selo "API /pdv/caixa/resumo ⬢ LIVE/OFF" passa a refletir o resumo
    // de verdade, e não o sucesso da chamada do caixa.
    if (r.status === 'rejected') {
      setApiOk(false);
      setErroCaixa('Caixa aberto, mas o resumo do turno não carregou (sem permissão ou rede).');
    }
    return caixaRemoto;
  }, []);

  const carregarProdutos = useCallback(async (search: string, catId?: string) => {
    if (!filialId) { setProdutos([]); setCarregandoProdutos(false); return; }
    const contexto = contextoPdv ?? contextoLocalDoToken(getToken());
    if (!contexto) { setProdutos([]); setErroProdutos('Não foi possível identificar empresa e operador para o catálogo local.'); return; }
    setCarregandoProdutos(true);
    let falhaRede: any = null;
    try {
      const chave = `${contexto.empresaId}:${filialId}`;
      if (estaOnline() && Date.now() - (catalogoAtualizadoEmRef.current[chave] ?? 0) > 30_000) {
        try {
          await atualizarCatalogoLocal(contexto, filialId);
          catalogoAtualizadoEmRef.current[chave] = Date.now();
        } catch (e) { falhaRede = e; }
      }
      const todosLocais = await listarCatalogoLocal(contexto, filialId);
      const termo = search.trim().toLocaleLowerCase('pt-BR');
      const lista = todosLocais
        .filter((p) => p.ativo && (!catId || p.categoriaId === catId))
        .filter((p) => !termo || p.nome.toLocaleLowerCase('pt-BR').includes(termo) || (p.sku ?? '').toLocaleLowerCase('pt-BR').includes(termo) || (p.codigoBarras ?? '').includes(search.trim()))
        .sort((a, b) => Number((b.nome.toLocaleLowerCase('pt-BR').startsWith(termo)) && !!termo) - Number((a.nome.toLocaleLowerCase('pt-BR').startsWith(termo)) && !!termo))
        .slice(0, 24);
      setProdutos(lista);
      setErroProdutos(falhaRede && todosLocais.length === 0
        ? (falhaRede?.response?.data?.error || 'Catálogo local vazio e servidor indisponível; conecte-se antes de operar.')
        : null);
    } catch (e: any) {
      setProdutos([]);
      setErroProdutos(e?.response?.data?.error || 'Não foi possível consultar o catálogo local.');
    } finally {
      setCarregandoProdutos(false);
    }
  }, [filialId, contextoPdv]);

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return; }
    void (async () => {
      const contexto = contextoLocalDoToken(getToken());
      if (!contexto) {
        setError('Não foi possível identificar a sessão do operador. Entre novamente.');
        return;
      }
      setContextoPdv(contexto);
      // Filiais do balcão.
      //
      // A rota `/filiais` não existia no backend, e o `catch` daqui era
      // MUDO: a lista ficava vazia, `filialId` continuava `''`, e o PDV
      // inteiro morria em silêncio — `carregarProdutos` sai em `if
      // (!filialId) return;` e o botão "Abrir caixa" fica desabilitado. O
      // usuário via um PDV "quebrado" sem nenhuma pista do motivo.
      //
      // Agora a falha é distinguível: erro de permissão/rede vira mensagem, e
      // lista vazia de verdade (empresa sem filial) também — porque a
      // solução é cadastrar a filial em Configurações  • Empresa.
      try {
        const { data } = await api.get<{ filiais?: Array<{ id: string; nome: string }> }>('/filiais');
        const lista = data?.filiais ?? [];
        setFiliais(lista);
        setErroFiliais(null);
        // Pré-seleciona quando há uma única filial: é o caso comum de quem
        // acabou de cadastrar a primeira, e obrigar o caixa a escolher um
        // item só possível não acrescenta nada.
        if (lista.length === 1) setFilialId(lista[0].id);
      } catch (e: any) {
        setFiliais([]);
        setErroFiliais(
          e?.response?.data?.error
            ? `Sem permissão para listar filiais (${e.response.data.error}).`
            : 'Não foi possível carregar as filiais.',
        );
      }
      const caixaInicial = await carregarCaixa(contexto);
      await recuperarOperacoesInterrompidas(contexto);
      const backendOnline = await backendAlcancavel(getApiBaseUrl());
      if (backendOnline) {
        await processarFila(enviarOperacaoPdv, contexto);
      }
      const fila = await contarPorStatus(contexto);
      setPendentesSync(fila.PENDENTE + fila.SINCRONIZANDO + fila.ERRO + fila.DIVERGENCIA);
      const carrinhoSalvo = await recuperarCarrinho(contexto);
      if (carrinhoSalvo) {
        const operacaoSalva = carrinhoSalvo.operacaoId ? await obterOperacao(carrinhoSalvo.operacaoId, contexto) : undefined;
        if (operacaoSalva?.status === 'CONFIRMADO') {
          await limparCarrinhoPersistido(contexto);
          setNotice(`Venda ${operacaoSalva.vendaIdRemota?.slice(0, 8) ?? ''} confirmada pelo servidor após recuperar a sessão.`);
        } else if (!carrinhoSalvo.operacaoId) {
          if (!caixaInicial || carrinhoSalvo.filialId === caixaInicial.filialId) {
            setCarrinho(carrinhoSalvo.itens.map((item) => ({ ...item, estoque: item.estoque ?? 0, imagem: item.imagem ?? undefined })));
            setFilialId(carrinhoSalvo.filialId);
            setClienteId(carrinhoSalvo.clienteId ?? '');
            setForma(carrinhoSalvo.forma);
            setDescontoGeral(String(carrinhoSalvo.descontoGeral));
            setValorRecebido(carrinhoSalvo.valorRecebido ?? '');
            setParcelas(String(carrinhoSalvo.parcelas ?? 1));
            setNotice('Carrinho recuperado localmente. Ele ainda não é uma venda confirmada.');
          }
        } else {
          setOperacaoCarrinhoPendente(carrinhoSalvo.operacaoId);
          setError(operacaoSalva
            ? `Venda ${operacaoSalva.status.toLowerCase()} em reconciliação. Não envie outra venda até o servidor confirmar o resultado. ${operacaoSalva.ultimoErro || ''}`
            : 'A recuperação do carrinho encontrou uma operação sem registro local correspondente. Bloqueamos novo envio para evitar venda duplicada; verifique o histórico do servidor.');
        }
      }
      try {
        const { data } = await api.get('/clientes');
        setClientes(data.clientes ?? data ?? []);
      } catch { /* cliente rápido é opcional */ }
      try {
        const { data } = await api.get('/categorias');
        setCategorias(Array.isArray(data) ? data : data.categorias ?? []);
      } catch { /* filtro por categoria é opcional */ }
    })().catch((erro: unknown) => {
      setError(erro instanceof Error ? erro.message : 'Não foi possível recuperar o estado do PDV.');
    }).finally(() => setLoading(false));
  }, [router, carregarCaixa]);

  useEffect(() => { if (caixa) void carregarProdutos(busca, categoriaId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [caixa, filialId, busca, categoriaId]);

  useEffect(() => {
    if (!contextoPdv) return;
    let ativo = true;
    const sincronizar = async () => {
      if (sincronizandoFilaRef.current || !estaOnline()) return;
      sincronizandoFilaRef.current = true;
      try {
        const online = await backendAlcancavel(getApiBaseUrl());
        if (!online) return;
        await recuperarOperacoesInterrompidas(contextoPdv);
        const resultados = await processarFila(enviarOperacaoPdv, contextoPdv);
        const estados = await contarPorStatus(contextoPdv);
        if (ativo) setPendentesSync(estados.PENDENTE + estados.SINCRONIZANDO + estados.ERRO + estados.DIVERGENCIA);
        const divergente = resultados.find((resultado) => resultado.status === 'DIVERGENCIA');
        if (ativo && divergente) setError(`Venda em divergência: ${divergente.erro || 'revisão necessária.'}`);
        if (ativo && operacaoCarrinhoPendente && resultados.some((resultado) => resultado.id === operacaoCarrinhoPendente && resultado.status === 'CONFIRMADO')) {
          await limparCarrinhoPersistido(contextoPdv);
          setOperacaoCarrinhoPendente(null);
          setNotice('A venda pendente foi confirmada pelo servidor após a reconexão.');
        }
        if (ativo && resultados.some((resultado) => resultado.status === 'CONFIRMADO')) {
          await Promise.all([carregarCaixa(contextoPdv), carregarProdutos(busca, categoriaId)]);
        }
        if (ativo) setModoOffline(false);
      } finally {
        sincronizandoFilaRef.current = false;
      }
    };
    const onOnline = () => { void sincronizar(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void sincronizar(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ativo = false;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [contextoPdv, carregarCaixa, carregarProdutos, busca, categoriaId, operacaoCarrinhoPendente]);

  useEffect(() => {
    if (loading || !contextoPdv || !filialId) return;
    if (carrinho.length === 0) {
      void limparCarrinhoPersistido(contextoPdv).catch(() => undefined);
      return;
    }
    void salvarCarrinho({
      ...contextoPdv,
      filialId,
      clienteId: clienteId || null,
      forma,
      descontoGeral: Number(descontoGeral) || 0,
      valorRecebido,
      parcelas: Number(parcelas) || 1,
      itens: carrinho,
    }).catch(() => setError('Não foi possível salvar a recuperação local do carrinho.'));
  }, [loading, contextoPdv, filialId, carrinho, clienteId, forma, descontoGeral, valorRecebido, parcelas]);

  // Relógio ao vivo do balcão (horário real do dispositivo)
  useEffect(() => {
    setAgora(new Date());
    const t = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!cupom || !imprimirCupomAoFinalizar || impressaoAutomaticaRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      impressaoAutomaticaRef.current = true;
      try {
        window.print();
      } catch {
        setError('A venda foi concluída, mas não foi possível iniciar a impressão. Use Imprimir no cupom para tentar novamente.');
      } finally {
        impressaoAutomaticaRef.current = false;
        setImprimirCupomAoFinalizar(false);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cupom, imprimirCupomAoFinalizar]);

  // Atalhos de balcão: F2 busca, F4 finalizar, F7 sangria/suprimento
  //
  // F4 checa `finalizando`: sem isso, apertar F4 duas vezes seguidas criava
  // DUAS vendas. A guarda antiga era `carrinho.length > 0`, que continua
  // verdadeiro durante o `await` do POST — o carrinho só é esvaziado no fim.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F2') { e.preventDefault(); buscaRef.current?.focus(); buscaRef.current?.select(); }
      else if (e.key === 'F4') {
        e.preventDefault();
        if (caixa && carrinho.length > 0 && !finalizandoRef.current) {
          if (forma === 'PIX') setMostrarPix(true);
          else void finalizarVenda();
        }
      }
      else if (e.key === 'F7') { e.preventDefault(); if (caixa) { setTipoMov('SANGRIA'); setMostrarSangria(true); } }
       else if (e.key === 'F8') { e.preventDefault(); if (caixa) { setTipoMov('SUPRIMENTO'); setMostrarSangria(true); } }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [caixa, carrinho.length, forma]);

  // ===== Ações de caixa =====
  async function abrirCaixa() {
    setError(null); setNotice(null);
    if (!filialId) { setError('Selecione a filial para abrir o caixa.'); return; }
    if (abrindoRef.current) return;
    abrindoRef.current = true;
    setAbrindo(true);
    try {
      await api.post('/pdv/caixa/abrir', { filialId, fundoTroco: Number(fundoTroco) || 0 });
      setMostrarAbrir(false);
      setNotice('Caixa aberto. Bom turno!');
      await carregarCaixa();
    } catch (err: any) { setError(err.response?.data?.error || 'Não foi possível abrir o caixa.'); }
    finally { abrindoRef.current = false; setAbrindo(false); }
  }

  async function movimentar() {
    setError(null); setNotice(null);
    if (movimentandoRef.current) return;
    try {
      const valor = Number(valorMov);
      if (!valor || valor <= 0) { setError('Informe um valor positivo.'); return; }
      movimentandoRef.current = true;
      setMovimentando(true);
      // IDEMPOT`NCIA (Módulo 10): chave estável por operação evita que clique
      // duplo, retry após timeout ou reconexão gerem DUAS sangrias/suprimentos.
      // O `movimentandoRef` já evita o envio simultâneo na mesma aba; a chave
      // protege também contra repetição após perda de resposta (o servidor
      // reconhece a repetição e devolve o resultado original sem reaplicar).
      const chave = novaIdempotencyKey(tipoMov === 'SANGRIA' ? 'sangria' : 'suprimento');
      await api.post('/pdv/caixa/movimentacoes', { tipo: tipoMov, valor, motivo: motivoMov || undefined }, { headers: { 'x-idempotency-key': chave } });
      setMostrarSangria(false); setValorMov(''); setMotivoMov('');
      setNotice(tipoMov === 'SANGRIA' ? 'Sangria registrada.' : 'Suprimento registrado.');
      await carregarCaixa();
    } catch (err: any) { setError(err.response?.data?.error || 'Não foi possível registrar a movimentação.'); }
    finally { movimentandoRef.current = false; setMovimentando(false); }
  }

  async function fecharCaixa() {
    setError(null); setNotice(null);
    if (fechandoRef.current) return;
    fechandoRef.current = true;
    setFechando(true);
    try {
      const { data } = await api.post('/pdv/caixa/fechar', {
        valorContado: valorContado === '' ? undefined : Number(valorContado),
        observacao: obsFechamento || undefined,
      });
      const d = data.diferenca;
      setMostrarFechar(false); setValorContado(''); setObsFechamento('');
      setNotice(d === null || d === undefined
        ? `Caixa fechado. Vendas do turno: ${brl(data.resumo?.totalVendas ?? 0)}.`
        : `Caixa fechado. Diferença em gaveta: ${brl(Number(d))} (contado ${brl(data.valorContado ? Number(data.valorContado) : 0)} vs esperado ${brl(data.resumo?.dinheiroEsperado ?? 0)}).`);
      setCarrinho([]); await carregarCaixa();
    } catch (err: any) { setError(err.response?.data?.error || 'Não foi possível fechar o caixa.'); }
    finally { fechandoRef.current = false; setFechando(false); }
  }

  // ===== Ações de venda =====
  function adicionarAoCarrinho(p: any) {
    // Calcula a transição FORA do updater (updater puro, sem efeito colateral).
    // Antes `setError` era chamado DENTRO de `setCarrinho((atual) => {...})`, o
    // que em StrictMode/atualizações repetidas poderia rodar o updater duas
    // vezes e produzir comportamento inconsistente. Agora o resultado vem da
    // função pura `adicionarProduto` e os dois `set` são independentes —
    // mesma mensagem de erro, mesmo estado do carrinho, sem efeito colateral.
    const r = adicionarProduto(carrinho, p);
    setError(r.erro);
    if (!r.erro) setCarrinho(r.itens);
  }

  async function buscarPorCodigo(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const termo = busca.trim();
    if (!termo) return;
    let achado = contextoPdv && filialId ? await resolverBipagem(contextoPdv.empresaId, filialId, termo) : undefined;
    if (!achado && contextoPdv && filialId && estaOnline()) {
      try {
        await atualizarCatalogoLocal(contextoPdv, filialId);
        achado = await resolverBipagem(contextoPdv.empresaId, filialId, termo);
      } catch { /* mantém a busca no catálogo local já disponível */ }
    }
    achado ??= produtos.find((p) =>
      (p.codigoBarras ?? '').toString() === termo ||
      (p.sku ?? '').toString().toLowerCase() === termo.toLowerCase());
    if (achado) { adicionarAoCarrinho(achado); setBusca(''); void carregarProdutos(''); }
    else void carregarProdutos(termo);
  }

  async function finalizarVenda(referenciaPagamento?: string) {
    setError(null); setNotice(null);
    if (!caixa) { setError('Abra o caixa antes de vender.'); return false; }
    if (carrinho.length === 0) { setError('Adicione ao menos um item.'); return false; }
    if (operacaoCarrinhoPendente) {
      setError('Esta venda já está na fila de sincronização. Aguarde a confirmação ou revise a divergência antes de tentar novamente.');
      return false;
    }
    if (descontoInformado < 0) { setError('O desconto da venda não pode ser negativo.'); return false; }
    if (descontoInformado > subtotal) { setError('O desconto não pode superar o subtotal.'); return false; }
    if (forma === 'DINHEIRO' && recebidoNum < total) { setError('Valor recebido menor que o total.'); return false; }
    if (forma === 'PIX' && !referenciaPagamento) { setError('Confirme o pagamento PIX no provider antes de registrar a venda.'); return false; }
    if (!['DINHEIRO', 'PIX'].includes(forma)) {
      setError('A integração de cartão/TEF ainda não está configurada. A venda não foi registrada.');
      return false;
    }
    // FASE 2 PDV PRO — barreira offline ANTES de enfileirar: sem backend
    // alcançável, só DINHEIRO entra na fila. PIX/cartão offline nunca viram
    // "venda pendente" — o operador é informado na hora, sem mudar o layout.
    if (!estaOnline() || !(await backendAlcancavel(getApiBaseUrl()))) {
      const avaliacao = avaliarFormaOffline(forma);
      if (!avaliacao.permitida) {
        setError(`Sem conexão com o servidor: ${avaliacao.motivo}`);
        return false;
      }
    }
    const contexto = contextoPdv ?? contextoLocalDoToken(getToken());
    if (!contexto) { setError('Sessão do operador indisponível. Entre novamente antes de vender.'); return false; }
    // Trava de reentrância. Sem isto, dois toques no F4 (ou no botão) criavam
    // DUAS vendas: `carrinho.length` não muda durante o `await`, então a
    // guarda do atalho continuava valendo. Agora a segunda chamada sai aqui.
    if (finalizandoRef.current) return false;
    finalizandoRef.current = true;
    setFinalizando(true);
    try {
      const id = novoId();
      const payload = {
        filialId, clienteId: clienteId || undefined,
        formaPagamento: forma.toUpperCase(),
        desconto: descontoNum,
        parcelas: Number(parcelas) || 1,
        caixaId: caixa.id,
        origem: 'PDV',
        itens: carrinho.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade, desconto: i.desconto })),
        ...(total > 0 ? { pagamentos: [{ forma: forma.toUpperCase(), valor: total, ...(referenciaPagamento ? { referencia: referenciaPagamento } : {}) }] } : {}),
      };
      const operacao = await enfileirarVendaComCarrinho({
        id,
        empresaId: contexto.empresaId,
        usuarioId: contexto.usuarioId,
        tipo: 'VENDA',
        payload,
        idempotencyKey: novaIdempotencyKey('venda'),
      }, {
        ...contexto,
        filialId,
        clienteId: clienteId || null,
        forma,
        descontoGeral: descontoNum,
        valorRecebido,
        parcelas: Number(parcelas) || 1,
        itens: carrinho,
      });
      setOperacaoCarrinhoPendente(operacao.id);

      const podeEnviarAgora = estaOnline() && await backendAlcancavel(getApiBaseUrl());
      let resultados: Awaited<ReturnType<typeof processarFila>> = [];
      if (podeEnviarAgora) resultados = await processarFila(enviarOperacaoPdv, contexto);
      const estadoFinal = await obterOperacao(operacao.id, contexto);
      const resultadoAtual = resultados.find((resultado) => resultado.id === operacao.id);
      if (estadoFinal?.status !== 'CONFIRMADO') {
        const fila = await contarPorStatus(contexto);
        setPendentesSync(fila.PENDENTE + fila.SINCRONIZANDO + fila.ERRO + fila.DIVERGENCIA);
        if (estadoFinal?.status === 'DIVERGENCIA') {
          setError(`Venda não confirmada; divergência requer revisão: ${estadoFinal.ultimoErro || 'verifique estoque, caixa e permissões.'}`);
          return false;
        }
        // The durable queue now owns the sale. Clear the working cart so it
        // cannot be resubmitted under a new key while this request is unknown.
        setOperacaoCarrinhoPendente(null);
        setCarrinho([]); setDescontoGeral('0'); setClienteId(''); setValorRecebido(''); setParcelas('1'); setBusca('');
        setNotice(`VENDA PENDENTE DE SINCRONIZAÇÃO. Ainda não está confirmada no servidor. Chave ${operacao.idempotencyKey.slice(0, 18)}⬦`);
        return false;
      }

      const data = (resultadoAtual?.resposta ?? null) as any;
      if (!data?.venda?.id) {
        setError(`Venda ${estadoFinal.vendaIdRemota ?? ''} confirmada no servidor. O comprovante será recuperável pelo histórico após atualizar a conexão.`);
        setOperacaoCarrinhoPendente(null);
        setCarrinho([]); setDescontoGeral('0'); setClienteId(''); setValorRecebido(''); setParcelas('1'); setBusca('');
        return true;
      }
      const itensCupom = carrinho.map((i) => ({ nome: i.nome, quantidade: i.quantidade, total: i.preco * i.quantidade - i.desconto }));
      setCupom({
        id: data.venda.id, criadoEm: data.venda.createdAt ?? new Date().toISOString(),
        filialNome: filiais.find((f) => f.id === filialId)?.nome ?? '',
        // O nome do operador. Antes ia `caixa.usuarioId` e o cupom imprimia os
        // 8 primeiros caracteres de um cuid ("clx8f2k1") em vez de "Maria
        // Souza" — o `GET /pdv/caixa/atual` já devolve `usuario.nome` e ele
        // estava sendo ignorado. O cupom é o documento que fica com o cliente.
        operador: caixa.usuario?.nome ?? caixa.usuarioId ?? 'Operador',
        itens: itensCupom,
        subtotal, desconto: descontoNum, total: Number(data.venda.total), forma, parcelas, troco,
      });
      setCarrinho([]); setDescontoGeral('0'); setClienteId(''); setValorRecebido(''); setParcelas('1');
      setOperacaoCarrinhoPendente(null);
      setBusca('');
      setNotice(`Venda confirmada no servidor: ${brl(Number(data.venda.total))}.`);
      const fila = await contarPorStatus(contexto);
      setPendentesSync(fila.PENDENTE + fila.SINCRONIZANDO + fila.ERRO + fila.DIVERGENCIA);
      await Promise.all([carregarCaixa(), carregarProdutos(busca)]);
      return true;
    } catch (err: any) {
      setError(err.response?.data?.error || 'A venda foi preservada localmente; aguarde a sincronização antes de reenviar.');
      return false;
    } finally {
      finalizandoRef.current = false;
      setFinalizando(false);
    }
  }

  /**
   * Cancelamento de venda — CONFIRMAÇÃO OBRIGATÓRIA.
   *
   * O botão era um `onClick` cru: um toque executava `POST /vendas/:id/cancelar`,
   * que numa única transação devolve estoque, marca o financeiro como
   * CANCELADO, reduz faturamento e ticket médio do dia, reduz meta realizada,
   * recalcula agregados do cliente e RETIRA DINHEIRO DA GAVETA. Sem confirmação
   * e sem volta — não existe como desfazer. Em touchscreen de balcão, um toque
   * errado destrói a venda de forma irreversível.
   *
   * A aba Vendas já tinha um modal com motivo obrigatório e escolha de
   * estorno; aqui a proteção é uma confirmação nativa, que não altera o layout.
   */
  async function cancelarVenda(vendaId: string) {
    setError(null); setNotice(null);
    if (cancelandoRef.current) return;
    const ok = window.confirm(
      'Cancelar esta venda?\n\n' +
      'O que será desfeito, em uma única operação:\n' +
      '  ⬢ o estoque volta ao depósito;\n' +
      '  ⬢ a receita é marcada como cancelada;\n' +
      '  ⬢ faturamento, ticket médio e meta do dia são reduzidos;\n' +
      '  ⬢ se foi paga em dinheiro, o valor SAI da gaveta do turno.\n\n' +
      'Esta ação não pode ser desfeita.'
    );
    if (!ok) return;
    cancelandoRef.current = true;
    setCancelando(vendaId);
    try {
      // `motivo` é opcional no backend, mas fica na movimentação de estoque e
      // na auditoria: sem ele, o estorno aparece como "Cancelamento venda <id>"
      // e não dá para saber depois quem/por que cancelou no balcão.
      await api.post(`/vendas/${vendaId}/cancelar`, { motivo: `Cancelado no balcão (PDV) por ${caixa?.usuario?.nome ?? 'operador'}` });
      setNotice('Venda cancelada: estoque devolvido e gaveta ajustada.');
      await Promise.all([carregarCaixa(), carregarProdutos(busca)]);
    } catch (err: any) { setError(err.response?.data?.error || 'Não foi possível cancelar a venda.'); }
    finally { cancelandoRef.current = false; setCancelando(null); }
  }
  function limparCarrinho() { setCarrinho([]); setDescontoGeral('0'); setValorRecebido(''); }

  function abrirCupomMaisRecente() {
    setMostrarMenu(false);
    setError(null);
    const venda = vendasTurno.find((item: any) => item.status === 'FINALIZADA');
    const cupomRecuperado = cupomDaVenda(venda, caixa?.filial?.nome ?? '', caixa?.usuario?.nome ?? caixa?.usuarioId ?? 'Operador');
    if (!cupomRecuperado) {
      setNotice('Não há cupom de venda finalizada disponível neste turno.');
      return;
    }
    setCupom(cupomRecuperado);
  }


  if (loading) {
    return (
      <main className="admin-page">
        <ModuleHeader title="PDV" />
        <p className="empty-state">Carregando...</p>
      </main>
    );
  }

  return (
    <main className="pdv-root" style={{ minHeight: '100vh', background: 'radial-gradient(720px 340px at 88% -8%, rgba(124,58,237,.16), transparent 62%), radial-gradient(560px 300px at -6% 108%, rgba(99,102,241,.10), transparent 60%), var(--nexus-bg)', color: 'var(--nexus-text)', paddingBottom: 24 }}>
      <style>{pdvCss}</style>
      {/* ===== Header balcão (fiel à base) ===== */}
      <header className="pdv-glass pdv-noprint" style={{ position: 'sticky', top: 0, zIndex: 40, display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', background: 'var(--nexus-panel)', borderBottom: '1px solid var(--nexus-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span aria-hidden className="pdv-logo" style={{ display: 'inline-flex', width: 42, height: 42, borderRadius: 12, background: '#7c3aed', color: '#fff', fontSize: 20, fontWeight: 800, alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 18px rgba(124,58,237,0.45)' }}>N</span>
          <span style={{ lineHeight: 1.2 }}>
            <strong style={{ fontSize: 17 }}>NEXUS OS <span style={{ opacity: 0.5, fontWeight: 500 }}>PDV</span></strong>
            <span style={{ display: 'block', fontSize: 10, letterSpacing: 2.5, opacity: 0.45 }}>TERMINAL 01</span>
          </span>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 15px', borderRadius: 999, border: `1px solid ${!caixa && erroCaixa ? 'rgba(245,158,11,0.4)' : caixa ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`, background: !caixa && erroCaixa ? 'rgba(245,158,11,0.10)' : caixa ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)', color: !caixa && erroCaixa ? '#fbbf24' : caixa ? '#34d399' : '#f87171', fontSize: 12.5, fontWeight: 800, letterSpacing: 0.5 }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: !caixa && erroCaixa ? '#fbbf24' : caixa ? '#34d399' : '#f87171' }} />
          {!caixa && erroCaixa ? 'CAIXA INDISPONÍVEL' : caixa ? 'CAIXA ABERTO' : 'CAIXA FECHADO'}
        </span>
        {caixa && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span aria-hidden style={{ display: 'inline-flex', width: 36, height: 36, borderRadius: '50%', background: 'var(--nexus-panel-2)', border: '1px solid var(--nexus-border)', color: 'var(--nexus-text)', fontSize: 12, fontWeight: 700, alignItems: 'center', justifyContent: 'center' }}>
              {(caixa.usuario?.nome ?? 'OP').split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase()}
            </span>
            <span style={{ lineHeight: 1.25, fontSize: 14 }}>
              <strong style={{ display: 'block' }}>{caixa.usuario?.nome ?? caixa.usuarioId}</strong>
            </span>
          </span>
        )}
        {/* Relógio do balcão.
            Antes ficava DENTRO de `{caixa && ⬦}`, então só aparecia com o caixa
            aberto — era por isso que o PDV "não mostra horário". Agora é
            independente do caixa e usa o formato 12h/24h escolhido em
            Configurações. */}
        <span
          aria-label="Horário atual"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}
        >
          <span aria-hidden>x"</span>
          {agora ? formatClock(agora) : '--:--:--'}
        </span>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', position: 'relative' }}>
          {!caixa && (
            <>
              {/* O seletor sozinho não contava a história: quando a lista vinha
                  vazia, aparecia só "Filial⬦" com o botão "Abrir caixa" cinza e
                  nenhuma explicação. Agora o próprio campo diz o que houve. */}
              {filiais.length === 0 ? (
                <span
                  role="status"
                  style={{
                    padding: '9px 12px',
                    borderRadius: 10,
                    background: erroFiliais ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
                    border: `1px solid ${erroFiliais ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
                    color: erroFiliais ? '#fca5a5' : '#fcd34d',
                    fontSize: 12.5,
                  }}
                >
                  {erroFiliais ?? 'Nenhuma filial cadastrada. Cadastre em Configurações  • Empresa.'}
                </span>
              ) : (
                <select value={filialId} onChange={(e) => setFilialId(e.target.value)} style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--nexus-panel-2)', border: '1px solid var(--nexus-border)', color: 'var(--nexus-text)', fontSize: 13 }}>
                  <option value="">Filial⬦</option>
                  {filiais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              )}
                  <button className="admin-primary pdv-btn-grad" type="button" onClick={() => setMostrarAbrir(true)} disabled={!filialId || filiais.length === 0 || Boolean(erroCaixa)} style={{ padding: '9px 18px' }}>Abrir caixa</button>
            </>
          )}
          <button type="button" aria-label="Integrações" onClick={() => setMostrarMenu((v) => !v)}
            style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--nexus-panel-2)', border: '1px solid var(--nexus-border)', color: 'var(--nexus-text)', fontSize: 16, cursor: 'pointer' }}>a"</button>
          {mostrarMenu && (
              <div className="admin-panel" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 30, minWidth: 280, padding: 10, boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}>
                <h2 style={{ marginBottom: 8 }}>MÓDULOS DO SISTEMA</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button type="button" className="admin-secondary" style={{ textAlign: 'left' }} disabled={!caixa && Boolean(erroCaixa)} onClick={() => { setMostrarMenu(false); if (caixa) setMostrarFechar(true); else if (!erroCaixa) setMostrarAbrir(true); }}>xa Abrir PDV</button>
                  <button type="button" className="admin-secondary" style={{ textAlign: 'left' }} onClick={abrirCupomMaisRecente}>🖨️ Impressora Térmica (cupom)</button>
                  <button type="button" className="admin-secondary" style={{ textAlign: 'left' }} onClick={() => { setMostrarMenu(false); buscaRef.current?.focus(); }}>📷` Leitor Código de Barras</button>
                  <button type="button" className="admin-secondary" style={{ textAlign: 'left' }} onClick={() => { setMostrarMenu(false); document.getElementById('pdv-integracoes')?.scrollIntoView({ behavior: 'smooth' }); }}>{'</>'} API Integração</button>
                  <button type="button" className="admin-secondary" style={{ textAlign: 'left' }} onClick={() => { setMostrarMenu(false); document.getElementById('pdv-integracoes')?.scrollIntoView({ behavior: 'smooth' }); }}>🛒 R Webhooks</button>
                  <p style={{ fontSize: 11, opacity: 0.6, margin: '4px 0 0' }}>💰 Balança · 🖨️ Maquininha (TEF) · 🏦 SAT Fiscal: integração somente via API/SDK oficial do fabricante — configurável na seção Integrações & PDVs abaixo.</p>
                  <p style={{ fontSize: 10.5, opacity: 0.8, margin: '8px 0 0', fontFamily: 'monospace', color: modoOffline ? '#fbbf24' : apiOk ? '#34d399' : '#f87171' }}>API: /pdv/caixa/atual — {modoOffline ? `OFFLINE · ${pendentesSync} pendente(s)/revisão` : apiOk === false ? 'INDISPONÍVEL' : '200 OK'}</p>
                </div>
              </div>
            )}
        </div>
      </header>

      {error && <p className="admin-message admin-error pdv-noprint" style={{ margin: '14px 24px 0' }}>{error}</p>}
      {notice && <p className="admin-message admin-success pdv-noprint" style={{ margin: '14px 24px 0' }}>{notice}</p>}
      {/* Erro de caixa: antes ele não existia — uma falha de permissão virava
          "CAIXA FECHADO" sem explicação. Usa a mesma faixa das outras
          mensagens (mesmo estilo, mesma posição) para não mudar o layout. */}
      {erroCaixa && <p className="admin-message admin-error pdv-noprint" style={{ margin: '14px 24px 0' }}>{erroCaixa}</p>}
      {!caixa && (
        <p className="admin-message pdv-noprint" style={{ margin: '14px 24px 0', opacity: 0.8 }}>📦 Caixa fechado — selecione a filial no topo e clique em <strong>Abrir caixa</strong> para começar a vender.</p>
      )}

      <div className="pdv-grid pdv-noprint">
          <section className="admin-panel">
            <h2>{traduzir('produtos', "Produtos")}</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input ref={buscaRef} value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={buscarPorCodigo} placeholder="Nome, SKU ou código de barras⬦ (Enter adiciona)" style={{ width: '100%', height: 44, borderRadius: 12, paddingRight: 52 }} />
                <span aria-hidden style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontWeight: 800, padding: '3px 7px', borderRadius: 6, background: 'rgba(139,92,246,.18)', border: '1px solid rgba(139,92,246,.4)', color: 'var(--nexus-accent-2)' }}>F2</span>
              </div>
              <button type="button" aria-label="Focar busca por código" className="admin-primary pdv-btn-grad" style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, padding: 0 }} onClick={() => buscaRef.current?.focus()}>R"</button>
            </div>
            {categorias.length > 0 && (
              <div className="pdv-scroll" style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
                <button type="button" className={categoriaId === '' ? 'admin-primary pdv-btn-grad' : 'admin-secondary pdv-chip'} style={{ padding: '5px 14px', flexShrink: 0 }} onClick={() => setCategoriaId('')}>{traduzir('todos', "Todos")}</button>
                {categorias.map((c: any) => (
                  <button key={c.id} type="button" className={categoriaId === c.id ? 'admin-primary pdv-btn-grad' : 'admin-secondary pdv-chip'} style={{ padding: '5px 14px', flexShrink: 0 }} onClick={() => setCategoriaId(c.id)}>{c.nome}</button>
                ))}
              </div>
            )}
            {/* P11: o motivo da falha aparece no lugar do grid. Antes o `catch`
               era mudo e a falta de permissão (`produtos:visualizar`) era
               indistinguível de "não há produtos". As duas mensagens de vazio
               também foram separadas: sem busca ativa, "nenhum produto
               cadastrado" é a informação certa. */}
            {carregandoProdutos ? (
              <p className="empty-state">Carregando produtos⬦</p>
            ) : erroProdutos ? (
              <p className="empty-state" style={{ color: '#f87171' }}>{erroProdutos}</p>
            ) : produtos.length === 0 ? (
              <p className="empty-state">
                {(busca || categoriaId) ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado nesta filial.'}
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(172px,1fr))', gap: 12 }}>
                {produtos.map((p: any) => (
                  <button key={p.id} type="button" className="admin-secondary pdv-card" style={{ textAlign: 'left', padding: 10 }} onClick={() => adicionarAoCarrinho(p)}>
                    <span style={{ position: 'relative', display: 'block', aspectRatio: '4 / 3', borderRadius: 10, marginBottom: 8, overflow: 'hidden', background: 'linear-gradient(135deg, rgba(124,58,237,.18), rgba(124,58,237,.06))' }}>
                      {p.imagem ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imagem} alt={p.nome} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span aria-hidden style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>📷</span>
                      )}
                      {String(p.codigoBarras ?? '') !== '' && (
                        <span aria-hidden style={{ position: 'absolute', left: 6, top: 6, fontSize: 9.5, fontWeight: 700, padding: '3px 6px', borderRadius: 6, background: 'rgba(10,9,15,.78)', border: '1px solid rgba(255,255,255,.14)', color: '#e5e7eb', fontFamily: 'monospace' }}> {String(p.codigoBarras).slice(-4)}</span>
                      )}
                      <span aria-hidden style={{ position: 'absolute', right: 6, top: 6, fontSize: 9.5, fontWeight: 800, padding: '3px 7px', borderRadius: 999, background: p.estoqueFilial > 10 ? 'rgba(16,185,129,.16)' : p.estoqueFilial > 0 ? 'rgba(245,158,11,.16)' : 'rgba(239,68,68,.16)', border: `1px solid ${p.estoqueFilial > 10 ? 'rgba(16,185,129,.45)' : p.estoqueFilial > 0 ? 'rgba(245,158,11,.45)' : 'rgba(239,68,68,.45)'}`, color: p.estoqueFilial > 10 ? '#34d399' : p.estoqueFilial > 0 ? '#fbbf24' : '#f87171' }}>{p.estoqueFilial} unidade${p.estoqueFilial !== 1 ? 's' : ''}</span>
                    </span>
                    <strong style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 13, lineHeight: 1.25, minHeight: 33 }}>{p.nome}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                      <span className="pdv-price" style={{ fontSize: 14 }}>{brl(precoVigente(p))}</span>
                      <span aria-hidden className="pdv-plus" style={{ display: 'inline-flex', width: 32, height: 32, borderRadius: 9, color: '#fff', fontWeight: 800, fontSize: 18, alignItems: 'center', justifyContent: 'center' }}>+</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="admin-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <h2 style={{ margin: 0 }}>Carrinho {carrinho.length > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, padding: '3px 9px', borderRadius: 999, background: 'rgba(139,92,246,.16)', border: '1px solid rgba(139,92,246,.4)', color: 'var(--nexus-accent-2)', marginLeft: 6 }}>
                    {carrinho.length} itens ⬢ {carrinho.reduce((s, i) => s + i.quantidade, 0)} un
                  </span>
                )}</h2>
                {carrinho.length > 0 && (
                  <button type="button" className="admin-secondary" style={{ padding: '5px 12px', fontSize: 12, flexShrink: 0 }} onClick={() => { setCarrinho([]); setDescontoGeral('0'); }}>{traduzir('limpar', "Limpar")}</button>
                )}
              </div>
              {carrinho.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '20px 10px', textAlign: 'center' }}>
                  <span aria-hidden style={{ width: 64, height: 64, borderRadius: 14, border: '1.5px dashed var(--nexus-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, opacity: 0.6 }}>x:•</span>
                  <span style={{ fontSize: 12.5, opacity: 0.6 }}>Busque e adicione produtos (F2)</span>
                </div>
              ) : (
                <div className="admin-table" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                  {carrinho.map((i) => (
                    <div key={i.produtoId} className="admin-list-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span aria-hidden style={{ width: 44, height: 44, borderRadius: 8, overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, rgba(124,58,237,.18), rgba(124,58,237,.06))', fontSize: 18 }}>
                        {i.imagem ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={i.imagem} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : '📷'}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.nome}</strong>
                        <span style={{ fontFamily: 'monospace', fontSize: 11.5, opacity: 0.75 }}>{brl(i.preco)} × {i.quantidade} = <strong style={{ color: 'var(--nexus-accent-2)' }}>{brl(i.preco * i.quantidade - i.desconto)}</strong></span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                        <button type="button" className="admin-secondary" style={{ width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setCarrinho((a) => alterarQuantidade(a, i.produtoId, Math.max(1, i.quantidade - 1)).itens)}>•</button>
                        <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{i.quantidade}</span>
                        <button type="button" className="admin-secondary pdv-btn-grad" style={{ width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} disabled={i.quantidade >= i.estoque} onClick={() => setCarrinho((a) => alterarQuantidade(a, i.produtoId, i.quantidade + 1).itens)}>+</button>
                        <button type="button" className="admin-secondary" style={{ width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#f87171' }} onClick={() => setCarrinho((a) => removerProduto(a, i.produtoId))}>×"</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <label style={{ fontSize: 11, opacity: 0.65, display: 'block', marginTop: 10 }}>
                CLIENTE (OPCIONAL)
                <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={{ width: '100%', marginTop: 4, fontSize: 13 }}>
                  <option value="">Consumidor final</option>
                  {clientes.map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </label>

              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--nexus-border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ opacity: 0.75 }}>{traduzir('subtotal', "Subtotal")}</span>
                  <span style={{ fontFamily: 'monospace' }}>{brl(subtotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ opacity: 0.75 }}>Desconto (R$)</span>
                  <input type="number" min="0" step="0.01" value={descontoGeral} onChange={(e) => setDescontoGeral(e.target.value)} style={{ width: 96, padding: '6px 10px', fontSize: 13, textAlign: 'right' }} />
                </div>
                {descontoInvalido && <p role="alert" style={{ margin: '-6px 0 0', color: '#fbbf24', fontSize: 11.5 }}>{descontoInformado < 0 ? 'O desconto não pode ser negativo.' : 'O desconto não pode superar o subtotal.'}</p>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <span style={{ fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', opacity: 0.6 }}>{traduzir('total', "Total")}</span>
                  <strong className="pdv-total">{brl(total)}</strong>
                </div>

                <div>
                  <p style={{ margin: '0 0 6px', fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', opacity: 0.6 }}>Forma de pagamento</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                    {FORMAS.map((f) => (
                      <button key={f} type="button" className={forma === f ? 'admin-primary pdv-btn-grad' : 'admin-secondary'} style={{ padding: '8px 4px', fontSize: 12, borderRadius: 10 }} onClick={() => setForma(f)}>
                        <span aria-hidden style={{ display: 'block', fontSize: 15, marginBottom: 2 }}>{f === 'DINHEIRO' ? 'x•' : f === 'PIX' ? 'a' : f === 'CARTAO_CREDITO' ? 'x•' : f === 'CARTAO_DEBITO' ? 'x' : 'x'}</span>
                        {f === 'DINHEIRO' ? 'Dinheiro' : f === 'PIX' ? 'PIX' : f === 'CARTAO_CREDITO' ? 'Crédito' : f === 'CARTAO_DEBITO' ? 'Débito' : 'Boleto'}
                      </button>
                    ))}
                  </div>
                </div>

                {forma === 'CARTAO_CREDITO' && (
                  <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    Parcelas
                    <select value={parcelas} onChange={(e) => setParcelas(e.target.value)}>
                      {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}× de {brl(total / n)}</option>)}
                    </select>
                  </label>
                )}

                {forma === 'DINHEIRO' && (
                  <>
                    <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Valor recebido (R$)
                      <input type="number" min="0" step="0.01" value={valorRecebido} onChange={(e) => setValorRecebido(e.target.value)} placeholder="0,00" style={{ fontSize: 15, fontWeight: 700 }} />
                    </label>
                    <div style={{ padding: '10px 12px', borderRadius: 12, background: recebidoNum >= total ? 'rgba(16,185,129,.10)' : 'rgba(245,158,11,.10)', border: `1px solid ${recebidoNum >= total ? 'rgba(16,185,129,.4)' : 'rgba(245,158,11,.4)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {recebidoNum >= total ? (
                        <>
                          <span style={{ color: '#34d399', fontWeight: 700, fontSize: 13 }}>Troco</span>
                          <strong style={{ color: '#34d399', fontFamily: 'monospace', fontSize: 17 }}>{brl(troco)}</strong>
                        </>
                      ) : (
                        <>
                          <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: 13 }}>Faltam</span>
                          <strong style={{ color: '#fbbf24', fontFamily: 'monospace', fontSize: 17 }}>{brl(Math.max(0, total - recebidoNum))}</strong>
                        </>
                      )}
                    </div>
                  </>
                )}

                <button className="admin-primary pdv-btn-grad" type="button" style={{ width: '100%', height: 48, fontSize: 14.5, letterSpacing: 0.6, borderRadius: 12 }}
                  disabled={finalizando || !!operacaoCarrinhoPendente || carrinho.length === 0 || descontoInvalido || (forma === 'DINHEIRO' && recebidoNum < total)}
                  onClick={() => { if (finalizando) return; if (forma === 'PIX') setMostrarPix(true); else void finalizarVenda(); }}>
                  {finalizando
                    ? 'Registrando⬦'
                    : forma === 'PIX' ? `PIX QR CODE ⬢ ${brl(total)}` : `FINALIZAR VENDA ⬢ ${brl(total)}`}
                </button>
                {mostrarPix && (
                  <PixQrCodeModal
                    valor={total}
                    onClose={() => setMostrarPix(false)}
                    onPago={async (txid) => {
                      setForma('PIX');
                      const vendaGravada = await finalizarVenda(txid);
                      if (!vendaGravada) throw new Error('Pagamento confirmado, mas a venda não foi gravada. Tente novamente ou confira as vendas do turno antes de fechar esta janela.');
                      setMostrarPix(false);
                      setImprimirCupomAoFinalizar(true);
                    }}
                  />
                )}

                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="admin-secondary" style={{ padding: '4px 10px', fontSize: 11 }} disabled={!caixa} onClick={() => { setTipoMov('SANGRIA'); setMostrarSangria(true); }}>F7 Sangria</button>
                  <button type="button" className="admin-secondary" style={{ padding: '4px 10px', fontSize: 11 }} disabled={!caixa} onClick={() => { setTipoMov('SUPRIMENTO'); setMostrarSangria(true); }}>F8 Suprimento</button>
                  <button type="button" className="admin-secondary" style={{ padding: '4px 10px', fontSize: 11, color: '#f87171' }} disabled={!caixa || fechando} onClick={() => setMostrarFechar(true)}>Fechar Caixa</button>
                </div>
              </div>
            </section>

            <section className="admin-panel">
              <h2>Turno do caixa</h2>
              {resumo ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12.5, opacity: 0.85 }}>
                  <span>Fundo de troco: <strong>{brl(resumo.fundoTroco)}</strong></span>
                  <span>Suprimentos: <strong>{brl(resumo.suprimentos)}</strong></span>
                  {/* Sangrias e estornos vêm separados de propósito. O
                      cancelamento de uma venda em dinheiro grava uma
                      movimentação do tipo SANGRIA no caixa (vendas.routes.ts),
                      e antes ela entrava na MESMA linha: o operador via
                      "Sangrias: R$ 500" sem nunca ter tirado dinheiro, e é
                      esse número que cai nele num fechamento contestado. */}
                  <span>Sangrias: <strong>{brl(resumo.sangrias)}</strong></span>
                  {Number(resumo.estornos) > 0 && (
                    <span style={{ opacity: 0.75 }} title="Gerado automaticamente ao cancelar vendas pagas em dinheiro — não foi retirada manual.">Estornos (vendas canceladas): <strong>{brl(resumo.estornos)}</strong></span>
                  )}
                  {/* O contador vem do resumo, que conta só FINALIZADA; a
                      lista abaixo mostra também as canceladas. Exibir os dois
                      números ao lado torna visível a diferença em vez de
                      deixar os dois discordarem em silêncio. */}
                  <span style={{ gridColumn: '1 / -1' }}>Vendas em dinheiro: <strong>{brl(resumo.dinheiroVendas)}</strong>{Number(resumo.qtdVendas) > 0 ? ` · ${resumo.qtdVendas} venda${resumo.qtdVendas !== 1 ? 's' : ''} finalizada${resumo.qtdVendas !== 1 ? 's' : ''}` : ''}</span>
                  <span style={{ gridColumn: '1 / -1' }}>
                    Esperado em gaveta: <strong>{brl(resumo.dinheiroEsperado)}</strong>
                    {Number(resumo.saldoRegistrado) !== Number(resumo.dinheiroEsperado) && (
                      <span style={{ opacity: 0.7 }}> · registrado: {brl(resumo.saldoRegistrado)}</span>
                    )}
                  </span>
                </div>
              ) : <p className="empty-state">Sem resumo do turno.</p>}
            </section>

            <section className="admin-panel">
              <h2>Vendas do turno</h2>
              {erroVendasTurno ? <p className="admin-message admin-error">{erroVendasTurno}</p> : vendasTurno.length === 0 ? <p className="empty-state">Nenhuma venda neste turno ainda.</p> : (
                <div className="admin-table">
                  {vendasTurno.map((v: any) => (
                    <div key={v.id} className="admin-list-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <strong>#{v.id.slice(-5)} · {brl(Number(v.total))} · {ROTULO_FORMA[v.formaPagamento] ?? v.formaPagamento}</strong>
                        <span>{new Date(v.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {v.itens?.length ?? 0} item${(v.itens?.length ?? 0) !== 1 ? 's' : ''}{v.cliente ? ` · ${v.cliente.nome}` : ''} · {v.status}</span>
                      </div>
                      {v.status === 'FINALIZADA' && (
                        // O botão reflecte o cancelamento em curso para que
                        // dois toques não disparem duas requisições (o
                        // `cancelando` já trava a função, mas o operador
                        // precisa VER que o clique foi aceito).
                        <button type="button" className="admin-secondary" disabled={cancelando === v.id} style={{ padding: '4px 10px', flexShrink: 0, opacity: cancelando === v.id ? 0.5 : 1 }} onClick={() => cancelarVenda(v.id)}>
                          {cancelando === v.id ? 'Cancelando⬦' : traduzir('cancelar', "Cancelar")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

      <section className="admin-panel admin-wide pdv-noprint" id="pdv-integracoes">
        <h2>Integrações PDV (seção 14 — API oficial apenas)</h2>
        <p style={{ fontSize: 12.5, opacity: 0.7 }}>Apenas integra via API, SDK, webhook ou banco oficialmente autorizado pelo fabricante — nunca simula dados de sincronização.</p>
        <IntegracoesPDV />
      </section>

      {/* Rodapé do balcão — apenas dados reais do turno */}
      <footer className="admin-panel admin-wide pdv-noprint" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ letterSpacing: 0.4 }}><span style={{ opacity: 0.55, textTransform: 'uppercase', fontSize: 10.5 }}>Vendas do turno:</span> <strong style={{ fontFamily: 'monospace' }}>{resumo?.qtdVendas ?? 0} ⬢ {brl(Number(resumo?.totalVendas ?? 0))}</strong></span>
        <span style={{ letterSpacing: 0.4 }}><span style={{ opacity: 0.55, textTransform: 'uppercase', fontSize: 10.5 }}>Ticket médio:</span> <strong style={{ fontFamily: 'monospace' }}>{brl(resumo && Number(resumo.qtdVendas) > 0 ? Number(resumo.totalVendas) / Number(resumo.qtdVendas) : 0)}</strong></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: modoOffline ? '#fbbf24' : apiOk ? '#34d399' : '#f87171', fontFamily: 'monospace', fontSize: 11 }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: modoOffline ? '#fbbf24' : apiOk ? '#34d399' : '#f87171' }} />
          API /pdv/caixa/resumo ⬢ {modoOffline ? `OFFLINE · ${pendentesSync} pendente(s)/revisão` : apiOk ? 'LIVE' : 'INDISPONÍVEL'}
        </span>
      </footer>

      {/* Modais */}
      {mostrarAbrir && (
        <Modal titulo="Abrir caixa" onFechar={() => setMostrarAbrir(false)}>
          <label style={estiloLabel}>Fundo de troco (R$)
            <input type="number" min="0" step="0.01" value={fundoTroco} onChange={(e) => setFundoTroco(e.target.value)} autoFocus />
          </label>
          <button className="admin-primary" type="button" style={{ width: '100%' }} disabled={abrindo} onClick={abrirCaixa}>{abrindo ? 'Abrindo⬦' : 'Abrir caixa'}</button>
        </Modal>
      )}
      {mostrarSangria && (
        <Modal titulo={tipoMov === 'SANGRIA' ? 'Sangria — retirada de dinheiro' : 'Suprimento — entrada de dinheiro'} onFechar={() => setMostrarSangria(false)}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" className={tipoMov === 'SANGRIA' ? 'admin-primary' : 'admin-secondary'} style={{ flex: 1 }} onClick={() => setTipoMov('SANGRIA')}>Sangria</button>
            <button type="button" className={tipoMov === 'SUPRIMENTO' ? 'admin-primary' : 'admin-secondary'} style={{ flex: 1 }} onClick={() => setTipoMov('SUPRIMENTO')}>Suprimento</button>
          </div>
          <label style={estiloLabel}>Valor (R$)
            <input type="number" min="0.01" step="0.01" value={valorMov} onChange={(e) => setValorMov(e.target.value)} autoFocus />
          </label>
          <label style={estiloLabel}>Motivo (opcional)
            <input value={motivoMov} onChange={(e) => setMotivoMov(e.target.value)} maxLength={200} placeholder="ex.: retirada para depósito" />
          </label>
          <button className="admin-primary" type="button" style={{ width: '100%' }} disabled={movimentando} onClick={movimentar}>{movimentando ? 'Registrando⬦' : 'Confirmar'}</button>
        </Modal>
      )}
      {mostrarFechar && (
        <Modal titulo="Fechar caixa" onFechar={() => setMostrarFechar(false)}>
          {resumo && <p style={{ fontSize: 12.5, opacity: 0.8, marginBottom: 12 }}>Dinheiro esperado em gaveta: <strong>{brl(resumo.dinheiroEsperado)}</strong></p>}
          <label style={estiloLabel}>Valor contado na gaveta (R$) — opcional
            <input type="number" min="0" step="0.01" value={valorContado} onChange={(e) => setValorContado(e.target.value)} autoFocus />
          </label>
          <label style={estiloLabel}>Observação (opcional)
            <input value={obsFechamento} onChange={(e) => setObsFechamento(e.target.value)} maxLength={300} />
          </label>
          <button className="admin-primary" type="button" style={{ width: '100%' }} disabled={fechando} onClick={fecharCaixa}>{fechando ? 'Fechando⬦' : 'Fechar caixa'}</button>
        </Modal>
      )}
      {cupom && (
        <Modal titulo="Cupom da venda" onFechar={() => setCupom(null)} imprimir>
          <pre style={{ background: 'var(--nexus-panel-2)', border: '1px solid var(--nexus-border)', borderRadius: 8, padding: 14, fontSize: 12, lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre-wrap', color: 'inherit' }}>{renderCupom(cupom, brl, ROTULO_FORMA)}</pre>
          <div className="pdv-noprint" style={{ display: 'flex', gap: 8 }}>
            <button className="admin-secondary" type="button" style={{ flex: 1 }} onClick={() => window.print()}>Imprimir</button>
            <button className="admin-primary" type="button" style={{ flex: 1 }} onClick={() => setCupom(null)}>Concluir</button>
          </div>
        </Modal>
      )}
    </main>
  );
}

/** Integrações PDV (seção 14) — funcionalidade original da página, mantida:
 * listar, criar (só tipos oficiais) e sincronizar (recusa honestamente). */
function IntegracoesPDV() {
  const [integracoes, setIntegracoes] = useState<any[]>([]);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('API_OFICIAL');
  const [url, setUrl] = useState('');
  const [salvando, setSalvando] = useState(false);
  const salvandoRef = useRef(false);
  const [erro, setErro] = useState<string | null>(null);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const { data } = await api.get('/pdv/integracoes');
      setIntegracoes(data ?? []);
      setErroCarregamento(null);
    } catch (err: any) {
      setIntegracoes([]);
      setErroCarregamento(err.response?.data?.error || 'Não foi possível carregar as integrações PDV.');
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function criar() {
    setErro(null); setOk(null);
    if (salvandoRef.current) return;
    if (!nome || nome.trim().length < 2) { setErro('Informe o nome da integração.'); return; }
    if (!url.trim()) { setErro('Informe a URL oficial da integração.'); return; }
    try {
      new URL(url.trim());
    } catch {
      setErro('Informe uma URL válida para a integração.');
      return;
    }
    salvandoRef.current = true;
    setSalvando(true);
    try {
      await api.post('/pdv/integracoes', { nome: nome.trim(), tipo, url: url.trim() || undefined });
      setNome(''); setUrl('');
      setOk('Integração registrada. Configure as credenciais com o fornecedor oficial antes de sincronizar.');
      await carregar();
    } catch (err: any) { setErro(err.response?.data?.error || 'Não foi possível criar a integração.'); }
    finally { salvandoRef.current = false; setSalvando(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <label style={estiloLabel}>{traduzir('nome', "Nome")}<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: PDV Principal" style={{ minWidth: 180 }} /></label>
        <label style={estiloLabel}>{traduzir('tipo', "Tipo")}<select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ minWidth: 190 }}>
            <option value="API_OFICIAL">API oficial do fabricante</option>
            <option value="SDK_OFICIAL">SDK oficial do fabricante</option>
            <option value="WEBHOOK_OFICIAL">Webhook oficial do fabricante</option>
            <option value="BANCO_AUTORIZADO">Banco autorizado oficial</option>
          </select>
        </label>
        <label style={estiloLabel}>URL oficial<input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." style={{ minWidth: 200 }} /></label>
        <button className="admin-primary" type="button" disabled={salvando} onClick={criar}>{salvando ? 'Salvando⬦' : '+ Nova integração PDV'}</button>
      </div>
      {erro && <p className="admin-message admin-error">{erro}</p>}
      {ok && <p className="admin-message admin-success">{ok}</p>}
      {erroCarregamento && <p className="admin-message admin-error">{erroCarregamento}</p>}
      {!erroCarregamento && integracoes.length === 0 ? <p className="empty-state">Nenhuma integração configurada ainda.</p> : null}
      {integracoes.length > 0 && (
        <div className="admin-table">
          {integracoes.map((i: any) => (
            <div key={i.id} className="admin-list-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <strong>{i.nome}</strong>
                <span>{i.tipo} · Status: {i.status} · última sync: {i.ultimaSincronizacao ? new Date(i.ultimaSincronizacao).toLocaleString('pt-BR') : 'nunca'}</span>
              </div>
              <button type="button" className="admin-secondary" style={{ flexShrink: 0, opacity: 0.5, cursor: 'not-allowed' }} disabled title="Disponível quando uma integração oficial com credenciais for implementada">Sincronização indisponível</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const estiloLabel: React.CSSProperties = { fontSize: 12, opacity: 0.85, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 };

/**
 * Modal do balcão.
 *
 * `imprimir` existe por causa do cupom: o `window.print()` do botão saía com a
 * tela inteira, porque nada além do `<header>` tinha `.pdv-noprint`. Agora o
 * fundo do overlay recebe `pdv-print-backdrop` (some na impressão) e a caixa
 * recebe `pdv-print-area` (fica, em preto e branco). Para os outros modais o
 * comportamento é o de sempre: somem na impressão, como todo controle de tela.
 *
 * Não altera o layout: as classes só têm efeito dentro de `@media print`.
 */
function Modal({ titulo, onFechar, children, imprimir }: { titulo: string; onFechar: () => void; children: React.ReactNode; imprimir?: boolean }) {
  return (
    <div role="dialog" aria-modal="true" onClick={onFechar} className={`pdv-modal-bg${imprimir ? ' pdv-print-backdrop' : ' pdv-noprint'}`}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className={`admin-panel pdv-modal-card pdv-scroll${imprimir ? ' pdv-print-area' : ''}`} style={{ width: '100%', maxWidth: 440, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className={imprimir ? 'pdv-noprint' : undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{titulo}</h2>
          <button type="button" className="admin-secondary" style={{ padding: '4px 10px' }} onClick={onFechar}>×"</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Nota: a formatação do cupom (`renderCupom`) vive em `lib/pdv/cupom.ts`
// (fonte única, testável) e é importada no topo deste arquivo.



