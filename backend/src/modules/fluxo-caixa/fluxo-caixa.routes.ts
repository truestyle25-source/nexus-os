import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoQualquerDas } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { resumoDoCaixa } from '../pdv/pdv.service.js';
import {
  FORMAS, LIMITE_EXCECAO_GESTOR, esperadoPorForma, montarConferencia, nivelExigido, proximoStatus,
  lerExtrato, calcularCartao, type StatusAprov,
} from './fluxo-caixa.service.js';

/**
 * Fluxo de Caixa — painel gerencial dos caixas do PDV.
 *
 * Regras de acesso (checadas no BANCO a cada requisição):
 * - ver caixas/histórico/aprovações: financeiro:visualizar OU pdv:supervisor;
 * - conferência/turno do PRÓPRIO caixa: pdv:editar (operador);
 * - decidir aprovação: pdv:supervisor (nível Supervisor) ou pdv:administrar (Gestor);
 * - conciliações: financeiro:visualizar / financeiro:editar.
 * Isolamento: toda consulta filtra empresaId do token; usuário com filial
 * fixa e sem nível Gestor só enxerga a própria filial.
 *
 * Nada aqui altera Venda ou MovimentacaoCaixa: conferências, decisões,
 * ajustes e desfazimentos são sempre linhas novas.
 */

const VER = [{ modulo: 'financeiro', acao: 'visualizar' }, { modulo: 'pdv', acao: 'supervisor' }];
const OPERAR = [{ modulo: 'pdv', acao: 'editar' }, { modulo: 'pdv', acao: 'supervisor' }, { modulo: 'financeiro', acao: 'editar' }];
const FIN_VER = [{ modulo: 'financeiro', acao: 'visualizar' }];
const FIN_EDITAR = [{ modulo: 'financeiro', acao: 'editar' }];

type Ctx = { id: string; empresaId: string; filialId: string | null; supervisor: boolean; gestor: boolean; financeiro: boolean };

async function contexto(req: any): Promise<Ctx> {
  const id = String(req.user.id);
  const empresaId = String(req.user.empresaId);
  const [u, perms] = await Promise.all([
    prisma.usuario.findFirst({ where: { id, empresaId }, select: { filialId: true } }),
    prisma.permissao.findMany({ where: { usuarioId: id, permitido: true, modulo: { in: ['pdv', 'financeiro'] } }, select: { modulo: true, acao: true } }),
  ]);
  if (!u) throw new ErroDeNegocio('Usuário fora desta empresa.', 403);
  const tem = (m: string, a: string) => perms.some((p) => p.modulo === m && p.acao === a);
  const gestor = tem('pdv', 'administrar');
  return { id, empresaId, filialId: u.filialId ?? null, gestor, supervisor: gestor || tem('pdv', 'supervisor'), financeiro: tem('financeiro', 'visualizar') };
}

/** Filtro de filial: quem tem filial fixa e não é gestor fica nela. */
function escopoFilial(ctx: Ctx, pedida?: string) {
  if (ctx.filialId && !ctx.gestor) return ctx.filialId;
  return pedida || undefined;
}

const num = (v: unknown) => (v == null ? null : Number(v));

const periodo = z.object({
  inicio: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'inicio inválido').optional(),
  fim: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'fim inválido').optional(),
});

function janela(q: { inicio?: string; fim?: string }, diasPadrao = 30) {
  const fim = q.fim ? new Date(q.fim) : new Date();
  const inicio = q.inicio ? new Date(q.inicio) : new Date(fim.getTime() - diasPadrao * 86400000);
  if (inicio > fim) throw new ErroDeNegocio('O início do período é posterior ao fim.', 400);
  return { inicio, fim };
}

async function resumoCaixa(empresaId: string, caixa: { id: string; fundoTroco: unknown; saldo: unknown; abertoEm: Date }) {
  const [vendas, movimentacoes] = await Promise.all([
    prisma.venda.findMany({ where: { empresaId, caixaId: caixa.id }, select: { formaPagamento: true, total: true, status: true, pagamentos: { select: { forma: true, valor: true } } } }),
    prisma.movimentacaoCaixa.findMany({ where: { caixaId: caixa.id }, select: { tipo: true, valor: true, origem: true } }),
  ]);
  return resumoDoCaixa(caixa, vendas, movimentacoes);
}

async function criarAprovacao(tx: any, d: { empresaId: string; filialId?: string | null; caixaId?: string | null; tipo: string; referenciaId?: string; descricao: string; valor: number; solicitanteId: string }) {
  return tx.aprovacaoCaixa.create({
    data: { ...d, filialId: d.filialId ?? null, caixaId: d.caixaId ?? null, nivelExigido: nivelExigido(d.valor) },
  });
}

export async function fluxoCaixaRoutes(app: FastifyInstance): Promise<void> {
  const auth = (app as any).authenticate;

  // ── 1. VISÃO GERAL ──────────────────────────────────────────────────────
  app.get('/fluxo/caixas', { preHandler: [auth, await permissaoQualquerDas(VER)] }, async (req: any) => {
    const ctx = await contexto(req);
    const q = periodo.extend({ filialId: z.string().optional(), status: z.enum(['ABERTO', 'FECHADO', 'BLOQUEADO', 'EM_FECHAMENTO', 'DIVERGENCIA']).optional() }).parse(req.query);
    const { inicio, fim } = janela(q);
    const caixas = await prisma.caixa.findMany({
      where: { empresaId: ctx.empresaId, filialId: escopoFilial(ctx, q.filialId), status: q.status, OR: [{ status: 'ABERTO' }, { abertoEm: { gte: inicio, lte: fim } }] },
      orderBy: { abertoEm: 'desc' }, take: 100,
      include: { usuario: { select: { nome: true } }, filial: { select: { nome: true } }, _count: { select: { conferencias: true } } },
    });
    const ids = caixas.map((c) => c.id);
    const [pendentes, divergencias] = await Promise.all([
      prisma.aprovacaoCaixa.groupBy({ by: ['caixaId'], where: { empresaId: ctx.empresaId, caixaId: { in: ids }, status: { in: ['PENDENTE', 'AUTORIZADA'] } }, _count: true }),
      prisma.divergenciaCaixa.groupBy({ by: ['caixaId'], where: { empresaId: ctx.empresaId, caixaId: { in: ids }, status: 'ABERTA' }, _count: true }),
    ]);
    const linhas = await Promise.all(caixas.map(async (c) => {
      const resumo = await resumoCaixa(ctx.empresaId, c);
      const pend = (pendentes.find((p) => p.caixaId === c.id)?._count ?? 0) + (divergencias.find((p) => p.caixaId === c.id)?._count ?? 0);
      return {
        id: c.id, numero: c.numero, filial: c.filial?.nome ?? null, filialId: c.filialId, operador: c.usuario?.nome ?? null,
        status: c.status, abertoEm: c.abertoEm, fechadoEm: c.fechadoEm,
        totalVendas: resumo.totalVendas, dinheiroEsperado: resumo.dinheiroEsperado,
        valorContado: num(c.valorContado), diferenca: num(c.diferenca), conferido: c._count.conferencias > 0, pendencias: pend,
      };
    }));
    const aguardando = await prisma.aprovacaoCaixa.count({ where: { empresaId: ctx.empresaId, status: { in: ['PENDENTE', 'AUTORIZADA'] }, ...(escopoFilial(ctx) ? { filialId: escopoFilial(ctx) } : {}) } });
    return {
      kpis: {
        caixasAbertos: linhas.filter((l) => l.status === 'ABERTO').length,
        totalVendas: Math.round(linhas.reduce((s, l) => s + l.totalVendas, 0) * 100) / 100,
        aguardandoAprovacao: aguardando,
        divergencias: linhas.filter((l) => (l.diferenca ?? 0) !== 0).length,
      },
      caixas: linhas,
      periodo: { inicio, fim },
    };
  });

  // ── 2. CAIXA (consulta individual) ──────────────────────────────────────
  app.get('/fluxo/caixas/:id', { preHandler: [auth, await permissaoQualquerDas([...VER, { modulo: 'pdv', acao: 'editar' }])] }, async (req: any) => {
    const ctx = await contexto(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const caixa = await prisma.caixa.findFirst({ where: { id, empresaId: ctx.empresaId, filialId: escopoFilial(ctx) }, include: { usuario: { select: { nome: true } }, filial: { select: { nome: true } } } });
    if (!caixa) throw NaoEncontrado('Caixa não encontrado.');
    const gerencial = ctx.supervisor || ctx.financeiro;
    if (!gerencial && caixa.usuarioId !== ctx.id) throw new ErroDeNegocio('Você só pode consultar o seu próprio caixa.', 403);
    const [movimentacoes, vendas, conferencias, turnos, aprovacoes] = await Promise.all([
      prisma.movimentacaoCaixa.findMany({ where: { caixaId: id }, orderBy: { createdAt: 'asc' } }),
      prisma.venda.findMany({ where: { empresaId: ctx.empresaId, caixaId: id }, orderBy: { createdAt: 'asc' }, select: { id: true, total: true, status: true, createdAt: true, formaPagamento: true, pagamentos: { select: { forma: true, valor: true } } } }),
      prisma.conferenciaCaixa.findMany({ where: { empresaId: ctx.empresaId, caixaId: id }, orderBy: { createdAt: 'asc' }, include: { itens: true } }),
      prisma.turnoCaixa.findMany({ where: { empresaId: ctx.empresaId, caixaId: id }, orderBy: { entradaEm: 'asc' } }),
      prisma.aprovacaoCaixa.findMany({ where: { empresaId: ctx.empresaId, caixaId: id }, orderBy: { createdAt: 'asc' }, include: { decisoes: { orderBy: { createdAt: 'asc' } } } }),
    ]);
    const resumo = resumoDoCaixa(caixa, vendas, movimentacoes);
    const nomes = await nomesDe([...movimentacoes.map((m) => m.usuarioId), ...conferencias.map((c) => c.responsavelId), ...turnos.flatMap((t) => [t.operadorId, t.recebidoPorId ?? ''])], ctx.empresaId);
    // Fechamento cego: o operador sem nível gerencial NÃO recebe o esperado
    // enquanto não registrar a própria conferência.
    const conferiu = conferencias.some((c) => c.responsavelId === ctx.id);
    const ocultarEsperado = !gerencial && !conferiu;
    return {
      caixa: { id: caixa.id, numero: caixa.numero, filial: caixa.filial?.nome ?? null, operador: caixa.usuario?.nome ?? null, status: caixa.status, abertoEm: caixa.abertoEm, fechadoEm: caixa.fechadoEm, fundoTroco: Number(caixa.fundoTroco), valorContado: num(caixa.valorContado), diferenca: ocultarEsperado ? null : num(caixa.diferenca) },
      ocultarEsperado,
      resumo: ocultarEsperado ? null : resumo,
      esperadoPorForma: ocultarEsperado ? null : esperadoPorForma(resumo),
      movimentacoes: movimentacoes.map((m) => ({ id: m.id, tipo: m.tipo, valor: Number(m.valor), motivo: m.motivo, origem: m.origem, usuario: nomes[m.usuarioId] ?? null, vendaId: m.vendaId, createdAt: m.createdAt })),
      vendas: vendas.map((v) => ({ id: v.id, total: Number(v.total), status: v.status, createdAt: v.createdAt, formas: (v.pagamentos.length ? v.pagamentos : [{ forma: v.formaPagamento, valor: v.total }]).map((p) => ({ forma: p.forma, valor: Number(p.valor) })) })),
      conferencias: conferencias.map((c) => ({ id: c.id, cega: c.cega, responsavel: nomes[c.responsavelId] ?? null, createdAt: c.createdAt, justificativa: c.justificativa, totalEsperado: Number(c.totalEsperado), totalContado: Number(c.totalContado), diferenca: Number(c.diferenca), aprovacaoId: c.aprovacaoId, itens: c.itens.map((i) => ({ forma: i.forma, esperado: Number(i.esperado), contado: Number(i.contado), diferenca: Number(i.diferenca) })) })),
      turnos: turnos.map((t) => ({ ...serTurno(t), operador: nomes[t.operadorId] ?? null, recebidoPor: t.recebidoPorId ? nomes[t.recebidoPorId] ?? null : null })),
      aprovacoes: aprovacoes.map(serAprovacao),
    };
  });

  // ── 3. CONFERÊNCIA (inclui fechamento cego) ─────────────────────────────
  app.post('/fluxo/caixas/:id/conferencias', { preHandler: [auth, await permissaoQualquerDas(OPERAR)] }, async (req: any) => {
    const ctx = await contexto(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({
      itens: z.array(z.object({ forma: z.enum(FORMAS), valor: z.number().min(0).max(10_000_000) })).min(1).max(10),
      justificativa: z.string().trim().max(500).optional(),
    }).parse(req.body);
    const caixa = await prisma.caixa.findFirst({ where: { id, empresaId: ctx.empresaId, filialId: escopoFilial(ctx) } });
    if (!caixa) throw NaoEncontrado('Caixa não encontrado.');
    const gerencial = ctx.supervisor || ctx.financeiro;
    if (!gerencial && caixa.usuarioId !== ctx.id) throw new ErroDeNegocio('Só o operador do caixa, um supervisor ou o financeiro conferem este caixa.', 403);
    if (caixa.status === 'ABERTO') throw new ErroDeNegocio('Feche o caixa no PDV antes de conferir.', 422);
    if (await prisma.conferenciaCaixa.findFirst({ where: { caixaId: id, responsavelId: ctx.id }, select: { id: true } })) {
      throw new ErroDeNegocio('Você já registrou a conferência deste caixa. Ela não pode ser refeita; uma nova conferência deve ser feita por outra pessoa.', 409);
    }
    const resumo = await resumoCaixa(ctx.empresaId, caixa);
    const conf = montarConferencia(esperadoPorForma(resumo), body.itens);
    const cega = !gerencial; // o operador não teve acesso ao esperado antes do envio
    const resultado = await prisma.$transaction(async (tx) => {
      const criada = await tx.conferenciaCaixa.create({
        data: {
          empresaId: ctx.empresaId, filialId: caixa.filialId, caixaId: id, responsavelId: ctx.id, cega,
          totalEsperado: conf.totalEsperado, totalContado: conf.totalContado, diferenca: conf.diferenca, justificativa: body.justificativa || null,
          itens: { create: conf.itens.map((i) => ({ empresaId: ctx.empresaId, forma: i.forma as any, esperado: i.esperado, contado: i.contado, diferenca: i.diferenca })) },
        },
        include: { itens: true },
      });
      let aprovacao = null;
      if (conf.divergenciaAbs > 0) {
        aprovacao = await criarAprovacao(tx, {
          empresaId: ctx.empresaId, filialId: caixa.filialId, caixaId: id, tipo: 'DIVERGENCIA_CONFERENCIA', referenciaId: criada.id,
          descricao: `Conferência do caixa ${caixa.numero ?? ''}: diferença de R$ ${conf.diferenca.toFixed(2)} (${conf.itens.filter((i) => i.diferenca !== 0).map((i) => `${i.forma} ${i.diferenca > 0 ? 'sobra' : 'falta'} ${Math.abs(i.diferenca).toFixed(2)}`).join('; ')})`,
          valor: conf.divergenciaAbs, solicitanteId: ctx.id,
        });
        await tx.conferenciaCaixa.update({ where: { id: criada.id }, data: { aprovacaoId: aprovacao.id } });
      }
      return { criada, aprovacao };
    });
    await registrarAuditoria({ usuarioId: ctx.id, empresaId: ctx.empresaId, acao: 'CRIAR', entidade: 'ConferenciaCaixa', entidadeId: resultado.criada.id, valorNovo: { caixaId: id, cega, ...conf } as any, origem: 'MANUAL', ip: req.ip, contexto: resultado.aprovacao ? `Divergência enviada para aprovação (${resultado.aprovacao.nivelExigido})` : 'Conferência sem divergência' });
    // Só depois do registro o esperado é revelado.
    return { conferenciaId: resultado.criada.id, ...conf, aprovacao: resultado.aprovacao ? serAprovacao({ ...resultado.aprovacao, decisoes: [] }) : null };
  });

  // ── 4. DOCUMENTOS FISCAIS ───────────────────────────────────────────────
  app.get('/fluxo/documentos-fiscais', { preHandler: [auth, await permissaoQualquerDas(VER)] }, async () => ({
    disponivel: false,
    motivo: 'O NEXUS ainda não emite NFC-e/NF-e de venda: não existe XML, DANFE nem chave de acesso vinculados às vendas. Esta aba passa a listar os documentos quando a emissão fiscal for integrada ao módulo Fiscal.',
  }));

  // ── 5. HISTÓRICO / AUDITORIA AVANÇADA ───────────────────────────────────
  app.get('/fluxo/historico', { preHandler: [auth, await permissaoQualquerDas(VER)] }, async (req: any) => {
    const ctx = await contexto(req);
    const q = periodo.extend({ caixaId: z.string().optional() }).parse(req.query);
    const { inicio, fim } = janela(q, 7);
    const entidades = ['Caixa', 'MovimentacaoCaixa', 'Venda', 'ConferenciaCaixa', 'AprovacaoCaixa', 'TurnoCaixa', 'ConciliacaoBancaria', 'ExtratoImportacao', 'Adquirente', 'ContaBancaria', 'DivergenciaCaixa'];
    let ids: string[] | undefined;
    if (q.caixaId) {
      const c = await prisma.caixa.findFirst({ where: { id: q.caixaId, empresaId: ctx.empresaId }, select: { id: true } });
      if (!c) throw NaoEncontrado('Caixa não encontrado.');
      const [m, conf, ap, t] = await Promise.all([
        prisma.movimentacaoCaixa.findMany({ where: { caixaId: c.id }, select: { id: true } }),
        prisma.conferenciaCaixa.findMany({ where: { caixaId: c.id }, select: { id: true } }),
        prisma.aprovacaoCaixa.findMany({ where: { caixaId: c.id }, select: { id: true } }),
        prisma.turnoCaixa.findMany({ where: { caixaId: c.id }, select: { id: true } }),
      ]);
      ids = [c.id, ...m, ...conf, ...ap, ...t].map((x: any) => (typeof x === 'string' ? x : x.id));
    }
    const registros = await prisma.auditoria.findMany({
      where: { empresaId: ctx.empresaId, entidade: { in: entidades }, createdAt: { gte: inicio, lte: fim }, ...(ids ? { entidadeId: { in: ids } } : {}) },
      orderBy: { createdAt: 'desc' }, take: 300,
      select: { id: true, createdAt: true, acao: true, entidade: true, entidadeId: true, origem: true, contexto: true, usuario: { select: { nome: true } } },
    });
    return { registros: registros.map((r) => ({ ...r, usuario: r.usuario?.nome ?? null })), periodo: { inicio, fim } };
  });

  // ── 8. APROVAÇÕES ───────────────────────────────────────────────────────
  app.get('/fluxo/aprovacoes', { preHandler: [auth, await permissaoQualquerDas(VER)] }, async (req: any) => {
    const ctx = await contexto(req);
    const q = z.object({ status: z.enum(['PENDENTE', 'AUTORIZADA', 'APROVADA', 'REJEITADA', 'ABERTAS']).optional() }).parse(req.query);
    const status = q.status === 'ABERTAS' ? { in: ['PENDENTE', 'AUTORIZADA'] as any } : q.status;
    const fil = escopoFilial(ctx);
    const lista = await prisma.aprovacaoCaixa.findMany({
      where: { empresaId: ctx.empresaId, status, ...(fil ? { filialId: fil } : {}) },
      orderBy: { createdAt: 'desc' }, take: 200, include: { decisoes: { orderBy: { createdAt: 'asc' } } },
    });
    const nomes = await nomesDe([...lista.map((a) => a.solicitanteId), ...lista.flatMap((a) => a.decisoes.map((d) => d.decisorId))], ctx.empresaId);
    return {
      limiteGestor: LIMITE_EXCECAO_GESTOR,
      meuNivel: ctx.gestor ? 'GESTOR' : ctx.supervisor ? 'SUPERVISOR' : null,
      aprovacoes: lista.map((a) => ({ ...serAprovacao(a), solicitante: nomes[a.solicitanteId] ?? null, decisoes: a.decisoes.map((d) => ({ ...serDecisao(d), decisor: nomes[d.decisorId] ?? null })) })),
    };
  });

  app.post('/fluxo/aprovacoes/:id/decidir', { preHandler: [auth, await permissaoQualquerDas([{ modulo: 'pdv', acao: 'supervisor' }, { modulo: 'pdv', acao: 'administrar' }])] }, async (req: any) => {
    const ctx = await contexto(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ decisao: z.enum(['AUTORIZAR', 'APROVAR', 'REJEITAR']), justificativa: z.string().trim().min(5, 'Explique a decisão (mínimo 5 letras).').max(500) }).parse(req.body);
    const nivel = ctx.gestor ? 'GESTOR' : 'SUPERVISOR';
    const resultado = await prisma.$transaction(async (tx) => {
      const a = await tx.aprovacaoCaixa.findFirst({ where: { id, empresaId: ctx.empresaId }, include: { decisoes: true } });
      if (!a) throw NaoEncontrado('Solicitação não encontrada.');
      const fil = escopoFilial(ctx);
      if (fil && a.filialId && a.filialId !== fil) throw new ErroDeNegocio('Solicitação de outra filial.', 403);
      if (a.solicitanteId === ctx.id) throw new ErroDeNegocio('Quem solicitou não pode decidir a própria solicitação.', 403);
      if (a.decisoes.some((d) => d.decisorId === ctx.id)) throw new ErroDeNegocio('Você já decidiu esta solicitação; a próxima etapa é de outra pessoa.', 403);
      const passo = proximoStatus({ status: a.status as StatusAprov, nivelExigido: a.nivelExigido }, nivel, body.decisao);
      if (!passo.ok) throw new ErroDeNegocio(passo.erro, passo.http);
      // Update condicional: duas decisões simultâneas → só uma passa.
      const mudou = await tx.aprovacaoCaixa.updateMany({ where: { id, status: a.status }, data: { status: passo.status } });
      if (mudou.count !== 1) throw new ErroDeNegocio('A solicitação mudou enquanto você decidia. Atualize a tela.', 409);
      const decisao = await tx.decisaoAprovacaoCaixa.create({ data: { empresaId: ctx.empresaId, aprovacaoId: id, decisorId: ctx.id, nivel, decisao: body.decisao, justificativa: body.justificativa } });
      return { anterior: a.status, status: passo.status, decisao };
    });
    await registrarAuditoria({ usuarioId: ctx.id, empresaId: ctx.empresaId, acao: 'EDITAR', entidade: 'AprovacaoCaixa', entidadeId: id, valorAnterior: { status: resultado.anterior }, valorNovo: { status: resultado.status, decisao: body.decisao, nivel }, origem: 'MANUAL', ip: req.ip, contexto: body.justificativa });
    return { status: resultado.status, decisao: serDecisao(resultado.decisao) };
  });

  // ── 9. TURNOS ───────────────────────────────────────────────────────────
  app.get('/fluxo/turnos', { preHandler: [auth, await permissaoQualquerDas(VER)] }, async (req: any) => {
    const ctx = await contexto(req);
    const q = periodo.extend({ caixaId: z.string().optional(), filialId: z.string().optional() }).parse(req.query);
    const { inicio, fim } = janela(q);
    const turnos = await prisma.turnoCaixa.findMany({
      where: { empresaId: ctx.empresaId, caixaId: q.caixaId, filialId: escopoFilial(ctx, q.filialId), OR: [{ saidaEm: null }, { entradaEm: { gte: inicio, lte: fim } }] },
      orderBy: { entradaEm: 'desc' }, take: 200, include: { caixa: { select: { numero: true } } },
    });
    const nomes = await nomesDe(turnos.flatMap((t) => [t.operadorId, t.recebidoPorId ?? '']), ctx.empresaId);
    return { turnos: turnos.map((t) => ({ ...serTurno(t), caixaNumero: t.caixa.numero, operador: nomes[t.operadorId] ?? null, recebidoPor: t.recebidoPorId ? nomes[t.recebidoPorId] ?? null : null })) };
  });

  app.post('/fluxo/turnos', { preHandler: [auth, await permissaoQualquerDas(OPERAR)] }, async (req: any) => {
    const ctx = await contexto(req);
    const body = z.object({ caixaId: z.string().min(1), operadorId: z.string().min(1).optional() }).parse(req.body);
    const operadorId = body.operadorId ?? ctx.id;
    if (operadorId !== ctx.id && !ctx.supervisor) throw new ErroDeNegocio('Só um supervisor registra turno para outra pessoa.', 403);
    const caixa = await prisma.caixa.findFirst({ where: { id: body.caixaId, empresaId: ctx.empresaId, filialId: escopoFilial(ctx) } });
    if (!caixa) throw NaoEncontrado('Caixa não encontrado.');
    if (caixa.status !== 'ABERTO') throw new ErroDeNegocio('Turno só começa em caixa aberto.', 422);
    if (!(await prisma.usuario.findFirst({ where: { id: operadorId, empresaId: ctx.empresaId }, select: { id: true } }))) throw new ErroDeNegocio('Operador não encontrado nesta empresa.', 422);
    const turno = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Caixa" WHERE "id" = ${caixa.id} FOR UPDATE`;
      if (await tx.turnoCaixa.findFirst({ where: { caixaId: caixa.id, saidaEm: null }, select: { id: true } })) throw new ErroDeNegocio('Já existe um turno ativo neste caixa. Faça a passagem de turno.', 409);
      return tx.turnoCaixa.create({ data: { empresaId: ctx.empresaId, filialId: caixa.filialId, caixaId: caixa.id, operadorId, registradoPorId: ctx.id } });
    });
    await registrarAuditoria({ usuarioId: ctx.id, empresaId: ctx.empresaId, acao: 'CRIAR', entidade: 'TurnoCaixa', entidadeId: turno.id, valorNovo: serTurno(turno) as any, origem: 'MANUAL', ip: req.ip, contexto: 'Início de turno' });
    return serTurno(turno);
  });

  app.post('/fluxo/turnos/:id/passagem', { preHandler: [auth, await permissaoQualquerDas(OPERAR)] }, async (req: any) => {
    const ctx = await contexto(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ valorConferido: z.number().min(0).max(10_000_000), recebidoPorId: z.string().min(1).optional(), observacao: z.string().trim().max(500).optional() }).parse(req.body);
    const turno = await prisma.turnoCaixa.findFirst({ where: { id, empresaId: ctx.empresaId }, include: { caixa: true } });
    if (!turno) throw NaoEncontrado('Turno não encontrado.');
    if (turno.operadorId !== ctx.id && !ctx.supervisor) throw new ErroDeNegocio('Só o operador do turno ou um supervisor faz a passagem.', 403);
    if (body.recebidoPorId === turno.operadorId) throw new ErroDeNegocio('A pessoa que recebe precisa ser diferente de quem entrega.', 422);
    if (body.recebidoPorId && !(await prisma.usuario.findFirst({ where: { id: body.recebidoPorId, empresaId: ctx.empresaId }, select: { id: true } }))) throw new ErroDeNegocio('Quem recebe não foi encontrado nesta empresa.', 422);
    const resumo = await resumoCaixa(ctx.empresaId, turno.caixa);
    const esperado = Math.round(resumo.dinheiroEsperado * 100) / 100;
    const diferenca = Math.round((body.valorConferido - esperado) * 100) / 100;
    const r = await prisma.$transaction(async (tx) => {
      const fechou = await tx.turnoCaixa.updateMany({ where: { id, saidaEm: null }, data: { saidaEm: new Date(), valorEsperado: esperado, valorConferido: body.valorConferido, diferenca, recebidoPorId: body.recebidoPorId ?? null, observacao: body.observacao ?? null } });
      if (fechou.count !== 1) throw new ErroDeNegocio('Este turno já foi encerrado.', 409);
      const novo = body.recebidoPorId && turno.caixa.status === 'ABERTO'
        ? await tx.turnoCaixa.create({ data: { empresaId: ctx.empresaId, filialId: turno.filialId, caixaId: turno.caixaId, operadorId: body.recebidoPorId, registradoPorId: ctx.id } })
        : null;
      const aprovacao = diferenca !== 0
        ? await criarAprovacao(tx, { empresaId: ctx.empresaId, filialId: turno.filialId, caixaId: turno.caixaId, tipo: 'DIVERGENCIA_TURNO', referenciaId: id, descricao: `Passagem de turno: dinheiro ${diferenca > 0 ? 'sobrando' : 'faltando'} R$ ${Math.abs(diferenca).toFixed(2)}`, valor: Math.abs(diferenca), solicitanteId: ctx.id })
        : null;
      return { novo, aprovacao };
    });
    await registrarAuditoria({ usuarioId: ctx.id, empresaId: ctx.empresaId, acao: 'EDITAR', entidade: 'TurnoCaixa', entidadeId: id, valorNovo: { esperado, valorConferido: body.valorConferido, diferenca, recebidoPorId: body.recebidoPorId ?? null }, origem: 'MANUAL', ip: req.ip, contexto: 'Passagem de turno' });
    return { esperado, diferenca, novoTurno: r.novo ? serTurno(r.novo) : null, aprovacao: r.aprovacao ? serAprovacao({ ...r.aprovacao, decisoes: [] }) : null };
  });

  /** Quem pode receber o turno: só id e nome dos usuários ativos da empresa (filial do escopo). */
  app.get('/fluxo/operadores', { preHandler: [auth, await permissaoQualquerDas(OPERAR)] }, async (req: any) => {
    const ctx = await contexto(req);
    const fil = escopoFilial(ctx);
    const usuarios = await prisma.usuario.findMany({
      where: { empresaId: ctx.empresaId, status: 'ATIVO', ...(fil ? { OR: [{ filialId: fil }, { filialId: null }] } : {}) },
      orderBy: { nome: 'asc' }, take: 300, select: { id: true, nome: true },
    });
    return { usuarios, eu: ctx.id, nivel: ctx.gestor ? 'GESTOR' : ctx.supervisor ? 'SUPERVISOR' : 'OPERADOR', financeiro: ctx.financeiro };
  });

  // ── 6. CONCILIAÇÃO BANCÁRIA ─────────────────────────────────────────────
  app.get('/fluxo/contas-bancarias', { preHandler: [auth, await permissaoQualquerDas(FIN_VER)] }, async (req: any) => {
    const contas = await prisma.contaBancaria.findMany({ where: { empresaId: req.user.empresaId, ativa: true }, orderBy: { nome: 'asc' } });
    return { contas };
  });

  app.post('/fluxo/contas-bancarias', { preHandler: [auth, await permissaoQualquerDas(FIN_EDITAR)] }, async (req: any) => {
    const body = z.object({ nome: z.string().trim().min(2).max(80), banco: z.string().trim().max(80).optional(), agencia: z.string().trim().max(20).optional(), numero: z.string().trim().max(30).optional(), filialId: z.string().optional() }).parse(req.body);
    if (body.filialId && !(await prisma.filial.findFirst({ where: { id: body.filialId, empresaId: req.user.empresaId }, select: { id: true } }))) throw new ErroDeNegocio('Filial não encontrada.', 422);
    const conta = await prisma.contaBancaria.create({ data: { ...body, empresaId: req.user.empresaId } });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'ContaBancaria', entidadeId: conta.id, valorNovo: conta as any, origem: 'MANUAL', ip: req.ip });
    return conta;
  });

  app.post('/fluxo/contas-bancarias/:id/extrato', { preHandler: [auth, await permissaoQualquerDas(FIN_EDITAR)] }, async (req: any) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ arquivoNome: z.string().trim().min(1).max(200), conteudo: z.string().min(1).max(5_000_000) }).parse(req.body);
    const conta = await prisma.contaBancaria.findFirst({ where: { id, empresaId: req.user.empresaId } });
    if (!conta) throw NaoEncontrado('Conta não encontrada.');
    let lido;
    try { lido = lerExtrato(body.arquivoNome, body.conteudo); } catch (e: any) { throw new ErroDeNegocio(e.message, 422); }
    if (!lido.linhas.length) throw new ErroDeNegocio('Nenhum lançamento reconhecido no arquivo. Envie um OFX ou um CSV com colunas data, descrição e valor.', 422);
    const r = await prisma.$transaction(async (tx) => {
      const imp = await tx.extratoImportacao.create({ data: { empresaId: conta.empresaId, contaId: id, arquivoNome: body.arquivoNome, formato: lido.formato, linhasNovas: 0, linhasRepetidas: 0, importadoPorId: req.user.id } });
      const criadas = await tx.extratoLinha.createMany({ data: lido.linhas.map((l) => ({ ...l, empresaId: conta.empresaId, contaId: id, importacaoId: imp.id })), skipDuplicates: true });
      return tx.extratoImportacao.update({ where: { id: imp.id }, data: { linhasNovas: criadas.count, linhasRepetidas: lido.linhas.length - criadas.count } });
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'IMPORTAR', entidade: 'ExtratoImportacao', entidadeId: r.id, valorNovo: r as any, origem: 'MANUAL', ip: req.ip, contexto: `Extrato ${lido.formato}: ${r.linhasNovas} novas, ${r.linhasRepetidas} já importadas` });
    return r;
  });

  app.get('/fluxo/contas-bancarias/:id/conciliacao', { preHandler: [auth, await permissaoQualquerDas(FIN_VER)] }, async (req: any) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const { inicio, fim } = janela(periodo.parse(req.query));
    const empresaId = req.user.empresaId;
    const conta = await prisma.contaBancaria.findFirst({ where: { id, empresaId } });
    if (!conta) throw NaoEncontrado('Conta não encontrada.');
    const [linhas, ativas, sistema] = await Promise.all([
      // Linha de extrato só tem dia (gravada às 12h UTC): o fim vai até o fim do dia, senão o lançamento de hoje some antes das 9h.
      prisma.extratoLinha.findMany({ where: { empresaId, contaId: id, data: { gte: new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), inicio.getUTCDate())), lte: new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), fim.getUTCDate(), 23, 59, 59, 999)) } }, orderBy: { data: 'asc' } }),
      prisma.conciliacaoBancaria.findMany({ where: { empresaId, contaId: id, desfeitaEm: null } }),
      prisma.financeiro.findMany({ where: { empresaId, status: 'PAGO', ...(conta.filialId ? { filialId: conta.filialId } : {}), OR: [{ pagoEm: { gte: inicio, lte: fim } }, { pagoEm: null, createdAt: { gte: inicio, lte: fim } }] }, orderBy: { createdAt: 'asc' }, select: { id: true, tipo: true, descricao: true, valor: true, pagoEm: true, createdAt: true } }),
    ]);
    const aprovs = await prisma.aprovacaoCaixa.findMany({ where: { empresaId, id: { in: ativas.map((a) => a.aprovacaoId).filter(Boolean) as string[] } }, select: { id: true, status: true } });
    const usados = new Set(ativas.map((a) => a.financeiroId).filter(Boolean));
    const sis = sistema.map((f) => ({ id: f.id, data: f.pagoEm ?? f.createdAt, descricao: f.descricao, valor: (f.tipo === 'DESPESA' ? -1 : 1) * Number(f.valor), conciliado: usados.has(f.id) }));
    return {
      conta,
      totalExtrato: Math.round(linhas.reduce((s, l) => s + Number(l.valor) * 100, 0)) / 100,
      totalSistema: Math.round(sis.reduce((s, l) => s + l.valor * 100, 0)) / 100,
      extrato: linhas.map((l) => {
        const c = ativas.find((a) => a.extratoLinhaId === l.id);
        const ap = c?.aprovacaoId ? aprovs.find((a) => a.id === c.aprovacaoId) : null;
        return { id: l.id, data: l.data, descricao: l.descricao, valor: Number(l.valor), documento: l.documento, conciliacao: c ? { id: c.id, tipo: c.tipo, financeiroId: c.financeiroId, justificativa: c.justificativa, aprovacaoStatus: ap?.status ?? null } : null };
      }),
      sistema: sis,
      periodo: { inicio, fim },
    };
  });

  app.post('/fluxo/conciliacoes', { preHandler: [auth, await permissaoQualquerDas(FIN_EDITAR)] }, async (req: any) => {
    const empresaId = req.user.empresaId;
    const body = z.object({ extratoLinhaId: z.string().min(1), financeiroId: z.string().min(1).optional(), justificativa: z.string().trim().max(500).optional() }).parse(req.body);
    const linha = await prisma.extratoLinha.findFirst({ where: { id: body.extratoLinhaId, empresaId } });
    if (!linha) throw NaoEncontrado('Lançamento do extrato não encontrado.');
    let diferenca = Number(linha.valor);
    if (body.financeiroId) {
      const f = await prisma.financeiro.findFirst({ where: { id: body.financeiroId, empresaId, status: 'PAGO' }, select: { tipo: true, valor: true } });
      if (!f) throw NaoEncontrado('Lançamento do sistema não encontrado ou não pago.');
      diferenca = Math.round((Number(linha.valor) - (f.tipo === 'DESPESA' ? -1 : 1) * Number(f.valor)) * 100) / 100;
    }
    const ajuste = diferenca !== 0;
    if (ajuste && (!body.justificativa || body.justificativa.length < 10)) throw new ErroDeNegocio('Os valores não batem: explique o ajuste (mínimo 10 letras). Ele vai para aprovação.', 422);
    const r = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ExtratoLinha" WHERE "id" = ${linha.id} FOR UPDATE`;
      const existentes = await tx.conciliacaoBancaria.findFirst({ where: { OR: [{ extratoLinhaId: linha.id }, ...(body.financeiroId ? [{ financeiroId: body.financeiroId, contaId: linha.contaId }] : [])], desfeitaEm: null }, select: { id: true } });
      if (existentes) throw new ErroDeNegocio('Este lançamento já está conciliado. Desfaça a conciliação anterior primeiro.', 409);
      const aprovacao = ajuste ? await criarAprovacao(tx, { empresaId, tipo: 'AJUSTE_CONCILIACAO_BANCARIA', referenciaId: linha.id, descricao: `Ajuste de conciliação: diferença de R$ ${diferenca.toFixed(2)} em "${linha.descricao}"`, valor: Math.abs(diferenca), solicitanteId: req.user.id }) : null;
      const conc = await tx.conciliacaoBancaria.create({ data: { empresaId, contaId: linha.contaId, extratoLinhaId: linha.id, financeiroId: body.financeiroId ?? null, tipo: ajuste ? 'AJUSTE' : 'VINCULO', justificativa: body.justificativa ?? null, aprovacaoId: aprovacao?.id ?? null, usuarioId: req.user.id } });
      return { conc, aprovacao };
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'ConciliacaoBancaria', entidadeId: r.conc.id, valorNovo: r.conc as any, origem: 'MANUAL', ip: req.ip, contexto: ajuste ? `Ajuste de R$ ${diferenca.toFixed(2)} enviado para aprovação` : 'Vínculo exato' });
    return { conciliacao: r.conc, diferenca, aprovacao: r.aprovacao ? serAprovacao({ ...r.aprovacao, decisoes: [] }) : null };
  });

  app.post('/fluxo/conciliacoes/:id/desfazer', { preHandler: [auth, await permissaoQualquerDas(FIN_EDITAR)] }, async (req: any) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const { justificativa } = z.object({ justificativa: z.string().trim().min(5).max(500) }).parse(req.body);
    const mudou = await prisma.conciliacaoBancaria.updateMany({ where: { id, empresaId: req.user.empresaId, desfeitaEm: null }, data: { desfeitaEm: new Date(), desfeitaPorId: req.user.id } });
    if (mudou.count !== 1) throw NaoEncontrado('Conciliação não encontrada ou já desfeita.');
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR', entidade: 'ConciliacaoBancaria', entidadeId: id, valorNovo: { desfeita: true }, origem: 'MANUAL', ip: req.ip, contexto: justificativa });
    return { ok: true };
  });

  // ── 7. CONCILIAÇÃO DE CARTÕES ───────────────────────────────────────────
  app.get('/fluxo/adquirentes', { preHandler: [auth, await permissaoQualquerDas(FIN_VER)] }, async (req: any) => ({
    adquirentes: (await prisma.adquirente.findMany({ where: { empresaId: req.user.empresaId, ativa: true }, orderBy: { nome: 'asc' } })).map(serAdq),
  }));

  app.post('/fluxo/adquirentes', { preHandler: [auth, await permissaoQualquerDas(FIN_EDITAR)] }, async (req: any) => {
    const body = z.object({ nome: z.string().trim().min(2).max(60), taxaDebito: z.number().min(0).max(20), taxaCredito: z.number().min(0).max(20), prazoDebitoDias: z.number().int().min(0).max(60), prazoCreditoDias: z.number().int().min(0).max(120), padrao: z.boolean().default(false) }).parse(req.body);
    const empresaId = req.user.empresaId;
    const adq = await prisma.$transaction(async (tx) => {
      if (body.padrao) await tx.adquirente.updateMany({ where: { empresaId, padrao: true }, data: { padrao: false } });
      return tx.adquirente.create({ data: { ...body, empresaId } });
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'Adquirente', entidadeId: adq.id, valorNovo: serAdq(adq) as any, origem: 'MANUAL', ip: req.ip });
    return serAdq(adq);
  });

  app.get('/fluxo/cartoes', { preHandler: [auth, await permissaoQualquerDas(FIN_VER)] }, async (req: any) => {
    const ctx = await contexto(req);
    const q = periodo.extend({ filialId: z.string().optional() }).parse(req.query);
    const { inicio, fim } = janela(q);
    const [pagamentos, adq] = await Promise.all([
      prisma.vendaPagamento.findMany({
        where: { empresaId: ctx.empresaId, forma: { in: ['CARTAO_CREDITO', 'CARTAO_DEBITO'] }, venda: { status: 'FINALIZADA', createdAt: { gte: inicio, lte: fim }, filialId: escopoFilial(ctx, q.filialId) } },
        orderBy: { createdAt: 'asc' }, take: 2000,
        select: { id: true, forma: true, valor: true, referencia: true, createdAt: true, venda: { select: { id: true, caixaId: true, createdAt: true } } },
      }),
      prisma.adquirente.findFirst({ where: { empresaId: ctx.empresaId, ativa: true, padrao: true } }),
    ]);
    const a = adq ? serAdq(adq) : null;
    const linhas = pagamentos.map((p) => ({ id: p.id, vendaId: p.venda.id, caixaId: p.venda.caixaId, data: p.venda.createdAt, forma: p.forma, bruto: Number(p.valor), referencia: p.referencia, ...calcularCartao(Number(p.valor), p.forma, p.venda.createdAt, a) }));
    const soma = (f: (l: (typeof linhas)[number]) => number | null) => Math.round(linhas.reduce((s, l) => s + (f(l) ?? 0) * 100, 0)) / 100;
    return {
      adquirente: a,
      avisos: [
        ...(a ? [] : ['Cadastre uma adquirente padrão com as taxas do seu contrato para calcular taxa, líquido e previsão.']),
        'O PDV ainda não registra adquirente, terminal, bandeira nem parcelas em cada venda: todos os cartões usam a adquirente padrão e são tratados como pagamento à vista.',
        'Sem integração com a adquirente, o valor efetivamente recebido é conferido na Conciliação bancária (extrato).',
      ],
      totais: { bruto: soma((l) => l.bruto), taxas: soma((l) => l.taxa), liquido: soma((l) => l.liquido), credito: Math.round(linhas.filter((l) => l.forma === 'CARTAO_CREDITO').reduce((s, l) => s + l.bruto * 100, 0)) / 100, debito: Math.round(linhas.filter((l) => l.forma === 'CARTAO_DEBITO').reduce((s, l) => s + l.bruto * 100, 0)) / 100 },
      linhas,
      periodo: { inicio, fim },
    };
  });
}

async function nomesDe(ids: string[], empresaId: string): Promise<Record<string, string>> {
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  if (!unicos.length) return {};
  const us = await prisma.usuario.findMany({ where: { id: { in: unicos }, empresaId }, select: { id: true, nome: true } });
  return Object.fromEntries(us.map((u) => [u.id, u.nome]));
}

function serTurno(t: any) {
  return { id: t.id, caixaId: t.caixaId, operadorId: t.operadorId, entradaEm: t.entradaEm, saidaEm: t.saidaEm, recebidoPorId: t.recebidoPorId, valorEsperado: num(t.valorEsperado), valorConferido: num(t.valorConferido), diferenca: num(t.diferenca), observacao: t.observacao };
}
function serDecisao(d: any) {
  return { id: d.id, decisorId: d.decisorId, nivel: d.nivel, decisao: d.decisao, justificativa: d.justificativa, createdAt: d.createdAt };
}
function serAprovacao(a: any) {
  return { id: a.id, tipo: a.tipo, descricao: a.descricao, valor: Number(a.valor), nivelExigido: a.nivelExigido, status: a.status, caixaId: a.caixaId, filialId: a.filialId, solicitanteId: a.solicitanteId, referenciaId: a.referenciaId, createdAt: a.createdAt, decisoes: (a.decisoes ?? []).map(serDecisao) };
}
function serAdq(a: any) {
  return { id: a.id, nome: a.nome, taxaDebito: Number(a.taxaDebito), taxaCredito: Number(a.taxaCredito), prazoDebitoDias: a.prazoDebitoDias, prazoCreditoDias: a.prazoCreditoDias, padrao: a.padrao };
}
