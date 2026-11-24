// NEXUS AI — cliente das rotas /api/v1/nexus-ai. A chave do provedor de IA nunca passa pelo navegador.
import api from '@/lib/api';

export interface AgenteIA { id: string; nome: string; descricao: string; versao: string; autonomiaMax: number; disponivel: boolean }
export interface FonteIA { ferramenta: string; args: unknown }
export interface VerificacaoIA { aprovada: boolean; numeros: { texto: string; valor: number; conferido: boolean }[]; divergentes: string[] }
export interface ResultadoIA {
  execucaoId: string; conversaId: string | null; status: string; resposta: string | null;
  detalhes: { fontes: FonteIA[]; verificacao: VerificacaoIA | null; limitacoes: string | null; agente: string; modelo: string | null } | null;
}
export interface MensagemIA { id: string; papel: 'USUARIO' | 'NEXUS'; conteudo: string; detalhes: ResultadoIA['detalhes']; execucaoId: string | null; createdAt: string }
export interface ConsumoIA { uso: { execucoes: number; tokensEntrada: number; tokensSaida: number; custoCentavos: number }; limites: { execucoesMes: number; custoMesCentavos: number; bloqueadoManualmente: boolean }; percentual: number; alerta: boolean; bloqueado: boolean; motivo: string | null }

const B = '/api/v1/nexus-ai';
export const nexusAi = {
  agentes: () => api.get<{ agentes: AgenteIA[]; provedor: { nome: string; configurado: boolean; circuito: { aberto: boolean } } }>(`${B}/agentes`).then((r) => r.data),
  perguntar: (corpo: { pergunta: string; agente: string; conversaId?: string; idempotencyKey: string }) => api.post<ResultadoIA>(`${B}/perguntar`, corpo).then((r) => r.data),
  retomar: (execucaoId: string) => api.post<ResultadoIA>(`${B}/execucoes/${execucaoId}/retomar`, {}).then((r) => r.data),
  conversas: () => api.get<{ conversas: { id: string; titulo: string; updatedAt: string }[] }>(`${B}/conversas`).then((r) => r.data.conversas),
  conversa: (id: string) => api.get<{ id: string; titulo: string; mensagens: MensagemIA[] }>(`${B}/conversas/${id}`).then((r) => r.data),
  consumo: () => api.get<ConsumoIA>(`${B}/consumo`).then((r) => r.data),
};

/** Nomes amigáveis das ferramentas (fontes mostradas ao usuário). */
export const NOME_FERRAMENTA: Record<string, string> = {
  visao_geral_empresa: 'Visão geral da empresa', listar_filiais: 'Filiais', buscar_produtos: 'Busca de produtos', saldo_estoque: 'Saldo de estoque',
  produtos_abaixo_minimo: 'Produtos abaixo do mínimo', movimentacoes_estoque: 'Movimentações de estoque', giro_estoque: 'Giro e cobertura',
  produtos_parados: 'Produtos parados', rupturas_estoque: 'Rupturas', sugestao_reposicao: 'Sugestão de reposição', composicao_kit: 'Composição de kit',
};

export const novaChaveIA = () => `ia-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
