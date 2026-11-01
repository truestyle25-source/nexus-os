import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoQualquerDas } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { chaveDiaSql } from '../radar/radar.regras.js';
import {
  STATUS_TREINAMENTO, STATUS_PARTICIPANTE, CATEGORIAS, FORMATOS,
  ROTULO_STATUS, ROTULO_STATUS_PARTICIPANTE, ROTULO_FORMATO, ROTULO_CATEGORIA,
  calcularDuracaoMinutos, sugerirTreinamento, resumoPresenca, ehTreinamentoAtivo,
  DURACAO_MIN_MIN, DURACAO_MAX_MIN,
  COMPETENCIAS_TREINAMENTO,
  type ContextoCapacitacao,
} from './treinamentos.js';

/**
 * ROTAS — TREINAMENTOS (Ciclo 2)
 * ================================
 *
 * MULTI-TENANT
 * ------------
 * Toda rota chama `empresaDoRequisicao(req)` e usa o resultado como filtro de
 * TODA consulta. Nenhuma função deste arquivo aceita `empresaId` vindo do
 * corpo ou da query: o tenant tem uma origem só, e é o token.
 *
 * Um id de outra empresa é RECUSADO com 404 antes de qualquer gravação. Não é
 * "filtrado e fica vazio" — a diferença entre "não existe" e "é de outra
 * empresa" confirmaria a presença de um registro de terceiro.
 *
 * PERMISSÃO
 * ---------
 * Mesmo par do Ciclo 1: leitura aceita `rh:visualizar` OU `relatorios:visualizar`;
 * escrita aceita `rh:editar` OU `relatorios:editar`. Verificar no banco, sem
 * ler permissão do JWT.
 *
 * IA
 * --
 * `POST /analisar` NÃO GRAVA NADA, como no Ciclo 1: lê os indicadores reais,
 * pede a pauta e devolve. Quem grava é `POST /`, e só depois que o gestor
 * escolheu o que aceitar.
 */

/** `empresaId` do token. Única origem do tenant neste arquivo. */
function empresaDoRequisicao(req: FastifyRequest): string {
  const empresaId = (req as any).user?.empresaId;
  if (!empresaId) throw new Error('Empresa não identificada.');
  return empresaId;
}

const hoje = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

const DIAS_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PERIODO_RE = /^\d{4}-\d{2}$/;

// ===========================================================================
//  Schemas
// ===========================================================================

const criarSchema = z.object({
  titulo: z.string().min(3, 'Informe o título.').max(160),
  descricao: z.string().min(5, 'Descreva o treinamento.').max(2000),
  categoria: z.enum(CATEGORIAS),
  objetivo: z.string().min(5, 'Informe o objetivo.').max(600),
  instrutor: z.string().min(2, 'Informe o instrutor.').max(120),
  responsavelId: z.string().optional().nullable(),
  data: z.string().regex(DIAS_RE, 'Data deve estar em AAAA-MM-DD.'),
  // `HH:MM` como texto, pelo mesmo motivo de `Funcionario.horarioEntradaPrevisto`.
  horaInicio: z.string().regex(HHMM_RE, 'Horário deve estar em HH:MM.'),
  horaFim: z.string().regex(HHMM_RE, 'Horário deve estar em HH:MM.'),
  local: z.string().min(2, 'Informe o local.').max(160),
  /** `null`/ausente = sem limite. 0 é recusado pela regra de negócio. */
  limiteParticipantes: z.number().int().positive().max(10000).optional().nullable(),
  status: z.enum(STATUS_TREINAMENTO).optional(),
  planoDesenvolvimentoId: z.string().optional().nullable(),
  observacoes: z.string().max(2000).optional().nullable(),
  analiseIA: z.record(z.string(), z.unknown()).optional().nullable(),
});

const atualizarSchema = z.object({
  titulo: z.string().min(3).max(160).optional(),
  descricao: z.string().min(5).max(2000).optional(),
  categoria: z.enum(CATEGORIAS).optional(),
  objetivo: z.string().min(5).max(600).optional(),
  instrutor: z.string().min(2).max(120).optional(),
  responsavelId: z.string().optional().nullable(),
  data: z.string().regex(DIAS_RE).optional(),
  horaInicio: z.string().regex(HHMM_RE).optional(),
  horaFim: z.string().regex(HHMM_RE).optional(),
  local: z.string().min(2).max(160).optional(),
  limiteParticipantes: z.number().int().positive().max(10000).optional().nullable(),
  status: z.enum(STATUS_TREINAMENTO).optional(),
  planoDesenvolvimentoId: z.string().optional().nullable(),
  observacoes: z.string().max(2000).optional().nullable(),
});

const participantesSchema = z.object({
  /** Lista de ids. Aceita array; a rota valida cada um contra `empresaId`. */
  funcionarioIds: z.array(z.string().min(1)).min(1, 'Selecione ao menos um participante.').max(200),
  status: z.enum(['CONVIDADO', 'CONFIRMADO']).optional(),
});

const presencaSchema = z.object({
  /** `{ funcionarioId: 'PRESENTE' | 'AUSENTE' | 'CANCELADO' }` */
  registros: z
    .record(z.string(), z.enum(['PRESENTE', 'AUSENTE', 'CANCELADO', 'CONFIRMADO']))
    .refine((r) => Object.keys(r).length > 0, 'Envie ao menos um registro.'),
});

const analisarSchema = z.object({
  /** `AAAA-MM`. Ausente = mês corrente. */
  periodo: z.string().regex(PERIODO_RE, 'Período deve estar em AAAA-MM.').optional(),
});

// ===========================================================================
//  Auxiliares
// ===========================================================================

/** Nomes dos responsáveis, em UMA consulta. Coluna escalar, como no Ciclo 1. */
async function nomesResponsaveis(ids: Array<string | null>): Promise<Map<string, string>> {
  const limpo = ids.filter((x): x is string => Boolean(x));
  if (limpo.length === 0) return new Map();
  const usuarios = await prisma.usuario.findMany({
    where: { id: { in: limpo } },
    select: { id: true, nome: true },
  });
  return new Map(usuarios.map((u) => [u.id, u.nome]));
}

/** Limites do mês, em UTC, para agregar ponto/advertencia no período. */
function intervaloDoPeriodo(periodo: string): { ini: Date; fim: Date } {
  const [ano, mes] = periodo.split('-').map(Number);
  return {
    ini: new Date(Date.UTC(ano, mes - 1, 1)),
    fim: new Date(Date.UTC(ano, mes, 1)),
  };
}

const periodoCorrente = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Serializa uma linha de treinamento no formato que a tela consome. */
function paraDTO(t: any, nomeResponsavel: string | null, participantes: any[] = []) {
  return {
    id: t.id,
    titulo: t.titulo,
    descricao: t.descricao,
    categoria: t.categoria,
    categoriaRotulo: ROTULO_CATEGORIA[t.categoria as keyof typeof ROTULO_CATEGORIA] ?? t.categoria,
    objetivo: t.objetivo,
    instrutor: t.instrutor,
    responsavelId: t.responsavelId,
    responsavel: nomeResponsavel,
    data: chaveDiaSql(t.data),
    horaInicio: t.horaInicio,
    horaFim: t.horaFim,
    duracaoMinutos: t.duracaoMinutos,
    local: t.local,
    limiteParticipantes: t.limiteParticipantes,
    status: t.status,
    planoDesenvolvimentoId: t.planoDesenvolvimentoId,
    analiseIA: t.analiseIA,
    observacoes: t.observacoes,
    origem: t.origem,
    ativo: ehTreinamentoAtivo(t.status),
    presenca: resumoPresenca(participantes),
    participantes,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

type ParticipanteDTO = {
  id: string; funcionarioId: string; nome: string; departamento: string | null;
  status: string; statusRotulo: string; observacao: string | null; dataRegistro: string;
};
function paraParticipanteDTO(p: any): ParticipanteDTO {
  return {
    id: p.id,
    funcionarioId: p.funcionarioId,
    nome: p.funcionario?.nome ?? '—',
    departamento: p.funcionario?.departamento?.nome ?? null,
    status: p.status,
    statusRotulo: ROTULO_STATUS_PARTICIPANTE[p.status as keyof typeof ROTULO_STATUS_PARTICIPANTE] ?? p.status,
    observacao: p.observacao,
    dataRegistro: p.dataRegistro,
  };
}

/**
 * Carrega um treinamento com participantes, já serializado.
 *
 * Existe para que PATCH, presença e participantes devolvam exatamente o mesmo
 * formato de GET. Três rotas montando a resposta à mão divergem em três telas
 * diferentes — foi assim que o resumo de presença do Ciclo 1 ficou
 * inconsistente com o que a lista mostrava.
 */
async function carregarDetalhe(empresaId: string, id: string) {
  const t = await prisma.treinamento.findFirst({
    where: { id, empresaId },
    include: {
      participantes: {
        include: { funcionario: { select: { nome: true, departamento: { select: { nome: true } } } } },
        orderBy: { id: 'asc' },
      },
    },
  });
  if (!t) return null;
  const nomes = await nomesResponsaveis([t.responsavelId]);
  const parts = t.participantes.map(paraParticipanteDTO);
  return { ...paraDTO(t, nomes.get(t.responsavelId ?? '') ?? null, parts), participantes: parts };
}

export async function treinamentosRoutes(app: FastifyInstance): Promise<void> {
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

  /** GET /rh/treinamentos — lista da empresa, com a lista de participantes. */
  app.get('/rh/treinamentos', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const q = req.query ?? {};
      const status = typeof q.status === 'string' && STATUS_TREINAMENTO.includes(q.status as any)
        ? (q.status as any) : null;

      const treinamentos = await prisma.treinamento.findMany({
        where: { empresaId, ...(status ? { status } : {}) },
        orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
        take: 100,
        include: {
          participantes: {
            include: { funcionario: { select: { nome: true, departamento: { select: { nome: true } } } } },
            orderBy: { id: 'asc' },
          },
        },
      });
      const nomes = await nomesResponsaveis(treinamentos.map((t) => t.responsavelId));
      return reply.send({
        total: treinamentos.length,
        treinamentos: treinamentos.map((t) => {
          const parts = t.participantes.map(paraParticipanteDTO);
          return { ...paraDTO(t, nomes.get(t.responsavelId ?? '') ?? null, parts), participantes: parts };
        }),
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao listar treinamentos');
      return reply.status(500).send({ error: 'Não foi possível ler os treinamentos.' });
    }
  });

  /** GET /rh/treinamentos/:id */
  app.get('/rh/treinamentos/:id', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const t = await prisma.treinamento.findFirst({
        where: { id: req.params.id, empresaId },
        include: {
          participantes: {
            include: { funcionario: { select: { nome: true, departamento: { select: { nome: true } } } } },
            orderBy: { id: 'asc' },
          },
        },
      });
      // Mesmo 404 para "não existe" e "é de outra empresa": distinguir os dois
      // confirmaria a existência de um registro de terceiro.
      if (!t) return reply.status(404).send({ error: 'Treinamento não encontrado nesta empresa.' });
      const nomes = await nomesResponsaveis([t.responsavelId]);
      const parts = t.participantes.map(paraParticipanteDTO);
      return reply.send({ ...paraDTO(t, nomes.get(t.responsavelId ?? '') ?? null, parts), participantes: parts });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao ler treinamento');
      return reply.status(500).send({ error: 'Não foi possível ler o treinamento.' });
    }
  });

  /**
   * POST /rh/treinamentos
   *
   * A duração NUNCA vem do cliente: é deduzida de `horaInicio`/`horaFim`.
   * Horário contraditório é recusado em vez de gravar uma coluna que não bate
   * com o convite impresso.
   */
  app.post('/rh/treinamentos', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = criarSchema.parse(req.body ?? {});

      const duracao = calcularDuracaoMinutos(b.horaInicio, b.horaFim);
      if (duracao === null) {
        return reply.status(400).send({ error: 'O horário de fim deve ser depois do início, no mesmo dia.' });
      }
      if (duracao < DURACAO_MIN_MIN || duracao > DURACAO_MAX_MIN) {
        return reply.status(400).send({
          error: `A duração deve ficar entre ${DURACAO_MIN_MIN} e ${DURACAO_MAX_MIN} minutos (está em ${duracao}).`,
        });
      }
      if (b.responsavelId) {
        const resp = await prisma.usuario.findFirst({ where: { id: b.responsavelId, empresaId }, select: { id: true } });
        if (!resp) return reply.status(404).send({ error: 'Responsável não encontrado nesta empresa.' });
      }
      if (b.planoDesenvolvimentoId) {
        const plano = await prisma.planoDesenvolvimento.findFirst({
          where: { id: b.planoDesenvolvimentoId, empresaId }, select: { id: true },
        });
        if (!plano) return reply.status(404).send({ error: 'Plano de desenvolvimento não encontrado nesta empresa.' });
      }

      const t = await prisma.$transaction(async (tx) => {
        const criado = await tx.treinamento.create({
          data: {
            empresaId,
            titulo: b.titulo.trim(),
            descricao: b.descricao.trim(),
            categoria: b.categoria,
            objetivo: b.objetivo.trim(),
            instrutor: b.instrutor.trim(),
            responsavelId: b.responsavelId ?? req.user?.id ?? null,
            data: new Date(`${b.data}T12:00:00`),
            horaInicio: b.horaInicio,
            horaFim: b.horaFim,
            duracaoMinutos: duracao,
            local: b.local.trim(),
            limiteParticipantes: b.limiteParticipantes ?? null,
            status: (b.status ?? 'PLANEJADO') as any,
            planoDesenvolvimentoId: b.planoDesenvolvimentoId ?? null,
            analiseIA: (b.analiseIA ?? null) as any,
            observacoes: b.observacoes ?? null,
            origem: b.analiseIA ? 'IA' : 'MANUAL',
          },
        });
        await registrarAuditoria({
          usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'Treinamento', entidadeId: criado.id,
          valorNovo: { titulo: criado.titulo, data: b.data, categoria: criado.categoria, duracaoMinutos: duracao },
          origem: b.analiseIA ? 'IA' : 'MANUAL', ip: req.ip,
          contexto: `Treinamento "${criado.titulo}" criado para ${b.data} (${duracao} min)`,
        });
        return criado;
      });

      const nomes = await nomesResponsaveis([t.responsavelId]);
      return reply.status(201).send(paraDTO(t, nomes.get(t.responsavelId ?? '') ?? null, []));
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao criar treinamento');
      return reply.status(500).send({ error: 'Não foi possível criar o treinamento.' });
    }
  });

  /**
   * PATCH /rh/treinamentos/:id
   *
   * Se o horário muda, a duração é RECALCULADA. Ela nunca vem do cliente, e
   * nunca fica dessincronizada do horário.
   */
  app.patch('/rh/treinamentos/:id', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = atualizarSchema.parse(req.body ?? {});
      const atual = await prisma.treinamento.findFirst({
        where: { id: req.params.id, empresaId },
        select: { id: true, status: true, horaInicio: true, horaFim: true, titulo: true },
      });
      if (!atual) return reply.status(404).send({ error: 'Treinamento não encontrado nesta empresa.' });

      const horaInicio = b.horaInicio ?? atual.horaInicio;
      const horaFim = b.horaFim ?? atual.horaFim;
      const mudouHorario = b.horaInicio !== undefined || b.horaFim !== undefined;
      let duracao: number | undefined;
      if (mudouHorario) {
        const d = calcularDuracaoMinutos(horaInicio, horaFim);
        if (d === null) {
          return reply.status(400).send({ error: 'O horário de fim deve ser depois do início, no mesmo dia.' });
        }
        if (d < DURACAO_MIN_MIN || d > DURACAO_MAX_MIN) {
          return reply.status(400).send({ error: `A duração deve ficar entre ${DURACAO_MIN_MIN} e ${DURACAO_MAX_MIN} minutos.` });
        }
        duracao = d;
      }

      if (b.responsavelId) {
        const resp = await prisma.usuario.findFirst({ where: { id: b.responsavelId, empresaId }, select: { id: true } });
        if (!resp) return reply.status(404).send({ error: 'Responsável não encontrado nesta empresa.' });
      }
      if (b.planoDesenvolvimentoId) {
        const plano = await prisma.planoDesenvolvimento.findFirst({
          where: { id: b.planoDesenvolvimentoId, empresaId }, select: { id: true },
        });
        if (!plano) return reply.status(404).send({ error: 'Plano de desenvolvimento não encontrado nesta empresa.' });
      }

      const t = await prisma.$transaction(async (tx) => {
        const p = await tx.treinamento.update({
          where: { id: atual.id },
          data: {
            ...(b.titulo ? { titulo: b.titulo.trim() } : {}),
            ...(b.descricao ? { descricao: b.descricao.trim() } : {}),
            ...(b.categoria ? { categoria: b.categoria } : {}),
            ...(b.objetivo ? { objetivo: b.objetivo.trim() } : {}),
            ...(b.instrutor ? { instrutor: b.instrutor.trim() } : {}),
            ...(b.local ? { local: b.local.trim() } : {}),
            ...(b.data ? { data: new Date(`${b.data}T12:00:00`) } : {}),
            ...(mudouHorario ? { horaInicio, horaFim, duracaoMinutos: duracao } : {}),
            ...(b.limiteParticipantes !== undefined ? { limiteParticipantes: b.limiteParticipantes ?? null } : {}),
            ...(b.status ? { status: b.status as any } : {}),
            ...(b.planoDesenvolvimentoId !== undefined ? { planoDesenvolvimentoId: b.planoDesenvolvimentoId ?? null } : {}),
            ...(b.responsavelId !== undefined ? { responsavelId: b.responsavelId } : {}),
            ...(b.observacoes !== undefined ? { observacoes: b.observacoes } : {}),
          },
        });
        await registrarAuditoria({
          usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'Treinamento', entidadeId: p.id,
          valorAnterior: { status: atual.status, horaInicio: atual.horaInicio, horaFim: atual.horaFim },
          valorNovo: { status: p.status, horaInicio: p.horaInicio, horaFim: p.horaFim },
          origem: 'MANUAL', ip: req.ip,
          contexto: `Treinamento "${p.titulo}" atualizado (${atual.status} → ${p.status})`,
        });
        return p;
      });
      return reply.send(await carregarDetalhe(empresaId, t.id));
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao atualizar treinamento');
      return reply.status(500).send({ error: 'Não foi possível atualizar o treinamento.' });
    }
  });

  /**
   * POST /rh/treinamentos/:id/cancelar
   *
   * Cancelamento PRESERVA o registro e os participantes. Apagar a linha
   * destruiria o histórico de quem estava escalado para um treinamento que
   * existiu, mesmo que não tenha acontecido.
   */
  app.post('/rh/treinamentos/:id/cancelar', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim().slice(0, 500) : null;
      const atual = await prisma.treinamento.findFirst({
        where: { id: req.params.id, empresaId },
        select: { id: true, status: true, titulo: true },
      });
      if (!atual) return reply.status(404).send({ error: 'Treinamento não encontrado nesta empresa.' });
      if (atual.status === 'CANCELADO') {
        return reply.status(409).send({ error: 'Este treinamento já está cancelado.' });
      }
      if (atual.status === 'CONCLUIDO') {
        return reply.status(409).send({ error: 'Um treinamento concluído não pode ser cancelado. O histórico fica.' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.treinamento.update({
          where: { id: atual.id },
          data: { status: 'CANCELADO', observacoes: motivo ? `Cancelado: ${motivo}` : 'Cancelado' },
        });
        // Quem estava na lista vira CANCELADO, e não continua "convidado" para
        // um evento que não vai acontecer.
        await tx.participanteTreinamento.updateMany({
          where: { treinamentoId: atual.id, status: { in: ['CONVIDADO', 'CONFIRMADO'] } },
          data: { status: 'CANCELADO' },
        });
        await registrarAuditoria({
          usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'Treinamento', entidadeId: atual.id,
          valorAnterior: { status: atual.status }, valorNovo: { status: 'CANCELADO' },
          origem: 'MANUAL', ip: req.ip,
          contexto: `Treinamento "${atual.titulo}" cancelado${motivo ? `: ${motivo}` : ''}`,
        });
      });
      return reply.send(await carregarDetalhe(empresaId, atual.id));
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao cancelar treinamento');
      return reply.status(500).send({ error: 'Não foi possível cancelar o treinamento.' });
    }
  });

  /**
   * POST /rh/treinamentos/:id/participantes
   *
   * Cada id é validado contra `empresaId` ANTES de gravar. Um funcionário de
   * outra empresa não é "ignorado": a requisição inteira é recusada, para que
   * o gestor não ache que inseriu e não veja que não inseriu.
   */
  app.post('/rh/treinamentos/:id/participantes', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = participantesSchema.parse(req.body ?? {});
      const t = await prisma.treinamento.findFirst({
        where: { id: req.params.id, empresaId },
        select: { id: true, status: true, limiteParticipantes: true, titulo: true },
      });
      if (!t) return reply.status(404).send({ error: 'Treinamento não encontrado nesta empresa.' });
      if (t.status === 'CANCELADO' || t.status === 'CONCLUIDO') {
        return reply.status(409).send({ error: 'Não é possível incluir participantes em um treinamento encerrado.' });
      }

      const ids = [...new Set(b.funcionarioIds)];
      const funcs = await prisma.funcionario.findMany({
        where: { id: { in: ids }, empresaId, status: { in: ['ATIVO', 'FERIAS', 'AFASTADO'] } },
        select: { id: true },
      });
      if (funcs.length !== ids.length) {
        const achados = funcs.map((f) => f.id);
        const rejeitados = ids.filter((i) => !achados.includes(i));
        return reply.status(404).send({
          error: `${rejeitados.length} funcionário(s) não encontrado(s) ou inativo(s) nesta empresa.`,
          ids: rejeitados,
        });
      }

      const jaNaLista = await prisma.participanteTreinamento.findMany({
        where: { treinamentoId: t.id, funcionarioId: { in: ids } },
        select: { funcionarioId: true },
      });
      const existentes = jaNaLista.map((p) => p.funcionarioId);
      const novos = ids.filter((i) => !existentes.includes(i));

      if (t.limiteParticipantes !== null && jaNaLista.length + novos.length > t.limiteParticipantes) {
        return reply.status(409).send({
          error: `Limite de ${t.limiteParticipantes} participante(s) ultrapassado (${jaNaLista.length + novos.length}).`,
        });
      }

      let adicionados = 0;
      if (novos.length > 0) {
        const r = await prisma.$transaction(async (tx) => {
          const out = await tx.participanteTreinamento.createMany({
            data: novos.map((funcionarioId) => ({
              empresaId, treinamentoId: t.id, funcionarioId,
              status: (b.status ?? 'CONVIDADO') as any,
            })),
          });
          await registrarAuditoria({
            usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'ParticipanteTreinamento', entidadeId: t.id,
            valorNovo: { funcionarioIds: novos, total: jaNaLista.length + novos.length },
            origem: 'MANUAL', ip: req.ip,
            contexto: `${novos.length} participante(s) incluído(s) em "${t.titulo}"`,
          });
          return out;
        });
        adicionados = r.count;
      }
      return reply.status(201).send({ adicionados, jaExistentes: existentes.length, ...(await carregarDetalhe(empresaId, t.id)) });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao incluir participantes');
      return reply.status(500).send({ error: 'Não foi possível incluir os participantes.' });
    }
  });

  /**
   * DELETE /rh/treinamentos/:id/participantes/:funcionarioId
   *
   * Se a presença já foi registrada, a remoção é recusada: apagar a linha
   * destruiria o histórico de capacitação da pessoa, que é justamente o que o
   * módulo promete guardar.
   */
  app.delete('/rh/treinamentos/:id/participantes/:funcionarioId', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const t = await prisma.treinamento.findFirst({
        where: { id: req.params.id, empresaId }, select: { id: true, titulo: true },
      });
      if (!t) return reply.status(404).send({ error: 'Treinamento não encontrado nesta empresa.' });

      const p = await prisma.participanteTreinamento.findFirst({
        where: { treinamentoId: t.id, funcionarioId: req.params.funcionarioId, empresaId },
        select: { id: true, status: true, funcionario: { select: { nome: true } } },
      });
      if (!p) return reply.status(404).send({ error: 'Participante não encontrado neste treinamento.' });
      if (p.status === 'PRESENTE' || p.status === 'AUSENTE') {
        return reply.status(409).send({
          error: 'A presença já foi registrada. O histórico não pode ser apagado; cancele a participação em vez de remover.',
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.participanteTreinamento.delete({ where: { id: p.id } });
        await registrarAuditoria({
          usuarioId: req.user.id, empresaId, acao: 'EXCLUIR', entidade: 'ParticipanteTreinamento', entidadeId: t.id,
          valorAnterior: { funcionario: p.funcionario.nome, status: p.status },
          origem: 'MANUAL', ip: req.ip,
          contexto: `${p.funcionario.nome} removido(a) de "${t.titulo}"`,
        });
      });
      return reply.send({ removido: true, ...(await carregarDetalhe(empresaId, t.id)) });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao remover participante');
      return reply.status(500).send({ error: 'Não foi possível remover o participante.' });
    }
  });

  /**
   * PATCH /rh/treinamentos/:id/presenca
   *
   * REGRA CENTRAL: presença em treinamento NÃO toca no Ponto. Não gera falta,
   * não gera hora extra, não altera o espelho de ponto e não entra na folha.
   * São dados de capacitação, guardados na própria tabela, e as duas
   * informações nunca se misturam.
   */
  app.patch('/rh/treinamentos/:id/presenca', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = presencaSchema.parse(req.body ?? {});
      const t = await prisma.treinamento.findFirst({
        where: { id: req.params.id, empresaId }, select: { id: true, status: true, titulo: true },
      });
      if (!t) return reply.status(404).send({ error: 'Treinamento não encontrado nesta empresa.' });
      if (t.status === 'CANCELADO') {
        return reply.status(409).send({ error: 'Treinamento cancelado não aceita registro de presença.' });
      }

      const ids = Object.keys(b.registros);
      const partes = await prisma.participanteTreinamento.findMany({
        where: { treinamentoId: t.id, funcionarioId: { in: ids }, empresaId },
        select: { id: true, funcionarioId: true, status: true, funcionario: { select: { nome: true } } },
      });
      if (partes.length !== ids.length) {
        const achados = partes.map((p) => p.funcionarioId);
        return reply.status(404).send({
          error: `${ids.length - achados.length} participante(s) não encontrado(s) neste treinamento.`,
          ids: ids.filter((i) => !achados.includes(i)),
        });
      }

      await prisma.$transaction(async (tx) => {
        for (const p of partes) {
          const novo = b.registros[p.funcionarioId];
          await tx.participanteTreinamento.update({ where: { id: p.id }, data: { status: novo as any } });
          await registrarAuditoria({
            usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'ParticipanteTreinamento', entidadeId: t.id,
            valorAnterior: { funcionario: p.funcionario.nome, status: p.status },
            valorNovo: { funcionario: p.funcionario.nome, status: novo },
            origem: 'MANUAL', ip: req.ip,
            contexto: `Presença de ${p.funcionario.nome} em "${t.titulo}": ${p.status} → ${novo}`,
          });
        }
      });
      return reply.send({ registrados: partes.length, ...(await carregarDetalhe(empresaId, t.id)) });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao registrar presença');
      return reply.status(500).send({ error: 'Não foi possível registrar a presença.' });
    }
  });

  /**
   * GET /rh/funcionarios/:id/treinamentos
   *
   * Histórico real de capacitação. Treinamentos CANCELADOS aparecem com o
   * status: quem foi escalado para um evento que não aconteceu é informação,
   * e escondê-lo faria a tela dizer "1 treinamento" quando houve duas
   * decisões registradas.
   */
  app.get('/rh/funcionarios/:id/treinamentos', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const func = await prisma.funcionario.findFirst({
        where: { id: req.params.id, empresaId },
        select: { id: true, nome: true, departamento: { select: { nome: true } } },
      });
      if (!func) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });

      const participacoes = await prisma.participanteTreinamento.findMany({
        where: { empresaId, funcionarioId: func.id },
        orderBy: { dataRegistro: 'desc' },
        include: { treinamento: { select: { id: true, titulo: true, categoria: true, data: true, status: true, instrutor: true } } },
      });

      return reply.send({
        funcionario: { id: func.id, nome: func.nome, departamento: func.departamento?.nome ?? null },
        total: participacoes.length,
        // Só `PRESENTE` conta como "realizado": convite não aceito ou ausência
        // não viram "travou um treinamento".
        realizados: participacoes.filter((p) => p.status === 'PRESENTE').length,
        historico: participacoes.map((p) => ({
          id: p.id,
          status: p.status,
          statusRotulo: ROTULO_STATUS_PARTICIPANTE[p.status as keyof typeof ROTULO_STATUS_PARTICIPANTE] ?? p.status,
          observacao: p.observacao,
          dataRegistro: p.dataRegistro,
          treinamento: {
            id: p.treinamento.id,
            titulo: p.treinamento.titulo,
            categoria: p.treinamento.categoria,
            data: chaveDiaSql(p.treinamento.data),
            status: p.treinamento.status,
            instrutor: p.treinamento.instrutor,
          },
        })),
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao ler histórico de treinamentos');
      return reply.status(500).send({ error: 'Não foi possível ler o histórico.' });
    }
  });

  /**
   * POST /rh/treinamentos/analisar
   *
   * PERGUNTA À IA. NÃO GRAVA NADA.
   *
   * A IA recebe CONTAGENS AGREGADAS por departamento — nunca identificadores.
   * Não entra nome, cargo, CPF, e-mail, id de funcionário, nem qualquer número
   * de outra empresa. É o que torna impossível a IA produzir um julgamento
   * individual, e não apenas improvável.
   *
   * Sem base, a resposta é 200 com `sugestao: null` e `dadosInsuficientes:
   * true` — a tela diz "dados insuficientes" em vez de mostrar uma pauta que
   * não tem nada atrás.
   */
  app.post(
    '/rh/treinamentos/analisar',
    { preHandler: [...leitura.preHandler, iaLimiter] },
    async (req: any, reply) => {
      try {
        const empresaId = empresaDoRequisicao(req);
        const b = analisarSchema.parse(req.body ?? {});
        const periodo = b.periodo ?? periodoCorrente();
        const { ini, fim } = intervaloDoPeriodo(periodo);

        // Uma consulta por fonte, todas filtradas por `empresaId`. É a empresa
        // do token — não há parâmetro de empresa vindo do corpo.
        const [departamentos, pontos, advertencias, disc, planos, participacoes] = await Promise.all([
          prisma.funcionario.findMany({
            where: { empresaId, status: { in: ['ATIVO', 'FERIAS', 'AFASTADO'] } },
            select: { id: true, departamento: { select: { nome: true } } },
          }),
          prisma.ponto.findMany({
            where: { empresaId, data: { gte: ini, lt: fim } },
            select: { funcionarioId: true, atrasoMinutos: true, horaExtraMinutos: true, falta: true },
          }),
          prisma.advertencia.findMany({
            where: { empresaId, data: { gte: ini, lt: fim } }, select: { funcionarioId: true },
          }),
          prisma.avaliacaoComportamental.findMany({
            where: { empresaId, vigente: true }, select: { funcionarioId: true },
          }),
          prisma.planoDesenvolvimento.findMany({
            where: { empresaId, status: { not: 'CANCELADO' } }, select: { funcionarioId: true },
          }),
          prisma.participanteTreinamento.findMany({
            where: { empresaId, status: 'PRESENTE' },
            select: { funcionarioId: true, treinamento: { select: { data: true } } },
          }),
        ]);

        // Agregação POR DEPARTAMENTO. Quem não tem departamento vira
        // "SEM DEPARTAMENTO" e não desaparece: sumir com a categoria esconderia
        // o fato de existir gente sem departamento cadastrado.
        type Dept = ContextoCapacitacao['departamentos'][number];
        const mapa = new Map<string, Dept>();
        const idParaNome = new Map<string, string>();
        for (const f of departamentos) {
          const nome = f.departamento?.nome ?? 'SEM DEPARTAMENTO';
          if (!mapa.has(nome)) {
            mapa.set(nome, {
              nome, pessoas: 0, minutosAtraso: 0, minutosHoraExtra: 0,
              faltas: 0, advertencias: 0, comAvaliacaoDisc: 0,
              comPlanoDesenvolvimento: 0, treinamentosRealizados: 0,
            });
          }
          idParaNome.set(f.id, nome);
          mapa.get(nome)!.pessoas += 1;
        }
        for (const p of pontos) {
          const nome = idParaNome.get(p.funcionarioId);
          if (!nome) continue;
          const d = mapa.get(nome)!;
          d.minutosAtraso += p.atrasoMinutos ?? 0;
          d.minutosHoraExtra += p.horaExtraMinutos ?? 0;
          if (p.falta) d.faltas += 1;
        }
        for (const a of advertencias) {
          const nome = idParaNome.get(a.funcionarioId);
          if (nome) mapa.get(nome)!.advertencias += 1;
        }
        for (const a of disc) {
          const nome = idParaNome.get(a.funcionarioId);
          if (nome) mapa.get(nome)!.comAvaliacaoDisc += 1;
        }
        for (const p of planos) {
          const nome = idParaNome.get(p.funcionarioId);
          if (nome) mapa.get(nome)!.comPlanoDesenvolvimento += 1;
        }
        // "Realizados" no período: só conta o que tem PRESENÇA registrada,
        // nunca o que foi apenas agendado.
        for (const part of participacoes) {
          const nome = idParaNome.get(part.funcionarioId);
          if (!nome) continue;
          if (part.treinamento.data >= ini && part.treinamento.data < fim) {
            mapa.get(nome)!.treinamentosRealizados += 1;
          }
        }

        const lista = [...mapa.values()];
        const totais = lista.reduce(
          (acc, d) => ({
            pessoas: acc.pessoas + d.pessoas,
            minutosAtraso: acc.minutosAtraso + d.minutosAtraso,
            minutosHoraExtra: acc.minutosHoraExtra + d.minutosHoraExtra,
            faltas: acc.faltas + d.faltas,
            advertencias: acc.advertencias + d.advertencias,
            treinamentosRealizados: acc.treinamentosRealizados + d.treinamentosRealizados,
          }),
          { pessoas: 0, minutosAtraso: 0, minutosHoraExtra: 0, faltas: 0, advertencias: 0, treinamentosRealizados: 0 },
        );

        // Base mínima: sem gente, ou sem NENHUM sinal no período, não há o que
        // sugerir. Mandar a IA trabalhar com período vazio só produziria opinião
        // genérica — a fictícioidade que este módulo existe para remover.
        const temSinal =
          totais.minutosAtraso > 0 || totais.minutosHoraExtra > 0 ||
          totais.faltas > 0 || totais.advertencias > 0;
        const indicadores = { totais, porDepartamento: lista };
        if (totais.pessoas === 0 || !temSinal) {
          return reply.send({
            sugestao: null,
            dadosInsuficientes: true,
            motivo: totais.pessoas === 0
              ? 'Não há funcionários ativos nesta empresa.'
              : 'Dados insuficientes para gerar uma recomendação: o período não tem atraso, hora extra, falta nem registro disciplinar.',
            periodo,
            indicadores,
          });
        }

        const r = await sugerirTreinamento({
          periodo,
          departamentos: lista,
          totais,
          opcoes: { categoria: CATEGORIAS, competencia: COMPETENCIAS_TREINAMENTO, formato: FORMATOS },
        });

        if (!r.ok) {
          return reply.send({
            sugestao: null,
            dadosInsuficientes: r.dadosInsuficientes,
            motivo: r.motivo,
            periodo,
            // Os indicadores vão JUNTO da falha. São eles que permitem ao
            // gestor entender por que a IA não有很大 o que sugerir, e
            // decidir se vale registrar dados melhores. Devolvê-los só no
            // caminho feliz esconderia a informação justamente quando ela
            // importa.
            ...indicadores,
          });
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
        req.log.error(erro, 'Falha ao pedir sugestão de treinamento');
        return reply.status(500).send({ error: 'Não foi possível pedir a sugestão.' });
      }
    },
  );
}
