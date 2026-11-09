import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { ErroDeNegocio } from '../../lib/erros.js';
import {
  aceitaContagem, podeMudarStatus, classificarDivergencia,
  resumirSessao, validarContagem, validarAbertura,
} from './inventario.js';

/**
 * ROTAS — SESSÃO DE INVENTÁRIO (Ciclo 6)
 * ========================================
 *
 * O QUE ESTAS ROTAS FAZEM
 * ----------------------
 * 1. abrem uma folha, congelando o saldo do sistema daquele instante;
 * 2. guardam a contagem item a item, com QUEM e QUANDO;
 * 3. permitem retomar uma folha aberta em outro dia;
 * 4. fecham a folha, recusando se sobrar item sem contar;
 * 5. listam o histórico, com autor e data de cada uma.
 *
 * O QUE ELAS NÃO FAZEM — E POR QUÊ
 * ---------------------------------
 * Não aplicam a diferença no estoque. Um inventário acha desvio; corrigir o
 * saldo é decisão da empresa, e ela passa por um movimento de inventário no
 * botão de ações, com motivo e auditoria. Se a rota ajustasse o estoque sozinha,
 * fechar a folha viraria um ajuste em massa sem que ninguém tivesse olhado a
 * diferença.
 *
 * MULTI-TENANT
 * ------------
 * `empresaDoRequisicao(req)` na primeira linha e `empresaId` em toda consulta.
 *
 * PERMISSÃO
 * ---------
 * Ler: `estoque:visualizar`. Abrir e contar: `estoque:criar`. Fechar ou
 * cancelar: `estoque:administrar` — encerrar uma folha muda o histórico e não
 * é a mesma coisa que preenchê-la.
 */

function empresaDoRequisicao(req: FastifyRequest): string {
  const empresaId = (req as any).user?.empresaId;
  if (!empresaId) throw new ErroDeNegocio('Empresa não identificada.', 401);
  return empresaId;
}

const criarSchema = z.object({
  nome: z.string().min(2, 'Dê um nome à contagem.').max(160),
  filialId: z.string().min(1, 'Escolha a filial.'),
  cegas: z.boolean().default(true),
  observacoes: z.string().max(2000).optional().nullable(),
});

const contarSchema = z.object({
  contagens: z.array(z.object({
    estoqueId: z.string().min(1),
    quantidade: z.number().finite().nullable(),
    observacoes: z.string().max(500).optional().nullable(),
  })).min(1, 'Envie ao menos um item.'),
});

const fecharSchema = z.object({
  status: z.enum(['CONCLUIDA', 'CANCELADA']),
  observacoes: z.string().max(2000).optional().nullable(),
});

/** Carrega a sessão com a folha, sempre filtrada pela empresa do token. */
async function carregarSessao(empresaId: string, id: string) {
  return prisma.sessaoInventario.findFirst({
    where: { id, empresaId },
    include: {
      filial: { select: { id: true, nome: true } },
      criadoPor: { select: { id: true, nome: true } },
      concluidoPor: { select: { id: true, nome: true } },
      contagens: { orderBy: { produtoNome: 'asc' }, include: { contadoPor: { select: { id: true, nome: true } } } },
    },
  });
}

function paraSessaoDTO(s: any) {
  const contagens = (s.contagens ?? []).map((c: any) => ({
    id: c.id,
    estoqueId: c.estoqueId,
    produtoId: c.produtoId,
    produtoNome: c.produtoNome,
    unidade: c.unidade,
    local: c.local,
    quantidadeSistema: c.quantidadeSistema,
    quantidadeContada: c.quantidadeContada,
    contadoPor: c.contadoPor?.nome ?? null,
    contadoEm: c.contadoEm ? c.contadoEm.toISOString() : null,
    observacoes: c.observacoes,
    divergencia: classificarDivergencia(c.quantidadeSistema, c.quantidadeContada),
  }));
  return {
    id: s.id,
    nome: s.nome,
    status: s.status,
    cegas: s.cegas,
    filial: s.filial ?? null,
    criadoPor: s.criadoPor?.nome ?? null,
    criadoEm: s.criadoEm.toISOString(),
    concluidoPor: s.concluidoPor?.nome ?? null,
    concluidoEm: s.concluidoEm ? s.concluidoEm.toISOString() : null,
    observacoes: s.observacoes,
    contagens,
    resumo: resumirSessao(s.contagens ?? []),
  };
}

export async function inventarioRoutes(app: FastifyInstance): Promise<void> {
  const leitura = {
    preHandler: [(app as any).authenticate, await permissaoMiddleware('estoque', 'visualizar')],
  };
  const escrita = {
    preHandler: [(app as any).authenticate, await permissaoMiddleware('estoque', 'criar')],
  };
  const fechar = {
    preHandler: [(app as any).authenticate, await permissaoMiddleware('estoque', 'administrar')],
  };

  /** GET /estoque/inventarios — histórico, com as abertas em destaque. */
  app.get('/estoque/inventarios', leitura, async (req: any) => {
    const empresaId = empresaDoRequisicao(req);
    const sessoes = await prisma.sessaoInventario.findMany({
      where: { empresaId },
      include: {
        filial: { select: { id: true, nome: true } },
        criadoPor: { select: { id: true, nome: true } },
        concluidoPor: { select: { id: true, nome: true } },
        contagens: { select: { quantidadeSistema: true, quantidadeContada: true } },
      },
      orderBy: { criadoEm: 'desc' },
      take: 60,
    });
    return {
      sessoes: sessoes.map((s: any) => ({
        id: s.id,
        nome: s.nome,
        status: s.status,
        cegas: s.cegas,
        filial: s.filial ?? null,
        criadoPor: s.criadoPor?.nome ?? null,
        criadoEm: s.criadoEm.toISOString(),
        concluidoPor: s.concluidoPor?.nome ?? null,
        concluidoEm: s.concluidoEm ? s.concluidoEm.toISOString() : null,
        observacoes: s.observacoes,
        resumo: resumirSessao(s.contagens ?? []),
      })),
      abertas: sessoes.filter((s: any) => s.status === 'ABERTA').length,
    };
  });

  /**
   * POST /estoque/inventarios — abre a folha.
   *
   * O saldo é lido e gravado CONGELADO em `quantidadeSistema`. É o que permite
   * retomar a contagem amanhã: a folha carrega o número daquele dia, e a
   * divergência continua significando a mesma coisa mesmo que o estoque mude
   * no meio do caminho.
   */
  app.post('/estoque/inventarios', escrita, async (req: any) => {
    const empresaId = empresaDoRequisicao(req);
    const b = criarSchema.parse(req.body ?? {});

    const filial = await prisma.filial.findFirst({
      where: { id: b.filialId, empresaId },
      select: { id: true, nome: true },
    });
    if (!filial) throw new ErroDeNegocio('Filial não encontrada nesta empresa.', 404);

    const estoques = await prisma.estoque.findMany({
      where: { empresaId, filialId: filial.id },
      include: { produto: { select: { id: true, nome: true, unidade: true } } },
      orderBy: { produto: { nome: 'asc' } },
    });
    const abertas = await prisma.sessaoInventario.count({
      where: { empresaId, filialId: filial.id, status: 'ABERTA' },
    });
    const erros = validarAbertura({
      nome: b.nome, filialId: b.filialId, itensNaFilial: estoques.length, sessoesAbertasNaFilial: abertas,
    });
    if (erros.length > 0) throw new ErroDeNegocio(erros[0], 422);

    const agora = new Date();
    const sessao = await prisma.$transaction(async (tx) => {
      const nova = await tx.sessaoInventario.create({
        data: {
          empresaId, nome: b.nome.trim(), filialId: filial.id,
          cegas: b.cegas, criadoPorId: req.user.id, criadoEm: agora,
          observacoes: b.observacoes ?? null,
        },
      });
      // createMany e não um create por item: a folha de um depósito grande
      // passa de mil linhas, e abrir transação por linha é lentíssimo.
      if (estoques.length > 0) {
        await tx.contagemInventario.createMany({
          data: estoques.map((e) => ({
            empresaId,
            sessaoId: nova.id,
            estoqueId: e.id,
            produtoId: e.produtoId,
            produtoNome: e.produto.nome,
            unidade: e.produto.unidade ?? null,
            local: e.local ?? null,
            quantidadeSistema: e.quantidade,
          })),
        });
      }
      return nova;
    });

    await registrarAuditoria({
      usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'SessaoInventario', entidadeId: sessao.id,
      valorNovo: { nome: sessao.nome, filial: filial.nome, cegas: sessao.cegas, itens: estoques.length },
      origem: 'MANUAL', ip: req.ip,
      contexto: `Inventario "${sessao.nome}" aberto em ${filial.nome} com ${estoques.length} item(ns)${sessao.cegas ? ' em visao cega' : ''}.`,
    });

    const completa = await carregarSessao(empresaId, sessao.id);
    return { sessao: paraSessaoDTO(completa) };
  });


  /** GET /estoque/inventarios/:id - retomar uma folha aberta. */
  app.get('/estoque/inventarios/:id', leitura, async (req: any) => {
    const empresaId = empresaDoRequisicao(req);
    const s = await carregarSessao(empresaId, req.params.id);
    if (!s) throw new ErroDeNegocio('Contagem nao encontrada nesta empresa.', 404);
    return { sessao: paraSessaoDTO(s) };
  });

  /**
   * PUT /estoque/inventarios/:id/contagens - grava a contagem dos itens.
   *
   * Aceita `null` de proposito: quem esta no meio da contagem precisa voltar a
   * um item e deixar 'ainda nao contei'. E o que mantem NULL != ZERO.
   */
  app.put('/estoque/inventarios/:id/contagens', escrita, async (req: any) => {
    const empresaId = empresaDoRequisicao(req);
    const b = contarSchema.parse(req.body ?? {});
    const sessao = await prisma.sessaoInventario.findFirst({
      where: { id: req.params.id, empresaId },
      select: { id: true, status: true, nome: true },
    });
    if (!sessao) throw new ErroDeNegocio('Contagem nao encontrada nesta empresa.', 404);
    if (!aceitaContagem(sessao.status)) {
      throw new ErroDeNegocio(`Esta contagem esta ${sessao.status === 'CONCLUIDA' ? 'concluida' : 'cancelada'} e nao aceita mais lancamentos.`, 409);
    }

    // Valida ANTES de gravar: uma folha com meia contagem salva e outra recusada
    // deixa o gestor sem saber em quais itens pode confiar.
    const validas: Array<{ estoqueId: string; quantidade: number | null; observacoes: string | null }> = [];
    for (const item of b.contagens) {
      const v = validarContagem(item.quantidade);
      if ('erro' in v) throw new ErroDeNegocio(`${item.estoqueId}: ${v.erro}`, 422);
      validas.push({ estoqueId: item.estoqueId, quantidade: v.valor, observacoes: item.observacoes ?? null });
    }

    const agora = new Date();
    const linhas = await prisma.contagemInventario.findMany({
      where: { empresaId, sessaoId: sessao.id, estoqueId: { in: validas.map((v) => v.estoqueId) } },
      select: { id: true, estoqueId: true },
    });
    const porEstoque = new Map(linhas.map((l) => [l.estoqueId, l.id]));
    for (const v of validas) {
      const id = porEstoque.get(v.estoqueId);
      if (!id) continue; // item que nao esta nesta folha
      await prisma.contagemInventario.update({
        where: { id },
        data: {
          quantidadeContada: v.quantidade,
          // `null` limpa tambem quem contou: um item que voltou para 'nao
          // contado' nao pode continuar exibindo o nome de quem contou antes.
          ...(v.quantidade === null
            ? { contadoPorId: null, contadoEm: null }
            : { contadoPorId: req.user.id, contadoEm: agora }),
          ...(v.observacoes !== null ? { observacoes: v.observacoes } : {}),
        },
      });
    }

    const completa = await carregarSessao(empresaId, sessao.id);
    return { sessao: paraSessaoDTO(completa) };
  });

  /**
   * POST /estoque/inventarios/:id/fechar - encerra a folha.
   *
   * Concluir com item pendente e recusado (409). Fechar com pendencia criaria
   * um registro de inventario que nao cobre o deposito, e e pior que nao
   * fechar: pareceria que a contagem terminou.
   */
  app.post('/estoque/inventarios/:id/fechar', fechar, async (req: any) => {
    const empresaId = empresaDoRequisicao(req);
    const b = fecharSchema.parse(req.body ?? {});
    const s = await prisma.sessaoInventario.findFirst({
      where: { id: req.params.id, empresaId },
      include: { contagens: { select: { quantidadeSistema: true, quantidadeContada: true } } },
    });
    if (!s) throw new ErroDeNegocio('Contagem nao encontrada nesta empresa.', 404);
    if (!podeMudarStatus(s.status, b.status)) {
      throw new ErroDeNegocio(`Esta contagem ja esta ${s.status} e nao muda de estado.`, 409);
    }
    const resumo = resumirSessao(s.contagens);
    if (b.status === 'CONCLUIDA' && !resumo.fechavel) {
      throw new ErroDeNegocio(
        resumo.total === 0
          ? 'Esta folha nao tem itens para concluir.'
          : `Faltam ${resumo.pendentes} item(ns) sem contar. Conclua a contagem ou cancele a folha.`,
        409,
      );
    }
    const salva = await prisma.sessaoInventario.update({
      where: { id: s.id },
      data: {
        status: b.status,
        concluidoPorId: req.user.id,
        concluidoEm: new Date(),
        ...(b.observacoes !== undefined ? { observacoes: b.observacoes } : {}),
      },
    });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'SessaoInventario', entidadeId: salva.id,
      valorAnterior: { status: s.status },
      valorNovo: { status: salva.status, contados: resumo.contados, faltaram: resumo.faltaram, sobraram: resumo.sobraram },
      origem: 'MANUAL', ip: req.ip,
      contexto: `Inventario "${s.nome}" ${salva.status === 'CONCLUIDA' ? 'concluido' : 'cancelado'}: ${resumo.contados}/${resumo.total} contados.`,
    });
    const completa = await carregarSessao(empresaId, s.id);
    return { sessao: paraSessaoDTO(completa) };
  });
}