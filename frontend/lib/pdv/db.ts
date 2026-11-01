// ============================================================================
// FASE 3 PDV PRO — Schema do banco local (Dexie sobre IndexedDB).
//
// Tabelas:
//   operacoes  -> fila de sincronização (sobrevive a refresh/queda de energia).
//   produtos   -> catálogo local para operação offline (bipagem instantânea).
//   clientes   -> clientes mínimos para associar à venda offline.
//   caixa      -> turno de caixa ativo, para reidratar a tela.
//   carrinho   -> estado temporário do carrinho (recuperação pós-fechamento).
//   meta       -> marcadores de sincronização (ex.: último cursor do catálogo).
//
// Nada aqui é a fonte da verdade: é cache de operação + fila durável.
// ============================================================================
import Dexie, { type Table } from 'dexie';
import type {
  OperacaoPendente,
  ProdutoLocal,
  CaixaLocal,
  CarrinhoLocal,
} from './tipos';

export interface MetaLocal {
  chave: string;
  valor: string;
  atualizadoEm: number;
}

export class PdvDatabase extends Dexie {
  operacoes!: Table<OperacaoPendente, string>;
  catalogoProdutos!: Table<ProdutoLocal, string>;
  caixa!: Table<CaixaLocal, string>;
  carrinho!: Table<CarrinhoLocal, string>;
  meta!: Table<MetaLocal, string>;

  constructor(nome = 'nexus-pdv') {
    super(nome);
    // Versão 1 do schema local do PDV.
    this.version(1).stores({
      // Fila: indexada por status (processamento) e por idempotencyKey (dedupe).
      operacoes: 'id, status, tipo, idempotencyKey, criadoEm, [status+criadoEm]',
      // Catálogo: busca por codigoBarras/sku/nome e filtro por categoria/ativo.
      produtos: 'id, codigoBarras, sku, categoriaId, ativo, atualizadoEm, nome',
      clientes: 'id, nome, documento, atualizadoEm',
      caixa: 'id, empresaId, filialId, usuarioId, status',
      // Carrinho: chave fixa ('atual'), uma linha só.
      carrinho: 'chave',
      meta: 'chave',
    });
    this.version(2)
      .stores({
        operacoes: 'id, empresaId, usuarioId, status, tipo, idempotencyKey, criadoEm, [empresaId+usuarioId], [empresaId+usuarioId+status+criadoEm]',
        produtos: null,
        catalogoProdutos: 'idLocal, id, empresaId, filialId, codigoBarras, sku, categoriaId, ativo, atualizadoEm, nome, [empresaId+filialId], [empresaId+filialId+codigoBarras], [empresaId+filialId+sku]',
        clientes: null,
        caixa: 'id, empresaId, filialId, usuarioId, status, [empresaId+usuarioId+status]',
        carrinho: 'chave, empresaId, usuarioId, [empresaId+usuarioId]',
        meta: 'chave',
      })
      .upgrade(async (transacao) => {
        // Existing unscoped records cannot safely be assigned to a tenant.
        // Keep their payload for review, but quarantine them from automatic sync.
        await transacao.table('operacoes').toCollection().modify((registro: any) => {
          registro.empresaId = '';
          registro.usuarioId = '';
          registro.status = 'DIVERGENCIA';
          registro.ultimoErro = 'Operação anterior sem escopo de empresa/operador; revise antes de sincronizar.';
        });
        // Old unscoped product cache and customer PII stores are discarded by
        // the schema upgrade; the server repopulates a tenant/branch cache.
      });
  }
}

/**
 * Instância única do banco. Criada de forma preguiçosa para não tocar em
 * IndexedDB durante a renderização no servidor (SSR) do Next.js.
 */
let _db: PdvDatabase | null = null;

export function db(): PdvDatabase {
  if (typeof indexedDB === 'undefined') {
    // No servidor não há IndexedDB; quem chamar no cliente deve guardar a
    // referência. Este throw é intencional para pegar uso indevido em SSR.
    throw new Error('PdvDatabase só pode ser usada no navegador (IndexedDB indisponível em SSR).');
  }
  if (!_db) _db = new PdvDatabase();
  return _db;
}

/** Permite injetar uma instância (usado nos testes com fake-indexeddb). */
export function setDb(instancia: PdvDatabase | null): void {
  _db = instancia;
}

/**
 * Higiene de logout — remove o que é regenerável e preserva o que é dado de
 * negócio: catálogo em cache, carrinho, turno local e cursores são apagados;
 * operações CONFIRMADAS locais (histórico de 7 dias) também. PENDENTES,
 * ERROS e DIVERGENCIAS SÃO PRESERVADAS: uma venda não confirmada precisa
 * sobreviver ao logout para ser reconciliada com a MESMA idempotency key
 * após o próximo login (fluxo 401 → novo login → retry da fila).
 */
export async function limparDadosLocaisSeguro(): Promise<void> {
  const database = db();
  await database.transaction(
    'rw',
    database.operacoes,
    database.catalogoProdutos,
    database.carrinho,
    database.caixa,
    database.meta,
    async () => {
      await database.operacoes.where('status').equals('CONFIRMADO').delete();
      await database.catalogoProdutos.clear();
      await database.carrinho.clear();
      await database.caixa.clear();
      await database.meta.clear();
    },
  );
}
