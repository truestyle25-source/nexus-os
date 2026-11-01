import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoQualquerDas } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import {
  EVENTOS, OPERADORES, PERIODOS, DESCRICAO_EVENTO, ROTULO_OPERADOR, ROTULO_PERIODO,
  cumprE, chavePeriodo, intervaloPeriodo, descreverEvidencia,
  validarCriterio, validarLancamentoManual,
  type EventoPontuacao, type PeriodoCriterio,
} from './pontuacao.js';

/**
 * ROTAS — PONTUAÇÃO CONFIGURÁVEL (Ciclo 5)
 * ==========================================
 *
 * MULTI-TENANT
 * ------------
 * `empresaDoRequisicao(req)` na primeira linha e filtro `empresaId` em TODA
 * consulta. Critério, avaliação e lançamento de uma empresa não são visíveis
 * nem alteráveis por outra. Duas empresas com o mesmo nome de critério e
 * valores diferentes é o comportamento esperado, não um conflito.
 *
 * PERMISSÃO
 * ---------
 * Leitura aceita `rh:visualizar` OU `relatorios:visualizar`; escrita aceita
 * `rh:editar` OU `relatorios:editar` — o mesmo par dos Ciclos 1 a 4.
 *
 * O QUE O NEXUS FAZ E O QUE ELE NÃO FAZ
 * --------------------------------------
 * FAZ: mede o evento real, compara com a condição da empresa, credita a
 * quantidade que a empresa configurou, guarda a evidência, mantém o histórico.
 *
 * NÃO FAZ: não decide quanto vale ausência, não cria critério sozinho, não
 * credita nada sem critério configurado e não inventa ponto para empresa
 * nenhuma. Sem `CriterioPontuacao`, a empresa tem saldo zero — e a tela diz
 * isso em vez de mostrar um número bonito.
 *
 * MEDIÇÃO
 * -------
 * Cada evento é lido do dado que realmente existe. Um evento sem dado medível
 * (ninguém registrou ponto neste mês) NÃO credita e NÃO desconta: ausência de
 * dado não é "zero faltas", e tratar um pelo outro premiaria ausência de dado
 * como se fosse desempenho.
 */

function empresaDoRequisicao(req: FastifyRequest): string {
  const empresaId = (req as any).user?.empresaId;
  if (!empresaId) throw new Error('Empresa não identificada.');
  return empresaId;
}
const hojeIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

const criterioSchema = z.object({
  nome: z.string().min(2, 'Informe o nome.').max(160),
  descricao: z.string().max(1000).optional().nullable(),
  evento: z.enum(EVENTOS),
  operador: z.enum(OPERADORES).default('IGUAL'),
  valor: z.number().int('O valor de referência deve ser inteiro.'),
  pontos: z.number().int('A quantidade de pontos deve ser inteira.'),
  periodo: z.enum(PERIODOS).default('MENSAL'),
  ativo: z.boolean().optional(),
  observacoes: z.string().max(2000).optional().nullable(),
});

const atualizarSchema = criterioSchema.partial();

const lancamentoSchema = z.object({
  funcionarioId: z.string().min(1),
  pontos: z.number().int(),
  descricao: z.string().min(3, 'Descreva o motivo.').max(500),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});


/**
 * Mede o evento real de UM funcionário no período.
 *
 * Devolve `{ medido, evidenciado }`. `evidenciado` é `false` quando não existe
 * dado nenhum do tipo pedido — e nesses casos o chamador NÃO credita e NÃO
 * desconta.
 */
async function medirEvento(
  evento: EventoPontuacao,
  empresaId: string,
  funcionarioId: string,
  inicio: Date,
  fim: Date,
): Promise<{ medido: number; evidenciado: boolean }> {
  switch (evento) {
    case 'SEM_FALTA': {
      const pontos = await prisma.ponto.findMany({
        where: { empresaId, funcionarioId, data: { gte: inicio, lte: fim } },
        select: { falta: true },
      });
      if (pontos.length === 0) return { medido: 0, evidenciado: false };
      return { medido: pontos.filter((p) => p.falta).length, evidenciado: true };
    }
    case 'SEM_ATRASO': {
      const agg = await prisma.ponto.aggregate({
        where: { empresaId, funcionarioId, data: { gte: inicio, lte: fim } },
        _sum: { atrasoMinutos: true },
        _count: { _all: true },
      });
      if (agg._count._all === 0) return { medido: 0, evidenciado: false };
      return { medido: agg._sum.atrasoMinutos ?? 0, evidenciado: true };
    }
    case 'SEM_ADVERTENCIA': {
      const adv = await prisma.advertencia.findMany({
        where: { empresaId, funcionarioId, data: { gte: inicio, lte: fim } },
        select: { id: true },
      });
      // Aqui a ausência de registro É a informação: "ninguém abriu advertência
      // contra esta pessoa no período" é verificável mesmo com zero linhas.
      return { medido: adv.length, evidenciado: true };
    }
    case 'META_BATIDA': {
      const anoInicio = String(inicio.getUTCFullYear());
      const anoFim = String(fim.getUTCFullYear());
      const metas = await prisma.meta.findMany({
        where: {
          empresaId, funcionarioId, tipo: 'FUNCIONARIO',
          periodo: { gte: anoInicio, lte: anoFim },
        },
        select: { percentual: true },
      });
      if (metas.length === 0) return { medido: 0, evidenciado: false };
      const melhor = Math.max(...metas.map((m) => Math.round(Number(m.percentual))));
      return { medido: melhor, evidenciado: true };
    }
    case 'TREINAMENTO_PRESENTE': {
      // `PRESENTE` e o unico status que prova que a pessoa apareceu. Sem ele,
      // o criterio nao teria dado verificavel — e um where em 'CONCLUIDO'
      // devolveria zero linhas para sempre, sem erro nenhum.
      const part = await prisma.participanteTreinamento.findMany({
        where: {
          empresaId, funcionarioId, status: 'PRESENTE',
          dataRegistro: { gte: inicio, lte: fim },
        },
        select: { id: true },
      });
      return { medido: part.length, evidenciado: true };
    }
    case 'HORAS_EXTRAS': {
      const agg = await prisma.ponto.aggregate({
        where: { empresaId, funcionarioId, data: { gte: inicio, lte: fim } },
        _sum: { horaExtraMinutos: true },
        _count: { _all: true },
      });
      if (agg._count._all === 0) return { medido: 0, evidenciado: false };
      return { medido: agg._sum.horaExtraMinutos ?? 0, evidenciado: true };
    }
    case 'VENDAS_NO_PERIODO': {
      const agg = await prisma.venda.aggregate({
        where: { empresaId, funcionarioId, createdAt: { gte: inicio, lte: fim } },
        _sum: { total: true },
        _count: { _all: true },
      });
      if (agg._count._all === 0) return { medido: 0, evidenciado: false };
      return { medido: Math.round(Number(agg._sum.total ?? 0)), evidenciado: true };
    }
    default:
      return { medido: 0, evidenciado: false };
  }
}

function paraCriterioDTO(c: any) {
  const desc = DESCRICAO_EVENTO[c.evento as EventoPontuacao];
  return {
    id: c.id, nome: c.nome, descricao: c.descricao, evento: c.evento,
    eventoRotulo: desc?.rotulo ?? c.evento,
    eventoExplicacao: desc?.explicacao ?? '',
    unidade: desc?.unidade ?? '',
    operador: c.operador,
    operadorRotulo: ROTULO_OPERADOR[c.operador as keyof typeof ROTULO_OPERADOR] ?? c.operador,
    valor: c.valor, pontos: c.pontos,
    periodo: c.periodo,
    periodoRotulo: ROTULO_PERIODO[c.periodo as PeriodoCriterio] ?? c.periodo,
    ativo: c.ativo, observacoes: c.observacoes,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

/**
 * Grava UM crédito de critério, ou devolve `null` se ele já existia.
 *
 * A avaliação e o `RegistroGamificacao` nascem na MESMA transação: ou os dois
 * existem, ou nenhum. Sem isso, uma falha no meio deixaria pontos no saldo sem
 * histórico — ou histórico sem ponto, e o saldo pararia de bater.
 *
 * O `null` no conflito P2002 é a trava de idempotência: a chave única
 * (criterioId, funcionarioId, periodo) já guarantee que a segunda apuração do
 * mesmo período não soma o mesmo ponto outra vez.
 */
async function gravarCredito(args: {
  empresaId: string;
  criterio: { id: string; nome: string; pontos: number };
  func: { id: string; nome: string };
  evidencia: string;
  medido: number;
  chave: string;
}): Promise<{ registroId: string } | null> {
  const { empresaId, criterio, func, evidencia, medido, chave } = args;
  return prisma.$transaction(async (tx) => {
    const criada = await tx.avaliacaoCriterio.create({
      data: {
        empresaId, criterioId: criterio.id, funcionarioId: func.id,
        evidencia, valorMedido: medido, pontos: criterio.pontos, periodo: chave,
      },
      select: { id: true },
    }).catch((e: any) => {
      if (e?.code === 'P2002') return null;
      throw e;
    });
    if (!criada) return null;

    const reg = await tx.registroGamificacao.create({
      data: {
        empresaId, funcionarioId: func.id,
        tipo: criterio.pontos < 0 ? 'perda' : 'conquista',
        descricao: `${criterio.nome} — ${evidencia}`,
        pontos: criterio.pontos,
        regraId: criterio.id,
        criterioId: criterio.id,
        data: new Date(`${hojeIso()}T12:00:00`),
        status: 'ATIVO',
      },
      select: { id: true },
    });
    await tx.avaliacaoCriterio.update({ where: { id: criada.id }, data: { registroId: reg.id } });
    return { registroId: reg.id };
  });
}



export async function pontuacaoRoutes(app: FastifyInstance): Promise<void> {
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
   * GET /rh/pontuacao/criterios
   *
   * Devolve também o dicionário de eventos: a tela precisa mostrar o que o NEXUS
   * consegue verificar para a empresa escolher, e esse dicionário é o mesmo que
   * o backend usa — não uma cópia que pode divergir.
   */
  app.get('/rh/pontuacao/criterios', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const criterios = await prisma.criterioPontuacao.findMany({
        where: { empresaId },
        orderBy: [{ ativo: 'desc' }, { createdAt: 'desc' }],
      });
      const contagem = await prisma.avaliacaoCriterio.groupBy({
        by: ['criterioId'],
        where: { empresaId },
        _count: { _all: true },
      });
      const porCriterio = new Map(contagem.map((c) => [c.criterioId, c._count._all]));
      return reply.send({
        criterios: criterios.map((c) => ({ ...paraCriterioDTO(c), creditos: porCriterio.get(c.id) ?? 0 })),
        total: criterios.length,
        ativos: criterios.filter((c) => c.ativo).length,
        // Empresa sem critério tem saldo zero por definição — e a tela escreve
        // isso, em vez de sugerir valores padrão que a empresa não pediu.
        semPoliticaPadrao: true,
        eventos: EVENTOS.map((e) => ({ evento: e, ...DESCRICAO_EVENTO[e] })),
        operadores: OPERADORES.map((o) => ({ operador: o, rotulo: ROTULO_OPERADOR[o] })),
        periodos: PERIODOS.map((p) => ({ periodo: p, rotulo: ROTULO_PERIODO[p] })),
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao ler criterios de pontuacao');
      return reply.status(500).send({ error: 'Não foi possível ler os critérios.' });
    }
  });

  /** POST /rh/pontuacao/criterios — a empresa define a SUA política. */
  app.post('/rh/pontuacao/criterios', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = criterioSchema.parse(req.body ?? {});
      const erros = validarCriterio(b as any);
      if (erros.length > 0) return reply.status(400).send({ error: erros[0], erros });

      const criado = await prisma.criterioPontuacao.create({
        data: {
          empresaId, nome: b.nome.trim(), descricao: b.descricao ?? null,
          evento: b.evento, operador: b.operador, valor: b.valor, pontos: b.pontos,
          periodo: b.periodo, ativo: b.ativo ?? true, observacoes: b.observacoes ?? null,
        },
      });
      await registrarAuditoria({
        usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'CriterioPontuacao', entidadeId: criado.id,
        valorNovo: {
          nome: criado.nome, evento: criado.evento, operador: criado.operador,
          valor: criado.valor, pontos: criado.pontos, periodo: criado.periodo,
        },
        origem: 'MANUAL', ip: req.ip,
        contexto: `Criterio "${criado.nome}": ${criado.pontos} pts quando ${DESCRICAO_EVENTO[criado.evento as EventoPontuacao]?.rotulo} ${ROTULO_OPERADOR[criado.operador as keyof typeof ROTULO_OPERADOR]} ${criado.valor}`,
      });
      return reply.status(201).send({ criterio: paraCriterioDTO(criado) });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao criar criterio');
      return reply.status(500).send({ error: 'Não foi possível criar o critério.' });
    }
  });


  /** PATCH /rh/pontuacao/criterios/:id — a empresa corrige a própria política. */
  app.patch('/rh/pontuacao/criterios/:id', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const atual = await prisma.criterioPontuacao.findFirst({
        where: { id: req.params.id, empresaId },
        select: { id: true, nome: true, evento: true, operador: true, valor: true, pontos: true, ativo: true },
      });
      if (!atual) return reply.status(404).send({ error: 'Critério não encontrado nesta empresa.' });

      const b = atualizarSchema.parse(req.body ?? {});
      // A validação roda sobre o resultado FINAL, não só sobre o que veio no
      // corpo: mudar só o evento para um incompatível com o valor guardado tem
      // que ser barrado igual.
      const erros = validarCriterio({
        nome: b.nome ?? atual.nome,
        evento: b.evento ?? atual.evento,
        operador: b.operador ?? atual.operador,
        valor: b.valor ?? atual.valor,
        pontos: b.pontos ?? atual.pontos,
      } as any);
      if (erros.length > 0) return reply.status(400).send({ error: erros[0], erros });

      const salvo = await prisma.criterioPontuacao.update({
        where: { id: atual.id },
        data: {
          ...(b.nome !== undefined ? { nome: b.nome.trim() } : {}),
          ...(b.descricao !== undefined ? { descricao: b.descricao } : {}),
          ...(b.evento !== undefined ? { evento: b.evento } : {}),
          ...(b.operador !== undefined ? { operador: b.operador } : {}),
          ...(b.valor !== undefined ? { valor: b.valor } : {}),
          ...(b.pontos !== undefined ? { pontos: b.pontos } : {}),
          ...(b.periodo !== undefined ? { periodo: b.periodo } : {}),
          ...(b.ativo !== undefined ? { ativo: b.ativo } : {}),
          ...(b.observacoes !== undefined ? { observacoes: b.observacoes } : {}),
        },
      });
      await registrarAuditoria({
        usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'CriterioPontuacao', entidadeId: salvo.id,
        valorAnterior: { pontos: atual.pontos, valor: atual.valor, ativo: atual.ativo },
        valorNovo: { pontos: salvo.pontos, valor: salvo.valor, ativo: salvo.ativo },
        origem: 'MANUAL', ip: req.ip,
        contexto: `Criterio "${salvo.nome}" alterado. O historico ja creditado nao muda.`,
      });
      return reply.send({ criterio: paraCriterioDTO(salvo) });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao atualizar criterio');
      return reply.status(500).send({ error: 'Não foi possível atualizar o critério.' });
    }
  });

  /**
   * DELETE /rh/pontuacao/criterios/:id
   *
   * Remove a REGRA, não os pontos. A empresa pode querer trocar toda a sua
   * política; o que as pessoas já ganharam continua no saldo e no histórico.
   *
   * Por isso o `RegistroGamificacao.criterioId` é `SetNull`: apagar o critério
   * deixa as linhas de pontos órfãs de propósito — elas são histórico de
   * pagamento, e um pagamento que sumiu porque a empresa mudou de política seria
   * o pior tipo de apagamento.
   */
  app.delete('/rh/pontuacao/criterios/:id', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const atual = await prisma.criterioPontuacao.findFirst({
        where: { id: req.params.id, empresaId },
        select: { id: true, nome: true, pontos: true },
      });
      if (!atual) return reply.status(404).send({ error: 'Critério não encontrado nesta empresa.' });

      const jaCreditados = await prisma.avaliacaoCriterio.count({
        where: { empresaId, criterioId: atual.id },
      });
      await prisma.criterioPontuacao.delete({ where: { id: atual.id } });
      await registrarAuditoria({
        usuarioId: req.user.id, empresaId, acao: 'EXCLUIR', entidade: 'CriterioPontuacao', entidadeId: atual.id,
        valorAnterior: { nome: atual.nome, pontos: atual.pontos, creditos: jaCreditados },
        origem: 'MANUAL', ip: req.ip,
        contexto: `Criterio "${atual.nome}" removido. ${jaCreditados} credito(s) ja lancados permanecem no saldo.`,
      });
      return reply.send({
        removido: true,
        creditosPreservados: jaCreditados,
        mensagem: jaCreditados > 0
          ? `Critério removido. Os ${jaCreditados} ponto(s) já creditados continuam no saldo das pessoas.`
          : 'Critério removido.',
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao remover criterio');
      return reply.status(500).send({ error: 'Não foi possível remover o critério.' });
    }
  });

  /**
   * POST /rh/pontuacao/avaliar
   *
   * O coração do ciclo: o NEXUS mede, compara e credita — o VALOR é o que a
   * empresa configurou no critério.
   *
   * `simular` roda tudo sem gravar e devolve o que ACONTECERIA. A alternativa
   * seria o gestor descobrir que a política de pontos da empresa está errada só
   * depois de ela ter valido para o mês inteiro.
   */
  app.post('/rh/pontuacao/avaliar', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = z.object({
        periodo: z.enum(PERIODOS).default('MENSAL'),
        // Sem `ref`, avalia o período que contém hoje. O parâmetro existe para
        // o gestor reprocessar um mês fechado depois de corrigir a política.
        ref: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        simular: z.boolean().default(false),
        criterioId: z.string().optional(),
      }).parse(req.body ?? {});

      const criterios = await prisma.criterioPontuacao.findMany({
        where: { empresaId, ativo: true, ...(b.criterioId ? { id: b.criterioId } : {}) },
        orderBy: { createdAt: 'asc' },
      });

      // Empresa sem critério não é erro — é o estado inicial de toda empresa.
      // A resposta diz isso explicitamente, para a tela não parecer quebrada.
      if (criterios.length === 0) {
        return reply.send({
          simulado: b.simular, creditos: 0, jaCreditados: 0, semDados: 0,
          criterios: 0, periodo: chavePeriodo(b.periodo, new Date()),
          mensagem: 'Nenhum critério ativo configurado. Cadastre a política de pontos da empresa para começar a apurar.',
        });
      }

      const ref = b.ref ? new Date(`${b.ref}T12:00:00Z`) : new Date();
      const { inicio, fim } = intervaloPeriodo(b.periodo as PeriodoCriterio, ref);
      const chave = chavePeriodo(b.periodo as PeriodoCriterio, ref);

      const funcionarios = await prisma.funcionario.findMany({
        where: { empresaId, status: { in: ['ATIVO', 'FERIAS', 'AFASTADO'] } },
        select: { id: true, nome: true },
      });

      const creditos: any[] = [];
      const jaCreditados: any[] = [];
      let semDados = 0;

      for (const criterio of criterios) {
        for (const func of funcionarios) {
          const { medido, evidenciado } = await medirEvento(
            criterio.evento as EventoPontuacao, empresaId, func.id, inicio, fim,
          );
          const evidencia = descreverEvidencia(
            criterio.evento as EventoPontuacao,
            medido,
            { operador: criterio.operador as any, valor: criterio.valor },
          );

          if (!evidenciado) {
            // Sem dado, não credita e não desconta. Registrar isto é o que
            // impede que a empresa receba pontos por "zero advertências" de
            // alguém que o NEXUS nunca chegou a medir.
            semDados++;
            continue;
          }
          if (!cumprE(medido, criterio.operador as any, criterio.valor)) continue;

          if (b.simular) {
            creditos.push({
              criterio: criterio.nome, criterioId: criterio.id, funcionario: func.nome,
              funcionarioId: func.id, pontos: criterio.pontos, evidencia, valorMedido: medido,
            });
            continue;
          }
          const gravado = await gravarCredito({ empresaId, criterio, func, evidencia, medido, chave });
          if (gravado) {
            creditos.push({
              criterio: criterio.nome, criterioId: criterio.id, funcionario: func.nome,
              funcionarioId: func.id, pontos: criterio.pontos, evidencia, valorMedido: medido,
            });
          } else {
            jaCreditados.push({ criterio: criterio.nome, funcionario: func.nome, funcionarioId: func.id, periodo: chave });
          }
        }
      }

      if (!b.simular && creditos.length > 0) {
        await registrarAuditoria({
          usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'AvaliacaoCriterio', entidadeId: chave,
          valorNovo: { periodo: chave, creditos: creditos.length, totalPontos: creditos.reduce((s, c) => s + c.pontos, 0) },
          origem: 'AUTOMATICO', ip: req.ip,
          contexto: `Apuracao ${chave}: ${creditos.length} credito(s) pelos criterios da empresa.`,
        });
      }

      return reply.send({
        simulado: b.simular,
        creditos: creditos.length,
        jaCreditados: jaCreditados.length,
        semDados,
        criterios: criterios.length,
        funcionarios: funcionarios.length,
        periodo: chave,
        itens: creditos,
        jaCreditadosItens: jaCreditados,
        mensagem: b.simular
          ? `Simulacao: ${creditos.length} credito(s) seriam dados em ${chave}. Nada foi gravado.`
          : `${creditos.length} credito(s) em ${chave}${jaCreditados.length ? `, ${jaCreditados.length} ja creditados antes` : ''}.`,
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao avaliar criterios');
      return reply.status(500).send({ error: 'Não foi possível apurar os critérios.' });
    }
  });

  /**
   * POST /rh/pontuacao/lancamentos
   *
   * Lançamento MANUAL de pontos, fora das regras — o bônus por esforço, o
   * reconhecimento por algo que não cabe em nenhum evento do banco.
   *
   * `criterioId` fica NULO de propósito: é o que separa na tela o ponto que veio
   * da apuração automática do ponto que o gestor decidiu dar. Sem essa
   * distinção, a empresa não consegue auditar a própria política depois.
   */
  app.post('/rh/pontuacao/lancamentos', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = lancamentoSchema.parse(req.body ?? {});
      const erros = validarLancamentoManual(b.pontos, b.descricao);
      if (erros.length > 0) return reply.status(400).send({ error: erros[0], erros });

      const func = await prisma.funcionario.findFirst({
        where: { id: b.funcionarioId, empresaId, status: { in: ['ATIVO', 'FERIAS', 'AFASTADO'] } },
        select: { id: true, nome: true },
      });
      if (!func) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });

      const reg = await prisma.registroGamificacao.create({
        data: {
          empresaId, funcionarioId: func.id,
          tipo: b.pontos < 0 ? 'perda' : 'reconhecimento',
          descricao: b.descricao.trim(),
          pontos: b.pontos,
          // Sem critério: este ponto NÃO veio da apuração.
          criterioId: null,
          regraId: null,
          data: new Date(`${b.data ?? hojeIso()}T12:00:00`),
          status: 'ATIVO',
        },
      });
      await registrarAuditoria({
        usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'RegistroGamificacao', entidadeId: reg.id,
        valorNovo: { funcionario: func.nome, pontos: b.pontos, motivo: b.descricao.trim() },
        origem: 'MANUAL', ip: req.ip,
        contexto: `Lancamento manual de ${b.pontos} pts para ${func.nome}.`,
      });
      return reply.status(201).send({
        id: reg.id, pontos: reg.pontos,
        mensagem: `${b.pontos} ponto(s) lançado(s) para ${func.nome}.`,
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao lancar pontos');
      return reply.status(500).send({ error: 'Não foi possível lançar os pontos.' });
    }
  });

  /**
   * GET /rh/pontuacao/historico
   *
   * De onde veio cada ponto: apuração de critério (com a evidência medida) ou
   * lançamento manual (com o motivo). É a resposta à pergunta "por que essa
   * pessoa tem 340 pontos?", e ela precisa ser auditável linha a linha.
   */
  app.get('/rh/pontuacao/historico', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const q = z.object({
        periodo: z.string().max(20).optional(),
        funcionarioId: z.string().optional(),
        take: z.coerce.number().int().min(1).max(300).default(100),
      }).parse(req.query ?? {});

      const avaliacoes = await prisma.avaliacaoCriterio.findMany({
        where: {
          empresaId,
          ...(q.periodo ? { periodo: q.periodo } : {}),
          ...(q.funcionarioId ? { funcionarioId: q.funcionarioId } : {}),
        },
        select: {
          id: true, criterioId: true, funcionarioId: true, evidencia: true,
          valorMedido: true, pontos: true, periodo: true, createdAt: true,
          criterio: { select: { nome: true, evento: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: q.take,
      });
      const manuais = await prisma.registroGamificacao.findMany({
        where: {
          empresaId, criterioId: null, status: 'ATIVO',
          ...(q.funcionarioId ? { funcionarioId: q.funcionarioId } : {}),
        },
        select: { id: true, funcionarioId: true, descricao: true, pontos: true, data: true },
        orderBy: { data: 'desc' },
        take: q.take,
      });

      const ids = [...new Set([
        ...avaliacoes.map((a) => a.funcionarioId),
        ...manuais.map((m) => m.funcionarioId),
      ].filter((x): x is string => Boolean(x)))];
      const funcs = ids.length
        ? await prisma.funcionario.findMany({ where: { id: { in: ids }, empresaId }, select: { id: true, nome: true } })
        : [];
      const nomeDe = new Map(funcs.map((f) => [f.id, f.nome]));

      return reply.send({
        apuracoes: avaliacoes.map((a) => ({
          id: a.id,
          // `criterioId` vai no DTO: sem ele a tela não consegue agrupar a
          // apuração por critério, nem ligar a linha ao critério que a
          // empresa configurou.
          criterioId: a.criterioId,
          criterio: a.criterio?.nome ?? '(critério removido)',
          evento: a.criterio?.evento ?? null,
          funcionarioId: a.funcionarioId,
          funcionario: nomeDe.get(a.funcionarioId) ?? '—',
          evidencia: a.evidencia, valorMedido: a.valorMedido,
          pontos: a.pontos, periodo: a.periodo, origem: 'APURACAO',
        })),
        manuais: manuais.map((m) => ({
          id: m.id, criterio: null, evento: null,
          funcionarioId: m.funcionarioId,
          // `funcionarioId` é nulável no schema (registro de equipe não tem
          // uma pessoa). `nomeDe` só tem ids reais, então o fallback cobre.
          funcionario: (m.funcionarioId ? nomeDe.get(m.funcionarioId) : null) ?? 'Equipe',
          evidencia: m.descricao, valorMedido: 0,
          pontos: m.pontos, periodo: m.data.toISOString().slice(0, 10), origem: 'MANUAL',
        })),
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao ler historico de pontuacao');
      return reply.status(500).send({ error: 'Não foi possível ler o histórico.' });
    }
  });
}
