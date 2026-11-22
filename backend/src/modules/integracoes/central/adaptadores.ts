/**
 * Adaptadores dos provedores por CREDENCIAIS. Cada um faz uma LEITURA oficial
 * (nunca altera dados externos) para provar que a credencial funciona — um 200
 * de rota intermediária não basta.
 *
 * Segurança: o destino de cada requisição é FIXO por provedor/ambiente (sem URL
 * informada pelo usuário → sem SSRF nesta fase), timeout de 10 s, sem seguir
 * redirecionamentos, e nenhum corpo de resposta ou cabeçalho é registrado.
 */

export type CodigoResultado =
  | 'OK'
  | 'CONFIGURACAO_INCOMPLETA'
  | 'CREDENCIAL_INVALIDA'
  | 'PERMISSAO_INSUFICIENTE'
  | 'LIMITE_API'
  | 'SERVICO_INDISPONIVEL'
  | 'TIMEOUT'
  | 'FALHA_COMUNICACAO';

export interface ResultadoTeste {
  ok: boolean;
  codigo: CodigoResultado;
  mensagem: string;
  /** Identificação da conta externa (sem dado sensível completo). */
  conta?: { nome: string; documento?: string | null };
}

export interface Adaptador {
  testar(config: Record<string, string>, segredos: Record<string, string>): Promise<ResultadoTeste>;
}

import { DestinoBloqueado, exigirHostPublico, getHttpsFixado, PORTAS_IMAP, PORTAS_SMTP, resolverUrlHttpsPublica } from '../../../lib/destino-seguro.js';

const TIMEOUT_MS = 10_000;
const USER_AGENT = 'NexusOS/1.0';

/** Mostra só os 4 últimos caracteres. Usado para documentos e para segredos salvos. */
export function mascarar(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const v = String(valor);
  return v.length <= 4 ? '••••' : `••••${v.slice(-4)}`;
}

async function requisitar(url: string, headers: Record<string, string>): Promise<Response | ResultadoTeste> {
  try {
    return await fetch(url, { method: 'GET', headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e: any) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return { ok: false, codigo: 'TIMEOUT', mensagem: 'O provedor não respondeu em 10 segundos.' };
    return { ok: false, codigo: 'FALHA_COMUNICACAO', mensagem: 'Não foi possível comunicar com o provedor. Verifique a conexão do servidor.' };
  }
}

function porStatusHttp(status: number): ResultadoTeste {
  if (status === 401) return { ok: false, codigo: 'CREDENCIAL_INVALIDA', mensagem: 'Credencial inválida ou revogada.' };
  if (status === 403) return { ok: false, codigo: 'PERMISSAO_INSUFICIENTE', mensagem: 'A credencial não tem permissão para esta consulta.' };
  if (status === 429) return { ok: false, codigo: 'LIMITE_API', mensagem: 'Limite de requisições do provedor atingido. Tente em instantes.' };
  if (status >= 500) return { ok: false, codigo: 'SERVICO_INDISPONIVEL', mensagem: 'O provedor está indisponível no momento.' };
  return { ok: false, codigo: 'FALHA_COMUNICACAO', mensagem: `Resposta inesperada do provedor (HTTP ${status}).` };
}

// ---------------------------------------------------------------------------
// Asaas — https://docs.asaas.com/docs/autentica%C3%A7%C3%A3o-1
// Base: produção https://api.asaas.com/v3 | sandbox https://api-sandbox.asaas.com/v3
// Cabeçalho `access_token`; User-Agent obrigatório para contas novas.
// Leitura de prova: GET /myAccount/commercialInfo/ (nome e CPF/CNPJ da conta).
// 401 + invalid_environment = chave do outro ambiente.
// ---------------------------------------------------------------------------
export const ASAAS_BASE: Record<string, string> = {
  PRODUCAO: 'https://api.asaas.com/v3',
  SANDBOX: 'https://api-sandbox.asaas.com/v3',
};

const asaas: Adaptador = {
  async testar(config, segredos) {
    const ambiente = config.ambiente;
    const chave = (segredos.apiKey ?? '').trim();
    if (!ASAAS_BASE[ambiente] || !chave) return { ok: false, codigo: 'CONFIGURACAO_INCOMPLETA', mensagem: 'Informe o ambiente e a chave de API.' };
    if (segredos.webhookToken && !/^\S{32,255}$/.test(segredos.webhookToken)) return { ok: false, codigo: 'CONFIGURACAO_INCOMPLETA', mensagem: 'O token do webhook precisa ter de 32 a 255 caracteres, sem espaços (regra do Asaas).' };
    const prefixo = ambiente === 'PRODUCAO' ? '$aact_prod_' : '$aact_hmlg_';
    if (!chave.startsWith(prefixo)) {
      return { ok: false, codigo: 'CREDENCIAL_INVALIDA', mensagem: `Esta chave não é de ${ambiente === 'PRODUCAO' ? 'produção' : 'sandbox'} (deveria começar com ${prefixo}).` };
    }
    const r = await requisitar(`${ASAAS_BASE[ambiente]}/myAccount/commercialInfo/`, { access_token: chave });
    if (!(r instanceof Response)) return r;
    if (r.ok) {
      const dados = (await r.json().catch(() => ({}))) as { name?: string; companyName?: string; cpfCnpj?: string };
      const nome = dados.companyName || dados.name;
      if (!nome) return { ok: false, codigo: 'FALHA_COMUNICACAO', mensagem: 'O Asaas respondeu sem os dados da conta.' };
      return { ok: true, codigo: 'OK', mensagem: 'Conexão validada com o Asaas.', conta: { nome, documento: mascarar(dados.cpfCnpj) } };
    }
    if (r.status === 401) {
      const corpo = (await r.json().catch(() => ({}))) as { errors?: { code?: string }[] };
      if (corpo.errors?.some((e) => e.code === 'invalid_environment')) {
        return { ok: false, codigo: 'CREDENCIAL_INVALIDA', mensagem: 'A chave pertence ao outro ambiente (produção × sandbox).' };
      }
    }
    return porStatusHttp(r.status);
  },
};

// ---------------------------------------------------------------------------
// WooCommerce — https://woocommerce.github.io/woocommerce-rest-api-docs/
// REST API em <loja>/wp-json/wc/v3, HTTPS com Basic Auth (Consumer Key = usuário,
// Consumer Secret = senha). Leitura de prova: GET /orders?per_page=1 (exige chave com
// leitura). A URL vem do usuário: validada contra SSRF (só HTTPS e host público).
// ---------------------------------------------------------------------------
async function destinoWoo(urlLoja: string): Promise<{ url: URL; ip: string } | ResultadoTeste> {
  try { return await resolverUrlHttpsPublica(urlLoja); } catch (e) {
    return { ok: false, codigo: 'CONFIGURACAO_INCOMPLETA', mensagem: e instanceof DestinoBloqueado ? e.message : 'URL da loja inválida.' };
  }
}

/** GET na loja fixado no IP validado (anti DNS rebinding), com o mesmo tratamento de erro. */
export async function getLojaWoo(destino: { url: URL; ip: string }, caminho: string, segredos: Record<string, string>) {
  const alvo = new URL(`${destino.url.origin}${destino.url.pathname}${caminho}`);
  return getHttpsFixado(alvo, destino.ip, { Authorization: basicAuth(segredos.consumerKey, segredos.consumerSecret), Accept: 'application/json', 'User-Agent': USER_AGENT });
}

export function basicAuth(usuario: string, senha: string): string {
  return `Basic ${Buffer.from(`${usuario}:${senha}`).toString('base64')}`;
}

const woocommerce: Adaptador = {
  async testar(config, segredos) {
    if (!config.urlLoja || !segredos.consumerKey || !segredos.consumerSecret) return { ok: false, codigo: 'CONFIGURACAO_INCOMPLETA', mensagem: 'Informe a URL da loja, a Consumer Key e o Consumer Secret.' };
    const destino = await destinoWoo(config.urlLoja);
    if (!('ip' in destino)) return destino;
    let r: Awaited<ReturnType<typeof getHttpsFixado>>;
    try { r = await getLojaWoo(destino, '/wp-json/wc/v3/orders?per_page=1', segredos); } catch (e: any) {
      return e?.name === 'TimeoutError' ? { ok: false, codigo: 'TIMEOUT', mensagem: 'A loja não respondeu em 20 segundos.' } : { ok: false, codigo: 'FALHA_COMUNICACAO', mensagem: 'Não foi possível conectar à loja (HTTPS/certificado ou rede).' };
    }
    if (r.status >= 300 && r.status < 400) return { ok: false, codigo: 'FALHA_COMUNICACAO', mensagem: 'A loja redirecionou a requisição. Informe o endereço final (https) da loja.' };
    if (r.status === 404) return { ok: false, codigo: 'FALHA_COMUNICACAO', mensagem: 'A REST API do WooCommerce não foi encontrada nesse endereço (verifique a URL e os links permanentes do WordPress).' };
    if (r.status >= 200 && r.status < 300) {
      let dados: unknown = null; try { dados = JSON.parse(r.corpo); } catch { /* não é JSON */ }
      if (!Array.isArray(dados)) return { ok: false, codigo: 'FALHA_COMUNICACAO', mensagem: 'O endereço respondeu, mas não como a REST API do WooCommerce.' };
      return { ok: true, codigo: 'OK', mensagem: 'Conexão validada com a loja WooCommerce (leitura de pedidos).', conta: { nome: destino.url.hostname } };
    }
    return porStatusHttp(r.status);
  },
};

// ---------------------------------------------------------------------------
// Mercado Pago — https://www.mercadopago.com.br/developers/pt/reference
// Base https://api.mercadopago.com, cabeçalho Authorization: Bearer <Access Token>.
// Leitura de prova: GET /v1/payment_methods (consulta autenticada, sem efeito colateral).
// A identificação da conta (nome) não é obtida: o endpoint de usuário não está na
// referência oficial do Mercado Pago, então não é usado.
// ---------------------------------------------------------------------------
const mercadopago: Adaptador = {
  async testar(_config, segredos) {
    const token = (segredos.accessToken ?? '').trim();
    if (!token) return { ok: false, codigo: 'CONFIGURACAO_INCOMPLETA', mensagem: 'Informe o Access Token.' };
    const r = await requisitar('https://api.mercadopago.com/v1/payment_methods', { Authorization: `Bearer ${token}` });
    if (!(r instanceof Response)) return r;
    if (r.ok) {
      const dados = await r.json().catch(() => null);
      if (!Array.isArray(dados)) return { ok: false, codigo: 'FALHA_COMUNICACAO', mensagem: 'O Mercado Pago respondeu em formato inesperado.' };
      return { ok: true, codigo: 'OK', mensagem: `Access Token aceito pelo Mercado Pago (${dados.length} meios de pagamento disponíveis).`, conta: { nome: 'Conta Mercado Pago' } };
    }
    // Observado na API real: token inválido → HTTP 400 {"message":"invalid_token"}; sem token → 401.
    if (r.status === 400) {
      const corpo = (await r.json().catch(() => ({}))) as { message?: string };
      if (corpo.message === 'invalid_token') return { ok: false, codigo: 'CREDENCIAL_INVALIDA', mensagem: 'Access Token inválido ou revogado.' };
    }
    return porStatusHttp(r.status);
  },
};

// ---------------------------------------------------------------------------
// WhatsApp Business (Cloud API) — https://developers.facebook.com/docs/whatsapp/cloud-api
// GET https://graph.facebook.com/<versão>/<PHONE_NUMBER_ID> → verified_name,
// display_phone_number, quality_rating. Erro 190 = token expirado/inválido.
// ---------------------------------------------------------------------------
export const VERSAO_GRAPH_PADRAO = 'v23.0';
export function versaoGraph(config: Record<string, string>): string {
  return /^v\d{1,2}\.\d$/.test(config.versaoApi ?? '') ? config.versaoApi : VERSAO_GRAPH_PADRAO;
}

export async function lerErroGraph(r: Response): Promise<{ code?: number; message?: string }> {
  const j = (await r.json().catch(() => ({}))) as { error?: { code?: number; message?: string } };
  return j.error ?? {};
}

const whatsapp: Adaptador = {
  async testar(config, segredos) {
    if (!/^\d{5,25}$/.test(config.phoneNumberId ?? '') || !segredos.accessToken) {
      return { ok: false, codigo: 'CONFIGURACAO_INCOMPLETA', mensagem: 'Informe o Phone Number ID (só números) e o Access Token.' };
    }
    const r = await requisitar(`https://graph.facebook.com/${versaoGraph(config)}/${config.phoneNumberId}?fields=verified_name,display_phone_number,quality_rating`, { Authorization: `Bearer ${segredos.accessToken.trim()}` });
    if (!(r instanceof Response)) return r;
    if (r.ok) {
      const d = (await r.json().catch(() => ({}))) as { verified_name?: string; display_phone_number?: string; quality_rating?: string };
      if (!d.display_phone_number) return { ok: false, codigo: 'FALHA_COMUNICACAO', mensagem: 'A Meta respondeu sem os dados do número.' };
      return { ok: true, codigo: 'OK', mensagem: `Número validado na Meta${d.quality_rating ? ` (qualidade: ${d.quality_rating})` : ''}.`, conta: { nome: `${d.verified_name ?? 'WhatsApp'} · ${d.display_phone_number}` } };
    }
    const erro = await lerErroGraph(r);
    if (erro.code === 190) return { ok: false, codigo: 'CREDENCIAL_INVALIDA', mensagem: 'Access Token expirado ou inválido (erro 190 da Meta). Gere um novo token.' };
    if (erro.code === 100) return { ok: false, codigo: 'CREDENCIAL_INVALIDA', mensagem: 'Phone Number ID não encontrado ou sem permissão para este token.' };
    return porStatusHttp(r.status);
  },
};

// ---------------------------------------------------------------------------
// E-mail por SMTP (envio) e IMAP (recebimento opcional).
// Nodemailer: transporter.verify() testa DNS, TCP, TLS e autenticação sem enviar nada;
// porta 465 = TLS direto (secure: true), 587/25 = STARTTLS (requireTLS: true).
// ImapFlow: connect + status('INBOX', { messages: true }) + logout.
// Hosts informados pelo usuário passam pela proteção SSRF; nada sem TLS é aceito.
// ---------------------------------------------------------------------------
/**
 * `ip`: endereço já validado por exigirHostPublico. A conexão vai direto a ele e o nome do
 * servidor fica só no TLS (SNI e conferência do certificado) — sem nova consulta DNS entre
 * a checagem e a conexão (proteção contra DNS rebinding).
 */
export function opcoesSmtp(config: Record<string, string>, segredos: Record<string, string>, ip: string) {
  const porta = Number(config.smtpPorta);
  const tlsDireto = config.smtpSeguranca === 'SSL_TLS';
  return {
    host: ip, servername: config.smtpHost, port: porta, secure: tlsDireto, requireTLS: !tlsDireto,
    auth: { user: config.usuario || config.emailRemetente, pass: segredos.senha },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    tls: { minVersion: 'TLSv1.2', servername: config.smtpHost },
  };
}

export function opcoesImap(config: Record<string, string>, segredos: Record<string, string>, ip: string) {
  return {
    host: ip, servername: config.imapHost, port: Number(config.imapPorta), secure: config.imapSeguranca !== 'STARTTLS',
    auth: { user: config.usuario || config.emailRemetente, pass: segredos.senha },
    logger: false, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  } as any;
}

export type DestinosEmail = { erro: ResultadoTeste } | { erro?: undefined; smtpIp: string; imapIp: string | null };

/** Valida os campos e resolve os hosts UMA vez; as conexões usam os IPs devolvidos. */
export async function validarDestinosEmail(config: Record<string, string>): Promise<DestinosEmail> {
  const falha = (mensagem: string): DestinosEmail => ({ erro: { ok: false, codigo: 'CONFIGURACAO_INCOMPLETA', mensagem } });
  const porta = Number(config.smtpPorta);
  if (!config.smtpHost || !PORTAS_SMTP.includes(porta)) return falha(`Servidor SMTP e porta (${PORTAS_SMTP.join(', ')}) são obrigatórios.`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.emailRemetente ?? '')) return falha('E-mail do remetente inválido.');
  // Porta e segurança precisam combinar: 465 = TLS direto; 587/25/2525 = STARTTLS;
  // IMAP 993 = TLS direto; 143 = STARTTLS. Combinação errada só falharia no TLS, com erro genérico.
  if ((porta === 465) !== (config.smtpSeguranca === 'SSL_TLS')) {
    return falha(porta === 465 ? 'A porta 465 usa SSL/TLS: ajuste a segurança SMTP.' : `A porta ${porta} usa STARTTLS: ajuste a segurança SMTP (ou use a porta 465 com SSL/TLS).`);
  }
  if (config.receber === 'SIM' && config.imapPorta && config.imapSeguranca && (config.imapPorta === '993') !== (config.imapSeguranca === 'SSL_TLS')) {
    return falha(config.imapPorta === '993' ? 'A porta IMAP 993 usa SSL/TLS: ajuste a segurança IMAP.' : 'A porta IMAP 143 usa STARTTLS: ajuste a segurança IMAP.');
  }
  try {
    const smtpIp = await exigirHostPublico(config.smtpHost);
    let imapIp: string | null = null;
    if (config.receber === 'SIM') {
      if (!config.imapHost || !PORTAS_IMAP.includes(Number(config.imapPorta))) return falha('Para receber e-mails, informe o servidor IMAP e a porta (993 ou 143).');
      imapIp = await exigirHostPublico(config.imapHost);
    }
    return { smtpIp, imapIp };
  } catch (e) {
    return falha(e instanceof DestinoBloqueado ? e.message : 'Servidor inválido.');
  }
}

function erroDeEmail(e: any, etapa: 'SMTP' | 'IMAP'): ResultadoTeste {
  const codigo = String(e?.code ?? '');
  if (codigo === 'EAUTH' || e?.authenticationFailed || /auth/i.test(String(e?.responseText ?? e?.message ?? '')) && /fail|invalid|535/i.test(String(e?.responseText ?? e?.message ?? ''))) {
    return { ok: false, codigo: 'CREDENCIAL_INVALIDA', mensagem: `${etapa}: usuário ou senha recusados. Em Gmail/Outlook use uma senha de app.` };
  }
  if (['ETIMEDOUT', 'ETIMEOUT'].includes(codigo) || /timeout/i.test(String(e?.message))) return { ok: false, codigo: 'TIMEOUT', mensagem: `${etapa}: o servidor não respondeu a tempo.` };
  if (['ECONNREFUSED', 'ENOTFOUND', 'ECONNECTION', 'ESOCKET'].includes(codigo)) return { ok: false, codigo: 'FALHA_COMUNICACAO', mensagem: `${etapa}: não foi possível conectar ao servidor (${codigo}). Confira endereço, porta e segurança.` };
  if (codigo === 'ETLS' || /certificate|tls|ssl/i.test(String(e?.message))) return { ok: false, codigo: 'FALHA_COMUNICACAO', mensagem: `${etapa}: falha no TLS. Confira a porta e o tipo de segurança.` };
  return { ok: false, codigo: 'FALHA_COMUNICACAO', mensagem: `${etapa}: falha de comunicação com o servidor.` };
}

const email: Adaptador = {
  async testar(config, segredos) {
    if (!segredos.senha) return { ok: false, codigo: 'CONFIGURACAO_INCOMPLETA', mensagem: 'Informe a senha (ou senha de app) da conta.' };
    const destinos = await validarDestinosEmail(config);
    if (destinos.erro) return destinos.erro;
    const { default: nodemailer } = await import('nodemailer');
    const transporte = nodemailer.createTransport(opcoesSmtp(config, segredos, destinos.smtpIp));
    try { await transporte.verify(); } catch (e) { return erroDeEmail(e, 'SMTP'); } finally { transporte.close(); }
    let caixa = '';
    if (config.receber === 'SIM') {
      const { ImapFlow } = await import('imapflow');
      const cliente = new ImapFlow(opcoesImap(config, segredos, destinos.imapIp!));
      cliente.on('error', () => {});
      try {
        await cliente.connect();
        const st = await cliente.status('INBOX', { messages: true });
        caixa = st ? ` Caixa de entrada acessível (${st.messages ?? 0} mensagens).` : ' Caixa de entrada acessível.';
      } catch (e) { return erroDeEmail(e, 'IMAP'); } finally { await cliente.logout().catch(() => {}); }
    }
    return { ok: true, codigo: 'OK', mensagem: `Servidor SMTP autenticado.${caixa}`, conta: { nome: config.emailRemetente } };
  },
};

export const ADAPTADORES: Record<string, Adaptador> = { asaas, woocommerce, mercadopago, whatsapp, 'email-conta': email };
