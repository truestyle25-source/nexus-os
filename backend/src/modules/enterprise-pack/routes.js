// Rotas do Enterprise Pack do Nexus OS
// Controla permissões por módulo e ação, segregação de funções e validação de datas e status

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

async function findReportsSummary(app) {
  return async (req, reply) => {
    const { empresaId } = getIdentity(req);
    const [total, pending, byModule, financial] = await Promise.all([
      prisma.nexusErpRecord.count({ where: { empresaId, deletedAt: null } }),
      prisma.nexusErpApproval.count({ where: { empresaId, status: "pendente" } }),
      prisma.nexusErpRecord.groupBy({ by: ["module"], where: { empresaId, deletedAt: null }, _count: { _all: true } }),
      prisma.nexusErpRecord.findMany({ where: { empresaId, module: "financeiro", deletedAt: null }, select: { data: true } })
    ]);

    let payable = 0, receivable = 0;
    for (const r of financial) {
      const d = r.data as unknown as Record<string, unknown>;
      const value = Number(d.valor);
      if (Number.isFinite(value) && value > 0 && d.tipo === "pagar" && !["pago", "cancelado"].includes(String(d.situacao))) payable += value;
      if (Number.isFinite(value) && value > 0 && d.tipo === "receber" && !["recebido", "cancelado"].includes(String(d.situacao))) receivable += value;
    }

    return {
      total,
      pendingApprovals: pending,
      byModule: byModule.map(x => ({ module: x.module, count: x._count._all })),
      financial: { payable, receivable }
    };
  };
}

// Função de auditoria (adaptada do pacote original)
async function audit(empresaId: string, actorId: string | null, recordId: string, action: string, oldValue: unknown, newValue: unknown) {
  try {
    await prisma.nexusErpAuditLog.create({
      data: { empresaId, actorId, recordId, action, oldValue: oldValue ?? null, newValue: newValue ?? null, createdAt: new Date() }
    });
  } catch (e) {
    // Auditoría opcional - não interrompe a operação se falhar
  }
}

// Registrar todas as rotas no aplicativo Fastify
export default async function enterprisePackRoutes(app: FastifyInstance) {
  app.post("/records", createRecord(app));
  app.get("/records", findManyRecords(app));
  app.get("/records/:id", findOneRecord(app));
  app.patch("/records/:id/status", updateStatus(app));
  app.post("/records/:id/approve", approveRecord(app));
  app.post("/records/:id/reject", rejectRecord(app));
  app.get("/approvals", findPendingApprovals(app));
  app.get("/reports/summary", findReportsSummary(app));
}

export const enterprisePackRoutes = Route;