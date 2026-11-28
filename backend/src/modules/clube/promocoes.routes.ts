/**
 * NEXUS CLUB — Fase 7: promoções do clube.
 *
 * Loja (aba NEXUS CLUB → Promoções). Permissão de marketing do plano D.6: clientes:editar E
 * produtos:editar (mexe em preço). Ver: clientes:visualizar.
 *  GET  /clientes/clube/promocoes
 *  GET  /clientes/clube/promocoes/produtos?busca=
 *  POST /clientes/clube/promocoes                 (rascunho ou já publicada)
 *  PUT  /clientes/clube/promocoes/:id             (rascunho ou agendada)
 *  POST /clientes/clube/promocoes/:id/publicar | encerrar | cancelar
 * Regras ao publicar: produto ativo da empresa; preço "por" menor que o "de" (preço atual do
 * produto); nunca abaixo do custo; desconto dentro da alçada de quem publica (MESMAS faixas do
 * PDV: operador até 10%, supervisor até 30%, gerente acima); fim depois do início e no futuro.
 *
 * Cliente (app):
 *  GET  /club/clubes/:clube/promocoes             vitrine: promoções ativas que valem para a pessoa
 *
 * O preço que o cliente vê é calculado pela regra única (preco-clube.ts). No caixa, a promoção
 * passa a valer na etapa do PDV (Fase 9), com a mesma regra.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { temPermissao } from '../../lib/permissoes.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { comEmpresaDoConsumidor } from '../../lib/tenant-context.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { ALCADAS_DESCONTO } from '../vendas/vendas.routes.js';
import { linksDasFotos, VALIDADE_LINK_FICHA_S } from '../produtos/produto-foto.js';
import { autenticarConsumidor, exigirClube, type ConsumidorAutenticado } from './consumidor-auth.routes.js';
import { clubeVisivel, exigirMembro } from './area-cliente.routes.js';
import { percentualDesconto, precoComPromocao, situacaoPromocao, type PromocaoParaPreco } from './preco-clube.js';

const num = (v: unknown) => (v == null ? null : Number(v));

const corpoPromocao = z.object({
  produtoId: z.string().min(1),
  tipo: z.enum(['TODOS', 'MEMBROS']),
  precoPromocional: z.number().positive('Informe o preço promocional.').max(1_000_000),
  inicio: z.coerce.date(),
  fim: z.coerce.date(),
  filialIds: z.array(z.string().min(1)).max(200).optional(),
  limitePorCliente: z.number().int().min(1).max(9999).nullable().optional(),
  titulo: z.string().trim().max(80).nullable().optional(),
  descricao: z.string().trim().max(400).nullable().optional(),
});
type CorpoPromocao = z.infer<typeof corpoPromocao>;

function paraPreco(p: { id: string; tipo: any; status: any; precoPromocional: unknown; inicio: Date; fim: Date; todasFiliais: boolean; filiais?: Array<{ filialId: string }> }): PromocaoParaPreco {
  return { id: p.id, tipo: p.tipo, status: p.status, precoPromocional: Number(p.precoPromocional), inicio: p.inicio, fim: p.fim, todasFiliais: p.todasFiliais, filiais: (p.filiais ?? []).map((f) => f.filialId) };
}

/** Faixa de alçada exigida pelo % de desconto (mesmas faixas do PDV). */
async function conferirAlcada(usuarioId: string, pct: number) {
  const faixa = ALCADAS_DESCONTO.find((f) => pct <= f.ate) ?? ALCADAS_DESCONTO[ALCADAS_DESCONTO.length - 1];
  const ok = await prisma.permissao.findFirst({ where: { usuarioId, permitido: true, OR: faixa.permissoes }, select: { id: true } });
  if (!ok) throw new ErroDeNegocio(`Desconto de ${pct.toLocaleString('pt-BR')}% precisa de quem tem alçada de ${faixa.rotulo} (mesma regra de desconto do PDV).`, 403);
}

/** Valida produto, preços, custo, datas e filiais. Ao publicar, também a alçada e o período futuro. */
async function validar(empresaId: string, usuarioId: string, d: CorpoPromocao, publicar: boolean) {
  const produto = await prisma.produto.findFirst({ where: { id: d.produtoId, empresaId }, select: { id: true, nome: true, status: true, precoVenda: true, custo: true } });
  if (!produto) throw NaoEncontrado('Produto não encontrado nesta empresa.');
  if (d.fim <= d.inicio) throw new ErroDeNegocio('O fim precisa ser depois do início.', 400);
  const de = Number(produto.precoVenda);
  if (!(d.precoPromocional < de)) throw new ErroDeNegocio(`O preço promocional precisa ser menor que o preço atual (${de.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`, 400);
  const custo = Number(produto.custo ?? 0);
  if (custo > 0 && d.precoPromocional < custo) throw new ErroDeNegocio('O preço promocional fica abaixo do custo do produto: bloqueado.', 400);
  const filialIds = [...new Set(d.filialIds ?? [])];
  if (filialIds.length) {
    const n = await prisma.filial.count({ where: { empresaId, id: { in: filialIds } } });
    if (n !== filialIds.length) throw new ErroDeNegocio('Filial não encontrada nesta empresa.', 400);
  }
  if (publicar) {
    if (produto.status !== 'ATIVO') throw new ErroDeNegocio('O produto está inativo: ative-o antes de publicar a promoção.', 400);
    if (d.fim <= new Date()) throw new ErroDeNegocio('O fim da promoção já passou.', 400);
    await conferirAlcada(usuarioId, percentualDesconto(de, d.precoPromocional));
  }
  return { produto, filialIds };
}

export async function promocoesClubeRoutes(app: FastifyInstance): Promise<void> {
  const ver = [app.authenticate, await permissaoMiddleware('clientes', 'visualizar')];
  const marketing = [app.authenticate, await permissaoMiddleware('clientes', 'editar'), await permissaoMiddleware('produtos', 'editar')];
  const auditar = (req: FastifyRequest, id: string, contexto: string, valorNovo?: unknown) => registrarAuditoria({
    usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR', entidade: 'Promocao', entidadeId: id, origem: 'MANUAL', ip: req.ip, contexto, valorNovo: valorNovo as any,
  });

  app.get('/clientes/clube/promocoes', { preHandler: ver }, async (req) => {
    const lista = await prisma.promocao.findMany({
      where: { empresaId: req.user.empresaId }, orderBy: [{ fim: 'desc' }], take: 300,
      include: { produto: { select: { id: true, nome: true, precoVenda: true } }, filiais: { select: { filialId: true, filial: { select: { nome: true } } } } },
    });
    return lista.map((p) => {
      const de = Number(p.produto.precoVenda); const por = Number(p.precoPromocional);
      return {
        id: p.id, tipo: p.tipo, titulo: p.titulo, descricao: p.descricao, produto: { id: p.produto.id, nome: p.produto.nome },
        de, por, desconto: percentualDesconto(de, por), inicio: p.inicio, fim: p.fim, situacao: situacaoPromocao(paraPreco(p)),
        limitePorCliente: p.limitePorCliente, todasFiliais: p.todasFiliais, filiais: p.filiais.map((f) => ({ id: f.filialId, nome: f.filial.nome })),
      };
    });
  });

  app.get('/clientes/clube/promocoes/produtos', { preHandler: ver }, async (req) => {
    const { busca } = z.object({ busca: z.string().trim().min(2).max(80) }).parse(req.query);
    const empresaId = req.user.empresaId;
    const produtos = await prisma.produto.findMany({
      where: { empresaId, status: 'ATIVO', OR: [{ nome: { contains: busca, mode: 'insensitive' } }, { sku: { contains: busca, mode: 'insensitive' } }, { codigoBarras: busca }] },
      select: { id: true, nome: true, precoVenda: true, custo: true, unidade: true, imagemChave: true, imagem: true }, orderBy: { nome: 'asc' }, take: 20,
    });
    const [podeCusto, estoques, fotos] = await Promise.all([
      temPermissao(req.user.id, 'custos', 'visualizar'),
      prisma.estoque.groupBy({ by: ['produtoId'], where: { empresaId, produtoId: { in: produtos.map((p) => p.id) } }, _sum: { quantidade: true } }),
      linksDasFotos(empresaId, produtos.map((p) => p.imagemChave), VALIDADE_LINK_FICHA_S),
    ]);
    const est = new Map(estoques.map((e) => [e.produtoId, Number(e._sum.quantidade ?? 0)]));
    return produtos.map((p) => ({
      id: p.id, nome: p.nome, precoVenda: Number(p.precoVenda), unidade: p.unidade, estoque: est.get(p.id) ?? 0,
      foto: (p.imagemChave && fotos.get(p.imagemChave)?.miniatura) || p.imagem || null,
      ...(podeCusto ? { custo: num(p.custo) } : {}),
    }));
  });

  const salvar = (publicarAgora: boolean | 'corpo') => async (req: FastifyRequest) => {
    const empresaId = req.user.empresaId;
    const id = (req.params as { id?: string }).id;
    const d = corpoPromocao.extend({ publicar: z.boolean().optional() }).parse(req.body);
    const publicar = publicarAgora === 'corpo' ? !!d.publicar : publicarAgora;
    if (id) {
      const atual = await prisma.promocao.findFirst({ where: { id, empresaId } });
      if (!atual) throw NaoEncontrado('Promoção não encontrada.');
      const sit = situacaoPromocao(paraPreco({ ...atual, filiais: [] }));
      if (sit !== 'RASCUNHO' && sit !== 'AGENDADA') throw new ErroDeNegocio('Só dá para editar promoção em rascunho ou agendada (ainda não começou).', 409);
    }
    const { filialIds } = await validar(empresaId, req.user.id, d, publicar || (id ? (await prisma.promocao.findFirst({ where: { id, empresaId }, select: { status: true } }))?.status === 'PUBLICADA' : false));
    const dados = {
      produtoId: d.produtoId, tipo: d.tipo, precoPromocional: d.precoPromocional, inicio: d.inicio, fim: d.fim,
      limitePorCliente: d.limitePorCliente ?? null, titulo: d.titulo || null, descricao: d.descricao || null, todasFiliais: filialIds.length === 0,
      ...(publicar ? { status: 'PUBLICADA' as const, publicadoPorId: req.user.id, publicadaEm: new Date() } : {}),
    };
    const p = await prisma.$transaction(async (tx) => {
      const salvo = id
        ? await tx.promocao.update({ where: { id }, data: dados })
        : await tx.promocao.create({ data: { empresaId, criadoPorId: req.user.id, ...dados } });
      await tx.promocaoFilial.deleteMany({ where: { promocaoId: salvo.id } });
      if (filialIds.length) await tx.promocaoFilial.createMany({ data: filialIds.map((filialId) => ({ empresaId, promocaoId: salvo.id, filialId })) });
      return salvo;
    });
    await auditar(req, p.id, `NEXUS CLUB: promoção ${id ? 'editada' : 'criada'}${publicar ? ' e publicada' : ''}`, { produtoId: d.produtoId, tipo: d.tipo, precoPromocional: d.precoPromocional, inicio: d.inicio, fim: d.fim, filiais: filialIds.length || 'todas' });
    return { id: p.id, status: p.status };
  };
  app.post('/clientes/clube/promocoes', { preHandler: marketing }, salvar('corpo'));
  app.put('/clientes/clube/promocoes/:id', { preHandler: marketing }, salvar('corpo'));

  app.post('/clientes/clube/promocoes/:id/publicar', { preHandler: marketing }, async (req) => {
    const empresaId = req.user.empresaId;
    const p = await prisma.promocao.findFirst({ where: { id: (req.params as { id: string }).id, empresaId }, include: { filiais: true } });
    if (!p) throw NaoEncontrado('Promoção não encontrada.');
    if (p.status !== 'RASCUNHO') throw new ErroDeNegocio('Só promoção em rascunho pode ser publicada.', 409);
    await validar(empresaId, req.user.id, { produtoId: p.produtoId, tipo: p.tipo, precoPromocional: Number(p.precoPromocional), inicio: p.inicio, fim: p.fim, filialIds: p.filiais.map((f) => f.filialId) }, true);
    await prisma.promocao.update({ where: { id: p.id }, data: { status: 'PUBLICADA', publicadoPorId: req.user.id, publicadaEm: new Date() } });
    await auditar(req, p.id, 'NEXUS CLUB: promoção publicada');
    return { ok: true };
  });

  app.post('/clientes/clube/promocoes/:id/encerrar', { preHandler: marketing }, async (req) => {
    const p = await prisma.promocao.findFirst({ where: { id: (req.params as { id: string }).id, empresaId: req.user.empresaId } });
    if (!p) throw NaoEncontrado('Promoção não encontrada.');
    if (situacaoPromocao(paraPreco({ ...p, filiais: [] })) !== 'ATIVA') throw new ErroDeNegocio('Só promoção ativa pode ser encerrada. Agendada ou em rascunho: cancele.', 409);
    const agora = new Date();
    await prisma.promocao.update({ where: { id: p.id }, data: { status: 'ENCERRADA', encerradaEm: agora, fim: agora } });
    await auditar(req, p.id, 'NEXUS CLUB: promoção encerrada antes do fim');
    return { ok: true };
  });

  app.post('/clientes/clube/promocoes/:id/cancelar', { preHandler: marketing }, async (req) => {
    const p = await prisma.promocao.findFirst({ where: { id: (req.params as { id: string }).id, empresaId: req.user.empresaId } });
    if (!p) throw NaoEncontrado('Promoção não encontrada.');
    const sit = situacaoPromocao(paraPreco({ ...p, filiais: [] }));
    if (sit !== 'RASCUNHO' && sit !== 'AGENDADA') throw new ErroDeNegocio('Só rascunho ou promoção que ainda não começou pode ser cancelada. Ativa: encerre.', 409);
    await prisma.promocao.update({ where: { id: p.id }, data: { status: 'CANCELADA' } });
    await auditar(req, p.id, 'NEXUS CLUB: promoção cancelada');
    return { ok: true };
  });

  // ---------------------------------------------------------------- vitrine do cliente
  app.get('/club/clubes/:clube/promocoes', { preHandler: [exigirClube, autenticarConsumidor] }, async (req) => {
    const { id } = (req as any).consumidor as ConsumidorAutenticado;
    const clube = await clubeVisivel((req.params as { clube: string }).clube, id);
    const membro = await exigirMembro(id, clube.empresaId);
    return comEmpresaDoConsumidor(id, clube.empresaId, async () => {
      const agora = new Date();
      const promos = await prisma.promocao.findMany({
        where: { empresaId: clube.empresaId, status: 'PUBLICADA', inicio: { lte: agora }, fim: { gt: agora }, produto: { status: 'ATIVO' } },
        include: { produto: { select: { id: true, nome: true, precoVenda: true, unidade: true, imagemChave: true, imagem: true } }, filiais: { select: { filialId: true, filial: { select: { nome: true } } } } },
        orderBy: { fim: 'asc' }, take: 100,
      });
      const fotos = await linksDasFotos(clube.empresaId, promos.map((p) => p.produto.imagemChave), VALIDADE_LINK_FICHA_S);
      const ehMembro = membro.status === 'ATIVO' || membro.status === 'PENDENTE_VINCULO';
      return promos
        .map((p) => {
          const de = Number(p.produto.precoVenda);
          // Mesma regra do caixa: aqui sem filial escolhida, cada promoção vale nas filiais dela.
          const { preco, promocao } = precoComPromocao(de, [paraPreco(p)], { filialId: p.todasFiliais ? null : p.filiais[0]?.filialId, membro: ehMembro, agora });
          if (!promocao) return null;
          return {
            id: p.id, tipo: p.tipo, titulo: p.titulo, descricao: p.descricao,
            produto: { nome: p.produto.nome, unidade: p.produto.unidade, foto: (p.produto.imagemChave && fotos.get(p.produto.imagemChave)?.lista) || p.produto.imagem || null },
            de, por: preco, desconto: percentualDesconto(de, preco), fim: p.fim, limitePorCliente: p.limitePorCliente,
            filiais: p.todasFiliais ? null : p.filiais.map((f) => f.filial.nome),
          };
        })
        .filter((x): x is NonNullable<typeof x> => !!x);
    });
  });
}
