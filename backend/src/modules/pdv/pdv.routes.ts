
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware, permissaoQualquerDas } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { NaoEncontrado, ErroDeNegocio } from '../../lib/erros.js';
import { adquirirIdempotencia, concluirIdempotencia } from '../../lib/idempotencia.js';

/** Soma os totais do turno de caixa: vendas por forma de pagamento,
 * sangrias, suprimentos e dinheiro esperado em gaveta.
 *
 * SANGRIA MANUAL x ESTORNO AUTOMÁTICO
 * -----------------------------------
 * O cancelamento de uma venda em dinheiro cria uma `MovimentacaoCaixa` do tipo
 * `SANGRIA` (vendas.routes.ts) e reduz `Caixa.saldo` na mesma transação. Isso é
 * correto para o dinheiro — mas a linha "Sangrias" da tela somava as duas
 * coisas, então o operador via "Sangrias: R$ 500" sem nunca ter tirado nada.
 * No fechamento contestado é esse número que cai nele.
 *
 * A conta NÃO pode mudar: o estorno tem que sair do dinheiro esperado, senão o
 * fechamento com certeza diverge. Por isso ele continua sendo subtraído — só
 * que numa linha própria (`estornos`), identificada pela `origem` que o
 * próprio estorno grava (`AUTOMATICO` vs `MANUAL`).
 */
function resumoDoCaixa(caixa: { id: string; fundoTroco: unknown; saldo: unknown; abertoEm: Date }, vendas: Array<{ formaPagamento: string; total: unknown; status: string; pagamentos?: Array<{ forma: string; valor: unknown }> }>, movimentacoes: Array<{ tipo: string; valor: unknown; origem?: string }>) {
  const porForma: Record<string, number> = {};
  let totalVendas = 0;
  let qtdVendas = 0;
  let dinheiroVendas = 0;
  for (const v of vendas) {
    const total = Number(v.total);
    const pagamentos = v.pagamentos?.length ? v.pagamentos : [{ forma: v.formaPagamento, valor: v.total }];
    // O valor pago continua sendo caixa recebido mesmo quando a venda foi
    // cancelada; a devolução correspondente é contabilizada em `estornos`.
    dinheiroVendas += pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + Number(p.valor), 0);
    if (v.status !== 'FINALIZADA') continue;
    totalVendas += total;
    qtdVendas += 1;
    for (const pagamento of pagamentos) {
      porForma[pagamento.forma] = (porForma[pagamento.forma] ?? 0) + Number(pagamento.valor);
    }
  }
  const saidas = movimentacoes.filter((m) => m.tipo === 'SANGRIA');
  // `origem` ausente em registro antigo é tratado como MANUAL: sem esse
  // fallback, todo estorno já gravado passaria a contar como manual e o
  // número da tela voltaria a misturar os dois.
  const estornos = saidas.filter((m) => m.origem === 'AUTOMATICO').reduce((s, m) => s + Number(m.valor), 0);
  const sangrias = saidas.filter((m) => m.origem !== 'AUTOMATICO').reduce((s, m) => s + Number(m.valor), 0);
  const suprimentos = movimentacoes.filter((m) => m.tipo === 'SUPRIMENTO').reduce((s, m) => s + Number(m.valor), 0);
  const fundoTroco = Number(caixa.fundoTroco);
  const dinheiroEsperado = fundoTroco + suprimentos + dinheiroVendas - sangrias - estornos;
  return { totalVendas, qtdVendas, porForma, dinheiroVendas, fundoTroco, sangrias, suprimentos, estornos, dinheiroEsperado, saldoRegistrado: Number(caixa.saldo), abertoEm: caixa.abertoEm };
}

export async function pdvRoutes(app: FastifyInstance) {
  // Catálogo mínimo de uma filial para pesquisa local e operação controlada
  // quando a conexão cair. Não retorna custo, margem, fornecedor ou dados pessoais.
  app.get('/pdv/catalogo', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'visualizar')] }, async (req:any) => {
    const query = z.object({
      filialId: z.string().min(1),
      desde: z.string().datetime().optional(),
      take: z.coerce.number().int().min(1).max(500).default(200),
      skip: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const filial = await prisma.filial.findFirst({
      where: { id: query.filialId, empresaId: req.user.empresaId, status: 'ATIVO' },
      select: { id: true },
    });
    if (!filial) throw NaoEncontrado('Filial inválida para esta empresa.');

    const desde = query.desde ? new Date(query.desde) : null;
    const filtroAtualizacao = desde
      ? Prisma.sql`AND GREATEST(p."updatedAt", COALESCE(e."updatedAt", p."updatedAt")) >= ${desde}`
      : Prisma.empty;
    const [produtos, total] = await Promise.all([
      prisma.$queryRaw<Array<{
        id: string; empresaId: string; filialId: string; nome: string; sku: string | null;
        codigoBarras: string | null; precoVenda: Prisma.Decimal; precoPromocional: Prisma.Decimal | null;
        promocaoInicio: Date | null; promocaoFim: Date | null; categoriaId: string | null;
        unidade: string; imagem: string | null; status: string; estoqueFilial: number; atualizadoEm: Date;
      }>>(Prisma.sql`
        SELECT p."id", p."empresaId", ${filial.id}::text AS "filialId", p."nome", p."sku",
          p."codigoBarras", p."precoVenda", p."precoPromocional", p."promocaoInicio", p."promocaoFim",
          p."categoriaId", p."unidade", p."imagem", p."status",
          COALESCE(e."quantidade", 0)::int AS "estoqueFilial",
          GREATEST(p."updatedAt", COALESCE(e."updatedAt", p."updatedAt")) AS "atualizadoEm"
        FROM "Produto" p
        LEFT JOIN "Estoque" e ON e."produtoId" = p."id" AND e."filialId" = ${filial.id}
        WHERE p."empresaId" = ${req.user.empresaId}
        ${filtroAtualizacao}
        ORDER BY "atualizadoEm" ASC, p."id" ASC
        LIMIT ${query.take} OFFSET ${query.skip}
      `),
      prisma.produto.count({ where: { empresaId: req.user.empresaId } }),
    ]);
    return {
      produtos: produtos.map((produto) => ({
        ...produto,
        precoVenda: Number(produto.precoVenda),
        precoPromocional: produto.precoPromocional == null ? null : Number(produto.precoPromocional),
        ativo: produto.status === 'ATIVO',
        atualizadoEm: produto.atualizadoEm.toISOString(),
      })),
      total,
      capturadoEm: new Date().toISOString(),
      take: query.take,
      skip: query.skip,
    };
  });

  app.get('/pdv/integracoes', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'visualizar')] }, async (req:any) => {
    return prisma.integracaoPDV.findMany({ where: { empresaId: req.user.empresaId } });
  });

  app.post('/pdv/integracoes', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'criar')] }, async (req:any) => {
    // Antes o corpo vinha como `req.body as any`, sem schema: um `nome`
    // ausente quebrava dentro do Prisma (500 com mensagem interna) e o tipo
    // inválido caía num `throw new Error` cru, que o setErrorHandler não
    // reconhece como erro de cliente e devolve 500 em vez de 422. O usuário
    // mandava "API_OFICIALA" e recebia "erro interno do servidor".
    //
    // `url` é validada como URL real: é o endpoint que o PDV chamaria, e um
    // texto solto ali só apareceria como falha muito depois, na hora da
    // sincronização.
    const body = z.object({
      nome: z.string().trim().min(2, 'Dê um nome à integração.').max(120),
      url: z.string().trim().url('Informe uma URL válida.').max(500),
      // Seção 14: só API oficial, SDK oficial, webhook oficial, banco autorizado.
      // O tipo é o que garante a regra: qualquer valor fora daqui é recusado
      // na borda, com a lista de aceitos na mensagem (Zod 4 usa `error:`).
      tipo: z.enum(['API_OFICIAL', 'SDK_OFICIAL', 'WEBHOOK_OFICIAL', 'BANCO_AUTORIZADO'], {
        error: 'Tipo deve ser um de: API_OFICIAL, SDK_OFICIAL, WEBHOOK_OFICIAL, BANCO_AUTORIZADO - NUNCA inventar endpoint',
      }),
    }).parse(req.body ?? {});
    const integracao = await prisma.integracaoPDV.create({
      data: { empresaId: req.user.empresaId, nome: body.nome, tipo: body.tipo, url: body.url, status: 'NAO_CONFIGURADO', origem: 'INTEGRACAO' }
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'IntegracaoPDV', entidadeId: integracao.id, valorNovo: integracao, origem: 'INTEGRACAO', ip: req.ip });
    return integracao;
  });

  app.post('/pdv/sincronizar/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'editar')] }, async (req:any, reply:any) => {
    const { id } = req.params;
    const integracao = await prisma.integracaoPDV.findFirst({ where: { id, empresaId: req.user.empresaId } });
    if (!integracao) return reply.status(404).send({ error: 'Integração não encontrada.' });
    return reply.status(409).send({
      error: 'Sincronização não executada.',
      motivo: 'Nenhum fornecedor de PDV foi configurado com credenciais e método oficial neste projeto. O NEXUS OS não simula uma sincronização.',
      status: integracao.status
    });
  });

  // ===================== Seção 14 PDV — Caixa (turno de balcão) =====================

  app.get('/pdv/caixa/atual', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'visualizar')] }, async (req:any) => {
    const caixa = await prisma.caixa.findFirst({
      where: { empresaId: req.user.empresaId, usuarioId: req.user.id, status: 'ABERTO' },
      include: { filial: { select: { nome: true } }, usuario: { select: { nome: true } } },
      orderBy: { abertoEm: 'desc' },
    });
    return caixa;
  });

  app.post('/pdv/caixa/abrir', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'criar')] }, async (req:any) => {
    const data = z.object({
      filialId: z.string(),
      fundoTroco: z.number().min(0).default(0),
    }).parse(req.body);
    const caixa = await prisma.$transaction(async (tx) => {
      const lockKey = `pdv-caixa:${req.user.empresaId}:${req.user.id}`;
      await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS "locked"
      `;
      const aberto = await tx.caixa.findFirst({ where: { empresaId: req.user.empresaId, usuarioId: req.user.id, status: 'ABERTO' } });
      if (aberto) throw new ErroDeNegocio('Você já tem um caixa aberto. Feche-o antes de abrir outro.', 409);
      const filial = await tx.filial.findFirst({ where: { id: data.filialId, empresaId: req.user.empresaId } });
      if (!filial) throw NaoEncontrado('Filial inválida para esta empresa.');
      return tx.caixa.create({
        data: {
          empresaId: req.user.empresaId,
          filialId: data.filialId,
          usuarioId: req.user.id,
          fundoTroco: data.fundoTroco,
          saldo: data.fundoTroco,
          movimentacoes: data.fundoTroco > 0 ? { create: { tipo: 'ABERTURA', valor: data.fundoTroco, usuarioId: req.user.id, motivo: 'Fundo de troco na abertura', origem: 'MANUAL' } } : undefined,
        },
        include: { movimentacoes: true },
      });
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'Caixa', entidadeId: caixa.id, valorNovo: caixa, origem: 'MANUAL', ip: req.ip });
    return caixa;
  });

  app.get('/pdv/caixa/resumo', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'visualizar')] }, async (req:any, reply:any) => {
    const caixa = await prisma.caixa.findFirst({ where: { empresaId: req.user.empresaId, usuarioId: req.user.id, status: 'ABERTO' } });
    if (!caixa) return reply.status(404).send({ error: 'Nenhum caixa aberto.' });
    const [vendas, movimentacoes] = await Promise.all([
      prisma.venda.findMany({ where: { empresaId: req.user.empresaId, caixaId: caixa.id }, select: { formaPagamento: true, total: true, status: true, pagamentos: { select: { forma: true, valor: true } } } }),
      prisma.movimentacaoCaixa.findMany({ where: { caixaId: caixa.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    return resumoDoCaixa(caixa, vendas, movimentacoes);
  });

  /**
   * Vendas do turno — liberada para `pdv:visualizar` OU `vendas:visualizar`.
   *
   * Esta é a rota que causava o TRAVAMENTO do PDV. Ela vivia em `pdv.routes.ts`
   * (é dado de caixa) mas exigia `vendas:visualizar`, e o frontend a chama
   * dentro do mesmo `Promise.all` do resumo, com um `catch` único. Um 403 aqui
   * fazia o catch rodar `setCaixa(null)`: a tela passava a dizer "CAIXA FECHADO"
   * mesmo com o caixa aberto, o botão de venda era bloqueado por
   * `if (!caixa)`, e ao tentar abrir de novo o servidor devolvia 409
   * ("Você já tem um caixa aberto"). O operador ficava preso sem nenhuma
   * mensagem — porque o perfil certo (o caixa) é justamente o que tem
   * `pdv:*` e NÃO `vendas:*`.
   */
  app.get('/pdv/caixa/vendas', { preHandler: [(app as any).authenticate, await permissaoQualquerDas([{ modulo: 'pdv', acao: 'visualizar' }, { modulo: 'vendas', acao: 'visualizar' }])] }, async (req:any) => {
    const caixa = await prisma.caixa.findFirst({ where: { empresaId: req.user.empresaId, usuarioId: req.user.id, status: 'ABERTO' } });
    if (!caixa) return { vendas: [] };
    const vendas = await prisma.venda.findMany({
      where: { empresaId: req.user.empresaId, caixaId: caixa.id },
      include: { itens: true, cliente: { select: { nome: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    // VendaItem não tem relação com Produto no schema (só produtoId):
    // resolvo os nomes numa consulta separada para histórico/cupom.
    const produtoIds = [...new Set(vendas.flatMap((v) => v.itens.map((i) => i.produtoId)))];
    const produtos = produtoIds.length ? await prisma.produto.findMany({ where: { id: { in: produtoIds }, empresaId: req.user.empresaId }, select: { id: true, nome: true } }) : [];
    const nomes = new Map(produtos.map((p) => [p.id, p.nome]));
    return { vendas: vendas.map((v) => ({ ...v, itens: v.itens.map((i) => ({ ...i, produtoNome: nomes.get(i.produtoId) ?? 'Produto removido' })) })) };
  });

  app.post('/pdv/caixa/movimentacoes', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'editar')] }, async (req:any, reply:any) => {
    const data = z.object({
      tipo: z.enum(['SANGRIA', 'SUPRIMENTO']),
      valor: z.number().positive(),
      motivo: z.string().max(200).optional(),
    }).parse(req.body);

    // IDEMPOTÊNCIA (Módulo 10) — mesma proteção das vendas. Sem isto, um clique
    // duplo, um retry após timeout ou uma reconexão repetiam a sangria/suprimento
    // e mexiam no saldo/gaveta DUAS vezes. A chave é opcional (retrocompatível):
    // sem ela o comportamento é o de antes; com ela, a repetição devolve o
    // resultado original sem criar segunda movimentação. Reusa IdempotencyKey
    // (já existe, único por [empresaId, key]) — nenhuma migração necessária.
    const idemKey = (req.headers['x-idempotency-key'] as string | undefined) ?? undefined;
    let idemId: string | null = null;
    if (idemKey) {
      const aquisicao = await adquirirIdempotencia({
        key: idemKey,
        empresaId: req.user.empresaId,
        caixaId: null,
        operadorId: req.user.id,
      });
      if (aquisicao.duplicada) {
        const statusOriginal = aquisicao.responseStatus ?? (aquisicao.status === 'CONFIRMADA' ? 200 : 409);
        return reply.status(statusOriginal).send(aquisicao.responseBody ?? { duplicada: true, status: aquisicao.status });
      }
      idemId = aquisicao.id;
    }

    const caixa = await prisma.caixa.findFirst({ where: { empresaId: req.user.empresaId, usuarioId: req.user.id, status: 'ABERTO' } });
    if (!caixa) {
      if (idemId) await concluirIdempotencia(idemId, { status: 'REJEITADA', responseStatus: 422, responseBody: { error: 'Nenhum caixa aberto para movimentar.' } });
      throw new ErroDeNegocio('Nenhum caixa aberto para movimentar.', 422);
    }
    if (data.tipo === 'SANGRIA' && data.valor > Number(caixa.saldo)) {
      const corpo = { error: `Sangria de R$ ${data.valor.toFixed(2)} supera o dinheiro em gaveta (R$ ${Number(caixa.saldo).toFixed(2)}).` };
      if (idemId) await concluirIdempotencia(idemId, { status: 'REJEITADA', responseStatus: 422, responseBody: corpo });
      throw new ErroDeNegocio(corpo.error, 422);
    }
    const movimentacao = await prisma.$transaction(async (tx) => {
      const atualizado = await tx.caixa.updateMany({
        where: {
          id: caixa.id,
          empresaId: req.user.empresaId,
          usuarioId: req.user.id,
          status: 'ABERTO',
          ...(data.tipo === 'SANGRIA' ? { saldo: { gte: data.valor } } : {}),
        },
        data: { saldo: data.tipo === 'SANGRIA' ? { decrement: data.valor } : { increment: data.valor } },
      });
      if (atualizado.count !== 1) {
        const corpo = { error: data.tipo === 'SANGRIA'
            ? 'O saldo da gaveta mudou e não comporta esta sangria. Atualize o caixa e tente novamente.'
            : 'O caixa foi fechado ou alterado. Atualize o turno e tente novamente.' };
        // Conclui a chave DENTRO da transação: se o update do caixa falhou, a
        // chave vira REJEITADA atomicamente — um retry com a mesma chave recebe
        // o 409 original em vez de tentar decrementar de novo.
        if (idemId) await tx.idempotencyKey.update({ where: { id: idemId }, data: { status: 'REJEITADA', responseStatus: 409, responseBody: corpo } });
        throw new ErroDeNegocio(corpo.error, 409);
      }
      const mov = await tx.movimentacaoCaixa.create({
        data: { caixaId: caixa.id, tipo: data.tipo, valor: data.valor, motivo: data.motivo, usuarioId: req.user.id, origem: 'MANUAL' },
      });
      return mov;
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'MovimentacaoCaixa', entidadeId: movimentacao.id, valorNovo: movimentacao, origem: 'MANUAL', ip: req.ip });
    if (idemId) await concluirIdempotencia(idemId, { status: 'CONFIRMADA', responseStatus: 200, responseBody: movimentacao });
    return movimentacao;
  });

  app.post('/pdv/caixa/fechar', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'editar')] }, async (req:any) => {
    const data = z.object({
      valorContado: z.number().min(0).optional(),
      observacao: z.string().max(300).optional(),
    }).parse(req.body);
    const fechamento = await prisma.$transaction(async (tx) => {
      // O mesmo row lock é usado por POST /vendas quando recebe caixaId:
      // venda primeiro => ela entra no resumo; fechamento primeiro => venda
      // posterior falha ao tentar bloquear um caixa que já está FECHADO.
      const caixas = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Caixa"
        WHERE "empresaId" = ${req.user.empresaId}
          AND "usuarioId" = ${req.user.id}
          AND "status" = 'ABERTO'::"StatusCaixa"
        ORDER BY "abertoEm" DESC
        LIMIT 1
        FOR UPDATE
      `;
      const caixaAberto = caixas[0];
      if (!caixaAberto) throw new ErroDeNegocio('Nenhum caixa aberto para fechar.', 422);

      const caixa = await tx.caixa.findUnique({ where: { id: caixaAberto.id } });
      if (!caixa) throw new ErroDeNegocio('Nenhum caixa aberto para fechar.', 422);
      const [vendas, movimentacoes] = await Promise.all([
        tx.venda.findMany({ where: { empresaId: req.user.empresaId, caixaId: caixa.id }, select: { formaPagamento: true, total: true, status: true, pagamentos: { select: { forma: true, valor: true } } } }),
        tx.movimentacaoCaixa.findMany({ where: { caixaId: caixa.id }, orderBy: { createdAt: 'desc' } }),
      ]);
      const resumo = resumoDoCaixa(caixa, vendas, movimentacoes);
      const diferenca = data.valorContado === undefined ? null : data.valorContado - resumo.dinheiroEsperado;
      const caixaFechado = await tx.caixa.update({
        where: { id: caixa.id },
        data: { status: 'FECHADO', fechadoEm: new Date(), valorContado: data.valorContado ?? null, diferenca, observacaoFechamento: data.observacao ?? null },
      });
      return { caixa, caixaFechado, resumo };
    });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR', entidade: 'Caixa', entidadeId: fechamento.caixa.id,
      valorNovo: fechamento.caixaFechado, origem: 'MANUAL', ip: req.ip,
      contexto: `Fechamento de caixa: ${JSON.stringify(fechamento.resumo)}`,
    });
    return { caixa: fechamento.caixaFechado, resumo: fechamento.resumo };
  });
}
