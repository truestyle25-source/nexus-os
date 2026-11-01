import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoQualquerDas } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { chaveDiaSql, minutosNoFuso, minutosTrabalhados } from '../radar/radar.regras.js';
import {
  TIPOS_FEEDBACK, STATUS_ACOMPANHAMENTO, ROTULO_TIPO, ROTULO_STATUS_ACOMP, TERMOS_LIDERANCA,
  cargoIndicaLideranca, minutosPrevistosPorDia, intervaloIrregular, INTERVALO_PADRAO_MIN,
  resumoJornada, resumoLideranca, acompanhamentoVencido, sugerirLideranca,
  type ContextoLideranca, type ResumoJornadaPessoa,
} from './lideranca.js';

/**
 * ROTAS — CICLO 3
 * =================
 *  * `lideranca.routes.ts`   — feedback de liderança + IA de liderança
 *  * (jornada fica em `gestao-tempo.routes.ts`, montado à parte)
 *
 * MULTI-TENANT
 * ------------
 * `empresaDoRequisicao(req)` na primeira linha, filtro em TODA consulta. Um id
 * de outra empresa é RECUSADO com 404 — não "filtrado e fica vazio", que
 * confirmaria a presença de um registro de terceiro.
 *
 * PERMISSÃO
 * ---------
 * Leitura aceita `rh:visualizar` OU `relatorios:visualizar`; escrita aceita
 * `rh:editar` OU `relatorios:editar`. Mesmo par dos Ciclos 1 e 2, verificado
 * no banco.
 */

function empresaDoRequisicao(req: FastifyRequest): string {
  const empresaId = (req as any).user?.empresaId;
  if (!empresaId) throw new Error('Empresa não identificada.');
  return empresaId;
}

function hojeUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
}
const hojeIso = () => chaveDiaSql(hojeUtc());
const periodoCorrente = () => hojeIso().slice(0, 7);

const DIAS_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIODO_RE = /^\d{4}-\d{2}$/;

async function nomesUsuarios(ids: Array<string | null>): Promise<Map<string, string>> {
  const limpo = ids.filter((x): x is string => Boolean(x));
  if (limpo.length === 0) return new Map();
  const us = await prisma.usuario.findMany({ where: { id: { in: limpo } }, select: { id: true, nome: true } });
  return new Map(us.map((u) => [u.id, u.nome]));
}

const criarSchema = z.object({
  funcionarioId: z.string().min(1),
  data: z.string().regex(DIAS_RE, 'Data deve estar em AAAA-MM-DD.'),
  tipo: z.enum(TIPOS_FEEDBACK),
  pontosPositivos: z.string().min(3, 'Descreva o que foi reconhecido.').max(2000),
  pontosADesenvolver: z.string().min(3, 'Descreva o que precisa desenvolver.').max(2000),
  acordos: z.string().max(2000).optional().nullable(),
  proximoAcompanhamento: z.string().regex(DIAS_RE, 'Data deve estar em AAAA-MM-DD.').optional().nullable(),
  observacoes: z.string().max(2000).optional().nullable(),
});

const atualizarSchema = z.object({
  pontosPositivos: z.string().min(3).max(2000).optional(),
  pontosADesenvolver: z.string().min(3).max(2000).optional(),
  acordos: z.string().max(2000).optional().nullable(),
  proximoAcompanhamento: z.string().regex(DIAS_RE).optional().nullable(),
  observacoes: z.string().max(2000).optional().nullable(),
  /** Marca o acompanhamento como等都 feito (ou cancelado). */
  status: z.enum(STATUS_ACOMPANHAMENTO).optional(),
  realizadoEm: z.string().regex(DIAS_RE).optional().nullable(),
});

const analisarSchema = z.object({
  periodo: z.string().regex(PERIODO_RE, 'Período deve estar em AAAA-MM.').optional(),
});

function paraDTO(f: any, nomeAplicador: string | null) {
  return {
    id: f.id,
    funcionarioId: f.funcionarioId,
    funcionario: f.funcionario?.nome ?? '—',
    departamento: f.funcionario?.departamento?.nome ?? null,
    cargo: f.funcionario?.cargo?.nome ?? null,
    // `true` vem do CARGO, não de campo novo. A tela mostra a etiqueta para
    // que o gestor entenda por que aquela pessoa entrou na lista.
    lideranca: cargoIndicaLideranca(f.funcionario?.cargo?.nome),
    aplicadoPorId: f.aplicadoPorId,
    aplicadoPor: nomeAplicador,
    data: chaveDiaSql(f.data),
    tipo: f.tipo,
    tipoRotulo: ROTULO_TIPO[f.tipo as keyof typeof ROTULO_TIPO] ?? f.tipo,
    pontosPositivos: f.pontosPositivos,
    pontosADesenvolver: f.pontosADesenvolver,
    acordos: f.acordos,
    proximoAcompanhamento: f.proximoAcompanhamento ? chaveDiaSql(f.proximoAcompanhamento) : null,
    status: f.status,
    statusRotulo: ROTULO_STATUS_ACOMP[f.status as keyof typeof ROTULO_STATUS_ACOMP] ?? f.status,
    vencido: f.status === 'PENDENTE' && acompanhamentoVencido(f.proximoAcompanhamento, hojeUtc()),
    realizadoEm: f.realizadoEm ? chaveDiaSql(f.realizadoEm) : null,
    observacoes: f.observacoes,
    origem: f.origem,
    createdAt: f.createdAt,
  };
}

const INCLUIR_FUNC = {
  funcionario: {
    select: { nome: true, cargo: { select: { nome: true } }, departamento: { select: { nome: true } } },
  },
} as const;

export async function liderancaRoutes(app: FastifyInstance): Promise<void> {
  const iaLimiter = (await import('../../middlewares/rateLimiter.js')).createRateLimiter(20, 60_000);

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

  /**
   * GET /rh/lideranca/indicadores
   *
   * Os seis indicadores do ciclo 3. `liderancas` vem do CARGO — e quando vale
   * zero, a tela escreve isso. O sistema não "aproxima" ninguém de líder.
   */
  app.get('/rh/lideranca/indicadores', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const q = req.query ?? {};
      const de = typeof q.de === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.de) ? q.de : null;
      const ate = typeof q.ate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.ate) ? q.ate : null;
      const fim = ate ?? hojeIso();
      const inicio = de ?? `${fim.slice(0, 7)}-01`;
      const ini = new Date(`${inicio}T12:00:00`);
      const fimDate = new Date(`${fim}T12:00:00`);

      const [funcs, feedbacks, planos, treinamentos] = await Promise.all([
        prisma.funcionario.findMany({
          where: { empresaId, status: { in: ['ATIVO', 'FERIAS', 'AFASTADO'] } },
          select: { id: true, nome: true, cargo: { select: { nome: true } }, departamento: { select: { nome: true } } },
        }),
        prisma.feedbackLideranca.findMany({
          where: { empresaId, data: { gte: ini, lte: fimDate } },
          select: { id: true, funcionarioId: true, status: true, proximoAcompanhamento: true },
        }),
        prisma.planoDesenvolvimento.count({ where: { empresaId, status: { not: 'CANCELADO' } } }),
        prisma.participanteTreinamento.count({ where: { empresaId, status: 'PRESENTE' } }),
      ]);

      const lideres = funcs.filter((f) => cargoIndicaLideranca(f.cargo?.nome));
      const idsLideres = new Set(lideres.map((f) => f.id));
      const idsComFeedback = new Set(feedbacks.map((f) => f.funcionarioId));
      const hj = hojeUtc();
      const pendentes = feedbacks.filter((f) => f.status === 'PENDENTE');
      const vencidos = pendentes.filter((f) => acompanhamentoVencido(f.proximoAcompanhamento, hj));

      return reply.send({
        periodo: { de: inicio, ate: fim },
        resumo: resumoLideranca({
          liderancas: lideres.length,
          feedbacks: feedbacks.length,
          acompanhamentosPendentes: pendentes.length,
          proximosVencidos: vencidos.length,
          planosAtivos: planos,
          treinamentosConcluidos: treinamentos,
          liderancasComFeedback: lideres.filter((f) => idsComFeedback.has(f.id)).length,
        }),
        lideres: lideres.map((f) => ({
          id: f.id, nome: f.nome, cargo: f.cargo?.nome ?? null, departamento: f.departamento?.nome ?? null,
        })),
        proximosAcompanhamentos: pendentes
          .sort((a, b) => String(a.proximoAcompanhamento ?? '9999').localeCompare(String(b.proximoAcompanhamento ?? '9999')))
          .slice(0, 10)
          .map((f) => ({ id: f.id, funcionarioId: f.funcionarioId })),
        // Explicita a CONVENÇÃO usada. O gestor precisa saber por que aquela
        // pessoa é considerada líder.
        criterioLideranca: { termos: [...TERMOS_LIDERANCA], fonte: 'cargo' },
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao ler indicadores de liderança');
      return reply.status(500).send({ error: 'Não foi possível ler os indicadores.' });
    }
  });

  /** GET /rh/lideranca/feedbacks */
  app.get('/rh/lideranca/feedbacks', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const q = req.query ?? {};
      const funcionarioId = typeof q.funcionarioId === 'string' ? q.funcionarioId : null;
      const status = typeof q.status === 'string' && STATUS_ACOMPANHAMENTO.includes(q.status as any)
        ? (q.status as any) : null;

      if (funcionarioId) {
        const f = await prisma.funcionario.findFirst({ where: { id: funcionarioId, empresaId }, select: { id: true } });
        if (!f) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });
      }

      const feedbacks = await prisma.feedbackLideranca.findMany({
        where: { empresaId, ...(funcionarioId ? { funcionarioId } : {}), ...(status ? { status } : {}) },
        orderBy: [{ data: 'desc' }],
        take: 100,
        include: INCLUIR_FUNC,
      });
      const nomes = await nomesUsuarios(feedbacks.map((f) => f.aplicadoPorId));
      return reply.send({
        total: feedbacks.length,
        feedbacks: feedbacks.map((f) => paraDTO(f, nomes.get(f.aplicadoPorId) ?? null)),
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao listar feedbacks');
      return reply.status(500).send({ error: 'Não foi possível ler os feedbacks.' });
    }
  });

  /** POST /rh/lideranca/feedbacks */
  app.post('/rh/lideranca/feedbacks', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = criarSchema.parse(req.body ?? {});

      if (b.data > hojeIso()) {
        return reply.status(400).send({ error: 'A data do feedback não pode estar no futuro.' });
      }
      const f = await prisma.funcionario.findFirst({
        where: { id: b.funcionarioId, empresaId, status: { in: ['ATIVO', 'FERIAS', 'AFASTADO'] } },
        select: { id: true, nome: true },
      });
      if (!f) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });
      if (b.proximoAcompanhamento && b.proximoAcompanhamento < b.data) {
        return reply.status(400).send({ error: 'O próximo acompanhamento não pode ser anterior ao feedback.' });
      }

      const criado = await prisma.$transaction(async (tx) => {
        const fb = await tx.feedbackLideranca.create({
          data: {
            empresaId,
            funcionarioId: b.funcionarioId,
            aplicadoPorId: req.user.id,
            data: new Date(`${b.data}T12:00:00`),
            tipo: b.tipo,
            pontosPositivos: b.pontosPositivos.trim(),
            pontosADesenvolver: b.pontosADesenvolver.trim(),
            acordos: b.acordos?.trim() || null,
            proximoAcompanhamento: b.proximoAcompanhamento ? new Date(`${b.proximoAcompanhamento}T12:00:00`) : null,
            observacoes: b.observacoes ?? null,
            status: 'PENDENTE',
            origem: 'MANUAL',
          },
          include: INCLUIR_FUNC,
        });
        await registrarAuditoria({
          usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'FeedbackLideranca', entidadeId: fb.id,
          valorNovo: { funcionario: f.nome, tipo: b.tipo, proximoAcompanhamento: b.proximoAcompanhamento ?? null },
          origem: 'MANUAL', ip: req.ip,
          contexto: `Feedback ${b.tipo} registrado para ${f.nome}`,
        });
        return fb;
      });

      const nomes = await nomesUsuarios([criado.aplicadoPorId]);
      return reply.status(201).send(paraDTO(criado, nomes.get(criado.aplicadoPorId) ?? null));
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao registrar feedback');
      return reply.status(500).send({ error: 'Não foi possível registrar o feedback.' });
    }
  });

  /**
   * PATCH /rh/lideranca/feedbacks/:id
   *
   * Marca o acompanhamento como REALIZADO, edita os blocos, ou cancela.
   * Marcar como realizado grava `realizadoEm` — a conversa aconteceu em algum
   * dia, e "realizado" sem data é registro incompleto.
   */
  app.patch('/rh/lideranca/feedbacks/:id', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = atualizarSchema.parse(req.body ?? {});
      const atual = await prisma.feedbackLideranca.findFirst({
        where: { id: req.params.id, empresaId },
        select: { id: true, status: true, proximoAcompanhamento: true },
      });
      if (!atual) return reply.status(404).send({ error: 'Feedback não encontrado nesta empresa.' });

      let realizadoEm: Date | null | undefined;
      if (b.status === 'REALIZADO') {
        const d = b.realizadoEm ?? hojeIso();
        if (d > hojeIso()) return reply.status(400).send({ error: 'A data do acompanhamento não pode estar no futuro.' });
        realizadoEm = new Date(`${d}T12:00:00`);
      }

      const alterado = await prisma.$transaction(async (tx) => {
        const fb = await tx.feedbackLideranca.update({
          where: { id: atual.id },
          data: {
            ...(b.pontosPositivos ? { pontosPositivos: b.pontosPositivos.trim() } : {}),
            ...(b.pontosADesenvolver ? { pontosADesenvolver: b.pontosADesenvolver.trim() } : {}),
            ...(b.acordos !== undefined ? { acordos: b.acordos?.trim() || null } : {}),
            ...(b.proximoAcompanhamento !== undefined
              ? { proximoAcompanhamento: b.proximoAcompanhamento ? new Date(`${b.proximoAcompanhamento}T12:00:00`) : null }
              : {}),
            ...(b.observacoes !== undefined ? { observacoes: b.observacoes } : {}),
            ...(b.status ? { status: b.status as any } : {}),
            ...(b.status === 'REALIZADO' ? { realizadoEm: realizadoEm ?? null } : {}),
            ...(b.status === 'CANCELADO' ? { realizadoEm: null } : {}),
          },
          include: INCLUIR_FUNC,
        });
        await registrarAuditoria({
          usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'FeedbackLideranca', entidadeId: fb.id,
          valorAnterior: { status: atual.status }, valorNovo: { status: fb.status },
          origem: 'MANUAL', ip: req.ip,
          contexto: `Feedback ${atual.status} → ${fb.status}`,
        });
        return fb;
      });

      const nomes = await nomesUsuarios([alterado.aplicadoPorId]);
      return reply.send(paraDTO(alterado, nomes.get(alterado.aplicadoPorId) ?? null));
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao atualizar feedback');
      return reply.status(500).send({ error: 'Não foi possível atualizar o feedback.' });
    }
  });

  /**
   * POST /rh/lideranca/analisar
   *
   * PERGUNTA À IA. NÃO GRAVA NADA.
   *
   * A IA recebe CONTAGENS AGREGADAS por departamento — nunca nome, cargo
   * individual, CPF ou id. A sugestão passa por `validarSugestaoLideranca`,
   * que descarta valor fora do catálogo, barra justificativa com número
   * inventado e REJEITA o texto que soar a diagnóstico.
   *
   * Base mínima: sem líder identificado, a resposta é "dados insuficientes" —
   * sugerir algo sobre liderança sem saber quem lidera seria inventar.
   */
  app.post(
    '/rh/lideranca/analisar',
    { preHandler: [...leitura.preHandler, iaLimiter] },
    async (req: any, reply) => {
      try {
        const empresaId = empresaDoRequisicao(req);
        const b = analisarSchema.parse(req.body ?? {});
        const periodo = b.periodo ?? periodoCorrente();
        const [ano, mes] = periodo.split('-').map(Number);
        const ini = new Date(Date.UTC(ano, mes - 1, 1));
        const fim = new Date(Date.UTC(ano, mes, 1));

        const [funcs, feedbacks, planos, treinamentos, pontos] = await Promise.all([
          prisma.funcionario.findMany({
            where: { empresaId, status: { in: ['ATIVO', 'FERIAS', 'AFASTADO'] } },
            select: { id: true, departamento: { select: { nome: true } }, cargo: { select: { nome: true } } },
          }),
          prisma.feedbackLideranca.findMany({
            where: { empresaId, data: { gte: ini, lt: fim } },
            select: { id: true, funcionarioId: true, status: true, proximoAcompanhamento: true },
          }),
          prisma.planoDesenvolvimento.findMany({
            where: { empresaId, status: { not: 'CANCELADO' } }, select: { funcionarioId: true },
          }),
          prisma.participanteTreinamento.findMany({
            where: { empresaId, status: 'PRESENTE' }, select: { funcionarioId: true, treinamento: { select: { data: true } } },
          }),
          prisma.ponto.findMany({
            where: { empresaId, data: { gte: ini, lt: fim } },
            select: { funcionarioId: true, horaExtraMinutos: true, atrasoMinutos: true },
          }),
        ]);

        const hj = hojeUtc();
        const totais = {
          liderancas: funcs.filter((f) => cargoIndicaLideranca(f.cargo?.nome)).length,
          feedbacks: feedbacks.length,
          acompanhamentosPendentes: feedbacks.filter((f) => f.status === 'PENDENTE').length,
          planosAtivos: planos.length,
          treinamentosConcluidos: treinamentos.length,
        };

        const idParaNome = new Map<string, string>();
        const mapa = new Map<string, ContextoLideranca['departamentos'][number]>();
        for (const f of funcs) {
          const nome = f.departamento?.nome ?? 'SEM DEPARTAMENTO';
          if (!mapa.has(nome)) {
            mapa.set(nome, {
              nome, liderancas: 0, pessoas: 0, feedbacks: 0,
              acompanhamentosPendentes: 0, horasExtrasMin: 0, atrasosDias: 0,
            });
          }
          idParaNome.set(f.id, nome);
          mapa.get(nome)!.pessoas += 1;
          if (cargoIndicaLideranca(f.cargo?.nome)) mapa.get(nome)!.liderancas += 1;
        }
        for (const fb of feedbacks) {
          const nome = idParaNome.get(fb.funcionarioId);
          if (!nome) continue;
          mapa.get(nome)!.feedbacks += 1;
          if (fb.status === 'PENDENTE' && acompanhamentoVencido(fb.proximoAcompanhamento, hj)) {
            mapa.get(nome)!.acompanhamentosPendentes += 1;
          }
        }
        for (const pt of pontos) {
          const nome = idParaNome.get(pt.funcionarioId);
          if (!nome) continue;
          const d = mapa.get(nome)!;
          d.horasExtrasMin += pt.horaExtraMinutos ?? 0;
          if ((pt.atrasoMinutos ?? 0) > 0) d.atrasosDias += 1;
        }

        const departamentos = [...mapa.values()];
        const indicadores = { totais, porDepartamento: departamentos };

        // Sem ninguém identificado como líder, sugerir algo sobre liderança
        // seria inventar o próprio objeto da conversa.
        if (totais.liderancas === 0) {
          return reply.send({
            sugestao: null,
            dadosInsuficientes: true,
            motivo: 'Nenhum cargo desta empresa é reconhecido como liderança. Cadastre o cargo (ex.: Líder, Coordenador, Gestor) para habilitar a análise.',
            periodo,
            ...indicadores,
          });
        }

        const r = await sugerirLideranca({
          periodo,
          totais,
          departamentos,
          opcoes: { tipoFeedback: TIPOS_FEEDBACK },
        });

        if (!r.ok) {
          return reply.send({ sugestao: null, dadosInsuficientes: r.dadosInsuficientes, motivo: r.motivo, periodo, ...indicadores });
        }
        return reply.send({
          sugestao: r.analise,
          descartes: r.descartes,
          numerosNaoVerificados: r.numerosNaoVerificados,
          periodo,
          ...indicadores,
        });
      } catch (erro: any) {
        if (erro instanceof z.ZodError) throw erro;
        req.log.error(erro, 'Falha ao pedir sugestão de liderança');
        return reply.status(500).send({ error: 'Não foi possível pedir a sugestão.' });
      }
    },
  );
}
