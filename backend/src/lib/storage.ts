/**
 * Armazenamento de documentos em bucket (AWS S3 ou Supabase Storage).
 *
 * POR QUE HTTP CRU E NÃO SDK
 * -------------------------
 * S3 e Supabase expõem a mesma semântica de "colocar um binário sob uma chave"
 * via API REST autenticada por token. Usar `fetch` (nativo do Node 18+) evita
 * adicionar @aws-sdk/client-s3 e @supabase/supabase-js ao `package.json` — o
 * projeto já segue essa linha em `lib/email.ts` (Resend por HTTP nativo).
 *
 * O que NÃO é negociável aqui: o bucket é sempre PRIVADO. Não existe código
 * que construa uma URL pública de leitura. Todo acesso passa por
 * `urlAssinada()`, que gera um link temporário. Se as credenciais não estiverem
 * configuradas, as funções lançam erro explícito — nunca simulam sucesso.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';

export type Provedor = 's3' | 'supabase';

export interface ConfigStorage {
  provedor: Provedor;
  bucket: string;
  /** S3 */
  regiao?: string;
  /** S3 */
  accessKeyId?: string;
  /** S3 */
  secretAccessKey?: string;
  /** S3 (opcional): endpoint custom, para S3-compatible como MinIO */
  endpoint?: string;
  /** Supabase */
  projectUrl?: string;
  /** Supabase: a service role (backend-only, nunca exposta ao frontend) */
  serviceRoleKey?: string;
}

export interface ObjetoEnviado {
  chave: string;
  bucket: string;
  tamanho: number;
}

/** Extensões permitidas no upload de documentos do RH. */
const EXTENSOES_PERMITIDAS = [
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif',
  'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'odt',
];

/** Content-Type derivado da extensão, usado quando o cliente não informa. */
const TIPOS_POR_EXTENSAO: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain', odt: 'application/vnd.oasis.opendocument.text',
};

/** 10 MB — mesmo limite anunciado na interface do modal. */
export const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024;

/**
 * Lê a configuração do ambiente.
 *
 * Lança com mensagem clara quando falta credencial: é melhor o upload falhar na
 * hora com "configure STORAGE_BUCKET" do que gravar metadado de um documento
 * que não foi para lugar nenhum — que é exatamente o bug anterior.
 */
export function configStorage(): ConfigStorage {
  const provedor = (process.env.STORAGE_PROVIDER || '').toLowerCase();
  const bucket = process.env.STORAGE_BUCKET || '';
  if (!provedor) throw new Error('STORAGE_PROVIDER não configurado (use "s3" ou "supabase").');
  if (!bucket) throw new Error('STORAGE_BUCKET não configurado.');

  if (provedor === 's3') {
    const regiao = process.env.AWS_REGION || '';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';
    if (!regiao) throw new Error('AWS_REGION não configurado.');
    if (!accessKeyId || !secretAccessKey) throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY não configurados.');
    return {
      provedor: 's3', bucket, regiao, accessKeyId, secretAccessKey,
      endpoint: process.env.AWS_S3_ENDPOINT || undefined,
    };
  }

  if (provedor === 'supabase') {
    const projectUrl = process.env.SUPABASE_URL || '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!projectUrl) throw new Error('SUPABASE_URL não configurado.');
    if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurado.');
    return { provedor: 'supabase', bucket, projectUrl, serviceRoleKey };
  }

  throw new Error(`STORAGE_PROVIDER inválido: "${provedor}". Use "s3" ou "supabase".`);
}

/** Indica se o storage está utilizável, sem lançar. */
export function storageConfigurado(): boolean {
  try {
    configStorage();
    return true;
  } catch {
    return false;
  }
}

/**
 * Monta a chave do objeto no bucket.
 *
 * O prefixo da empresa vem FIRST de propósito: ordenando por `empresaId/`, uma
 * listagem ou uma política de lifecycle do bucket consegue isolar (ou expirar)
 * os arquivos de um tenant sem tocar nos demais.
 *
 * O nome original NÃO entra na chave: nome de arquivo do usuário é entrada não
 * confiável (pode conter `../`, acentos, ou colidir). O que vai é um prefixo
 * aleatório, e a extensão — validada contra a lista de permissões.
 */
export function montaChave(empresaId: string, entidadeTipo: string, extensao: string): string {
  const ext = extensao.toLowerCase().replace(/^\./, '');
  if (!EXTENSOES_PERMITIDAS.includes(ext)) {
    throw new Error(`Tipo de arquivo não permitido: .${ext}. Permitidos: ${EXTENSOES_PERMITIDAS.join(', ')}.`);
  }
  const unico = randomBytes(12).toString('hex');
  const data = new Date().toISOString().slice(0, 10);
  return `${empresaId}/${entidadeTipo.toLowerCase()}/${data}/${unico}.${ext}`;
}

/** Descobre a extensão pelo nome do arquivo e valida. */
export function extensaoDe(nomeArquivo: string): string {
  const partes = String(nomeArquivo || '').split('.');
  if (partes.length < 2) throw new Error('Arquivo sem extensão. Envie PDF, imagem ou documento com extensão.');
  return partes[partes.length - 1];
}

/**
 * Content-Type confiável: SEMPRE derivado da extensão, nunca do cliente.
 *
 * Aceitar o `Content-Type` declarado pelo navegador permitiria mandar um `.pdf`
 * declarado como `text/html` — a forma clássica de servir HTML pelo navegador a
 * partir de um anexo. O tipo do arquivo decide.
 */
export function contentTypeDe(nomeArquivo: string): string {
  const ext = extensaoDe(nomeArquivo).toLowerCase();
  const tipo = TIPOS_POR_EXTENSAO[ext];
  if (!tipo) throw new Error(`Tipo de arquivo não permitido: .${ext}.`);
  return tipo;
}

export function validaTamanho(bytes: number): void {
  if (bytes <= 0) throw new Error('Arquivo vazio.');
  if (bytes > TAMANHO_MAXIMO_BYTES) {
    throw new Error(`Arquivo maior que o limite de ${TAMANHO_MAXIMO_BYTES / 1024 / 1024} MB.`);
  }
}

/** Escapa um caminho para URL, preservando as barras da hierarquia. */
function esc(chave: string): string {
  return encodeURIComponent(chave).replace(/%2F/g, '/');
}

/** SHA-256 do corpo vazio, exigido pela assinatura AWS V4. */
const HASH_VAZIO = createHash('sha256').update('').digest('hex');

/** Host S3 da configuração atual (com ou sem endpoint custom, tipo MinIO). */
function hostS3(cfg: ConfigStorage): string {
  if (cfg.endpoint) return cfg.endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `${cfg.bucket}.s3.${cfg.regiao}.amazonaws.com`;
}

/** Base da API de Storage do Supabase. */
function baseSupabase(cfg: ConfigStorage): string {
  return `${cfg.projectUrl!.replace(/\/$/, '')}/storage/v1/object/${cfg.bucket}`;
}

/**
 * Assina uma requisição AWS Signature V4 e devolve a URL e os headers prontos.
 *
 * A assinatura cobre host, data e hash do corpo. Montar à mao em vez de trazer
 * o SDK evita uma dependencia de dezenas de MB no backend por uma assinatura que
 * ocupa trinta linhas - a mesma linha do `lib/email.ts`, que fala com a Resend
 * por HTTP nativo em vez de usar o SDK deles.
 */
function assinaAwsV4(
  cfg: ConfigStorage,
  metodo: string,
  caminho: string,
  corpo: Buffer | null,
  contentType: string | null,
): { url: string; headers: Record<string, string> } {
  const regiao = cfg.regiao!;
  const host = hostS3(cfg);
  const carimbo = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const data = carimbo.slice(0, 8);
  const escopo = `${data}/${regiao}/s3/aws4_request`;
  const hashPayload = corpo ? createHash('sha256').update(corpo).digest('hex') : HASH_VAZIO;

  const cabecalhos: [string, string][] = [
    ...(contentType ? ([['content-type', contentType]] as [string, string][]) : []),
    ['host', host],
    ['x-amz-content-sha256', hashPayload],
    ['x-amz-date', carimbo],
  ];
  const canonicalHeaders = cabecalhos.map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
  const signedHeaders = cabecalhos.map(([k]) => k).sort().join(';');

  const canonicalRequest = [metodo, caminho, '', canonicalHeaders, signedHeaders, hashPayload].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    carimbo,
    escopo,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const mac = (k: Buffer | string, d: string): Buffer => createHmac('sha256', k).update(d).digest();
  // Deriva a chave de assinatura em cadeia: data -> regiao -> servico -> stringToSign
  const kData = mac(`AWS4${cfg.secretAccessKey}`, data);
  const kRegiao = mac(kData, regiao);
  const kServico = mac(kRegiao, 's3');
  const assinatura = mac(kServico, stringToSign).toString('hex');

  const headers: Record<string, string> = {
    Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${escopo}, SignedHeaders=${signedHeaders}, Signature=${assinatura}`,
    'x-amz-content-sha256': hashPayload,
    'x-amz-date': carimbo,
  };
  if (contentType) headers['Content-Type'] = contentType;
  return { url: `https://${host}${caminho}`, headers };
}

/**
 * Envia um binário para o bucket.
 *
 * Em caso de recusa, inclui a resposta do provedor na mensagem: sem isso uma
 * falha de permissão apareceria como "erro genérico de upload" e o operador não
 * saberia se é chave errada, bucket inexistente ou política bloqueando.
 */
export async function enviarObjeto(chave: string, corpo: Buffer, contentType: string): Promise<{ status: number }> {
  const cfg = configStorage();

  if (cfg.provedor === 'supabase') {
    const resposta = await fetch(`${baseSupabase(cfg)}/${esc(chave)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(cfg.serviceRoleKey)}`,
        apikey: String(cfg.serviceRoleKey),
        'Content-Type': contentType,
        // Sobrescreve em vez de falhar com 409 se a chave ja existir.
        'x-upsert': 'true',
      },
      body: new Uint8Array(corpo),
    });
    if (!resposta.ok) {
      throw new Error(`Supabase Storage recusou o upload (${resposta.status}): ${await resposta.text()}`);
    }
    return { status: resposta.status };
  }

  const { url, headers } = assinaAwsV4(cfg, 'PUT', `/${esc(chave)}`, corpo, contentType);
  const resposta = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(corpo) });
  if (!resposta.ok) {
    throw new Error(`S3 recusou o upload (${resposta.status}): ${await resposta.text()}`);
  }
  return { status: resposta.status };
}

/** Baixa o binário do objeto. */
export async function baixarObjeto(chave: string): Promise<{ corpo: Buffer; contentType: string }> {
  const cfg = configStorage();

  if (cfg.provedor === 'supabase') {
    const resposta = await fetch(`${baseSupabase(cfg)}/${esc(chave)}`, {
      headers: { Authorization: `Bearer ${String(cfg.serviceRoleKey)}`, apikey: String(cfg.serviceRoleKey) },
    });
    if (!resposta.ok) throw new Error(`Objeto não encontrado no bucket (${resposta.status}).`);
    const tipo = resposta.headers.get('content-type') || 'application/octet-stream';
    return { corpo: Buffer.from(await resposta.arrayBuffer()), contentType: tipo };
  }

  const { url, headers } = assinaAwsV4(cfg, 'GET', `/${esc(chave)}`, null, null);
  const resposta = await fetch(url, { method: 'GET', headers });
  if (!resposta.ok) throw new Error(`Objeto não encontrado no bucket (${resposta.status}).`);
  return {
    corpo: Buffer.from(await resposta.arrayBuffer()),
    contentType: resposta.headers.get('content-type') || 'application/octet-stream',
  };
}

/**
 * Remove o objeto do bucket.
 *
 * Usado apenas quando o registro de `Documento` e removido. Arquivamento
 * (janela de 30 dias) NAO chama isto: arquivar esconde do acesso operacional,
 * mas o objeto e o historico permanecem (ver `Documento.situacao`).
 */
export async function removerObjeto(chave: string): Promise<void> {
  const cfg = configStorage();

  if (cfg.provedor === 'supabase') {
    const resposta = await fetch(`${baseSupabase(cfg)}/${esc(chave)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${String(cfg.serviceRoleKey)}`, apikey: String(cfg.serviceRoleKey) },
    });
    if (!resposta.ok && resposta.status !== 404) {
      throw new Error(`Falha ao remover o objeto (${resposta.status}): ${await resposta.text()}`);
    }
    return;
  }

  const { url, headers } = assinaAwsV4(cfg, 'DELETE', `/${esc(chave)}`, null, null);
  const resposta = await fetch(url, { method: 'DELETE', headers });
  if (!resposta.ok && resposta.status !== 404) {
    throw new Error(`Falha ao remover o objeto (${resposta.status}).`);
  }
}

// ---------------------------------------------------------------- links temporários assinados

/** Validade máxima aceita pelo S3 para link pré-assinado (7 dias). */
export const VALIDADE_MAXIMA_LINK_S = 7 * 24 * 60 * 60;

/**
 * Link pré-assinado S3 (AWS Signature V4 na query string). Calculado localmente,
 * sem chamada de rede: quem tem o link lê ESTE objeto até expirar, e só ele.
 */
function urlAssinadaS3(cfg: ConfigStorage, chave: string, segundos: number): string {
  const regiao = cfg.regiao!;
  const host = hostS3(cfg);
  const carimbo = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const data = carimbo.slice(0, 8);
  const escopo = `${data}/${regiao}/s3/aws4_request`;
  const caminho = `/${esc(chave)}`;
  const parametros: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${cfg.accessKeyId}/${escopo}`],
    ['X-Amz-Date', carimbo],
    ['X-Amz-Expires', String(segundos)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const query = parametros.map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).sort().join('&');
  const canonicalRequest = ['GET', caminho, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', carimbo, escopo, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const mac = (k: Buffer | string, d: string): Buffer => createHmac('sha256', k).update(d).digest();
  const kAssina = mac(mac(mac(mac(`AWS4${cfg.secretAccessKey}`, data), regiao), 's3'), 'aws4_request');
  const assinatura = mac(kAssina, stringToSign).toString('hex');
  return `https://${host}${caminho}?${query}&X-Amz-Signature=${assinatura}`;
}

/**
 * Links temporários para várias chaves de uma vez (o catálogo do PDV assina uma
 * página inteira numa só chamada ao Supabase). Devolve um mapa chave → link;
 * chave que o provedor não assinou (ex.: objeto inexistente) fica de fora — o
 * chamador decide o que mostrar no lugar, nunca recebe um link quebrado inventado.
 */
export async function urlsAssinadas(chaves: string[], segundos: number): Promise<Map<string, string>> {
  const unicas = [...new Set(chaves.filter(Boolean))];
  const resultado = new Map<string, string>();
  if (!unicas.length) return resultado;
  const validade = Math.max(60, Math.min(Math.floor(segundos), VALIDADE_MAXIMA_LINK_S));
  const cfg = configStorage();

  if (cfg.provedor === 's3') {
    for (const c of unicas) resultado.set(c, urlAssinadaS3(cfg, c, validade));
    return resultado;
  }

  const base = cfg.projectUrl!.replace(/\/$/, '');
  const resposta = await fetch(`${base}/storage/v1/object/sign/${cfg.bucket}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${String(cfg.serviceRoleKey)}`, apikey: String(cfg.serviceRoleKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: validade, paths: unicas }),
  });
  if (!resposta.ok) throw new Error(`Supabase Storage recusou a assinatura de links (${resposta.status}).`);
  const lista = (await resposta.json()) as Array<{ path?: string; signedURL?: string | null; error?: string | null }>;
  for (const item of lista) {
    if (item.path && item.signedURL && !item.error) resultado.set(item.path, `${base}/storage/v1${item.signedURL}`);
  }
  return resultado;
}

/** Link temporário para uma única chave (lança se o provedor não assinar). */
export async function urlAssinada(chave: string, segundos: number): Promise<string> {
  const url = (await urlsAssinadas([chave], segundos)).get(chave);
  if (!url) throw new Error('O armazenamento não gerou o link temporário deste arquivo.');
  return url;
}
