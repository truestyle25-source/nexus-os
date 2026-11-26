import { prisma } from './prisma.js';

/**
 * Escopo "só o próprio" / "da equipe" para Ponto e Metas.
 *
 * - `ponto:visualizar` / `metas:visualizar` → vê tudo da empresa (Financeiro / RH, Gestor).
 * - `metas:equipe` → vê as metas do próprio setor e as suas (Supervisor).
 * - `ponto:proprio` / `metas:proprio` → vê só os próprios registros (Operador, Supervisor).
 *
 * O vínculo pessoa ↔ registro é Funcionario.usuarioId. Sem funcionário
 * vinculado, a pessoa não vê nada (lista vazia) — nunca "tudo".
 */
async function tem(usuarioId: string, modulo: string, acao: string): Promise<boolean> {
  const p = await prisma.permissao.findFirst({ where: { usuarioId, modulo, acao, permitido: true }, select: { id: true } });
  return Boolean(p);
}

export async function funcionarioDoUsuario(usuarioId: string, empresaId: string): Promise<string | null> {
  const f = await prisma.funcionario.findFirst({ where: { usuarioId, empresaId }, select: { id: true } });
  return f?.id ?? null;
}

/** Filtro extra para /ponto. `null` = sem restrição. `{ funcionarioId: '__nenhum__' }` = nada. */
export async function filtroPonto(usuarioId: string, empresaId: string): Promise<Record<string, unknown> | null> {
  if (await tem(usuarioId, 'ponto', 'visualizar')) return null;
  const f = await funcionarioDoUsuario(usuarioId, empresaId);
  return { funcionarioId: f ?? '__nenhum__' };
}

/** Filtro extra para /metas. `null` = sem restrição. */
export async function filtroMetas(usuarioId: string, empresaId: string): Promise<Record<string, unknown> | null> {
  if (await tem(usuarioId, 'metas', 'visualizar')) return null;
  const f = await funcionarioDoUsuario(usuarioId, empresaId);
  const proprias = { funcionarioId: f ?? '__nenhum__' };
  if (await tem(usuarioId, 'metas', 'equipe')) {
    const u = await prisma.usuario.findFirst({ where: { id: usuarioId, empresaId }, select: { setorId: true } });
    if (u?.setorId) {
      const daEquipe = await prisma.funcionario.findMany({ where: { empresaId, usuario: { setorId: u.setorId } }, select: { id: true } });
      return { OR: [proprias, { setorId: u.setorId }, { funcionarioId: { in: daEquipe.map((x) => x.id) } }] };
    }
  }
  return proprias;
}
