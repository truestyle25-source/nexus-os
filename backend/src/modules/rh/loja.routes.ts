import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoQualquerDas } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { chaveDiaSql } from '../radar/radar.regras.js';
import {
  STATUS_RESGATE, CATEGORIAS_RECOMPENSA, ROTULO_CATEGORIA, ROTULO_STATUS,
  saldoDePontos, avaliarElegibilidade, podeTransicionar, estoqueVisivel, apareceNaVitrine,
} from './loja.js';

/**
 * ROTAS — LOJA DE RECOMPENSAS (Ciclo 4)
 * ========================================
 *
 * MULTI-TENANT
 * ------------
 * `empresaDoRequisicao(req)` na primeira linha, filtro em TODA consulta. Um id
 * de outra empresa é RECUSADO com 404.
 *
 * PERMISSÃO
 * ---------
 * Leitura aceita `rh:visualizar` OU `relatorios:visualizar`; escrita aceita
 * `rh:editar` OU `relatorios:editar` — o mesmo par dos Ciclos 1 a 3.
 *
 * DUAS PESSOAS, UMA TELA
 * ----------------------
 * O FUNCIONÁRIO pede o resgate e o GESTOR decide. Por isso os dois fluxos
 * vivem aqui e a auditoria registra QUEM fez cada passo: `aprovadoPorId` só é
 * preenchido quando alguém realmente aprovou.
 */

function empresaDoRequisicao(req: FastifyRequest): string {
  const empresaId = (req as any).user?.empresaId;
  if (!empresaId) throw new Error('Empresa não identificada.');
  return empresaId;
}
const hojeIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getDate())}`;
};
const DIAS_RE = /^\d{4}-\d{2}-\d{2}$/;

async function nomesUsuarios(ids: Array<string | null>): Promise<Map<string, string>> {
  const limpo = ids.filter((x): x is string => Boolean(x));
  if (limpo.length === 0) return new Map();
  const us = await prisma.usuario.findMany({ where: { id: { in: limpo } }, select: { id: true, nome: true } });
  return new Map(us.map((u) => [u.id, u.nome]));
}

const recompensaSchema = z.object({
  nome: z.string().min(2, 'Informe o nome.').max(160),
  descricao: z.string().min(3, 'Descreva a recompensa.').max(1000),
  categoria: z.enum(CATEGORIAS_RECOMPENSA),
  // `>= 1`: uma recompensa de 0 ponto é um brinde grátis, e isso é outra
  // funcionalidade. Se a empresa quiser, cadastra com 1 ponto.
  custoPontos: z.number().int().positive('O custo deve ser maior que zero.').max(100000),
  quantidadeDisponivel: z.number().int().min(0).max(100000),
  ativa: z.boolean().optional(),
  observacoes: z.string().max(2000).optional().nullable(),
});

const atualizarSchema = z.object({
  nome: z.string().min(2).max(160).optional(),
  descricao: z.string().min(3).max(1000).optional(),
  categoria: z.enum(CATEGORIAS_RECOMPENSA).optional(),
  custoPontos: z.number().int().positive().max(100000).optional(),
  quantidadeDisponivel: z.number().int().min(0).max(100000).optional(),
  ativa: z.boolean().optional(),
  observacoes: z.string().max(2000).optional().nullable(),
});

const resgatarSchema = z.object({
  recompensaId: z.string().min(1),
  funcionarioId: z.string().min(1),
  observacoes: z.string().max(1000).optional().nullable(),
});

const decidirSchema = z.object({
  status: z.enum(STATUS_RESGATE),
  observacoes: z.string().max(1000).optional().nullable(),
});

function paraDTO(r: any) {
  return {
    id: r.id, nome: r.nome, descricao: r.descricao, categoria: r.categoria,
    categoriaRotulo: ROTULO_CATEGORIA[r.categoria as keyof typeof ROTULO_CATEGORIA] ?? r.categoria,
    custoPontos: r.custoPontos,
    quantidadeDisponivel: estoqueVisivel(r.quantidadeDisponivel),
    ativa: r.ativa, observacoes: r.observacoes,
    // Uma recompensa inativa/esgotada não pode ser resgatada — e a tela
    // precisa saber disso ANTES de o gestor clicar.
    disponivel: apareceNaVitrine(r.ativa, r.quantidadeDisponivel),
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export async function lojaRoutes(app: FastifyInstance): Promise<void> {
  const leitura = {
    preHandler: [
      (app as any).authenticate,
      permissaoQualquerDas([
        { modulo: 'rh', acao: 'visualizar' },
        { modulo: 'relatorios', acao: 'visualizar' },
      ]),
    ],
  };
  const escrita = {
    preHandler: [
      (app as any).authenticate,
      permissaoQualquerDas([
        { modulo: 'rh', acao: 'editar' },
        { modulo: 'relatorios', acao: 'editar' },
      ]),
    ],
  };

  /** GET /rh/loja/recompensas — o catálogo. */
  app.get('/rh/loja/recompensas', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const q = req.query ?? {};
      const soAtivas = q.ativas === 'true';
      const itens = await prisma.recompensa.findMany({
        where: { empresaId, ...(soAtivas ? { ativa: true } : {}) },
        orderBy: [{ ativa: 'desc' }, { nome: 'asc' }],
        take: 200,
      });
      return reply.send({ total: itens.length, recompensas: itens.map(paraDTO) });
    } catch (erro: any) {
      req.log.error(erro, 'Falha ao listar recompensas');
      return reply.status(500).send({ error: 'Não foi possível ler a loja.' });
    }
  });

  /** POST /rh/loja/recompensas — cadastra no catálogo. */
  app.post('/rh/loja/recompensas', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = recompensaSchema.parse(req.body ?? {});
      const r = await prisma.$transaction(async (tx) => {
        const criada = await tx.recompensa.create({
          data: {
            empresaId, nome: b.nome.trim(), descricao: b.descricao.trim(),
            categoria: b.categoria, custoPontos: b.custoPontos,
            quantidadeDisponivel: b.quantidadeDisponivel,
            ativa: b.ativa ?? true, observacoes: b.observacoes ?? null,
          },
        });
        await registrarAuditoria({
          usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'Recompensa', entidadeId: criada.id,
          valorNovo: { nome: criada.nome, custoPontos: criada.custoPontos, estoque: criada.quantidadeDisponivel },
          origem: 'MANUAL', ip: req.ip,
          contexto: `Recompensa "${criada.nome}" cadastrada por ${criada.custoPontos} pontos`,
        });
        return criada;
      });
      return reply.status(201).send(paraDTO(r));
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao cadastrar recompensa');
      return reply.status(500).send({ error: 'Não foi possível cadastrar a recompensa.' });
    }
  });

  /** PATCH /rh/loja/recompensas/:id — edita, reativa ou desativa. */
  app.patch('/rh/loja/recompensas/:id', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = atualizarSchema.parse(req.body ?? {});
      const atual = await prisma.recompensa.findFirst({
        where: { id: req.params.id, empresaId }, select: { id: true, nome: true },
      });
      if (!atual) return reply.status(404).send({ error: 'Recompensa não encontrada nesta empresa.' });

      const r = await prisma.$transaction(async (tx) => {
        const p = await tx.recompensa.update({
          where: { id: atual.id },
          data: {
            ...(b.nome ? { nome: b.nome.trim() } : {}),
            ...(b.descricao ? { descricao: b.descricao.trim() } : {}),
            ...(b.categoria ? { categoria: b.categoria } : {}),
            ...(b.custoPontos !== undefined ? { custoPontos: b.custoPontos } : {}),
            ...(b.quantidadeDisponivel !== undefined ? { quantidadeDisponivel: b.quantidadeDisponivel } : {}),
            ...(b.ativa !== undefined ? { ativa: b.ativa } : {}),
            ...(b.observacoes !== undefined ? { observacoes: b.observacoes } : {}),
          },
        });
        await registrarAuditoria({
          usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'Recompensa', entidadeId: p.id,
          valorAnterior: { nome: atual.nome },
          valorNovo: { nome: p.nome, ativa: p.ativa, custoPontos: p.custoPontos, estoque: p.quantidadeDisponivel },
          origem: 'MANUAL', ip: req.ip, contexto: `Recompensa "${p.nome}" atualizada`,
        });
        return p;
      });
      return reply.send(paraDTO(r));
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao atualizar recompensa');
      return reply.status(500).send({ error: 'Não foi possível atualizar a recompensa.' });
    }
  });

  /**
   * GET /rh/loja/saldos
   *
   * O saldo de cada funcionário ativo, calculado da fórmula — nunca de coluna.
   * Sem registros e sem resgates, o saldo é 0 e a tela escreve "0 pontos", em
   * vez de esconder a pessoa da lista.
   */
  app.get('/rh/loja/saldos', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const [funcs, registros, resgates] = await Promise.all([
        prisma.funcionario.findMany({
          where: { empresaId, status: { in: ['ATIVO', 'FERIAS', 'AFASTADO'] } },
          select: { id: true, nome: true, departamento: { select: { nome: true } } },
        }),
        prisma.registroGamificacao.findMany({
          where: { empresaId, funcionarioId: { not: null } },
          select: { funcionarioId: true, pontos: true, status: true },
        }),
        prisma.resgateRecompensa.findMany({
          where: { empresaId },
          select: { funcionarioId: true, pontosUtilizados: true, status: true },
        }),
      ]);
      const porPessoa = new Map<string, { ganhos: number; resgates: typeof resgates }>();
      for (const f of funcs) porPessoa.set(f.id, { ganhos: 0, resgates: [] });
      for (const r of registros) {
        const acc = porPessoa.get(r.funcionarioId!);
        if (acc) acc.ganhos += r.pontos;
      }
      for (const r of resgates) {
        const acc = porPessoa.get(r.funcionarioId);
        if (acc) acc.resgates.push(r);
      }
      const saldos = funcs.map((f) => {
        const acc = porPessoa.get(f.id)!;
        return {
          funcionarioId: f.id, nome: f.nome, departamento: f.departamento?.nome ?? null,
          saldo: saldoDePontos(
            registros.filter((r) => r.funcionarioId === f.id).map((r) => ({ pontos: r.pontos, status: r.status })),
            acc.resgates,
          ),
        };
      }).sort((a, b) => b.saldo - a.saldo);
      return reply.send({ total: saldos.length, saldos });
    } catch (erro: any) {
      req.log.error(erro, 'Falha ao ler saldos');
      return reply.status(500).send({ error: 'Não foi possível ler os saldos.' });
    }
  });

  /**
   * POST /rh/loja/resgates — a solicitação de resgate.
   *
   * VALIDA TUDO ANTES DE GRAVAR, e o estoque é debitado NA MESMA TRANSAÇÃO da
   * criação do resgate. Sem isso, duas requisições simultâneas poderiam ler
   * "estoque 1", passar as duas, e criar dois resgates do último vale-presente.
   *
   * Os pontos são debitados pela FÓRMULA, não por um lançamento negativo: um
   * resgate SOLICITADO não consome pontos (é uma reserva de estoque), e vira
   * consumo quando o gestor APROVAR. A tela mostra essa diferença.
   */
  app.post('/rh/loja/resgates', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = resgatarSchema.parse(req.body ?? {});

      const func = await prisma.funcionario.findFirst({
        where: { id: b.funcionarioId, empresaId, status: { in: ['ATIVO', 'FERIAS', 'AFASTADO'] } },
        select: { id: true, nome: true },
      });
      if (!func) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });

      const resgate = await prisma.$transaction(async (tx) => {
        // `updateMany` com `quantidadeDisponivel: { gt: 0 }` faz o decremento
        // condicional no próprio banco: se outra transação pegou o último,
        // `count` vem 0 e abortamos.
        const debito = await tx.recompensa.updateMany({
          where: { id: b.recompensaId, empresaId, ativa: true, quantidadeDisponivel: { gt: 0 } },
          data: { quantidadeDisponivel: { decrement: 1 } },
        });
        if (debito.count === 0) {
          const atual = await tx.recompensa.findFirst({ where: { id: b.recompensaId, empresaId }, select: { ativa: true, quantidadeDisponivel: true } });
          if (!atual) throw new Error('RECOMPENSA_NAO_ENCONTRADA');
          throw new Error(atual.ativa ? 'SEM_ESTOQUE' : 'RECOMPENSA_INATIVA');
        }

        const recompensa = await tx.recompensa.findUniqueOrThrow({ where: { id: b.recompensaId }, select: { custoPontos: true } });

        // Saldo no instante da solicitação, com o resgate AINDA fora da conta
        // (ele é SOLICITADO, não consome). Se já dá para pedir, segue.
        const registros = await tx.registroGamificacao.findMany({
          where: { empresaId, funcionarioId: func.id },
          select: { pontos: true, status: true },
        });
        const meusResgates = await tx.resgateRecompensa.findMany({
          where: { empresaId, funcionarioId: func.id },
          select: { recompensaId: true, pontosUtilizados: true, status: true },
        });
        // A trava e POR RECOMPENSA: quem tem um vale em andamento ainda pode
        // resgatar outro item do catalogo. Filtrar sem `recompensaId` barrava
        // qualquer resgate da pessoa com uma mensagem que mentia.
        const STATUS_ATIVO = ['SOLICITADO', 'APROVADO'];
        const jaAtivo = meusResgates.some(
          (r) => r.recompensaId === b.recompensaId && STATUS_ATIVO.includes(r.status),
        );
        const saldo = saldoDePontos(registros, meusResgates);
        const eleg = avaliarElegibilidade({
          ativo: true, quantidadeDisponivel: 1, custoPontos: recompensa.custoPontos, saldo, jaResgatouAtivo: jaAtivo,
        });
        if (!eleg.pode) throw new Error(eleg.motivo ?? 'BLOQUEADO');

        const resgate = await tx.resgateRecompensa.create({
          data: {
            empresaId, recompensaId: b.recompensaId, funcionarioId: func.id,
            pontosUtilizados: recompensa.custoPontos, status: 'SOLICITADO',
            data: new Date(`${hojeIso()}T12:00:00`),
            observacoes: b.observacoes ?? null,
          },
        });
        await registrarAuditoria({
          usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'ResgateRecompensa', entidadeId: resgate.id,
          valorNovo: { funcionario: func.nome, pontos: resgate.pontosUtilizados, status: 'SOLICITADO' },
          origem: 'MANUAL', ip: req.ip,
          contexto: `Resgate solicitado para ${func.nome} por ${resgate.pontosUtilizados} pontos`,
        });
        return resgate;
      }).catch((e: any) => {
        // As recusas de negócio viram HTTP 409 com motivo claro; o resto é 500.
        const motivos = ['SEM_ESTOQUE', 'RECOMPENSA_INATIVA', 'PONTOS_INSUFICIENTES', 'JA_RESGATOU', 'RECOMPENSA_NAO_ENCONTRADA'];
        if (motivos.includes(e?.message)) {
          const err: any = new Error(e.message);
          err.codigo = e.message;
          throw err;
        }
        throw e;
      });

      return reply.status(201).send({
        id: resgate.id, status: resgate.status, pontosUtilizados: resgate.pontosUtilizados,
        mensagem: 'Resgate solicitado. Os pontos são consumidos quando o gestor aprovar.',
      });
    } catch (erro: any) {
      if (erro?.codigo === 'SEM_ESTOQUE') return reply.status(409).send({ error: 'Recompensa esgotada no momento.', codigo: erro.codigo });
      if (erro?.codigo === 'RECOMPENSA_INATIVA') return reply.status(409).send({ error: 'Esta recompensa não está mais disponível.', codigo: erro.codigo });
      if (erro?.codigo === 'RECOMPENSA_NAO_ENCONTRADA') return reply.status(404).send({ error: 'Recompensa não encontrada nesta empresa.', codigo: erro.codigo });
      if (erro?.codigo === 'PONTOS_INSUFICIENTES') return reply.status(409).send({ error: 'Pontos insuficientes para esta recompensa.', codigo: erro.codigo });
      if (erro?.codigo === 'JA_RESGATOU') return reply.status(409).send({ error: 'Já existe um resgate desta recompensa em andamento.', codigo: erro.codigo });
      req.log.error(erro, 'Falha ao solicitar resgate');
      return reply.status(500).send({ error: 'Não foi possível registrar o resgate.' });
    }
  });

  /**
   * GET /rh/loja/resgates
   *
   * `?funcionarioId=` traz o histórico de uma pessoa; `?status=SOLICITADO`
   * traz a fila de aprovação do gestor. Sem filtro, traz o histórico da
   * empresa — que é o "histórico administrativo" do ciclo 4.
   */
  app.get('/rh/loja/resgates', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const q = req.query ?? {};
      const funcionarioId = typeof q.funcionarioId === 'string' ? q.funcionarioId : null;
      const status = typeof q.status === 'string' && STATUS_RESGATE.includes(q.status as any) ? (q.status as any) : null;

      if (funcionarioId) {
        const f = await prisma.funcionario.findFirst({ where: { id: funcionarioId, empresaId }, select: { id: true } });
        if (!f) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });
      }

      const resgates = await prisma.resgateRecompensa.findMany({
        where: { empresaId, ...(funcionarioId ? { funcionarioId } : {}), ...(status ? { status } : {}) },
        orderBy: { data: 'desc' },
        take: 200,
        include: { recompensa: { select: { id: true, nome: true, categoria: true } } },
      });
      const funcs = await prisma.funcionario.findMany({
        where: { id: { in: [...new Set(resgates.map((r) => r.funcionarioId))] }, empresaId },
        select: { id: true, nome: true },
      });
      const nomeFunc = new Map(funcs.map((f) => [f.id, f.nome]));
      const nomes = await nomesUsuarios(resgates.map((r) => r.aprovadoPorId));

      return reply.send({
        total: resgates.length,
        resgates: resgates.map((r) => ({
          id: r.id,
          funcionarioId: r.funcionarioId,
          funcionario: nomeFunc.get(r.funcionarioId) ?? '—',
          recompensa: r.recompensa.nome,
          recompensaCategoria: r.recompensa.categoria,
          pontosUtilizados: r.pontosUtilizados,
          status: r.status,
          statusRotulo: ROTULO_STATUS[r.status as keyof typeof ROTULO_STATUS] ?? r.status,
          data: chaveDiaSql(r.data),
          aprovadoPor: nomes.get(r.aprovadoPorId ?? '') ?? null,
          aprovadoEm: r.aprovadoEm ? chaveDiaSql(r.aprovadoEm) : null,
          entregueEm: r.entregueEm ? chaveDiaSql(r.entregueEm) : null,
          observacoes: r.observacoes,
        })),
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao listar resgates');
      return reply.status(500).send({ error: 'Não foi possível ler os resgates.' });
    }
  });

  /**
   * PATCH /rh/loja/resgates/:id — a decisão do gestor.
   *
   * APROVAR é o momento em que os pontos passam a ser consumidos (pela fórmula
   * do saldo). REJEITAR ou CANCELAR devolvem o estoque, na MESMA transação
   * que muda o status — e a linha continua no histórico.
   *
   * ENTREGUE exige aprovação antes: entregar o que ninguém aprovou registraria
   * uma entrega sem decisão. A regra `podeTransicionar` barra isso.
   */
  app.patch('/rh/loja/resgates/:id', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = decidirSchema.parse(req.body ?? {});
      const atual = await prisma.resgateRecompensa.findFirst({
        where: { id: req.params.id, empresaId },
        select: { id: true, status: true, pontosUtilizados: true, recompensaId: true, funcionarioId: true },
      });
      if (!atual) return reply.status(404).send({ error: 'Resgate não encontrado nesta empresa.' });

      if (b.status === atual.status) {
        return reply.status(409).send({ error: `Este resgate já está ${ROTULO_STATUS[atual.status as keyof typeof ROTULO_STATUS]}.` });
      }
      if (!podeTransicionar(atual.status, b.status)) {
        return reply.status(409).send({
          error: `Não é possível mudar de ${ROTULO_STATUS[atual.status as keyof typeof ROTULO_STATUS]} para ${ROTULO_STATUS[b.status as keyof typeof ROTULO_STATUS]}.`,
        });
      }

      const hj = hojeIso();
      const r = await prisma.$transaction(async (tx) => {
        // A elegibilidade foi checada na SOLICITACAO, mas entre o pedido e a
        // aprovacao o saldo pode ter cair (outro resgate aprovado, lancamento
        // estornado). Revalidar aqui evita aprovar o que o dia da decisao nao
        // paga mais.
        if (b.status === 'APROVADO') {
          const registros = await tx.registroGamificacao.findMany({
            where: { empresaId, funcionarioId: atual.funcionarioId },
            select: { pontos: true, status: true },
          });
          const resgates = await tx.resgateRecompensa.findMany({
            where: { empresaId, funcionarioId: atual.funcionarioId, status: { in: ['APROVADO', 'ENTREGUE'] } },
            select: { pontosUtilizados: true },
          });
          const saldo = saldoDePontos(registros, resgates.map((x) => ({ pontosUtilizados: x.pontosUtilizados, status: 'APROVADO' as const })));
          if (saldo < atual.pontosUtilizados) {
            const err: any = new Error('PONTOS_INSUFICIENTES');
            err.codigo = 'PONTOS_INSUFICIENTES';
            throw err;
          }
        }
        const salvo = await tx.resgateRecompensa.update({
          where: { id: atual.id },
          data: {
            status: b.status as any,
            // Quem aprovou vem do TOKEN, nunca do corpo.
            ...(b.status === 'APROVADO' ? { aprovadoPorId: req.user.id, aprovadoEm: new Date(`${hj}T12:00:00`) } : {}),
            ...(b.status === 'ENTREGUE' ? { entregueEm: new Date(`${hj}T12:00:00`) } : {}),
            ...(b.observacoes !== undefined ? { observacoes: b.observacoes } : {}),
          },
        });
        // Recusar/cancelar devolve o estoque, na mesma transação que muda o
        // status — se a transação falhar, os dois continuam como estavam.
        if (b.status === 'REJEITADO' || b.status === 'CANCELADO') {
          await tx.recompensa.updateMany({
            where: { id: salvo.recompensaId, empresaId },
            data: { quantidadeDisponivel: { increment: 1 } },
          });
        }
        await registrarAuditoria({
          usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'ResgateRecompensa', entidadeId: salvo.id,
          valorAnterior: { status: atual.status }, valorNovo: { status: b.status, por: req.user.id },
          origem: 'MANUAL', ip: req.ip,
          contexto: `Resgate ${atual.status} → ${b.status} (${atual.pontosUtilizados} pontos)`,
        });
        return salvo;
      });

      const mensagem = b.status === 'APROVADO'
        ? 'Resgate aprovado. Os pontos foram consumidos.'
        : b.status === 'REJEITADO' || b.status === 'CANCELADO'
          ? 'Resgate encerrado. Os pontos voltaram ao saldo e o estoque foi devolvido.'
          : 'Resgate marcado como entregue.';
      return reply.send({ id: r.id, status: r.status, mensagem });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      // O saldo pode ter caído entre o pedido e a decisão. Isso é recusa de
      // negócio, não falha: 409 com o motivo, para o gestor entender o que houve.
      if (erro?.codigo === 'PONTOS_INSUFICIENTES') {
        return reply.status(409).send({
          error: 'O saldo da pessoa ficou abaixo do custo do resgate depois que ele foi solicitado. Revise os pontos ou o cadastro da recompensa.',
          codigo: erro.codigo,
        });
      }
      req.log.error(erro, 'Falha ao decidir resgate');
      return reply.status(500).send({ error: 'Não foi possível atualizar o resgate.' });
    }
  });
}
