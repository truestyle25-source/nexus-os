// Referência de campos por módulo para formulários e integrações.
// As validações de segurança e regras obrigatórias vivem no routes.ts.
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
  relatorios: ["nome", "configuracao", "compartilhadoCom", "ultimaExecucao"]
} as const;
