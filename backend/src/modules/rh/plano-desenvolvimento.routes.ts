import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoQualquerDas } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { chaveDiaSql } from '../radar/radar.regras.js';
import {
  OBJETIVOS, COMPETENCIAS, TIPOS_ACAO, STATUS_PLANO,
  ROTULO_ACAO, sugerirPlano, normalizarAcoes, progresso, ehPlanoAtivo,
  type ContextoAvaliacao,
} from './plano-desenvolvimento.js';

/**
 * ROTAS — PLANO DE DESENVOLVIMENTO DISC (Ciclo 1)
 * =================================================
 *
 * MULTI-TENANT
 * ------------
 * Toda rota chama `empresaDoRequisicao(req)` na primeira linha e passa o
 * resultado como filtro de TODA consulta. Não existe nenhuma função deste
 * arquivo que aceite `empresaId` vindo do corpo ou da query: o identificador
 * do tenant tem uma origem só, e é o token.
 *
 * Um `funcionarioId` de outra empresa não é "filtrado e fica vazio" — é
 * RECUSADO com 404 antes de qualquer gravação.
 *
 * PERMISSÃO
 * ---------
 * Mesmo par aprovado para o DISC: leitura aceita `rh:visualizar` OU
 * `relatorios:visualizar`; escrita aceita `rh:editar` OU `relatorios:editar`.
 * O plano é dado de pessoa (RH) preenchido a partir de tela de relatórios.
 * Nenhum outro módulo de RH é aberto por esta via: folha, ponto, advertências
 * e cadastro continuam exigindo `rh`.
 *
 * IA
 * --
 * `POST /analisar` NÃO GRAVA NADA. Ela lê a avaliação vigente, pergunta à IA
 * e devolve a sugestão filtrada. Quem grava é `POST /`, e só depois que o
 * gestor escolheu o que aceitar.
 */

/** `empresaId` do token. Única origem do tenant neste arquivo. */
function empresaDoRequisicao(req: FastifyRequest): string {
  const empresaId = (req as { user?: { empresaId?: string } }).user?.empresaId;
  if (!empresaId) throw new Error('Empresa não identificada.');
  return empresaId;
}

/** Data de hoje no padrão UTC do projeto (evita o bug de fuso já corrigido). */
function hoje(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

const DIAS_RE = /^\d{4}-\d{2}-\d{2}$/;

// ===========================================================================
//  Schemas
// ===========================================================================

const acaoSchema = z.object({
  tipo: z.enum(TIPOS_ACAO),
  descricao: z.string().min(3, 'Descreva a ação.').max(240),
  // Opcional de propósito: um plano nasce com as ações PENDENTES. Só vira
  // `true` quando o gestor marcou. Ver `normalizarAcoes`.
  concluida: z.boolean().optional(),
});

const criarSchema = z.object({
  funcionarioId: z.string().min(1),
  /**
   * Avaliação que originou o plano. OBRIGATÓRIA e validada contra `empresaId`.
   * Não há caminho para criar plano sem uma avaliação real: o perfil e os
   * percentuais são lidos dela, e nunca enviados pelo cliente.
   */
  avaliacaoId: z.string().min(1),
  objetivo: z.enum(OBJETIVOS),
  competencia: z.enum(COMPETENCIAS),
  descricao: z.string().min(5, 'Descreva o que deve ser desenvolvido.').max(2000),
  acoes: z.array(acaoSchema).min(1, 'Inclua ao menos uma ação.').max(12),
  responsavelId: z.string().optional().nullable(),
  dataInicio: z.string().regex(DIAS_RE, 'Data deve estar em AAAA-MM-DD.'),
  prazo: z.string().regex(DIAS_RE, 'Data deve estar em AAAA-MM-DD.').optional().nullable(),
  status: z.enum(STATUS_PLANO).optional(),
  observacoes: z.string().max(2000).optional().nullable(),
  /**
   * Sugestão que o gestor aceitou/editou/recusou. É gravada como está, em
   * `analiseIA` — a IA não tem nenhum outro campo para escrever.
   */
  analiseIA: z.record(z.string(), z.unknown()).optional().nullable(),
});

const atualizarSchema = z.object({
  status: z.enum(STATUS_PLANO).optional(),
  descricao: z.string().min(5).max(2000).optional(),
  competencia: z.enum(COMPETENCIAS).optional(),
  objetivo: z.enum(OBJETIVOS).optional(),
  acoes: z.array(acaoSchema).max(12).optional(),
  prazo: z.string().regex(DIAS_RE).optional().nullable(),
  dataInicio: z.string().regex(DIAS_RE).optional(),
  responsavelId: z.string().optional().nullable(),
  observacoes: z.string().max(2000).optional().nullable(),
});

const analisarSchema = z.object({ funcionarioId: z.string().min(1) });

// ===========================================================================
//  Leitura auxiliar
// ===========================================================================

/**
 * Carrega o contexto de uma avaliação validada contra a empresa.
 * Devolve `null` quando o funcionário ou a avaliação não são desta empresa —
 * a rota traduz em 404.
 */
async function carregarContexto(
  empresaId: string,
  funcionarioId: string,
  avaliacaoId: string,
): Promise<ContextoAvaliacao | null> {
  const avaliacao = await prisma.avaliacaoComportamental.findFirst({
    where: { id: avaliacaoId, empresaId, funcionarioId },
    select: {
      id: true, perfil: true, scores: true, dataAvaliacao: true, observacoes: true,
      funcionario: {
        select: {
          nome: true,
          departamento: { select: { nome: true } },
          cargo: { select: { nome: true } },
        },
      },
    },
  });
  if (!avaliacao) return null;

  return {
    avaliacaoId: avaliacao.id,
    funcionarioId,
    nome: avaliacao.funcionario.nome,
    departamento: avaliacao.funcionario.departamento?.nome ?? null,
    cargo: avaliacao.funcionario.cargo?.nome ?? null,
    perfil: avaliacao.perfil,
    scores: (avaliacao.scores as { D?: number; I?: number; S?: number; C?: number } | null) ?? null,
    dataAvaliacao: chaveDiaSql(avaliacao.dataAvaliacao),
    observacoes: avaliacao.observacoes,
    acoesSugeridas: [],
  };
}

/**
 * Serializa uma linha do banco no formato que a tela consome.
 *
 * `responsavelId` é coluna escalar sem relação declarada (o padrão do
 * projeto), então o nome de quem conduz o plano é resolvido numa consulta à
 * parte — exatamente como `GET /radar/disc/historico` faz com
 * `aplicadoPorId`.
 */
function paraDTO(p: any, nomeResponsavel: string | null = null) {
  const acoes = Array.isArray(p.acoes) ? p.acoes : [];
  return {
    id: p.id,
    funcionarioId: p.funcionarioId,
    avaliacaoId: p.avaliacaoId,
    perfil: p.perfil,
    scores: p.scores,
    objetivo: p.objetivo,
    competencia: p.competencia,
    descricao: p.descricao,
    acoes: acoes.map((a: any) => ({
      tipo: a.tipo,
      rotuloTipo: ROTULO_ACAO[a.tipo as keyof typeof ROTULO_ACAO] ?? a.tipo,
      descricao: String(a.descricao ?? ''),
      concluida: a.concluida === true,
    })),
    responsavelId: p.responsavelId,
    responsavel: nomeResponsavel,
    dataInicio: chaveDiaSql(p.dataInicio),
    prazo: p.prazo ? chaveDiaSql(p.prazo) : null,
    status: p.status,
    observacoes: p.observacoes,
    analiseIA: p.analiseIA,
    progresso: progresso(p.acoes),
    ativo: ehPlanoAtivo(p.status),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Nomes dos responsáveis de uma lista de planos, em UMA consulta. */
async function nomesResponsaveis(ids: Array<string | null>): Promise<Map<string, string>> {
  const limpo = ids.filter((x): x is string => Boolean(x));
  if (limpo.length === 0) return new Map();
  const usuarios = await prisma.usuario.findMany({
    where: { id: { in: limpo } },
    select: { id: true, nome: true },
  });
  return new Map(usuarios.map((u) => [u.id, u.nome]));
}

// ===========================================================================
//  Rotas
// ===========================================================================

export async function planoDesenvolvimentoRoutes(app: FastifyInstance): Promise<void> {
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
   * GET /rh/planos-desenvolvimento
   * Lista o histórico. `?funcionarioId=` filtra uma pessoa; sem ele, traz os
   * planos da empresa (é o que o Radar usa).
   */
  app.get('/rh/planos-desenvolvimento', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const funcionarioId = typeof req.query?.funcionarioId === 'string' ? req.query.funcionarioId : null;

      // Quando se filtra por pessoa, ela precisa ser DESTA empresa — senão um
      // id de outra empresa retornaria "nenhum plano" em vez de 404, o que
      // permitiria sondar a existência de funcionários de terceiros.
      if (funcionarioId) {
        const f = await prisma.funcionario.findFirst({ where: { id: funcionarioId, empresaId }, select: { id: true } });
        if (!f) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });
      }

      const planos = await prisma.planoDesenvolvimento.findMany({
        where: { empresaId, ...(funcionarioId ? { funcionarioId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { funcionario: { select: { nome: true } } },
      });
      const nomes = await nomesResponsaveis(planos.map((p) => p.responsavelId));
      return reply.send({
        total: planos.length,
        planos: planos.map((p) => ({
          ...paraDTO(p, nomes.get(p.responsavelId ?? '') ?? null),
          funcionario: p.funcionario.nome,
        })),
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao listar planos de desenvolvimento');
      return reply.status(500).send({ error: 'Não foi possível ler os planos de desenvolvimento.' });
    }
  });

  /**
   * POST /rh/planos-desenvolvimento/analisar
   *
   * PERGUNTA À IA. NÃO GRAVA NADA.
   *
   * O caminho feliz não tem persistência: a sugestão volta para o gestor,
   * que escolhe o que aceitar, edita se quiser, e só então chama `POST /`.
   * Se a IA falhar, a resposta é 200 com `sugestao: null` e o motivo — não um
   * erro 500, porque "a IA não respondeu" não é falha do sistema, e a tela
   * precisa distinguir isso de "o servidor caiu".
   */
  app.post(
    '/rh/planos-desenvolvimento/analisar',
    { preHandler: [...leitura.preHandler, iaLimiter] },
    async (req: any, reply) => {
      try {
        const empresaId = empresaDoRequisicao(req);
        const b = analisarSchema.parse(req.body ?? {});

        const func = await prisma.funcionario.findFirst({
          where: { id: b.funcionarioId, empresaId },
          select: { id: true, nome: true, departamento: { select: { nome: true } }, cargo: { select: { nome: true } } },
        });
        if (!func) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });

        // A IA só pode sugere sobre uma avaliação REAL. Sem ela, não há o que
        // analisar — e inventar um contexto seria fabricar dado.
        const avaliacao = await prisma.avaliacaoComportamental.findFirst({
          where: { empresaId, funcionarioId: b.funcionarioId, vigente: true },
          orderBy: { dataAvaliacao: 'desc' },
          select: { id: true, perfil: true, scores: true, dataAvaliacao: true, observacoes: true },
        });
        if (!avaliacao) {
          return reply.status(409).send({
            error: 'Este funcionário não tem avaliação DISC vigente. Aplique o questionário primeiro.',
          });
        }

        const ctx: ContextoAvaliacao = {
          avaliacaoId: avaliacao.id,
          funcionarioId: b.funcionarioId,
          nome: func.nome,
          departamento: func.departamento?.nome ?? null,
          cargo: func.cargo?.nome ?? null,
          perfil: avaliacao.perfil,
          scores: (avaliacao.scores as any) ?? null,
          dataAvaliacao: chaveDiaSql(avaliacao.dataAvaliacao),
          observacoes: avaliacao.observacoes,
          acoesSugeridas: [],
        };

        const r = await sugerirPlano(ctx);
        if (!r.ok) {
          return reply.send({
            sugestao: null,
            motivo: r.motivo,
            // O contexto continua sendo devolvido: mesmo sem sugestão, a tela
            // mostra de qual avaliação a análise viria.
            contexto: {
              avaliacaoId: ctx.avaliacaoId,
              perfil: ctx.perfil,
              scores: ctx.scores,
              dataAvaliacao: ctx.dataAvaliacao,
            },
          });
        }
        return reply.send({
          sugestao: r.analise,
          descartes: r.descartes,
          contexto: {
            avaliacaoId: ctx.avaliacaoId,
            perfil: ctx.perfil,
            scores: ctx.scores,
            dataAvaliacao: ctx.dataAvaliacao,
          },
        });
      } catch (erro: any) {
        if (erro instanceof z.ZodError) throw erro;
        req.log.error(erro, 'Falha ao pedir sugestão da IA');
        return reply.status(500).send({ error: 'Não foi possível pedir a sugestão.' });
      }
    },
  );

  /**
   * POST /rh/planos-desenvolvimento
   *
   * Grava o plano. O `perfil` e o `scores` NÃO vêm do corpo: são lidos da
   * avaliação referenciada em `avaliacaoId`. É a garantia de que nenhum
   * caminho — inclusive um cliente adulterado — consiga registrar um perfil
   * ou percentual que a IA ou o navegador inventou.
   */
  app.post('/rh/planos-desenvolvimento', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = criarSchema.parse(req.body ?? {});

      if (b.dataInicio > hoje()) {
        return reply.status(400).send({ error: 'A data inicial não pode estar no futuro.' });
      }
      if (b.prazo && b.prazo < b.dataInicio) {
        return reply.status(400).send({ error: 'O prazo não pode ser anterior à data inicial.' });
      }

      // Funcionário E avaliação têm de ser desta empresa. Um id de terceiro
      // devolve 404 — nunca "cria um plano órfão" nem "cria com os dados de
      // outra empresa".
      const func = await prisma.funcionario.findFirst({
        where: { id: b.funcionarioId, empresaId },
        select: { id: true, nome: true },
      });
      if (!func) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });

      const ctx = await carregarContexto(empresaId, b.funcionarioId, b.avaliacaoId);
      if (!ctx) return reply.status(404).send({ error: 'Avaliação DISC não encontrada para este funcionário nesta empresa.' });

      if (b.responsavelId) {
        const resp = await prisma.usuario.findFirst({
          where: { id: b.responsavelId, empresaId },
          select: { id: true },
        });
        if (!resp) return reply.status(404).send({ error: 'Responsável não encontrado nesta empresa.' });
      }

      const acoes = normalizarAcoes(b.acoes);
      if (acoes.length === 0) {
        return reply.status(400).send({ error: 'Inclua ao menos uma ação válida.' });
      }

      // Gravação + auditoria na mesma transação: ou os dois existem, ou
      // nenhum. Um plano gravado sem rastro de quem criou é dado sensível sem
      // dono.
      const plano = await prisma.$transaction(async (tx) => {
        const criado = await tx.planoDesenvolvimento.create({
          data: {
            empresaId,
            funcionarioId: b.funcionarioId,
            avaliacaoId: b.avaliacaoId,
            // SNAPSHOT lido do banco, nunca do corpo.
            perfil: (ctx.perfil as any) ?? null,
            scores: (ctx.scores as any) ?? null,
            objetivo: b.objetivo as any,
            competencia: b.competencia as any,
            descricao: b.descricao,
            acoes: acoes as any,
            responsavelId: b.responsavelId ?? req.user?.id ?? null,
            dataInicio: new Date(`${b.dataInicio}T12:00:00`),
            prazo: b.prazo ? new Date(`${b.prazo}T12:00:00`) : null,
            status: (b.status ?? 'PLANEJADO') as any,
            analiseIA: (b.analiseIA ?? null) as any,
            observacoes: b.observacoes ?? null,
            origem: b.analiseIA ? 'IA' : 'MANUAL',
          },
        });
        await registrarAuditoria({
          usuarioId: req.user.id,
          empresaId,
          acao: 'CRIAR',
          entidade: 'PlanoDesenvolvimento',
          entidadeId: criado.id,
          valorNovo: {
            funcionarioId: b.funcionarioId,
            objetivo: b.objetivo,
            competencia: b.competencia,
            acoes: acoes.length,
            status: criado.status,
          },
          origem: b.analiseIA ? 'IA' : 'MANUAL',
          ip: req.ip,
          contexto: `Plano de desenvolvimento DISC criado para ${func.nome} (perfil ${ctx.perfil ?? '—'})`,
        });
        return criado;
      });

      const completo = await prisma.planoDesenvolvimento.findUnique({
        where: { id: plano.id },
        include: { funcionario: { select: { nome: true } } },
      });
      const nomes = await nomesResponsaveis([plano.responsavelId]);
      return reply.status(201).send({
        ...paraDTO(completo, nomes.get(plano.responsavelId ?? '') ?? null),
        funcionario: completo!.funcionario.nome,
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao criar plano de desenvolvimento');
      return reply.status(500).send({ error: 'Não foi possível criar o plano de desenvolvimento.' });
    }
  });

  /** GET /rh/planos-desenvolvimento/:id */
  app.get('/rh/planos-desenvolvimento/:id', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const plano = await prisma.planoDesenvolvimento.findFirst({
        where: { id: req.params.id, empresaId },
        include: { funcionario: { select: { nome: true } } },
      });
      // Mesmo 404 para "não existe" e "é de outra empresa": distinguir os dois
      // confirmaria a existência de um registro de terceiro.
      if (!plano) return reply.status(404).send({ error: 'Plano de desenvolvimento não encontrado nesta empresa.' });
      const nomes = await nomesResponsaveis([plano.responsavelId]);
      return reply.send({
        ...paraDTO(plano, nomes.get(plano.responsavelId ?? '') ?? null),
        funcionario: plano.funcionario.nome,
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao ler plano de desenvolvimento');
      return reply.status(500).send({ error: 'Não foi possível ler o plano.' });
    }
  });

  /**
   * PATCH /rh/planos-desenvolvimento/:id
   *
   * Usado para o gestor marcar ações, mudar status e cancelar. Nada aqui é
   * automático: `progresso` é sempre derivado das ações gravadas.
   */
  app.patch('/rh/planos-desenvolvimento/:id', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = atualizarSchema.parse(req.body ?? {});
      const atual = await prisma.planoDesenvolvimento.findFirst({
        where: { id: req.params.id, empresaId },
        select: { id: true, status: true, dataInicio: true },
      });
      if (!atual) return reply.status(404).send({ error: 'Plano de desenvolvimento não encontrado nesta empresa.' });

      const inicio = b.dataInicio ?? chaveDiaSql(atual.dataInicio);
      if (b.prazo && b.prazo < inicio) {
        return reply.status(400).send({ error: 'O prazo não pode ser anterior à data inicial.' });
      }
      if (b.dataInicio && b.dataInicio > hoje()) {
        return reply.status(400).send({ error: 'A data inicial não pode estar no futuro.' });
      }

      const acoes = b.acoes ? normalizarAcoes(b.acoes) : undefined;
      if (b.acoes && acoes!.length === 0) {
        return reply.status(400).send({ error: 'Inclua ao menos uma ação válida.' });
      }

      if (b.responsavelId) {
        const resp = await prisma.usuario.findFirst({
          where: { id: b.responsavelId, empresaId },
          select: { id: true },
        });
        if (!resp) return reply.status(404).send({ error: 'Responsável não encontrado nesta empresa.' });
      }

      const alterado = await prisma.$transaction(async (tx) => {
        const p = await tx.planoDesenvolvimento.update({
          where: { id: atual.id },
          data: {
            ...(b.status ? { status: b.status as any } : {}),
            ...(b.descricao ? { descricao: b.descricao } : {}),
            ...(b.competencia ? { competencia: b.competencia as any } : {}),
            ...(b.objetivo ? { objetivo: b.objetivo as any } : {}),
            ...(acoes ? { acoes: acoes as any } : {}),
            ...(b.prazo !== undefined ? { prazo: b.prazo ? new Date(`${b.prazo}T12:00:00`) : null } : {}),
            ...(b.dataInicio ? { dataInicio: new Date(`${b.dataInicio}T12:00:00`) } : {}),
            ...(b.responsavelId !== undefined ? { responsavelId: b.responsavelId } : {}),
            ...(b.observacoes !== undefined ? { observacoes: b.observacoes } : {}),
          },
        });
        await registrarAuditoria({
          usuarioId: req.user.id,
          empresaId,
          acao: 'EDITAR',
          entidade: 'PlanoDesenvolvimento',
          entidadeId: p.id,
          valorNovo: { status: p.status, acoes: Array.isArray(p.acoes) ? p.acoes.length : 0 },
          origem: 'MANUAL',
          ip: req.ip,
          contexto: `Plano de desenvolvimento atualizado (${atual.status} → ${p.status})`,
        });
        return p;
      });

      const completo = await prisma.planoDesenvolvimento.findUnique({
        where: { id: alterado.id },
        include: { funcionario: { select: { nome: true } } },
      });
      const nomes = await nomesResponsaveis([alterado.responsavelId]);
      return reply.send({
        ...paraDTO(completo, nomes.get(alterado.responsavelId ?? '') ?? null),
        funcionario: completo!.funcionario.nome,
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao atualizar plano de desenvolvimento');
      return reply.status(500).send({ error: 'Não foi possível atualizar o plano.' });
    }
  });
}

