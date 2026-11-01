/**
 * Read model do Radar: transforma a COLETA (fatos crus dos módulos) no DTO que
 * a tela consome.
 *
 * POR QUE UM ARQUIVO ASSIM PARA ISTO
 * -------------------------------
 * A rota HTTP deve ser fina: validar, autorizar, chamar o read model, responder.
 * O read model é onde vive a forma do dado — e é ele que o simulador e a IA
 * consomem, garantindo que os três mostrem EXATAMENTE os mesmos números. Se a
 * forma estivesse na rota, a IA e o simulador recalculariam por conta própria
 * e divergiriam da tela. Foi exatamente isso que aconteceu antes.
 *
 * REGRA INEGOCIÁVEL
 * -----------------
 * Ausência de dado vira `null` + entrada em `faltando`. Nunca `0`, nunca um
 * número plausível. "0% de absenteísmo" e "não há dados" são afirmações
 * diferentes, e só a segunda é verdadeira quando o banco está vazio.
 */

import { prisma } from '../../lib/prisma.js';
// `progresso` mora no módulo de plano de desenvolvimento (Ciclo 1) e é
// importado aqui para que o Radar e a tela de plano contem a mesma conta.
// Duplicar a fórmula faria os dois mostrarem números diferentes.
import { progresso as progressoAcoes } from '../rh/plano-desenvolvimento.js';
import {
  coletarRadar, indexarPontos, resumirPessoa,
  chaveDia, chaveDiaSql, semanasRecentes, num, brlResumo, LIMITES,
  type Coleta, type ResumoPessoa, type EvidenciaAlerta, type Janela,
} from './radar.regras.js';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const pct = (p: number, t: number) => (t > 0 ? (p / t) * 100 : 0);
const arred = (n: number, c = 1) => Math.round(n * 10 ** c) / 10 ** c;

/** Pesos do risco. Declarados e documentados: são de política, não estatística. */
const PESO = { absenteismo: 0.45, horasExtras: 0.35, disciplina: 0.2, resultado: 0.25 } as const;

function contar<T>(itens: T[], chave: (item: T) => string): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const item of itens) {
    const k = chave(item);
    mapa.set(k, (mapa.get(k) ?? 0) + 1);
  }
  return mapa;
}

/** Risco individual — mesma escala da área, aplicada à pessoa. */
export function riscoDePessoa(r: ResumoPessoa, diasUteis: number): number {
  const abs = pct(r.faltas, Math.max(1, diasUteis));
  const extras = pct(r.horasExtrasMin, Math.max(1, diasUteis) * LIMITES.extrasMinPorDia);
  const disc = pct(r.advertencias + r.suspensoes, 2);
  return Math.round(
    clamp(
      PESO.absenteismo * clamp((abs / 20) * 100, 0, 100) +
      PESO.horasExtras * clamp((extras / 30) * 100, 0, 100) +
      PESO.disciplina * clamp((disc / 50) * 100, 0, 100),
      0, 100,
    ),
  );
}

/** As três parcelas do risco, para a tela poder explicar o número. */
export function componentesDe(r: ResumoPessoa, diasUteis: number) {
  const abs = pct(r.faltas, Math.max(1, diasUteis));
  const extras = pct(r.horasExtrasMin, Math.max(1, diasUteis) * LIMITES.extrasMinPorDia);
  const disc = pct(r.advertencias + r.suspensoes, 2);
  return {
    absenteismo: arred(PESO.absenteismo * clamp((abs / 20) * 100, 0, 100)),
    horasExtras: arred(PESO.horasExtras * clamp((extras / 30) * 100, 0, 100)),
    disciplina: arred(PESO.disciplina * clamp((disc / 50) * 100, 0, 100)),
  };
}

export type ResumoRadar = Awaited<ReturnType<typeof montarResumo>>;

/** Estado consolidado que a rota, o simulador e a IA compartilham. */
export async function montarResumo(empresaId: string, janela: Janela) {
  const coleta = await coletarRadar(empresaId, janela);
  const { diasUteis } = janela;  // ═════════════════════════════════════════════════════════════════════
  const porPessoa = indexarPontos(coleta.pontos);
  const advPorFunc = contar(coleta.advertencias, (a) => a.funcionarioId);
  const susPorFunc = contar(coleta.suspensoes, (s) => s.funcionarioId);

  const resumos: ResumoPessoa[] = coleta.funcionarios.map((f) =>
    resumirPessoa(
      f,
      porPessoa.get(f.id) ?? [],
      f.usuarioId ? coleta.vendasPorUsuario.get(f.usuarioId) : undefined,
      advPorFunc.get(f.id) ?? 0,
      susPorFunc.get(f.id) ?? 0,
      diasUteis,
      coleta.fuso,
    ),
  );
  const resumoPorId = new Map(resumos.map((r) => [r.funcionarioId, r]));  // ═════════════════════════════════════════════════════════════════════
  const extrasMin = coleta.pontos.reduce((s, p) => s + p.horaExtraMinutos, 0);
  const faltas = coleta.pontos.filter((p) => p.falta).length;
  const atrasos = coleta.pontos.filter((p) => p.atrasoMinutos > 0).length;
  const saidasAntecipadas = coleta.pontos.filter((p) => p.saidaAntecipada).length;
  const inconsistencias = coleta.pontos.filter((p) => Boolean(p.inconsistencia)).length;
  const headcount = coleta.funcionarios.length;

  // Sem denominador não há absenteísmo: null, não zero.
  const denAusencia = headcount * diasUteis;
  const absenteismo = denAusencia > 0 ? arred(pct(faltas, denAusencia)) : null;

  // Produtividade só existe com Meta de PRODUTIVIDADE no mês do período.
  //
  // O mês vem do FIM da janela, não do início. A janela padrão são 30 dias, e
  // em qualquer dia entre o dia 1 e o dia 30 do mês ela começa no mês ANTERIOR:
  // em 28/09 a janela vai de 30/08 a 28/09, e usar `inicio` pegaria "2026-08" —
  // mês em que a meta vigente quase nunca está. A meta do mês corrente é a que
  // o gestor está cumprindo agora, então é a que o KPI tem que refletir.
  const fimMes = janela.fim;
  const mesPeriodo = `${fimMes.getFullYear()}-${String(fimMes.getMonth() + 1).padStart(2, '0')}`;
  const metasPeriodo = coleta.metas.filter((m) => m.periodo === mesPeriodo && m.metaValor > 0);
  const metasProd = metasPeriodo.filter((m) => m.tipo === 'PRODUTIVIDADE');
  const produtividade = metasProd.length > 0
    ? arred(clamp(metasProd.reduce((s, m) => s + pct(m.realizado, m.metaValor), 0) / metasProd.length, 0, 999))
    : null;

  // Desempenho comercial real do período (PDV → usuário → funcionário).
  const vendasTotal = arred([...coleta.vendasPorUsuario.values()].reduce((s, v) => s + v.total, 0), 2);
  const vendasQtd = [...coleta.vendasPorUsuario.values()].reduce((s, v) => s + v.qtd, 0);

  const quadroInicio = headcount + coleta.desligamentos.length;
  const turnover = quadroInicio > 0 ? arred(pct(coleta.desligamentos.length, quadroInicio)) : null;  // ═════════════════════════════════════════════════════════════════════
  // ── 3. Áreas de risco ───────────────────────────────────────────────────
  //
  // REGRA DE AGREGAÇÃO: MÉDIA, nunca soma.
  //
  // `componentesDe` já devolve parcelas 0..100 JÁ PONDERADAS para a pessoa (uma
  // pessoa com 30% de horas extras satura a parcela em ~35). Somar essas
  // parcelas por setor fazia o risco crescer com o tamanho do time: 3 pessoas com
  // risco moderado davam o mesmo número que 1 pessoa em risco alto, e um setor
  // de 10 pessoas saturava em 100 sem ninguém perto do limiar. O `clamp`
  // mascarava isso, e o indicador media o QUADRO, não o trabalho.
  //
  // A área é a média das pessoas do setor: contratar mais gente não muda o
  // número. O tamanho vai em `tamanho`, para a tela poder dizer "risco X em N
  // pessoas" em vez de esconder a informação.
  const porSetor = new Map<string, { tamanho: number; extrasMin: number; faltas: number; disciplina: number; extrasPorDia: number }>();
  for (const r of resumos) {
    const a = porSetor.get(r.setor) ?? { tamanho: 0, extrasMin: 0, faltas: 0, disciplina: 0, extrasPorDia: 0 };
    a.tamanho += 1;
    a.extrasMin += r.horasExtrasMin;
    a.extrasPorDia += r.horasExtrasMin / Math.max(1, diasUteis);
    a.faltas += r.faltas;
    a.disciplina += r.advertencias + r.suspensoes;
    porSetor.set(r.setor, a);
  }

  /**
   * Parcela de RESULTADO por setor (0..100): quão longe a operação está do
   * combinado. Meta abaixo do crítico e ruptura de estoque são fatos da
   * EMPRESA, não da pessoa — por isso NÃO entram no risco individual: entram
   * na Gargalo, que é o indicador construído sobre resultado.
   *
   * Considera as metas do MÊS da janela (o mesmo `mesPeriodo` do KPI), e não
   * todas: uma meta de março não descreve o que a empresa entregou em setembro.
   */
  const resultadoPorSetor = new Map<string, number>();
  for (const m of coleta.metas) {
    if (m.metaValor <= 0 || !m.setorId) continue;
    if (m.periodo !== mesPeriodo) continue;
    const critico = LIMITES.metaCriticaPct;
    if (m.percentual >= critico) continue;
    const nome = (coleta.funcionarios.find((f) => f.id === m.funcionarioId))?.setor
      ?? coleta.nomeSetorPorId.get(m.setorId)
      ?? null;
    if (!nome) continue;
    const falta = clamp(((critico - m.percentual) / Math.max(1, critico)) * 100, 0, 100);
    resultadoPorSetor.set(nome, (resultadoPorSetor.get(nome) ?? 0) + falta);
  }

  const areasRisco = [...porSetor.entries()]
    .map(([area, a]) => {
      const doSetor = resumos.filter((r) => r.setor === area);
      // Média das parcelas, não soma — ver a nota da regra acima.
      const soma = doSetor
        .map((r) => componentesDe(r, diasUteis))
        .reduce(
          (acc, c) => ({ absenteismo: acc.absenteismo + c.absenteismo, horasExtras: acc.horasExtras + c.horasExtras, disciplina: acc.disciplina + c.disciplina }),
          { absenteismo: 0, horasExtras: 0, disciplina: 0 },
        );
      const n = Math.max(1, doSetor.length);
      const componentes = {
        absenteismo: arred(soma.absenteismo / n),
        horasExtras: arred(soma.horasExtras / n),
        disciplina: arred(soma.disciplina / n),
        resultado: arred(resultadoPorSetor.get(area) ?? 0),
      };
      const risco = Math.round(clamp(
        componentes.absenteismo + componentes.horasExtras + componentes.disciplina,
        0, 100,
      ));
      return {
        area,
        risco,
        tamanho: a.tamanho,
        componentes,
        pessoas: doSetor
          .slice()
          .sort((x, y) => riscoDePessoa(y, diasUteis) - riscoDePessoa(x, diasUteis))
          .slice(0, 3)
          .map((p) => p.nome),
      };
    })
    .sort((a, b) => b.risco - a.risco);

  /**
   * Gargalo por área = risco de sobrecarga (fatos de PESSOAS) misturado com a
   * parcela de RESULTADO (fatos da OPERAÇÃO). Sem meta e sem ruptura no período,
   * `componentes.resultado` é 0 e o gargalo é o próprio risco — o mesmo
   * indicador, sem parcela inventada.
   */
  const gargalos = areasRisco.map((a) => ({
    area: a.area,
    gargalo: Math.round(clamp(
      a.risco * (1 - PESO.resultado) + a.componentes.resultado * PESO.resultado,
      0, 100,
    )),
    risco: a.risco,
    tamanho: a.tamanho,
  }));

  return {
    coleta, janela, resumos, resumoPorId, areasRisco, gargalos, porSetor, headcount, diasUteis, mesPeriodo,
    /** Metas do mês corrente — o que o simulador usa para medir atingimento. */
    metasPeriodo,
    kpis: {
      extras: arred(extrasMin / 60),
      absenteismo, produtividade, enps: null as number | null, turnover,
      /**
       * Contagens que o SIMULADOR usa para saber se existe base real antes de
       * prometer efeito. `comercialVendas = 0` significa "nenhuma venda no
       * período": aí o reforço comercial não tem contra o que ser comparado e o
       * simulador devolve zero em vez de um ganho inventado.
       */
      comercialVendas: vendasQtd,
      metaCount: metasPeriodo.length,
      rupturaCount: coleta.rupturas.length,
    },
    sinais: { faltas, atrasos, saidasAntecipadas, inconsistencias },
    comercial: { vendasQtd, vendasTotal },
  };
}

export { chaveDia, chaveDiaSql, semanasRecentes, num, brlResumo };
export type { Coleta, ResumoPessoa, EvidenciaAlerta, Janela };


/**
 * Nível OBSERVADO agora — a referência real do Simulador What-If.
 *
 * Fica aqui, e não dentro de `POST /radar/simulacao`, por um motivo concreto:
 * a tela precisa mostrar "cenário atual" enquanto o gestor arrasta os sliders, e
 * esse número tem de ser o MESMO que o servidor vai usar ao aplicar a
 * simulação. Com a fórmula em dois lugares, qualquer ajuste em um delas faria a
 * projeção da tela divergir do resultado do servidor — foi exatamente o que
 * acontecia antes, com a constante `NIVEL_ATUAL = {70, 80, 70}` escrita no
 * navegador: a tela anunciava "cenário atual: saúde 70%" para qualquer empresa,
 * enquanto o servidor partia do absenteísmo real.
 *
 * O gargalo é a MÉDIA das áreas: usar só a pior (`[0]`) faria a projeção
 * depender de uma única área e mudaria conforme o ordenamento.
 */
export function montarNivelSimulacao(resumo: ResumoRadar): {
  saude: number; gargalo: number; burnout: number;
} {
  return {
    saude: Math.round(clamp(100 - (resumo.kpis.absenteismo ?? 0), 0, 100)),
    gargalo: resumo.gargalos.length > 0
      ? Math.round(resumo.gargalos.reduce((s, g) => s + g.gargalo, 0) / resumo.gargalos.length)
      : 0,
    burnout: resumo.areasRisco.length > 0
      ? Math.round(
          resumo.areasRisco.reduce((s, a) => s + a.componentes.horasExtras, 0) / resumo.areasRisco.length,
        )
      : 0,
  };
}

/** Mapa de calor: setores ?- 5 semanas, com % de dias registrados SEM falta.
 * Célula `null` = nenhum ponto naquela semana (sem dado; não é 0%).
 * Os rótulos vêm junto: com dado real é o backend quem define os eixos.
 */
export function montarHeatmap(resumo: ResumoRadar) {
  const { coleta } = resumo;
  const semanas = semanasRecentes(resumo.janela.fim, 5);
  const idsPorSetor = new Map<string, Set<string>>();
  for (const f of coleta.funcionarios) {
    const s = idsPorSetor.get(f.setor) ?? new Set<string>();

    s.add(f.id);
    idsPorSetor.set(f.setor, s);
  }

  const valores = [...idsPorSetor.keys()].map((setor) => {
    const ids = idsPorSetor.get(setor)!;
    return semanas.map(({ inicio }) => {
      const fim = new Date(inicio);
      fim.setDate(fim.getDate() + 7);
      const daSemana = coleta.pontos.filter((p) => {
        const t = p.data.getTime();
        return ids.has(p.funcionarioId) && t >= inicio.getTime() && t < fim.getTime();
      });
      if (daSemana.length === 0) return null;
      return Math.round(pct(daSemana.filter((p) => !p.falta).length, daSemana.length));
    });
  });

  return { setores: [...idsPorSetor.keys()], semanas: semanas.map((s) => s.chave), valores };
}

/**
 * Evolução de 12 semanas. `saude` NÃO é bem-estar (não é medido): é
 * 100 ?^' absenteísmo da semana, e o nome do campo existe para não confundir.
 * `produtividade` fica null: não há medição de produtividade por semana.
 */
export function montarEvolucao(resumo: ResumoRadar) {
  const { coleta, headcount } = resumo;
  return semanasRecentes(resumo.janela.fim, 12).map(({ chave, inicio }) => {
    const fim = new Date(inicio);
    fim.setDate(fim.getDate() + 7);
    const daSemana = coleta.pontos.filter(
      (p) => p.data.getTime() >= inicio.getTime() && p.data.getTime() < fim.getTime(),
    );
    if (daSemana.length === 0) {
      return { semana: chave, saude: null as number | null, produtividade: null as number | null, risco: null as number | null };
    }
    const aus = pct(daSemana.filter((p) => p.falta).length, daSemana.length);
    const extras = daSemana.reduce((s, p) => s + p.horaExtraMinutos, 0);
    return {
      semana: chave,
      saude: Math.round(clamp(100 - aus, 0, 100)),
      produtividade: null as number | null,
      risco: Math.round(
        clamp((aus / 20) * 60 + (pct(extras, Math.max(1, headcount) * 5 * LIMITES.extrasMinPorDia) / 30) * 40, 0, 100),
      ),
    };
  });
}

/** Correlação carga ?- absenteísmo. Produtividade individual não é medida. */
export function montarCorrelacao(resumo: ResumoRadar) {
  return resumo.resumos
    .filter((r) => r.diasRegistrados > 0)
    .map((r) => ({ horas: arred(r.horasMin / 60), absenteismo: r.faltas, equipe: r.setor }))
    .sort((a, b) => a.horas - b.horas);
}


/**
 * Manifesto do que NÃO existe no banco.
 *
 * ── A peçaça que impede o Radar de mentir por omissão: a tela não precisa
 * adivinhar o motivo de um "—", ele vem daqui, nomeado.
 */
export function montarFaltando(resumo: ResumoRadar) {
  const { coleta, kpis, headcount, diasUteis } = resumo;
  const faltando: Array<{ campo: string; motivo: string }> = [];
  const semDisc = 'Nenhuma avaliação comportamental registrada. O Radar não infere perfil: isso é entrada do RH.';
  const semBemEstar = 'Nenhuma pesquisa de bem-estar registrada. O Radar não infere bem-estar a partir de ponto.';
  const semEnps = 'Não existe modelo de pesquisa de clima no NEXUS OS. eNPS depende de uma pesquisa aplicada.';

  if (kpis.enps === null) faltando.push({ campo: 'eNPS', motivo: semEnps });
  if (kpis.produtividade === null) faltando.push({
    campo: 'produtividade',
    motivo: `Nenhuma Meta do tipo PRODUTIVIDADE em ${resumo.mesPeriodo}. Cadastre a meta ou o KPI fica "—".`,
  });
  if (headcount === 0) faltando.push({ campo: 'quadro', motivo: 'Nenhum funcionário com status ATIVO, FÉRIAS ou AFASTADO.' });
  if (diasUteis === 0) faltando.push({ campo: 'diasUteis', motivo: 'O período selecionado não tem dias úteis.' });
  if (coleta.pontos.length === 0) faltando.push({ campo: 'ponto', motivo: 'Nenhuma batida no período — verifique a integração do relógio ou lance ponto manual.' });

  faltando.push({ campo: 'disc', motivo: semDisc });
  faltando.push({ campo: 'bemEstar', motivo: semBemEstar });
  faltando.push({ campo: 'reconhecimentos', motivo: 'Nenhum registro de reconhecimento em RegistroGamificacao.' });
  faltando.push({ campo: 'online', motivo: 'Não há presença on-line; o NEXUS OS registra ponto, não presença.' });
  faltando.push({ campo: 'tempoResposta', motivo: 'Não existe canal de mensagens medido no NEXUS OS.' });
  return faltando;
}

/**
 * Equipes = setores reais. Os pontos vêm de `RegistroGamificacao` (persistido),
 * e não de um placar digitado à mão. Sem registros, os pontos são 0 e a tela
 * mostra "aguardando dados" em vez de um placar inventado.
 */
export function montarEquipes(resumo: ResumoRadar) {
  const { coleta, areasRisco } = resumo;
  const pontosPorSetor = new Map<string, number>();
  const tamanhoPorSetor = new Map<string, number>();
  for (const r of resumo.resumos) {
    tamanhoPorSetor.set(r.setor, (tamanhoPorSetor.get(r.setor) ?? 0) + 1);
  }
  for (const g of coleta.registrosGamificacao) {
    if (!g.funcionarioId) continue;
    const func = coleta.funcionarios.find((f) => f.id === g.funcionarioId);
    if (!func) continue;
    pontosPorSetor.set(func.setor, (pontosPorSetor.get(func.setor) ?? 0) + g.pontos);
  }

  return areasRisco.map((a, i) => {
    // Setor sem registro de pontuação tem 0 pontos — e `temPontos: false`, que é
    // o que faz a tela escrever "sem registros" em vez de "0 pts". ZERO e
    // AUSÊNCIA são afirmações diferentes.
    const pontos = pontosPorSetor.get(a.area) ?? 0;
    return {
      posicao: i + 1,
      nome: a.area,
      pontos,
      medalha: (i === 0 ? 'Ouro' : i === 1 ? 'Prata' : 'Bronze') as 'Ouro' | 'Prata' | 'Bronze',
      cor: i === 0 ? '#f59e0b' : i === 1 ? '#c0c0c0' : '#cd7f32',
      membros: a.pessoas,
      meta: Math.round(clamp(100 - a.risco, 0, 100)),
      tamanho: tamanhoPorSetor.get(a.area) ?? 0,
      temPontos: pontos > 0,
    };
  });
}

/** Colaboradores com sinais reais + o que o RH registrou (DISC/bem-estar). */
export function montarColaboradores(resumo: ResumoRadar) {
  const { coleta, diasUteis } = resumo;
  return resumo.resumos.map((r) => {
    const func = coleta.funcionarios.find((f) => f.id === r.funcionarioId)!;
    const disc = coleta.avaliacoesDisc.get(r.funcionarioId) ?? null;
    const bemEstar = coleta.bemEstar.get(r.funcionarioId) ?? null;
    // Ciclo 1: o Radar só CONSOME o plano. `progresso` é derivado das ações
    // gravadas pelo gestor — nenhum percentual aqui é estimado pelo backend.
    const plano = coleta.planosDesenvolvimento.get(r.funcionarioId) ?? null;
    const pontuacao = coleta.registrosGamificacao
      .filter((g) => g.funcionarioId === r.funcionarioId)
      .reduce((s, g) => s + g.pontos, 0);
    return {
      id: r.funcionarioId,
      nome: r.nome,
      cargo: func.cargo,
      setor: r.setor,
      status: func.status,
      usuarioId: func.usuarioId,
      horarioEntradaPrevisto: func.horarioEntradaPrevisto,
      horarioSaidaPrevisto: func.horarioSaidaPrevisto,
      disc: (disc?.perfil ?? null) as 'D' | 'I' | 'S' | 'C' | null,
      scores: disc?.scores ?? null,
      discData: disc ? chaveDiaSql(disc.dataAvaliacao) : null,
      discObservacoes: disc?.observacoes ?? null,
      /**
       * Id da avaliação vigente. O Radar precisa devolver porque o Plano de
       * Desenvolvimento (Ciclo 1) se ancora nela: é dela que sai o snapshot
       * do perfil e dos percentuais que o plano congela. Sem este id, a tela
       * teria de adivinhar qual avaliação do histórico originou o plano.
       */
      discAvaliacaoId: disc?.id ?? null,
      bemEstar: bemEstar ? bemEstar.nota : null,
      bemEstarData: bemEstar ? chaveDiaSql(bemEstar.dataPesquisa) : null,
      bemEstarResposta: bemEstar?.resposta ?? null,
      /**
       * Plano de desenvolvimento em curso (Ciclo 1). `null` quando a pessoa não
       * tem nenhum — e a tela mostra a ausência, nunca um plano de exemplo.
       */
      planoDesenvolvimento: plano
        ? {
            id: plano.id,
            objetivo: plano.objetivo,
            competencia: plano.competencia,
            status: plano.status,
            prazo: plano.prazo ? chaveDiaSql(plano.prazo) : null,
            dataInicio: chaveDiaSql(plano.dataInicio),
            responsavelId: plano.responsavelId,
            progresso: progressoAcoes(plano.acoes),
          }
        : null,
      risco: riscoDePessoa(r, diasUteis),
      componentes: componentesDe(r, diasUteis),
      descricao: [func.cargo, r.setor].filter(Boolean).join(' —') || 'Sem cargo',
      online: false,
      pontuacao,
      sinais: {
        diasRegistrados: r.diasRegistrados,
        horasMin: r.horasMin,
        horasExtrasMin: r.horasExtrasMin,
        faltas: r.faltas,
        atrasos: r.atrasos,
        absenteismoPct: r.absenteismoPct,
        extrasMediaDiaMin: r.extrasMediaDiaMin,
        diasAposPrevisto: r.diasAposPrevisto,
        minutosExcedentesMedia: r.minutosExcedentesMedia,
        saidasAntecipadas: r.saidasAntecipadas,
        inconsistencias: r.inconsistencias,
        vendasQtd: r.vendasQtd,
        vendasTotal: r.vendasTotal,
        advertencias: r.advertencias,
        suspensoes: r.suspensoes,
      },
    };
  });
}

