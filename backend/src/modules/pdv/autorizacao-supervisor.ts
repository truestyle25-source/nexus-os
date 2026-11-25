import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { verificarSenha } from '../../lib/auth.js';
import { ErroDeNegocio } from '../../lib/erros.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { createLoginRateLimiter } from '../../middlewares/rateLimiter.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';

/**
 * AUTORIZAÇÃO DO SUPERVISOR NO BALCÃO (I1)
 * ----------------------------------------
 * Quando o desconto passa da alçada do operador, ou ele precisa cancelar uma
 * venda fora do próprio turno, o supervisor digita e-mail e senha no próprio
 * PDV. O servidor confere a senha e devolve uma autorização curta (2 minutos),
 * assinada, que o PDV envia junto com a venda/cancelamento no cabeçalho
 * `x-autorizacao-supervisor`.
 *
 * - A autorização NÃO é um token de login: não tem a claim `id`, então
 *   `app.authenticate` a recusa como sessão.
 * - Vale só para a empresa e o operador que a pediram, e só para a ação pedida.
 * - Na hora de usar, as permissões do supervisor são conferidas DE NOVO no
 *   banco (se foram retiradas no meio, a autorização não vale).
 * - Tentativas usam o mesmo limite de força bruta do login.
 */
export const TIPO_AUTORIZACAO = 'autorizacao-supervisor';
export type AcaoAutorizada = 'DESCONTO' | 'CANCELAMENTO';

export interface AutorizacaoSupervisor {
  tipo: typeof TIPO_AUTORIZACAO;
  supervisorId: string;
  supervisorNome: string;
  empresaId: string;
  operadorId: string;
  acao: AcaoAutorizada;
}

/** Permissões que um supervisor precisa ter para autorizar cada ação. */
export const PERMISSOES_AUTORIZADORAS: Record<AcaoAutorizada, Array<{ modulo: string; acao: string }>> = {
  DESCONTO: [
    { modulo: 'vendas', acao: 'desconto_supervisor' },
    { modulo: 'vendas', acao: 'desconto_gerente' },
    { modulo: 'vendas', acao: 'desconto' },
    { modulo: 'vendas', acao: 'gerente' },
  ],
  CANCELAMENTO: [{ modulo: 'vendas', acao: 'editar' }],
};

export async function autorizacaoSupervisorRoutes(app: FastifyInstance) {
  const limitador = createLoginRateLimiter(10, 60_000);

  app.post('/pdv/autorizacoes', {
    preHandler: [app.authenticate, await permissaoMiddleware('pdv', 'criar'), limitador],
  }, async (req: any) => {
    const body = z.object({
      email: z.string().trim().email('Informe o e-mail do supervisor.'),
      senha: z.string().min(1, 'Informe a senha do supervisor.'),
      acao: z.enum(['DESCONTO', 'CANCELAMENTO']),
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
      throw new ErroDeNegocio(`${supervisor.nome} não tem permissão para autorizar ${body.acao === 'DESCONTO' ? 'descontos' : 'cancelamentos'}.`, 403);
    }

    const conteudo: AutorizacaoSupervisor = {
      tipo: TIPO_AUTORIZACAO,
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
 * Lê e valida o cabeçalho `x-autorizacao-supervisor`. Devolve `null` quando
 * não há cabeçalho; lança 403 quando há, mas é inválido para este uso.
 */
export function lerAutorizacaoSupervisor(app: FastifyInstance, req: any, acao: AcaoAutorizada): AutorizacaoSupervisor | null {
  // Cabeçalho ou campo `autorizacaoSupervisor` do corpo (a fila do PDV guarda
  // o corpo da venda; assim a autorização viaja junto num reenvio imediato).
  const bruto = req.headers?.['x-autorizacao-supervisor'] ?? req.body?.autorizacaoSupervisor;
  if (!bruto || typeof bruto !== 'string') return null;
  let dados: any;
  try {
    dados = app.jwt.verify(bruto);
  } catch {
    throw new ErroDeNegocio('A autorização do supervisor expirou ou é inválida. Peça de novo.', 403);
  }
  if (dados?.tipo !== TIPO_AUTORIZACAO || dados.acao !== acao || dados.empresaId !== req.user.empresaId || dados.operadorId !== req.user.id) {
    throw new ErroDeNegocio('A autorização do supervisor não vale para esta operação.', 403);
  }
  return dados as AutorizacaoSupervisor;
}
