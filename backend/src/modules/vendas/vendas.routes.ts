import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma, FormaPagamento } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware, permissaoQualquerDas } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { temPermissao } from '../../lib/permissoes.js';
import { aplicarMovimento } from '../estoque/estoque.service.js';
import { converterParaUnidadeBaseVenda } from '../estoque/conversao.service.js';
import { NaoEncontrado, Conflito, ErroDeNegocio } from '../../lib/erros.js';
import { adquirirIdempotencia, concluirIdempotencia } from '../../lib/idempotencia.js';
import { dataNoFuso, dataOperacionalDate } from '../../lib/fuso.js';
import { mensagemPixProviderIndisponivel, pixProviderConfigurado, tefProviderConfigurado } from '../payments/pixProvider.js';

// ============================================================================
// ARREDONDAMENTO MONETÃRIO (integridade financeira â€” Regra 4.3).
//
// CÃ¡lculos em ponto flutuante puro (preÃ§o * qtd, soma de itens) acumulam ruÃ­do
// binÃ¡rio: 0.1*3 = 0.30000000000000004, 29.9*3 = 89.69999999999999. Esse ruÃ­do
// (a) distorce o total/subtotal gravados e (b) pode reprovar uma venda legÃ­tima
// na conferÃªncia do pagamento. Toda grandeza monetÃ¡ria Ã© normalizada para 2
// casas DECIMAIS antes de comparar ou persistir.
// ============================================================================
const EPSILON_MONETARIO = 1e-9;
function arred2(n: number): number {
  return Math.round((n + (n >= 0 ? EPSILON_MONETARIO : -EPSILON_MONETARIO)) * 100) / 100;
}
function difere(a: number, b: number): boolean {
  return Math.abs(a - b) > EPSILON_MONETARIO;
}

// ============================================================================
// FASE 2 PDV PRO â€” AlÃ§adas de desconto (regra de negÃ³cio NO BACKEND).
//
// Os limites NÃƒO ficam no frontend. O PDV pode exibir as faixas, mas quem
// decide Ã© esta tabela, aplicada na transaÃ§Ã£o da venda. Um desconto acima da
// alÃ§ada do operador Ã© rejeitado com 403 antes de gravar qualquer coisa.
//
// percentual Ã© sobre o SUBTOTAL (soma dos itens). O valor exige a permissÃ£o
// listada; a primeira faixa casada Ã© a aplicada. `qualquer` = perfil de
// terminal (vendas/pdv criar) jÃ¡ passa â€” Ã© o operador de caixa comum.
//
// Ajuste aqui para refletir a polÃ­tica da empresa; isto Ã© fonte Ãºnica.
// ============================================================================
const ALCADAS_DESCONTO: Array<{ ate: number; permissoes: Array<{ modulo: string; acao: string }>; rotulo: string }> = [
  { ate: 10, permissoes: [{ modulo: 'vendas', acao: 'criar' }, { modulo: 'pdv', acao: 'criar' }], rotulo: 'operador' },
  { ate: 30, permissoes: [{ modulo: 'vendas', acao: 'desconto' }, { modulo: 'vendas', acao: 'editar' }, { modulo: 'pdv', acao: 'editar' }], rotulo: 'supervisor' },
  { ate: 100, permissoes: [{ modulo: 'vendas', acao: 'desconto' }, { modulo: 'vendas', acao: 'gerente' }, { modulo: 'pdv', acao: 'editar' }], rotulo: 'gerente' },
];

/** Descobre a alÃ§ada necessÃ¡ria e valida se o usuÃ¡rio a possui. */
async function validarAlcadaDesconto(
  usuarioId: string,
  desconto: number,
  subtotal: number,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  if (subtotal <= 0 || desconto <= 0) return;
  const pct = (desconto / subtotal) * 100;
  const faixa = ALCADAS_DESCONTO.find((f) => pct <= f.ate);
  const necessarias = faixa?.permissoes ?? ALCADAS_DESCONTO[ALCADAS_DESCONTO.length - 1].permissoes;
  const rotulo = faixa?.rotulo ?? 'gerente';
  const concedida = await db.permissao.findFirst({
    where: { usuarioId, permitido: true, OR: necessarias },
    select: { id: true },
  });
  if (!concedida) {
    throw new ErroDeNegocio(
      `Desconto de ${pct.toFixed(1)}% exige autorizaÃ§Ã£o de ${rotulo}. Solicite a um responsÃ¡vel.`,
      403,
    );
  }
}
import {
  FORMAS_PAGAMENTO,
  STATUS_VENDA,
  contarCanceladasEstornos,
  montarWhereVendas,
  normalizarContagemPorStatus,
  variacaoPercentual,
} from './vendas.filtros.js';


const origemSchema = z.enum(['MANUAL', 'IMPORTADO', 'API', 'AUTOMATICO', 'PDV', 'PONTO', 'INTEGRACAO', 'IA']);
const formaPagamentoSchema = z.enum(FORMAS_PAGAMENTO);

// SeÃ§Ã£o 6: "pode acessar vendas sem ver custos" â€” VendaItem guarda
// custoUnitario (Ã© dado de custo, igual ao Produto.custo). Sem
// custos.visualizar, o campo some da resposta â€” mesmo padrÃ£o jÃ¡ usado em
// produtos.routes.ts (ocultarCusto), sÃ³ que nunca tinha sido aplicado
// aqui. Isso fecha um vazamento real: antes desta rodada, qualquer
// usuÃ¡rio com vendas.visualizar via o custo de cada item vendido.
function ocultarCustoDosItens<T extends { itens: Array<Record<string, unknown>> }>(venda: T, podeVerCusto: boolean): T {
  if (podeVerCusto) return venda;
  return {
    ...venda,
    itens: venda.itens.map((item) => {
      const { custoUnitario: _custoUnitario, ...resto } = item;
      return resto;
    }),
  };
}
// `Venda.funcionarioId` Ã© apenas o id do usuÃ¡rio que vendeu (nÃ£o existe
// relaÃ§Ã£o declarada no schema), entÃ£o o nome do vendedor Ã© resolvido numa
// consulta extra â€” mesmo padrÃ£o jÃ¡ usado em pdv.routes.ts para os nomes de
// produto. Ã‰ isso que permite a coluna "Vendedor" e o filtro por vendedor da
// aba Vendas existirem sem inventar nome.
async function nomesDeVendedores(
  empresaId: string,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (unicos.length === 0) return new Map<string, string>();
  const usuarios = await prisma.usuario.findMany({
    where: { id: { in: unicos }, empresaId },
    select: { id: true, nome: true },
  });
  return new Map(usuarios.map((u) => [u.id, u.nome]));
}


export async function vendasRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/vendas',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('vendas', 'visualizar')] },
    async (req: FastifyRequest) => {
      const user = (req as any).user;
      const query = z
        .object({
          filialId: z.string().optional(),
          clienteId: z.string().optional(),
          funcionarioId: z.string().optional(),
          status: z.enum(STATUS_VENDA).optional(),
          formaPagamento: formaPagamentoSchema.optional(),
          busca: z.string().trim().min(1).max(120).optional(),
          de: z.string().optional(),
          ate: z.string().optional(),
          take: z.coerce.number().int().min(1).max(1000).default(50),
          skip: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);
      // Regra de filtro vive em vendas.filtros.ts (pura e testada).
      const where = montarWhereVendas(user.empresaId, query);
      const podeVerCusto = await temPermissao(user.id, 'custos', 'visualizar');
      const [vendas, total] = await Promise.all([
        prisma.venda.findMany({ where, include: { itens: true, cliente: true }, orderBy: { createdAt: 'desc' }, take: query.take, skip: query.skip }),
        prisma.venda.count({ where }),
      ]);
      const vendedores = await nomesDeVendedores(user.empresaId, vendas.map((v) => v.funcionarioId));
      return {
        vendas: vendas.map((v) => ({
          ...ocultarCustoDosItens(v, podeVerCusto),
          vendedorNome: v.funcionarioId ? vendedores.get(v.funcionarioId) ?? null : null,
        })),
        total,
        take: query.take,
        skip: query.skip,
      };
    },
  );

  app.get(
    '/vendas/idempotencia/:key',
    { preHandler: [(app as any).authenticate, await permissaoQualquerDas([{ modulo: 'pdv', acao: 'visualizar' }, { modulo: 'vendas', acao: 'visualizar' }, { modulo: 'pdv', acao: 'criar' }])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { key } = req.params as { key: string };
      const user = (req as any).user;
      const registro = await prisma.idempotencyKey.findFirst({
        where: { empresaId: user.empresaId, operadorId: user.id, key },
        select: { status: true, vendaId: true, responseStatus: true, updatedAt: true },
      });
      if (!registro) return reply.status(404).send({ error: 'Chave de idempotÃªncia nÃ£o encontrada.' });
      return registro;
    },
  );

  app.get(
    '/vendas/:id',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('vendas', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const user = (req as any).user;
      const venda = await prisma.venda.findFirst({ where: { id, empresaId: user.empresaId }, include: { itens: true, cliente: true } });
      if (!venda) throw NaoEncontrado('Venda nÃ£o encontrada nesta empresa.');
      const podeVerCusto = await temPermissao(user.id, 'custos', 'visualizar');
      // Mesmo enriquecimento do GET /vendas: o detalhe da venda (drawer) mostra
      // o vendedor, e `funcionarioId` sozinho nÃ£o Ã© legÃ­vel para o usuÃ¡rio.
      const vendedores = await nomesDeVendedores(user.empresaId, [venda.funcionarioId]);
      return {
        ...ocultarCustoDosItens(venda, podeVerCusto),
        vendedorNome: venda.funcionarioId ? vendedores.get(venda.funcionarioId) ?? null : null,
      };
    },
  );

  const itensSchema = z
    .array(z.object({ produtoId: z.string(), quantidade: z.number().int().positive(), desconto: z.number().min(0).default(0) }))
    .min(1);

  app.post(
    '/vendas',
    // `pdv:criar` entra na lista porque o PDV Ã© um TERMINAL DE VENDA: quem
    // opera o balcÃ£o precisa registrar a venda, e Ã© isso que esta rota faz.
    // Antes ela exigia sÃ³ `vendas:criar`, entÃ£o o perfil correto do PDV â€” o
    // caixa, que recebe permissÃµes granulares de `pdv:*` â€” recebia 403 em
    // toda venda: o mÃ³dulo inteiro era inÃºtil para quem deveria usÃ¡-lo.
    //
    // Isto NÃƒO amplia poder: `pdv:criar` jÃ¡ permite vender pelo PDV, e esta
    // rota Ã© exatamente o que o PDV chama. A diferenÃ§a Ã© sÃ³ que agora o
    // caminho existe para quem tem a permissÃ£o do terminal, em vez de exigir
    // tambÃ©m a do mÃ³dulo de vendas.
    { preHandler: [(app as any).authenticate, await permissaoQualquerDas([{ modulo: 'vendas', acao: 'criar' }, { modulo: 'pdv', acao: 'criar' }])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = (req as any).user;
      const data = z
        .object({
          filialId: z.string(),
          setorId: z.string().optional(),
          clienteId: z.string().optional(),
          formaPagamento: formaPagamentoSchema.default('DINHEIRO'),
          // Quantas parcelas o cliente combinou. O PDV oferece 1x a 6x no
          // cartÃ£o de crÃ©dito e o cupom impresso jÃ¡ mostrava "3x" â€” mas o
          // nÃºmero nunca era enviado nem gravado, entÃ£o o comprovando do
          // cliente afirmava um parcelamento inexistente. Limitado a 1..12
          // porque acima disso Ã© sempre erro de digitaÃ§Ã£o.
          parcelas: z.number().int().min(1).max(12).default(1),
          desconto: z.number().min(0).default(0),
          itens: itensSchema,
          origem: origemSchema.default('MANUAL'),
          pdvId: z.string().optional(),
          caixaId: z.string().optional(), // PDV: turno de caixa que fecha a venda
          // FASE 2 â€” pagamento misto (ex.: parte dinheiro + parte PIX). Quando
          // ausente, a venda segue com forma Ãºnica (compatÃ­vel com o PDV atual
          // e com a aba Vendas). A soma precisa bater EXATAMENTE com o total.
          pagamentos: z
            .array(z.object({ forma: formaPagamentoSchema, valor: z.number().positive(), referencia: z.string().optional() }))
            .min(1)
            .optional(),
        })
        .parse(req.body);

      const formasPagamentoSolicitadas = data.pagamentos?.map((pagamento) => pagamento.forma) ?? [data.formaPagamento];
      if (!pixProviderConfigurado && formasPagamentoSolicitadas.includes('PIX')) {
        throw new ErroDeNegocio(mensagemPixProviderIndisponivel, 503);
      }
      if (!tefProviderConfigurado && formasPagamentoSolicitadas.some((forma) => forma === 'CARTAO_CREDITO' || forma === 'CARTAO_DEBITO')) {
        throw new ErroDeNegocio('CartÃ£o indisponÃ­vel: nenhum provider TEF oficial estÃ¡ configurado.', 503);
      }

      // FASA 2 â€” IdempotÃªncia. A chave Ã© criada UMA vez no cliente e mantida
      // em todos os retries (offline â†’ sync). Mesma chave = mesma operaÃ§Ã£o:
      // um retry devolve o resultado original, nunca uma segunda venda.
      const idemKey = (req.headers['x-idempotency-key'] as string | undefined) ?? (req.body as any)?.idempotencyKey;
      let idemId: string | null = null;
      if (idemKey) {
        const aquisicao = await adquirirIdempotencia({
          key: idemKey,
          empresaId: user.empresaId,
          filialId: data.filialId,
          caixaId: data.caixaId ?? null,
          operadorId: user.id,
        });
        if (aquisicao.duplicada) {
          // JÃ¡ processada: devolve o desfecho registrado sem regravar nada.
          // FASE 1 PDV PRO â€” replay fiel: reproduz o status HTTP ORIGINAL.
          // Sem isso, uma rejeiÃ§Ã£o 422/403 era reexibida como 200 e o
          // consumidor tratava erro como sucesso.
          const statusOriginal = aquisicao.responseStatus ?? (aquisicao.status === 'CONFIRMADA' ? 201 : 409);
          return reply.status(statusOriginal).send(aquisicao.responseBody ?? { duplicada: true, status: aquisicao.status });
        }
        idemId = aquisicao.id;
      }

      let result: any;
      let transacaoConfirmada = false;
      try {
      const transacao = await prisma.$transaction(async (tx) => {
        const filial = await tx.filial.findFirst({ where: { id: data.filialId, empresaId: user.empresaId } });
        if (!filial) throw NaoEncontrado('Filial invÃ¡lida para esta empresa.');
        // O instante UTC vem do PostgreSQL; o dia operacional Ã© derivado
        // desse mesmo instante e do fuso configurado para a filial.
        const [{ agoraUtc }] = await tx.$queryRaw<Array<{ agoraUtc: Date }>>`SELECT CURRENT_TIMESTAMP AS "agoraUtc"`;
        const diaOperacional = dataNoFuso(agoraUtc, filial.fusoHorario);
        const dataOperacional = dataOperacionalDate(agoraUtc, filial.fusoHorario);
        if (data.setorId) {
          const setor = await tx.setor.findFirst({ where: { id: data.setorId, empresaId: user.empresaId } });
          if (!setor) throw NaoEncontrado('Setor invÃ¡lido para esta empresa.');
        }
        if (data.clienteId) {
          const cliente = await tx.cliente.findFirst({ where: { id: data.clienteId, empresaId: user.empresaId } });
          if (!cliente) throw NaoEncontrado('Cliente invÃ¡lido para esta empresa.');
        }

        let caixaTurno: { id: string } | null = null;
        if (data.caixaId) {
          // Serializa a venda do PDV com POST /pdv/caixa/fechar. O bloqueio
          // precisa ser adquirido antes de gravar a venda; se o fechamento
          // vencer, a condiÃ§Ã£o status='ABERTO' deixa de casar e a transaÃ§Ã£o
          // inteira da venda Ã© revertida.
          const caixas = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Caixa"
            WHERE "id" = ${data.caixaId}
              AND "empresaId" = ${user.empresaId}
              AND "usuarioId" = ${user.id}
              AND "status" = 'ABERTO'::"StatusCaixa"
            FOR UPDATE
          `;
          caixaTurno = caixas[0] ?? null;
          if (!caixaTurno) throw new ErroDeNegocio('Caixa informado nÃ£o estÃ¡ aberto para este usuÃ¡rio.', 422);
        }

        const itensCalculados: Array<{
          produto: {
            id: string;
            nome: string;
            custo: Prisma.Decimal;
            unidade: string;
            precoVenda: Prisma.Decimal;
            precoPromocional: Prisma.Decimal | null;
            promocaoInicio: Date | null;
            promocaoFim: Date | null;
          };
          quantidade: number;
          preco: number;
          desconto: number;
          total: number;
        }> = [];
        let subtotal = 0;
        // Base BRUTA (sem descontos) e total de desconto aplicado (itens + venda).
        // A alÃ§ada Ã© calculada sobre esta base e sobre este desconto TOTAL: sem
        // isso, um desconto por item escapava de qualquer autorizaÃ§Ã£o (bypass) e
        // o percentual da alÃ§ada era medido sobre base jÃ¡ lÃ­quida.
        let subtotalBruto = 0;
        let descontoTotal = 0;
        for (const item of data.itens) {
          const produto = await tx.produto.findFirst({ where: { id: item.produtoId, empresaId: user.empresaId, status: 'ATIVO' }, select: { id: true, nome: true, unidade: true, custo: true, precoVenda: true, precoPromocional: true, promocaoInicio: true, promocaoFim: true } });
          if (!produto) throw NaoEncontrado(`Produto ${item.produtoId} nÃ£o encontrado.`);
          const estoque = await tx.estoque.findUnique({ where: { filialId_produtoId: { filialId: data.filialId, produtoId: item.produtoId } } });
          const qtdAtual = Number(estoque?.quantidade ?? 0);
          if (qtdAtual < item.quantidade) throw new ErroDeNegocio(`Estoque insuficiente para ${produto.nome}: tem ${qtdAtual}, precisa ${item.quantidade}.`, 422);
          const promocaoDentroDaJanela = produto.precoPromocional != null
            && (!produto.promocaoInicio || produto.promocaoInicio <= agoraUtc)
            && (!produto.promocaoFim || produto.promocaoFim >= agoraUtc);
          const preco = arred2(Number(promocaoDentroDaJanela ? produto.precoPromocional : produto.precoVenda));
          const descontoItem = arred2(item.desconto);
          const brutoItem = arred2(preco * item.quantidade);
          const totalItem = arred2(brutoItem - descontoItem);
          if (totalItem < 0) throw new ErroDeNegocio('Desconto do item nÃ£o pode superar o valor do item.', 422);
          subtotalBruto = arred2(subtotalBruto + brutoItem);
          descontoTotal = arred2(descontoTotal + descontoItem);
          subtotal = arred2(subtotal + totalItem);
          itensCalculados.push({ produto, quantidade: item.quantidade, preco, desconto: descontoItem, total: totalItem });
        }
        const total = arred2(subtotal - data.desconto);
        if (total < 0) throw new ErroDeNegocio('Desconto da venda nÃ£o pode superar o subtotal.', 422);

        // FASA 2 â€” alÃ§ada de desconto validada NO BACKEND (nÃ£o confia no front).
        // Avalia o desconto TOTAL (itens + venda) sobre a base BRUTA: impede que
        // um desconto por item contorne a alÃ§ada e mede o percentual correto.
        await validarAlcadaDesconto(user.id, arred2(descontoTotal + data.desconto), subtotalBruto, tx);

        // FASA 2 â€” pagamento misto: a soma precisa bater EXATAMENTE com o total.
        if (data.pagamentos) {
          const somaPagamentos = arred2(data.pagamentos.reduce((s, p) => s + p.valor, 0));
          if (difere(somaPagamentos, total)) {
            throw new ErroDeNegocio(
              `Soma dos pagamentos (R$ ${somaPagamentos.toFixed(2)}) nÃ£o confere com o total da venda (R$ ${total.toFixed(2)}).`,
              422,
            );
          }
        }

        const venda = await tx.venda.create({
          data: {
            empresaId: user.empresaId,
            filialId: data.filialId,
            setorId: data.setorId,
            clienteId: data.clienteId,
            funcionarioId: user.id,
            formaPagamento: data.formaPagamento,
            parcelas: data.parcelas,
            subtotal,
            desconto: data.desconto,
            total,
            origem: data.origem,
            pdvId: data.pdvId,
            caixaId: caixaTurno?.id,
            idempotencyKey: idemKey,
            status: 'FINALIZADA',
            createdAt: agoraUtc,
            dataOperacional,
            itens: { create: itensCalculados.map((i) => ({ produtoId: i.produto.id, quantidade: i.quantidade, preco: i.preco, custoUnitario: Number(i.produto.custo), desconto: i.desconto, total: i.total })) },
          },
          include: { itens: true },
        });

        // FASA 2 â€” pagamento misto: registra cada parcela. A primeira linha
        // espelha a forma principal (compatibilidade), as demais sÃ³ entram
        // quando o PDV envia `pagamentos`. `total` grava o valor recebido.
        const linhasPagamento: Array<{ forma: FormaPagamento; valor: number; ordem: number; referencia: string | null }> = [];
        if (data.pagamentos) {
          data.pagamentos.forEach((p, i) => linhasPagamento.push({ forma: p.forma, valor: arred2(p.valor), ordem: i + 1, referencia: p.referencia ?? null }));
        }
        // Valor efetivamente recebido em DINHEIRO â€” sÃ³ isso entra na gaveta.
        const dinheiroRecebido = data.pagamentos
          ? data.pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + arred2(p.valor), 0)
          : data.formaPagamento === 'DINHEIRO' ? total : 0;

        // PDV: venda em dinheiro entra na gaveta do turno na hora
        if (caixaTurno && dinheiroRecebido > 0) {
          await tx.caixa.update({ where: { id: caixaTurno.id }, data: { saldo: { increment: dinheiroRecebido } } });
        }

        if (linhasPagamento.length > 0) {
          await tx.vendaPagamento.createMany({
            data: linhasPagamento.map((lp) => ({ vendaId: venda.id, empresaId: user.empresaId, forma: lp.forma, valor: lp.valor, ordem: lp.ordem, referencia: lp.referencia })),
          });
        }
        // Baixa de estoque via service compartilhado (Fase 3): a mesma
        // lÃ³gica de concorrÃªncia segura jÃ¡ vive em estoque.service.ts e
        // Ã© usada por Estoque/Compras â€” elimina duplicaÃ§Ã£o que existia
        // aqui antes.

        for (const item of itensCalculados) {
          const produto = await tx.produto.findFirst({ where: { id: item.produto.id, empresaId: user.empresaId } });
          if (!produto) throw NaoEncontrado('Produto nÃ£o encontrado nesta empresa.');

          const unidadeBase = produto.unidadeBaseId
            ? await tx.unidade.findFirst({
                where: { id: produto.unidadeBaseId, empresaId: user.empresaId },
                select: { id: true },
              })
            : null;

          if (produto.unidadeBaseId && !unidadeBase) {
            throw NaoEncontrado('Unidade base do produto nao encontrada.');
          }

          const conversao = await converterParaUnidadeBaseVenda({
            empresaId: user.empresaId,
            produtoId: item.produto.id,
            unidadeBaseId: unidadeBase?.id,
            quantidadeVenda: item.quantidade,
            unidadeVendaSimbolo: item.produto.unidade,
          });

          const snapshotAtualizado = await tx.vendaItem.updateMany({
            where: {
              vendaId: venda.id,
              produtoId: item.produto.id,
              quantidade: item.quantidade,
              preco: item.preco,
              desconto: item.desconto,
              total: item.total,
            },
            data: {
              unidadeVenda: item.produto.unidade,
              fatorAplicado: conversao.fator,
              quantidadeBase: conversao.quantidadeDestino,
            },
          });

          if (snapshotAtualizado.count === 0) {
            throw new ErroDeNegocio(
              'Nao foi possivel registrar a conversao de unidade do item da venda.',
              500,
            );
          }

          await aplicarMovimento(tx, {
            empresaId: user.empresaId,
            filialId: data.filialId,
            produtoId: item.produto.id,
            usuarioId: user.id,
            tipo: 'VENDA',
            quantidade: conversao.quantidadeDestino.toNumber(),
            motivo: `Venda ${venda.id}`,
            documento: venda.id,
            origem: data.origem,
          });

          // A conversao e a quantidade-base foram persistidas em VendaItem.

          // Tratar produto fabricado e kits
          // Se produto fabricado (tipo = 'PRODUzido'): apenas o acabado Ã© baixado
          // (jÃ¡ feito acima - sÃ³ decrementamos o produto atual, nÃ£o os ingredientes)
          // Se kit virtual: baixar componentes na venda
          if (produto.ehKit) {
            const componentes = await tx.composicaoKit.findMany({
              where: { empresaId: user.empresaId, kitProdutoId: item.produto.id },
              select: { ingredienteProdutoId: true, quantidadePorKit: true },
            });

            for (const comp of componentes) {
              // Verificar se o ingrediente tem unidade diferente da base e converter se necessÃ¡rio
              const ingrediente = await tx.produto.findFirst({
                where: { id: comp.ingredienteProdutoId, empresaId: user.empresaId },
              });
              if (!ingrediente) throw NaoEncontrado('Ingrediente do kit nÃ£o encontrado.');

              const unidadeBaseIng = ingrediente.unidadeBaseId
                ? await tx.unidade.findFirst({
                    where: { id: ingrediente.unidadeBaseId, empresaId: user.empresaId },
                    select: { id: true },
                  })
                : null;

              if (ingrediente.unidadeBaseId && !unidadeBaseIng) {
                throw NaoEncontrado('Unidade base do ingrediente nao encontrada.');
              }

              const convIng = await converterParaUnidadeBaseVenda({
                empresaId: user.empresaId,
                produtoId: comp.ingredienteProdutoId,
                unidadeBaseId: unidadeBaseIng?.id,
                quantidadeVenda: comp.quantidadePorKit,
                unidadeVendaSimbolo: ingrediente.unidade,
              });

              await aplicarMovimento(tx, {
                empresaId: user.empresaId,
                filialId: data.filialId,
                produtoId: comp.ingredienteProdutoId,
                usuarioId: user.id,
                tipo: 'VENDA',
                quantidade: convIng.quantidadeDestino.toNumber(),
                motivo: `Consumo de kit ${venda.id}`,
                documento: venda.id,
                origem: data.origem,
              });

              // A baixa do componente ja foi aplicada ao estoque.
            }
          } else {
            // Produto fabricado: garantir que apenas o acabado foi baixado
            // (jÃ¡ que aplicarMovimento jÃ¡ chamou pelo produto acabado)
            // NÃ£o fazer nada adicional - os ingredientes jÃ¡ foram consumidos na produÃ§Ã£o
          }
        }

        const hoje = dataOperacional;
        const indicador = await tx.indicadorDiario.upsert({
          where: { empresaId_filialId_data: { empresaId: user.empresaId, filialId: data.filialId, data: hoje } },
          update: { faturamento: { increment: total }, qtdVendas: { increment: 1 } },
          create: { empresaId: user.empresaId, filialId: data.filialId, data: hoje, faturamento: total, qtdVendas: 1, ticketMedio: total },
        });
        await tx.indicadorDiario.update({ where: { id: indicador.id }, data: { ticketMedio: Number(indicador.faturamento) / indicador.qtdVendas } });

        const periodo = diaOperacional.slice(0, 7);
        const metas = await tx.meta.findMany({ where: { empresaId: user.empresaId, tipo: 'VENDAS', periodo } });
        for (const meta of metas) {
          const novo = Number(meta.realizado) + total;
          await tx.meta.update({ where: { id: meta.id }, data: { realizado: novo, percentual: Number(meta.metaValor) ? (novo / Number(meta.metaValor)) * 100 : 0, diferenca: novo - Number(meta.metaValor) } });
        }

        await tx.financeiro.create({
          data: {
            empresaId: user.empresaId,
            filialId: data.filialId,
            tipo: 'RECEITA',
            categoria: 'vendas',
            centroCusto: data.setorId,
            descricao: `Venda ${venda.id} - ${data.formaPagamento}`,
            valor: total,
            status: 'PAGO',
            vendaId: venda.id,
            origem: data.origem,
          },
        });

        if (data.clienteId) {
          const cliente = await tx.cliente.findFirst({ where: { id: data.clienteId, empresaId: user.empresaId } });
          if (cliente) {
            const novoTotal = Number(cliente.valorTotalComprado) + total;
            const novaFreq = cliente.frequencia + 1;
            await tx.cliente.update({ where: { id: cliente.id }, data: { valorTotalComprado: novoTotal, frequencia: novaFreq, ticketMedio: novaFreq ? novoTotal / novaFreq : 0, ultimaCompra: new Date() } });
          }
        }

        const vendaAtualizada = await tx.venda.findUnique({
          where: { id: venda.id },
          include: { itens: true },
        });

        if (!vendaAtualizada) {
          throw NaoEncontrado('Venda nao encontrada apos registrar a conversao.');
        }

        const resultado = {
          venda: vendaAtualizada,
          ticketMedio: Number(indicador.faturamento) / indicador.qtdVendas,
          faturamento: Number(indicador.faturamento),
          qtdVendas: indicador.qtdVendas,
        };
        const permissaoCusto = await tx.permissao.findFirst({ where: { usuarioId: user.id, modulo: 'custos', acao: 'visualizar', permitido: true }, select: { id: true } });
        const resposta = { ...resultado, venda: ocultarCustoDosItens(resultado.venda, Boolean(permissaoCusto)) };
        // Resultado e venda sÃ£o confirmados no mesmo commit. Uma queda do
        // processo depois do COMMIT nÃ£o pode deixar chave PROCESSANDO sem
        // vÃ­nculo com a venda jÃ¡ gravada.
        if (idemId) {
          await tx.idempotencyKey.update({
            where: { id: idemId },
            data: { status: 'CONFIRMADA', vendaId: venda.id, responseStatus: 201, responseBody: resposta as Prisma.InputJsonValue },
          });
        }
        return { resultado, resposta };
      });
      transacaoConfirmada = true;
      result = transacao.resultado;

      await registrarAuditoria({ usuarioId: user.id, empresaId: user.empresaId, acao: 'CRIAR', entidade: 'Venda', entidadeId: result.venda.id, valorNovo: result.venda, origem: result.venda.origem, ip: req.ip });
      // FASE 1 PDV PRO â€” 201 Created na criaÃ§Ã£o. O helper de envio do PDV
      // (enviarOperacaoPdv) valida o corpo e aceita 2xx, entÃ£o 201 nÃ£o quebra
      // o terminal nem a aba Vendas.
      return reply.status(201).send(transacao.resposta);
    } catch (e) {
      // FASA 2 â€” falha: marca a chave como rejeitada para que um retry com a
      // mesma chave devolva o erro original em vez de duplicar a operaÃ§Ã£o.
      if (idemId && !transacaoConfirmada) {
        // FASE 1 PDV PRO â€” ErroDeNegocio carrega `status` (nÃ£o `statusCode`,
        // que sÃ³ existe em erros do Fastify). Sem este fallback, 403/422/503
        // eram persistidos como 500 na chave e o replay/reconciliaÃ§Ã£o
        // exibiam "HTTP 500" incorreto.
        const statusReal = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
        await concluirIdempotencia(idemId, { status: 'REJEITADA', responseStatus: statusReal, responseBody: { error: (e as any)?.message ?? 'Falha ao processar a venda.' } });
      }
      throw e;
    }
    },
  );

  app.post(
    '/vendas/:id/cancelar',
    { preHandler: [(app as any).authenticate, await permissaoQualquerDas([{ modulo: 'vendas', acao: 'editar' }, { modulo: 'pdv', acao: 'editar' }])] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const user = (req as any).user;
      // Corpo opcional â€” Ã© o que o modal de estorno da aba Vendas envia
      // (motivo obrigatÃ³rio + escolha de estornar estoque/financeiro). Body
      // vazio/ausente continua valendo: Ã© o que o PDV manda hoje, e o
      // comportamento permanece exatamente o de antes (estorna tudo).
      const body = z
        .object({
          motivo: z.string().trim().min(3).max(300).optional(),
          estornarEstoque: z.boolean().default(true),
          estornarFinanceiro: z.boolean().default(true),
        })
        .parse(req.body ?? {});
      const motivoCancelamento = body.motivo ?? `Cancelamento venda ${id}`;



      const vendaCancelada = await prisma.$transaction(async (tx) => {
        const bloqueios = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Venda"
          WHERE "id" = ${id} AND "empresaId" = ${user.empresaId}
          FOR UPDATE
        `;
        if (bloqueios.length === 0) throw NaoEncontrado('Venda nÃ£o encontrada nesta empresa.');
        const venda = await tx.venda.findUnique({ where: { id }, include: { itens: true, pagamentos: true } });
        if (!venda) throw NaoEncontrado('Venda nÃ£o encontrada nesta empresa.');
        if (venda.status !== 'FINALIZADA') throw Conflito(`Venda com status ${venda.status} nÃ£o pode ser estornada novamente.`);

        // O status vira CANCELADA AQUI, antes de qualquer recÃ¡lculo derivado.
        // Este era um defeito real: o bloco do cliente lÃ¡ embaixo filtra
        // `status: 'FINALIZADA'` â€” e como a venda AINDA era FINALIZADA naquele
        // instante, ela continuava contada, e estornar nunca reduzia
        // valorTotalComprado/frequencia/ticketMedio. Como tudo roda numa
        // transaÃ§Ã£o, se algo falhar depois o rollback desfaz esta escrita.
        const vendaJaCancelada = await tx.venda.update({ where: { id }, data: { status: 'CANCELADA' } });

        for (const item of body.estornarEstoque ? venda.itens : []) {
          await aplicarMovimento(tx, {
            empresaId: venda.empresaId,
            filialId: venda.filialId,
            produtoId: item.produtoId,
            usuarioId: user.id,
            tipo: 'DEVOLUCAO',
            quantidade: (item.quantidadeBase ?? item.quantidade).toNumber(),
            motivo: motivoCancelamento,
            documento: id,
            origem: 'MANUAL',
          });
        }

        if (body.estornarFinanceiro) await tx.financeiro.updateMany({ where: { vendaId: id, empresaId: user.empresaId }, data: { status: 'CANCELADO' } });

        const filialVenda = await tx.filial.findFirst({
          where: { id: venda.filialId, empresaId: venda.empresaId },
          select: { fusoHorario: true },
        });
        const diaOperacional = venda.dataOperacional
          ? venda.dataOperacional.toISOString().slice(0, 10)
          : dataNoFuso(venda.createdAt, filialVenda?.fusoHorario);
        const hoje = venda.dataOperacional ?? dataOperacionalDate(venda.createdAt, filialVenda?.fusoHorario);
        const indicador = await tx.indicadorDiario.findUnique({ where: { empresaId_filialId_data: { empresaId: venda.empresaId, filialId: venda.filialId, data: hoje } } });
        if (body.estornarFinanceiro && indicador) {
          const faturamento = Math.max(0, Number(indicador.faturamento) - Number(venda.total));
          const qtd = Math.max(0, indicador.qtdVendas - 1);
          await tx.indicadorDiario.update({ where: { id: indicador.id }, data: { faturamento, qtdVendas: qtd, ticketMedio: qtd ? faturamento / qtd : 0 } });
        }

        const periodo = diaOperacional.slice(0, 7);
        const metas = await tx.meta.findMany({ where: { empresaId: user.empresaId, tipo: 'VENDAS', periodo } });
        for (const meta of body.estornarFinanceiro ? metas : []) {
          const novo = Math.max(0, Number(meta.realizado) - Number(venda.total));
          await tx.meta.update({ where: { id: meta.id }, data: { realizado: novo, percentual: Number(meta.metaValor) ? (novo / Number(meta.metaValor)) * 100 : 0, diferenca: novo - Number(meta.metaValor) } });
        }

        if (body.estornarFinanceiro && venda.clienteId) {
          const vendasCliente = await tx.venda.findMany({ where: { empresaId: user.empresaId, clienteId: venda.clienteId, status: 'FINALIZADA' }, select: { total: true, createdAt: true } });
          const totalCliente = vendasCliente.reduce((s, v) => s + Number(v.total), 0);
          const freq = vendasCliente.length;
          const ultima = vendasCliente.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.createdAt ?? null;
          await tx.cliente.update({ where: { id: venda.clienteId }, data: { valorTotalComprado: totalCliente, frequencia: freq, ticketMedio: freq ? totalCliente / freq : 0, ultimaCompra: ultima } });
        }

        const dinheiroEstornado = venda.pagamentos.length > 0
          ? venda.pagamentos.filter((pagamento) => pagamento.forma === 'DINHEIRO').reduce((soma, pagamento) => soma + Number(pagamento.valor), 0)
          : venda.formaPagamento === 'DINHEIRO' ? Number(venda.total) : 0;
        if (body.estornarFinanceiro && venda.caixaId && dinheiroEstornado > 0) {
          // Estorna apenas a parcela em dinheiro. Em pagamento misto, subtrair
          // o total da venda da gaveta inventaria um valor que nÃ£o entrou nela.
          // REGRESSÃƒO: sÃ³ estorna se o caixa estiver ABERTO. Caixa fechado nÃ£o
          // deve ter saldo alterado nem receber movimentaÃ§Ã£o SANGRIA automÃ¡tica.
          const caixaVenda = await tx.caixa.findUnique({ where: { id: venda.caixaId }, select: { status: true } });
          if (caixaVenda?.status === 'ABERTO') {
            await tx.caixa.update({ where: { id: venda.caixaId }, data: { saldo: { decrement: dinheiroEstornado } } });
            await tx.movimentacaoCaixa.create({ data: { caixaId: venda.caixaId, vendaId: id, tipo: 'SANGRIA', valor: dinheiroEstornado, motivo: motivoCancelamento, usuarioId: user.id, origem: 'AUTOMATICO' } });
          }
        }

        return vendaJaCancelada;
      });

      await registrarAuditoria({
        usuarioId: user.id, empresaId: user.empresaId, acao: 'EDITAR', entidade: 'Venda', entidadeId: id,
        valorNovo: vendaCancelada, origem: 'MANUAL', ip: req.ip,
        contexto: `Cancelamento transacional (${motivoCancelamento}). Estorno de estoque: ${body.estornarEstoque ? 'sim' : 'nÃ£o'}; estorno financeiro (financeiro, indicadores, metas, cliente e caixa): ${body.estornarFinanceiro ? 'sim' : 'nÃ£o'}.`,
      });
      return vendaCancelada;
    },
  );

  app.get(
    '/vendas/dashboard',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('vendas', 'visualizar')] },
    async (req: FastifyRequest) => {
      const user = (req as any).user;
      // `dias` alimenta o seletor Hoje / 7 dias / 30 dias do layout de
      // referÃªncia. Os campos antigos (faturamento/qtdVendas/ticketMedio/
      // indicadores/crescimento) continuam vindo exatamente iguais â€” a
      // resposta sÃ³ GANHOU campos, nunca perdeu.
      const { dias } = z
        .object({
          dias: z.coerce.number().int().refine((v) => [1, 7, 30].includes(v), 'Use 1, 7 ou 30 dias.').default(30),
        })
        .parse(req.query);

      const indicadores = await prisma.indicadorDiario.findMany({ where: { empresaId: user.empresaId }, orderBy: { data: 'desc' }, take: 30 });
      const faturamento = indicadores.reduce((s, i) => s + Number(i.faturamento), 0);
      const qtdVendas = indicadores.reduce((s, i) => s + i.qtdVendas, 0);
      const ticketMedio = qtdVendas ? faturamento / qtdVendas : 0;
      const [ultimo, anterior] = [indicadores[0], indicadores[1]];
      const crescimento = anterior && Number(anterior.faturamento) !== 0
        ? ((Number(ultimo?.faturamento || 0) - Number(anterior.faturamento)) / Number(anterior.faturamento)) * 100
        : 0;

      const hoje = new Date();
      const hojeUtc = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
      const inicioPeriodo = new Date(hojeUtc);
      inicioPeriodo.setUTCDate(inicioPeriodo.getUTCDate() - (dias - 1));
      // Janela anterior de mesmo tamanho: base real para os deltas dos KPIs.
      // A data do indicador Ã© gravada em UTC (meia-noite no banco), entÃ£o a
      // comparaÃ§Ã£o tambÃ©m precisa usar fronteira UTC â€” senÃ£o o dia local fica
      // deslocado por 3h/4h e o dashboard perde a venda do dia atual.
      const inicioAnterior = new Date(inicioPeriodo);
      inicioAnterior.setUTCDate(inicioAnterior.getUTCDate() - dias);

      const [indicadoresJanela, gruposPeriodo, gruposAnterior] = await Promise.all([
        prisma.indicadorDiario.findMany({ where: { empresaId: user.empresaId, data: { gte: inicioAnterior } } }),
        prisma.venda.groupBy({
          by: ['status'],
          where: { empresaId: user.empresaId, createdAt: { gte: inicioPeriodo } },
          _count: { _all: true },
        }),
        prisma.venda.groupBy({
          by: ['status'],
          where: { empresaId: user.empresaId, createdAt: { gte: inicioAnterior, lt: inicioPeriodo } },
          _count: { _all: true },
        }),
      ]);

      const somarJanela = (de: Date, ate: Date | null) => {
        const linhas = indicadoresJanela.filter((i) => i.data >= de && (!ate || i.data < ate));
        const bruto = linhas.reduce((s, i) => s + Number(i.faturamento), 0);
        const qtd = linhas.reduce((s, i) => s + i.qtdVendas, 0);
        return { faturamento: bruto, qtdVendas: qtd, ticketMedio: qtd ? bruto / qtd : 0 };
      };

      const periodo = somarJanela(inicioPeriodo, null);
      const periodoAnterior = somarJanela(inicioAnterior, inicioPeriodo);
      const porStatus = normalizarContagemPorStatus(gruposPeriodo);
      const porStatusAnterior = normalizarContagemPorStatus(gruposAnterior);
      const canceladasEstornos = contarCanceladasEstornos(porStatus);
      const faturamentoHoje = Number(indicadores.find((i) => i.data.getTime() === hojeUtc.getTime())?.faturamento ?? 0);

      return {
        faturamento,
        qtdVendas,
        ticketMedio,
        indicadores,
        crescimento,
        meta: null,
        dias,
        inicio: inicioPeriodo,
        fim: hojeUtc,
        faturamentoHoje,
        faturamentoPeriodo: periodo.faturamento,
        qtdVendasPeriodo: periodo.qtdVendas,
        ticketMedioPeriodo: periodo.ticketMedio,
        faturamentoAnterior: periodoAnterior.faturamento,
        ticketMedioAnterior: periodoAnterior.ticketMedio,
        crescimentoPeriodo: variacaoPercentual(periodo.faturamento, periodoAnterior.faturamento),
        crescimentoTicketMedio: variacaoPercentual(periodo.ticketMedio, periodoAnterior.ticketMedio),
        porStatus,
        porStatusAnterior,
        canceladasEstornos,
        crescimentoCanceladas: variacaoPercentual(canceladasEstornos, contarCanceladasEstornos(porStatusAnterior)),
      };
    },
  );
}