/**
 * Agendador da Central de Integrações (fora de requisições, escopo de sistema).
 *
 * 1) WooCommerce — importação automática de pedidos (quando "Importar automaticamente" = Sim
 *    e a filial está escolhida na configuração), a cada 15 min por loja. Trava entre
 *    instâncias por lease no próprio registro (updateMany condicional: só uma instância vence).
 *    Falha → nova tentativa com espera crescente (até 6 h), registrada no histórico.
 * 2) LGPD — retenção: mensagens do WhatsApp e envios de e-mail mais antigos que o prazo
 *    configurado (padrão 365 dias) são ANONIMIZADOS (conteúdo, nome e destinatário apagados;
 *    ficam data, direção e status para os indicadores). Operação idempotente: rodar em duas
 *    instâncias ao mesmo tempo não causa problema.
 * Desligável com INTEGRACOES_AGENDADOR=false.
 */
import { prisma } from '../../../lib/prisma.js';
import { logDe } from '../../../lib/logger.js';
import { importarPedidosWoo } from './woocommerce-pedidos.service.js';
import { registrarEvento } from './central.service.js';

const log = logDe('agendador-integracoes');
const TICK_MS = 60_000;
const INTERVALO_WOO_MS = 15 * 60_000;
const LEASE_MS = 10 * 60_000;
const RETENCAO_A_CADA_MS = 6 * 3600_000;
export const RETENCAO_PADRAO_DIAS = 365;

let timer: NodeJS.Timeout | undefined;
let rodando = false;
let parado = false;
let ultimaRetencao = 0;

/** Pega UMA loja vencida, com trava. Exportada para os testes. */
export async function reservarLojaWoo(agora = new Date()) {
  const candidatas = await prisma.integracaoExterno.findMany({
    where: { tipo: 'WOOCOMMERCE', status: 'CONECTADO', OR: [{ proximoSyncEm: null }, { proximoSyncEm: { lte: agora } }], AND: [{ OR: [{ syncLeaseExpiraEm: null }, { syncLeaseExpiraEm: { lt: agora } }] }] },
    select: { id: true, empresaId: true, config: true }, orderBy: { proximoSyncEm: 'asc' }, take: 10,
  });
  for (const c of candidatas) {
    const cfg = (c.config ?? {}) as Record<string, string>;
    if (cfg.importarAutomatico !== 'SIM' || !cfg.filialPedidos) continue;
    const lease = new Date(agora.getTime() + LEASE_MS);
    const ok = await prisma.integracaoExterno.updateMany({
      where: { id: c.id, OR: [{ syncLeaseExpiraEm: null }, { syncLeaseExpiraEm: { lt: agora } }] },
      data: { syncLeaseExpiraEm: lease },
    });
    if (ok.count === 1) return { id: c.id, empresaId: c.empresaId, filialId: cfg.filialPedidos, lease };
  }
  return null;
}

export async function executarLojaWoo(job: { id: string; empresaId: string; filialId: string; lease: Date }) {
  let proximo = INTERVALO_WOO_MS;
  try {
    const operador = await prisma.usuario.findFirst({ where: { empresaId: job.empresaId, status: 'ATIVO' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!operador) throw new Error('Empresa sem usuário ativo para registrar a importação.');
    await importarPedidosWoo(job.empresaId, operador.id, job.filialId, 50);
    await prisma.integracaoExterno.update({ where: { id: job.id }, data: { erros: undefined } }).catch(() => {});
  } catch (e) {
    const falhas = await prisma.integracaoEvento.count({ where: { empresaId: job.empresaId, provedor: 'woocommerce', operacao: 'SINCRONIZAR', resultado: 'FALHA', createdAt: { gte: new Date(Date.now() - 6 * 3600_000) } } });
    proximo = Math.min(6 * 3600_000, INTERVALO_WOO_MS * 2 ** Math.min(falhas, 5));
    await registrarEvento({ empresaId: job.empresaId, provedor: 'woocommerce', operacao: 'SINCRONIZAR', ok: false, codigoErro: 'AGENDADO', mensagem: `Importação automática falhou: ${e instanceof Error ? e.message.slice(0, 200) : 'erro'}` });
  } finally {
    await prisma.integracaoExterno.updateMany({ where: { id: job.id, syncLeaseExpiraEm: job.lease }, data: { syncLeaseExpiraEm: null, proximoSyncEm: new Date(Date.now() + proximo) } });
  }
}

/** Anonimiza o que passou do prazo de retenção. Exportada para os testes. */
export async function aplicarRetencao(agora = new Date()) {
  const registros = await prisma.integracaoExterno.findMany({ where: { tipo: { in: ['WHATSAPP', 'EMAIL'] } }, select: { empresaId: true, tipo: true, config: true } });
  let whatsapp = 0; let email = 0;
  for (const r of registros) {
    const dias = Number(((r.config ?? {}) as Record<string, string>).retencaoDias) || RETENCAO_PADRAO_DIAS;
    const limite = new Date(agora.getTime() - dias * 86400_000);
    if (r.tipo === 'WHATSAPP') {
      const x = await prisma.whatsappMensagem.updateMany({ where: { empresaId: r.empresaId, createdAt: { lt: limite }, NOT: { telefone: 'ANONIMIZADO' } }, data: { conteudo: null, nomeContato: null, telefone: 'ANONIMIZADO', erro: null } });
      whatsapp += x.count;
    } else {
      const x = await prisma.emailEnvio.updateMany({ where: { empresaId: r.empresaId, createdAt: { lt: limite }, NOT: { para: 'ANONIMIZADO' } }, data: { para: 'ANONIMIZADO', assunto: '(removido pela política de retenção)', erro: null } });
      email += x.count;
    }
  }
  return { whatsapp, email };
}

async function tick() {
  if (parado || rodando) return;
  rodando = true;
  try {
    for (let i = 0; i < 5; i++) {
      const job = await reservarLojaWoo();
      if (!job) break;
      await executarLojaWoo(job);
    }
    if (Date.now() - ultimaRetencao > RETENCAO_A_CADA_MS) {
      ultimaRetencao = Date.now();
      const r = await aplicarRetencao();
      if (r.whatsapp || r.email) log.info({ ...r, evento: 'retencao_aplicada' }, 'dados anonimizados pela política de retenção');
    }
  } catch (e) {
    log.error({ err: e instanceof Error ? e.message : 'erro' }, 'falha no agendador de integrações');
  } finally {
    rodando = false;
    if (!parado) timer = setTimeout(() => void tick(), TICK_MS);
  }
}

export function iniciarAgendadorIntegracoes() {
  if (process.env.INTEGRACOES_AGENDADOR === 'false') return;
  parado = false;
  timer = setTimeout(() => void tick(), 15_000);
}

export async function pararAgendadorIntegracoes() {
  parado = true;
  if (timer) clearTimeout(timer);
}
