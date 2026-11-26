/**
 * Cargo de referência do usuário (Operador, Supervisor, Financeiro / RH, Gestor)
 * e o vínculo com o cargo do RH.
 *
 * Cada cargo do RH pode apontar para um cargo de referência. O funcionário que
 * tem login no sistema passa esse cargo de referência ao login: trocar o cargo
 * no RH muda o que a pessoa acessa, sem precisar acertar o mesmo dado em dois
 * lugares.
 *
 * Mudar o acesso de alguém é uma decisão de USUÁRIOS, não de RH. Por isso a
 * propagação só acontece quando quem salva tem `usuarios.editar`, e nunca para
 * o próprio login de quem salva (ninguém aumenta o próprio acesso).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { CARGOS, permissoesDoCargo, ROTULO_CARGO, type Cargo } from './permissoes-catalogo.js';
import { ErroDeNegocio } from './erros.js';
import { registrarAuditoria } from '../modules/auditoria/auditoria.service.js';

export const ehCargoDeReferencia = (v: unknown): v is Cargo => typeof v === 'string' && (CARGOS as readonly string[]).includes(v);

/** Troca o cargo do usuário: as permissões passam a ser exatamente as do cargo. */
export async function aplicarCargoAoUsuario(tx: Prisma.TransactionClient, usuarioId: string, cargo: Cargo): Promise<void> {
  await tx.permissao.deleteMany({ where: { usuarioId } });
  for (const p of permissoesDoCargo(cargo)) {
    await tx.permissao.create({ data: { usuarioId, modulo: p.modulo, acao: p.acao, permitido: true, origem: 'MANUAL' } });
  }
  await tx.usuario.update({ where: { id: usuarioId }, data: { cargo } });
}

export async function podeEditarUsuarios(usuarioId: string): Promise<boolean> {
  const p = await prisma.permissao.findFirst({ where: { usuarioId, modulo: 'usuarios', acao: 'editar', permitido: true }, select: { id: true } });
  return Boolean(p);
}

/** Cargo do RH que define o acesso do usuário, se houver (funcionário ligado + cargo com referência). */
export async function cargoRhDoUsuario(empresaId: string, usuarioId: string) {
  const f = await prisma.funcionario.findFirst({
    where: { empresaId, usuarioId, status: { notIn: ['ARQUIVADO', 'DESLIGADO'] } },
    select: { cargo: { select: { id: true, nome: true, cargoReferencia: true, departamento: { select: { nome: true } } } } },
  });
  const c = f?.cargo;
  if (!c || !ehCargoDeReferencia(c.cargoReferencia)) return null;
  return { cargoId: c.id, nome: c.nome, departamento: c.departamento?.nome ?? null, cargoReferencia: c.cargoReferencia };
}

type Mudanca = { usuarioId: string; de: string | null; para: Cargo };

/**
 * Calcula, ANTES de gravar, qual login teria o acesso trocado ao ligar este
 * funcionário a este cargo. Recusa (403) se quem salva não pode fazer isso.
 */
export async function preverMudancaDeAcesso(opts: {
  empresaId: string; atorId: string; usuarioId: string | null | undefined; cargoId: string | null | undefined; status?: string | null;
}): Promise<Mudanca | null> {
  const { empresaId, atorId, usuarioId, cargoId } = opts;
  if (!usuarioId || !cargoId) return null;
  // Funcionário desligado não passa acesso ao login (o RH segue editando a ficha).
  if (opts.status === 'DESLIGADO' || opts.status === 'ARQUIVADO') return null;
  const cargo = await prisma.cargo.findFirst({ where: { id: cargoId, empresaId }, select: { cargoReferencia: true, nome: true } });
  if (!cargo || !ehCargoDeReferencia(cargo.cargoReferencia)) return null;
  const usuario = await prisma.usuario.findFirst({ where: { id: usuarioId, empresaId }, select: { cargo: true } });
  if (!usuario || usuario.cargo === cargo.cargoReferencia) return null;
  if (usuarioId === atorId) {
    throw new ErroDeNegocio(`O cargo "${cargo.nome}" mudaria o seu próprio acesso para ${ROTULO_CARGO[cargo.cargoReferencia]}. Peça a outro gestor.`, 403);
  }
  if (!(await podeEditarUsuarios(atorId))) {
    throw new ErroDeNegocio(`O cargo "${cargo.nome}" muda o acesso do login para ${ROTULO_CARGO[cargo.cargoReferencia]}, e você não tem permissão para editar usuários.`, 403);
  }
  return { usuarioId, de: usuario.cargo, para: cargo.cargoReferencia };
}

/** Aplica as mudanças de acesso já validadas e registra cada uma na auditoria. */
export async function aplicarMudancasDeAcesso(mudancas: Mudanca[], ctx: { empresaId: string; atorId: string; ip?: string; motivo: string }): Promise<void> {
  for (const m of mudancas) {
    const anterior = await prisma.permissao.findMany({ where: { usuarioId: m.usuarioId }, select: { modulo: true, acao: true, permitido: true } });
    await prisma.$transaction((tx) => aplicarCargoAoUsuario(tx, m.usuarioId, m.para));
    await registrarAuditoria({
      usuarioId: ctx.atorId, empresaId: ctx.empresaId, acao: 'ALTERAR_PERMISSAO', entidade: 'Usuario', entidadeId: m.usuarioId,
      valorAnterior: { cargo: m.de, permissoes: anterior }, valorNovo: { cargo: m.para }, origem: 'MANUAL', ip: ctx.ip,
      contexto: `Cargo alterado para ${ROTULO_CARGO[m.para]} pelo RH (${ctx.motivo})`,
    });
  }
}

/**
 * Ao definir/trocar a referência de um cargo do RH: logins dos funcionários
 * nesse cargo que mudariam de acesso. Recusa se quem salva não pode.
 */
export async function preverMudancasDoCargo(opts: { empresaId: string; atorId: string; cargoId: string; referencia: Cargo }): Promise<Mudanca[]> {
  const funcs = await prisma.funcionario.findMany({
    where: { empresaId: opts.empresaId, cargoId: opts.cargoId, usuarioId: { not: null }, status: { notIn: ['ARQUIVADO', 'DESLIGADO'] } },
    select: { usuarioId: true, usuario: { select: { cargo: true } } },
  });
  const mudancas = funcs
    .filter((f) => f.usuarioId && f.usuario?.cargo !== opts.referencia)
    .map((f) => ({ usuarioId: f.usuarioId as string, de: f.usuario?.cargo ?? null, para: opts.referencia }));
  if (mudancas.some((m) => m.usuarioId === opts.atorId)) {
    throw new ErroDeNegocio('Este cargo inclui o seu próprio login, e a mudança alteraria o seu acesso. Peça a outro gestor.', 403);
  }
  return mudancas;
}
