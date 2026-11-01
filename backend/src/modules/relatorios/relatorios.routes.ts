import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { createRateLimiter } from '../../middlewares/rateLimiter.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import {
  interpretarPergunta,
  gerarRelatorioPorIA,
  type RelatorioGeradoDTO,
} from './iaRelatorios.service.js';

/** Converte a linha salva no banco no DTO que o frontend espera. */
export function paraDTO(r: {
  id: string;
  empresaId: string;
  perguntaOriginal: string;
  titulo: string;
  tipo: string;
  dados: unknown;
  insights: unknown;
  criadoEm: Date;
}): RelatorioGeradoDTO {
  return {
    id: r.id,
    empresaId: r.empresaId,
    perguntaOriginal: r.perguntaOriginal,
    titulo: r.titulo,
    tipo: r.tipo,
    dados: (r.dados ?? {}) as RelatorioGeradoDTO['dados'],
    insights: Array.isArray(r.insights) ? (r.insights as string[]) : [],
    criadoEm: r.criadoEm,
  };
}

const criarSchema = z.object({
  pergunta: z.string().min(5, 'Pergunta muito curta. Descreva o relatório desejado.'),
  tab: z.string().optional(),
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
});

const exportSchema = z.object({
  formato: z.enum(['csv', 'excel']).default('excel'),
  relatorioId: z.string().optional(),
  fonte: z.enum(['vendas', 'financeiro', 'estoque', 'geral']).optional(),
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
});

export async function relatoriosRoutes(app: FastifyInstance): Promise<void> {
  const iaLimiter = createRateLimiter(20, 60_000);

  // Interpreta a pergunta em linguagem natural, busca dados reais do Prisma,
  // usa o Gemini para estruturar KPIs/insights/gráfico (com fallback local)
  // e salva em RelatorioGerado.
  app.post(
    '/relatorios/ia/criar',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('relatorios', 'visualizar'), iaLimiter] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = criarSchema.parse(req.body ?? {});
      const user = (req as any).user;
      const interpretacao = interpretarPergunta(body.pergunta, body.tab);
      const relatorio = await gerarRelatorioPorIA({
        empresaId: user.empresaId,
        pergunta: body.pergunta,
        tab: body.tab,
        interpretacao,
        de: body.de?.toISOString(),
        ate: body.ate?.toISOString(),
      });
      await registrarAuditoria({
        usuarioId: user.id,
        empresaId: user.empresaId,
        acao: 'CRIAR',
        entidade: 'RelatorioGerado',
        entidadeId: relatorio.id,
        valorNovo: { titulo: relatorio.titulo, tipo: relatorio.tipo },
        origem: 'IA',
        ip: req.ip,
        contexto: 'Gerador de relatórios por IA (Seção 33)',
      });
      return reply.send(relatorio);
    },
  );

  // Histórico: 20 últimos relatórios da empresa, mais recente primeiro.
  app.get(
    '/relatorios/ia/historico',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('relatorios', 'visualizar')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = (req as any).user;
      const linhas = await prisma.relatorioGerado.findMany({
        where: { empresaId: user.empresaId },
        orderBy: { criadoEm: 'desc' },
        take: 20,
      });
      return reply.send(linhas.map(paraDTO));
    },
  );

  // Exporta a tabela do relatório (salvo ou recém-calculado) em .xlsx/.csv.
  app.post(
    '/relatorios/export',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('relatorios', 'visualizar')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = exportSchema.parse(req.body ?? {});
      const user = (req as any).user;
      const { montarPlanilha } = await import('./export.service.js');

      if (body.relatorioId) {
        const rel = await prisma.relatorioGerado.findFirst({
          where: { id: body.relatorioId, empresaId: user.empresaId },
        });
        if (!rel) {
          return reply.status(404).send({ error: 'Relatório não encontrado.' });
        }
        const dto = paraDTO(rel);
        const { base64, nome } = await montarPlanilha({
          formato: body.formato,
          titulo: dto.titulo,
          kpis: dto.dados.kpis ?? [],
          tabela: dto.dados.tabela ?? [],
        });
        return reply.send({ base64, nome });
      }

      // Sem relatório salvo, calcula na hora a partir de uma fonte.
      const { getVendas, getFinanceiro, getEstoque } = await import('./relatorios.service.js');
      const fonte =
        body.fonte === 'financeiro'
          ? await getFinanceiro({ empresaId: user.empresaId, de: body.de?.toISOString(), ate: body.ate?.toISOString() })
          : body.fonte === 'estoque'
            ? await getEstoque({ empresaId: user.empresaId })
            : await getVendas({ empresaId: user.empresaId, de: body.de?.toISOString(), ate: body.ate?.toISOString() });
      const { base64, nome } = await montarPlanilha({
        formato: body.formato,
        titulo: fonte.titulo,
        kpis: fonte.kpis,
        tabela: fonte.tabela,
      });
      return reply.send({ base64, nome });
    },
  );
}