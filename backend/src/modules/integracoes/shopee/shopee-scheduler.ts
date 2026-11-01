import { prisma } from '../../../lib/prisma.js';
import { sincronizarStatusPedidosShopee } from './shopee.service.js';
import { ShopeeApiError } from './shopee-api.client.js';

const TICK_MS = 30_000;
const LEASE_MS = 5 * 60_000;
let timer: NodeJS.Timeout | undefined;
let stopped = false;
let running = false;

function errorSeguro(error: unknown) {
  if (error instanceof ShopeeApiError) return { message: error.message.slice(0, 240), status: error.status, retryAfterMs: error.retryAfterMs };
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    return { message: error instanceof Error ? error.message.slice(0, 240) : 'Falha na sincronização Shopee.', status: error.status, retryAfterMs: null };
  }
  return { message: 'Falha inesperada durante a sincronização Shopee.', status: 500, retryAfterMs: null };
}

async function claimNext(): Promise<{ id: string; empresaId: string; lease: Date } | null> {
  const now = new Date();
  const row = await prisma.shopeeConexao.findFirst({
    where: {
      status: 'CONECTADO', pedidosNextSyncAt: { lte: now },
      OR: [{ pedidosLeaseExpiraEm: null }, { pedidosLeaseExpiraEm: { lt: now } }],
    },
    orderBy: { pedidosNextSyncAt: 'asc' },
    select: { id: true, empresaId: true, pedidosSyncTentativas: true },
  });
  if (!row) return null;
  const lease = new Date(now.getTime() + LEASE_MS);
  const claimed = await prisma.shopeeConexao.updateMany({
    where: { id: row.id, empresaId: row.empresaId, status: 'CONECTADO', pedidosNextSyncAt: { lte: now },
      OR: [{ pedidosLeaseExpiraEm: null }, { pedidosLeaseExpiraEm: { lt: now } }] },
    data: { pedidosLeaseExpiraEm: lease },
  });
  return claimed.count === 1 ? { id: row.id, empresaId: row.empresaId, lease } : null;
}

async function processOne(job: { id: string; empresaId: string; lease: Date }) {
  try {
    await sincronizarStatusPedidosShopee(job.id, job.empresaId);
  } catch (error) {
    const info = errorSeguro(error);
    const now = new Date();
    const row = await prisma.shopeeConexao.findFirst({ where: { id: job.id, empresaId: job.empresaId }, select: { pedidosSyncTentativas: true } });
    const attempts = Math.min((row?.pedidosSyncTentativas ?? 0) + 1, 12);
    const backoff = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 7));
    const delay = info.retryAfterMs == null ? backoff : Math.max(backoff, Math.min(info.retryAfterMs, 60 * 60_000));
    await prisma.shopeeConexao.updateMany({
      where: { id: job.id, empresaId: job.empresaId, pedidosLeaseExpiraEm: job.lease },
      data: {
        status: info.status === 401 || info.status === 403 ? 'REAUTORIZAR' : 'CONECTADO',
        pedidosSyncTentativas: attempts,
        pedidosNextSyncAt: new Date(now.getTime() + delay),
        erros: { motivo: info.message, em: now.toISOString() },
      },
    });
  } finally {
    await prisma.shopeeConexao.updateMany({
      where: { id: job.id, empresaId: job.empresaId, pedidosLeaseExpiraEm: job.lease },
      data: { pedidosLeaseExpiraEm: null },
    });
  }
}

async function tick() {
  if (stopped || running) return;
  running = true;
  try {
    for (let count = 0; count < 5 && !stopped; count++) {
      const job = await claimNext();
      if (!job) break;
      await processOne(job);
    }
  } catch (error) {
    // Erros de infraestrutura não devem encerrar o processo nem o agendador.
    console.error('[shopee-sync] scheduler tick failed', error instanceof Error ? error.message : 'unknown');
  } finally {
    running = false;
    if (!stopped) {
      timer = setTimeout(() => void tick(), TICK_MS);
      timer.unref();
    }
  }
}

export function iniciarAgendadorShopee() {
  if (process.env.SHOPEE_SYNC_AUTO === 'false' || !process.env.SHOPEE_PARTNER_ID || !process.env.SHOPEE_PARTNER_KEY || !process.env.SHOPEE_REDIRECT_URI || timer || stopped) return;
  void tick();
}

export async function pararAgendadorShopee() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = undefined;
  while (running) await new Promise((resolve) => setTimeout(resolve, 50));
}

