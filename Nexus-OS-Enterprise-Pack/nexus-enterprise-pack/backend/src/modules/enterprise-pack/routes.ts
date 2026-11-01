import { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";

// Integração: ajuste o import do PrismaClient conforme o padrão do Nexus OS.
import { prisma } from "../../lib/prisma";

const moduleDefinitions = [
  { id: "financeiro", label: "Financeiro", description: "Contas a pagar/receber, fluxo de caixa e conciliação." },
  { id: "contabilidade", label: "Contabilidade", description: "Plano de contas e lançamentos contábeis." },
  { id: "fiscal", label: "Fiscal", description: "Documentos fiscais e acompanhamento de transmissão." },
  { id: "patrimonio", label: "Ativo fixo e patrimônio", description: "Bens, depreciação e movimentações." },
  { id: "compras", label: "Solicitações e cotações", description: "Solicitar, cotar, comparar e aprovar compras." },
  { id: "producao", label: "Ordens de produção", description: "Ordens, quantidades, consumo e apontamentos." },
  { id: "contratos", label: "Contratos", description: "Partes, vigência, valores e renovação." },
  { id: "servicos", label: "Ordens de serviço", description: "Abertura, responsável, prazo e execução." },
  { id: "orcamentos", label: "Orçamentos e centros de custo", description: "Planejamento e acompanhamento orçamentário." },
  { id: "recrutamento", label: "Recrutamento e seleção", description: "Vagas, candidatos e etapas seletivas." },
  { id: "medicina_trabalho", label: "Medicina do trabalho", description: "Controle mínimo de exames e atestados; acesso restrito." },
  { id: "cargos_salarios", label: "Cargos e salários", description: "Cargos, níveis e faixas salariais." },
  { id: "aprovacoes", label: "Aprovações", description: "Fluxo genérico de aprovação." },
  { id: "relatorios", label: "Relatórios salvos", description: "Definições de relatórios criados pelo usuário." },
] as const;

const moduleIds = moduleDefinitions.map(m => m.id);
const moduleSchema = z.enum([
  "financeiro", "contabilidade", "fiscal", "patrimonio", "compras", "producao",
  "contratos", "servicos", "orcamentos", "recrutamento", "medicina_trabalho",
  "cargos_salarios", "aprovacoes", "relatorios"
]);

const createSchema = z.object({
  module: moduleSchema,
  title: z.string().trim().min(2).max(180),
  status: z.string().trim().min(2).max(40).optional(),
  data: z.record(z.unknown())
});

const patchSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  status: z.string().trim().min(2).max(40).optional(),
  data: z.record(z.unknown()).optional()
});

function getIdentity(req: FastifyRequest) {
  // Ajuste para o contrato de autenticação real do Nexus OS.
  const user = (req as any).user;
  const empresaId = user?.empresaId ?? user?.companyId;
  const actorId = user?.id ?? user?.userId ?? null;
  if (!empresaId) {
    const err: any = new Error("Empresa não identificada no contexto autenticado.");
    err.statusCode = 401;
    throw err;
  }
  return { empresaId: String(empresaId), actorId: actorId ? String(actorId) : null };
}

function validateModuleData(module: string, data: Record<string, unknown>) {
  const required: Record<string, string[]> = {
    financeiro: ["tipo", "valor", "vencimento"],
    contabilidade: ["data", "contaDebito", "contaCredito", "valor"],
    fiscal: ["tipoDocumento", "numero"],
    patrimonio: ["descricao", "valorAquisicao"],
    compras: ["solicitante", "itens"],
    producao: ["produto", "quantidadePlanejada"],
    contratos: ["parte", "inicio", "fim"],
    servicos: ["solicitante", "descricao"],
    orcamentos: ["centroCusto", "periodo", "valorPrevisto"],
    recrutamento: ["vaga", "candidato"],
    medicina_trabalho: ["colaborador", "tipoRegistro", "data"],
    cargos_salarios: ["cargo", "salarioMinimo", "salarioMaximo"],
    aprovacoes: ["solicitante", "motivo"],
    relatorios: ["nome", "configuracao"]
  };
  const missing = (required[module] || []).filter(key => data[key] === undefined || data[key] === null || data[key] === "");
  if (missing.length) {
    const err: any = new Error(`Campos obrigatórios para ${module}: ${missing.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
  if (module === "financeiro") {
    const amount = Number(data.valor);
    if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error("O valor financeiro deve ser maior que zero."), { statusCode: 400 });
    if (!["pagar", "receber"].includes(String(data.tipo))) throw Object.assign(new Error("tipo deve ser 'pagar' ou 'receber'."), { statusCode: 400 });
  }
  if (module === "cargos_salarios" && Number(data.salarioMinimo) > Number(data.salarioMaximo)) {
    throw Object.assign(new Error("Salário mínimo não pode superar o máximo."), { statusCode: 400 });
  }
  if (module === "fiscal" && ["autorizada", "transmitida"].includes(String(data.situacao).toLowerCase())) {
    throw Object.assign(new Error("Não marque uma NF como autorizada/transmitida sem retorno real do provedor fiscal/SEFAZ."), { statusCode: 400 });
  }
}

async function audit(empresaId: string, actorId: string | null, recordId: string | null, action: string, beforeData?: unknown, afterData?: unknown) {
  await prisma.nexusErpAuditLog.create({
    data: {
      empresaId, actorId, recordId, action,
      beforeData: beforeData === undefined ? Prisma.JsonNull : beforeData as Prisma.InputJsonValue,
      afterData: afterData === undefined ? Prisma.JsonNull : afterData as Prisma.InputJsonValue
    }
  });
}

export default async function enterprisePackRoutes(app: FastifyInstance) {
  app.get("/modules", async () => moduleDefinitions);

  app.get("/records", async (req) => {
    const { empresaId } = getIdentity(req);
    const q = z.object({
      module: moduleSchema.optional(),
      search: z.string().optional(),
      status: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20)
    }).parse(req.query);
    const where: Prisma.NexusErpRecordWhereInput = {
      empresaId, deletedAt: null,
      ...(q.module ? { module: q.module } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" } }, { data: { path: ["descricao"], string_contains: q.search } }] } : {})
    };
    const [items, total] = await Promise.all([
      prisma.nexusErpRecord.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.nexusErpRecord.count({ where })
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, pages: Math.ceil(total / q.pageSize) };
  });

  app.post("/records", async (req, reply) => {
    const { empresaId, actorId } = getIdentity(req);
    const body = createSchema.parse(req.body);
    validateModuleData(body.module, body.data);
    const item = await prisma.nexusErpRecord.create({
      data: { empresaId, module: body.module, title: body.title, status: body.status ?? "rascunho", data: body.data as Prisma.InputJsonValue, createdById: actorId }
    });
    await audit(empresaId, actorId, item.id, "criado", undefined, item as unknown);
    return reply.code(201).send(item);
  });

  app.get("/records/:id", async (req, reply) => {
    const { empresaId } = getIdentity(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const item = await prisma.nexusErpRecord.findFirst({ where: { id, empresaId, deletedAt: null }, include: { approvals: { orderBy: { createdAt: "desc" } } } });
    if (!item) return reply.code(404).send({ message: "Registro não encontrado." });
    return item;
  });

  app.patch("/records/:id", async (req, reply) => {
    const { empresaId, actorId } = getIdentity(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = patchSchema.parse(req.body);
    const before = await prisma.nexusErpRecord.findFirst({ where: { id, empresaId, deletedAt: null } });
    if (!before) return reply.code(404).send({ message: "Registro não encontrado." });
    if (body.data) validateModuleData(before.module, body.data);
    const item = await prisma.nexusErpRecord.update({
      where: { id },
      data: { ...(body.title ? { title: body.title } : {}), ...(body.status ? { status: body.status } : {}), ...(body.data ? { data: body.data as Prisma.InputJsonValue } : {}) }
    });
    await audit(empresaId, actorId, item.id, "alterado", before as unknown, item as unknown);
    return item;
  });

  app.delete("/records/:id", async (req, reply) => {
    const { empresaId, actorId } = getIdentity(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const before = await prisma.nexusErpRecord.findFirst({ where: { id, empresaId, deletedAt: null } });
    if (!before) return reply.code(404).send({ message: "Registro não encontrado." });
    const item = await prisma.nexusErpRecord.update({ where: { id }, data: { deletedAt: new Date(), status: "arquivado" } });
    await audit(empresaId, actorId, item.id, "arquivado", before as unknown, item as unknown);
    return reply.code(204).send();
  });

  app.post("/records/:id/submit", async (req, reply) => {
    const { empresaId, actorId } = getIdentity(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const item = await prisma.nexusErpRecord.findFirst({ where: { id, empresaId, deletedAt: null } });
    if (!item) return reply.code(404).send({ message: "Registro não encontrado." });
    if (["aprovado", "concluido", "arquivado"].includes(item.status)) return reply.code(409).send({ message: `Não é possível enviar um registro no status ${item.status}.` });
    const result = await prisma.$transaction(async tx => {
      const approval = await tx.nexusErpApproval.create({ data: { empresaId, recordId: id, requestedBy: actorId, status: "pendente" } });
      const updated = await tx.nexusErpRecord.update({ where: { id }, data: { status: "aguardando_aprovacao" } });
      return { approval, updated };
    });
    await audit(empresaId, actorId, id, "enviado_para_aprovacao", item as unknown, result.updated as unknown);
    return reply.code(201).send(result);
  });

  app.post("/records/:id/approve", async (req, reply) => decide(req, reply, true));
  app.post("/records/:id/reject", async (req, reply) => decide(req, reply, false));

  async function decide(req: FastifyRequest, reply: any, approve: boolean) {
    const { empresaId, actorId } = getIdentity(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ comment: z.string().max(1000).optional() }).parse(req.body ?? {});
    const pending = await prisma.nexusErpApproval.findFirst({ where: { recordId: id, empresaId, status: "pendente" }, orderBy: { createdAt: "desc" } });
    const item = await prisma.nexusErpRecord.findFirst({ where: { id, empresaId, deletedAt: null } });
    if (!pending || !item) return reply.code(404).send({ message: "Aprovação pendente não encontrada." });
    const nextStatus = approve ? "aprovado" : "rejeitado";
    const updated = await prisma.$transaction(async tx => {
      await tx.nexusErpApproval.update({ where: { id: pending.id }, data: { status: nextStatus, decidedBy: actorId, comment: body.comment, decidedAt: new Date() } });
      return tx.nexusErpRecord.update({ where: { id }, data: { status: nextStatus } });
    });
    await audit(empresaId, actorId, id, nextStatus, item as unknown, updated as unknown);
    return updated;
  }

  app.get("/approvals", async req => {
    const { empresaId } = getIdentity(req);
    return prisma.nexusErpApproval.findMany({
      where: { empresaId, status: "pendente" },
      include: { record: true }, orderBy: { createdAt: "asc" }, take: 100
    });
  });

  app.get("/reports/summary", async req => {
    const { empresaId } = getIdentity(req);
    const [total, pending, byModule, financial] = await Promise.all([
      prisma.nexusErpRecord.count({ where: { empresaId, deletedAt: null } }),
      prisma.nexusErpApproval.count({ where: { empresaId, status: "pendente" } }),
      prisma.nexusErpRecord.groupBy({ by: ["module"], where: { empresaId, deletedAt: null }, _count: { _all: true } }),
      prisma.nexusErpRecord.findMany({ where: { empresaId, module: "financeiro", deletedAt: null }, select: { data: true } })
    ]);
    let payable = 0, receivable = 0;
    for (const r of financial) {
      const d = r.data as Record<string, unknown>;
      const value = Number(d.valor);
      if (Number.isFinite(value) && value > 0 && d.tipo === "pagar" && !["pago", "cancelado"].includes(String(d.situacao))) payable += value;
      if (Number.isFinite(value) && value > 0 && d.tipo === "receber" && !["recebido", "cancelado"].includes(String(d.situacao))) receivable += value;
    }
    return { total, pendingApprovals: pending, byModule: byModule.map(x => ({ module: x.module, count: x._count._all })), financial: { payable, receivable } };
  });
}
