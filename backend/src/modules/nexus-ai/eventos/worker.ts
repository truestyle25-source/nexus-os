/**
 * Worker da outbox AIEvento (Fase 06). Padrão lease, como os agendadores do NEXUS:
 *  - reivindica eventos com UPDATE ... FOR UPDATE SKIP LOCKED (duas instâncias nunca pegam o
 *    mesmo evento; um lease vencido — instância que caiu — é retomado);
 *  - processa SEM o modelo de IA: cria o Alerta e o insight com os números da regra. Por isso
 *    um evento de segurança vira alerta mesmo com o provedor fora do ar;
 *  - idempotente: o insight é único por evento (eventoId) e o alerta só é criado junto com ele,
 *    na mesma transação. Reprocessar não duplica.
 */
import type { PrioridadeAlerta, TipoAlerta } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { comoSistema } from '../../../lib/tenant-context.js';
import { INSTANCIA_ATUAL } from '../../../lib/tarefa-agendada.js';

const LEASE_MS = 2 * 60_000;
export const MAX_TENTATIVAS = 5;

const R$ = (n: unknown) => `R$ ${Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hora = (iso: unknown) => (typeof iso === 'string' ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '');

interface Conteudo { titulo: string; descricao: string; modulo: string; tipoAlerta: TipoAlerta; entidade?: string; entidadeId?: string }

/** Texto do alerta/insight a partir dos dados da regra (determinístico, sem IA). */
export function descrever(tipo: string, d: any): Conteudo {
  switch (tipo) {
    case 'LOGIN_FALHO': return { modulo: 'usuarios', tipoAlerta: 'SEGURANCA', entidade: 'Usuario', entidadeId: d.usuarioId,
      titulo: `${d.tentativas} tentativas de login falhas — ${d.usuario}`,
      descricao: `A conta ${d.email} teve ${d.tentativas} senhas erradas em até ${d.janelaMinutos} minutos, de ${d.ipsDistintos} endereço(s) IP diferente(s), entre ${hora(d.primeira)} e ${hora(d.ultima)}. Verifique com o usuário se foi ele; se não, troque a senha.` };
    case 'PERMISSAO_ALTERADA': return { modulo: 'usuarios', tipoAlerta: 'SEGURANCA', entidade: 'Auditoria', entidadeId: d.auditoriaId,
      titulo: `Permissões alteradas — ${d.usuarioAlterado}`,
      descricao: `${d.alteradoPor} alterou as permissões de ${d.usuarioAlterado} em ${hora(d.quando)}. Confirme se a alteração foi autorizada.` };
    case 'CANCELAMENTOS': return { modulo: 'vendas', tipoAlerta: 'SEGURANCA',
      titulo: `${d.vendas} cancelamentos/estornos em ${d.janelaMinutos} min — ${d.operador}`,
      descricao: `${d.operador} teve ${d.vendas} vendas canceladas, estornadas ou devolvidas em até ${d.janelaMinutos} minutos, somando ${R$(d.valorTotal)}. Confira os motivos no caixa.` };
    case 'AJUSTE_ESTOQUE': return { modulo: 'estoque', tipoAlerta: 'SEGURANCA', entidade: 'EstoqueMovimentacao', entidadeId: d.movimentacaoId,
      titulo: `Ajuste de estoque ${(d.motivos ?? []).join(' e ')} — ${d.produto}`,
      descricao: `${d.usuario} registrou ${String(d.tipoMovimentacao).toLowerCase()} de ${Math.abs(Number(d.quantidade))} unidade(s) de ${d.produto} (${R$(d.valorACusto)} a custo) em ${hora(d.quando)}.` };
    case 'INTEGRACAO_FALHA': return { modulo: 'integracoes', tipoAlerta: 'INTEGRACAO',
      titulo: `${d.falhas} falhas da integração ${d.provedor}`,
      descricao: `A integração ${d.provedor} falhou ${d.falhas} vezes em até ${d.janelaMinutos} minutos. Veja o histórico na Central de Integrações.` };
    case 'WEBHOOK_INVALIDO': return { modulo: 'integracoes', tipoAlerta: 'SEGURANCA',
      titulo: `${d.falhas} avisos com assinatura inválida — ${d.provedor}`,
      descricao: `O endereço de webhook de ${d.provedor} recebeu ${d.falhas} avisos com assinatura ou token inválido em até ${d.janelaMinutos} minutos. Todos foram recusados; pode ser uma tentativa de falsificar avisos.` };
    case 'MANIPULACAO_IA': return { modulo: 'ia', tipoAlerta: 'ANOMALIA_IA', entidade: 'AIExecucao', entidadeId: d.execucaoId ?? undefined,
      titulo: d.origem === 'pergunta bloqueada' ? `Pergunta bloqueada na IA — ${d.usuario}` : 'Instrução suspeita encontrada em dados do sistema',
      descricao: d.origem === 'pergunta bloqueada'
        ? `Uma pergunta de ${d.usuario} em ${hora(d.quando)} tentou mudar as regras da IA e foi bloqueada. Nada foi executado.`
        : `Um dado lido pela IA (${d.ferramenta ?? 'ferramenta'}${d.campos?.length ? `: ${d.campos.join(', ')}` : ''}) continha instruções direcionadas à IA. O conteúdo foi tratado como dado e não foi seguido. Revise o cadastro de origem.` };
    case 'EXPORTACAO_MASSA': {
      const mods = Object.entries(d.porModulo ?? {}).map(([m, n]) => `${m} (${n})`).join(', ');
      return { modulo: 'auditoria', tipoAlerta: 'SEGURANCA',
        titulo: d.motivo === 'volume' ? `${d.exportacoes} exportações em ${d.janelaMinutos} min — ${d.usuario}` : `Exportação de dados sensíveis fora do horário — ${d.usuario}`,
        descricao: d.motivo === 'volume'
          ? `${d.usuario} fez ${d.exportacoes} exportações em até ${d.janelaMinutos} minutos, entre ${hora(d.primeira)} e ${hora(d.ultima)}: ${mods}. Confirme se foi um trabalho autorizado.`
          : `${d.usuario} exportou dados de ${mods} em ${hora(d.quando)}, fora do horário comercial. Confirme se foi autorizado.` };
    }
    case 'ANOMALIA': {
      const moeda = d.area !== 'vendas' || d.tipo !== 'CANCELAMENTOS_ACIMA_DO_NORMAL';
      const fmt = (v: unknown) => (moeda ? R$(v) : `${Number(v).toLocaleString('pt-BR')}%`);
      return { modulo: ['vendas', 'financeiro', 'estoque'].includes(d.area) ? d.area : 'dashboard',
        tipoAlerta: d.tipo === 'QUEDA_DE_VENDAS' ? 'QUEDA_VENDAS' : d.tipo === 'DESPESA_ACIMA_DO_NORMAL' ? 'DESPESA_ALTA' : 'ANOMALIA_IA',
        titulo: String(d.descricao),
        descricao: `${d.descricao}: ${fmt(d.atual)} no período recente, contra ${fmt(d.esperado)} esperado pelo padrão.${d.ocorrencias ? ` ${d.ocorrencias} ocorrência(s).` : ''} Método: ${d.metodo}.` };
    }
    default: return { modulo: 'ia', tipoAlerta: 'ANOMALIA_IA', titulo: `Evento ${tipo}`, descricao: 'Evento registrado pelo monitoramento.' };
  }
}

const PRIORIDADE: Record<string, PrioridadeAlerta> = { BAIXA: 'BAIXA', MEDIA: 'MEDIA', ALTA: 'ALTA', CRITICA: 'CRITICA' };

/** Reivindica até `limite` eventos para esta instância. */
export async function reivindicar(limite = 20, agora = new Date()): Promise<{ id: string }[]> {
  const lease = new Date(agora.getTime() + LEASE_MS);
  return comoSistema('nexus-ai:eventos:reivindicar', () => prisma.$queryRaw<{ id: string }[]>`
    UPDATE "AIEvento" SET "status" = 'PROCESSANDO', "leaseExpiraEm" = ${lease}, "instancia" = ${INSTANCIA_ATUAL}, "tentativas" = "tentativas" + 1
    WHERE "id" IN (
      SELECT "id" FROM "AIEvento"
      WHERE ("status" = 'PENDENTE' OR ("status" = 'PROCESSANDO' AND "leaseExpiraEm" < ${agora}))
        AND "tentativas" < ${MAX_TENTATIVAS}
      ORDER BY "createdAt" ASC LIMIT ${limite}
      FOR UPDATE SKIP LOCKED)
    RETURNING "id"`);
}

export async function processarEvento(id: string): Promise<void> {
  await comoSistema('nexus-ai:eventos:processar', async () => {
    const ev = await prisma.aIEvento.findUnique({ where: { id } });
    if (!ev || ev.status === 'CONCLUIDO') return;
    try {
      const c = descrever(ev.tipo, ev.dados);
      await prisma.$transaction(async (tx) => {
        const existente = await tx.aIInsight.findUnique({ where: { eventoId: ev.id }, select: { id: true } });
        if (!existente) {
          const alerta = await tx.alerta.create({ data: { empresaId: ev.empresaId, tipo: c.tipoAlerta, prioridade: PRIORIDADE[ev.severidade] ?? 'MEDIA', titulo: c.titulo.slice(0, 200), descricao: c.descricao, entidade: c.entidade ?? 'AIEvento', entidadeId: c.entidadeId ?? ev.id, origem: 'AUTOMATICO' } });
          await tx.aIInsight.create({ data: { empresaId: ev.empresaId, eventoId: ev.id, alertaId: alerta.id, origem: ev.tipo === 'ANOMALIA' ? 'ROTINA' : 'MONITOR', tipo: ev.tipo, modulo: c.modulo, severidade: ev.severidade, titulo: c.titulo.slice(0, 200), descricao: c.descricao, evidencias: ev.dados as any } });
        }
        await tx.aIEvento.update({ where: { id: ev.id }, data: { status: 'CONCLUIDO', processadoEm: new Date(), leaseExpiraEm: null, erro: null } });
      });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await prisma.aIEvento.update({ where: { id: ev.id }, data: { status: ev.tentativas >= MAX_TENTATIVAS ? 'FALHOU' : 'PENDENTE', leaseExpiraEm: null, erro: msg } }).catch(() => undefined);
    }
  });
}

/** Processa a fila até esvaziar (ou até `maxLotes`). */
export async function processarFila(maxLotes = 10): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxLotes; i++) {
    const lote = await reivindicar();
    if (!lote.length) break;
    for (const e of lote) await processarEvento(e.id);
    total += lote.length;
  }
  return total;
}
