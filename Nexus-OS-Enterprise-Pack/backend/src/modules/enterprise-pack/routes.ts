import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";

// Integração: ajuste o import do PrismaClient conforme o padrão do Nexus OS.
import { prisma } from "../../lib/prisma.js";
import {
  enterpriseModuleFields,
  STATUS_MANUAIS,
  STATUS_DE_SISTEMA,
  CAMPOS_DATA,
  SITUACOES_FISCAIS_PROIBIDAS,
  dataValida,
} from "./validation.js";

/**
 * PERMISSÕES
 * Cada módulo usa as ações: visualizar, criar, editar, excluir, aprovar, administrar.
 * As permissões são lidas do banco (tabela Permissao), como no restante do Nexus OS.
 * Ausência de linha = negado.
 *
 * ATENÇÃO: os módulos abaixo precisam existir no catálogo de permissões do Nexus
 * (lib/permissoes-catalogo.ts) para que o administrador consiga concedê-los.
 */

const moduleDefinitions = [
  { id: "financeiro", label: "Financeiro", description: "Contas a pagar e a receber, vencimentos e situação." },
  { id: "contabilidade", label: "Contabilidade", description: "Plano de contas e lançamentos contábeis." },
  { id: "fiscal", label: "Fiscal", description: "Registro de documentos fiscais. Não emite nem transmite." },
  { id: "patrimonio", label: "Ativo fixo e patrimônio", description: "Bens e dados de aquisição." },
  { id: "compras", label: "Solicitações e cotações", description: "Solicitar compras e registrar cotações." },
  { id: "producao", label: "Ordens de produção", description: "Ordens, quantidades e responsáveis." },
  { id: "contratos", label: "Contratos", description: "Partes, vigência e valores." },
  { id: "servicos", label: "Ordens de serviço", description: "Abertura, responsável e prazo." },
  { id: "orcamentos", label: "Orçamentos e centros de custo", description: "Valor previsto e realizado por centro de custo." },
  { id: "recrutamento", label: "Recrutamento e seleção", description: "Vagas, candidatos e etapas." },
  { id: "medicina_trabalho", label: "Medicina do trabalho", description: "Exames e atestados. Acesso restrito." },
  { id: "cargos_salarios", label: "Cargos e salários", description: "Cargos, níveis e faixas salariais." },
  { id: "aprovacoes", label: "Aprovações", description: "Fluxo genérico de aprovação." },
  { id: "relatorios", label: "Relatórios salvos", description: "Configurações de relatórios do usuário." },
] as const;

type ModuleId = (typeof moduleDefinitions)[number]["id"];
const moduleIds = moduleDefinitions.map((m) => m.id) as ModuleId[];
const moduleSchema = z.enum(moduleIds as [ModuleId, ...ModuleId[]]);

const statusSchema = z.string().trim().min(2).max(40);

const createSchema = z.object({
  module: moduleSchema,
  title: z.string().trim().min(2).max(180),
  status: statusSchema.optional(),
  data: z.record(z.unknown()),
});

const patchSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  status: statusSchema.optional(),
  data: z.record(z.unknown()).optional(),
});

function erro(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

function getIdentity(req: FastifyRequest) {
  // Ajuste para o contrato real de autenticação do Nexus OS (req.user).
  const user = (req as any).user;
  const empresaId = user?.empresaId;
  const actorId = user?.id;
  if (!empresaId || typeof empresaId !== "string") erro(401, "Empresa não identificada no contexto autenticado.");
  if (!actorId || typeof actorId !== "string" || actorId.trim() === "") erro(401, "Usuário não identificado no contexto autenticado.");
  return { empresaId: empresaId as string, actorId: actorId as string };
}

/** Carrega de uma vez todas as permissões do usuário, no formato "modulo:acao". */
async function carregarPermissoes(usuarioId: string): Promise<Set<string>> {
  const linhas = await prisma.permissao.findMany({
    where: { usuarioId, permitido: true },
    select: { modulo: true, acao: true },
  });
  return new Set(linhas.map((l) => `${l.modulo}:${l.acao}`));
}

function temPermissao(perms: Set<string>, modulo: string, acao: string): boolean {
  return perms.has(`${modulo}:${acao}`);
}

function exigirPermissao(perms: Set<string>, modulo: string, acao: string): void {
  if (!temPermissao(perms, modulo, acao)) erro(403, "Permissão negada.");
}

/**
 * Remove do retorno o campo de observação restrita de medicina do trabalho,
 * a menos que o usuário tenha a ação "administrar" nesse módulo.
 */
function sanitizar<T extends { module: string; data: unknown }>(registro: T, perms: Set<string>): T {
  if (registro.module !== "medicina_trabalho") return registro;
  if (temPermissao(perms, "medicina_trabalho", "administrar")) return registro;
  const d = { ...(registro.data as Record<string, unknown>) };
  delete d.observacaoRestrita;
  return { ...registro, data: d };
}

function validarStatus(status: string | undefined): void {
  if (status === undefined) return;
  if ((STATUS_DE_SISTEMA as readonly string[]).includes(status)) {
    erro(400, `O status "${status}" é definido pelo sistema (envio, aprovação ou arquivamento), não manualmente.`);
  }
  if (!(STATUS_MANUAIS as readonly string[]).includes(status)) {
    erro(400, `Status inválido. Use um de: ${STATUS_MANUAIS.join(", ")}.`);
  }
}

function validateModuleData(module: string, data: Record<string, unknown>): void {
  const obrigatorios: Record<string, string[]> = {
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
    relatorios: ["nome", "configuracao"],
  };

  // Só aceita campos que o módulo conhece. Evita gravar qualquer lixo no JSON.
  const conhecidos = new Set<string>(enterpriseModuleFields[module as keyof typeof enterpriseModuleFields]);
  const desconhecidos = Object.keys(data).filter((k) => !conhecidos.has(k));
  if (desconhecidos.length) erro(400, `Campos não reconhecidos para ${module}: ${desconhecidos.join(", ")}.`);

  const faltando = (obrigatorios[module] || []).filter((k) => data[k] === undefined || data[k] === null || data[k] === "");
  if (faltando.length) erro(400, `Campos obrigatórios para ${module}: ${faltando.join(", ")}.`);

  for (const campo of CAMPOS_DATA[module as keyof typeof CAMPOS_DATA] ?? []) {
    const valor = data[campo];
    if (valor !== undefined && valor !== null && valor !== "" && !dataValida(valor)) {
      erro(400, `${campo} deve ser uma data real no formato AAAA-MM-DD.`);
    }
  }

  if (module === "financeiro") {
    const valor = Number(data.valor);
    if (!Number.isFinite(valor) || valor <= 0) erro(400, "O valor financeiro deve ser maior que zero.");
    if (!["pagar", "receber"].includes(String(data.tipo))) erro(400, "tipo deve ser 'pagar' ou 'receber'.");
  }

  if (module === "contabilidade") {
    const valor = Number(data.valor);
    if (!Number.isFinite(valor) || valor <= 0) erro(400, "O valor do lançamento deve ser maior que zero.");
  }

  if (module === "contratos" && dataValida(data.inicio) && dataValida(data.fim) && String(data.fim) <= String(data.inicio)) {
    erro(400, "A data de fim do contrato deve ser posterior à data de início.");
  }

  if (module === "cargos_salarios" && Number(data.salarioMinimo) > Number(data.salarioMaximo)) {
    erro(400, "Salário mínimo não pode superar o máximo.");
  }

  if (module === "fiscal" && SITUACOES_FISCAIS_PROIBIDAS.includes(String(data.situacao).toLowerCase() as any)) {
    erro(400, "Não marque um documento como autorizado ou transmitido sem retorno real do provedor fiscal.");
  }
}

async function audit(
  empresaId: string,
  actorId: string | null,
  recordId: string | null,
  action: string,
  beforeData?: unknown,
  afterData?: unknown,
) {
  await prisma.nexusErpAuditLog.create({
    data: {
      empresaId,
      actorId,
      recordId,
      action,
      beforeData: beforeData === undefined ? Prisma.JsonNull : (beforeData as Prisma.InputJsonValue),
      afterData: afterData === undefined ? Prisma.JsonNull : (afterData as Prisma.InputJsonValue),
    },
  });
}

const CAMPOS_BUSCA = ["descricao", "fornecedorCliente", "vaga", "candidato", "parte", "cargo", "nome", "produto", "colaborador"];

export default async function enterprisePackRoutes(app: FastifyInstance) {
  // Todas as rotas do pacote exigem o mesmo login do restante do sistema.
  // O decorador `authenticate` é registrado globalmente no server.ts.
  app.addHook("preHandler", (app as any).authenticate);

  app.get("/modules", async (req) => {
    const { actorId } = getIdentity(req);
    const perms = await carregarPermissoes(actorId);
    return moduleDefinitions.filter((m) => temPermissao(perms, m.id, "visualizar"));
  });

  app.get("/records", async (req) => {
    const { empresaId, actorId } = getIdentity(req);
    const perms = await carregarPermissoes(actorId);
    const q = z
      .object({
        module: moduleSchema.optional(),
        search: z.string().max(120).optional(),
        status: z.string().max(40).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.query);

    const permitidos = moduleIds.filter((m) => temPermissao(perms, m, "visualizar"));
    if (q.module) exigirPermissao(perms, q.module, "visualizar");
    if (permitidos.length === 0) return { items: [], total: 0, page: q.page, pageSize: q.pageSize, pages: 0 };

    const where: Prisma.NexusErpRecordWhereInput = {
      empresaId,
      deletedAt: null,
      module: q.module ? q.module : { in: permitidos },
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: "insensitive" } },
              ...CAMPOS_BUSCA.map((campo) => ({ data: { path: [campo], string_contains: q.search } })),
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.nexusErpRecord.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.nexusErpRecord.count({ where }),
    ]);
    return {
      items: items.map((i) => sanitizar(i, perms)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      pages: Math.ceil(total / q.pageSize),
    };
  });

  app.post("/records", async (req, reply: FastifyReply) => {
    const { empresaId, actorId } = getIdentity(req);
    const perms = await carregarPermissoes(actorId);
    const body = createSchema.parse(req.body);
    exigirPermissao(perms, body.module, "criar");
    validarStatus(body.status);
    validateModuleData(body.module, body.data);

    const item = await prisma.nexusErpRecord.create({
      data: {
        empresaId,
        module: body.module,
        title: body.title,
        status: body.status ?? "rascunho",
        data: body.data as Prisma.InputJsonValue,
        createdById: actorId,
      },
    });
    await audit(empresaId, actorId, item.id, "criado", undefined, item);
    return reply.code(201).send(sanitizar(item, perms));
  });

  app.get("/records/:id", async (req, reply: FastifyReply) => {
    const { empresaId, actorId } = getIdentity(req);
    const perms = await carregarPermissoes(actorId);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const item = await prisma.nexusErpRecord.findFirst({
      where: { id, empresaId, deletedAt: null },
      include: { approvals: { orderBy: { createdAt: "desc" } } },
    });
    if (!item) return reply.code(404).send({ message: "Registro não encontrado." });
    exigirPermissao(perms, item.module, "visualizar");
    return sanitizar(item, perms);
  });

  app.patch("/records/:id", async (req, reply: FastifyReply) => {
    const { empresaId, actorId } = getIdentity(req);
    const perms = await carregarPermissoes(actorId);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = patchSchema.parse(req.body);

    const before = await prisma.nexusErpRecord.findFirst({ where: { id, empresaId, deletedAt: null } });
    if (!before) return reply.code(404).send({ message: "Registro não encontrado." });
    exigirPermissao(perms, before.module, "editar");
    if (before.status === "aguardando_aprovacao") erro(409, "Registro aguardando aprovação não pode ser editado.");

    validarStatus(body.status);
    // data substitui o conteúdo inteiro do registro; por isso validamos o conjunto completo.
    if (body.data) validateModuleData(before.module, body.data);

    const item = await prisma.nexusErpRecord.update({
      where: { id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.data ? { data: body.data as Prisma.InputJsonValue } : {}),
      },
    });
    await audit(empresaId, actorId, item.id, "alterado", before, item);
    return sanitizar(item, perms);
  });

  app.delete("/records/:id", async (req, reply: FastifyReply) => {
    const { empresaId, actorId } = getIdentity(req);
    const perms = await carregarPermissoes(actorId);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);

    const before = await prisma.nexusErpRecord.findFirst({ where: { id, empresaId, deletedAt: null } });
    if (!before) return reply.code(404).send({ message: "Registro não encontrado." });
    exigirPermissao(perms, before.module, "excluir");

    const item = await prisma.nexusErpRecord.update({
      where: { id },
      data: { deletedAt: new Date(), status: "arquivado" },
    });
    await audit(empresaId, actorId, item.id, "arquivado", before, item);
    return reply.code(204).send();
  });

  app.post("/records/:id/submit", async (req, reply: FastifyReply) => {
    const { empresaId, actorId } = getIdentity(req);
    const perms = await carregarPermissoes(actorId);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);

    const item = await prisma.nexusErpRecord.findFirst({ where: { id, empresaId, deletedAt: null } });
    if (!item) return reply.code(404).send({ message: "Registro não encontrado." });
    exigirPermissao(perms, item.module, "criar");
    if (["aprovado", "concluido", "arquivado", "aguardando_aprovacao"].includes(item.status)) {
      return reply.code(409).send({ message: `Não é possível enviar um registro no status ${item.status}.` });
    }

    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.nexusErpApproval.create({
        data: { empresaId, recordId: id, requestedBy: actorId, status: "pendente" },
      });
      const updated = await tx.nexusErpRecord.update({ where: { id }, data: { status: "aguardando_aprovacao" } });
      return { approval, updated };
    });
    await audit(empresaId, actorId, id, "enviado_para_aprovacao", item, result.updated);
    return reply.code(201).send({ approval: result.approval, updated: sanitizar(result.updated, perms) });
  });

  app.post("/records/:id/approve", async (req, reply: FastifyReply) => decide(req, reply, true));
  app.post("/records/:id/reject", async (req, reply: FastifyReply) => decide(req, reply, false));

  async function decide(req: FastifyRequest, reply: FastifyReply, aprovar: boolean) {
    const { empresaId, actorId } = getIdentity(req);
    const perms = await carregarPermissoes(actorId);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ comment: z.string().max(1000).optional() }).parse(req.body ?? {});

    const item = await prisma.nexusErpRecord.findFirst({ where: { id, empresaId, deletedAt: null } });
    if (!item) return reply.code(404).send({ message: "Registro não encontrado." });
    exigirPermissao(perms, item.module, "aprovar");

    const pending = await prisma.nexusErpApproval.findFirst({
      where: { recordId: id, empresaId, status: "pendente" },
      orderBy: { createdAt: "desc" },
    });
    if (!pending) return reply.code(404).send({ message: "Aprovação pendente não encontrada." });

    // Segregação de funções: quem solicitou não decide sobre a própria solicitação.
    if (pending.requestedBy === actorId || item.createdById === actorId) {
      return reply.code(403).send({ message: "Quem solicitou não pode aprovar ou rejeitar a própria solicitação." });
    }

    const novoStatus = aprovar ? "aprovado" : "rejeitado";
    const updated = await prisma.$transaction(async (tx) => {
      await tx.nexusErpApproval.update({
        where: { id: pending.id },
        data: { status: novoStatus, decidedBy: actorId, comment: body.comment, decidedAt: new Date() },
      });
      return tx.nexusErpRecord.update({ where: { id }, data: { status: novoStatus } });
    });
    await audit(empresaId, actorId, id, novoStatus, item, updated);
    return sanitizar(updated, perms);
  }

  app.get("/approvals", async (req) => {
    const { empresaId, actorId } = getIdentity(req);
    const perms = await carregarPermissoes(actorId);
    const pendentes = await prisma.nexusErpApproval.findMany({
      where: { empresaId, status: "pendente" },
      include: { record: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return pendentes
      .filter((a) => temPermissao(perms, a.record.module, "aprovar"))
      .map((a) => ({ ...a, record: sanitizar(a.record, perms) }));
  });

  app.get("/reports/summary", async (req) => {
    const { empresaId, actorId } = getIdentity(req);
    const perms = await carregarPermissoes(actorId);
    const permitidos = moduleIds.filter((m) => temPermissao(perms, m, "visualizar"));

    const [total, byModule, pendentes] = await Promise.all([
      prisma.nexusErpRecord.count({ where: { empresaId, deletedAt: null, module: { in: permitidos } } }),
      prisma.nexusErpRecord.groupBy({
        by: ["module"],
        where: { empresaId, deletedAt: null, module: { in: permitidos } },
        _count: { _all: true },
      }),
      prisma.nexusErpApproval.findMany({
        where: { empresaId, status: "pendente" },
        include: { record: { select: { module: true } } },
        take: 1000,
      }),
    ]);

    const pendingApprovals = pendentes.filter((a) => temPermissao(perms, a.record.module, "aprovar")).length;

    let payable = 0;
    let receivable = 0;
    if (temPermissao(perms, "financeiro", "visualizar")) {
      const financeiros = await prisma.nexusErpRecord.findMany({
        where: { empresaId, module: "financeiro", deletedAt: null },
        select: { data: true },
      });
      for (const r of financeiros) {
        const d = r.data as Record<string, unknown>;
        const valor = Number(d.valor);
        if (!Number.isFinite(valor) || valor <= 0) continue;
        const situacao = String(d.situacao ?? "aberto");
        const emAberto = !["pago", "recebido", "cancelado"].includes(situacao);
        if (!emAberto) continue;
        if (d.tipo === "pagar") payable += valor;
        if (d.tipo === "receber") receivable += valor;
      }
    }

    return {
      total,
      pendingApprovals,
      byModule: byModule.map((x) => ({ module: x.module, count: x._count._all })),
      financial: temPermissao(perms, "financeiro", "visualizar") ? { payable, receivable } : null,
    };
  });
}
