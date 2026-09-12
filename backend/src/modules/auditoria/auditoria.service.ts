import { prisma } from '../../lib/prisma.js';
import type { AcaoAuditoria, Origem, Prisma } from '@prisma/client';

export interface DadosAuditoria {
  usuarioId?: string;
  empresaId?: string;
  acao: AcaoAuditoria;
  entidade: string;
  entidadeId?: string;
  valorAnterior?: Prisma.InputJsonValue;
  valorNovo?: Prisma.InputJsonValue;
  origem: Origem;
  ip?: string;
  contexto?: string;
}

/**
 * Registra uma entrada de auditoria (Seção 32). Chamado a partir de toda
 * rota que cria, edita, exclui, importa, sincroniza ou altera permissões/
 * configurações críticas — em qualquer módulo, presente ou futuro.
 */
export async function registrarAuditoria(dados: DadosAuditoria) {
  return prisma.auditoria.create({
    data: {
      usuarioId: dados.usuarioId,
      empresaId: dados.empresaId,
      acao: dados.acao,
      entidade: dados.entidade,
      entidadeId: dados.entidadeId,
      valorAnterior: dados.valorAnterior,
      valorNovo: dados.valorNovo,
      origem: dados.origem,
      ip: dados.ip,
      contexto: dados.contexto,
    },
  });
}
