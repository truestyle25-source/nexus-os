/**
 * Utilitários compartilhados das rotas do RH.
 *
 * `dataBr`, `valorBr` e `empresaDoUsuario` existiam como funções privadas em
 * `rh.routes.ts`. A folha de pagamento precisa dos mesmos três, e duplicar
 * formatador de dinheiro em dois arquivos é exatamente o tipo de coisa que faz
 * uma tela mostrar "R$ 1.234,5" e o PDF mostrar "R$ 1.234,50".
 *
 * Ficam aqui e são importados pelos dois módulos.
 */

/** `AAAA-MM-DD` no formato brasileiro. Aceita `Date`, ISO ou null. */
export function dataBr(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

/** Valor monetário com 2 casas, em real. */
export function valorBr(v: unknown): string {
  const n = Number(v ?? 0);
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Empresa do usuário, já filtrada pelo tenant.
 *
 * Todo acesso a folha é por `empresaId: req.user.empresaId`, então a empresa
 * aqui é apenas para o cabeçalho do documento — não é fonte de autorização.
 */
export async function empresaDoUsuario(empresaId: string) {
  const { prisma } = await import('../../lib/prisma.js');
  return prisma.empresa.findUnique({ where: { id: empresaId } });
}
