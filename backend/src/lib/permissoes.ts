import { prisma } from './prisma.js';
import type { Modulo, Acao } from './permissoes-catalogo.js';

// Catálogo puro (MODULOS, ACOES, Modulo, Acao, todasPermissoes) foi movido
// para permissoes-catalogo.ts, que não importa Prisma — ver o comentário
// lá para o porquê. Este arquivo reexporta tudo para não quebrar nenhum
// import existente (`from '../../lib/permissoes.js'` continua funcionando
// exatamente igual) e mantém aqui só o que de fato precisa de banco.
export { MODULOS, ACOES, todasPermissoes } from './permissoes-catalogo.js';
export type { Modulo, Acao } from './permissoes-catalogo.js';

/**
 * Checagem de permissão pontual, DENTRO de um handler já autenticado — para
 * os casos em que a permissão não liga/desliga a rota inteira, mas apenas
 * alguns campos da resposta. Exemplo real (Seção 6): um usuário pode ter
 * produtos.visualizar sem ter custos.visualizar — o endpoint continua
 * respondendo, só que sem os campos de custo/margem/valor de estoque.
 *
 * Isto é DIFERENTE de permissaoMiddleware (middlewares/auth.ts), que barra
 * a rota inteira com 403 e é usado no preHandler.
 */
export async function temPermissao(usuarioId: string, modulo: Modulo, acao: Acao): Promise<boolean> {
  const p = await prisma.permissao.findFirst({ where: { usuarioId, modulo, acao, permitido: true }, select: { id: true } });
  return Boolean(p);
}
