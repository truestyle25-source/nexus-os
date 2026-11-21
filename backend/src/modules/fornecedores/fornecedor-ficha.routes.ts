import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { temPermissao } from '../../lib/permissoes.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { createRateLimiter } from '../../middlewares/rateLimiter.js';
import { Conflito, ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import {
  TAMANHO_MAXIMO_BYTES, baixarObjeto, contentTypeDe, enviarObjeto, extensaoDe, montaChave, storageConfigurado, validaTamanho,
} from '../../lib/storage.js';
import {
  CAMPOS_BANCARIOS, atualizarFicha, codigoExibido, contatoSchema, criarFicha, diferencas, espelharContatoPrincipal,
  exigirPermissaoBancaria, fichaSchema, mascararBancario, situacaoValidade,
} from './fornecedor-ficha.service.js';

/**
 * Ficha completa do fornecedor (abas). Prefixo /api/v1/fornecedores/:id/... — as rotas de listagem,
 * KPIs e exportação continuam em fornecedores.routes.ts; as rotas legadas usadas por Compras, em
 * compras.routes.ts. Toda leitura/escrita é filtrada pela empresa do JWT (e pelo RLS no banco).
 */

const CAMPOS_AUDITADOS = Object.keys(fichaSchema.shape).filter((c) => c !== 'documento').concat(['cnpj']);
const TIPOS_DOCUMENTO = ['CARTAO_CNPJ', 'CONTRATO_SOCIAL', 'CERTIDAO', 'CONTRATO', 'TABELA_PRECOS', 'OUTRO'] as const;
const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));

/** Ids das compras do fornecedor (Financeiro guarda compraId sem relação no Prisma). */
async function idsDasCompras(empresaId: string, fornecedorId: string): Promise<string[]> {
  const compras = await prisma.compra.findMany({ where: { empresaId, fornecedorId }, select: { id: true } });
  return compras.map((c) => c.id);
}

async function fornecedorDaEmpresa(empresaId: string, id: string) {
  const f = await prisma.fornecedor.findFirst({ where: { id, empresaId }, select: { id: true, nome: true, status: true } });
  if (!f) throw NaoEncontrado('Fornecedor não encontrado nesta empresa.');
  return f;
}

async function auditar(req: FastifyRequest, fornecedorId: string, acao: 'CRIAR' | 'EDITAR' | 'EXCLUIR', contexto: string, valorAnterior?: unknown, valorNovo?: unknown) {
  await registrarAuditoria({
    usuarioId: req.user.id, empresaId: req.user.empresaId, acao, entidade: 'Fornecedor', entidadeId: fornecedorId,
    valorAnterior: valorAnterior as Prisma.InputJsonValue, valorNovo: valorNovo as Prisma.InputJsonValue,
    origem: 'MANUAL', ip: req.ip, contexto,
  });
}

/** Ficha completa: cadastro, contatos, resumo (pedidos, títulos, total comprado, nota) e rodapé de auditoria. */
async function montarFicha(req: FastifyRequest, id: string) {
  const empresaId = req.user.empresaId;
  const [podeBancario, podeFinanceiro] = await Promise.all([
    temPermissao(req.user.id, 'fornecedores', 'administrar'),
    temPermissao(req.user.id, 'financeiro', 'visualizar'),
  ]);
  const f = await prisma.fornecedor.findFirst({
    where: { id, empresaId },
    include: {
      contatos: { orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }] },
      filial: { select: { id: true, nome: true } },
      empresa: { select: { id: true, nome: true } },
      comprador: { select: { id: true, nome: true } },
      criadoPor: { select: { nome: true } },
      atualizadoPor: { select: { nome: true } },
    },
  });
  if (!f) throw NaoEncontrado('Fornecedor não encontrado nesta empresa.');
  const inicioAno = new Date(new Date().getFullYear(), 0, 1);
  const [pedidos, pedidosAbertos, totalAno, titulos, avaliacao] = await Promise.all([
    prisma.compra.count({ where: { empresaId, fornecedorId: id, status: { not: 'CANCELADA' } } }),
    prisma.compra.count({ where: { empresaId, fornecedorId: id, status: { in: ['SOLICITADA', 'PEDIDO'] } } }),
    prisma.compra.aggregate({ where: { empresaId, fornecedorId: id, status: { not: 'CANCELADA' }, dataCompra: { gte: inicioAno } }, _sum: { valorTotal: true } }),
    podeFinanceiro
      ? idsDasCompras(empresaId, id).then((ids) => prisma.financeiro.aggregate({ where: { empresaId, tipo: 'DESPESA', status: { in: ['PENDENTE', 'VENCIDO'] }, compraId: { in: ids } }, _sum: { valor: true }, _count: { _all: true } }))
      : Promise.resolve(null),
    prisma.fornecedorAvaliacao.aggregate({ where: { empresaId, fornecedorId: id }, _avg: { notaGeral: true }, _count: { _all: true } }),
  ]);
  const { criadoPor, atualizadoPor, empresa, ...cadastro } = f;
  return {
    fornecedor: {
      ...mascararBancario(cadastro, podeBancario),
      codigoExibido: codigoExibido(f.codigo),
      limiteCredito: num(f.limiteCredito),
      pedidoMinimo: num(f.pedidoMinimo),
      totalComprado: undefined, totalPedidos: undefined, ultimoPedidoAt: undefined,
    },
    empresa,
    podeVerBancario: podeBancario,
    podeVerFinanceiro: podeFinanceiro,
    recebePedidos: ['Ativo', 'Crítico'].includes(f.status),
    resumo: {
      pedidos, pedidosAbertos,
      totalCompradoAno: Number(totalAno._sum.valorTotal ?? 0), ano: inicioAno.getFullYear(),
      titulosAPagar: titulos ? { valor: Number(titulos._sum?.valor ?? 0), quantidade: typeof titulos._count === 'object' ? titulos._count._all ?? 0 : 0 } : null,
      notaMedia: avaliacao._avg.notaGeral == null ? null : Math.round(avaliacao._avg.notaGeral * 10) / 10,
      avaliacoes: avaliacao._count._all,
    },
    auditoria: {
      criadoPor: criadoPor?.nome ?? null, criadoEm: f.createdAt,
      atualizadoPor: atualizadoPor?.nome ?? null, atualizadoEm: f.updatedAt,
    },
  };
}

export async function fornecedorFichaRoutes(app: FastifyInstance): Promise<void> {
  const ver = [app.authenticate, await permissaoMiddleware('fornecedores', 'visualizar')];
  const editar = [app.authenticate, await permissaoMiddleware('fornecedores', 'editar')];
  const criar = [app.authenticate, await permissaoMiddleware('fornecedores', 'criar')];
  const cepLimiter = createRateLimiter(60, 60_000, { nome: 'cep' });

  // ------------------------------------------------------------------ CEP (ViaCEP pelo servidor)
  app.get('/api/v1/cep/:cep', { preHandler: [app.authenticate, cepLimiter] }, async (req) => {
    const cep = (req.params as { cep: string }).cep.replace(/\D/g, '');
    if (cep.length !== 8) throw new ErroDeNegocio('CEP deve ter 8 dígitos.', 400);
    let r: Response;
    try {
      r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(6000) });
    } catch {
      throw new ErroDeNegocio('Serviço de CEP indisponível no momento. Preencha o endereço manualmente.', 503);
    }
    if (!r.ok) throw new ErroDeNegocio('Serviço de CEP indisponível no momento. Preencha o endereço manualmente.', 503);
    const j = (await r.json()) as Record<string, string | boolean>;
    if (j.erro) throw NaoEncontrado('CEP não encontrado.');
    return {
      cep, logradouro: j.logradouro || '', complemento: j.complemento || '', bairro: j.bairro || '',
      cidade: j.localidade || '', uf: j.uf || '', codigoIbge: j.ibge || '',
    };
  });

  // ------------------------------------------------------------------ catálogos da ficha
  app.get('/api/v1/fornecedores/catalogos', { preHandler: ver }, async (req) => {
    const empresaId = req.user.empresaId;
    const [filiais, usuarios, categorias, empresa] = await Promise.all([
      prisma.filial.findMany({ where: { empresaId }, select: { id: true, nome: true, status: true }, orderBy: { nome: 'asc' } }),
      prisma.usuario.findMany({ where: { empresaId, status: 'ATIVO' }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
      prisma.fornecedor.findMany({ where: { empresaId }, distinct: ['categoria'], select: { categoria: true } }),
      prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nome: true } }),
    ]);
    const base = ['Matéria-prima', 'Insumos', 'Mercadorias para revenda', 'Embalagens', 'Serviços', 'Transporte', 'Malharia', 'Jeans', 'Bonés', 'Acessórios', 'Calçados', 'Outros'];
    return {
      filiais, compradores: usuarios, empresa,
      categorias: [...new Set([...base, ...categorias.map((c) => c.categoria)])],
      tiposDocumento: TIPOS_DOCUMENTO,
      storageConfigurado: storageConfigurado(),
      podeVerBancario: await temPermissao(req.user.id, 'fornecedores', 'administrar'),
    };
  });

  // ------------------------------------------------------------------ alertas de vencimento (todos os fornecedores)
  app.get('/api/v1/fornecedores/alertas-documentos', { preHandler: ver }, async (req) => {
    const empresaId = req.user.empresaId;
    const limite = new Date(Date.now() + 30 * 86_400_000);
    const [docs, certidoes] = await Promise.all([
      prisma.fornecedorDocumento.findMany({
        where: { empresaId, ativo: true, validade: { not: null, lte: limite } },
        select: { id: true, nome: true, tipo: true, validade: true, fornecedor: { select: { id: true, nome: true } } },
        orderBy: { validade: 'asc' }, take: 200,
      }),
      prisma.fornecedor.findMany({
        where: { empresaId, OR: [{ validadeCndFederal: { lte: limite } }, { validadeFgts: { lte: limite } }, { validadeCndt: { lte: limite } }] },
        select: { id: true, nome: true, validadeCndFederal: true, validadeFgts: true, validadeCndt: true },
      }),
    ]);
    const alertas = docs.map((d) => ({ fornecedorId: d.fornecedor.id, fornecedor: d.fornecedor.nome, documento: d.nome, tipo: d.tipo, validade: d.validade, situacao: situacaoValidade(d.validade) }));
    for (const f of certidoes) {
      for (const [campo, rotulo] of [['validadeCndFederal', 'CND federal'], ['validadeFgts', 'CRF do FGTS'], ['validadeCndt', 'Certidão trabalhista']] as const) {
        const v = f[campo];
        if (v && v <= limite) alertas.push({ fornecedorId: f.id, fornecedor: f.nome, documento: rotulo, tipo: 'CERTIDAO', validade: v, situacao: situacaoValidade(v) });
      }
    }
    return alertas.sort((a, b) => (a.validade!.getTime() - b.validade!.getTime()));
  });

  // ------------------------------------------------------------------ ficha
  app.get('/api/v1/fornecedores/:id/ficha', { preHandler: ver }, async (req) => montarFicha(req, (req.params as { id: string }).id));

  app.post('/api/v1/fornecedores/ficha', { preHandler: criar }, async (req, reply) => {
    const corpo = fichaSchema.extend({ contatos: z.array(contatoSchema).min(1, 'Cadastre ao menos um contato.').max(50) }).parse(req.body);
    const { contatos, ...dados } = corpo;
    exigirPermissaoBancaria(dados, await temPermissao(req.user.id, 'fornecedores', 'administrar'));
    const f = await criarFicha(req.user.empresaId, req.user.id, dados, contatos);
    await auditar(req, f.id, 'CRIAR', 'Cadastro de fornecedor (ficha)', undefined, { ...mascararBancario(f as unknown as Record<string, unknown>, false), contatos: contatos.length });
    return reply.status(201).send(await montarFicha(req, f.id));
  });

  app.put('/api/v1/fornecedores/:id/ficha', { preHandler: editar }, async (req) => {
    const { id } = req.params as { id: string };
    const dados = fichaSchema.parse(req.body);
    const podeBancario = await temPermissao(req.user.id, 'fornecedores', 'administrar');
    exigirPermissaoBancaria(dados, podeBancario);
    if (dados.status && !(await temPermissao(req.user.id, 'fornecedores', 'editar'))) throw new ErroDeNegocio('Sem permissão: fornecedores.editar', 403);
    const { anterior, atualizado } = await atualizarFicha(req.user.empresaId, req.user.id, id, dados);
    const mudancas = diferencas(anterior as unknown as Record<string, unknown>, atualizado as unknown as Record<string, unknown>, CAMPOS_AUDITADOS);
    if (mudancas.length) {
      const bancario = mudancas.some((m) => (CAMPOS_BANCARIOS as readonly string[]).includes(m.campo));
      await auditar(req, id, 'EDITAR', bancario ? 'Ficha do fornecedor (inclui dados bancários)' : 'Ficha do fornecedor', { alteracoes: mudancas.map((m) => ({ campo: m.campo, valor: m.anterior })) }, { alteracoes: mudancas });
    }
    return montarFicha(req, id);
  });

  // ------------------------------------------------------------------ contatos
  app.get('/api/v1/fornecedores/:id/contatos', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    await fornecedorDaEmpresa(req.user.empresaId, id);
    return prisma.fornecedorContato.findMany({ where: { empresaId: req.user.empresaId, fornecedorId: id }, orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }] });
  });

  app.post('/api/v1/fornecedores/:id/contatos', { preHandler: editar }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    await fornecedorDaEmpresa(empresaId, id);
    const c = contatoSchema.parse(req.body);
    const criado = await prisma.$transaction(async (tx) => {
      const existentes = await tx.fornecedorContato.count({ where: { empresaId, fornecedorId: id } });
      const principal = c.principal || existentes === 0;
      if (principal) await tx.fornecedorContato.updateMany({ where: { empresaId, fornecedorId: id }, data: { principal: false } });
      const novo = await tx.fornecedorContato.create({ data: { ...c, email: c.email || null, principal, empresaId, fornecedorId: id } });
      await espelharContatoPrincipal(tx, empresaId, id);
      await tx.fornecedor.update({ where: { id }, data: { atualizadoPorId: req.user.id } });
      return novo;
    });
    await auditar(req, id, 'CRIAR', 'Contatos', undefined, { contato: criado.nome, principal: criado.principal });
    return reply.status(201).send(criado);
  });

  app.put('/api/v1/fornecedores/:id/contatos/:contatoId', { preHandler: editar }, async (req) => {
    const { id, contatoId } = req.params as { id: string; contatoId: string };
    const empresaId = req.user.empresaId;
    const c = contatoSchema.partial().parse(req.body);
    const antes = await prisma.fornecedorContato.findFirst({ where: { id: contatoId, empresaId, fornecedorId: id } });
    if (!antes) throw NaoEncontrado('Contato não encontrado neste fornecedor.');
    if (c.principal === false && antes.principal) throw new ErroDeNegocio('Marque outro contato como principal em vez de desmarcar este.', 409);
    const depois = await prisma.$transaction(async (tx) => {
      if (c.principal) await tx.fornecedorContato.updateMany({ where: { empresaId, fornecedorId: id, NOT: { id: contatoId } }, data: { principal: false } });
      const atualizado = await tx.fornecedorContato.update({ where: { id: contatoId }, data: { ...c, ...(c.email !== undefined ? { email: c.email || null } : {}) } });
      await espelharContatoPrincipal(tx, empresaId, id);
      await tx.fornecedor.update({ where: { id }, data: { atualizadoPorId: req.user.id } });
      return atualizado;
    });
    await auditar(req, id, 'EDITAR', 'Contatos', { contato: antes.nome, alteracoes: diferencas(antes, depois, Object.keys(contatoSchema.shape)) }, undefined);
    return depois;
  });

  app.delete('/api/v1/fornecedores/:id/contatos/:contatoId', { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'excluir')] }, async (req) => {
    const { id, contatoId } = req.params as { id: string; contatoId: string };
    const empresaId = req.user.empresaId;
    const antes = await prisma.fornecedorContato.findFirst({ where: { id: contatoId, empresaId, fornecedorId: id } });
    if (!antes) throw NaoEncontrado('Contato não encontrado neste fornecedor.');
    const total = await prisma.fornecedorContato.count({ where: { empresaId, fornecedorId: id } });
    if (total <= 1) throw new ErroDeNegocio('O fornecedor precisa de ao menos um contato. Cadastre outro antes de excluir este.', 409);
    await prisma.$transaction(async (tx) => {
      await tx.fornecedorContato.delete({ where: { id: contatoId } });
      if (antes.principal) {
        const proximo = await tx.fornecedorContato.findFirst({ where: { empresaId, fornecedorId: id }, orderBy: { createdAt: 'asc' } });
        if (proximo) await tx.fornecedorContato.update({ where: { id: proximo.id }, data: { principal: true } });
      }
      await espelharContatoPrincipal(tx, empresaId, id);
      await tx.fornecedor.update({ where: { id }, data: { atualizadoPorId: req.user.id } });
    });
    await auditar(req, id, 'EXCLUIR', 'Contatos', { contato: antes.nome, cargo: antes.cargo, email: antes.email }, undefined);
    return { ok: true };
  });

  // ------------------------------------------------------------------ produtos do fornecedor
  const vinculoSchema = z.object({
    referencia: z.string().trim().max(60).nullable().optional(),
    codigoFornecedor: z.string().trim().max(60).nullable().optional(),
    descricaoComercial: z.string().trim().max(200).nullable().optional(),
    preco: z.number().finite().min(0).max(1e9).nullable().optional(),
    prazoEntregaDias: z.number().int().min(0).max(3650).nullable().optional(),
    pedidoMinimo: z.number().finite().min(0).max(1e9).nullable().optional(),
    status: z.enum(['ATIVO', 'SUSPENSO']).optional(),
    principal: z.boolean().optional(),
  });

  app.get('/api/v1/fornecedores/:id/produtos', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    await fornecedorDaEmpresa(empresaId, id);
    const q = z.object({
      busca: z.string().trim().max(80).optional(), categoriaId: z.string().optional(),
      situacao: z.enum(['TODOS', 'ATIVOS', 'INATIVOS']).default('TODOS'),
    }).parse(req.query);
    const podeCusto = await temPermissao(req.user.id, 'custos', 'visualizar');
    const vinculos = await prisma.fornecedorProduto.findMany({
      where: {
        empresaId, fornecedorId: id,
        ...(q.situacao === 'ATIVOS' ? { status: 'ATIVO', produto: { status: 'ATIVO' } } : q.situacao === 'INATIVOS' ? { OR: [{ status: 'SUSPENSO' }, { produto: { status: { not: 'ATIVO' } } }] } : {}),
        ...(q.categoriaId ? { produto: { categoriaId: q.categoriaId } } : {}),
        ...(q.busca ? { OR: [
          { produto: { nome: { contains: q.busca, mode: 'insensitive' } } }, { produto: { sku: { contains: q.busca, mode: 'insensitive' } } },
          { referencia: { contains: q.busca, mode: 'insensitive' } }, { codigoFornecedor: { contains: q.busca, mode: 'insensitive' } },
          { descricaoComercial: { contains: q.busca, mode: 'insensitive' } },
        ] } : {}),
      },
      include: {
        produto: {
          select: {
            id: true, nome: true, sku: true, status: true, unidade: true, ncm: true, unidadeBase: { select: { simbolo: true } },
            categoria: { select: { id: true, nome: true } }, fiscal: true, fornecedorId: true,
            fornecedoresVinculo: { select: { fornecedorId: true, principal: true, fornecedor: { select: { nome: true } } } },
          },
        },
      },
      orderBy: [{ principal: 'desc' }, { produto: { nome: 'asc' } }],
    });
    const itens = vinculos.map((v) => {
      const p = v.produto; const fi = p.fiscal;
      return {
        id: v.id, produtoId: p.id, codigoInterno: p.sku, nome: p.nome, produtoAtivo: p.status === 'ATIVO',
        referencia: v.referencia, codigoFornecedor: v.codigoFornecedor, descricaoComercial: v.descricaoComercial,
        categoria: p.categoria?.nome ?? null, categoriaId: p.categoria?.id ?? null, unidade: p.unidadeBase?.simbolo ?? p.unidade,
        // Fiscal: SEMPRE do cadastro central do produto (não é duplicado no vínculo).
        ncm: p.ncm ?? null, cest: fi?.cest ?? null, cfop: fi?.cfopEntrada ?? null, cstCsosn: fi?.csosn ?? fi?.cstIcms ?? null,
        origem: fi?.origemMercadoria ?? null,
        aliquotas: fi ? { icms: num(fi.aliquotaIcms), pis: num(fi.aliquotaPis), cofins: num(fi.aliquotaCofins), ipi: num(fi.aliquotaIpi) } : null,
        ...(podeCusto ? { preco: num(v.preco), ultimoPrecoCompra: num(v.ultimoPrecoCompra) } : {}),
        precoAtualizadoEm: v.precoAtualizadoEm, prazoEntregaDias: v.prazoEntregaDias, pedidoMinimo: num(v.pedidoMinimo),
        status: v.status, principal: v.principal,
        outrosFornecedores: p.fornecedoresVinculo.filter((o) => o.fornecedorId !== id).map((o) => ({ nome: o.fornecedor.nome, principal: o.principal })),
      };
    });
    return {
      itens,
      indicadores: {
        total: itens.length, ativos: itens.filter((i) => i.status === 'ATIVO' && i.produtoAtivo).length,
        principal: itens.filter((i) => i.principal).length, semPreco: podeCusto ? itens.filter((i) => i.preco == null).length : null,
      },
      podeVerCusto: podeCusto,
    };
  });

  app.get('/api/v1/fornecedores/:id/produtos/candidatos', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    await fornecedorDaEmpresa(empresaId, id);
    const { busca } = z.object({ busca: z.string().trim().max(80).optional() }).parse(req.query);
    const vinculados = await prisma.fornecedorProduto.findMany({ where: { empresaId, fornecedorId: id }, select: { produtoId: true } });
    return prisma.produto.findMany({
      where: {
        empresaId, status: { in: ['ATIVO', 'INATIVO'] }, id: { notIn: vinculados.map((v) => v.produtoId) },
        ...(busca ? { OR: [{ nome: { contains: busca, mode: 'insensitive' } }, { sku: { contains: busca, mode: 'insensitive' } }, { codigoBarras: { contains: busca } }, { referencia: { contains: busca, mode: 'insensitive' } }] } : {}),
      },
      select: { id: true, nome: true, sku: true, status: true, unidade: true, categoria: { select: { nome: true } } },
      orderBy: { nome: 'asc' }, take: 25,
    });
  });

  app.post('/api/v1/fornecedores/:id/produtos', { preHandler: editar }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    await fornecedorDaEmpresa(empresaId, id);
    const corpo = vinculoSchema.extend({ produtoId: z.string().min(1) }).parse(req.body);
    if (corpo.preco !== undefined && !(await temPermissao(req.user.id, 'custos', 'editar'))) throw new ErroDeNegocio('Sem permissão: custos.editar (preço do fornecedor).', 403);
    const produto = await prisma.produto.findFirst({ where: { id: corpo.produtoId, empresaId }, select: { id: true, nome: true } });
    if (!produto) throw NaoEncontrado('Produto não encontrado nesta empresa.');
    const existente = await prisma.fornecedorProduto.findFirst({ where: { fornecedorId: id, produtoId: corpo.produtoId } });
    if (existente) throw Conflito('Este produto já está vinculado a este fornecedor.');
    const criado = await prisma.$transaction(async (tx) => {
      const { produtoId, ...resto } = corpo;
      const v = await tx.fornecedorProduto.create({ data: { ...resto, empresaId, fornecedorId: id, produtoId, precoAtualizadoEm: corpo.preco != null ? new Date() : null, principal: false } });
      if (corpo.preco != null) await tx.fornecedorPrecoHistorico.create({ data: { empresaId, fornecedorId: id, produtoId, campo: 'PRECO', valorAnterior: null, valorNovo: corpo.preco, usuarioId: req.user.id } });
      if (corpo.principal) await definirPrincipal(tx, empresaId, id, produtoId);
      return v;
    });
    await auditar(req, id, 'CRIAR', 'Produtos do fornecedor', undefined, { produto: produto.nome, referencia: corpo.referencia ?? null, principal: !!corpo.principal });
    return reply.status(201).send(criado);
  });

  app.put('/api/v1/fornecedores/:id/produtos/:vinculoId', { preHandler: editar }, async (req) => {
    const { id, vinculoId } = req.params as { id: string; vinculoId: string };
    const empresaId = req.user.empresaId;
    const corpo = vinculoSchema.parse(req.body);
    if (corpo.preco !== undefined && !(await temPermissao(req.user.id, 'custos', 'editar'))) throw new ErroDeNegocio('Sem permissão: custos.editar (preço do fornecedor).', 403);
    const antes = await prisma.fornecedorProduto.findFirst({ where: { id: vinculoId, empresaId, fornecedorId: id }, include: { produto: { select: { nome: true } } } });
    if (!antes) throw NaoEncontrado('Vínculo não encontrado neste fornecedor.');
    const depois = await prisma.$transaction(async (tx) => {
      const precoMudou = corpo.preco !== undefined && num(antes.preco) !== corpo.preco;
      const { principal, ...resto } = corpo;
      const v = await tx.fornecedorProduto.update({ where: { id: vinculoId }, data: { ...resto, ...(precoMudou ? { precoAtualizadoEm: new Date() } : {}) } });
      if (precoMudou) await tx.fornecedorPrecoHistorico.create({ data: { empresaId, fornecedorId: id, produtoId: antes.produtoId, campo: 'PRECO', valorAnterior: antes.preco, valorNovo: corpo.preco, usuarioId: req.user.id } });
      if (principal === true) await definirPrincipal(tx, empresaId, id, antes.produtoId);
      if (principal === false && antes.principal) await removerPrincipal(tx, empresaId, id, antes.produtoId);
      return tx.fornecedorProduto.findUniqueOrThrow({ where: { id: v.id } });
    });
    await auditar(req, id, 'EDITAR', 'Produtos do fornecedor', { produto: antes.produto.nome, alteracoes: diferencas(antes, depois, Object.keys(vinculoSchema.shape)) }, undefined);
    return depois;
  });

  app.delete('/api/v1/fornecedores/:id/produtos/:vinculoId', { preHandler: editar }, async (req) => {
    const { id, vinculoId } = req.params as { id: string; vinculoId: string };
    const empresaId = req.user.empresaId;
    const antes = await prisma.fornecedorProduto.findFirst({ where: { id: vinculoId, empresaId, fornecedorId: id }, include: { produto: { select: { nome: true } } } });
    if (!antes) throw NaoEncontrado('Vínculo não encontrado neste fornecedor.');
    // Remove SÓ o vínculo: o produto continua no catálogo e no estoque; o histórico de preços fica.
    await prisma.$transaction(async (tx) => {
      if (antes.principal) await removerPrincipal(tx, empresaId, id, antes.produtoId);
      await tx.fornecedorProduto.delete({ where: { id: vinculoId } });
    });
    await auditar(req, id, 'EXCLUIR', 'Produtos do fornecedor', { produto: antes.produto.nome, referencia: antes.referencia, preco: num(antes.preco) }, undefined);
    return { ok: true };
  });

  app.get('/api/v1/fornecedores/:id/produtos/:produtoId/precos', { preHandler: ver }, async (req) => {
    const { id, produtoId } = req.params as { id: string; produtoId: string };
    await fornecedorDaEmpresa(req.user.empresaId, id);
    if (!(await temPermissao(req.user.id, 'custos', 'visualizar'))) throw new ErroDeNegocio('Sem permissão: custos.visualizar', 403);
    const linhas = await prisma.fornecedorPrecoHistorico.findMany({
      where: { empresaId: req.user.empresaId, fornecedorId: id, produtoId }, orderBy: { createdAt: 'desc' }, take: 200,
      include: { usuario: { select: { nome: true } } },
    });
    return linhas.map((l) => ({ id: l.id, data: l.createdAt, campo: l.campo, anterior: num(l.valorAnterior), novo: num(l.valorNovo), origem: l.origem, documento: l.documento, usuario: l.usuario?.nome ?? null }));
  });

  app.get('/api/v1/fornecedores/:id/produtos/exportar', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    const f = await fornecedorDaEmpresa(req.user.empresaId, id);
    const podeCusto = await temPermissao(req.user.id, 'custos', 'visualizar');
    const vinculos = await prisma.fornecedorProduto.findMany({
      where: { empresaId: req.user.empresaId, fornecedorId: id },
      include: { produto: { select: { nome: true, sku: true, unidade: true, status: true, categoria: { select: { nome: true } }, ncm: true } } },
      orderBy: { produto: { nome: 'asc' } },
    });
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const cab = ['Código interno', 'Produto', 'Referência fornecedor', 'Código no fornecedor', 'Categoria', 'Unidade', 'NCM', ...(podeCusto ? ['Preço', 'Último preço de compra'] : []), 'Prazo (dias)', 'Pedido mínimo', 'Status', 'Principal'];
    const linhas = vinculos.map((v) => [v.produto.sku, v.produto.nome, v.referencia, v.codigoFornecedor, v.produto.categoria?.nome, v.produto.unidade, v.produto.ncm,
      ...(podeCusto ? [num(v.preco), num(v.ultimoPrecoCompra)] : []), v.prazoEntregaDias, num(v.pedidoMinimo), v.status, v.principal ? 'Sim' : 'Não'].map(esc).join(';'));
    const csv = '﻿' + [cab.join(';'), ...linhas].join('\n');
    return { nome: `produtos-${f.nome.replace(/[^\w]+/g, '-').toLowerCase()}.csv`, mime: 'text/csv', base64: Buffer.from(csv, 'utf8').toString('base64') };
  });

  // ------------------------------------------------------------------ avaliação / qualidade
  app.get('/api/v1/fornecedores/:id/avaliacoes', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const f = await prisma.fornecedor.findFirst({ where: { id, empresaId }, select: { prazoEntregaDias: true } });
    if (!f) throw NaoEncontrado('Fornecedor não encontrado nesta empresa.');
    const [avaliacoes, recebidas] = await Promise.all([
      prisma.fornecedorAvaliacao.findMany({ where: { empresaId, fornecedorId: id }, orderBy: { createdAt: 'desc' }, take: 100, include: { usuario: { select: { nome: true } } } }),
      prisma.compra.findMany({ where: { empresaId, fornecedorId: id, status: 'RECEBIDA', dataRecebimento: { not: null } }, select: { dataCompra: true, dataRecebimento: true }, orderBy: { dataCompra: 'desc' }, take: 200 }),
    ]);
    const media = (k: 'notaGeral' | 'pontualidade' | 'qualidade' | 'preco') => {
      const v = avaliacoes.map((a) => a[k]).filter((x): x is number => x != null);
      return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
    };
    // Indicador automático: só com histórico suficiente (≥ 3 compras recebidas) e prazo cadastrado.
    const MIN = 3;
    const dias = recebidas.map((c) => (c.dataRecebimento!.getTime() - c.dataCompra.getTime()) / 86_400_000);
    const indicadores = recebidas.length >= MIN ? {
      comprasRecebidas: recebidas.length,
      prazoMedioDias: Math.round((dias.reduce((s, d) => s + d, 0) / dias.length) * 10) / 10,
      noPrazoPercentual: f.prazoEntregaDias != null ? Math.round((dias.filter((d) => d <= f.prazoEntregaDias! + 1e-9).length / dias.length) * 1000) / 10 : null,
    } : null;
    return {
      medias: { notaGeral: media('notaGeral'), pontualidade: media('pontualidade'), qualidade: media('qualidade'), preco: media('preco') },
      indicadores, minimoParaIndicadores: MIN,
      historico: avaliacoes.map((a) => ({ id: a.id, data: a.createdAt, notaGeral: a.notaGeral, pontualidade: a.pontualidade, qualidade: a.qualidade, preco: a.preco, comentario: a.comentario, usuario: a.usuario?.nome ?? null })),
    };
  });

  app.post('/api/v1/fornecedores/:id/avaliacoes', { preHandler: editar }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await fornecedorDaEmpresa(req.user.empresaId, id);
    const nota = z.number().int().min(1).max(5);
    const corpo = z.object({ notaGeral: nota, pontualidade: nota.nullable().optional(), qualidade: nota.nullable().optional(), preco: nota.nullable().optional(), comentario: z.string().trim().max(1000).nullable().optional() }).parse(req.body);
    const a = await prisma.fornecedorAvaliacao.create({ data: { ...corpo, empresaId: req.user.empresaId, fornecedorId: id, usuarioId: req.user.id } });
    await auditar(req, id, 'CRIAR', 'Avaliação', undefined, corpo);
    return reply.status(201).send(a);
  });

  // ------------------------------------------------------------------ documentos e anexos
  app.get('/api/v1/fornecedores/:id/documentos', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    await fornecedorDaEmpresa(req.user.empresaId, id);
    const q = z.object({ incluirRemovidos: z.coerce.boolean().default(false) }).parse(req.query);
    const docs = await prisma.fornecedorDocumento.findMany({
      where: { empresaId: req.user.empresaId, fornecedorId: id, ...(q.incluirRemovidos ? {} : { ativo: true }) },
      orderBy: { createdAt: 'desc' }, include: { enviadoPor: { select: { nome: true } } },
    });
    return {
      storageConfigurado: storageConfigurado(),
      itens: docs.map((d) => ({
        id: d.id, tipo: d.tipo, nome: d.nome, arquivoNome: d.arquivoNome, tamanhoBytes: d.tamanhoBytes, temArquivo: !!d.arquivoChave,
        validade: d.validade, situacao: d.ativo ? situacaoValidade(d.validade) : 'REMOVIDO', ativo: d.ativo,
        enviadoPor: d.enviadoPor?.nome ?? null, enviadoEm: d.createdAt, atualizadoEm: d.updatedAt,
      })),
    };
  });

  app.post('/api/v1/fornecedores/:id/documentos', { preHandler: editar }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    await fornecedorDaEmpresa(empresaId, id);
    const corpo = z.object({
      tipo: z.enum(TIPOS_DOCUMENTO), nome: z.string().trim().min(2).max(160),
      validade: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      arquivo: z.object({ nome: z.string().trim().min(1).max(200), base64: z.string().min(1) }),
    }).parse(req.body);
    if (!storageConfigurado()) throw new ErroDeNegocio('Armazenamento de arquivos não configurado (STORAGE_BUCKET). Configure o storage para anexar documentos.', 503);
    const buffer = Buffer.from(corpo.arquivo.base64, 'base64');
    validaTamanho(buffer.length);
    const ext = extensaoDe(corpo.arquivo.nome);
    if (!['pdf', 'png', 'jpg', 'jpeg', 'webp', 'xlsx', 'xls', 'csv', 'doc', 'docx'].includes(ext)) throw new ErroDeNegocio('Tipo de arquivo não permitido. Use PDF, imagem, planilha ou documento.', 400);
    const chave = montaChave(empresaId, 'fornecedor-documento', ext);
    const contentType = contentTypeDe(corpo.arquivo.nome);
    await enviarObjeto(chave, buffer, contentType);
    const d = await prisma.fornecedorDocumento.create({
      data: { empresaId, fornecedorId: id, tipo: corpo.tipo, nome: corpo.nome, validade: corpo.validade ? new Date(corpo.validade) : null,
        arquivoChave: chave, arquivoNome: corpo.arquivo.nome, contentType, tamanhoBytes: buffer.length, enviadoPorId: req.user.id },
    });
    await auditar(req, id, 'CRIAR', 'Documentos e anexos', undefined, { documento: d.nome, tipo: d.tipo, validade: d.validade, arquivo: d.arquivoNome });
    return reply.status(201).send({ id: d.id });
  });

  app.put('/api/v1/fornecedores/:id/documentos/:docId', { preHandler: editar }, async (req) => {
    const { id, docId } = req.params as { id: string; docId: string };
    const corpo = z.object({ nome: z.string().trim().min(2).max(160).optional(), tipo: z.enum(TIPOS_DOCUMENTO).optional(), validade: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(req.body);
    const antes = await prisma.fornecedorDocumento.findFirst({ where: { id: docId, empresaId: req.user.empresaId, fornecedorId: id, ativo: true } });
    if (!antes) throw NaoEncontrado('Documento não encontrado.');
    const depois = await prisma.fornecedorDocumento.update({ where: { id: docId }, data: { ...corpo, ...(corpo.validade !== undefined ? { validade: corpo.validade ? new Date(corpo.validade) : null } : {}) } });
    await auditar(req, id, 'EDITAR', 'Documentos e anexos', { documento: antes.nome, alteracoes: diferencas(antes, depois, ['nome', 'tipo', 'validade']) }, undefined);
    return { ok: true };
  });

  app.delete('/api/v1/fornecedores/:id/documentos/:docId', { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'excluir')] }, async (req) => {
    const { id, docId } = req.params as { id: string; docId: string };
    const antes = await prisma.fornecedorDocumento.findFirst({ where: { id: docId, empresaId: req.user.empresaId, fornecedorId: id, ativo: true } });
    if (!antes) throw NaoEncontrado('Documento não encontrado.');
    // Remoção lógica: o registro e o arquivo ficam para o histórico de atualização.
    await prisma.fornecedorDocumento.update({ where: { id: docId }, data: { ativo: false } });
    await auditar(req, id, 'EXCLUIR', 'Documentos e anexos', { documento: antes.nome, tipo: antes.tipo }, undefined);
    return { ok: true };
  });

  app.get('/api/v1/fornecedores/:id/documentos/:docId/arquivo', { preHandler: ver }, async (req) => {
    const { id, docId } = req.params as { id: string; docId: string };
    const d = await prisma.fornecedorDocumento.findFirst({ where: { id: docId, empresaId: req.user.empresaId, fornecedorId: id } });
    if (!d?.arquivoChave) throw NaoEncontrado('Arquivo não encontrado.');
    const { corpo, contentType } = await baixarObjeto(d.arquivoChave);
    return { nome: d.arquivoNome ?? d.nome, mime: contentType, base64: corpo.toString('base64') };
  });

  // ------------------------------------------------------------------ histórico / movimentações (somente leitura)
  app.get('/api/v1/fornecedores/:id/historico', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    await fornecedorDaEmpresa(empresaId, id);
    const q = z.object({ de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    const de = q.de ? new Date(`${q.de}T00:00:00`) : new Date(new Date().getFullYear(), 0, 1);
    const ate = q.ate ? new Date(`${q.ate}T23:59:59.999`) : new Date();
    const podeFinanceiro = await temPermissao(req.user.id, 'financeiro', 'visualizar');
    const [compras, totalPeriodo, porStatus, titulos, alteracoes] = await Promise.all([
      prisma.compra.findMany({
        where: { empresaId, fornecedorId: id }, orderBy: { dataCompra: 'desc' }, take: 50,
        select: { id: true, status: true, valorTotal: true, dataCompra: true, dataRecebimento: true, filial: { select: { nome: true } } },
      }),
      prisma.compra.aggregate({ where: { empresaId, fornecedorId: id, status: { not: 'CANCELADA' }, dataCompra: { gte: de, lte: ate } }, _sum: { valorTotal: true }, _count: { _all: true } }),
      prisma.compra.groupBy({ by: ['status'], where: { empresaId, fornecedorId: id }, _count: { _all: true }, _sum: { valorTotal: true } }),
      podeFinanceiro
        ? prisma.financeiro.findMany({
            where: { empresaId, tipo: 'DESPESA', compraId: { in: await idsDasCompras(empresaId, id) } }, orderBy: [{ vencimento: 'asc' }, { createdAt: 'desc' }], take: 100,
            select: { id: true, descricao: true, valor: true, vencimento: true, status: true, compraId: true, createdAt: true },
          })
        : Promise.resolve(null),
      prisma.auditoria.findMany({
        where: { empresaId, entidade: 'Fornecedor', entidadeId: id }, orderBy: { createdAt: 'desc' }, take: 100,
        select: { id: true, acao: true, contexto: true, valorAnterior: true, valorNovo: true, createdAt: true, usuario: { select: { nome: true } } },
      }),
    ]);
    const grupo = (s: string) => porStatus.find((p) => p.status === s);
    return {
      periodo: { de, ate },
      totais: {
        compradoNoPeriodo: Number(totalPeriodo._sum.valorTotal ?? 0), pedidosNoPeriodo: totalPeriodo._count._all,
        pendentes: (grupo('SOLICITADA')?._count._all ?? 0) + (grupo('PEDIDO')?._count._all ?? 0),
        entregues: grupo('RECEBIDA')?._count._all ?? 0, cancelados: grupo('CANCELADA')?._count._all ?? 0,
      },
      pedidos: compras.map((c) => ({ id: c.id, status: c.status, valor: Number(c.valorTotal), data: c.dataCompra, recebidoEm: c.dataRecebimento, filial: c.filial?.nome ?? null })),
      financeiro: titulos === null ? null : {
        emAberto: titulos.filter((t) => t.status === 'PENDENTE' || t.status === 'VENCIDO').map((t) => ({ ...t, valor: Number(t.valor) })),
        pagos: titulos.filter((t) => t.status === 'PAGO').map((t) => ({ ...t, valor: Number(t.valor) })),
      },
      alteracoes: alteracoes.flatMap((a): Array<{ id: string; data: Date; usuario: string | null; acao: string; aba: string | null; campo: string | null; anterior: unknown; novo: unknown }> => {
        const novo = (a.valorNovo ?? {}) as { alteracoes?: Array<{ campo: string; anterior: unknown; novo: unknown }> };
        const base = { id: a.id, data: a.createdAt, usuario: a.usuario?.nome ?? null, acao: a.acao, aba: a.contexto };
        if (Array.isArray(novo.alteracoes) && novo.alteracoes.length) return novo.alteracoes.map((m, i) => ({ ...base, id: `${a.id}-${i}`, campo: m.campo, anterior: m.anterior, novo: m.novo }));
        const ant = (a.valorAnterior ?? {}) as Record<string, unknown>;
        if (Array.isArray(ant.alteracoes) && (ant.alteracoes as unknown[]).length && 'novo' in ((ant.alteracoes as Array<Record<string, unknown>>)[0] ?? {})) {
          return (ant.alteracoes as Array<{ campo: string; anterior: unknown; novo: unknown }>).map((m, i) => ({ ...base, id: `${a.id}-${i}`, campo: m.campo, anterior: m.anterior, novo: m.novo }));
        }
        return [{ ...base, campo: null, anterior: a.valorAnterior, novo: a.valorNovo }];
      }),
    };
  });
}

/** Marca este fornecedor como principal do produto (único) e espelha em Produto.fornecedorId. */
async function definirPrincipal(tx: Prisma.TransactionClient, empresaId: string, fornecedorId: string, produtoId: string) {
  await tx.fornecedorProduto.updateMany({ where: { empresaId, produtoId, NOT: { fornecedorId } }, data: { principal: false } });
  await tx.fornecedorProduto.updateMany({ where: { empresaId, produtoId, fornecedorId }, data: { principal: true } });
  await tx.produto.update({ where: { id: produtoId }, data: { fornecedorId } });
}

async function removerPrincipal(tx: Prisma.TransactionClient, empresaId: string, fornecedorId: string, produtoId: string) {
  await tx.fornecedorProduto.updateMany({ where: { empresaId, produtoId, fornecedorId }, data: { principal: false } });
  await tx.produto.updateMany({ where: { id: produtoId, empresaId, fornecedorId }, data: { fornecedorId: null } });
}

export { TAMANHO_MAXIMO_BYTES };
