/**
 * Quais permissões liberam cada item do menu. Basta UMA delas.
 * Itens fora desta lista (Dashboard, Configurações) ficam sempre visíveis;
 * dentro de Configurações, cada aba continua protegida pelo servidor.
 *
 * Isto só ESCONDE: quem barra de verdade é o servidor (permissaoMiddleware).
 */
export const ACESSO_POR_ROTA: Record<string, string[]> = {
  '/ia': ['ia:visualizar'],
  '/pdv': ['pdv:visualizar'],
  '/vendas': ['vendas:visualizar'],
  '/produtos': ['produtos:visualizar'],
  '/estoque': ['estoque:visualizar'],
  '/compras': ['compras:visualizar'],
  '/fornecedores': ['fornecedores:visualizar'],
  '/clientes': ['clientes:visualizar'],
  '/financeiro': ['financeiro:visualizar'],
  '/fluxo': ['financeiro:visualizar'],
  '/dre': ['dre:visualizar'],
  '/metas': ['metas:visualizar', 'metas:equipe', 'metas:proprio'],
  '/rh': ['rh:visualizar'],
  '/radar-organizacional': ['rh:visualizar'],
  '/ponto': ['ponto:visualizar', 'ponto:proprio'],
  '/relatorios': ['relatorios:visualizar'],
  '/indicadores': ['metas:visualizar', 'metas:equipe', 'roi:visualizar'],
  '/fiscal': ['fiscal:visualizar'],
  '/importacao': ['importacao:visualizar'],
  '/alertas': ['alertas:visualizar'],
  '/central-integracoes': ['integracoes:visualizar'],
  '/assinatura': ['assinatura:visualizar'],
  '/plataforma': ['empresa:administrar'],
  '/auditoria': ['auditoria:visualizar'],
  '/usuarios': ['usuarios:visualizar'],
  '/admin': ['usuarios:visualizar'],
};

/** Rota base de um caminho: "/produtos/123" → "/produtos". */
function rotaBase(caminho: string): string {
  const limpo = caminho.split('?')[0].split('#')[0];
  const partes = limpo.split('/').filter(Boolean);
  return partes.length ? `/${partes[0]}` : '/';
}

/**
 * `permissoes` null = ainda carregando/indisponível: mostra tudo
 * (o servidor continua barrando o que não pode).
 */
export function podeAcessar(caminho: string, permissoes: string[] | null): boolean {
  if (!permissoes) return true;
  const exigidas = ACESSO_POR_ROTA[rotaBase(caminho)];
  if (!exigidas) return true;
  return exigidas.some((p) => permissoes.includes(p));
}

/**
 * Abas de Configurações. Idioma, Aparência e Minha Conta ficam para todos;
 * as demais são da empresa (Gestor) — Financeiro / RH vê as suas.
 * Também só esconde: o servidor barra quem não pode salvar.
 */
export const ACESSO_ABA_CONFIG: Record<string, string[]> = {
  Empresa: ['empresa:visualizar'],
  'Usuários e Permissões': ['usuarios:visualizar'],
  Segurança: ['empresa:editar'],
  PDV: ['empresa:editar'],
  'PIX / Recebimentos': ['empresa:visualizar', 'financeiro:visualizar'],
  Estoque: ['empresa:editar'],
  Financeiro: ['empresa:editar', 'financeiro:administrar'],
  RH: ['empresa:editar', 'rh:administrar'],
  IA: ['empresa:editar'],
  'App & API': ['api_publica:visualizar', 'integracoes:visualizar'],
};

export function podeVerAbaConfig(aba: string, permissoes: string[] | null): boolean {
  const exigidas = ACESSO_ABA_CONFIG[aba];
  if (!exigidas) return true;
  // Enquanto carrega, esconde as restritas (evita mostrar e sumir).
  if (!permissoes) return false;
  return exigidas.some((p) => permissoes.includes(p));
}
