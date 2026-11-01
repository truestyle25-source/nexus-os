import { randomBytes } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { encryptSecret, decryptSecret } from '../../lib/secrets.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { Prisma } from '@prisma/client';

/** Valores aceitos na coluna `status` do `IntegracaoExterno`. */
export type StatusIntegracaoExterno = | 'NAO_CONFIGURADO' | 'CONECTANDO' | 'CONECTADO' | 'EXPIRADO' | 'ERRO' | 'REAUTENTICAR' | 'REVOGADO';

/** Escopos oficiais do Mercado Livre OAuth. `offline_access` garante refresh_token. */
// Estoque é enviado do NEXUS para os anúncios, portanto a autorização precisa
// incluir escrita além de leitura e renovação offline.
export const MERCADOLIVRE_SCOPES = ['offline_access', 'read', 'write'] as const;

export interface ConfiguracoesAmbiente {
  clientId: string | undefined;
  clientSecret: string | undefined;
  redirectUri: string | undefined;
}

/** LÃª as variÃ¡veis de ambiente do provedor. Nenhum valor padrÃ£o Ã© adivinhado aqui â€” o padrÃ£o sÃ³ Ã© aplicado nas URLs de rede, que o mercado define. */
export function obterConfiguracoes(): ConfiguracoesAmbiente {
  return {
    clientId: process.env.MERCADOLIVRE_CLIENT_ID,
    clientSecret: process.env.MERCADOLIVRE_CLIENT_SECRET,
    redirectUri: process.env.MERCADOLIVRE_REDIRECT_URI,
  };
}

export const STATE_TTL_MS = 10 * 60 * 1000;

export function gerarState(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Trava EM PROCESSO contra renovações simultâneas do mesmo cadastro.
 *
 * Limitação documentada: o backend roda como um único processo Node (Fastify +
 * agendador no mesmo runtime), então este Map basta para conciliar chamadas
 * concorrentes DENTRO desta instância. NÃO é proteção distribuída: com várias
 * instâncias do servidor cada uma teria seu próprio Map — nesse cenário seria
 * necessária uma trava no banco (ex.: claim atômico sobre `IntegracaoExterno`).
 */
const renovacoesEmAndamento = new Map<string, Promise<{ ok: true; tokenExpiry: Date | null }>>;
export interface NovoCadastroOauth {
  empresaId: string;
  nome: string;
  usuarioId: string;
}

export interface RespostaIniciarOauth {
  state: string;
  redirectUri: string;
  authUrl: string;
}

/** Inicia o fluxo: grava o `state` no banco e retorna a URL de autenticação.
 * O `state` é um nonce aleatório vinculado à (empresaId, tipo) com validade
 * de 10 minutos e uso único; nunca é logado. Reaproveita o registro da
 * empresa (unique por empresa+tipo) em vez de criar duplicados: CONECTADO
 * exige revogar antes (409); qualquer outro status pendente/falho
 * (CONECTANDO, NAO_CONFIGURADO, EXPIRADO, ERRO, REAUTENTICAR) apenas renova
 * o state (retomada segura). Concorrentes simultâneos na criação são
 * conciliados via unique: o perdedor relê e retoma o registro vencedor. */
export async function iniciarCadastroOauth({ empresaId, nome, usuarioId }: NovoCadastroOauth): Promise<RespostaIniciarOauth> {
  const cfg = obterConfiguracoes();
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
    throw new ErroDeNegocio('Configuração incompleta do Mercado Livre. Defina MERCADOLIVRE_CLIENT_ID, MERCADOLIVRE_CLIENT_SECRET e MERCADOLIVRE_REDIRECT_URI.', 500);
  }
  const state = gerarState();
  const expiraEm = new Date(Date.now() + STATE_TTL_MS);
  const credenciais = {
    nome,
    status: 'CONECTANDO',
    state,
    stateExpiraEm: expiraEm,
    clientId: encryptSecret(cfg.clientId),
    clientSecret: encryptSecret(cfg.clientSecret),
    redirectUri: cfg.redirectUri,
    scope: MERCADOLIVRE_SCOPES.join(' '),
  } as const;
  const existente = await prisma.integracaoExterno.findFirst({
    where: { empresaId, tipo: 'MERCADO_LIVRE' },
    select: { id: true, status: true },
  });
  let registroId: string;
  if (existente && existente.status === 'CONECTADO') {
    throw new ErroDeNegocio('Já existe uma conta vinculada. Revogue a conexão atual antes de iniciar outra.', 409);
  }
  if (existente) {
    const retomado = await prisma.integracaoExterno.update({
      where: { id: existente.id },
      data: { ...credenciais },
      select: { id: true },
    });
    registroId = retomado.id;
  } else {
    try {
      const criado = await prisma.integracaoExterno.create({
        data: { empresaId, tipo: 'MERCADO_LIVRE', ...credenciais },
        select: { id: true },
      });
      registroId = criado.id;
    } catch (err) {
      // Corrida: outro início simultâneo venceu o unique (empresaId, tipo).
      // Retoma o registro vencedor em vez de estourar 409/500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const vencedor = await prisma.integracaoExterno.findFirst({
          where: { empresaId, tipo: 'MERCADO_LIVRE' },
          select: { id: true, status: true },
        });
        if (!vencedor) throw err;
        if (vencedor.status === 'CONECTADO') {
          throw new ErroDeNegocio('Já existe uma conta vinculada. Revogue a conexão atual antes de iniciar outra.', 409);
        }
        const retomado = await prisma.integracaoExterno.update({
          where: { id: vencedor.id },
          data: { ...credenciais },
          select: { id: true },
        });
        registroId = retomado.id;
      } else {
        throw err;
      }
    }
  }
  await registrarAuditoria({
    usuarioId,
    empresaId,
    acao: 'CRIAR',
    entidade: 'IntegracaoExterno',
    entidadeId: registroId,
    valorNovo: { status: 'CONECTANDO' },
    origem: 'INTEGRACAO',
    ip: undefined,
  });
  const authUrl = `${process.env.MERCADOLIVRE_AUTH_URL || 'https://auth.mercadolivre.com.br/authorization'}?response_type=code&client_id=${cfg.clientId}&redirect_uri=${encodeURIComponent(cfg.redirectUri)}&scope=${encodeURIComponent(MERCADOLIVRE_SCOPES.join(' '))}&state=${state}`;
  return { state, redirectUri: cfg.redirectUri, authUrl };
}
export interface DadosCallbackOauth {
  empresaId: string;
  usuarioId?: string;
  state: string;
  code: string;
}

export interface ContaVinculada {
  accountId: string;
  accountName: string | null;
  nickname: string | null;
  email: string | null;
}

async function trocarCodigoPorToken({ code, redirectUri, clientId, clientSecret }: { code: string; redirectUri: string; clientId: string; clientSecret: string; }): Promise<{ status: number | null; data: Record<string, unknown> }> {
  const tokenUrl = process.env.MERCADOLIVRE_TOKEN_URL || 'https://api.mercadolibre.com/oauth/token';
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const data = await resp.json().catch(() => ({}));

  return { status: resp.status, data: data as Record<string, unknown> };
}

async function validarConta(accessToken: string): Promise<ContaVinculada> {
  const userUrl = process.env.MERCADOLIVRE_USER_URL || 'https://api.mercadolibre.com/users/me';
  const resp = await fetch(userUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (resp.status === 401) {
    throw new ErroDeNegocio('Acesso negado: token expirado ou conta encerrada no Mercado Livre.', 401);
  }
  if (!resp.ok) {
    throw new ErroDeNegocio('Falha ao validar a conta no Mercado Livre.', 502);
  }
  const data = (await resp.json()) as { id: string | number; nickname: string; first_name?: string; last_name?: string; email?: string; };
  return {
    // A API do Mercado Livre devolve `id` NUMÉRICO; a coluna é TEXT — coerção
    // explícita aqui para o Prisma não receber um number em campo String.
    accountId: String(data.id),
    accountName: `${data.first_name || ''} ${data.last_name || ''}`.trim() || null,
    nickname: data.nickname || null,
    email: data.email || null,
  };
}

async function marcarExpirado(registro: { id: string }, detalhe: string) {
  await prisma.integracaoExterno.update({
    where: { id: registro.id },
    data: { status: 'EXPIRADO', erros: { message: detalhe }, ultimoTesteEm: new Date() },
  });
}

export async function finalizarOAuth({ empresaId, usuarioId, state, code }: DadosCallbackOauth): Promise<ContaVinculada> {
  const candidato = await prisma.integracaoExterno.findFirst({
    where: { empresaId, tipo: 'MERCADO_LIVRE', state, status: 'CONECTANDO' },
    orderBy: { createdAt: 'desc' },
  });
  if (!candidato) {
    throw new ErroDeNegocio('Estado de autenticação inválido ou expirado. Inicie a conexão novamente.', 400);
  }
  if (candidato.stateExpiraEm instanceof Date && candidato.stateExpiraEm.getTime() < Date.now()) {
    await marcarExpirado(candidato, 'State expirado (10 min). Inicie a conexão novamente.');
    throw new ErroDeNegocio('Estado de autenticação inválido ou expirado. Inicie a conexão novamente.', 400);
  }
  // Consumo ATÔMICO do state (uso único, anti-corrida): a linha só é
  // reivindicada se ainda estiver CONECTANDO com este state. O segundo
  // callback simultâneo com o mesmo state encontra 0 linhas e cai no 400.
  const reivindicado = await prisma.integracaoExterno.updateMany({
    where: { id: candidato.id, empresaId, state, status: 'CONECTANDO' },
    data: { state: null, stateExpiraEm: null },
  });
  if (reivindicado.count === 0) {
    throw new ErroDeNegocio('Estado de autenticação inválido ou expirado. Inicie a conexão novamente.', 400);
  }
  const registro = candidato;
  const cfg = {
    clientId: decryptSecret(registro.clientId!) as string,
    clientSecret: decryptSecret(registro.clientSecret!) as string,
    redirectUri: registro.redirectUri!,
  };
  const { status: tokenStatus, data: tokenData } = await trocarCodigoPorToken({
    code,
    redirectUri: cfg.redirectUri,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
  });
  if (!tokenStatus || tokenStatus >= 400 || !tokenData.access_token) {
    await marcarExpirado(registro, `Falha ao trocar cÃ³digo por token (HTTP ${tokenStatus}).`);
    throw new ErroDeNegocio('Falha ao concluir a autenticaÃ§Ã£o com Mercado Livre. Verifique suas credenciais e tente novamente.', 502);
  }
  const accessToken = tokenData.access_token as string;
  const refreshToken = typeof tokenData.refresh_token === 'string' && tokenData.refresh_token ? tokenData.refresh_token : '';
  const expiresIn = Number(tokenData.expires_in ?? 0);
  const tokenExpiry = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
  let conta: ContaVinculada;
  try {
    conta = await validarConta(accessToken);
  } catch (err) {
    await marcarExpirado(registro, (err as ErroDeNegocio).message ?? 'Conta nÃ£o validada.');
    throw new ErroDeNegocio('Sua conta no Mercado Livre nÃ£o pÃ´de ser validada. Reinicie a conexÃ£o.', 401);
  }
  const atualizado = await prisma.integracaoExterno.update({
    where: { id: registro.id },
    data: {
      // Identidade da conta: sem persistir aqui, `GET /integracoes/mercadolivre`
      // e o card da Central nunca saberiam QUAL conta foi vinculada.
      accountId: conta.accountId,
      accountName: conta.accountName,
      accessToken: encryptSecret(accessToken),
      refreshToken: refreshToken ? encryptSecret(refreshToken) : null,
      tokenExpiry,
      status: 'CONECTADO',
      ultimoTesteEm: new Date(),
      erros: Prisma.JsonNull,
    },
  });
  await registrarAuditoria({
    usuarioId,
    empresaId,
    acao: 'CRIAR',
    entidade: 'IntegracaoExterno',
    entidadeId: atualizado.id,
    valorNovo: { ...conta, status: 'CONECTADO' },
    origem: 'INTEGRACAO',
    ip: undefined,
  });
  // Conta recém-conectada => provisiona as tarefas do agendador automático e
  // reativa quaisquer PAUSADAS (reconectar é evidência de novo ciclo). Import
  // dinâmico de propósito: evita ciclo de módulos no boot (o agendador importa
  // os serviços de sync que importam este arquivo de volta).
  try {
    const { provisionarTarefasML } = await import('./agendador-ml.js');
    await provisionarTarefasML(empresaId, { reativar: true });
  } catch (falha) {
    console.error('[mercadolivre] provisionamento de tarefas agendadas falhou (conta conectada):', falha);
  }
  return conta;
}
export async function listarCadastros(empresaId: string) {
  return prisma.integracaoExterno.findFirst({
    where: { empresaId, tipo: 'MERCADO_LIVRE' },
  });
}

/**
 * Renovação do access token via refresh_token (grant_type=refresh_token).
 * Uso único por chamada: se o ML rotacionar o refresh_token, o novo valor
 * substitui o antigo. Falha de rede/credencial marca EXPIRADO sem apagar
 * os tokens atuais (permite nova tentativa); resposta 400/invalid_grant
 * marca REAUTENTICAR porque o refresh foi revogado no provedor.
 *
 * Concorrência: duas chamadas simultâneas para o MESMO cadastro
 * (empresaId:id) compartilham a mesma promessa — só UMA chamada real ao
 * /oauth/token acontece, a rotação do refresh_token não é disputada e quem
 * espera recebe o mesmo resultado real (sucesso OU falha). A entrada no Map
 * é registrada de forma síncrona, antes de qualquer await, e removida em
 * `finally`: uma nova chamada só volta a renovar depois que a anterior
 * terminou (então o refresh_token lido do banco já está rotacionado).
 */
export async function renovarToken(empresaId: string, id: string) {
  const chave = `${empresaId}:${id}`;
  const pendente = renovacoesEmAndamento.get(chave);
  if (pendente) return pendente;
  const renovacao = executarRenovacaoToken(empresaId, id).finally(() => {
    renovacoesEmAndamento.delete(chave);
  });
  renovacoesEmAndamento.set(chave, renovacao);
  return renovacao;
}

/** Corpo da renovação — executado sempre sob a trava de `renovarToken`. */
async function executarRenovacaoToken(
  empresaId: string,
  id: string,
): Promise<{ ok: true; tokenExpiry: Date | null }> {
  const registro = await obterCadastro(empresaId, id);
  if (!registro.refreshToken) {
    throw new ErroDeNegocio('Conta sem refresh token. Reautentique a conta.', 400);
  }
  let refreshToken: string;
  let clientId: string;
  let clientSecret: string;
  try {
    refreshToken = decryptSecret(registro.refreshToken!) as string;
    clientId = decryptSecret(registro.clientId!) as string;
    clientSecret = decryptSecret(registro.clientSecret!) as string;
  } catch {
    throw new ErroDeNegocio('Credenciais ilegíveis. Reautentique a conta.', 500);
  }
  const tokenUrl = process.env.MERCADOLIVRE_TOKEN_URL || 'https://api.mercadolibre.com/oauth/token';
  let resp: Response;
  try {
    resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch {
    throw new ErroDeNegocio('Falha de rede ao renovar o token. Tente novamente.', 502);
  }
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok || typeof data.access_token !== 'string') {
    const codigo = typeof data.error === 'string' ? data.error : '';
    if (resp.status === 400 && (codigo === 'invalid_grant' || codigo === 'invalid_client')) {
      await prisma.integracaoExterno.update({
        where: { id },
        data: { status: 'REAUTENTICAR', erros: { message: 'Refresh token revogado no Mercado Livre.' }, ultimoTesteEm: new Date() },
      });
      throw new ErroDeNegocio('Autorização revogada no Mercado Livre. Reconecte a conta.', 401);
    }
    throw new ErroDeNegocio('Falha ao renovar o token. Tente novamente.', 502);
  }
  const expiresIn = Number(data.expires_in ?? 0);
  const atualizado = await prisma.integracaoExterno.update({
    where: { id },
    data: {
      accessToken: encryptSecret(data.access_token as string),
      refreshToken: typeof data.refresh_token === 'string' && data.refresh_token
        ? encryptSecret(data.refresh_token)
        : undefined,
      tokenExpiry: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
      status: 'CONECTADO',
      erros: Prisma.JsonNull,
      ultimoTesteEm: new Date(),
    },
  });
  return { ok: true, tokenExpiry: atualizado.tokenExpiry };
}

export async function obterCadastro(empresaId: string, id: string) {
  const registro = await prisma.integracaoExterno.findFirst({
    where: { id, empresaId },
  });
  if (!registro) throw NaoEncontrado('Cadastro nÃ£o encontrado nesta empresa.');
  return registro;
}

/** Validação de conectividade na API oficial do Mercado Livre (GET /users/me).
 * Atualiza `status` e `accountName` de acordo com a resposta real. Em 401,
 * tenta UMA renovação via refresh_token antes de marcar EXPIRADO: cobre o
 * caso comum de access_token curto sem exigir reautenticação manual.
 * Nunca expõe tokens; se `obterCadastro` falhar, a chamada externa nem inicia.
 */
export async function testarConectividade(empresaId: string, id: string) {
  const registro = await obterCadastro(empresaId, id);
  if (!registro.accessToken) {
    throw new ErroDeNegocio('Conta não conectada. Inicie a autenticação novamente.', 400);
  }
  let accessToken: string;
  try {
    accessToken = decryptSecret(registro.accessToken!) as string;
  } catch {
    throw new ErroDeNegocio('Credenciais ilegíveis. Reautentique a conta.', 500);
  }
  const userUrl = process.env.MERCADOLIVRE_USER_URL || 'https://api.mercadolibre.com/users/me';
  let resp: Response;
  try {
    resp = await fetch(userUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ErroDeNegocio('Falha de rede ao validar a conta no Mercado Livre. Tente novamente.', 502);
  }
  if (resp.status === 401 && registro.refreshToken) {
    // Access token curto expirado, mas há refresh: renova e repete o /users/me uma vez.
    try {
      await renovarToken(empresaId, id);
      const novo = await obterCadastro(empresaId, id);
      const repetido = await fetch(userUrl, {
        headers: { Authorization: `Bearer ${decryptSecret(novo.accessToken!) as string}` },
      });
      resp = repetido;
    } catch {
      // A renovação já marcou o status adequado (REAUTENTICAR/EXPIRADO);
      // cai no tratamento 401 abaixo com a resposta original.
    }
  }
  if (resp!.status === 401) {
    const atual = await obterCadastro(empresaId, id);
    // Se a renovação automática já marcou REAUTENTICAR, preserva o diagnóstico.
    if (atual.status !== 'REAUTENTICAR') {
      await prisma.integracaoExterno.update({
        where: { id },
        data: { status: 'EXPIRADO', erros: { message: 'Token expirado.' }, ultimoTesteEm: new Date() },
      });
    }
    throw new ErroDeNegocio('Token expirado. Reautentique a conta.', 401);
  }
  if (!resp.ok) {
    await prisma.integracaoExterno.update({
      where: { id },
      data: { status: 'ERRO', erros: { message: `API retornou HTTP ${resp.status}.` }, ultimoTesteEm: new Date() },
    });
    throw new ErroDeNegocio(`Falha na validaÃ§Ã£o da conta no Mercado Livre (HTTP ${resp.status}).`, 502);
  }
  const data = (await resp.json()) as { id: string | number; nickname: string };
  const atualizado = await prisma.integracaoExterno.update({
    where: { id },
    data: { status: 'CONECTADO', accountName: data.nickname || null, ultimoTesteEm: new Date() },
  });
  return { ok: true, accountId: String(data.id), accountName: data.nickname || null, ultimoTesteEm: atualizado.ultimoTesteEm };
}

/** RevogaÃ§Ã£o local + tentativa de notificaÃ§Ã£o ao Mercado Livre.
 * O registro Ã© sempre removido; a chamada externa Ã© best-effort e nÃ£o falha a rota.
 */
export async function revogarCadastro(empresaId: string, id: string) {
  const registro = await obterCadastro(empresaId, id);
  if (registro.accessToken) {
    const accessToken = decryptSecret(registro.accessToken!) as string;
    const clientId = registro.clientId ? (decryptSecret(registro.clientId!) as string) : '';
    const clientSecret = registro.clientSecret ? (decryptSecret(registro.clientSecret!) as string) : '';
    await fetch(`${process.env.MERCADOLIVRE_TOKEN_URL || 'https://api.mercadolibre.com/oauth/token'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'revoke',
        token: accessToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }).catch(() => undefined);
  }
  await prisma.integracaoExterno.delete({ where: { id } });
  await registrarAuditoria({
    usuarioId: undefined,
    empresaId,
    acao: 'EXCLUIR',
    entidade: 'IntegracaoExterno',
    entidadeId: id,
    valorAnterior: { status: 'REVOGADO' },
    valorNovo: { status: 'REVOGADO' },
    origem: 'INTEGRACAO',
    ip: undefined,
  });
  return { ok: true };
}
