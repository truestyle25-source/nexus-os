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

export const ADAPTADORES: Record<string, Adaptador> = { asaas };
