// Regras compartilhadas de validação do Enterprise Pack.
// Usadas por routes.ts. Nenhuma regra de permissão mora aqui: ela fica em routes.ts.

export const enterpriseModuleFields = {
  financeiro: ["tipo", "valor", "vencimento", "situacao", "fornecedorCliente", "centroCusto", "formaPagamento", "documento"],
  contabilidade: ["data", "contaDebito", "contaCredito", "valor", "historico", "documento"],
  fiscal: ["tipoDocumento", "numero", "serie", "chaveAcesso", "situacao", "provedor", "protocolo"],
  patrimonio: ["descricao", "numeroPatrimonio", "valorAquisicao", "dataAquisicao", "vidaUtilMeses", "valorResidual", "localizacao"],
  compras: ["solicitante", "itens", "fornecedor", "valorEstimado", "dataNecessidade", "cotacoes", "justificativa"],
  producao: ["produto", "quantidadePlanejada", "quantidadeProduzida", "inicioPrevisto", "fimPrevisto", "materiais", "responsavel"],
  contratos: ["parte", "documentoParte", "inicio", "fim", "valor", "renovacaoAutomatica", "arquivoUrl", "responsavel"],
  servicos: ["solicitante", "descricao", "prioridade", "responsavel", "prazo", "equipamento", "solucao"],
  orcamentos: ["centroCusto", "periodo", "valorPrevisto", "valorRealizado", "responsavel"],
  recrutamento: ["vaga", "candidato", "etapa", "contato", "entrevistaEm", "avaliacao", "responsavel"],
  medicina_trabalho: ["colaborador", "tipoRegistro", "data", "validade", "statusAptidao", "observacaoRestrita"],
  cargos_salarios: ["cargo", "nivel", "salarioMinimo", "salarioMaximo", "faixaReferencia", "vigencia"],
  aprovacoes: ["solicitante", "motivo", "valor", "aprovadores", "prazo"],
  relatorios: ["nome", "configuracao", "compartilhadoCom", "ultimaExecucao"],
} as const;

/**
 * Status que o usuário pode escolher manualmente.
 * Status de decisão e de arquivamento NÃO podem ser definidos direto:
 *  - "aprovado" / "rejeitado" só existem via POST /approve e /reject;
 *  - "aguardando_aprovacao" só existe via POST /submit;
 *  - "arquivado" só existe via DELETE (soft delete).
 * Isso fecha a brecha em que um PATCH marcava um registro como aprovado sem aprovação.
 */
export const STATUS_MANUAIS = [
  "rascunho",
  "em_andamento",
  "concluido",
  "cancelado",
] as const;

export const STATUS_DE_SISTEMA = ["aguardando_aprovacao", "aprovado", "rejeitado", "arquivado"] as const;

/** Campos que devem ser datas reais no formato AAAA-MM-DD. */
export const CAMPOS_DATA: Partial<Record<keyof typeof enterpriseModuleFields, string[]>> = {
  financeiro: ["vencimento"],
  contabilidade: ["data"],
  patrimonio: ["dataAquisicao"],
  compras: ["dataNecessidade"],
  producao: ["inicioPrevisto", "fimPrevisto"],
  contratos: ["inicio", "fim"],
  servicos: ["prazo"],
  recrutamento: ["entrevistaEm"],
  medicina_trabalho: ["data", "validade"],
  cargos_salarios: ["vigencia"],
};

/** Situações de documento fiscal que só um provedor real pode informar. */
export const SITUACOES_FISCAIS_PROIBIDAS = ["autorizada", "autorizado", "transmitida", "transmitido"] as const;

export function dataValida(valor: unknown): boolean {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [ano, mes, dia] = valor.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}
