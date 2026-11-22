// Central de Integrações — tipos e chamadas de GET /integracoes/central/painel e /integracoes/central/:provedor (a rota /integracoes/central é da Importação).
// Nenhum segredo é guardado no navegador: os campos secretos só existem no estado do formulário
// enquanto a janela está aberta; depois de salvos, o servidor devolve apenas a máscara (••••1234).
import api from '@/lib/api';

export type StatusCentral = 'NAO_CONFIGURADO' | 'CREDENCIAIS_SALVAS' | 'AGUARDANDO_AUTORIZACAO' | 'CONECTADO' | 'EXPIRADO' | 'ERRO' | 'DESCONECTADO' | 'INDISPONIVEL';
export type Disponibilidade = 'OAUTH_PLATAFORMA' | 'CREDENCIAIS' | 'BLOQUEIO_EXTERNO' | 'PLANEJADA';

export interface CampoProvedor {
  chave: string; rotulo: string; tipo: 'texto' | 'segredo' | 'selecao' | 'url';
  obrigatorio: boolean; secreto: boolean; opcoes?: { valor: string; rotulo: string }[]; ajuda?: string; avancado?: boolean;
}
export interface Provedor { id: string; nome: string; autenticacao: string; disponibilidade: Disponibilidade; campos: CampoProvedor[]; pendencia: string | null; documentacao: string | null }
export interface EstadoProvedor { provedor: string; status: StatusCentral; conta: string | null; ultimoTesteEm: string | null; ultimoSyncEm: string | null; conectadoEm: string | null }
export interface ResumoCentral { conectadas: number; comErro: number; naoConfiguradas: number; indisponiveis: number; total: number; saude: number | null }
export interface Central { provedores: Provedor[]; estados: EstadoProvedor[]; resumo: ResumoCentral }
export interface ConfiguracaoProvedor extends EstadoProvedor { erro: string | null; configuracao: { config: Record<string, string>; segredosSalvos: Record<string, string | null> } | null }
export interface ResultadoTeste { ok: boolean; codigo: string; mensagem: string; conta?: { nome: string; documento?: string | null } | null; status?: string }
export interface EventoIntegracao { id: string; operacao: string; resultado: 'SUCESSO' | 'FALHA'; codigoErro: string | null; mensagem: string | null; duracaoMs: number | null; usuario: string | null; em: string }

const base = (id: string) => `/integracoes/central/${encodeURIComponent(id)}`;

export const centralApi = {
  carregar: () => api.get<Central>('/integracoes/central/painel').then((r) => r.data),
  configuracao: (id: string) => api.get<ConfiguracaoProvedor>(base(id)).then((r) => r.data),
  testar: (id: string, valores: Record<string, string>) => api.post<ResultadoTeste>(`${base(id)}/testar`, valores).then((r) => r.data),
  salvar: (id: string, valores: Record<string, string>) => api.put<ResultadoTeste>(base(id), valores).then((r) => r.data),
  desconectar: (id: string) => api.post(`${base(id)}/desconectar`, {}).then((r) => r.data),
  remover: (id: string) => api.delete(base(id)).then((r) => r.data),
  historico: (id: string) => api.get<{ eventos: EventoIntegracao[] }>(`${base(id)}/historico`).then((r) => r.data.eventos),
};

export const ROTULO_STATUS: Record<StatusCentral, string> = {
  CONECTADO: 'CONECTADO',
  ERRO: 'ERRO',
  NAO_CONFIGURADO: 'NÃO CONFIGURADO',
  CREDENCIAIS_SALVAS: 'CREDENCIAIS SALVAS',
  AGUARDANDO_AUTORIZACAO: 'AGUARDANDO AUTORIZAÇÃO',
  EXPIRADO: 'RECONECTAR',
  DESCONECTADO: 'DESCONECTADO',
  INDISPONIVEL: 'INDISPONÍVEL',
};

export const ROTULO_OPERACAO: Record<string, string> = {
  TESTAR: 'Teste de conexão', SALVAR: 'Configuração salva', CONECTAR: 'Autorização', DESCONECTAR: 'Desconexão', REMOVER: 'Remoção', SINCRONIZAR: 'Sincronização',
};

/** Ordena gravidade para a cor do indicador. */
export function corDoStatus(status: StatusCentral): string {
  if (status === 'CONECTADO') return 'var(--nx-green)';
  if (status === 'ERRO' || status === 'EXPIRADO') return 'var(--nx-amber)';
  return 'var(--nx-ink-3)';
}

/** Saúde = conectadas ÷ (conectadas + com erro). Sem integração em uso → null ("—"). */
export function saudeDaCentral(conectadas: number, comErro: number): number | null {
  const emUso = conectadas + comErro;
  return emUso ? Math.round((conectadas / emUso) * 100) : null;
}

/** Campos obrigatórios faltando — segredo já salvo conta como preenchido. */
export function camposFaltando(campos: CampoProvedor[], valores: Record<string, string>, segredosSalvos: Record<string, string | null> = {}): string[] {
  return campos.filter((c) => c.obrigatorio && !(valores[c.chave]?.trim() || (c.secreto && segredosSalvos[c.chave]))).map((c) => c.rotulo);
}
