/**
 * Registro central de exportações (Fase 06/07, plano 5A.1: "exportação/consulta em massa de
 * dados sensíveis"). Um gancho onResponse do servidor anota na Auditoria (acao EXPORTAR) toda
 * resposta bem-sucedida de rota de exportação — as atuais e as futuras que sigam o padrão de
 * nome — sem tocar em cada módulo. A regra EXPORTACAO_MASSA do monitor lê esses registros.
 * Não grava o conteúdo exportado, só quem, o quê (rota), quando e de onde.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { registrarAuditoria } from '../../auditoria/auditoria.service.js';

/** Rotas consideradas exportação (padrão do NEXUS: /export, /exportar, /pdf, relatório do Radar). */
export const ROTA_EXPORTACAO = /(\/export(ar)?(\/|$)|\/pdf$|^\/radar\/relatorio$)/;

/** Módulo de origem pela rota (para o alerta dizer o que foi exportado). */
export function moduloDaExportacao(rota: string): string {
  const m = rota.replace(/^\/api\/v1/, '').split('/').filter(Boolean)[0] ?? 'desconhecido';
  return m === 'lgpd' ? (rota.includes('funcionarios') ? 'rh' : rota.includes('clientes') ? 'clientes' : 'lgpd') : m;
}

export async function registrarExportacaoSeFor(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const rota = req.routeOptions?.url ?? '';
  const user = (req as any).user as { id?: string; empresaId?: string } | undefined;
  if (!rota || !ROTA_EXPORTACAO.test(rota) || reply.statusCode >= 400 || !user?.empresaId) return;
  await registrarAuditoria({
    usuarioId: user.id, empresaId: user.empresaId, acao: 'EXPORTAR', entidade: 'Exportacao',
    entidadeId: moduloDaExportacao(rota), contexto: rota.slice(0, 200), origem: 'MANUAL', ip: req.ip,
  }).catch(() => undefined); // auditoria nunca derruba a exportação
}
