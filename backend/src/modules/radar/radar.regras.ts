/**
 * Motor de REGRAS do Radar Organizacional.
 *
 * Tudo aqui ? determinístico e explicável: cada regra devolve o FATO observado
 * ("4 atrasos em 21 dias") e a evidência que gerou ele. Nada diagnostica doença,
 * burnout ou condição de saúde - o módulo não tem competência para isso e o
 * texto proíbe. A linguagem de saída ? sempre descritiva e não dicta o gestor.
 *
 * POR QUE UM ARQUIVO SÓ DE REGRAS
 * -------------------------------
 * O `/radar/resumo` já é a rota HTTP. A lógica de negócio (quais sinais
 * existem, como se combinam, com que limiar) é testável sozinha, versionável
 * sozinha e reutilizável pelo simulador e pela IA - que precisam exatamente da
 * mesma leitura dos dados. Três consumidores, uma única fonte de verdade.
 */

import { prisma } from '../../lib/prisma.js';
import { normalizarFuso } from '../../lib/fuso.js';

export type Criticidade = 'Alta' | 'Média' | 'Baixa';

export interface Janela {
  inicio: Date;
  fim: Date;
  diasUteis: number;
}

export interface EvidenciaAlerta {
  id: string;
  titulo: string;
  area: string;
  tipo: 'Burnout' | 'Gargalo' | 'Clima' | 'Cliente';
  criticidade: Criticidade;
  /** Fato observado, em linguagem neutra. */
  fato: string;
  impacto: string;
  /** Números que sustentam o fato - o gestor precisa conferir. */
  evidencias: string[];
  /** O que o Radar sugere verificar. NÃO é diagnóstico nem ordem. */
  sugestao: string;
  /** 'Alta' = agir em dias; não é gravidade clúnica. */
  prazoDias: number;
  origem: string;
  /** Chave estável para deduplicar e para o plano de ação referenciar. */
  ref: string;
  /**
   * A quem o sinal se refere. Ausente quando o sinal é da EMPRESA (área, meta,
   * estoque) e não de uma pessoa — daí o `null`, e não string vazia: a tela usa
   * este campo para decidir se mostra o nome de alguém.
   */
  funcionarioId?: string | null;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const pct = (parte: number, total: number) => (total > 0 ? (parte / total) * 100 : 0);
const arred = (n: number, c = 1) => Math.round(n * 10 ** c) / 10 ** c;
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * `YYYY-MM-DD` de um instante na data local do PROCESSO.
 *
 * Use para datas construídas em memória (a janela do período, a data de hoje,
 * as semanas do heatmap): elas já são "meia-noite local" e formatá-las em UTC
 * ou no fuso da empresa as deslocaria.
 */
export const chaveDia = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * `YYYY-MM-DD` de uma coluna `@db.Date` do Postgres.
 *
 * Differe de `chaveDia` de propósito. `@db.Date` guarda o dia puro e o Prisma
 * devolve `2026-09-26T00:00:00Z`; formatar isso no fuso da empresa recua um dia
 * (meia-noite UTC ainda ? o dia ANTERIOR em São Paulo), e formatar no fuso da
 * máquina erra em deploy em UTC. A data guardada ? o dia, então ela ? lida em
 * UTC - que ? exatamente a convenção com que foi escrita.
 *
 * Bug observado: avaliação registrada em 2026-09-26 voltava como `discData`
 * "2026-09-25", fazendo a tela mostrar o lançamento no dia errado.
 */
export const chaveDiaSql = (d: Date) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

export function diasUteis(inicio: Date, fim: Date): number {
  let total = 0;
  const c = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  const l = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
  while (c <= l) {
    const d = c.getDay();
    if (d !== 0 && d !== 6) total++;
    c.setDate(c.getDate() + 1);
  }
  return total;
}

export function inicioSemana(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}

export function semanasRecentes(fim: Date, n: number): Array<{ inicio: Date; chave: string }> {
  const base = inicioSemana(fim);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() - (n - 1 - i) * 7);
    return { inicio: d, chave: chaveDia(d) };
  });
}

/** Minutos desde meia-noite, no fuso da EMPRESA (nunca o da máquina). */
export function minutosNoFuso(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(instante);
  const pega = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  const h = pega('hour');
  return (h === 24 ? 0 : h) * 60 + pega('minute');
}

/** "HH:MM" (texto, como no Funcionario) → minutos desde meia-noite. */
export function minutosDeHHMM(texto?: string | null): number | null {
  if (!texto) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(texto.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Minutos EFETIVAMENTE trabalhados em um dia, a partir das batidas REAIS.
 *
 * A versão anterior usava `saida − entrada − 60min`, com o intervalo fixo de
 * uma hora. Isso erra em dois casos que o próprio espelho de ponto registra:
 *
 *  - intervalo de 1h20 (12:00 → 13:20) era contado como 1h — a jornada
 *    inflava 20 min por dia;
 *  - intervalo de 20 min (12:40 → 13:00) era contado como 1h — a jornada
 *    deflatava 40 min por dia, e alguém que almoçou rápido "perdia" ponto.
 *
 * Com 5 dias, o erro passava de 3 horas. O NEXUS OS grava as quatro batidas
 * (`saidaIntervalo` e `retornoIntervalo`), então a conta correta é somar os
 * trechos efetivamente trabalhados:
 *
 *   entrada → saidaIntervalo   +   retornoIntervalo → saida
 *
 * Sem as batidas de intervalo registradas (importação antiga, ponto apenas
 * com entrada e saída), cai no comportamento antigo: descontar 1h. É uma
 * hipótese declarada, e só é usada quando não há dado melhor — nunca o
 * contrário.
 */
export function minutosTrabalhados(
  entrada?: Date | null,
  saida?: Date | null,
  saidaIntervalo?: Date | null,
  retornoIntervalo?: Date | null,
): number {
  if (!entrada || !saida) return 0;
  const total = Math.round((saida.getTime() - entrada.getTime()) / 60000);
  if (total <= 0) return 0;
  // Intervalo REAL entre as batidas. É a mesma conta de `rh/verbas.ts`
  // (folha) — de propósito: jornada apurada na folha e jornada mostrada no
  // Radar têm de ser o mesmo número, senão o gestor vê o holerito discordar
  // da tela.
  const intervalo = saidaIntervalo && retornoIntervalo
    ? Math.round((retornoIntervalo.getTime() - saidaIntervalo.getTime()) / 60000)
    : 0;
  if (intervalo > 0) return Math.max(0, total - intervalo);
  // Sem as batidas de intervalo registradas (importação antiga, ponto só com
  // entrada e saída), o intervalo é desconhecido. A hipótese de 1h é a mesma
  // que a folha usa, e é declarada como hipótese — não como medição.
  return Math.max(0, total - 60);
}

export function hhmmDeMinutos(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

// ═════════════════════════════════════════════════════════════════════
// Coleta: uma única passagem de leitura sobre os módulos que o Radar cruza
// ═════════════════════════════════════════════════════════════════════

export type PontoLeitura = {
  id: string; funcionarioId: string; data: Date;
  entrada: Date | null; saidaIntervalo: Date | null; retornoIntervalo: Date | null; saida: Date | null;
  atrasoMinutos: number; horaExtraMinutos: number; falta: boolean;
  saidaAntecipada: boolean; inconsistencia: string | null;
};

export type FuncionarioLeitura = {
  id: string; nome: string; status: string;
  departamentoId: string | null; setor: string;
  cargo: string | null; usuarioId: string | null;
  horarioEntradaPrevisto: string | null; horarioSaidaPrevisto: string | null;
  jornada: string | null; cargaHoraria: string | null;
};

export type Coleta = {
  empresaId: string;
  janela: Janela;
  /** Fuso da empresa - nunca o da máquina que rodou o servidor. */
  fuso: string;
  funcionarios: FuncionarioLeitura[];
  pontos: PontoLeitura[];
  advertencias: Array<{ id: string; funcionarioId: string; tipo: string; data: Date }>;
  suspensoes: Array<{ id: string; funcionarioId: string; dias: number; inicio: Date }>;
  desligamentos: Array<{ id: string; funcionarioId: string; data: Date; tipoLabel: string }>;
  /** Vendas finalizadas do período, por usuário (PDV → usuário → funcionário). */
  vendasPorUsuario: Map<string, { qtd: number; total: number }>;
  metas: Array<{ id: string; tipo: string; periodo: string; setorId: string | null; funcionarioId: string | null; metaValor: number; realizado: number; percentual: number; status: string }>;
  /** Produtos abaixo do mínimo, por filial. */
  rupturas: Array<{ produto: string; filial: string; quantidade: number; minimo: number }>;
  /**
   * `Departamento.id` → nome. A Meta referencia o setor por id, e o Radar
   * compara por NOME (é o que a tela mostra). Sem esta ponte, a meta de um setor
   * não cairia em nenhuma área de risco.
   */
  nomeSetorPorId: Map<string, string>;
  /** Clientes sem comprar no período (base de churn). */
  clientesInativos: Array<{ nome: string; diasSemComprar: number; valorTotal: number }>;
  avaliacoesDisc: Map<string, { id: string; perfil: string | null; scores: Record<string, number> | null; dataAvaliacao: Date; observacoes: string | null }>;
  bemEstar: Map<string, { nota: number; dataPesquisa: Date; resposta: string | null }>;
  registrosGamificacao: Array<{ id: string; funcionarioId: string | null; tipo: string; descricao: string; pontos: number; regraId: string | null; data: Date; status: string }>;
  acoesRadar: Array<{ id: string; alertaRef: string; status: string; createdAt: Date; acoes: unknown; prazo: Date | null; responsavelId: string | null }>;
  /**
   * Plano de desenvolvimento mais recente de cada funcionário (Ciclo 1).
   *
   * O Radar só CONSOME: mostra se existe, o objetivo, o responsável, o prazo, o
   * status e o quanto das ações já foi concluído. Nenhum número aqui é
   * estimado — `progressoAcoes` vem das ações gravadas pelo gestor.
   *
   * CANCELADO não entra: um plano cancelado não é um plano em andamento, e o
   * Radar não deve sugerir acompanhamento de algo que foi descartado. Ele
   * continua no histórico do RH.
   */
  planosDesenvolvimento: Map<string, {
    id: string; objetivo: string; competencia: string; status: string;
    prazo: Date | null; dataInicio: Date; responsavelId: string | null;
    acoes: unknown; perfil: string | null;
  }>;
};

export const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};


/**
 * Coleta em paralelo: uma passada de leitura sobre os módulos que o Radar
 * cruza. Tudo filtrado por `empresaId` - o isolamento por tenant acontece aqui
 * e em nenhuma consulta é feito "depois".
 */
export async function coletarRadar(empresaId: string, janela: Janela): Promise<Coleta> {
  const { inicio, fim } = janela;

  const [funcionarios, pontos, advertencias, suspensoes, desligamentos, vendas, metas, estoques, clientes, avaliacoes, pesquisas, gamificacao, acoes, planosDesenvolvimento] =
    await Promise.all([
      prisma.funcionario.findMany({
        where: { empresaId, status: { in: ['ATIVO', 'FERIAS', 'AFASTADO'] } },
        select: {
          id: true, nome: true, status: true, departamentoId: true, cargoId: true, usuarioId: true,
          horarioEntradaPrevisto: true, horarioSaidaPrevisto: true, jornada: true, cargaHoraria: true,
          departamento: { select: { nome: true } },
          cargo: { select: { nome: true } },
        },
        orderBy: { nome: 'asc' },
      }),
      prisma.ponto.findMany({
        where: { empresaId, data: { gte: inicio, lte: fim } },
        select: {
          id: true, funcionarioId: true, data: true, entrada: true, saidaIntervalo: true,
          retornoIntervalo: true, saida: true, atrasoMinutos: true, horaExtraMinutos: true,
          falta: true, saidaAntecipada: true, inconsistencia: true,
        },
      }),
      prisma.advertencia.findMany({ where: { empresaId, data: { gte: inicio, lte: fim } }, select: { id: true, funcionarioId: true, tipo: true, data: true } }),
      prisma.suspensao.findMany({ where: { empresaId, inicio: { gte: inicio, lte: fim } }, select: { id: true, funcionarioId: true, dias: true, inicio: true } }),
      prisma.desligamento.findMany({ where: { empresaId, data: { gte: inicio, lte: fim } }, select: { id: true, funcionarioId: true, data: true, tipoLabel: true } }),
      prisma.venda.findMany({
        where: { empresaId, status: 'FINALIZADA', createdAt: { gte: inicio, lte: fim }, funcionarioId: { not: null } },
        select: { funcionarioId: true, total: true },
      }),
      prisma.meta.findMany({ where: { empresaId }, select: { id: true, tipo: true, periodo: true, setorId: true, funcionarioId: true, metaValor: true, realizado: true, percentual: true, status: true } }),
      prisma.estoque.findMany({
        where: { empresaId },
        select: { quantidade: true, produto: { select: { nome: true, estoqueMinimo: true } }, filial: { select: { nome: true } } },
      }),
      prisma.cliente.findMany({ where: { empresaId, status: 'ATIVO' }, select: { nome: true, valorTotalComprado: true, ultimaCompra: true } }),
      prisma.avaliacaoComportamental.findMany({
        where: { empresaId, vigente: true },
        // `id` entra porque o Plano de Desenvolvimento (Ciclo 1) se ancora na
    // avaliação vigente: sem ele, a tela não sabe qual avaliação originou o
    // plano que vai gravar.
    select: { id: true, funcionarioId: true, perfil: true, scores: true, dataAvaliacao: true, observacoes: true },
        orderBy: { dataAvaliacao: 'desc' },
      }),
      prisma.pesquisaBemEstar.findMany({
        where: { empresaId },
        select: { funcionarioId: true, nota: true, dataPesquisa: true, resposta: true },
        orderBy: { dataPesquisa: 'desc' },
      }),
      prisma.registroGamificacao.findMany({
        where: { empresaId, status: 'ATIVO' },
        select: { id: true, funcionarioId: true, tipo: true, descricao: true, pontos: true, regraId: true, data: true, status: true },
      }),
      // Traz o conteúdo do plano (ações, prazo, responsável) além do status: a
      // tela precisa mostrar o que foi planejado, senão "Criar Plano de Ação"
      // grava algo que o gestor não tem como reencontrar.
      prisma.acaoRadar.findMany({ where: { empresaId }, select: { id: true, alertaRef: true, status: true, createdAt: true, acoes: true, prazo: true, responsavelId: true } }),
      // Ciclo 1: planos de desenvolvimento ativos. O CANCELADO é filtrado no
      // banco porque ele nunca deve aparecer como "em andamento" no Radar.
      prisma.planoDesenvolvimento.findMany({
        where: { empresaId, status: { not: 'CANCELADO' } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, funcionarioId: true, objetivo: true, competencia: true, status: true,
          prazo: true, dataInicio: true, responsavelId: true, acoes: true, perfil: true,
        },
      }),
    ]);

  // O select do Prisma traz `departamento`/`cargo` aninhados; `FuncionarioLeitura`
  // quer os nomes achatados. O mapeamento fica aqui para a forma do tipo não
  // vazar para o resto do motor.
  const leituraFuncionarios: FuncionarioLeitura[] = (funcionarios as Array<any>).map((f) => ({
    id: f.id,
    nome: f.nome,
    status: f.status,
    departamentoId: f.departamentoId ?? null,
    setor: f.departamento?.nome ?? 'Sem departamento',
    cargo: f.cargo?.nome ?? null,
    usuarioId: f.usuarioId ?? null,
    horarioEntradaPrevisto: f.horarioEntradaPrevisto ?? null,
    horarioSaidaPrevisto: f.horarioSaidaPrevisto ?? null,
    jornada: f.jornada ?? null,
    cargaHoraria: f.cargaHoraria ?? null,
  }));

  const empresa = await prisma.empresa.findFirst({ where: { id: empresaId }, select: { fusoHorario: true } });
  const fuso = normalizarFuso(empresa?.fusoHorario);

  const nomeSetorPorId = new Map<string, string>();
  for (const f of (funcionarios as Array<any>)) {
    if (f.departamentoId && f.departamento?.nome) {
      nomeSetorPorId.set(f.departamentoId, f.departamento.nome);
    }
  }

  return montarColeta({ empresaId, janela, inicio, fuso, nomeSetorPorId, funcionarios: leituraFuncionarios, pontos, advertencias, suspensoes, desligamentos, vendas, metas, estoques, clientes, avaliacoes, pesquisas, gamificacao, acoes, planosDesenvolvimento });
}


/** Isolado para manter `coletarRadar` legível: é agrega, não consulta. */
function montarColeta(c: {
  empresaId: string; janela: Janela; inicio: Date; fuso: string;
  nomeSetorPorId: Map<string, string>;
  funcionarios: FuncionarioLeitura[]; pontos: PontoLeitura[];
  advertencias: any[]; suspensoes: any[]; desligamentos: any[];
  vendas: Array<{ funcionarioId: string | null; total: unknown }>;
  metas: any[]; estoques: any[]; clientes: any[]; avaliacoes: any[]; pesquisas: any[];
  gamificacao: any[]; acoes: any[];
  /** Ciclo 1 — planos de desenvolvimento ativos, mais recentes primeiro. */
  planosDesenvolvimento: any[];
}): Coleta {
  const { empresaId, janela, inicio, funcionarios, pontos, advertencias, suspensoes, desligamentos, vendas, metas, estoques, clientes, avaliacoes, pesquisas, gamificacao, acoes, planosDesenvolvimento } = c;

  // Vendas agregadas por usuário — é assim que o PDV chega ao funcionário.
  const vendasPorUsuario = new Map<string, { qtd: number; total: number }>();
  for (const v of vendas) {
    if (!v.funcionarioId) continue;
    const atual = vendasPorUsuario.get(v.funcionarioId) ?? { qtd: 0, total: 0 };
    atual.qtd += 1;
    atual.total += num(v.total);
    vendasPorUsuario.set(v.funcionarioId, atual);
  }

  // DISC: é a avaliação vigente mais recente de cada pessoa.
  const avaliacoesDisc = new Map<string, { id: string; perfil: string | null; scores: Record<string, number> | null; dataAvaliacao: Date; observacoes: string | null }>();
  for (const a of avaliacoes as Array<{ id: string; funcionarioId: string; perfil: string | null; scores: unknown; dataAvaliacao: Date; observacoes: string | null }>) {
    if (avaliacoesDisc.has(a.funcionarioId)) continue;
    avaliacoesDisc.set(a.funcionarioId, {
      // `id` da avaliação vigente: o Plano de Desenvolvimento se ancora nela.
      id: a.id,
      perfil: a.perfil,
      scores: (a.scores as Record<string, number> | null) ?? null,
      dataAvaliacao: a.dataAvaliacao,
      observacoes: a.observacoes,
    });
  }

  // Bem-estar: última pesquisa de cada pessoa.
  const bemEstar = new Map<string, { nota: number; dataPesquisa: Date; resposta: string | null }>();
  for (const p of pesquisas as Array<{ funcionarioId: string; nota: number; dataPesquisa: Date; resposta: string | null }>) {
    if (bemEstar.has(p.funcionarioId)) continue;
    bemEstar.set(p.funcionarioId, { nota: p.nota, dataPesquisa: p.dataPesquisa, resposta: p.resposta });
  }

  /**
   * Linhas de estoque que estão DE FATO abaixo do mínimo configurado.
   *
   * Três decisões, todas com regra clara e dado real — nenhuma delas é uma
   * preferência de exibição:
   *
   *  1. `estoqueMinimo = 0` NÃO é ruptura. Zero significa "sem mínimo
   *     configurado", não "precisa chegar a zero". Com o operador antigo
   *     (`quantidade <= minimo`), um produto com mínimo 0 e saldo 0 era
   *     contado como ruptura: contava um estoque que está exatamente onde
   *     alguém pediu que ficasse.
   *
   *  2. O teste é `<`, não `<=`. Estar exatamente no mínimo configured não é
   *     estar abaixo dele.
   *
   *  3. Só há o que comparar quando o mínimo é maior que zero — logo, o
   *     `<` já é suficiente depois do filtro do passo 1.
   */
  const rupturas: Coleta['rupturas'] = (estoques as Array<{ quantidade: number; produto: { nome: string; estoqueMinimo: number }; filial: { nome: string } }>)
    .map((e) => ({
      produto: e.produto.nome,
      filial: e.filial.nome,
      quantidade: num(e.quantidade),
      minimo: num(e.produto.estoqueMinimo),
    }))
    .filter((e) => e.minimo > 0 && e.quantidade < e.minimo);

  const clientesInativos = (clientes as Array<{ nome: string; valorTotalComprado: unknown; ultimaCompra: Date | null }>)
    .filter((c) => c.ultimaCompra && c.ultimaCompra.getTime() < inicio.getTime())
    .map((c) => ({
      nome: c.nome,
      diasSemComprar: Math.floor((inicio.getTime() - c.ultimaCompra!.getTime()) / 86400000),
      valorTotal: num(c.valorTotalComprado),
    }))
    .sort((a, b) => b.diasSemComprar - a.diasSemComprar)
    .slice(0, 20);

  return {
    empresaId, janela, fuso: c.fuso, nomeSetorPorId: c.nomeSetorPorId,
    funcionarios, pontos, advertencias, suspensoes, desligamentos, vendasPorUsuario,
    metas: (metas as any[]).map((m) => ({
      id: m.id, tipo: m.tipo, periodo: m.periodo, setorId: m.setorId, funcionarioId: m.funcionarioId,
      metaValor: num(m.metaValor), realizado: num(m.realizado), percentual: num(m.percentual), status: m.status,
    })),
    rupturas, clientesInativos, avaliacoesDisc, bemEstar,
    registrosGamificacao: gamificacao,
    acoesRadar: acoes,
    // Ciclo 1: só o plano mais recente de cada pessoa, na ordem em que foram
    // criados. Um funcionário pode ter vários no histórico; o Radar mostra o
    // que está em curso.
    planosDesenvolvimento: (() => {
      type PlanoColetado = {
        id: string; funcionarioId: string; objetivo: string; competencia: string; status: string;
        prazo: Date | null; dataInicio: Date; responsavelId: string | null; acoes: unknown; perfil: string | null;
      };
      const mapa = new Map<string, PlanoColetado>();
      for (const p of planosDesenvolvimento as unknown as PlanoColetado[]) {
        if (mapa.has(p.funcionarioId)) continue;
        mapa.set(p.funcionarioId, p);
      }
      return mapa;
    })(),
  };
}


// ═════════════════════════════════════════════════════════════════════
// Regras
// ═════════════════════════════════════════════════════════════════════
//
// LIMIARES - todos declarados aqui, nenhum espalhado pelo código. Mudou a
// política de RH, muda uma constante e pronto; dá para auditar por que um
// sinal disparou. Os valores são de política, não de estatística: um modelo
// estatístico exigiria histórico que a empresa ainda não tem.

export const LIMITES = {
  /** Atrasos que caracterizam recorrência (não um episode). */
  atrasosRecorrentes: 3,
  /** Faltas no período acima disso são sinal de absenteísmo. */
  faltasAbsenteismo: 3,
  /** Minutos de hora extra por dia útil para considerar excessiva. */
  extrasMinPorDia: 30,
  /** Saídas após o previsto, em % dos dias com batida, para indicar excesso. */
  excessoJornadaPct: 30,
  /** Produtividade: queda de X% entre a primeira e a segunda metade do período. */
  quedaProdutividadePct: 15,
  /** Meta abaixo disso é sinal de risco de resultado. */
  metaCriticaPct: 70,
  /** Dias sem comprar para o cliente entrar na lista de inativos. */
  clienteInativoDias: 90,
} as const;

/** Índice por funcionário, para as regras não reprocessarem a lista inteira. */
export function indexarPontos(pontos: PontoLeitura[]): Map<string, PontoLeitura[]> {
  const mapa = new Map<string, PontoLeitura[]>();
  for (const p of pontos) {
    const l = mapa.get(p.funcionarioId);
    if (l) l.push(p);
    else mapa.set(p.funcionarioId, [p]);
  }
  return mapa;
}

export type ResumoPessoa = {
  funcionarioId: string;
  nome: string;
  setor: string;
  diasRegistrados: number;
  faltas: number;
  atrasos: number;
  minAtraso: number;
  horasMin: number;
  horasExtrasMin: number;
  saidasAntecipadas: number;
  inconsistencias: number;
  /** Dias em que saiu DEPOIS do horário previsto de saída. */
  diasAposPrevisto: number;
  /** Minutos por dia além do previsto, em média. */
  minutosExcedentesMedia: number;
  /** % de dias úteis com falta. */
  absenteismoPct: number;
  /** Minutos de hora extra por dia útil. */
  extrasMediaDiaMin: number;
  vendasQtd: number;
  vendasTotal: number;
  advertencias: number;
  suspensoes: number;
};

export function resumirPessoa(
  func: FuncionarioLeitura,
  pontos: PontoLeitura[],
  vendas: { qtd: number; total: number } | undefined,
  advertencias: number,
  suspensoes: number,
  diasUteis: number,
  fuso: string,
): ResumoPessoa {
  const previstos = func.horarioSaidaPrevisto ? minutosDeHHMM(func.horarioSaidaPrevisto) : null;
  let horasMin = 0;
  let horasExtrasMin = 0;
  let faltas = 0;
  let atrasos = 0;
  let minAtraso = 0;
  let saidasAntecipadas = 0;
  let inconsistencias = 0;
  let diasAposPrevisto = 0;
  let somaExcedenteMin = 0;
  let diasComBatida = 0;

  for (const p of pontos) {
    if (p.falta) { faltas++; continue; }
    if (p.inconsistencia) inconsistencias++;
    if (p.atrasoMinutos > 0) { atrasos++; minAtraso += p.atrasoMinutos; }
    if (p.saidaAntecipada) saidasAntecipadas++;
    horasExtrasMin += p.horaExtraMinutos;
    horasMin += minutosTrabalhados(p.entrada, p.saida, p.saidaIntervalo, p.retornoIntervalo);

    if (p.entrada && p.saida) {
      diasComBatida++;
      // O horário de saída ? lido no fuso DA EMPRESA. Usar `getHours()`
      // mediria no fuso da MÁQUINA: em deploy em UTC, a saída das 17:45 de
      // São Paulo leria 20:45 (ou 17:45 num servidor em UTC-3 acidental) e a
      // comparação com o previsto sairia errada. é o bug que `lib/fuso.ts`
      // já documenta para o `/rh/indicadores`; a regra é a mesma.
      if (previstos !== null) {
        const saiuEmMin = minutosNoFuso(p.saida, fuso);
        if (saiuEmMin > previstos) {
          diasAposPrevisto++;
          somaExcedenteMin += saiuEmMin - previstos;
        }
      }
    }
  }

  return {
    funcionarioId: func.id,
    nome: func.nome,
    setor: func.setor,
    diasRegistrados: pontos.length,
    faltas, atrasos, minAtraso, horasMin, horasExtrasMin, saidasAntecipadas, inconsistencias,
    diasAposPrevisto,
    minutosExcedentesMedia: diasAposPrevisto > 0 ? Math.round(somaExcedenteMin / diasAposPrevisto) : 0,
    absenteismoPct: arred(pct(faltas, Math.max(1, diasUteis))),
    extrasMediaDiaMin: arred(horasExtrasMin / Math.max(1, diasUteis)),
    vendasQtd: vendas?.qtd ?? 0,
    vendasTotal: arred(vendas?.total ?? 0, 2),
    advertencias, suspensoes,
  };
}


/**
 * Gera os sinais do Radar a partir dos resumos e da coleta.
 *
 * REGRA DE OURO DESTA FUNÇÃO: cada sinal é um FATO OBSERVÁVEL com a evidência
 * que o produziu. Nada aqui diz que alguém está com burnout, doente ou
 * incapaz — o módulo não tem essa competência e o prompt proíbe. Quando há
 * sinal de sobrecarga, a linguagem é "sinais de sobrecarga identificados —
 * recomenda-se análise do gestor/RH".
 *
 * `suprimidos` é o conjunto de refs que NÃO devem reaparecer — no caso da rota,
 * os planos que o gestor cancelou. Plano em aberto ou concluído continua
 * aparecendo, com o status correspondente, para o gestor ver o histórico.
 */
export function gerarSinais(
  resumos: ResumoPessoa[],
  janela: Janela,
  suprimidos: Set<string>,
  porId: Map<string, FuncionarioLeitura>,
): EvidenciaAlerta[] {
  const alertas: EvidenciaAlerta[] = [];
  const { diasUteis } = janela;

  const add = (a: EvidenciaAlerta) => {
    if (!suprimidos.has(a.ref)) alertas.push(a);
  };

  // ── Atrasos recorrentes (pessoa) ──────────────────────────────────────
  for (const r of resumos) {
    if (r.atrasos < LIMITES.atrasosRecorrentes) continue;
    add({
      id: `atrasos-${r.funcionarioId}`,
      ref: `atrasos:${r.funcionarioId}`,
      titulo: `${r.nome} apresentou ${r.atrasos} atrasos em ${diasUteis} dias úteis`,
      area: r.setor,
      tipo: 'Clima',
      criticidade: r.atrasos >= LIMITES.atrasosRecorrentes * 2 ? 'Alta' : 'Média',
      fato: `${r.atrasos} registro(s) de entrada com atraso no período.`,
      impacto: `Tempo de atraso somado: ${r.minAtraso} min (média ${Math.round(r.minAtraso / r.atrasos)} min por atraso).`,
      evidencias: [
        `Atrasos: ${r.atrasos} em ${r.diasRegistrados} dias com registro`,
        `Atraso total: ${r.minAtraso} minutos`,
        `Setor: ${r.setor}`,
      ],
      sugestao: 'Verificar se o horário previsto de entrada está correto para esta pessoa e conversar sobre o ponto.',
      prazoDias: r.atrasos >= LIMITES.atrasosRecorrentes * 2 ? 7 : 15,
      origem: 'ponto',
      funcionarioId: r.funcionarioId,
    });
  }

  // ── Falta / absenteísmo ───────────────────────────────────────────────
  for (const r of resumos) {
    if (r.faltas < LIMITES.faltasAbsenteismo) continue;
    const aus = arred(pct(r.faltas, Math.max(1, diasUteis)));
    add({
      id: `faltas-${r.funcionarioId}`,
      ref: `faltas:${r.funcionarioId}`,
      titulo: `${r.nome} registrou ${r.faltas} falta(s) no período (${aus}% dos dias úteis)`,
      area: r.setor,
      tipo: 'Burnout',
      criticidade: aus >= 20 ? 'Alta' : 'Média',
      fato: `${r.faltas} falta(s) lançada(s) em ${diasUteis} dias úteis.`,
      impacto: `Equivale a ${arred(r.faltas * 8)}h de jornada não registrada.`,
      evidencias: [
        `Faltas: ${r.faltas} de ${diasUteis} dias úteis`,
        `Setor: ${r.setor}`,
        `Registros de ponto com inconsistência: ${r.inconsistencias}`,
      ],
      sugestao: 'Conferir atestados e o motivo das faltas antes de qualquer leitura sobre a pessoa.',
      prazoDias: aus >= 20 ? 7 : 15,
      origem: 'ponto',
      funcionarioId: r.funcionarioId,
    });
  }


  // ── Excesso de jornada (Ponto x Jornada Prevista) ─────────────────────
  // O exemplo do João: quantos dias a pessoa saiu depois do horário que o
  // próprio cadastro previsto, e por quanto tempo.
  for (const r of resumos) {
    const comBatida = r.diasRegistrados - r.faltas;
    if (comBatida <= 0) continue;
    const func = porId.get(r.funcionarioId);
    const previstosOk = func ? minutosDeHHMM(func.horarioSaidaPrevisto) !== null : false;
    const excedentePct = pct(r.diasAposPrevisto, comBatida);
    const extrasPorDia = r.horasExtrasMin / Math.max(1, diasUteis);
    // Sem horário previsto cadastrado não d? para medir "excesso de jornada":
    // a? a regra s? pode olhar hora extra, e diz isso.
    const excessoJornada = previstosOk && excedentePct >= LIMITES.excessoJornadaPct;
    const excessoHora = extrasPorDia >= LIMITES.extrasMinPorDia;
    if (!excessoJornada && !excessoHora) continue;

    add({
      id: `jornada-${r.funcionarioId}`,
      ref: `jornada:${r.funcionarioId}`,
      // O título diz o que REALMENTE disparou. Um alerta que afirma "acima do
      // horário previsto" com a evidência mostrando 0% ? pior que não ter
      // alerta: o gestor vai procurar um excesso de jornada que não existe.
      titulo: !previstosOk
        ? `${r.nome} acumula hora extra acima do planejado (sem horário previsto cadastrado para comparar)`
        : excessoJornada && excessoHora
          ? `${r.nome} apresenta jornada e hora extra recorrentes acima do previsto`
          : excessoJornada
            ? `${r.nome} apresenta jornada recorrente acima do horário previsto`
            : `${r.nome} acumula hora extra acima do planejado`,
      area: r.setor,
      tipo: 'Burnout',
      criticidade: excessoJornada && excessoHora ? 'Alta' : 'Média',
      fato: [
        previstosOk && excessoJornada ? `${r.diasAposPrevisto} de ${comBatida} dias com saída após o horário previsto` : null,
        excessoHora ? `${arred(extrasPorDia)} min/dia de hora extra` : null,
      ].filter(Boolean).join(' —') + '.',
      impacto: `Sinal de sobrecarga identificado - recomenda-se análise do gestor/RH. Hora extra acumulada: ${arred(r.horasExtrasMin / 60)}h.`,
      evidencias: [
        previstosOk
          ? `Dias além do previsto: ${r.diasAposPrevisto} de ${comBatida} (${arred(excedentePct)}%)`
          : 'Horário de saída previsto não cadastrado no cadastro do funcionário.',
        `Excedente médio por dia: ${r.minutosExcedentesMedia} min`,
        `Hora extra acumulada: ${arred(r.horasExtrasMin / 60)}h`,
        `Setor: ${r.setor}`,
      ],
      sugestao: previstosOk
        ? 'Validar o dimensionamento da equipe e a carga prevista da função antes de conversar com a pessoa.'
        : 'Cadastrar o horário previsto de entrada e saída no cadastro do funcionário para permitir comparar jornada prevista x realizada.',
      prazoDias: 7,
      origem: 'ponto_x_jornada',
      funcionarioId: r.funcionarioId,
    });
  }

  // ── Carga alta sem resultado (Ponto x Vendas/PDV) ─────────────────────
  // O cruzamento que d? sentido ao sinal: não ? s? "faz muito extras", ?
  // "faz extras e a produção do período não acompanhou".
  for (const r of resumos) {
    if (r.vendasQtd <= 0) continue;
    const extrasPorDia = r.horasExtrasMin / Math.max(1, diasUteis);
    if (extrasPorDia < LIMITES.extrasMinPorDia) continue;
    add({
      id: `extras-vendas-${r.funcionarioId}`,
      ref: `extras_vendas:${r.funcionarioId}`,
      titulo: `${r.nome} acumula hora extra alta com ${r.vendasQtd} venda(s) no período`,
      area: r.setor,
      tipo: 'Burnout',
      criticidade: 'Média',
      fato: `${arred(extrasPorDia)} min/dia de hora extra e ${r.vendasQtd} venda(s) finalizada(s).`,
      impacto: 'Cruzamento entre Ponto (carga) e Vendas (resultado).',
      evidencias: [
        `Hora extra: ${arred(r.horasExtrasMin / 60)}h em ${diasUteis} dias úteis`,
        `Vendas: ${r.vendasQtd} (${brlResumo(r.vendasTotal)})`,
        `Setor: ${r.setor}`,
      ],
      sugestao: 'Conferir se a carga extra está sendo convertida em resultado ou apenas em ausência de folga.',
      prazoDias: 15,
      origem: 'ponto_x_vendas',
      funcionarioId: r.funcionarioId,
    });
  }

  return alertas;
}

export function brlResumo(v: number): string {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


/**
 * Sinais de ?REA e de BUSINESS (não de pessoa).
 *
 * Aqui o cruzamento ? entre módulos de negócio, não de RH:
 *  - Metas: resultado abaixo do crítico ? sinal de risco de resultado;
 *  - Estoque: ruptura ? CAUSA operacional que o gestor precisa ver antes de
 *    atribuir a queda de vendas a time ou a pessoas;
 *  - Clientes: cliente sem comprar ? sinal comercial.
 */
export function gerarSinaisArea(
  resumos: ResumoPessoa[],
  coleta: Coleta,
  janela: Janela,
  acionados: Set<string>,
  nomeDoSetor?: (setorId: string) => string | null,
): EvidenciaAlerta[] {
  const alertas: EvidenciaAlerta[] = [];
  const { inicio, diasUteis } = janela;
  const add = (a: EvidenciaAlerta) => {
    if (!acionados.has(a.ref)) alertas.push(a);
  };

  // ── Metas de resultado abaixo do crítico ──────────────────────────────
  for (const m of coleta.metas) {
    if (m.metaValor <= 0) continue;
    const pctReal = pct(m.realizado, m.metaValor);
    if (pctReal >= LIMITES.metaCriticaPct) continue;
    const escopo = m.funcionarioId
      ? coleta.funcionarios.find((f) => f.id === m.funcionarioId)?.nome ?? 'funcionário'
      : m.setorId
        ? (nomeDoSetor?.(m.setorId) ?? 'setor')
        : 'empresa';
    add({
      id: `meta-${m.id}`,
      ref: `meta:${m.id}`,
      titulo: `Meta ${escopo} em ${arred(pctReal)}% no período ${m.periodo}`,
      area: 'Gestão',
      tipo: 'Gargalo',
      criticidade: pctReal < 50 ? 'Alta' : 'Média',
      fato: `Realizado ${brlResumo(m.realizado)} de meta ${brlResumo(m.metaValor)} (${arred(pctReal)}%).`,
      impacto: `Diferença de ${brlResumo(m.metaValor - m.realizado)}; status da meta: ${m.status}.`,
      evidencias: [
        `Meta ${m.id} . tipo ${m.tipo} . período ${m.periodo}`,
        `Realizado: ${brlResumo(m.realizado)}`,
        `Meta: ${brlResumo(m.metaValor)}`,
      ],
      sugestao: 'Revisar o que explica o gap: capacidade, processo, dependência externa ou meta mal ajustada.',
      prazoDias: pctReal < 50 ? 7 : 15,
      origem: 'metas',
      funcionarioId: m.funcionarioId ?? null,
    });
  }

  // ── Ruptura de estoque ────────────────────────────────────────────────
  if (coleta.rupturas.length > 0) {
    const amostra = coleta.rupturas.slice(0, 8);
    // O título precisa dizer O QUE está sendo contado. A contagem é de
    // combinações filial×produto, e o título antigo dizia "produto(s)": um
    // produto distribuído em três filiais contava três vezes enquanto a tela
    // prometia uma contagem de produtos. Agora o número do título é sempre o de
    // produtos DISTINTOS (que é o que o gestor lê), e a diferença para as
    // combinações fica explícita na linha de baixo.
    const produtosDistintos = new Set(coleta.rupturas.map((r) => r.produto)).size;
    const combinacoes = coleta.rupturas.length;
    const rotuloQuantidade = produtosDistintos === combinacoes
      ? `${produtosDistintos} produto(s)`
      : `${produtosDistintos} produto(s) em ${combinacoes} combinação(ões) filial × produto`;
    add({
      id: 'ruptura-estoque',
      ref: 'ruptura:estoque',
      titulo: `${rotuloQuantidade} abaixo do estoque mínimo`,
      area: 'Operação',
      tipo: 'Gargalo',
      criticidade: produtosDistintos > 10 ? 'Alta' : 'Média',
      fato:
        produtosDistintos === combinacoes
          ? `Saldo menor que o mínimo configurado em ${combinacoes} produto(s).`
          : `Saldo menor que o mínimo configurado em ${combinacoes} combinação(ões) filial × produto, `
            + `cobrindo ${produtosDistintos} produto(s) distinto(s).`,
      impacto: 'Ruptura ou risco de ruptura: pode explicar queda de venda sem relação com desempenho de pessoas.',
      evidencias: amostra.map((r) => `${r.produto} - ${r.filial}: ${r.quantidade} (mínimo ${r.minimo})`),
      sugestao: 'Avaliar reposição antes de investigar a origem comercial da queda.',
      prazoDias: 7,
      origem: 'estoque',
    });
  }


  // ── Cliente sem comprar no período ────────────────────────────────────
  const inativos = coleta.clientesInativos.filter((c) => c.diasSemComprar >= LIMITES.clienteInativoDias);
  if (inativos.length > 0) {
    const valor = inativos.reduce((s, c) => s + c.valorTotal, 0);
    add({
      id: 'clientes-inativos',
      ref: 'clientes:inativos',
      titulo: `${inativos.length} cliente(s) ativo(s) sem compra h? mais de ${LIMITES.clienteInativoDias} dias`,
      area: 'Comercial',
      tipo: 'Cliente',
      criticidade: 'Média',
      fato: `${inativos.length} cliente(s) com cadastro ativo e ?ltima compra anterior a ${chaveDia(inicio)}.`,
      impacto: `Histórico de compras desses clientes: ${brlResumo(valor)}.`,
      evidencias: inativos
        .slice(0, 8)
        .map((c) => `${c.nome} - ${c.diasSemComprar} dias sem comprar (${brlResumo(c.valorTotal)} histórico)`),
      sugestao: 'Confirmar se a ausência é sazonalidade, perda de cliente ou mudança de processo comercial.',
      prazoDias: 30,
      origem: 'clientes',
    });
  }

  // ── Carga concentrada em um setor ─────────────────────────────────────
  // Hora extra desigual entre setores ? sintoma de dimensionamento, não de
  // atitude de uma pessoa ou de um gestor - da? a regra ser do setor inteiro
  // e nunca tratar cada pessoa isoladamente.
  const porSetor = new Map<string, { extrasMin: number; extrasPorDia: number; tamanho: number; faltas: number }>();
  for (const r of resumos) {
    const a = porSetor.get(r.setor) ?? { extrasMin: 0, extrasPorDia: 0, tamanho: 0, faltas: 0 };
    a.extrasMin += r.horasExtrasMin;
    a.extrasPorDia += r.horasExtrasMin / Math.max(1, diasUteis);
    a.tamanho += 1;
    a.faltas += r.faltas;
    porSetor.set(r.setor, a);
  }

  for (const [setor, a] of porSetor) {
    if (a.tamanho === 0) continue;
    const mediaDiaria = a.extrasPorDia / a.tamanho;
    if (mediaDiaria < LIMITES.extrasMinPorDia) continue;
    add({
      id: `setor-extras-${setor}`,
      ref: `setor_extras:${setor}`,
      titulo: `Setor ${setor} registra hora extra acima do planejado`,
      area: setor,
      tipo: 'Gargalo',
      criticidade: mediaDiaria >= LIMITES.extrasMinPorDia * 2 ? 'Alta' : 'Média',
      fato: `${arred(mediaDiaria)} min/dia de hora extra por pessoa, em média, no setor ${setor}.`,
      impacto: `${arred(a.extrasMin / 60)}h acumuladas no setor e ${a.faltas} falta(s) no mesmo período.`,
      evidencias: [
        `Setor: ${setor} (${a.tamanho} pessoa(s))`,
        `Hora extra média por pessoa/dia: ${arred(mediaDiaria)} min`,
        `Hora extra total: ${arred(a.extrasMin / 60)}h`,
        `Faltas do setor: ${a.faltas}`,
      ],
      sugestao: 'Verificar dimensionamento e sazonalidade do setor antes de tratar como caso individual.',
      prazoDias: 15,
      origem: 'ponto_x_area',
    });
  }

  return alertas;
}

