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
  {
    id: 'woocommerce', tipo: 'WOOCOMMERCE', nome: 'WooCommerce', autenticacao: 'REST API (Consumer Key e Consumer Secret, HTTPS)', disponibilidade: 'CREDENCIAIS',
    documentacao: 'https://woocommerce.github.io/woocommerce-rest-api-docs/#authentication',
    campos: [
      { chave: 'urlLoja', rotulo: 'Endereço da loja', tipo: 'url', obrigatorio: true, secreto: false, ajuda: 'Ex.: https://minhaloja.com.br — precisa ser HTTPS.' },
      { chave: 'consumerKey', rotulo: 'Consumer Key', tipo: 'segredo', obrigatorio: true, secreto: true, ajuda: 'WooCommerce › Configurações › Avançado › REST API › Adicionar chave (permissão Leitura ou Leitura/Escrita).' },
      { chave: 'consumerSecret', rotulo: 'Consumer Secret', tipo: 'segredo', obrigatorio: true, secreto: true },
    ],
  },
  {
    id: 'mercadopago', tipo: 'MERCADO_PAGO', nome: 'Mercado Pago', autenticacao: 'Access Token (Authorization: Bearer)', disponibilidade: 'CREDENCIAIS',
    documentacao: 'https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-content/credentials',
    campos: [
      { chave: 'accessToken', rotulo: 'Access Token', tipo: 'segredo', obrigatorio: true, secreto: true, ajuda: 'Suas integrações › Credenciais. Use o token de teste para homologar e o de produção para receber de verdade.' },
    ],
  },
  {
    id: 'whatsapp', tipo: 'WHATSAPP', nome: 'WhatsApp Business', autenticacao: 'WhatsApp Cloud API (Meta) — Access Token', disponibilidade: 'CREDENCIAIS',
    documentacao: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    campos: [
      { chave: 'phoneNumberId', rotulo: 'Phone Number ID', tipo: 'texto', obrigatorio: true, secreto: false, ajuda: 'Painel do app na Meta › WhatsApp › Configuração da API.' },
      { chave: 'wabaId', rotulo: 'WhatsApp Business Account ID (WABA ID)', tipo: 'texto', obrigatorio: true, secreto: false },
      { chave: 'appId', rotulo: 'Meta App ID', tipo: 'texto', obrigatorio: false, secreto: false },
      { chave: 'accessToken', rotulo: 'Access Token', tipo: 'segredo', obrigatorio: true, secreto: true, ajuda: 'Use um token permanente de usuário do sistema (System User). Tokens temporários expiram em 24 h.' },
      { chave: 'appSecret', rotulo: 'Meta App Secret', tipo: 'segredo', obrigatorio: false, secreto: true, avancado: true, ajuda: 'Obrigatório para receber webhooks: valida a assinatura X-Hub-Signature-256 de cada evento.' },
      { chave: 'verifyToken', rotulo: 'Webhook Verify Token', tipo: 'segredo', obrigatorio: false, secreto: true, avancado: true, ajuda: 'Texto que você inventa e repete no painel da Meta ao cadastrar o webhook.' },
      { chave: 'versaoApi', rotulo: 'Versão da Graph API', tipo: 'texto', obrigatorio: false, secreto: false, avancado: true, ajuda: 'Padrão v23.0. Formato vNN.N.' },
      { chave: 'modeloDocumento', rotulo: 'Modelo para documentos (PDF)', tipo: 'texto', obrigatorio: false, secreto: false, avancado: true, ajuda: 'Nome de um modelo APROVADO com cabeçalho de documento e 1 variável no corpo. Usado para enviar pedidos de compra fora da janela de 24 h.' },
      { chave: 'idiomaModelo', rotulo: 'Idioma do modelo', tipo: 'texto', obrigatorio: false, secreto: false, avancado: true, ajuda: 'Ex.: pt_BR' },
    ],
  },
  {
    id: 'email-conta', tipo: 'EMAIL', nome: 'E-mail da empresa', autenticacao: 'SMTP com TLS para envio · IMAP opcional para recebimento', disponibilidade: 'CREDENCIAIS',
    documentacao: 'https://nodemailer.com/smtp/',
    campos: [
      { chave: 'emailRemetente', rotulo: 'E-mail do remetente', tipo: 'texto', obrigatorio: true, secreto: false },
      { chave: 'nomeExibicao', rotulo: 'Nome de exibição', tipo: 'texto', obrigatorio: false, secreto: false, ajuda: 'Ex.: Padaria Central — aparece como remetente.' },
      { chave: 'smtpHost', rotulo: 'Servidor SMTP', tipo: 'texto', obrigatorio: true, secreto: false, ajuda: 'Gmail: smtp.gmail.com · Outlook: smtp.office365.com' },
      { chave: 'smtpPorta', rotulo: 'Porta SMTP', tipo: 'selecao', obrigatorio: true, secreto: false, opcoes: [{ valor: '587', rotulo: '587 (STARTTLS)' }, { valor: '465', rotulo: '465 (SSL/TLS)' }, { valor: '2525', rotulo: '2525' }, { valor: '25', rotulo: '25' }] },
      { chave: 'smtpSeguranca', rotulo: 'Segurança SMTP', tipo: 'selecao', obrigatorio: true, secreto: false, opcoes: [{ valor: 'STARTTLS', rotulo: 'STARTTLS (587)' }, { valor: 'SSL_TLS', rotulo: 'SSL/TLS (465)' }] },
      { chave: 'usuario', rotulo: 'Usuário', tipo: 'texto', obrigatorio: false, secreto: false, ajuda: 'Vazio = o próprio e-mail do remetente.' },
      { chave: 'senha', rotulo: 'Senha de app', tipo: 'segredo', obrigatorio: true, secreto: true, ajuda: 'Gmail e Outlook exigem senha de app (com verificação em duas etapas). Nunca use a senha principal da conta.' },
      { chave: 'receber', rotulo: 'Receber e-mails (IMAP)', tipo: 'selecao', obrigatorio: false, secreto: false, avancado: true, opcoes: [{ valor: 'NAO', rotulo: 'Não' }, { valor: 'SIM', rotulo: 'Sim' }] },
      { chave: 'imapHost', rotulo: 'Servidor IMAP', tipo: 'texto', obrigatorio: false, secreto: false, avancado: true, ajuda: 'Gmail: imap.gmail.com · Outlook: outlook.office365.com' },
      { chave: 'imapPorta', rotulo: 'Porta IMAP', tipo: 'selecao', obrigatorio: false, secreto: false, avancado: true, opcoes: [{ valor: '993', rotulo: '993 (SSL/TLS)' }, { valor: '143', rotulo: '143 (STARTTLS)' }] },
      { chave: 'imapSeguranca', rotulo: 'Segurança IMAP', tipo: 'selecao', obrigatorio: false, secreto: false, avancado: true, opcoes: [{ valor: 'SSL_TLS', rotulo: 'SSL/TLS (993)' }, { valor: 'STARTTLS', rotulo: 'STARTTLS (143)' }] },
    ],
    pendencia: 'Login com Google/Microsoft (OAuth) exige um aplicativo do NEXUS OS aprovado no Google Cloud e no Microsoft Entra; até lá, use senha de app.',
  },
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
