import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { permissaoQualquerDas } from '../../middlewares/auth.js';
import { minutosNoFuso, minutosTrabalhados } from '../radar/radar.regras.js';
import { minutosPrevistosPorDia, intervaloIrregular, INTERVALO_PADRAO_MIN } from './lideranca.js';

/**
 * ROTAS — GESTÃO DE TEMPO (Ciclo 3)
 * ===================================
 *
 * NÃO É UM CRONÔMETRO. Nenhum registro é criado aqui: esta rota só LÊ o `Ponto`
 * e compara com a jornada PREVISTA que vem dos horários do cadastro. Nada é
 * escrito, nada é estimado, e a jornada usada é a MESMA que a folha apura
 * (`minutosTrabalhados`), para que o holerito e a tela não discordem.
 *
 * O que a tela mostra é NÚMERO, nunca julgamento: "18 horas extras no período
 * para Vendas" é dado; "João tem problema de gestão de tempo" não é, e não
 * existe em lugar nenhum deste arquivo.
 */

function empresaDoRequisicao(req: FastifyRequest): string {
  const empresaId = (req as any).user?.empresaId;
  if (!empresaId) throw new Error('Empresa não identificada.');
  return empresaId;
}

const hojeUtc = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
};
const chaveDia = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/** Primeiro e último dia do mês em `YYYY-MM`, em UTC. */
function intervaloDoMes(periodo: string): { ini: Date; fim: Date } {
  const [ano, mes] = periodo.split('-').map(Number);
  return { ini: new Date(Date.UTC(ano, mes - 1, 1, 12)), fim: new Date(Date.UTC(ano, mes, 0, 12)) };
}

const MES_RE = /^\d{4}-\d{2}$/;
const periodoDe = (q: any) => {
  const hj = chaveDia(hojeUtc());
  return typeof q?.periodo === 'string' && MES_RE.test(q.periodo) ? q.periodo : hj.slice(0, 7);
};

/** Minutos desde a meia-noite, no fuso da empresa, para as batidas de intervalo. */
const minutoDoDia = (d: Date | null, fuso: string): number | null => (d ? minutosNoFuso(d, fuso) : null);

export async function gestaoTempoRoutes(app: FastifyInstance): Promise<void> {
  const leitura = {
    preHandler: [
      (app as any).authenticate,
      permissaoQualquerDas([
        { modulo: 'rh', acao: 'visualizar' },
        { modulo: 'relatorios', acao: 'visualizar' },
      ]),
    ],
  };

  /**
   * GET /rh/gestao-tempo/resumo
   *
   * Consolidado da empresa e detalhe por pessoa. Todos os números vêm do
   * `Ponto`; a jornada prevista vem do cadastro. Sem horário previsto,
   * `minutosPrevistos` é `null` e `temJornadaPrevista` é `false` — a
   * comparação não é feita, em vez de assumir um padrão.
   */
  app.get('/rh/gestao-tempo/resumo', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const periodo = periodoDe(req.query ?? {});
      const { ini, fim } = intervaloDoMes(periodo);

      const empresa = await prisma.empresa.findFirst({ where: { id: empresaId }, select: { fusoHorario: true } });
      const fuso = empresa?.fusoHorario || 'America/Sao_Paulo';

      const [funcs, pontos] = await Promise.all([
        prisma.funcionario.findMany({
          where: { empresaId, status: { in: ['ATIVO', 'FERIAS', 'AFASTADO'] } },
          select: {
            id: true, nome: true,
            horarioEntradaPrevisto: true, horarioSaidaPrevisto: true,
            departamento: { select: { nome: true } },
          },
        }),
        prisma.ponto.findMany({
          where: { empresaId, data: { gte: ini, lte: fim } },
          select: {
            funcionarioId: true, entrada: true, saida: true,
            saidaIntervalo: true, retornoIntervalo: true,
            atrasoMinutos: true, horaExtraMinutos: true, falta: true,
          },
        }),
      ]);

      // Agregação por pessoa em memória: o volume é o de um mês de batidas, e
      // uma agregação no banco seria código que só esta tela usa.
      type Acc = {
        minutosTrabalhados: number; minutosExtras: number; minutosAtraso: number;
        diasAtraso: number; faltas: number; intervalosIrregulares: number;
        diasTrabalhados: number;
      };
      const porPessoa = new Map<string, Acc>();
      for (const f of funcs) {
        porPessoa.set(f.id, {
          minutosTrabalhados: 0, minutosExtras: 0, minutosAtraso: 0,
          diasAtraso: 0, faltas: 0, intervalosIrregulares: 0, diasTrabalhados: 0,
        });
      }
      for (const p of pontos) {
        const acc = porPessoa.get(p.funcionarioId);
        if (!acc) continue;
        const trabalhados = minutosTrabalhados(p.entrada, p.saida, p.saidaIntervalo, p.retornoIntervalo);
        if (trabalhados > 0) {
          acc.minutosTrabalhados += trabalhados;
          acc.diasTrabalhados += 1;
        }
        acc.minutosExtras += p.horaExtraMinutos ?? 0;
        acc.minutosAtraso += p.atrasoMinutos ?? 0;
        if ((p.atrasoMinutos ?? 0) > 0) acc.diasAtraso += 1;
        if (p.falta) acc.faltas += 1;
        if (intervaloIrregular(minutoDoDia(p.saidaIntervalo, fuso), minutoDoDia(p.retornoIntervalo, fuso), INTERVALO_PADRAO_MIN)) {
          acc.intervalosIrregulares += 1;
        }
      }

      const pessoas = funcs.map((f) => {
        const acc = porPessoa.get(f.id)!;
        const previstaDia = minutosPrevistosPorDia(f.horarioEntradaPrevisto, f.horarioSaidaPrevisto);
        return {
          funcionarioId: f.id,
          nome: f.nome,
          departamento: f.departamento?.nome ?? null,
          temJornadaPrevista: previstaDia !== null,
          horarioPrevisto:
            f.horarioEntradaPrevisto && f.horarioSaidaPrevisto
              ? `${f.horarioEntradaPrevisto}-${f.horarioSaidaPrevisto}`
              : null,
          ...acc,
          minutosPrevistos: previstaDia === null ? null : previstaDia * acc.diasTrabalhados,
        };
      });

      const comPrevisao = pessoas.filter((p) => p.minutosPrevistos !== null);
      const soma = (k: string) => pessoas.reduce((a, p) => a + ((p as any)[k] ?? 0), 0);

      const porDepartamento = new Map<string, {
        nome: string; pessoas: number; minutosTrabalhados: number; minutosExtras: number;
        minutosAtraso: number; diasAtraso: number; faltas: number; minutosPrevistos: number;
      }>();
      for (const p of pessoas) {
        const nome = p.departamento ?? 'SEM DEPARTAMENTO';
        if (!porDepartamento.has(nome)) {
          porDepartamento.set(nome, {
            nome, pessoas: 0, minutosTrabalhados: 0, minutosExtras: 0,
            minutosAtraso: 0, diasAtraso: 0, faltas: 0, minutosPrevistos: 0,
          });
        }
        const d = porDepartamento.get(nome)!;
        d.pessoas += 1;
        d.minutosTrabalhados += p.minutosTrabalhados;
        d.minutosExtras += p.minutosExtras;
        d.minutosAtraso += p.minutosAtraso;
        d.diasAtraso += p.diasAtraso;
        d.faltas += p.faltas;
        d.minutosPrevistos += p.minutosPrevistos ?? 0;
      }

      return reply.send({
        periodo,
        intervalo: { de: chaveDia(ini), ate: chaveDia(fim) },
        fuso,
        consolidado: {
          pessoas: pessoas.length,
          comJornadaPrevista: comPrevisao.length,
          diasTrabalhados: soma('diasTrabalhados'),
          minutosTrabalhados: soma('minutosTrabalhados'),
          minutosExtras: soma('minutosExtras'),
          minutosAtraso: soma('minutosAtraso'),
          diasAtraso: soma('diasAtraso'),
          faltas: soma('faltas'),
          intervalosIrregulares: soma('intervalosIrregulares'),
          // `null` quando NINGUÉM tem jornada prevista — a tela escreve
          // "cadastre o horário" em vez de mostrar 0 previsto.
          minutosPrevistos:
            comPrevisao.length === 0 ? null : comPrevisao.reduce((a, p) => a + (p.minutosPrevistos ?? 0), 0),
        },
        porDepartamento: [...porDepartamento.values()].sort((a, b) => b.minutosExtras - a.minutosExtras),
        pessoas: pessoas.sort((a, b) => b.minutosExtras - a.minutosExtras),
      });
    } catch (erro: any) {
      req.log.error(erro, 'Falha ao ler resumo de gestão de tempo');
      return reply.status(500).send({ error: 'Não foi possível ler o resumo de jornada.' });
    }
  });
}
