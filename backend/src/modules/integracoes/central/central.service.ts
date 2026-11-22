/**
 * Central de Integrações — persistência, estados e histórico.
 *
 * Regras:
 *  - empresaId vem SEMPRE da sessão (as rotas nunca aceitam do corpo).
 *  - Segredos: o conjunto de campos secretos vira um JSON cifrado inteiro em
 *    `IntegracaoExterno.credenciais` (AES-256-GCM, `lib/secrets.ts`). A resposta só
 *    traz a máscara (••••1234). Campo secreto vazio no salvar/testar = manter o salvo.
 *  - Testar com credenciais novas NÃO grava nada além do histórico.
 *  - Salvar sempre faz o teste real: CONECTADO só com validação real bem-sucedida.
 *    Falha de credencial → ERRO; falha transitória (timeout/indisponível) →
 *    CREDENCIAIS_SALVAS (salvas, ainda não validadas).
 *  - Histórico (IntegracaoEvento) nunca recebe segredo, token ou corpo de resposta.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { encryptSecret, decryptSecret } from '../../../lib/secrets.js';
import { ErroDeNegocio, NaoEncontrado } from '../../../lib/erros.js';
import { provedorPorId, PROVEDORES, type DefinicaoProvedor } from './provedores.js';
import { ADAPTADORES, mascarar, type ResultadoTeste } from './adaptadores.js';

export type StatusCentral = 'NAO_CONFIGURADO' | 'CREDENCIAIS_SALVAS' | 'AGUARDANDO_AUTORIZACAO' | 'CONECTADO' | 'EXPIRADO' | 'ERRO' | 'DESCONECTADO' | 'INDISPONIVEL';

export type Operacao = 'TESTAR' | 'SALVAR' | 'CONECTAR' | 'DESCONECTAR' | 'REMOVER' | 'SINCRONIZAR';

export async function registrarEvento(input: { empresaId: string; provedor: string; operacao: Operacao; ok: boolean; codigoErro?: string | null; mensagem?: string | null; duracaoMs?: number | null; usuarioId?: string | null }) {
  // O histórico nunca derruba a operação principal.
  try {
    await prisma.integracaoEvento.create({
      data: {
        empresaId: input.empresaId, provedor: input.provedor, operacao: input.operacao,
        resultado: input.ok ? 'SUCESSO' : 'FALHA', codigoErro: input.codigoErro ?? null,
        mensagem: input.mensagem ? input.mensagem.slice(0, 300) : null,
        duracaoMs: input.duracaoMs ?? null, usuarioId: input.usuarioId ?? null,
      },
    });
  } catch { /* sem efeito colateral: histórico é auxiliar */ }
}

function exigirCredenciais(id: string): DefinicaoProvedor {
  const def = provedorPorId(id);
  if (!def) throw NaoEncontrado('Integração não encontrada.');
  if (def.disponibilidade !== 'CREDENCIAIS' || !ADAPTADORES[def.id]) {
    throw new ErroDeNegocio(def.pendencia ?? 'Esta integração não é configurada por credenciais nesta tela.', 409);
  }
  return def;
}

function lerSegredos(cifrado: string | null | undefined): Record<string, string> {
  if (!cifrado) return {};
  try { return JSON.parse(decryptSecret(cifrado)) as Record<string, string>; } catch { return {}; }
}

/** Separa os campos informados em config (não sensível) e segredos; vazio = manter o salvo. */
function montarEntrada(def: DefinicaoProvedor, corpo: Record<string, unknown>, salvo: { config: Record<string, string>; segredos: Record<string, string> }) {
  const config: Record<string, string> = { ...salvo.config };
  const segredos: Record<string, string> = { ...salvo.segredos };
  for (const campo of def.campos) {
    const bruto = corpo[campo.chave];
    const valor = typeof bruto === 'string' ? bruto.trim() : '';
    if (valor.length > 2000) throw new ErroDeNegocio(`${campo.rotulo}: valor longo demais.`, 400);
    if (campo.opcoes && valor && !campo.opcoes.some((o) => o.valor === valor)) throw new ErroDeNegocio(`${campo.rotulo}: opção inválida.`, 400);
    if (campo.secreto) { if (valor) segredos[campo.chave] = valor; }
    else if (valor) config[campo.chave] = valor;
  }
  const faltando = def.campos.filter((c) => c.obrigatorio && !(c.secreto ? segredos[c.chave] : config[c.chave])).map((c) => c.rotulo);
  return { config, segredos, faltando };
}

async function registro(empresaId: string, tipo: string) {
  return prisma.integracaoExterno.findUnique({ where: { empresaId_tipo: { empresaId, tipo } } });
}

function estadoSalvo(reg: Awaited<ReturnType<typeof registro>>) {
  return { config: ((reg?.config ?? {}) as Record<string, string>), segredos: lerSegredos(reg?.credenciais) };
}

function normalizarStatus(status: string | null | undefined): StatusCentral {
  if (!status) return 'NAO_CONFIGURADO';
  if (status === 'REAUTENTICAR') return 'EXPIRADO';
  if (status === 'REVOGADO') return 'DESCONECTADO';
  if (status === 'CONECTANDO') return 'AGUARDANDO_AUTORIZACAO';
  return (['NAO_CONFIGURADO', 'CREDENCIAIS_SALVAS', 'AGUARDANDO_AUTORIZACAO', 'CONECTADO', 'EXPIRADO', 'ERRO', 'DESCONECTADO'] as const).includes(status as never) ? status as StatusCentral : 'ERRO';
}

/** Status real de todos os provedores do catálogo para a empresa (cards + indicadores). */
export async function estadosDaEmpresa(empresaId: string) {
  const [externos, lojasShopee] = await Promise.all([
    prisma.integracaoExterno.findMany({ where: { empresaId }, select: { tipo: true, status: true, accountName: true, ultimoTesteEm: true, ultimoSyncEm: true, conectadoEm: true, tokenExpiry: true, erros: true } }),
    prisma.shopeeConexao.findMany({ where: { empresaId }, select: { status: true, shopName: true, ultimoTesteEm: true, ultimoSyncEm: true, connectedAt: true, tokenExpiry: true, refreshTokenExpiry: true } }),
  ]);
  const agora = Date.now();
  return PROVEDORES.map((def) => {
    if (def.disponibilidade === 'BLOQUEIO_EXTERNO' || def.disponibilidade === 'PLANEJADA') {
      return { provedor: def.id, status: 'INDISPONIVEL' as StatusCentral, conta: null, ultimoTesteEm: null, ultimoSyncEm: null, conectadoEm: null };
    }
    if (def.id === 'shopee') {
      const ativas = lojasShopee.filter((l) => l.status !== 'DESCONECTADO');
      // Loja só conta como conectada com refresh token ainda válido.
      const conectada = ativas.find((l) => l.status === 'CONECTADO' && (!l.refreshTokenExpiry || l.refreshTokenExpiry.getTime() > agora));
      const status: StatusCentral = conectada ? 'CONECTADO' : ativas.length ? normalizarStatus(ativas[0].status === 'CONECTADO' ? 'EXPIRADO' : ativas[0].status) : 'NAO_CONFIGURADO';
      const ref = conectada ?? ativas[0];
      return { provedor: def.id, status, conta: ref ? (ativas.length > 1 ? `${ativas.length} lojas` : ref.shopName ?? null) : null, ultimoTesteEm: ref?.ultimoTesteEm ?? null, ultimoSyncEm: ref?.ultimoSyncEm ?? null, conectadoEm: ref?.connectedAt ?? null };
    }
    const reg = externos.find((e) => e.tipo === def.tipo);
    return { provedor: def.id, status: normalizarStatus(reg?.status), conta: reg?.accountName ?? null, ultimoTesteEm: reg?.ultimoTesteEm ?? null, ultimoSyncEm: reg?.ultimoSyncEm ?? null, conectadoEm: reg?.conectadoEm ?? null };
  });
}

/**
 * Resumo dos indicadores. Saúde = conectadas ÷ (conectadas + com erro), em %:
 * mede quantas integrações EM USO estão funcionando. Não configuradas e
 * indisponíveis não entram (não são falha). Sem nenhuma em uso → null ("—").
 */
export function resumir(estados: { status: StatusCentral }[]) {
  const conectadas = estados.filter((e) => e.status === 'CONECTADO').length;
  const comErro = estados.filter((e) => e.status === 'ERRO' || e.status === 'EXPIRADO').length;
  const naoConfiguradas = estados.filter((e) => ['NAO_CONFIGURADO', 'DESCONECTADO', 'CREDENCIAIS_SALVAS', 'AGUARDANDO_AUTORIZACAO'].includes(e.status)).length;
  const indisponiveis = estados.filter((e) => e.status === 'INDISPONIVEL').length;
  const emUso = conectadas + comErro;
  return { conectadas, comErro, naoConfiguradas, indisponiveis, total: estados.length, saude: emUso ? Math.round((conectadas / emUso) * 100) : null };
}

/** `baseUrlPublica`: endereço público da API, usado para montar a URL do webhook do WhatsApp. */
export async function obterConfiguracao(empresaId: string, id: string, baseUrlPublica?: string) {
  const def = provedorPorId(id);
  if (!def) throw NaoEncontrado('Integração não encontrada.');
  const estados = await estadosDaEmpresa(empresaId);
  const estado = estados.find((e) => e.provedor === id)!;
  let configuracao: { config: Record<string, string>; segredosSalvos: Record<string, string | null> } | null = null;
  let erro: string | null = null;
  let webhookUrl: string | null = null;
  if (def.disponibilidade === 'CREDENCIAIS') {
    const reg = await registro(empresaId, def.tipo);
    const { config, segredos } = estadoSalvo(reg);
    const segredosSalvos: Record<string, string | null> = {};
    for (const c of def.campos.filter((c) => c.secreto)) segredosSalvos[c.chave] = mascarar(segredos[c.chave]);
    configuracao = { config, segredosSalvos };
    erro = (reg?.erros as { message?: string } | null)?.message ?? null;
    // O id do registro (cuid, não adivinhável) identifica a empresa no webhook público;
    // a autenticidade de cada evento vem da assinatura com o App Secret.
    const rotaWebhook: Record<string, string> = { whatsapp: 'whatsapp', asaas: 'asaas', mercadopago: 'mercadopago' };
    if (rotaWebhook[def.id] && reg && baseUrlPublica) webhookUrl = `${baseUrlPublica}/integracoes/${rotaWebhook[def.id]}/webhook/${reg.id}`;
  }
  return { ...estado, erro, configuracao, webhookUrl };
}

async function executarTeste(def: DefinicaoProvedor, config: Record<string, string>, segredos: Record<string, string>) {
  const inicio = Date.now();
  const resultado: ResultadoTeste = await ADAPTADORES[def.id].testar(config, segredos);
  return { resultado, duracaoMs: Date.now() - inicio };
}

/** Testa com o que foi digitado (vazio = salvo). Não grava credenciais novas. */
export async function testar(empresaId: string, usuarioId: string, id: string, corpo: Record<string, unknown>) {
  const def = exigirCredenciais(id);
  const reg = await registro(empresaId, def.tipo);
  const salvo = estadoSalvo(reg);
  const { config, segredos, faltando } = montarEntrada(def, corpo, salvo);
  if (faltando.length) return { ok: false, codigo: 'CONFIGURACAO_INCOMPLETA', mensagem: `Preencha: ${faltando.join(', ')}.` };
  const { resultado, duracaoMs } = await executarTeste(def, config, segredos);
  await registrarEvento({ empresaId, provedor: id, operacao: 'TESTAR', ok: resultado.ok, codigoErro: resultado.ok ? null : resultado.codigo, mensagem: resultado.mensagem, duracaoMs, usuarioId });
  // Testou exatamente a configuração salva? Então o resultado vale como estado real.
  const mesmaConfig = reg?.credenciais && JSON.stringify(salvo.segredos) === JSON.stringify(segredos) && JSON.stringify(salvo.config) === JSON.stringify(config);
  if (reg && mesmaConfig) {
    await prisma.integracaoExterno.update({ where: { id: reg.id }, data: { ultimoTesteEm: new Date(), ...estadoAposTeste(resultado, reg.conectadoEm, { status: reg.status, mesmaCredencial: true }) } });
  }
  return { ok: resultado.ok, codigo: resultado.codigo, mensagem: resultado.mensagem, conta: resultado.conta ?? null };
}

/**
 * Estado depois de um teste real. Falha PASSAGEIRA (timeout, provedor fora do ar, limite de
 * requisições) com as MESMAS credenciais de uma integração já conectada não derruba o status:
 * mantém CONECTADO e registra o aviso no campo erros ("Último erro"). Credencial recusada
 * sempre vira ERRO.
 */
export function estadoAposTeste(resultado: ResultadoTeste, conectadoEm: Date | null | undefined, anterior?: { status?: string | null; mesmaCredencial: boolean }) {
  if (resultado.ok) return { status: 'CONECTADO', erros: Prisma.DbNull, accountName: resultado.conta?.nome ?? null, conectadoEm: conectadoEm ?? new Date() } as const;
  const transitorio = ['TIMEOUT', 'SERVICO_INDISPONIVEL', 'FALHA_COMUNICACAO', 'LIMITE_API'].includes(resultado.codigo);
  const erros = { code: resultado.codigo, message: resultado.mensagem, transitorio };
  if (transitorio && anterior?.mesmaCredencial && anterior.status === 'CONECTADO') return { status: 'CONECTADO', erros } as const;
  return { status: transitorio ? 'CREDENCIAIS_SALVAS' : 'ERRO', erros } as const;
}

/** Valida, testa de verdade, cifra e persiste. */
export async function salvar(empresaId: string, usuarioId: string, id: string, corpo: Record<string, unknown>) {
  const def = exigirCredenciais(id);
  const reg = await registro(empresaId, def.tipo);
  const { config, segredos, faltando } = montarEntrada(def, corpo, estadoSalvo(reg));
  if (faltando.length) throw new ErroDeNegocio(`Preencha: ${faltando.join(', ')}.`, 400);
  const { resultado, duracaoMs } = await executarTeste(def, config, segredos);
  const trocouSegredo = def.campos.some((c) => c.secreto && typeof corpo[c.chave] === 'string' && (corpo[c.chave] as string).trim());
  const estado = estadoAposTeste(resultado, reg?.conectadoEm, { status: reg?.status, mesmaCredencial: Boolean(reg?.credenciais) && !trocouSegredo });
  const dados = {
    nome: def.nome, config, credenciais: encryptSecret(JSON.stringify(segredos)), ultimoTesteEm: new Date(),
    status: estado.status, erros: ('erros' in estado && estado.erros ? estado.erros : Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    ...(resultado.ok ? { accountName: resultado.conta?.nome ?? null, conectadoEm: reg?.conectadoEm ?? new Date() } : {}),
  };
  const salvoReg = reg
    ? await prisma.integracaoExterno.update({ where: { id: reg.id }, data: { ...dados, erros: resultado.ok ? Prisma.DbNull : dados.erros } })
    : await prisma.integracaoExterno.create({ data: { empresaId, tipo: def.tipo, ...dados, erros: resultado.ok ? Prisma.DbNull : dados.erros } });
  await registrarEvento({
    empresaId, provedor: id, operacao: 'SALVAR', ok: resultado.ok, codigoErro: resultado.ok ? null : resultado.codigo, duracaoMs, usuarioId,
    // Registra que a credencial foi substituída, sem nunca registrar valor algum.
    mensagem: `${resultado.mensagem}${trocouSegredo && reg?.credenciais ? ' Credencial substituída.' : ''}`,
  });
  return { ok: resultado.ok, codigo: resultado.codigo, mensagem: resultado.mensagem, status: salvoReg.status, conta: resultado.conta ?? null };
}

/** Desconectar: apaga os segredos (chave de API não tem revogação via API), mantém config e histórico. */
export async function desconectar(empresaId: string, usuarioId: string, id: string) {
  const def = exigirCredenciais(id);
  const reg = await registro(empresaId, def.tipo);
  if (!reg) throw NaoEncontrado('Esta integração não está configurada.');
  await prisma.integracaoExterno.update({ where: { id: reg.id }, data: { credenciais: null, status: 'DESCONECTADO', accountName: null, conectadoEm: null, erros: Prisma.DbNull } });
  await registrarEvento({ empresaId, provedor: id, operacao: 'DESCONECTAR', ok: true, mensagem: 'Credenciais apagadas. Revogue a chave também no painel do provedor.', usuarioId });
  return { ok: true, status: 'DESCONECTADO' };
}

/** Remover: apaga configuração e credenciais. O histórico de eventos é preservado. */
export async function remover(empresaId: string, usuarioId: string, id: string) {
  const def = exigirCredenciais(id);
  const reg = await registro(empresaId, def.tipo);
  if (!reg) throw NaoEncontrado('Esta integração não está configurada.');
  await prisma.integracaoExterno.delete({ where: { id: reg.id } });
  await registrarEvento({ empresaId, provedor: id, operacao: 'REMOVER', ok: true, mensagem: 'Configuração removida.', usuarioId });
  return { ok: true, status: 'NAO_CONFIGURADO' };
}

export async function historico(empresaId: string, id: string) {
  if (!provedorPorId(id)) throw NaoEncontrado('Integração não encontrada.');
  const eventos = await prisma.integracaoEvento.findMany({ where: { empresaId, provedor: id }, orderBy: { createdAt: 'desc' }, take: 50 });
  const ids = [...new Set(eventos.map((e) => e.usuarioId).filter(Boolean))] as string[];
  const usuarios = ids.length ? await prisma.usuario.findMany({ where: { id: { in: ids }, empresaId }, select: { id: true, nome: true } }) : [];
  return eventos.map((e) => ({ id: e.id, operacao: e.operacao, resultado: e.resultado, codigoErro: e.codigoErro, mensagem: e.mensagem, duracaoMs: e.duracaoMs, usuario: usuarios.find((u) => u.id === e.usuarioId)?.nome ?? null, em: e.createdAt }));
}

/**
 * Configuração + segredos decifrados de um provedor da empresa, para uso INTERNO do
 * servidor (envio de mensagens, webhooks). Nunca devolver isto em resposta HTTP.
 */
export async function credenciaisInternas(empresaId: string, id: string) {
  const def = provedorPorId(id);
  if (!def) throw NaoEncontrado('Integração não encontrada.');
  const reg = await registro(empresaId, def.tipo);
  if (!reg?.credenciais) return null;
  return { id: reg.id, status: normalizarStatus(reg.status), ...estadoSalvo(reg) };
}

/** Variante por id do registro (webhook público: a empresa vem do registro, não do chamador). */
export async function credenciaisPorRegistro(registroId: string, tipo: string) {
  const reg = await prisma.integracaoExterno.findFirst({ where: { id: registroId, tipo } });
  if (!reg?.credenciais) return null;
  return { id: reg.id, empresaId: reg.empresaId, ...estadoSalvo(reg) };
}
