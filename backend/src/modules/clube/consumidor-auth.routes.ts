/**
 * NEXUS CLUB — Fase 3: cadastro e autenticação do consumidor (rotas /club).
 *
 * Desligado por padrão (ver clube-config.ts): sem a chave e os segredos, tudo aqui responde
 * 503, menos GET /club/status.
 *
 * Segurança:
 *  - senha com hash (bcrypt, o mesmo do login da empresa); nunca volta em resposta nem log;
 *  - CPF: dígitos verificadores conferidos; guardado cifrado + HMAC para busca;
 *  - cadastro não revela se e-mail/CPF já existem (resposta igual; o dono recebe um aviso);
 *  - login por e-mail ou CPF, com limite por IP e por conta; senha conferida mesmo sem conta
 *    (tempo igual), e "confirme seu e-mail" só aparece depois da senha certa;
 *  - tokens de e-mail de uso único, com validade, só o hash no banco;
 *  - crachá do consumidor com segredo próprio; logout e troca de senha invalidam o crachá;
 *  - acesso ao banco no escopo do consumidor: ele só enxerga a própria conta (regras da Fase 2).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { hashSenha, verificarSenha } from '../../lib/auth.js';
import { encryptSecret, decryptSecret } from '../../lib/secrets.js';
import { isValidCpf, normalizeCpf } from '../../domain/cpf.js';
import { createRateLimiter } from '../../middlewares/rateLimiter.js';
import { comoSistema, definirConsumidorDaRequisicao, definirSistemaDaRequisicao } from '../../lib/tenant-context.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { clubeHabilitado, hashCpf } from './clube-config.js';
import { emitirCrachaConsumidor, lerCrachaConsumidor, VALIDADE_SESSAO_CONSUMIDOR_S, type CrachaConsumidor } from './token-consumidor.js';
import { TERMOS_OBRIGATORIOS_CADASTRO, termosPendentes, termosVigentes } from './consentimento.service.js';
import { enviarEmailRedefinicaoClube, enviarEmailTentativaCadastroClube, enviarEmailVerificacaoClube } from './emails-clube.js';

const VALIDADE_VERIFICACAO_MS = 24 * 60 * 60 * 1000;
const VALIDADE_REDEFINICAO_MS = 60 * 60 * 1000;
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const MSG_CADASTRO = 'Se os dados estiverem corretos, enviamos um e-mail para confirmar a conta.';
const MSG_RECUPERAR = 'Se o e-mail tiver conta no NEXUS CLUB, enviamos as instruções para criar uma nova senha.';

/** Senha: 8 a 72 caracteres (limite do bcrypt), com letra e número. */
export const senhaSchema = z.string()
  .min(8, 'A senha precisa ter pelo menos 8 caracteres.')
  .max(72, 'A senha pode ter no máximo 72 caracteres.')
  .refine((s) => /[A-Za-zÀ-ÿ]/.test(s) && /\d/.test(s), 'A senha precisa ter letras e números.');

const telefone = z.string().trim().max(20).regex(/^[\d\s()+-]*$/, 'Telefone inválido.').optional().nullable();
const email = z.string().trim().toLowerCase().email('E-mail inválido.').max(180);

let hashFalso: Promise<string> | null = null;
/** Hash fixo para conferir senha mesmo quando a conta não existe (tempo de resposta igual). */
const hashParaComparar = () => (hashFalso ??= hashSenha(randomBytes(16).toString('hex')));

function mascararCpf(cifrado: string): string | null {
  try {
    const d = normalizeCpf(decryptSecret(cifrado));
    return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : null;
  } catch { return null; }
}

const auditar = (dados: { consumidorId?: string; contexto: string; ip?: string; valorNovo?: Prisma.InputJsonValue }) =>
  comoSistema('club:auditoria', () => registrarAuditoria({
    acao: 'EDITAR', entidade: 'ContaConsumidor', entidadeId: dados.consumidorId, origem: 'NEXUS_CLUB',
    ip: dados.ip, contexto: dados.contexto, valorNovo: dados.valorNovo,
  })).catch(() => undefined);

export async function exigirClube(_req: FastifyRequest, reply: FastifyReply) {
  if (!clubeHabilitado()) return reply.status(503).send({ error: 'O NEXUS CLUB ainda não está disponível.' });
}

export interface ConsumidorAutenticado { id: string; cracha: CrachaConsumidor; termosPendentes: Array<{ id: string; tipo: string; versao: number; publicadoEm: Date }> }

/**
 * Autentica o consumidor: crachá válido (segredo do clube, tipo e audiência), conta ATIVA,
 * crachá emitido depois da última troca de senha e não revogado (logout). Abre o escopo do
 * consumidor no banco. O crachá de funcionário é recusado aqui (outro segredo).
 */
export async function autenticarConsumidor(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization || '';
  const cracha = lerCrachaConsumidor(auth.startsWith('Bearer ') ? auth.slice(7).trim() : null);
  if (!cracha) return reply.status(401).send({ error: 'Entre na sua conta do NEXUS CLUB.' });
  definirConsumidorDaRequisicao(cracha.sub);
  const [conta, revogado] = await Promise.all([
    prisma.contaConsumidor.findUnique({ where: { id: cracha.sub }, select: { id: true, status: true, sessoesValidasDesde: true } }),
    prisma.tokenRevogado.findFirst({ where: { jti: cracha.jti, expiraEm: { gt: new Date() } }, select: { id: true } }),
  ]);
  if (!conta || conta.status !== 'ATIVA' || revogado
    || (conta.sessoesValidasDesde && cracha.emitidoEmMs < conta.sessoesValidasDesde.getTime())) {
    return reply.status(401).send({ error: 'Sessão encerrada. Entre novamente.' });
  }
  // Termos mudaram depois do aceite (ex.: a minuta provisória foi trocada pela versão final):
  // até aceitar a versão nova, a pessoa só vê os próprios dados, aceita os termos ou sai.
  const pendentes = await termosPendentes(conta.id);
  if (pendentes.length && !ROTAS_COM_TERMOS_PENDENTES.has(`${req.method} ${req.routeOptions?.url ?? ''}`)) {
    return reply.status(428).send({ error: 'Os termos do NEXUS CLUB mudaram. Leia e aceite a nova versão para continuar.', codigo: 'TERMOS_PENDENTES', termos: pendentes });
  }
  (req as any).consumidor = { id: conta.id, cracha, termosPendentes: pendentes } satisfies ConsumidorAutenticado;
}

/** O que continua liberado enquanto há termo novo para aceitar. */
const ROTAS_COM_TERMOS_PENDENTES = new Set(['GET /club/eu', 'POST /club/termos/aceitar', 'POST /club/auth/logout']);

export async function consumidorAuthRoutes(app: FastifyInstance): Promise<void> {
  const porIp = (nome: string, max: number, janelaMs: number) => createRateLimiter(max, janelaMs, { nome });
  const porChave = (nome: string, max: number, janelaMs: number, chave: (req: FastifyRequest) => string | null) =>
    createRateLimiter(max, janelaMs, { nome, chaveExtra: (req) => { const c = chave(req); return c ? `k:${c}` : null; } });
  const corpo = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;
  const QUINZE_MIN = 15 * 60 * 1000; const HORA = 60 * 60 * 1000;
  const base = [exigirClube];

  app.get('/club/status', async () => ({ habilitado: clubeHabilitado() }));

  app.get('/club/termos/vigentes', { preHandler: base }, async () => {
    definirSistemaDaRequisicao('club:termos');
    const termos = await termosVigentes(TERMOS_OBRIGATORIOS_CADASTRO);
    return { termos, completos: termos.length === TERMOS_OBRIGATORIOS_CADASTRO.length };
  });

  // ---------------------------------------------------------------- cadastro
  app.post('/club/auth/cadastro', { preHandler: [...base, porIp('club:cadastro', 5, HORA)] }, async (req, reply) => {
    definirSistemaDaRequisicao('club:cadastro');
    const d = z.object({
      nome: z.string().trim().min(2, 'Informe seu nome.').max(120),
      email,
      cpf: z.string().trim().max(20),
      senha: senhaSchema,
      celular: telefone,
      whatsapp: telefone,
      nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de nascimento inválida.').optional().nullable(),
      aceites: z.array(z.string().min(1)).max(10),
    }).parse(req.body);
    if (!isValidCpf(d.cpf)) return reply.status(400).send({ error: 'CPF inválido.' });
    const nascimento = d.nascimento ? new Date(`${d.nascimento}T00:00:00Z`) : null;
    if (nascimento && (Number.isNaN(nascimento.getTime()) || nascimento > new Date() || nascimento.getUTCFullYear() < 1900)) {
      return reply.status(400).send({ error: 'Data de nascimento inválida.' });
    }

    const vigentes = await termosVigentes(TERMOS_OBRIGATORIOS_CADASTRO);
    if (vigentes.length !== TERMOS_OBRIGATORIOS_CADASTRO.length) {
      return reply.status(503).send({ error: 'Os termos do NEXUS CLUB ainda não foram publicados. Tente mais tarde.' });
    }
    if (!vigentes.every((t) => d.aceites.includes(t.id))) {
      return reply.status(400).send({ error: 'É preciso aceitar os Termos de Uso e a Política de Privacidade (versão atual).', termos: vigentes.map((t) => ({ id: t.id, tipo: t.tipo, versao: t.versao })) });
    }

    const cpfHash = hashCpf(d.cpf);
    const existentes = await prisma.contaConsumidor.findMany({
      where: { OR: [{ email: d.email }, { cpfHash }] }, select: { id: true, email: true, nome: true, status: true },
    });
    const avisarDonos = async () => {
      for (const c of existentes.filter((x) => x.status !== 'ENCERRADA')) await enviarEmailTentativaCadastroClube({ para: c.email, nome: c.nome });
    };
    if (existentes.length) {
      await avisarDonos();
      await auditar({ consumidorId: existentes[0].id, contexto: 'NEXUS CLUB: tentativa de cadastro com e-mail ou CPF já cadastrado (dono avisado)', ip: req.ip });
      return reply.status(202).send({ message: MSG_CADASTRO });
    }

    const tokenBruto = randomBytes(32).toString('hex');
    let conta: { id: string; nome: string; email: string };
    try {
      conta = await prisma.$transaction(async (tx) => {
        const c = await tx.contaConsumidor.create({
          data: {
            email: d.email, cpfHash, cpfCifrado: encryptSecret(normalizeCpf(d.cpf)), nome: d.nome,
            celular: d.celular || null, whatsapp: d.whatsapp || null, nascimento, senhaHash: await hashSenha(d.senha),
          },
          select: { id: true, nome: true, email: true },
        });
        await tx.termoAceite.createMany({ data: vigentes.map((t) => ({ consumidorId: c.id, termoVersaoId: t.id, empresaId: null, ip: req.ip })) });
        await tx.consumidorToken.create({ data: { consumidorId: c.id, tipo: 'VERIFICAR_EMAIL', tokenHash: hashToken(tokenBruto), expiraEm: new Date(Date.now() + VALIDADE_VERIFICACAO_MS) } });
        return c;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return reply.status(202).send({ message: MSG_CADASTRO }); // cadastro simultâneo com os mesmos dados
      throw e;
    }
    const envio = await enviarEmailVerificacaoClube({ para: conta.email, nome: conta.nome, tokenBruto });
    await auditar({ consumidorId: conta.id, contexto: `NEXUS CLUB: conta criada (aguardando e-mail)${envio.enviado ? '' : ' — FALHA NO ENVIO DO E-MAIL'}`, ip: req.ip, valorNovo: { termos: vigentes.map((t) => `${t.tipo} v${t.versao}`) } });
    return reply.status(202).send({ message: MSG_CADASTRO });
  });

  app.post('/club/auth/verificar-email', { preHandler: [...base, porIp('club:verificar', 20, QUINZE_MIN)] }, async (req, reply) => {
    definirSistemaDaRequisicao('club:verificar-email');
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.body);
    const reg = await prisma.consumidorToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { consumidor: { select: { id: true, status: true } } } });
    if (!reg || reg.tipo !== 'VERIFICAR_EMAIL' || reg.usadoEm || reg.expiraEm < new Date()) {
      return reply.status(400).send({ error: 'Link inválido ou vencido. Peça um novo e-mail de confirmação.' });
    }
    await prisma.$transaction([
      prisma.consumidorToken.update({ where: { id: reg.id }, data: { usadoEm: new Date() } }),
      ...(reg.consumidor.status === 'PENDENTE_VERIFICACAO'
        ? [prisma.contaConsumidor.update({ where: { id: reg.consumidorId }, data: { status: 'ATIVA', emailVerificadoEm: new Date() } })]
        : []),
    ]);
    await auditar({ consumidorId: reg.consumidorId, contexto: 'NEXUS CLUB: e-mail confirmado', ip: req.ip });
    return { ok: true };
  });

  app.post('/club/auth/reenviar-verificacao', {
    preHandler: [...base, porIp('club:reenviar-ip', 10, HORA), porChave('club:reenviar', 3, HORA, (r) => String(corpo(r).email ?? '').toLowerCase().trim() || null)],
  }, async (req) => {
    definirSistemaDaRequisicao('club:reenviar-verificacao');
    const d = z.object({ email }).parse(req.body);
    const conta = await prisma.contaConsumidor.findUnique({ where: { email: d.email }, select: { id: true, nome: true, email: true, status: true } });
    if (conta?.status === 'PENDENTE_VERIFICACAO') {
      const tokenBruto = randomBytes(32).toString('hex');
      await prisma.consumidorToken.create({ data: { consumidorId: conta.id, tipo: 'VERIFICAR_EMAIL', tokenHash: hashToken(tokenBruto), expiraEm: new Date(Date.now() + VALIDADE_VERIFICACAO_MS) } });
      await enviarEmailVerificacaoClube({ para: conta.email, nome: conta.nome, tokenBruto });
    }
    return { message: 'Se houver uma conta aguardando confirmação, enviamos um novo e-mail.' };
  });

  // ---------------------------------------------------------------- login / logout
  const chaveLogin = (req: FastifyRequest) => {
    const l = String(corpo(req).login ?? '').trim().toLowerCase();
    return l ? (l.includes('@') ? l : normalizeCpf(l)) : null;
  };
  app.post('/club/auth/login', {
    preHandler: [...base, porIp('club:login-ip', 30, QUINZE_MIN), porChave('club:login', 10, QUINZE_MIN, chaveLogin)],
  }, async (req, reply) => {
    definirSistemaDaRequisicao('club:login');
    const d = z.object({ login: z.string().trim().min(3).max(180), senha: z.string().min(1).max(200) }).parse(req.body);
    const ehEmail = d.login.includes('@');
    const conta = ehEmail
      ? await prisma.contaConsumidor.findUnique({ where: { email: d.login.toLowerCase() } })
      : isValidCpf(d.login) ? await prisma.contaConsumidor.findUnique({ where: { cpfHash: hashCpf(d.login) } }) : null;
    const senhaOk = await verificarSenha(d.senha, conta?.senhaHash ?? (await hashParaComparar()));
    if (!conta || !senhaOk || conta.status === 'BLOQUEADA' || conta.status === 'ENCERRADA') {
      return reply.status(401).send({ error: 'E-mail, CPF ou senha incorretos.' });
    }
    if (conta.status === 'PENDENTE_VERIFICACAO') {
      return reply.status(403).send({ error: 'Confirme seu e-mail para entrar. Se não recebeu, peça um novo e-mail de confirmação.', codigo: 'EMAIL_NAO_VERIFICADO' });
    }
    const { token, cracha } = emitirCrachaConsumidor(conta.id);
    await auditar({ consumidorId: conta.id, contexto: 'NEXUS CLUB: entrou', ip: req.ip });
    const pendentes = await termosPendentes(conta.id);
    return { token, expiraEm: new Date(cracha.exp * 1000).toISOString(), validadeSegundos: VALIDADE_SESSAO_CONSUMIDOR_S, consumidor: { id: conta.id, nome: conta.nome, email: conta.email }, termosPendentes: pendentes };
  });

  const autenticado = [...base, autenticarConsumidor];

  // Novo aceite quando os termos mudam: precisa aceitar TODAS as versões pendentes de uma vez.
  app.post('/club/termos/aceitar', { preHandler: autenticado }, async (req, reply) => {
    const { id, termosPendentes: pendentes } = (req as any).consumidor as ConsumidorAutenticado;
    const { aceites } = z.object({ aceites: z.array(z.string().min(1)).max(10) }).parse(req.body);
    if (!pendentes.length) return { ok: true, termosPendentes: [] };
    if (!pendentes.every((t) => aceites.includes(t.id))) {
      return reply.status(400).send({ error: 'É preciso aceitar a versão atual dos Termos de Uso e da Política de Privacidade.', termos: pendentes });
    }
    await prisma.termoAceite.createMany({ data: pendentes.map((t) => ({ consumidorId: id, termoVersaoId: t.id, empresaId: null, ip: req.ip })), skipDuplicates: true });
    await auditar({ consumidorId: id, contexto: 'NEXUS CLUB: aceitou nova versão dos termos', ip: req.ip, valorNovo: { termos: pendentes.map((t) => `${t.tipo} v${t.versao}`) } });
    return { ok: true, termosPendentes: [] };
  });

  app.post('/club/auth/logout', { preHandler: autenticado }, async (req) => {
    const { id, cracha } = (req as any).consumidor as ConsumidorAutenticado;
    await prisma.tokenRevogado.upsert({ where: { jti: cracha.jti }, update: { expiraEm: new Date(cracha.exp * 1000) }, create: { jti: cracha.jti, expiraEm: new Date(cracha.exp * 1000) } });
    await auditar({ consumidorId: id, contexto: 'NEXUS CLUB: saiu', ip: req.ip });
    return { ok: true };
  });

  // ---------------------------------------------------------------- senha
  app.post('/club/auth/recuperar-senha', {
    preHandler: [...base, porIp('club:recuperar-ip', 10, HORA), porChave('club:recuperar', 3, HORA, (r) => String(corpo(r).email ?? '').toLowerCase().trim() || null)],
  }, async (req) => {
    definirSistemaDaRequisicao('club:recuperar-senha');
    const d = z.object({ email }).parse(req.body);
    const conta = await prisma.contaConsumidor.findUnique({ where: { email: d.email }, select: { id: true, nome: true, email: true, status: true } });
    if (conta && (conta.status === 'ATIVA' || conta.status === 'PENDENTE_VERIFICACAO')) {
      const tokenBruto = randomBytes(32).toString('hex');
      await prisma.consumidorToken.create({ data: { consumidorId: conta.id, tipo: 'REDEFINIR_SENHA', tokenHash: hashToken(tokenBruto), expiraEm: new Date(Date.now() + VALIDADE_REDEFINICAO_MS) } });
      const envio = await enviarEmailRedefinicaoClube({ para: conta.email, nome: conta.nome, tokenBruto });
      await auditar({ consumidorId: conta.id, contexto: `NEXUS CLUB: pedido de nova senha${envio.enviado ? '' : ' — FALHA NO ENVIO DO E-MAIL'}`, ip: req.ip });
    }
    return { message: MSG_RECUPERAR };
  });

  app.post('/club/auth/redefinir-senha', { preHandler: [...base, porIp('club:redefinir', 10, QUINZE_MIN)] }, async (req, reply) => {
    definirSistemaDaRequisicao('club:redefinir-senha');
    const d = z.object({ token: z.string().min(10).max(200), novaSenha: senhaSchema }).parse(req.body);
    const reg = await prisma.consumidorToken.findUnique({ where: { tokenHash: hashToken(d.token) }, include: { consumidor: { select: { status: true } } } });
    if (!reg || reg.tipo !== 'REDEFINIR_SENHA' || reg.usadoEm || reg.expiraEm < new Date()
      || (reg.consumidor.status !== 'ATIVA' && reg.consumidor.status !== 'PENDENTE_VERIFICACAO')) {
      return reply.status(400).send({ error: 'Link inválido ou vencido. Peça um novo.' });
    }
    const agora = new Date();
    await prisma.$transaction([
      prisma.contaConsumidor.update({
        where: { id: reg.consumidorId },
        // Quem abriu o link do e-mail provou que é dono dele: a conta pendente fica ativa.
        data: { senhaHash: await hashSenha(d.novaSenha), sessoesValidasDesde: agora, ...(reg.consumidor.status === 'PENDENTE_VERIFICACAO' ? { status: 'ATIVA', emailVerificadoEm: agora } : {}) },
      }),
      prisma.consumidorToken.update({ where: { id: reg.id }, data: { usadoEm: agora } }),
      prisma.consumidorToken.updateMany({ where: { consumidorId: reg.consumidorId, tipo: 'REDEFINIR_SENHA', usadoEm: null }, data: { usadoEm: agora } }),
    ]);
    await auditar({ consumidorId: reg.consumidorId, contexto: 'NEXUS CLUB: senha redefinida pelo e-mail (sessões anteriores encerradas)', ip: req.ip });
    return { ok: true };
  });

  app.post('/club/eu/senha', { preHandler: [...autenticado, porChave('club:trocar-senha', 5, QUINZE_MIN, (r) => (r as any).consumidor?.id ?? null)] }, async (req, reply) => {
    const { id } = (req as any).consumidor as ConsumidorAutenticado;
    const d = z.object({ senhaAtual: z.string().min(1).max(200), novaSenha: senhaSchema }).parse(req.body);
    const conta = await prisma.contaConsumidor.findUnique({ where: { id }, select: { senhaHash: true } });
    if (!conta || !(await verificarSenha(d.senhaAtual, conta.senhaHash))) return reply.status(400).send({ error: 'Senha atual incorreta.' });
    const agora = Date.now();
    await prisma.contaConsumidor.update({ where: { id }, data: { senhaHash: await hashSenha(d.novaSenha), sessoesValidasDesde: new Date(agora) } });
    const { token, cracha } = emitirCrachaConsumidor(id, agora + 1);
    await auditar({ consumidorId: id, contexto: 'NEXUS CLUB: senha trocada (outras sessões encerradas)', ip: req.ip });
    return { token, expiraEm: new Date(cracha.exp * 1000).toISOString() };
  });

  // ---------------------------------------------------------------- minha conta (básico)
  app.get('/club/eu', { preHandler: autenticado }, async (req) => {
    const { id } = (req as any).consumidor as ConsumidorAutenticado;
    const c = await prisma.contaConsumidor.findUniqueOrThrow({ where: { id } });
    return {
      id: c.id, nome: c.nome, email: c.email, cpf: mascararCpf(c.cpfCifrado), celular: c.celular, whatsapp: c.whatsapp,
      nascimento: c.nascimento ? c.nascimento.toISOString().slice(0, 10) : null, status: c.status, criadaEm: c.createdAt,
      termosPendentes: ((req as any).consumidor as ConsumidorAutenticado).termosPendentes,
    };
  });

  app.put('/club/eu', { preHandler: autenticado }, async (req, reply) => {
    const { id } = (req as any).consumidor as ConsumidorAutenticado;
    const d = z.object({
      nome: z.string().trim().min(2).max(120).optional(),
      celular: telefone,
      whatsapp: telefone,
      nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    }).strict().parse(req.body ?? {}); // e-mail e CPF não mudam por aqui
    const nascimento = d.nascimento === undefined ? undefined : d.nascimento ? new Date(`${d.nascimento}T00:00:00Z`) : null;
    if (nascimento && (Number.isNaN(nascimento.getTime()) || nascimento > new Date())) return reply.status(400).send({ error: 'Data de nascimento inválida.' });
    const c = await prisma.contaConsumidor.update({
      where: { id },
      data: { nome: d.nome, celular: d.celular === undefined ? undefined : d.celular || null, whatsapp: d.whatsapp === undefined ? undefined : d.whatsapp || null, nascimento },
      select: { id: true, nome: true, celular: true, whatsapp: true, nascimento: true },
    });
    await auditar({ consumidorId: id, contexto: 'NEXUS CLUB: dados pessoais atualizados', ip: req.ip, valorNovo: { campos: Object.keys(d) } });
    return { ...c, nascimento: c.nascimento ? c.nascimento.toISOString().slice(0, 10) : null };
  });
}
