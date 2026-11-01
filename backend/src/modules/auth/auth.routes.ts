import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { Origem, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { hashSenha, verificarSenha } from '../../lib/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { createRateLimiter, createLoginRateLimiter, registrarLoginSucesso } from '../../middlewares/rateLimiter.js';
import { todasPermissoes } from '../../lib/permissoes.js';
import { clean } from '../../lib/format.js';
import { enviarEmailRecuperacaoSenha } from '../../lib/email.js';
import { isValidCnpj } from '../../domain/cnpj.js';
import { ErroDeNegocio } from '../../lib/erros.js';

// Tempo de validade de um token de recuperação de senha (Seção 5).
const VALIDADE_TOKEN_RECUPERACAO_MS = 60 * 60 * 1000; // 1 hora
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');


export async function authRoutes(app: FastifyInstance): Promise<void> {
  const loginLimiter = createLoginRateLimiter(10, 60_000);
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
    // `isValidCnpj` (domain/cnpj.ts) já existia e tinha testes passando
    // desde sempre (tests/cnpj.test.ts), mas nunca tinha sido plugado
    // aqui — o cadastro só checava tamanho mínimo. Um CNPJ com dígito
    // verificador errado (ou "11111111111111") passava sem problema.
    if (cnpj && !isValidCnpj(cnpj)) {
      return reply.status(400).send({ error: 'CNPJ inválido — confira os dígitos verificadores.' });
    }
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
    await registrarLoginSucesso(req.ip, usuario.email);

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

  // Seção 5: recuperação de senha — gera o token, persiste o hash e envia
  // o token bruto por e-mail real via lib/email.ts (API HTTP da Resend).
  // A resposta ao usuário é deliberadamente idêntica exista ou não o
  // e-mail, para não permitir enumeração de contas cadastradas — inclusive
  // quando o envio falha, para não vazar esse detalhe a quem está testando
  // e-mails ao acaso.
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
      // O token bruto nunca é logado nem retornado pela API — só o hash
      // fica em banco. Ele só existe em memória neste request, para ir
      // direto para o e-mail.
      const resultado = await enviarEmailRecuperacaoSenha({ para: usuario.email, nome: usuario.nome, tokenBruto });
      await registrarAuditoria({
        usuarioId: usuario.id,
        empresaId: usuario.empresaId,
        acao: 'ALTERAR_CONFIG',
        entidade: 'Usuario',
        entidadeId: usuario.id,
        origem: 'MANUAL',
        ip: req.ip,
        contexto: resultado.enviado ? 'Solicitação de recuperação de senha — e-mail enviado' : 'Solicitação de recuperação de senha — FALHA NO ENVIO DO E-MAIL',
      });
    }
    return { message: 'Se o e-mail existir, as instruções de recuperação foram enviadas.' };
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

  // ==========================================================================
  //  Minha conta — Seção 5
  //
  //  Antes a aba "Minha Conta" da tela de Configurações era só LEITURA: nome,
  //  e-mail e empresa apareciam em `Row`, sem botão de edição. O usuário que
  //  precisasse trocar o próprio e-mail (e usa-lo na recuperação de senha)
  //  tinha que pedir a um administrador. Estas rotas devolvem esse controle
  //  ao próprio dono da conta — sem depender de permissão de admin, e sempre
  //  auditadas.
  // ==========================================================================

  const perfilSchema = z.object({
    nome: z.string().min(2).max(160).optional(),
    email: z.string().email().max(180).optional(),
  });

  /**
   * Atualiza nome e/ou e-mail do usuário LOGADO.
   *
   * O e-mail é a chave de recuperação de senha (`POST /auth/recuperar-senha`
   * busca por `email`), então trocar o e-mail muda para onde o link de
   * recuperação é enviado. Por isso:
   *   • a unicidade é checada no banco (índice `Usuario.email_key`) e
   *     devolvida como 409 legível, sem stacktrace;
   *   • a troca de e-mail é registrada na auditoria com o valor anterior;
   *   • a senha NÃO é alterada aqui — troca de credencial tem rota própria.
   *
   * `app.authenticate` já garante que o usuário existe e o token é válido.
   */
  app.put('/auth/me', { preHandler: [app.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const dados = perfilSchema.parse(req.body ?? {});
    const { id: usuarioId, empresaId } = req.user as any;

    const anterior = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { nome: true, email: true, status: true },
    });
    if (!anterior) throw new ErroDeNegocio('Usuário não encontrado.', 404);
    if (anterior.status !== 'ATIVO') throw new ErroDeNegocio('Conta inativa — não é possível editar o perfil.', 403);

    const atualizacoes: Record<string, unknown> = {};
    if (dados.nome !== undefined) atualizacoes.nome = dados.nome.trim();
    if (dados.email !== undefined) {
      const email = dados.email.toLowerCase().trim();
      if (email !== anterior.email) {
        const dono = await prisma.usuario.findUnique({ where: { email }, select: { id: true } });
        if (dono && dono.id !== usuarioId) {
          return reply.status(409).send({ error: 'Este e-mail já está em uso por outra conta.' });
        }
        atualizacoes.email = email;
      }
    }

    if (Object.keys(atualizacoes).length === 0) {
      return { id: usuarioId, nome: anterior.nome, email: anterior.email, status: anterior.status };
    }

    const usuario = await prisma.usuario.update({ where: { id: usuarioId }, data: atualizacoes });

    await registrarAuditoria({
      usuarioId,
      empresaId,
      acao: 'EDITAR',
      entidade: 'Usuario',
      entidadeId: usuarioId,
      valorAnterior: { nome: anterior.nome, email: anterior.email },
      valorNovo: { nome: usuario.nome, email: usuario.email },
      origem: 'MANUAL',
      ip: req.ip,
      contexto: dados.email !== undefined && atualizacoes.email
        ? 'E-mail da conta alterado — a recuperação de senha passa a usar o novo e-mail.'
        : 'Nome da conta alterado pelo próprio usuário.',
    });

    return { id: usuario.id, nome: usuario.nome, email: usuario.email, status: usuario.status };
  });

  /**
   * Troca de senha do usuário logado, exigindo a senha ATUAL.
   *
   * Pedir a senha atual é o que impede que alguém com a sessão aberta
   * (computador compartilhado, token roubado) troque a senha sem ser o dono.
   * Sem o e-mail ou o token de recuperação, a troca é impossível — que é
   * exatamente o caminho de "esqueci minha senha".
   *
   * O que muda aqui:
   *   • a senha é gravada com hash bcrypt (nunca em texto puro);
   *   • a sessão atual é revogada de verdade, via `TokenRevogado` (o
   *     `authenticate` consulta essa tabela), para que a troca encerre a
   *     sessão aberta e o usuário entre de novo com a nova senha;
   *   • a troca é auditada.
   */
  app.post('/auth/alterar-senha', { preHandler: [app.authenticate, loginLimiter] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { senhaAtual, novaSenha } = z
      .object({
        senhaAtual: z.string().min(1),
        novaSenha: z.string().min(8, 'A nova senha precisa de ao menos 8 caracteres.'),
      })
      .parse(req.body);
    const { id: usuarioId, empresaId, jti, exp } = req.user as any;

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { senhaHash: true } });
    if (!usuario) throw new ErroDeNegocio('Usuário não encontrado.', 404);
    if (!(await verificarSenha(senhaAtual, usuario.senhaHash))) {
      return reply.status(401).send({ error: 'Senha atual incorreta.' });
    }

    const senhaHash = await hashSenha(novaSenha);
    await prisma.usuario.update({ where: { id: usuarioId }, data: { senhaHash } });

    if (jti && exp) {
      await prisma.tokenRevogado.upsert({
        where: { jti },
        update: { expiraEm: new Date(exp * 1000) },
        create: { jti, expiraEm: new Date(exp * 1000) },
      });
    }

    await registrarAuditoria({
      usuarioId,
      empresaId,
      acao: 'ALTERAR_CONFIG',
      entidade: 'Usuario',
      entidadeId: usuarioId,
      origem: 'MANUAL',
      ip: req.ip,
      contexto: 'Senha da conta alterada pelo próprio usuário — sessão revogada.',
    });

    return { ok: true, mensagem: 'Senha alterada. Entre novamente com a nova senha.' };
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.user as any;
    const usuario = await prisma.usuario.findUnique({
      where: { id },
      include: { empresa: true },
    });
    if (!usuario) {
      return reply.status(404).send({ error: 'Usuário não encontrado' });
    }
    const permissoes = await prisma.permissao.findMany({
      where: { usuarioId: id, permitido: true },
    });

    return {
      id: usuario.id,
      name: usuario.nome,
      email: usuario.email,
      status: usuario.status,
      company: {
        id: usuario.empresa.id,
        nome: usuario.empresa.nome,
        cnpj: usuario.empresa.cnpj,
        status: usuario.empresa.status,
      },
      permissions: permissoes.map((p: any) => `${p.modulo}:${p.acao}`),
    };
  });
}
