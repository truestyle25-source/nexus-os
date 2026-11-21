import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { temPermissao } from '../../lib/permissoes.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { ErroDeNegocio, NaoEncontrado, Conflito } from '../../lib/erros.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { aplicarMovimento } from '../estoque/estoque.service.js';
import {
  CODIGO_TIPO_KIT, atualizarCustoDoKit, lerComposicao, produtoEhTipoKit, quantidadeNaBase, unidadesCompativeis, verificarCiclo,
} from './kit.service.js';

const quantidadeSchema = z.number().int().positive();
const quantidadeIngredienteSchema = z.number().positive().finite().refine((valor) => Math.abs(valor * 1000 - Math.round(valor * 1000)) < 1e-8, 'Use no máximo 3 casas decimais.');
/** Quantidade informada na unidade escolhida (até 6 casas: 0,5 g, 250 mL…). A conversão para a base é validada no serviço. */
const quantidadeInformadaSchema = z.number().positive('A quantidade deve ser maior que zero.').finite().max(1e9)
  .refine((valor) => Math.abs(valor * 1e6 - Math.round(valor * 1e6)) < 1e-6, 'Use no máximo 6 casas decimais.');
const origemProducao = 'MANUAL' as const;
const arredondarMoeda = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

/** Disponibilidade por filial: quantos kits os saldos atuais permitem montar (componentes sem controle/negativo liberado não limitam). */
async function disponibilidadePorFilial(empresaId: string, kitId: string) {
  const [filiais, comp] = await Promise.all([
    prisma.filial.findMany({ where: { empresaId, status: 'ATIVO' }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
    prisma.composicaoKit.findMany({
      where: { empresaId, kitProdutoId: kitId },
      select: { ingredienteProdutoId: true, quantidadePorKit: true, ingredienteProduto: { select: { nome: true, controlaEstoque: true, permiteEstoqueNegativo: true } } },
    }),
  ]);
  if (!comp.length) return filiais.map((f) => ({ filialId: f.id, filial: f.nome, kitsPossiveis: 0, limitante: null as string | null }));
  const saldos = await prisma.estoque.findMany({
    where: { empresaId, produtoId: { in: comp.map((c) => c.ingredienteProdutoId) } },
    select: { filialId: true, produtoId: true, quantidade: true },
  });
  const saldo = new Map(saldos.map((s) => [`${s.filialId}:${s.produtoId}`, Number(s.quantidade)]));
  return filiais.map((f) => {
    let minimo: number | null = null;
    let limitante: string | null = null;
    for (const c of comp) {
      if (!c.ingredienteProduto.controlaEstoque || c.ingredienteProduto.permiteEstoqueNegativo) continue;
      const possivel = Math.max(0, Math.floor((saldo.get(`${f.id}:${c.ingredienteProdutoId}`) ?? 0) / Number(c.quantidadePorKit) + 1e-9));
      if (minimo === null || possivel < minimo) { minimo = possivel; limitante = c.ingredienteProduto.nome; }
    }
    return { filialId: f.id, filial: f.nome, kitsPossiveis: minimo, limitante };
  });
}

/**
 * Vendas do kit e consumo líquido dos componentes (baixas da venda menos estornos), a partir
 * das movimentações marcadas com o kit de origem — o mesmo dado que relatórios e IA leem.
 */
async function resumoDeVendasDoKit(empresaId: string, kitId: string, itens: Array<{ produtoId: string; nome: string; unidadeBase: string }>) {
  const [vendas, consumo] = await Promise.all([
    prisma.vendaItem.aggregate({ where: { produtoId: kitId, venda: { empresaId, status: 'FINALIZADA' } }, _sum: { quantidade: true, total: true }, _count: { _all: true } }),
    prisma.estoqueMovimentacao.groupBy({ by: ['produtoId'], where: { empresaId, kitProdutoId: kitId, tipo: { in: ['VENDA', 'DEVOLUCAO'] } }, _sum: { quantidade: true } }),
  ]);
  const nomes = new Map(itens.map((i) => [i.produtoId, i]));
  const faltantes = consumo.filter((c) => !nomes.has(c.produtoId)).map((c) => c.produtoId);
  const extras = faltantes.length
    ? await prisma.produto.findMany({ where: { empresaId, id: { in: faltantes } }, select: { id: true, nome: true, unidade: true } })
    : [];
  for (const e of extras) nomes.set(e.id, { produtoId: e.id, nome: `${e.nome} (fora da composição atual)`, unidadeBase: e.unidade });
  return {
    vendas: { itensVendidos: vendas._count._all, kitsVendidos: Number(vendas._sum.quantidade ?? 0), receita: Number(vendas._sum.total ?? 0) },
    consumoComponentes: consumo.map((c) => ({
      produtoId: c.produtoId,
      nome: nomes.get(c.produtoId)?.nome ?? c.produtoId,
      unidade: nomes.get(c.produtoId)?.unidadeBase ?? '',
      quantidade: Math.round(-Number(c._sum.quantidade ?? 0) * 1000) / 1000,
    })),
  };
}

/** Ids da categoria e de todos os subgrupos abaixo dela (até 3 níveis). */
async function categoriaComSubgrupos(empresaId: string, categoriaId: string): Promise<string[]> {
  const ids = [categoriaId];
  let fronteira = [categoriaId];
  for (let i = 0; i < 4 && fronteira.length; i += 1) {
    const filhos = await prisma.categoria.findMany({ where: { empresaId, categoriaPaiId: { in: fronteira } }, select: { id: true } });
    fronteira = filhos.map((f) => f.id).filter((id) => !ids.includes(id));
    ids.push(...fronteira);
  }
  return ids;
}

export async function kitsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/produtos/:id/kit',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const empresaId = req.user.empresaId;
      const podeVerCustos = await temPermissao(req.user.id, 'custos', 'visualizar');
      const kit = await prisma.produto.findFirst({
        where: { id, empresaId },
        select: { id: true, nome: true, sku: true, ehKit: true, precoVenda: true, tipoProdutoId: true, tipoProduto: { select: { codigo: true, nome: true } }, ...(podeVerCustos ? { custo: true } : {}) },
      });
      if (!kit) throw NaoEncontrado('Produto não encontrado nesta empresa.');
      const { itens, custoTotal } = await lerComposicao(prisma, empresaId, id, podeVerCustos);
      const { tipoProdutoId: _t, ...dadosKit } = kit;
      // Unidades em que cada componente pode ser informado (para a edição na aba).
      const produtosComp = itens.length
        ? await prisma.produto.findMany({ where: { empresaId, id: { in: itens.map((i) => i.produtoId) } }, select: { id: true, unidade: true, unidadeBaseId: true } })
        : [];
      const unidadesPorProduto = new Map<string, Awaited<ReturnType<typeof unidadesCompativeis>>['unidades']>();
      for (const p of produtosComp) unidadesPorProduto.set(p.id, (await unidadesCompativeis(prisma, empresaId, p)).unidades);
      return {
        kit: { ...dadosKit, precoVenda: Number(kit.precoVenda), ...(podeVerCustos ? { custo: Number(kit.custo) } : {}), tipoKit: kit.tipoProduto?.codigo === CODIGO_TIPO_KIT },
        podeVerCusto: podeVerCustos,
        componentes: itens.map((i) => ({
          ...i,
          unidades: unidadesPorProduto.get(i.produtoId) ?? [],
          // Campos da versão anterior (modal de composição da listagem de produtos).
          sku: i.codigo,
          quantidadePorKit: i.quantidadeBase,
          ...(podeVerCustos ? { custoUnitario: i.custoUnitarioBase } : {}),
        })),
        custoCalculadoPorKit: podeVerCustos ? arredondarMoeda(custoTotal) : undefined,
        custoTotal: podeVerCustos ? custoTotal : undefined,
        disponibilidade: await disponibilidadePorFilial(empresaId, id),
        ...(await resumoDeVendasDoKit(empresaId, id, itens)),
      };
    },
  );

  /** Busca de componentes para a composição: produtos REAIS da empresa, ativos e que não sejam kit. */
  app.get(
    '/produtos/:id/kit/candidatos',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const empresaId = req.user.empresaId;
      const q = z.object({
        busca: z.string().trim().max(80).optional(),
        tipoProdutoId: z.string().min(1).optional(),
        categoriaId: z.string().min(1).optional(),
        take: z.coerce.number().int().min(1).max(50).default(20),
      }).parse(req.query);
      const kit = await prisma.produto.findFirst({ where: { id, empresaId }, select: { id: true, tipoProdutoId: true } });
      if (!kit) throw NaoEncontrado('Produto não encontrado nesta empresa.');
      const tipoKit = await produtoEhTipoKit(prisma, empresaId, kit.tipoProdutoId);
      const podeVerCustos = await temPermissao(req.user.id, 'custos', 'visualizar');
      const termo = q.busca?.trim();
      const where: Prisma.ProdutoWhereInput = {
        empresaId,
        status: 'ATIVO',
        id: { not: id },
        OR: [{ tipoProdutoId: null }, { tipoProduto: { codigo: { not: CODIGO_TIPO_KIT } } }],
        // Ficha técnica de produção (não-KIT) mantém a regra anterior: ingrediente não pode ter ficha própria.
        ...(tipoKit ? {} : { ehKit: false }),
        ...(q.tipoProdutoId ? { tipoProdutoId: q.tipoProdutoId } : {}),
        ...(q.categoriaId ? { categoriaId: { in: await categoriaComSubgrupos(empresaId, q.categoriaId) } } : {}),
        ...(termo ? {
          AND: [{
            OR: [
              { nome: { contains: termo, mode: 'insensitive' } },
              { sku: { contains: termo, mode: 'insensitive' } },
              { referencia: { contains: termo, mode: 'insensitive' } },
              { codigoBarras: { contains: termo } },
              { codigosBarras: { some: { codigo: { contains: termo } } } },
              { categoria: { is: { nome: { contains: termo, mode: 'insensitive' } } } },
              { categoria: { is: { categoriaPai: { is: { nome: { contains: termo, mode: 'insensitive' } } } } } },
              { tipoProduto: { is: { nome: { contains: termo, mode: 'insensitive' } } } },
            ],
          }],
        } : {}),
      };
      const produtos = await prisma.produto.findMany({
        where, take: q.take, orderBy: [{ nome: 'asc' }, { id: 'asc' }],
        select: {
          id: true, nome: true, sku: true, referencia: true, codigoBarras: true, unidade: true, unidadeBaseId: true, custo: true,
          tipoProduto: { select: { nome: true } },
          categoria: { select: { nome: true, categoriaPai: { select: { nome: true } } } },
          estoques: { select: { quantidade: true } },
        },
      });
      const itens = [];
      for (const p of produtos) {
        const { base, unidades } = await unidadesCompativeis(prisma, empresaId, p);
        itens.push({
          id: p.id,
          codigo: p.sku ?? p.referencia,
          nome: p.nome,
          codigoBarras: p.codigoBarras,
          tipo: p.tipoProduto?.nome ?? null,
          grupo: p.categoria?.categoriaPai?.nome ?? p.categoria?.nome ?? null,
          subgrupo: p.categoria?.categoriaPai ? p.categoria.nome : null,
          unidadeBase: base.simbolo,
          unidadeBaseId: base.id,
          unidades,
          saldoTotal: p.estoques.reduce((s, e) => s + Number(e.quantidade), 0),
          ...(podeVerCustos ? { custo: Number(p.custo) } : {}),
        });
      }
      return { itens };
    },
  );

  app.put(
    '/produtos/:id/kit',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const empresaId = req.user.empresaId;
      const body = z.object({
        componentes: z.array(z.object({
          produtoId: z.string().min(1),
          /** Quantidade na unidade escolhida (aba Composição do Kit). */
          quantidade: quantidadeInformadaSchema.optional(),
          unidadeId: z.string().min(1).nullable().optional(),
          /** Versão anterior: quantidade direto na unidade base do componente. */
          quantidadePorKit: quantidadeIngredienteSchema.optional(),
        }).refine((c) => c.quantidade !== undefined || c.quantidadePorKit !== undefined, 'Informe a quantidade do componente.'))
          .max(100),
      }).parse(req.body);
      const ids = body.componentes.map((componente) => componente.produtoId);
      if (new Set(ids).size !== ids.length) throw Conflito('Cada componente pode aparecer uma única vez na composição. Ajuste a quantidade da linha existente.');
      if (ids.includes(id)) throw new ErroDeNegocio('Um kit não pode ser componente dele mesmo.', 400);

      const resultado = await prisma.$transaction(async (tx) => {
        const lock = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Produto"
          WHERE "id" = ${id} AND "empresaId" = ${empresaId}
          FOR UPDATE
        `;
        if (!lock.length) throw NaoEncontrado('Produto não encontrado nesta empresa.');
        const kit = await tx.produto.findFirst({ where: { id, empresaId } });
        if (!kit) throw NaoEncontrado('Produto não encontrado nesta empresa.');
        const tipoKit = await produtoEhTipoKit(tx, empresaId, kit.tipoProdutoId);
        if (!tipoKit && !ids.length) throw new ErroDeNegocio('A ficha técnica precisa de ao menos um ingrediente.', 400);

        const ingredientes = ids.length
          ? await (async () => {
              const locks = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT "id" FROM "Produto"
                WHERE "empresaId" = ${empresaId} AND "id" IN (${Prisma.join(ids)})
                ORDER BY "id" FOR UPDATE
              `;
              if (locks.length !== ids.length) throw NaoEncontrado('Componente não encontrado nesta empresa.');
              return tx.produto.findMany({
                where: { id: { in: ids }, empresaId },
                select: { id: true, nome: true, status: true, ehKit: true, unidade: true, unidadeBaseId: true, tipoProduto: { select: { codigo: true } } },
              });
            })()
          : [];
        const porId = new Map(ingredientes.map((p) => [p.id, p]));
        for (const c of body.componentes) {
          const p = porId.get(c.produtoId);
          if (!p) throw NaoEncontrado('Componente não encontrado nesta empresa.');
          if (p.status !== 'ATIVO') throw new ErroDeNegocio(`${p.nome} está inativo e não pode entrar na composição.`, 409);
          if (p.tipoProduto?.codigo === CODIGO_TIPO_KIT) throw new ErroDeNegocio(`${p.nome} é um kit: kits não podem compor outros kits.`, 409);
          if (!tipoKit && p.ehKit) throw NaoEncontrado('Ingrediente invalido, inativo ou kit acabado.');
        }
        await verificarCiclo(tx, empresaId, id, ids);

        // Converte cada quantidade para a base do componente (só com regra cadastrada).
        const linhas = [];
        for (let i = 0; i < body.componentes.length; i += 1) {
          const c = body.componentes[i];
          const p = porId.get(c.produtoId)!;
          const conv = c.quantidade !== undefined
            ? await quantidadeNaBase(tx, empresaId, p, c.quantidade, c.unidadeId)
            : await quantidadeNaBase(tx, empresaId, p, c.quantidadePorKit!, null);
          linhas.push({
            empresaId, kitProdutoId: id, ingredienteProdutoId: c.produtoId, ordem: i,
            quantidadePorKit: conv.quantidadeBase,
            quantidade: c.quantidade ?? c.quantidadePorKit!,
            unidadeId: conv.unidadeId,
            _rotulo: `${c.quantidade ?? c.quantidadePorKit} ${conv.unidadeSimbolo} = ${conv.quantidadeBase} ${conv.baseSimbolo}`,
          });
        }

        const antes = await lerComposicao(tx, empresaId, id, true);
        await tx.composicaoKit.deleteMany({ where: { empresaId, kitProdutoId: id } });
        if (linhas.length) await tx.composicaoKit.createMany({ data: linhas.map(({ _rotulo: _r, ...l }) => l) });
        await tx.produto.update({ where: { id }, data: { ehKit: linhas.length > 0 } });
        const custoNovo = tipoKit
          ? await atualizarCustoDoKit(tx, empresaId, id, { usuarioId: req.user.id, justificativa: 'Custo recalculado pela composição do kit' })
          : null;
        const depois = await lerComposicao(tx, empresaId, id, true);
        return { antes, depois, custoNovo, tipoKit };
      });

      const resumo = (c: Awaited<ReturnType<typeof lerComposicao>>) => c.itens.map((i) => ({ produtoId: i.produtoId, nome: i.nome, quantidade: i.quantidade, unidade: i.unidade, quantidadeBase: i.quantidadeBase, unidadeBase: i.unidadeBase }));
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId,
        acao: 'EDITAR',
        entidade: 'ComposicaoKit',
        entidadeId: id,
        valorAnterior: { componentes: resumo(resultado.antes), custo: resultado.antes.custoTotal } as unknown as Prisma.InputJsonValue,
        valorNovo: { componentes: resumo(resultado.depois), custo: resultado.depois.custoTotal } as unknown as Prisma.InputJsonValue,
        origem: origemProducao,
        ip: req.ip,
        contexto: resultado.tipoKit ? 'Aba Composição do Kit' : 'Ficha técnica de produção',
      });
      const podeVerCustos = await temPermissao(req.user.id, 'custos', 'visualizar');
      return {
        produtoKitId: id,
        componentes: resultado.depois.itens.map(({ custoUnitarioBase, custoTotal, ...i }) => ({
          ...i, ingredienteProdutoId: i.produtoId, quantidadePorKit: i.quantidadeBase,
          ...(podeVerCustos ? { custoUnitarioBase, custoTotal } : {}),
        })),
        ...(podeVerCustos ? { custoTotal: resultado.depois.custoTotal } : {}),
      };
    },
  );

  app.get(
    '/produtos/:id/kit/producoes',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const query = z.object({ take: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
      const produto = await prisma.produto.findFirst({ where: { id, empresaId: req.user.empresaId }, select: { id: true, ehKit: true } });
      if (!produto) throw NaoEncontrado('Produto não encontrado nesta empresa.');
      if (!produto.ehKit) throw new ErroDeNegocio('Este produto não está configurado como kit.', 409);
      const podeVerCustos = await temPermissao(req.user.id, 'custos', 'visualizar');
      const producoes = await prisma.producaoKit.findMany({
        where: { empresaId: req.user.empresaId, produtoKitId: id },
        orderBy: { createdAt: 'desc' },
        take: query.take,
        include: { filial: { select: { id: true, nome: true } } },
      });
      return { producoes: producoes.map(({ custoUnitario, custoTotal, composicaoSnapshot, ...producao }) => ({
        ...producao,
        ...(podeVerCustos ? { custoUnitario: Number(custoUnitario), custoTotal: Number(custoTotal), composicaoSnapshot } : {}),
      })) };
    },
  );

  app.post(
    '/produtos/:id/kit/produzir',
    { preHandler: [app.authenticate, await permissaoMiddleware('estoque', 'criar')] },
    async (req: FastifyRequest, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({ filialId: z.string().min(1), quantidade: quantidadeSchema, idempotencyKey: z.string().min(8).max(160).optional() }).parse(req.body);
      const headerKey = req.headers['x-idempotency-key'];
      if (Array.isArray(headerKey)) throw new ErroDeNegocio('Use uma única chave de idempotência.', 400);
      if (headerKey && body.idempotencyKey && headerKey !== body.idempotencyKey) throw new ErroDeNegocio('A chave do cabeçalho e do corpo não coincide.', 400);
      const idempotencyKey = (headerKey || body.idempotencyKey || '').trim();
      if (idempotencyKey.length < 8) throw new ErroDeNegocio('Informe uma chave de idempotência com pelo menos 8 caracteres.', 400);
      if (!(await temPermissao(req.user.id, 'custos', 'editar'))) throw new ErroDeNegocio('Produzir kits altera o custo do produto acabado e exige custos.editar.', 403);

      const anterior = await prisma.producaoKit.findFirst({ where: { empresaId: req.user.empresaId, idempotencyKey } });
      if (anterior) {
        if (anterior.produtoKitId !== id || anterior.filialId !== body.filialId || anterior.quantidade.toNumber() !== body.quantidade) {
          throw Conflito('Esta chave de idempotência já foi usada em outra produção. Gere uma nova chave.');
        }
        const podeVerCustos = await temPermissao(req.user.id, 'custos', 'visualizar');
        const { custoUnitario, custoTotal, composicaoSnapshot, ...resumo } = anterior;
        return reply.send({ duplicada: true, producao: { ...resumo, ...(podeVerCustos ? { custoUnitario: Number(custoUnitario), custoTotal: Number(custoTotal), composicaoSnapshot } : {}) } });
      }

      let producao;
      try {
        producao = await prisma.$transaction(async (tx) => {
          const lockKit = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Produto"
            WHERE "id" = ${id} AND "empresaId" = ${req.user.empresaId} AND "status" = 'ATIVO'::"StatusGeral"
            FOR UPDATE
          `;
          if (!lockKit.length) throw NaoEncontrado('Produto acabado não encontrado ou inativo nesta empresa.');
          const kit = await tx.produto.findFirst({ where: { id, empresaId: req.user.empresaId, status: 'ATIVO', ehKit: true } });
          if (!kit) throw new ErroDeNegocio('Configure a composição do kit antes de produzir.', 409);
          // Produto do tipo KIT não tem estoque próprio: os componentes saem na venda. Produzir
          // geraria estoque do kit E consumiria os componentes de novo na venda (baixa dupla).
          if (await produtoEhTipoKit(tx, req.user.empresaId, kit.tipoProdutoId)) {
            throw new ErroDeNegocio('Produtos do tipo Kit são montados na venda (a venda baixa os componentes) e não passam por produção.', 409);
          }
          const filial = await tx.filial.findFirst({ where: { id: body.filialId, empresaId: req.user.empresaId, status: 'ATIVO' }, select: { id: true } });
          if (!filial) throw NaoEncontrado('Filial inválida ou inativa nesta empresa.');
          const receita = await tx.composicaoKit.findMany({
            where: { empresaId: req.user.empresaId, kitProdutoId: id },
            orderBy: { ingredienteProdutoId: 'asc' },
            include: { ingredienteProduto: true },
          });
          if (!receita.length) throw new ErroDeNegocio('O kit precisa ter ao menos um ingrediente configurado.', 409);

          const idsIngredientes = receita.map((item) => item.ingredienteProdutoId);
          const locksIngredientes = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Produto"
            WHERE "empresaId" = ${req.user.empresaId} AND "id" IN (${Prisma.join(idsIngredientes)})
            ORDER BY "id"
            FOR UPDATE
          `;
          if (locksIngredientes.length !== idsIngredientes.length) throw Conflito('A composição mudou durante a produção. Atualize e tente novamente.');

          const ingredientesAtualizados = await tx.produto.findMany({ where: { empresaId: req.user.empresaId, id: { in: idsIngredientes } } });
          if (ingredientesAtualizados.length !== idsIngredientes.length) throw Conflito('Um ingrediente foi removido durante a produção. Atualize e tente novamente.');
          if (ingredientesAtualizados.some((produto) => produto.status !== 'ATIVO' || produto.ehKit)) throw Conflito('Um ingrediente foi inativado ou passou a ser kit. Atualize a composição e tente novamente.');
          const porId = new Map(ingredientesAtualizados.map((produto) => [produto.id, produto]));
          const receitaAtual = receita.map((item) => ({ ...item, ingredienteProduto: porId.get(item.ingredienteProdutoId)! }));
          const custoUnitario = arredondarMoeda(receitaAtual.reduce((total, item) => total + Number(item.ingredienteProduto.custo) * Number(item.quantidadePorKit), 0));
          const custoTotal = arredondarMoeda(custoUnitario * body.quantidade);
          const snapshot = receitaAtual.map((item) => ({
            produtoId: item.ingredienteProdutoId,
            nome: item.ingredienteProduto.nome,
            sku: item.ingredienteProduto.sku,
            unidade: item.ingredienteProduto.unidade,
            quantidadePorKit: Number(item.quantidadePorKit),
            quantidadeConsumida: Number(item.quantidadePorKit) * body.quantidade,
            custoUnitario: Number(item.ingredienteProduto.custo),
            custoTotal: arredondarMoeda(Number(item.ingredienteProduto.custo) * Number(item.quantidadePorKit) * body.quantidade),
          }));
          if (snapshot.some((componente) => !Number.isFinite(componente.quantidadeConsumida) || Math.abs(componente.quantidadeConsumida * 1000 - Math.round(componente.quantidadeConsumida * 1000)) > 1e-8)) {
            throw new ErroDeNegocio('A quantidade consumida excede a precisão de 3 casas decimais suportada pelo estoque.', 400);
          }
          const registro = await tx.producaoKit.create({
            data: {
              empresaId: req.user.empresaId,
              filialId: filial.id,
              produtoKitId: id,
              usuarioId: req.user.id,
              quantidade: body.quantidade,
              quantidadeProduzida: body.quantidade,
              custoUnitario,
              custoTotal,
              composicaoSnapshot: snapshot,
              idempotencyKey,
            },
          });

          for (let index = 0; index < receitaAtual.length; index += 1) {
            const componente = receitaAtual[index];
            await aplicarMovimento(tx, {
              empresaId: req.user.empresaId,
              filialId: filial.id,
              produtoId: componente.ingredienteProdutoId,
              usuarioId: req.user.id,
              tipo: 'CONSUMO_INSUMO',
              quantidade: snapshot[index].quantidadeConsumida,
              motivo: `Consumo na produção do kit ${kit.nome}`,
              documento: registro.id,
              origem: 'MANUAL',
            });
          }

          const margem = Number(kit.precoVenda) > 0 ? ((Number(kit.precoVenda) - custoUnitario) / Number(kit.precoVenda)) * 100 : 0;
          await tx.produto.update({ where: { id: kit.id }, data: { custo: custoUnitario, margem } });
          await aplicarMovimento(tx, {
            empresaId: req.user.empresaId,
            filialId: filial.id,
            produtoId: kit.id,
            usuarioId: req.user.id,
            tipo: 'PRODUCAO',
            quantidade: body.quantidade,
            custoUnitario,
            motivo: `Produção do kit ${kit.nome}`,
            documento: registro.id,
            origem: 'MANUAL',
          });
          return { ...registro, custoUnitario, custoTotal, kitNome: kit.nome, componentes: snapshot };
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const repetida = await prisma.producaoKit.findFirst({ where: { empresaId: req.user.empresaId, idempotencyKey } });
          if (repetida) {
            if (repetida.produtoKitId !== id || repetida.filialId !== body.filialId || repetida.quantidade.toNumber() !== body.quantidade) {
              throw Conflito('Esta chave de idempotência já foi usada em outra produção. Gere uma nova chave.');
            }
            const podeVerCustos = await temPermissao(req.user.id, 'custos', 'visualizar');
            const { custoUnitario, custoTotal, composicaoSnapshot, ...resumo } = repetida;
            return reply.send({ duplicada: true, producao: { ...resumo, ...(podeVerCustos ? { custoUnitario: Number(custoUnitario), custoTotal: Number(custoTotal), composicaoSnapshot } : {}) } });
          }
        }
        throw error;
      }

      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'CRIAR',
        entidade: 'ProducaoKit',
        entidadeId: producao.id,
        valorNovo: producao as unknown as Prisma.InputJsonValue,
        origem: origemProducao,
        ip: req.ip,
        contexto: `Produzidas ${body.quantidade} unidade(s) de ${producao.kitNome}; ingredientes consumidos na filial ${body.filialId}.`,
      });
      const podeVerCustos = await temPermissao(req.user.id, 'custos', 'visualizar');
      const { custoUnitario, custoTotal, componentes, ...resumo } = producao;
      return reply.status(201).send({ duplicada: false, producao: { ...resumo, ...(podeVerCustos ? { custoUnitario, custoTotal, componentes } : {}) } });
    },
  );
}
