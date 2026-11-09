import fp from 'fastify-plugin'
import { prisma } from '../lib/prisma.js'

/**
 * Valida o identificador do usuário extraído do JWT.
 * Retorna o ID do usuário e a empresaId se válido, ou null em caso de falha.
 * Esta função garante que:
 * - O ID existe e é do tipo string
 - O ID não está vazio nem em branco
 - O usuário existe no banco de dados
 - O usuário está ativo (status = 'ATIVO')
 - Retorna também a empresaId para validação de contexto (empresa diferente)
 */
async function validarUsuarioId(user: { id?: unknown } | null | undefined): Promise<{ id: string; empresaId: string } | null> {
  const rawId = user?.id

  // 1. Verificar se o ID existe e é do tipo string
  if (typeof rawId !== 'string') {
    return null
  }

  const id = rawId.trim()

  // 2. Verificar que o ID não está vazio nem apenas espaços
  if (id.length === 0) {
    return null
  }

  // 3. Verificar se o usuário existe no banco de dados
  const usuarioExistente = await prisma.usuario.findFirst({
    where: { id },
    select: { id: true, status: true, empresaId: true },
  })

  if (!usuarioExistente) {
    return null
  }

  // 4. Verificar se o usuário está ativo
  if (usuarioExistente.status !== 'ATIVO') {
    return null
  }

  // 5. Retornar o ID válido e a empresaId para validação de contexto (empresa diferente)
  return {
    id: usuarioExistente.id,
    empresaId: usuarioExistente.empresaId,
  }
}

export const registerAuthentication = fp(async (app: any) => {
  app.decorate('authenticate', async function (request: any, reply: any) {
    try {
      await request.jwtVerify()
    } catch (err) {
      return reply.status(401).send({ message: 'Não autenticado' })
    }

    // Validacao aprimorada do identificado do usuario a partir do JWT.
    // O payload do JWT e DECLARADO com `id: string` (src/types/fastify.d.ts),
    // mas a assinatura de tipos nao e validacao em runtime: um token assinado sem
    // a claim `id`, com `id` vazio, em branco ou de tipo inesperado, passa pelo
    // jwtVerify() sem erro e deixa request.user.id como undefined. Nesse caso o
    // Prisma ignora o campo undefined dentro de where (o filtro nao e gerado)
    // e a consulta passa a valer para QUALQUER usuario do banco: uma permissao
    // pertencente a outra pessoa autorizaria a requisição atual (fail-open).

    const usuarioValidado = await validarUsuarioId(request.user)

    if (!usuarioValidado) {
      return reply.status(401).send({
        message: 'Token inválido: identificacao de usuario ausente ou invalida.',
      })
    }

    // Armazenar o usuario validado no request para uso subsequente das rotas
    // @ts-expect-error - adicionando propriedade dinamica ao tipo FastifyRequest
    request.usuarioValidado = usuarioValidado

    // Revogacao de token (Seção 5 — "Alterar senha").
    //
    // A tabela `TokenRevogado` já existia no schema, mas NENHUMA rota a
    // consultava: a revogação de sessão estava declarada e nunca aplicada.
    // Sem esta checagem, trocar a senha não encerraria a sessão aberta — o
    // token antigo continuaria valendo até expirar sozinho.
    //
    // A consulta só roda quando há `jti` no token (tokens assinados por
    // `signJwt` sempre têm) e é filtrada por `expiraEm`: tokens revogados já
    // vencidos são descartados, então a tabela não cresce para sempre.
    const jti = request.user?.jti
    if (jti) {
      const revogado = await prisma.tokenRevogado.findFirst({
        where: { jti, expiraEm: { gt: new Date() } },
        select: { id: true },
      })
      if (revogado) {
        return reply.status(401).send({ message: 'Sessão encerrada. Entre novamente.' })
      }
    }
  })
})

/**
 * Identificador do usuário autenticado, pronto para alimentar a consulta de
 * permissões.
 *
 * O payload do JWT é DECLARADO com `id: string` (src/types/fastify.d.ts), mas
 * assinatura de tipos não é validação em runtime: um token assinado sem a
 * claim `id` — ou com `id` vazio, em branco ou de tipo inesperado — passa pelo
 * jwtVerify() sem erro e deixa `request.user.id` como `undefined`. Nesse caso
 * o Prisma ignora o campo `undefined` dentro de `where` (o filtro não é gerado)
 * e a consulta passa a valer para QUALQUER usuário do banco: uma permissão
 * pertencente a outra pessoa autorizaria a requisição atual (fail-open).
 *
 * Devolve `null` quando a identidade não é utilizável, para que os middlewares
 * de permissão rejeitem a requisição ANTES de tocar no banco. A identidade
 * nunca é decidida a partir do banco — apenas conferida —, então isto não
 * enfraquece a checagem de permissões nem altera o contrato do JWT.
 */
function usuarioIdAutenticado(user: { id?: unknown } | null | undefined): string | null {
  const id = user?.id
  if (typeof id !== 'string') return null
  return id.trim() === '' ? null : id
}


export function permissaoMiddleware(modulo: string, acao: string) {
  return async function (request: any, reply: any) {
    const user = (request as any).user
    if (!user) {
      return reply.status(401).send({ message: 'Não autenticado' })
    }

    // Identidade sem claim `id` utilizável: rejeita ANTES da consulta Prisma.
    // Com `usuarioId: undefined` o Prisma ignora o filtro dentro de `where`
    // (o campo simplesmente não entra na query) e a consulta encontraria a
    // permissão de QUALQUER usuário — fail-open confirmado empiricamente.
    const usuarioId = usuarioIdAutenticado(user)
    if (!usuarioId) {
      return reply.status(401).send({ message: 'Token sem identificação de usuário válida' })
    }

    // Checagem no BANCO (Secao 6): a checagem e no banco, nao no JWT. O token do
    // login nao carrega permissoes, e permissoes editadas via
    // PUT /usuarios/:id/permissoes precisam valer no mesmo instante. Ausencia de linha = NEGADO.
    const permissao = await prisma.permissao.findFirst({
      where: { usuarioId, modulo, acao, permitido: true },
      select: { id: true },
    })

    if (!permissao) {
      return reply.status(403).send({ error: 'Permissão negada' })
    }
  }
}

/**
 * Libera a rota para quem tiver QUALQUER UMA das permissões informadas.
 *
 * Existe para o caso em que uma funcionalidade é legitimamente acessada por
 * dois módulos diferentes, e exigir um só deixa a tela quebrada para metade dos
 * usuários. O exemplo real é a avaliação DISC: ela mora na aba Relatórios
 * (módulo `relatorios`) mas fala de pessoas (módulo `rh`), e cada rota pedia um
 * módulo diferente do contexto em que era usada. Sem isto, quem tinha acesso a
 * Relatórios e não a RH entrava na página e recebia 403 sem explicação.
 *
 * A checagem continua no BANCO e com a mesma regra do middleware simples:
 * ausência de linha = negado, e nada é decidido a partir do JWT.
 *
 * IMPORTANTE: aceitar "relatorios OU rh" NÃO concede acesso ao RH inteiro. Só
 * vale para as rotas que listam este middleware, e cada uma deve devolver
 * apenas o mínimo necessário para a finalidade. Quem ganha `rh` por esta via
 * não passa a enxergar folha, ponto, advertências ou o cadastro completo.
 */
export function permissaoQualquerDas(requisitos: Array<{ modulo: string; acao: string }>) {
  return async function (request: any, reply: any) {
    const user = (request as any).user
    if (!user) {
      return reply.status(401).send({ message: 'Não autenticado' })
    }

    // Mesmo guard do permissaoMiddleware: identidade sem claim `id` utilizável
    // é rejeitada ANTES da consulta Prisma, sob o mesmo risco de fail-open
    // (o filtro `usuarioId: undefined` seria ignorado pelo Prisma).
    const usuarioId = usuarioIdAutenticado(user)
    if (!usuarioId) {
      return reply.status(401).send({ message: 'Token sem identificação de usuário válida' })
    }

    const concedida = await prisma.permissao.findFirst({
      where: {
        usuarioId,
        permitido: true,
        OR: requisitos.map((r) => ({ modulo: r.modulo, acao: r.acao })),
      },
      select: { id: true },
    })

    if (!concedida) {
      return reply.status(403).send({ error: 'Permissão negada' })
    }
  }
}


