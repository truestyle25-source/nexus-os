// ============================================================================
// FASE 3 PDV PRO — Tipos da camada de persistência local (Dexie / IndexedDB).
//
// REGRA DE OURO: o IndexedDB NÃO é a fonte da verdade da venda. Ele guarda
// (a) um catálogo mínimo para operar offline, (b) a FILA de sincronização com
// a idempotency key do cliente, e (c) o estado temporário do carrinho. A venda
// só é CONFIRMADA quando o PostgreSQL commitar. Nunca guardamos aqui senha,
// token, chave privada ou dado que não precise existir localmente (LGPD).
// ============================================================================

/** Estado de um item na fila de sincronização. */
export type StatusSync = 'PENDENTE' | 'SINCRONIZANDO' | 'CONFIRMADO' | 'ERRO' | 'DIVERGENCIA';

/** Tipos de operação enfileirradas para o backend. */
export type TipoOperacao = 'VENDA' | 'SANGRIA' | 'SUPRIMENTO' | 'ABRIR_CAIXA' | 'FECHAR_CAIXA';

/** Tenant and operator scope for local data; never share queues across users. */
export interface ContextoLocal {
  empresaId: string;
  usuarioId: string;
}

/**
 * Um item da fila de sincronização. `idempotencyKey` é criada UMA vez no
 * cliente e mantida em todos os retries — é o que impede a venda duplicada
 * quando a internet volta e a fila é reprocessada.
 */
export interface OperacaoPendente {
  /** id local estável (UUID) — sobrevive a refresh/fechamento do navegador. */
  id: string;
  empresaId: string;
  usuarioId: string;
  tipo: TipoOperacao;
  /** Payload exato enviado ao backend (já no formato do POST /vendas etc.). */
  payload: Record<string, unknown>;
  status: StatusSync;
  tentativas: number;
  /** Chave de idempotência — igual em todos os retries desta operação. */
  idempotencyKey: string;
  criadoEm: number;
  atualizadoEm: number;
  ultimoErro?: string | null;
  /** Preenchido pelo backend quando a operação é confirmada. */
  vendaIdRemota?: string | null;
}

/**
 * Catálogo mínimo para operação offline. Só o necessário para bipar/buscar um
 * produto e calcular o total. Nada de custo/margem (não é preciso no PDV e
 * reduz exposição). `atualizadoEm` permite sincronização incremental.
 */
export interface ProdutoLocal {
  /** Browser-side key; product ids are shared across branch catalog copies. */
  idLocal: string;
  /** Authoritative product id sent to the API. */
  id: string;
  empresaId: string;
  filialId: string;
  nome: string;
  sku?: string | null;
  codigoBarras?: string | null;
  precoVenda: number;
  precoPromocional?: number | null;
  promocaoInicio?: string | null;
  promocaoFim?: string | null;
  categoriaId?: string | null;
  unidade: string;
  imagem?: string | null;
  ativo: boolean;
  /** Estoque disponível na filial, no momento do último sync (informativo). */
  estoqueFilial?: number;
  atualizadoEm: number;
}

/** Cliente mínimo para associar à venda offline. */
export interface ClienteLocal {
  id: string;
  nome: string;
  documento?: string | null;
  atualizadoEm: number;
}

/** Configuração do turno de caixa persistida localmente (para reidratar a tela). */
export interface CaixaLocal {
  id: string;
  empresaId: string;
  filialId: string;
  filialNome?: string;
  numero?: number | null;
  status: string;
  fundoTroco: number;
  saldo: number;
  abertoEm: string;
  usuarioId: string;
  usuarioNome?: string;
  atualizadoEm: number;
}

/** Estado temporário do carrinho — sobrevive a refresh/fechamento inesperado. */
export interface CarrinhoLocal {
  /** Uma linha só (chave fixa 'atual'); reidrata o carrinho ao reabrir. */
  chave: string;
  empresaId: string;
  usuarioId: string;
  operacaoId?: string | null;
  filialId: string;
  clienteId?: string | null;
  forma: string;
  descontoGeral: number;
  valorRecebido?: string | null;
  parcelas?: number;
  itens: Array<{
    produtoId: string;
    nome: string;
    preco: number;
    quantidade: number;
    estoque?: number;
    desconto: number;
    imagem?: string | null;
  }>;
  atualizadoEm: number;
}
