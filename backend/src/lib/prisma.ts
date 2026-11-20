import { Prisma, PrismaClient } from '@prisma/client';
import { contextoAtual, executarComContexto, type ContextoTenant } from './tenant-context.js';

/**
 * Cliente Prisma com contexto de empresa para RLS.
 *
 * Toda operação feita com contexto 'tenant' ou 'sistema' é executada junto com
 * `set_config('app.empresa_id' | 'app.usuario_id' | 'app.escopo', ..., true)`
 * na MESMA transação. O `true` torna os valores locais à transação (SET LOCAL),
 * então nada vaza entre requisições, nem pelo pooler do Supabase.
 *
 * - Operação avulsa  -> $transaction em lote [set_config, operação].
 * - $transaction(fn) -> transação interativa com set_config como 1ª instrução;
 *   chamadas ao `prisma` global feitas DENTRO dela (ex.: services chamados a
 *   partir da rota) são redirecionadas para a mesma transação, para herdar o
 *   contexto.
 * - $transaction([...]) -> executado como transação interativa equivalente.
 * - Sem contexto (escopo 'nenhum'): comportamento original do Prisma.
 *
 * Com o papel `postgres` (BYPASSRLS) isso não muda nenhum resultado; com o
 * papel `nexus_app` é o que faz as policies liberarem os dados da empresa.
 */

/**
 * Limite do pool de conexões. O padrão do Prisma (núcleos × 2 + 1) pode
 * passar do CONNECTION LIMIT do papel `nexus_app` (20) e do pool do Supavisor,
 * e o banco passa a recusar conexões sob carga ("too many connections").
 * Se a DATABASE_URL já define `connection_limit`, ela prevalece.
 */
function urlComLimiteDeConexoes(): string | undefined {
  const bruta = process.env.DATABASE_URL;
  if (!bruta) return undefined;
  try {
    const url = new URL(bruta);
    if (!url.searchParams.has('connection_limit')) {
      const limite = Number(process.env.PRISMA_CONNECTION_LIMIT) || 10;
      url.searchParams.set('connection_limit', String(limite));
    }
    return url.toString();
  } catch {
    return bruta; // formato inesperado: deixa o Prisma validar e reportar
  }
}

const datasourceUrl = urlComLimiteDeConexoes();
const base = datasourceUrl ? new PrismaClient({ datasourceUrl }) : new PrismaClient();

function minusculaInicial(nome: string): string {
  return nome.charAt(0).toLowerCase() + nome.slice(1);
}

function precisaContexto(ctx: ContextoTenant | undefined): ctx is ContextoTenant {
  return !!ctx && ctx.escopo !== 'nenhum';
}

/**
 * Só em testes automatizados (NODE_ENV=test + NEXUS_TESTE_ESCOPO_PADRAO=sistema):
 * código de teste que monta dados direto pelo Prisma, FORA de qualquer
 * requisição, roda em escopo de sistema. Requisições HTTP nunca usam isto —
 * elas sempre abrem o próprio contexto ('nenhum' até o login ser validado) —,
 * então o isolamento das rotas continua sendo testado de verdade.
 */
const ESCOPO_PADRAO_TESTE: ContextoTenant | undefined =
  process.env.NODE_ENV === 'test' && process.env.NEXUS_TESTE_ESCOPO_PADRAO === 'sistema'
    ? { escopo: 'sistema', motivo: 'teste:fixture' }
    : undefined;

function contextoEfetivo(): ContextoTenant | undefined {
  return contextoAtual() ?? ESCOPO_PADRAO_TESTE;
}

function setConfig(cliente: { $executeRaw: PrismaClient['$executeRaw'] }, ctx: ContextoTenant) {
  return cliente.$executeRaw`select
    set_config('app.empresa_id', ${ctx.empresaId ?? ''}, true),
    set_config('app.usuario_id', ${ctx.usuarioId ?? ''}, true),
    set_config('app.escopo', ${ctx.escopo}, true)`;
}

let avisouRawEmTransacao = false;

const estendido = base.$extends({
  name: 'nexus-tenant-context',
  query: {
    async $allOperations({ model, operation, args, query }) {
      const ctx = contextoEfetivo();
      if (!precisaContexto(ctx)) return query(args);

      if (ctx.tx) {
        if (model) {
          const delegate = (ctx.tx as Record<string, any>)[minusculaInicial(model)];
          return delegate[operation](args);
        }
        // SQL cru chamado pelo cliente global dentro de uma transação: roda fora
        // dela (comportamento original do Prisma), mas COM o contexto da
        // empresa (caminho em lote abaixo), para não perder o RLS.
        if (!avisouRawEmTransacao) {
          avisouRawEmTransacao = true;
          console.warn(`[tenant] ${operation} chamado no prisma global dentro de $transaction; use o "tx" recebido.`);
        }
      }

      const [, resultado] = await base.$transaction([setConfig(base, ctx), query(args) as Prisma.PrismaPromise<unknown>]);
      return resultado;
    },
  },
});

type Opcoes = Parameters<PrismaClient['$transaction']>[1];

async function transacao(arg: unknown, opcoes?: Opcoes): Promise<unknown> {
  const ctx = contextoEfetivo();

  if (!precisaContexto(ctx)) {
    return (estendido.$transaction as any)(arg, opcoes);
  }

  // Já dentro de uma transação aberta por este wrapper: participa dela.
  if (ctx.tx) {
    if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(ctx.tx);
    const resultados: unknown[] = [];
    for (const operacao of arg as Promise<unknown>[]) resultados.push(await operacao);
    return resultados;
  }

  return base.$transaction(async (tx) => {
    await setConfig(tx, ctx);
    return executarComContexto({ ...ctx, tx }, async () => {
      if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(tx);
      // Lote: as PrismaPromises são preguiçosas; ao aguardá-las aqui, a extensão
      // as redireciona para `tx`, na ordem original, com o contexto aplicado.
      const resultados: unknown[] = [];
      for (const operacao of arg as Promise<unknown>[]) resultados.push(await operacao);
      return resultados;
    });
  }, opcoes as any);
}

export const prisma = new Proxy(estendido, {
  get(alvo, prop, receptor) {
    if (prop === '$transaction') return transacao;
    return Reflect.get(alvo, prop, receptor);
  },
}) as unknown as PrismaClient;

/** Cliente sem extensão, para diagnóstico/testes. Não use em rotas. */
export const prismaBase = base;
