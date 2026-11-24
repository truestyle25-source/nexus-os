/**
 * Ferramentas de conhecimento (Fase 04): memória empresarial, base de documentos,
 * investigações anteriores e consulta a especialistas (usada só pelo NEXUS BRAIN).
 * Somente leitura; sempre filtradas pela empresa do contexto.
 */
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { temPermissao } from '../../../lib/permissoes.js';
import { buscarTrechos, listarMemoria } from '../conhecimento.service.js';
import { todosAgentes } from '../agentes/registro.js';
import type { ContextoIA, Ferramenta } from '../tipos.js';

export const consultarMemoria: Ferramenta<{ termo?: string }> = {
  nome: 'consultar_memoria',
  descricao: 'Memória da empresa cadastrada pelos administradores: metas, políticas, critérios, preferências e decisões. Use para comparar resultados com metas e respeitar políticas.',
  parametros: { type: 'object', properties: { termo: { type: 'string', description: 'Filtro opcional (ex.: "margem", "estoque").' } } },
  validar: z.object({ termo: z.string().trim().max(100).optional() }),
  permissao: { modulo: 'ia', acao: 'visualizar' },
  async executar(ctx, { termo }) {
    const itens = await listarMemoria(ctx.empresaId, termo || undefined);
    return { itens: itens.map((i) => ({ tipo: i.tipo, titulo: i.titulo, conteudo: i.conteudo, atualizadoEm: i.updatedAt.toISOString().slice(0, 10) })), total: itens.length };
  },
};

export const buscarDocumentos: Ferramenta<{ consulta: string }> = {
  nome: 'buscar_documentos',
  descricao: 'Busca nos documentos internos da empresa (manuais, procedimentos, políticas). Devolve os trechos mais relevantes com o título do documento. Cite o documento ao usar.',
  parametros: { type: 'object', properties: { consulta: { type: 'string', description: 'Palavras-chave do assunto procurado.' } }, required: ['consulta'] },
  validar: z.object({ consulta: z.string().trim().min(2).max(200) }),
  permissao: { modulo: 'ia', acao: 'visualizar' },
  async executar(ctx, { consulta }) {
    const trechos = await buscarTrechos(ctx.empresaId, ctx.usuarioId, consulta, 5);
    return { trechos, total: trechos.length, ...(trechos.length ? {} : { observacao: 'Nenhum documento encontrado sobre o assunto.' }) };
  },
};

async function agentesPermitidos(ctx: ContextoIA) {
  const ids: string[] = [];
  for (const a of todosAgentes()) {
    if (ctx.sistema || (ctx.usuarioId && (await temPermissao(ctx.usuarioId, a.permissaoMinima.modulo, a.permissaoMinima.acao)))) ids.push(a.id);
  }
  return ids;
}

export const investigacoesAnteriores: Ferramenta<{ termo?: string; limite: number }> = {
  nome: 'investigacoes_anteriores',
  descricao: 'Investigações anteriores concluídas na empresa (pergunta, resposta resumida e data), apenas dos especialistas que o usuário pode usar. Use para lembrar análises já feitas.',
  parametros: { type: 'object', properties: { termo: { type: 'string', description: 'Filtro opcional na pergunta.' }, limite: { type: 'integer', description: '1 a 10. Padrão 5.' } } },
  validar: z.object({ termo: z.string().trim().max(100).optional(), limite: z.coerce.number().int().min(1).max(10).default(5) }),
  permissao: { modulo: 'ia', acao: 'visualizar' },
  async executar(ctx, { termo, limite }) {
    const agentes = await agentesPermitidos(ctx);
    const lista = await prisma.aIExecucao.findMany({
      where: { empresaId: ctx.empresaId, status: 'CONCLUIDA', origem: { not: 'SUBAGENTE' }, agente: { in: agentes }, ...(ctx.execucaoId ? { id: { not: ctx.execucaoId } } : {}), ...(termo ? { entrada: { contains: termo, mode: 'insensitive' } } : {}) },
      orderBy: { createdAt: 'desc' }, take: limite, select: { agente: true, entrada: true, resposta: true, createdAt: true },
    });
    return { investigacoes: lista.map((e) => ({ data: e.createdAt.toISOString().slice(0, 10), agente: e.agente, pergunta: e.entrada, resposta: (e.resposta ?? '').slice(0, 600) })), total: lista.length };
  },
};

export const consultarEspecialista: Ferramenta<{ agente: string; pergunta: string }> = {
  nome: 'consultar_especialista',
  descricao: 'Pede a um especialista (estoque, comercial, financeiro, compras) que investigue uma pergunta objetiva com as ferramentas dele. Devolve a resposta e os dados usados. Faça perguntas específicas, uma por especialista.',
  parametros: { type: 'object', properties: { agente: { type: 'string', description: 'Especialista.', enum: ['estoque', 'comercial', 'financeiro', 'compras'] }, pergunta: { type: 'string', description: 'Pergunta objetiva, com o período quando houver.' } }, required: ['agente', 'pergunta'] },
  validar: z.object({ agente: z.enum(['estoque', 'comercial', 'financeiro', 'compras']), pergunta: z.string().trim().min(3).max(1000) }),
  permissao: { modulo: 'ia', acao: 'visualizar' },
  async executar(ctx, { agente, pergunta }) {
    const { executarEspecialista } = await import('../motor.js');
    return executarEspecialista(ctx, agente, pergunta);
  },
};

export const FERRAMENTAS_CONHECIMENTO = [consultarMemoria, buscarDocumentos, investigacoesAnteriores, consultarEspecialista];
