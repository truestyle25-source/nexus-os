import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { createRateLimiter } from '../../middlewares/rateLimiter.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import {
  create,
  list,
  getById,
  update,
  getKPIs,
  getInsights,
  CATEGORIAS_FORNECEDOR,
  CONDICOES_PAGAMENTO,
} from './fornecedores.service.js';
import { analisarPorIA } from './iaFornecedores.service.js';

/**
 * Rotas da aba /fornecedores (Seção 11 v2).
 * Prefixo /api/v1/fornecedores — as rotas legadas /fornecedores continuam
 * em compras.routes.ts (a tela de Compras ainda as usa); Fastify impediria
 * registrar dois handlers para o mesmo path.
 */

const statusSchema = z.enum(['Ativo', 'Crítico', 'Inativo']);
const categoriaSchema = z.enum(CATEGORIAS_FORNECEDOR);
const condicaoSchema = z.enum(CONDICOES_PAGAMENTO);

const criarSchema = z.object({
  nome: z.string().min(2, 'Nome é obrigatório (mín. 2 caracteres).'),
  cnpj: z.string().optional(),
  categoria: categoriaSchema,
  status: statusSchema.optional(),
  contato: z.string().optional(),
  whatsapp: z.string().optional(),
  // Valida o e-mail como a rota legada já fazia (compras.routes.ts usa
  // `z.string().email()`). Aqui era só `z.string()`, então a API aceitaria e
  // gravaria "fulano@" / "nao-e-email" sem reclamar — o <input type="email">
  // da tela segura o navegador, mas qualquer outro cliente passaria direto.
  // Vazio ('') continua aceito como "não informado".
  email: z.union([z.literal(''), z.string().email('E-mail inválido.')]).optional(),
  telefone: z.string().optional(),
  produtos: z.string().optional(),
  condicaoPagamento: condicaoSchema.optional(),
  observacoes: z.string().optional(),
});

const atualizarSchema = criarSchema.partial();

const listQuerySchema = z.object({
  // Enums estritos (aceitando também os valores legados, que são
  // normalizados adiante). Antes era `z.string()`: qualquer status
  // desconhecido caía em `normalizarStatus()` e virava 'Ativo' — ou seja,
  // `?status=Inativo` num typo devolvia a lista de Ativos em silêncio.
  status: z.enum(['Ativo', 'Crítico', 'Inativo', 'ATIVO', 'INATIVO', 'ARQUIVADO']).optional(),
  categoria: z.enum(CATEGORIAS_FORNECEDOR).optional(),
  busca: z.string().optional(),
});

const exportSchema = z.object({ formato: z.enum(['csv', 'excel']).default('excel') });

const iaSchema = z.object({ pergunta: z.string().min(3, 'Pergunta muito curta.') });

/** Slug estável para o nome do arquivo baixado. */
function slugData(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function fornecedoresRoutes(app: FastifyInstance): Promise<void> {
  const iaLimiter = createRateLimiter(20, 60_000);

  // POST /api/v1/fornecedores — cria e audita (Seção 11 + 32).
  app.post(
    '/api/v1/fornecedores',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'criar')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = criarSchema.parse(req.body ?? {});
      const fornecedor = await create({ ...body, empresaId: req.user.empresaId });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'CRIAR',
        entidade: 'Fornecedor',
        entidadeId: fornecedor.id,
        valorNovo: fornecedor as unknown as Prisma.InputJsonValue,
        origem: 'MANUAL',
        ip: req.ip,
        contexto: 'Aba Fornecedores (modal ADD) — Seção 11 v2',
      });
      return reply.send(fornecedor);
    },
  );

  // GET /api/v1/fornecedores?status&categoria&busca — lista paginável por filtro.
  app.get(
    '/api/v1/fornecedores',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'visualizar')] },
    async (req: FastifyRequest) => {
      const q = listQuerySchema.parse(req.query ?? {});
      return list({ empresaId: req.user.empresaId, ...q });
    },
  );

  // GET /api/v1/fornecedores/kpis — KPIs reais (não é :id — registrada antes).
  app.get(
    '/api/v1/fornecedores/kpis',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'visualizar')] },
    async (req: FastifyRequest) => getKPIs(req.user.empresaId),
  );

  // GET /api/v1/fornecedores/insights —3 insights com dados reais.
  app.get(
    '/api/v1/fornecedores/insights',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'visualizar')] },
    async (req: FastifyRequest) => getInsights(req.user.empresaId),
  );

  // POST /api/v1/fornecedores/export { formato } — exceljs → base64.
  app.post(
    '/api/v1/fornecedores/export',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'visualizar')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = exportSchema.parse(req.body ?? {});
      const fornecedores = await list({ empresaId: req.user.empresaId });

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Fornecedores');
      const titulo = ws.addRow(['Fornecedores — NEXUS OS']);
      titulo.font = { bold: true, size: 14 };
      ws.addRow([`Gerado em ${new Date().toLocaleString('pt-BR')}`]);
      ws.addRow([]);
      const header = ws.addRow([
        'Nome', 'CNPJ', 'Categoria', 'Status', 'Contato', 'WhatsApp', 'Telefone',
        'Email', 'Condição Pagamento', 'Produtos', 'Total Comprado', 'Total Pedidos', 'Observações',
      ]);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
      });
      for (const f of fornecedores) {
        ws.addRow([
          f.nome, f.cnpj ?? '', f.categoria, f.status, f.contato ?? '', f.whatsapp ?? '',
          f.telefone ?? '', f.email ?? '', f.condicaoPagamento ?? '', f.produtos ?? '',
          Number(f.totalComprado), f.totalPedidos, f.observacoes ?? '',
        ]);
      }
      ws.columns.forEach((col, i) => {
        col.width = Math.min(38, Math.max(12, (header.getCell(i + 1).value as string)?.length ?? 12) + 8);
      });

      const buffer =
        body.formato === 'csv'
          ? Buffer.from((await wb.csv.writeBuffer()) as unknown as Uint8Array)
          : Buffer.from((await wb.xlsx.writeBuffer()) as unknown as Uint8Array);
      const ext = body.formato === 'csv' ? 'csv' : 'xlsx';
      return reply.send({ base64: buffer.toString('base64'), nome: `fornecedores_${slugData()}.${ext}` });
    },
  );

  // POST /ia/analisar — IA da barra (interpretar + Gemini/fallback).
  app.post(
    '/ia/analisar',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'visualizar'), iaLimiter] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = iaSchema.parse(req.body ?? {});
      const resultado = await analisarPorIA({ pergunta: body.pergunta, empresaId: req.user.empresaId });
      return reply.send(resultado);
    },
  );

  // GET /api/v1/fornecedores/:id — detalhe (+ últimos pedidos CompraFornecedor).
  app.get(
    '/api/v1/fornecedores/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      return getById(id, req.user.empresaId);
    },
  );

  // PUT /api/v1/fornecedores/:id — atualização parcial + auditoria.
  app.put(
    '/api/v1/fornecedores/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const dados = atualizarSchema.parse(req.body ?? {});
      const anterior = await prisma.fornecedor.findFirst({
        where: { id, empresaId: req.user.empresaId },
      });
      if (!anterior) {
        const { NaoEncontrado } = await import('../../lib/erros.js');
        throw NaoEncontrado('Fornecedor não encontrado nesta empresa.');
      }
      const atualizado = await update(id, req.user.empresaId, dados);
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EDITAR',
        entidade: 'Fornecedor',
        entidadeId: id,
        valorAnterior: anterior as unknown as Prisma.InputJsonValue,
        valorNovo: atualizado as unknown as Prisma.InputJsonValue,
        origem: 'MANUAL',
        ip: req.ip,
        contexto: 'Aba Fornecedores — Seção 11 v2',
      });
      return atualizado;
    },
  );
}

