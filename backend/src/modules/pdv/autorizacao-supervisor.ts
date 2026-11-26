import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { verificarSenha } from '../../lib/auth.js';
import { ErroDeNegocio } from '../../lib/erros.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { createLoginRateLimiter } from '../../middlewares/rateLimiter.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';

/**
 * AUTORIZAÇÃO DO SUPERVISOR NO BALCÃO
 * -----------------------------------
 * Desconto acima da alçada, sangria, cancelamento de item do carrinho e
 * cancelamento de venda paga pedem a senha de um supervisor no próprio PDV.
 * O servidor confere a senha e devolve uma autorização curta (2 minutos),
 * assinada, enviada junto com a operação no cabeçalho `x-autorizacao-supervisor`.
 *
 * - NÃO é token de login: não tem a claim `id` (`app.authenticate` recusa).
 * - Vale só para a empresa, o operador e a ação pedidos.
 * - Vale UMA vez: ao ser usada, o código dela (`jti`) é gravado; a segunda
 *   tentativa com a mesma autorização é recusada.
 * - Na hora de usar, as permissões do supervisor são conferidas de novo.
 * - Tentativas de senha usam o mesmo limite de força bruta do login.
 */
export const TIPO_AUTORIZACAO = 'autorizacao-supervisor';
export const ACOES_AUTORIZADAS = ['DESCONTO', 'CANCELAMENTO', 'SANGRIA', 'CANCELAR_ITEM'] as const;
export type AcaoAutorizada = typeof ACOES_AUTORIZADAS[number];

export interface AutorizacaoSupervisor {
  tipo: typeof TIPO_AUTORIZACAO;
  jti: string;
  supervisorId: string;
  supervisorNome: string;
  empresaId: string;
  operadorId: string;
  acao: AcaoAutorizada;
}

/** Quem pode autorizar no balcão (sangria, item, venda): supervisor do PDV ou gestor de vendas. */
const SUPERVISOR_DE_CAIXA = [
  { modulo: 'pdv', acao: 'supervisor' },
  { modulo: 'vendas', acao: 'editar' },
  { modulo: 'vendas', acao: 'gerente' },
];

/** Permissões que um supervisor precisa ter para autorizar cada ação. */
export const PERMISSOES_AUTORIZADORAS: Record<AcaoAutorizada, Array<{ modulo: string; acao: string }>> = {
  DESCONTO: [
    { modulo: 'vendas', acao: 'desconto_supervisor' },
    { modulo: 'vendas', acao: 'desconto_gerente' },
    { modulo: 'vendas', acao: 'desconto' },
    { modulo: 'vendas', acao: 'gerente' },
  ],
  CANCELAMENTO: SUPERVISOR_DE_CAIXA,
  SANGRIA: SUPERVISOR_DE_CAIXA,
  CANCELAR_ITEM: SUPERVISOR_DE_CAIXA,
};

const NOME_ACAO: Record<AcaoAutorizada, string> = {
  DESCONTO: 'descontos', CANCELAMENTO: 'cancelamentos de venda', SANGRIA: 'sangrias', CANCELAR_ITEM: 'cancelamento de itens',
};

export async function autorizacaoSupervisorRoutes(app: FastifyInstance) {
  const limitador = createLoginRateLimiter(10, 60_000);

  app.post('/pdv/autorizacoes', {
    preHandler: [app.authenticate, await permissaoMiddleware('pdv', 'criar'), limitador],
  }, async (req: any) => {
    const body = z.object({
      email: z.string().trim().email('Informe o e-mail do supervisor.'),
      senha: z.string().min(1, 'Informe a senha do supervisor.'),
      acao: z.enum(ACOES_AUTORIZADAS),
    }).parse(req.body ?? {});

    const supervisor = await prisma.usuario.findFirst({
      where: { email: body.email.toLowerCase(), empresaId: req.user.empresaId, status: 'ATIVO' },
      select: { id: true, nome: true, senhaHash: true },
    });
    // Mesma mensagem para e-mail inexistente e senha errada (não revela quem existe).
    if (!supervisor || !(await verificarSenha(body.senha, supervisor.senhaHash))) {
      throw new ErroDeNegocio('E-mail ou senha do supervisor incorretos.', 401);
    }
    if (supervisor.id === req.user.id) {
      throw new ErroDeNegocio('A autorização precisa ser de outra pessoa (supervisor ou gerente).', 403);
    }
    const permitido = await prisma.permissao.findFirst({
      where: { usuarioId: supervisor.id, permitido: true, OR: PERMISSOES_AUTORIZADORAS[body.acao] },
      select: { id: true },
    });
    if (!permitido) {
      throw new ErroDeNegocio(`${supervisor.nome} não tem permissão para autorizar ${NOME_ACAO[body.acao]}.`, 403);
    }

    const conteudo: AutorizacaoSupervisor = {
      tipo: TIPO_AUTORIZACAO,
      jti: randomUUID(),
      supervisorId: supervisor.id,
      supervisorNome: supervisor.nome,
      empresaId: req.user.empresaId,
      operadorId: req.user.id,
      acao: body.acao,
    };
    const token = app.jwt.sign(conteudo as any, { expiresIn: '2m' });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'AutorizacaoSupervisor',
      entidadeId: supervisor.id, origem: 'PDV' as any, ip: req.ip,
      contexto: `${supervisor.nome} autorizou ${body.acao} no PDV para o operador ${req.user.id}.`,
    });
    return { autorizacao: token, supervisor: { id: supervisor.id, nome: supervisor.nome }, expiraEmSegundos: 120 };
  });
}

/**
 * Lê e valida a autorização (cabeçalho `x-autorizacao-supervisor` ou campo
 * `autorizacaoSupervisor` do corpo). Devolve `null` quando não há; lança 403
 * quando há, mas é inválida para este uso. Não consome — ver `consumirAutorizacao`.
 */
export function lerAutorizacaoSupervisor(app: FastifyInstance, req: any, acao: AcaoAutorizada): AutorizacaoSupervisor | null {
  const bruto = req.headers?.['x-autorizacao-supervisor'] ?? req.body?.autorizacaoSupervisor;
  if (!bruto || typeof bruto !== 'string') return null;
  let dados: any;
  try {
    dados = app.jwt.verify(bruto);
  } catch {
    throw new ErroDeNegocio('A autorização do supervisor expirou ou é inválida. Peça de novo.', 403);
  }
  if (dados?.tipo !== TIPO_AUTORIZACAO || dados.acao !== acao || dados.empresaId !== req.user.empresaId || dados.operadorId !== req.user.id || !dados.jti) {
    throw new ErroDeNegocio('A autorização do supervisor não vale para esta operação.', 403);
  }
  return dados as AutorizacaoSupervisor;
}

/** Confere de novo se o supervisor ainda pode autorizar a ação (permissão pode ter sido retirada). */
export async function supervisorAindaPode(db: Prisma.TransactionClient | typeof prisma, aut: AutorizacaoSupervisor): Promise<void> {
  const ok = await db.permissao.findFirst({
    where: { usuarioId: aut.supervisorId, permitido: true, OR: PERMISSOES_AUTORIZADORAS[aut.acao] },
    select: { id: true },
  });
  if (!ok) throw new ErroDeNegocio(`${aut.supervisorNome} não pode mais autorizar ${NOME_ACAO[aut.acao]}.`, 403);
}

/**
 * Marca a autorização como usada (uma vez só). Roda DENTRO da transação da
 * operação: se a operação falhar, a autorização continua válida; se der certo,
 * qualquer reuso é recusado pela chave única `autsup:<jti>`.
 */
export async function consumirAutorizacao(db: Prisma.TransactionClient, aut: AutorizacaoSupervisor): Promise<void> {
  const chave = `autsup:${aut.jti}`;
  const ja = await db.idempotencyKey.findFirst({ where: { empresaId: aut.empresaId, key: chave }, select: { id: true } });
  if (ja) throw new ErroDeNegocio('Esta autorização do supervisor já foi usada. Peça uma nova.', 403);
  await db.idempotencyKey.create({
    data: { empresaId: aut.empresaId, key: chave, operadorId: aut.operadorId, status: 'CONFIRMADA', responseStatus: 200, responseBody: { supervisorId: aut.supervisorId, acao: aut.acao } },
  });
}

/** O próprio usuário tem poder de supervisor de caixa (dispensa pedir a outro). */
export async function ehSupervisorDeCaixa(usuarioId: string): Promise<boolean> {
  const ok = await prisma.permissao.findFirst({ where: { usuarioId, permitido: true, OR: SUPERVISOR_DE_CAIXA }, select: { id: true } });
  return Boolean(ok);
}
