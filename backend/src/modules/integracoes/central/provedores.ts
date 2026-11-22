/**
 * Catálogo da Central de Integrações — UMA fonte de verdade sobre o que cada card
 * realmente oferece. Nada aqui sugere conexão: o status vem sempre do banco.
 *
 * `disponibilidade`:
 *  - OAUTH_PLATAFORMA: autorização oficial com o aplicativo do NEXUS OS (Client ID/Secret ficam
 *    no servidor, nunca por empresa). Mercado Livre e Shopee — fluxos já existentes, reaproveitados.
 *  - CREDENCIAIS: a empresa informa a credencial; o backend testa com uma LEITURA oficial do
 *    provedor antes de marcar CONECTADO (adaptador em `adaptadores.ts`).
 *  - BLOQUEIO_EXTERNO: depende de aplicativo aprovado, contrato ou licença junto ao provedor;
 *    o motivo é mostrado no card e nenhuma conexão é oferecida.
 *  - PLANEJADA: implementação prevista nas próximas fases; o card informa isso, sem botão falso.
 */

export type Disponibilidade = 'OAUTH_PLATAFORMA' | 'CREDENCIAIS' | 'BLOQUEIO_EXTERNO' | 'PLANEJADA';

export interface CampoProvedor {
  chave: string;
  rotulo: string;
  tipo: 'texto' | 'segredo' | 'selecao' | 'url';
  obrigatorio: boolean;
  /** Segredos são cifrados no banco e NUNCA voltam ao navegador (só a máscara). */
  secreto: boolean;
  opcoes?: { valor: string; rotulo: string }[];
  ajuda?: string;
  /** Campos da seção "Configurações Avançadas". */
  avancado?: boolean;
}

export interface DefinicaoProvedor {
  id: string;
  /** Valor de IntegracaoExterno.tipo (único por empresa). */
  tipo: string;
  nome: string;
  autenticacao: string;
  disponibilidade: Disponibilidade;
  campos: CampoProvedor[];
  /** Motivo exibido quando BLOQUEIO_EXTERNO/PLANEJADA. */
  pendencia?: string;
  documentacao?: string;
}

export const PROVEDORES: readonly DefinicaoProvedor[] = [
  { id: 'mercadolivre', tipo: 'MERCADO_LIVRE', nome: 'Mercado Livre', autenticacao: 'OAuth 2.0 (aplicativo do NEXUS OS)', disponibilidade: 'OAUTH_PLATAFORMA', campos: [], documentacao: 'https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao' },
  { id: 'shopee', tipo: 'SHOPEE', nome: 'Shopee', autenticacao: 'Open Platform v2 (assinatura HMAC + autorização da loja)', disponibilidade: 'OAUTH_PLATAFORMA', campos: [], documentacao: 'https://open.shopee.com/developer-guide/20' },
  {
    id: 'asaas', tipo: 'ASAAS', nome: 'Asaas', autenticacao: 'Chave de API (cabeçalho access_token)', disponibilidade: 'CREDENCIAIS',
    documentacao: 'https://docs.asaas.com/docs/autentica%C3%A7%C3%A3o-1',
    campos: [
      { chave: 'ambiente', rotulo: 'Ambiente', tipo: 'selecao', obrigatorio: true, secreto: false, opcoes: [{ valor: 'PRODUCAO', rotulo: 'Produção' }, { valor: 'SANDBOX', rotulo: 'Sandbox (testes)' }], ajuda: 'Chaves de produção e de sandbox são diferentes e não se misturam.' },
      { chave: 'apiKey', rotulo: 'Chave de API', tipo: 'segredo', obrigatorio: true, secreto: true, ajuda: 'Gerada em Integrações › Chaves de API no painel do Asaas. Começa com $aact_prod_ (produção) ou $aact_hmlg_ (sandbox).' },
    ],
  },
  { id: 'woocommerce', tipo: 'WOOCOMMERCE', nome: 'WooCommerce', autenticacao: 'REST API (Consumer Key/Secret)', disponibilidade: 'PLANEJADA', campos: [], pendencia: 'Prevista para a próxima fase (Fase B).' },
  { id: 'mercadopago', tipo: 'MERCADO_PAGO', nome: 'Mercado Pago', autenticacao: 'Access Token', disponibilidade: 'PLANEJADA', campos: [], pendencia: 'Prevista para a próxima fase (Fase B).' },
  { id: 'shopify', tipo: 'SHOPIFY', nome: 'Shopify', autenticacao: 'OAuth (app Shopify)', disponibilidade: 'BLOQUEIO_EXTERNO', campos: [], pendencia: 'Exige um aplicativo do NEXUS OS registrado no Shopify Partners.' },
  { id: 'nuvemshop', tipo: 'NUVEMSHOP', nome: 'Nuvemshop', autenticacao: 'OAuth (app Nuvemshop)', disponibilidade: 'BLOQUEIO_EXTERNO', campos: [], pendencia: 'Exige um aplicativo do NEXUS OS registrado no portal de parceiros da Nuvemshop.' },
  { id: 'melhor-envio', tipo: 'MELHOR_ENVIO', nome: 'Melhor Envio', autenticacao: 'OAuth 2.0 (app Melhor Envio)', disponibilidade: 'BLOQUEIO_EXTERNO', campos: [], pendencia: 'Exige um aplicativo do NEXUS OS cadastrado no Melhor Envio.' },
  { id: 'correios', tipo: 'CORREIOS', nome: 'Correios', autenticacao: 'Token do contrato (API Correios)', disponibilidade: 'BLOQUEIO_EXTERNO', campos: [], pendencia: 'Exige contrato com os Correios e acesso ao portal CWS.' },
  { id: 'jadlog', tipo: 'JADLOG', nome: 'Jadlog', autenticacao: 'Token do contrato', disponibilidade: 'BLOQUEIO_EXTERNO', campos: [], pendencia: 'Exige contrato com a Jadlog para liberar o token da API.' },
  { id: 'open-banking', tipo: 'OPEN_BANKING', nome: 'Bancos Open Banking', autenticacao: 'Consentimento via agregador autorizado', disponibilidade: 'BLOQUEIO_EXTERNO', campos: [], pendencia: 'Exige contrato com um agregador autorizado (ex.: Pluggy, Belvo). O NEXUS OS nunca pede senha bancária.' },
];

export function provedorPorId(id: string): DefinicaoProvedor | undefined {
  return PROVEDORES.find((p) => p.id === id);
}

/** Visão pública do catálogo (sem nada sensível — só metadados dos campos). */
export function catalogoPublico() {
  return PROVEDORES.map(({ id, nome, autenticacao, disponibilidade, campos, pendencia, documentacao }) => ({ id, nome, autenticacao, disponibilidade, campos, pendencia: pendencia ?? null, documentacao: documentacao ?? null }));
}
