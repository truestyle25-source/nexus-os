// NEXUS AI — cliente das rotas /api/v1/nexus-ai. A chave do provedor de IA nunca passa pelo navegador.
import api from '@/lib/api';

export interface AgenteIA { id: string; nome: string; descricao: string; versao: string; autonomiaMax: number; disponivel: boolean }
export interface FonteIA { ferramenta: string; args: unknown }
export interface VerificacaoIA { aprovada: boolean; numeros: { texto: string; valor: number; conferido: boolean }[]; divergentes: string[] }
export interface ResultadoIA {
  execucaoId: string; conversaId: string | null; status: string; resposta: string | null;
  detalhes: { fontes: FonteIA[]; verificacao: VerificacaoIA | null; limitacoes: string | null; agente: string; modelo: string | null; avaliacao?: 'CORRETA' | 'INCORRETA' | null } | null;
}
export interface MensagemIA { id: string; papel: 'USUARIO' | 'NEXUS'; conteudo: string; detalhes: ResultadoIA['detalhes']; execucaoId: string | null; status?: string | null; createdAt: string }
export interface ConsumoIA { uso: { execucoes: number; tokensEntrada: number; tokensSaida: number; custoCentavos: number }; limites: { execucoesMes: number; custoMesCentavos: number; bloqueadoManualmente: boolean }; percentual: number; alerta: boolean; bloqueado: boolean; motivo: string | null }

export interface MemoriaIA { id: string; tipo: string; titulo: string; conteudo: string; updatedAt: string }
export interface DocumentoIA { id: string; titulo: string; modulo: string | null; caracteres: number; trechos: number; createdAt: string }
export interface InsightIA { id: string; origem: string; tipo: string; modulo: string; severidade: string; titulo: string; descricao: string; evidencias: Record<string, unknown> | null; status: string; createdAt: string }
export interface AprovacaoIA { id: string; acao: string; titulo: string; proposta: Record<string, unknown>; impacto: string | null; valorCentavos: number | null; nivel: number; status: string; decididoPor: string | null; decididoEm: string | null; motivo: string | null; resultado: Record<string, unknown> | null; erro: string | null; expiraEm: string; createdAt: string; podeDecidir: boolean }
export interface AutomacoesIA { regras: { tipo: string; nome: string; regra: string; severidade: string; eventos7dias: number }[]; insightsDiarios: { eventos7dias: number; regra: string }; filaPendente: number; avaliacoes: { corretas: number; incorretas: number; ultimasIncorretas: { id: string; agente: string; pergunta: string; comentario: string | null; quando: string }[] | null }; acoes: { acao: string; nome: string; descricao: string; permissao: string; ativa: boolean; valorMaxCentavos: number | null }[] }
export const TIPOS_MEMORIA: [string, string][] = [['META', 'Meta'], ['POLITICA', 'Política'], ['CRITERIO', 'Critério'], ['PREFERENCIA', 'Preferência'], ['DECISAO', 'Decisão']];

const B = '/api/v1/nexus-ai';
export const nexusAi = {
  agentes: () => api.get<{ agentes: AgenteIA[]; provedor: { nome: string; configurado: boolean; circuito: { aberto: boolean } } }>(`${B}/agentes`).then((r) => r.data),
  perguntar: (corpo: { pergunta: string; agente: string; conversaId?: string; idempotencyKey: string; modo?: 'texto' | 'voz' }) => api.post<ResultadoIA>(`${B}/perguntar`, corpo).then((r) => r.data),
  avaliar: (execucaoId: string, avaliacao: 'CORRETA' | 'INCORRETA', comentario?: string) => api.post(`${B}/execucoes/${execucaoId}/avaliacao`, { avaliacao, comentario }).then((r) => r.data),
  retomar: (execucaoId: string) => api.post<ResultadoIA>(`${B}/execucoes/${execucaoId}/retomar`, {}).then((r) => r.data),
  conversas: () => api.get<{ conversas: { id: string; titulo: string; updatedAt: string }[] }>(`${B}/conversas`).then((r) => r.data.conversas),
  conversa: (id: string) => api.get<{ id: string; titulo: string; mensagens: MensagemIA[] }>(`${B}/conversas/${id}`).then((r) => r.data),
  consumo: () => api.get<ConsumoIA>(`${B}/consumo`).then((r) => r.data),
  memoria: () => api.get<{ itens: MemoriaIA[] }>(`${B}/memoria`).then((r) => r.data.itens),
  salvarMemoria: (d: { tipo: string; titulo: string; conteudo: string }) => api.post<MemoriaIA>(`${B}/memoria`, d).then((r) => r.data),
  excluirMemoria: (id: string) => api.delete(`${B}/memoria/${id}`).then((r) => r.data),
  documentos: () => api.get<{ documentos: DocumentoIA[] }>(`${B}/documentos`).then((r) => r.data.documentos),
  adicionarDocumento: (d: { titulo: string; conteudo: string }) => api.post(`${B}/documentos`, d).then((r) => r.data),
  excluirDocumento: (id: string) => api.delete(`${B}/documentos/${id}`).then((r) => r.data),
  insights: (status?: string) => api.get<{ insights: InsightIA[] }>(`${B}/insights`, { params: status ? { status } : {} }).then((r) => r.data.insights),
  proporBloqueio: (insightId: string) => api.post<AprovacaoIA>(`${B}/insights/${insightId}/propor-bloqueio`, {}).then((r) => r.data),
  marcarInsight: (id: string, status: 'ABERTO' | 'LIDO' | 'DESCARTADO') => api.post<InsightIA>(`${B}/insights/${id}/status`, { status }).then((r) => r.data),
  aprovacoes: (status?: string) => api.get<{ aprovacoes: AprovacaoIA[] }>(`${B}/aprovacoes`, { params: status ? { status } : {} }).then((r) => r.data.aprovacoes),
  decidir: (id: string, decisao: 'aprovar' | 'rejeitar', motivo?: string) => api.post<AprovacaoIA>(`${B}/aprovacoes/${id}/${decisao}`, { motivo }).then((r) => r.data),
  automacoes: () => api.get<AutomacoesIA>(`${B}/automacoes`).then((r) => r.data),
  salvarAutomacao: (acao: string, d: { ativa: boolean; valorMaxCentavos: number | null }) => api.put(`${B}/automacoes/${acao}`, d).then((r) => r.data),
};

/** Nomes amigáveis das ferramentas (fontes mostradas ao usuário). */
export const NOME_FERRAMENTA: Record<string, string> = {
  visao_geral_empresa: 'Visão geral da empresa', listar_filiais: 'Filiais', buscar_produtos: 'Busca de produtos', saldo_estoque: 'Saldo de estoque',
  produtos_abaixo_minimo: 'Produtos abaixo do mínimo', movimentacoes_estoque: 'Movimentações de estoque', giro_estoque: 'Giro e cobertura',
  produtos_parados: 'Produtos parados', rupturas_estoque: 'Rupturas', sugestao_reposicao: 'Sugestão de reposição', composicao_kit: 'Composição de kit',
  resumo_vendas: 'Resumo de vendas', vendas_por_dia: 'Vendas por dia', vendas_por_produto: 'Vendas por produto', margem_por_produto: 'Margem por produto', vendas_por_vendedor: 'Vendas por vendedor', clientes_principais: 'Clientes',
  resumo_financeiro: 'Resumo financeiro', contas_vencidas: 'Contas vencidas', fluxo_caixa_projetado: 'Fluxo de caixa projetado', despesas_por_categoria: 'Despesas por categoria', resultado_periodo: 'Resultado (DRE)',
  consultar_especialista: 'Consulta a especialista', consultar_memoria: 'Memória da empresa', buscar_documentos: 'Documentos internos', investigacoes_anteriores: 'Investigações anteriores',
  previsao_demanda: 'Previsão de demanda', previsao_caixa: 'Previsão de caixa', detectar_anomalias: 'Detecção de anomalias', simular_preco: 'Simulação de preço',
  propor_compra_reposicao: 'Proposta de compra', propor_ajuste_estoque_minimo: 'Proposta de estoque mínimo',
  resumo_compras: 'Resumo de compras', compras_pendentes: 'Pedidos pendentes', historico_custo_produto: 'Histórico de custo', comparar_fornecedores: 'Comparação de fornecedores',
};

/** Remove marcações de markdown que o modelo às vezes devolve (negrito, crases, títulos, marcadores). */
export const limparTextoIA = (t: string) => t.replace(/\*\*/g, '').replace(/`/g, '').replace(/^#{1,6}\s*/gm, '').replace(/^(\s*)\* /gm, '$1• ');

export const novaChaveIA = () => `ia-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
