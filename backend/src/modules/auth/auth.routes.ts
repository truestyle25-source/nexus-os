import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { Origem, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { hashSenha, verificarSenha } from '../../lib/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { createRateLimiter } from '../../middleware/rateLimiter.js';
import { todasPermissoes } from '../../lib/permissoes.js';
import { clean } from '../../lib/format.js';

// Tempo de validade de um token de recuperação de senha (Seção 5).
const VALIDADE_TOKEN_RECUPERACAO_MS = 60 * 60 * 1000; // 1 hora
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const loginLimiter = createRateLimiter(10, 60_000);
  const registerLimiter = createRateLimiter(5, 60_000);
  const recuperacaoLimiter = createRateLimiter(5, 60_000);

  app.post('/auth/register-company', { preHandler: registerLimiter }, async (req: FastifyRequest, reply: FastifyReply) => {
    const schema = z.object({
      nomeEmpresa: z.string().min(2),
      razaoSocial: z.string().optional(),
      cnpj: z.string().min(11).optional(),
      inscricaoEstadual: z.string().optional(),
      responsavelCpf: z.string().min(11).optional(),
      responsavelRg: z.string().optional(),
      cep: z.string().optional(),
      endereco: z.string().optional(),
      cidade: z.string().optional(),
      estado: z.string().optional(),
      nome: z.string().min(2),
      email: z.string().email(),
      senha: z.string().min(8),
    });
    const d = schema.parse(req.body);
    const email = d.email.toLowerCase().trim();

    if (await prisma.usuario.findUnique({ where: { email } })) {
      return reply.status(409).send({ error: 'E-mail já cadastrado.' });
    }
    const cnpj = clean(d.cnpj);
    if (cnpj && (await prisma.empresa.findUnique({ where: { cnpj } }))) {
      return reply.status(409).send({ error: 'CNPJ já cadastrado.' });
    }

    const agora = new Date();
    const trialFim = new Date(agora);
    trialFim.setDate(trialFim.getDate() + Number(process.env.TRIAL_DAYS || 7));
    const origem: Origem = 'MANUAL';

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const empresa = await tx.empresa.create({
        data: {
          nome: d.nomeEmpresa,
          razaoSocial: d.razaoSocial,
          cnpj,
          inscricaoEstadual: d.inscricaoEstadual,
          responsavelCpf: clean(d.responsavelCpf),
          responsavelRg: d.responsavelRg,
          cep: clean(d.cep),
          endereco: d.endereco,
          cidade: d.cidade,
          estado: d.estado,
          origem,
        },
      });
      const filial = await tx.filial.create({
        data: { empresaId: empresa.id, nome: d.nomeEmpresa, cnpj, cidade: d.cidade, estado: d.estado, origem },
      });
      const usuario = await tx.usuario.create({
        data: { empresaId: empresa.id, filialId: filial.id, nome: d.nome, email, senhaHash: await hashSenha(d.senha), origem },
      });
      // Fundador nasce com todas as permissões (decisão de produto — ver
      // lib/permissoes.ts). Usuários adicionais recebem permissões
      // granulares via PUT /usuarios/:id/permissoes.
      await tx.permissao.createMany({
        data: todasPermissoes().map((p) => ({ usuarioId: usuario.id, modulo: p.modulo, acao: p.acao, permitido: true, origem })),
        skipDuplicates: true,
      });
      await tx.assinatura.create({
        data: {
          empresaId: empresa.id,
          status: 'TRIAL',
          trialInicio: agora,
          trialFim,
          valorMensal: Number(process.env.SUBSCRIPTION_PRICE || 19.9),
          checkoutUrl: process.env.INFINITEPAY_CHECKOUT_URL,
        },
      });
      return { empresa, filial, usuario };
    });

    const jti = randomUUID();
    const token = app.jwt.sign({ id: result.usuario.id, empresaId: result.empresa.id, email: result.usuario.email, jti }, { expiresIn: '8h' });
    await registrarAuditoria({
      usuarioId: result.usuario.id,
      empresaId: result.empresa.id,
      acao: 'CRIAR',
      entidade: 'Empresa',
      entidadeId: result.empresa.id,
      origem,
      ip: req.ip,
      contexto: 'Cadastro inicial',
    });
    return reply
      .status(201)
      .send({ token, usuario: { id: result.usuario.id, nome: result.usuario.nome, email: result.usuario.email, empresaId: result.empresa.id }, trialFim });
  });

  app.post('/auth/login', { preHandler: loginLimiter }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { email, senha } = z.object({ email: z.string().email(), senha: z.string().min(6) }).parse(req.body);
    const usuario = await prisma.usuario.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!usuario || usuario.status !== 'ATIVO' || !(await verificarSenha(senha, usuario.senhaHash))) {
      return reply.status(401).send({ error: 'Credenciais inválidas.' });
    }
    const empresa = await prisma.empresa.findUnique({ where: { id: usuario.empresaId }, select: { status: true } });
    if (!empresa || empresa.status !== 'ATIVO') {
      return reply.status(403).send({ error: 'Empresa suspensa. Contate o suporte.' });
    }
    await prisma.usuario.update({ where: { id: usuario.id }, data: { ultimoLogin: new Date() } });
    const jti = randomUUID();
    const token = app.jwt.sign({ id: usuario.id, empresaId: usuario.empresaId, email: usuario.email, jti }, { expiresIn: '8h' });
    await registrarAuditoria({
      usuarioId: usuario.id,
      empresaId: usuario.empresaId,
      acao: 'LOGIN',
      entidade: 'Usuario',
      entidadeId: usuario.id,
      origem: 'MANUAL',
      ip: req.ip,
      contexto: `Login ${usuario.email}`,
    });
    return { token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, empresaId: usuario.empresaId } };
  });

  app.post('/auth/logout', { preHandler: [app.authenticate] }, async (req: FastifyRequest) => {
    const { id, empresaId, jti, exp } = req.user;
    if (jti && exp) {
      await prisma.tokenRevogado.upsert({
        where: { jti },
        update: { expiraEm: new Date(exp * 1000) },
        create: { jti, expiraEm: new Date(exp * 1000) },
      });
    }
    await registrarAuditoria({ usuarioId: id, empresaId, acao: 'LOGOUT', entidade: 'Usuario', entidadeId: id, origem: 'MANUAL', ip: req.ip });
    return { ok: true };
  });

  // Seção 5: recuperação de senha, parte 1 — gera e persiste o token.
  // O envio do token ao usuário depende de um provedor de e-mail, que ainda
  // não está integrado nesta base (ver PENDÊNCIAS no relatório da fase).
  // A resposta é deliberadamente idêntica exista ou não o e-mail, para não
  // permitir enumeração de contas cadastradas.
  app.post('/auth/recuperar-senha', { preHandler: recuperacaoLimiter }, async (req: FastifyRequest) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const usuario = await prisma.usuario.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (usuario && usuario.status === 'ATIVO') {
      const tokenBruto = randomBytes(32).toString('hex');
      await prisma.tokenRecuperacaoSenha.create({
        data: {
          usuarioId: usuario.id,
          tokenHash: hashToken(tokenBruto),
          expiraEm: new Date(Date.now() + VALIDADE_TOKEN_RECUPERACAO_MS),
        },
      });
      await registrarAuditoria({
        usuarioId: usuario.id,
        empresaId: usuario.empresaId,
        acao: 'ALTERAR_CONFIG',
        entidade: 'Usuario',
        entidadeId: usuario.id,
        origem: 'MANUAL',
        ip: req.ip,
        contexto: 'Solicitação de recuperação de senha',
      });
      // O token bruto nunca é logado nem retornado pela API — só o hash
      // fica em banco. Sem um provedor de e-mail configurado, ele é
      // inacessível ao usuário nesta base; isso é uma pendência real,
      // não um recurso concluído.
    }
    return { message: 'Se o e-mail existir, as instruções de recuperação devem ser enviadas pelo serviço de e-mail configurado.' };
  });

  // Seção 5: recuperação de senha, parte 2 — consome o token e troca a senha.
  app.post('/auth/redefinir-senha', { preHandler: recuperacaoLimiter }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { token, novaSenha } = z.object({ token: z.string().min(10), novaSenha: z.string().min(8) }).parse(req.body);
    const registro = await prisma.tokenRecuperacaoSenha.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!registro || registro.usadoEm || registro.expiraEm < new Date()) {
      return reply.status(400).send({ error: 'Token inválido ou expirado.' });
    }
    const senhaHash = await hashSenha(novaSenha);
    await prisma.$transaction([
      prisma.usuario.update({ where: { id: registro.usuarioId }, data: { senhaHash } }),
      prisma.tokenRecuperacaoSenha.update({ where: { id: registro.id }, data: { usadoEm: new Date() } }),
    ]);
    const usuario = await prisma.usuario.findUnique({ where: { id: registro.usuarioId }, select: { empresaId: true } });
    await registrarAuditoria({
      usuarioId: registro.usuarioId,
      empresaId: usuario?.empresaId,
      acao: 'ALTERAR_CONFIG',
      entidade: 'Usuario',
      entidadeId: registro.usuarioId,
      origem: 'MANUAL',
      ip: req.ip,
      contexto: 'Redefinição de senha via token',
    });
    return { ok: true };
  });
}
