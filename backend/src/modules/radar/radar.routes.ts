/**
 * Rotas HTTP do Radar Organizacional.
 *
 * REGRA DE ARQUITETURA DESTE ARQUIVO
 * ---------------------------------
 * A rota é fina de propósito: valida, autoriza, chama o read model e responde.
 * Nenhuma agregação, nenhuma fórmula, nenhum número nasce aqui. Isso mantém
 * três garantias ao mesmo tempo:
 *   1. a tela, o simulador e a IA veem exatamente os mesmos números (todos
 *      consomem `montarResumo`);
 *   2. o isolamento por empresa acontece em UM lugar, na primeira linha;
 *   3. as regras de negócio são testáveis sem subir servidor nem banco fake.
 *
 * ISOLAMENTO MULTI-TENANT
 * -----------------------
 * Toda rota exige `req.user.empresaId` e o passa como PRIMEIRO argumento de
 * qualquer consulta. Não existe função aqui que aceite um id de empresa vindo
 * do corpo ou da query — assim não há como o cliente pedir os dados de outra
 * empresa, nem por engano.
 *
 * PERMISSÃO
 * ---------
 * `rh:visualizar` para leitura, `rh:editar` para escrita. Não criamos um módulo
 * `radar` novo: exigiria migração de permissões para todos os usuários já
 * cadastrados e mudaria a tela de permissões, e tudo que o Radar lê é dado de
 * pessoas — que já é RH.
 */

import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware, permissaoQualquerDas } from '../../middlewares/auth.js';
import { createRateLimiter } from '../../middlewares/rateLimiter.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { diasUteis, chaveDia, chaveDiaSql, type Janela } from './radar.regras.js';
import {
  QUESTIONARIO_DISC,
  TOTAL_PERGUNTAS_DISC,
  FATORES_DISC,
  NOMES_FATOR,
  DESCRICAO_FATOR,
  calcularDisc,
  definirVigenciasDisc,
} from './radar.disc.js';
import {
  montarResumo, montarHeatmap, montarEvolucao, montarCorrelacao,
  montarFaltando, montarEquipes, montarColaboradores, riscoDePessoa,
  montarNivelSimulacao,
} from './radar.resumo.js';
import { gerarSinais, gerarSinaisArea, LIMITES } from './radar.regras.js';

const pad2 = (n: number) => String(n).padStart(2, '0');
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Quanto da variação do resultado comercial entra na Gargalo do simulador.
 *
 * Não é 1 porque "vender mais" não zera o gargalo operacional: ele mexe na
 * parcela de RESULTADO, e a Gargalo é a mistura de risco de sobrecarga
 * (parcelas de pessoa) com essa parcela. 0.25 é uma escolha declarada — a
 * mesma fração que `PESO.resultado` usa no read model, para o simulador e a
 * tela contarem a mesma história. Um modelo estatístico exigiria o histórico
 * de cenários que a empresa ainda não tem.
 */
const PESO_COMERCIAL_SIMULACAO = 0.25;

/**
 * `catch` das rotas do Radar: re-lança falha de VALIDAÇÃO para o handler global.
 *
 * O `setErrorHandler` do `server.ts` traduz `ZodError` em 400 com os `issues`.
 * Mas cada rota tem seu próprio `try/catch` (para logar o contexto e devolver
 * mensagem de negócio), e esse `catch` engolia o ZodError e respondia 500
 * "Não foi possível registrar a pesquisa" — o que faz o gestor achar que o banco
 * caiu quando o que houve foi uma nota 150 fora da escala. Cada `catch` das
 * rotas de escrita começa com `if (erro instanceof z.ZodError) throw erro;`.
 * O resto continua virando a mensagem de negócio da rota.
 */
/** Aceita "YYYY-MM-DD" ou ISO; null quando ausente/inválido. */
function parseData(valor?: string): Date | null {
  if (!valor || typeof valor !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Padrão: últimos 30 dias corridos (o dia de hoje entra). Chave de data LOCAL. */
function resolverJanela(periodoInicio?: string, periodoFim?: string): Janela {
  const agora = new Date();
  const inicioBruto = parseData(periodoInicio);
  const fimBruto = parseData(periodoFim);
  const inicio = inicioBruto ?? new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 29);
  const fim = fimBruto ?? agora;
  const i = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate(), 0, 0, 0, 0);
  const f = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate(), 23, 59, 59, 999);
  return { inicio: i, fim: f, diasUteis: diasUteis(i, f) };
}

function empresaDoRequisicao(req: any): string {
  const empresaId = req.user?.empresaId;
  if (!empresaId) throw new Error('Empresa não identificada.');
  return empresaId;
}

/**
 * Grava a avaliação comportamental e deixa exatamente UMA vigente.
 *
 * A regra de vigência é por DATA da avaliação, não pela ordem de gravação. Sem
 * isso, lançar uma avaliação retroativa (quem aplicou o questionário em
 * 10/09, mas só registrou depois de uma de 28/09) faria o Radar exibir o perfil
 * antigo como se fosse o atual, sem nenhum aviso ao usuário.
 *
 * Três implementações desta regra foram erradas antes de chegar aqui, e cada
 * uma quebrava em um cenário diferente — por isso ela está num helper só:
 *
 *   1. Desligar todas e ligar a nova.        → retroativa ROUBAVA a vigência.
 *   2. Desligar só as anteriores à data nova. → retroativa deixava DUAS vigentes.
 *   3. `const [{ id }] = findMany(...)`       → TypeError em array vazio, ou
 *                                               seja, na PRIMEIRA avaliação de
 *                                               qualquer funcionário (HTTP 500).
 *
 * A forma correta grava a avaliação já desligada, acha a mais recente por data
 * e religa só ela, tudo em uma transação: ou o funcionário fica com uma única
 * vigente, ou nada muda.
 *
 * Empate de data: `createdAt` desc, então a última lançada vence. É arbitrário,
 * porém determinístico — o mesmo input sempre produz o mesmo estado.
 *
 * Retorna `id` (a avaliação acabada de gravar, que pode ser retroativa) e
 * `vigenteId` (qualquer que tenha ficado valendo no Radar). São o mesmo id no
 * caso normal; só diferem quando o lançamento é retroativo.
 */
async function gravarAvaliacaoComVigencia(
  empresaId: string,
  funcionarioId: string,
  // `Unchecked` porque passamos os ids de relação direto (empresaId,
  // funcionarioId) em vez dos objetos aninhados `empresa: { connect }`.
  // `vigente` é omitido de propósito: quem decide é esta função.
  dados: Omit<Prisma.AvaliacaoComportamentalUncheckedCreateInput, 'vigente'>,
): Promise<{ id: string; vigenteId: string }> {
  return prisma.$transaction(async (tx) => {
    const nova = await tx.avaliacaoComportamental.create({
      data: { ...dados, vigente: false },
    });

    // A regra em si vive em `definirVigenciasDisc` (radar.disc.ts), testável
    // sem banco. Aqui só se busca as linhas e se aplica o resultado.
    const existentes = await tx.avaliacaoComportamental.findMany({
      where: { empresaId, funcionarioId },
      select: { id: true, dataAvaliacao: true, createdAt: true },
    });
    const { vigenteId } = definirVigenciasDisc(existentes);
    const queFica = vigenteId ?? nova.id;

    await tx.avaliacaoComportamental.updateMany({
      where: { empresaId, funcionarioId, id: { not: queFica } },
      data: { vigente: false },
    });
    await tx.avaliacaoComportamental.update({
      where: { id: queFica },
      data: { vigente: true },
    });

    return { id: nova.id, vigenteId: queFica };
  });
}

const querySchema = z.object({
  periodoInicio: z.string().optional(),
  periodoFim: z.string().optional(),
  /** Limita o volume de alertas; o padrão já cabe em uma tela. */
  limite: z.coerce.number().int().min(1).max(100).optional(),
});

/** Empate entre as cores que a tela já usa e a enum do banco. */
function dataMais(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return chaveDia(d);
}

const COR_CRITICIDADE: Record<string, string> = { Alta: '#ef4444', Média: '#f59e0b', Baixa: '#22c55e' };
const EMOJI: Record<string, string> = { Alta: '🔴', Média: '🟡', Baixa: '🟢' };

/** Ordem de urgência. "Alta" aqui é prazo de ação, não gravidade clínica. */
const ORDEM: Record<string, number> = { Alta: 0, Média: 1, Baixa: 2 };
const ordem = (c: string) => ORDEM[c] ?? 3;

export async function radarRoutes(app: FastifyInstance) {
  const iaLimiter = createRateLimiter(15, 60_000);
  const leitura = { preHandler: [(app as any).authenticate, permissaoMiddleware('rh', 'visualizar')] };
  const escrita = { preHandler: [(app as any).authenticate, permissaoMiddleware('rh', 'editar')] };

  /**
   * Permissões das rotas de AVALIAÇÃO DISC — diferentes das do restante do
   * Radar, e essa é a decisão.
   *
   * O DISC é o único recurso do Radar que é preenchido pelo gestor dentro de
   * outra tela: ele vive na aba Relatórios, mas fala de pessoas. Com `rh` fixo,
   * quem tivesse `relatorios` e não `rh` abriria a aba e tomaria 403; com
   * `relatorios` fixo, o contrário aconteceria no contexto do Radar. Nenhum dos
   * dois módulos é o dono da funcionalidade, então ela aceita um OU outro.
   *
   * Isto NÃO abre o RH: vale só para as rotas DISC, e cada uma devolve o
   * mínimo necessário. Folha, ponto, advertências e o cadastro completo de
   * funcionários continuam exigindo `rh` de verdade.
   */
  const discLeitura = {
    preHandler: [
      (app as any).authenticate,
      permissaoQualquerDas([
        { modulo: 'relatorios', acao: 'visualizar' },
        { modulo: 'rh', acao: 'visualizar' },
      ]),
    ],
  };
  const discEscrita = {
    preHandler: [
      (app as any).authenticate,
      permissaoQualquerDas([
        { modulo: 'relatorios', acao: 'editar' },
        { modulo: 'rh', acao: 'editar' },
      ]),
    ],
  };

  /**
   * GET /radar/resumo
   *
   * Uma chamada alimenta a tela inteira. Traz pessoas com sinais reais,
   * séries temporais, risco por área, equipe com pontuação persistida e o
   * MANIFESTO do que falta (`faltando`), para que a interface nunca preencha
   * campo vazio com número inventado.
   */
  app.get('/resumo', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const q = querySchema.parse(req.query ?? {});
      const janela = resolverJanela(q.periodoInicio, q.periodoFim);
      const resumo = await montarResumo(empresaId, janela);

      // Alertas já tratados aparecem como "Em ação"/"Resolvido" em vez de
      // sumir: o gestor precisa ver que aquilo existe e foi tratado.
      // Alerta já tratado NÃO pode sumir da lista: ele passa a aparecer como
      // "Em ação" (ou "Resolvido"), com o plano vinculado. Só o CANCELADO sai
      // de propósito — o gestor descartou e não quer mais ver.
      //
      // Filtrar aqui e mapear o status depois (o que eu fiz primeiro) parecia
      // correto e não era: o `gerarSinais` descartava o sinal antes de chegar
      // no `.map()` que atribui o status, então o alerta simplesmente sumia.
      // O mapa carrega o plano INTEIRO, não só o id: o gestor precisa ver as
      // ações, o prazo e o responsável depois de criar, senão o plano fica
      // gravado e invisível. Antes, a tela só sabia dizer "Em ação".
      const porRef = new Map<string, {
        status: string; id: string; acoes: unknown; prazo: Date | null; responsavelId: string | null; criadoEm: Date;
      }>();
      const cancelados = new Set<string>();
      for (const a of resumo.coleta.acoesRadar) {
        porRef.set(a.alertaRef, {
          status: a.status, id: a.id, acoes: a.acoes,
          prazo: a.prazo, responsavelId: a.responsavelId, criadoEm: a.createdAt,
        });
        if (a.status === 'CANCELADA') cancelados.add(a.alertaRef);
      }

      const limite = q.limite ?? 30;
      const sinais = [
        ...gerarSinais(
          resumo.resumos,
          janela,
          cancelados,
          new Map(resumo.coleta.funcionarios.map((f) => [f.id, f])),
        ),
        ...gerarSinaisArea(resumo.resumos, resumo.coleta, janela, cancelados, (setorId) => {
          const nome = resumo.coleta.funcionarios.find((f) => f.departamentoId === setorId)?.setor;
          return nome ?? null;
        }),
      ]
        .sort((a, b) => (a.criticidade === b.criticidade ? b.evidencias.length - a.evidencias.length : ordem(a.criticidade) - ordem(b.criticidade)))
        .slice(0, limite)
        .map((s) => {
          const acao = porRef.get(s.ref);
          return {
            id: s.id,
            ref: s.ref,
            titulo: s.titulo,
            area: s.area,
            tipo: s.tipo,
            criticidade: s.criticidade,
            // `causas` carrega as EVIDÊNCIAS: números que o gestor confere.
            causas: s.evidencias,
            fato: s.fato,
            impacto: s.impacto,
            sugestao: s.sugestao,
            status: acao ? (acao.status === 'CONCLUIDA' ? 'Resolvido' : 'Em ação') : 'Novo',
            prazo: dataMais(s.prazoDias),
            emoji: EMOJI[s.criticidade],
            cor: COR_CRITICIDADE[s.criticidade],
            origem: s.origem,
            funcionarioId: s.funcionarioId ?? null,
            acaoRadarId: acao?.id ?? null,
            /**
             * Plano de ação quando existe. Aditivo: nenhuma chave anterior
             * mudou de nome ou de formato, então quem já consome `/radar/resumo`
             * continua funcionando. É o que permite à tela mostrar o que foi
             * planejado em vez de apenas um selo de status.
             */
            plano: acao
              ? {
                  id: acao.id,
                  status: acao.status,
                  acoes: Array.isArray(acao.acoes) ? acao.acoes : [],
                  prazo: acao.prazo ? chaveDiaSql(acao.prazo) : null,
                  responsavelId: acao.responsavelId,
                  criadoEm: acao.criadoEm,
                }
              : null,
          };
        });

      const heatmap = montarHeatmap(resumo);
      const colaboradores = montarColaboradores(resumo);
      const equipes = montarEquipes(resumo);

      return reply.send({
        geradoEm: new Date().toISOString(),
        fonte: 'dados_reais' as const,
        periodo: { inicio: chaveDia(janela.inicio), fim: chaveDia(janela.fim) },
        base: {
          colaboradores: resumo.headcount,
          departamentos: resumo.areasRisco.length,
          diasUteis: resumo.diasUteis,
          registrosPonto: resumo.coleta.pontos.length,
        },
        kpis: resumo.kpis,
        /**
         * Nível real que o Simulador What-If usa como ponto de partida, na
         * MESMA função que `POST /radar/simulacao` chama. A tela precisa dele
         * para mostrar "cenário atual" enquanto o gestor arrasta os sliders sem
         * inventar uma baseline no navegador.
         */
        nivelSimulacao: montarNivelSimulacao(resumo),
        sinais: resumo.sinais,
        comercial: resumo.comercial,
        colaboradores,
        alertas: sinais,
        areasRisco: resumo.areasRisco,
        heatmap,
        evolucao: montarEvolucao(resumo),
        correlacaoHoras: montarCorrelacao(resumo),
        equipes,
        rupturas: resumo.coleta.rupturas,
        clientesInativos: resumo.coleta.clientesInativos,
        metas: resumo.coleta.metas,
        //DISC e bem-estar só existem se o RH registrou (ver `faltando`).
        disc: {
          disponivel: resumo.coleta.avaliacoesDisc.size > 0,
          motivo: resumo.coleta.avaliacoesDisc.size > 0 ? null : 'Nenhuma avaliação comportamental registrada.',
        },
        bemEstar: {
          disponivel: resumo.coleta.bemEstar.size > 0,
          motivo: resumo.coleta.bemEstar.size > 0 ? null : 'Nenhuma pesquisa de bem-estar registrada.',
        },
        gamificacao: {
          registros: resumo.coleta.registrosGamificacao.length,
          pontos: resumo.coleta.registrosGamificacao.reduce((s, g) => s + g.pontos, 0),
        },
        /**
         * Média de bem-estar em 0–100, ou `null` se ninguém respondeu.
         *
         * `null` e não 0: "ninguém respondeu" e "a média é zero" são afirmações
         * diferentes, e a tela precisa distinguir. A média usa só quem tem
         * registro, e a escala é a oficial (0–100) documentada no schema.
         */
        saudeMedia: resumo.coleta.bemEstar.size > 0
          ? Math.round(
              [...resumo.coleta.bemEstar.values()].reduce((s, p) => s + p.nota, 0)
                / resumo.coleta.bemEstar.size,
            )
          : null,
        /**
         * Conquistas distintas por regra: é o que a aba Gamificação mostra como
         * "N conquistas". Vem do placar persistido, não de um catálogo fixo.
         */
        totalBadges: new Set(
          resumo.coleta.registrosGamificacao
            .map((g) => g.regraId)
            .filter((r): r is string => Boolean(r)),
        ).size,
        faltando: montarFaltando(resumo),
      });
    } catch (erro: any) {
      // Falha de validacao: deixa o handler global responder 400 com o detalhe.
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao montar /radar/resumo');
      return reply.status(500).send({ error: 'Não foi possível montar o resumo do Radar.' });
    }
  });


  // ── SIMULADOR PREDITIVO
  //
  // POR QUE NÃO É UM MODELO
  // -----------------------
  // Um modelo preditivo de carga de trabalho exigiria histórico de cenários
  // passados e seus resultados (intervenções, metas atingidas, sazonalidade
  // real). Uma empresa que acabou de cadastrar o RH não tem isso. Inventar
  // pesos para "produzir um número visual" é exatamente o que o prompt proíbe
  // e o que a auditoria anterior apontou.
  //
  // O que fazemos, então, é uma PROJEÇÃO COM BASE OBSERVADA: partimos do
  // nível real atual e aplicamos o efeito marginal que o histórico recente
  // mostra. Quando nem o nível atual existe (sem ponto, sem quadro), devolvemos
  // `suficiente: false` com o motivo, e a interface diz "Dados insuficientes
  // para análise" em vez de projetar sobre o vazio.  // ═════════════════════════════════════════════════════════════════════
  const simSchema = z.object({
    periodoInicio: z.string().optional(),
    periodoFim: z.string().optional(),
    /** Pessoas adicionadas ao setor mais carregado. */
    prodAdd: z.coerce.number().int().min(0).max(50).default(0),
    /** Reforço comercial. */
    vendasAdd: z.coerce.number().int().min(0).max(50).default(0),
    /** Variação de horas extras em % (negativo = menos extras). */
    horasDelta: z.coerce.number().int().min(-100).max(100).default(0),
  });

  app.post('/simulacao', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = simSchema.parse(req.body ?? {});
      const janela = resolverJanela(b.periodoInicio, b.periodoFim);
      const resumo = await montarResumo(empresaId, janela);

      const semPonto = resumo.coleta.pontos.length === 0 || resumo.headcount === 0;
      if (semPonto) {
        return reply.send({
          suficiente: false,
          motivo: 'Dados insuficientes para análise: sem batidas ou sem quadro no período, não há linha de base real para projetar.',
          cenario: null,
          deltas: null,
          pressupostos: [],
        });
      }

      // Nível observado agora — é a referência, e ela é real. Vem da MESMA
      // função que `/radar/resumo` publica para a tela, para que o "cenário
      // atual" mostrado ao arrastar os sliders seja o ponto de partida real e
      // não uma constante escrita no navegador.
      const nivelAtual = montarNivelSimulacao(resumo);

      // Efeito marginal OBSERVADO, não coeficiente arbitrário:
      //   - 1 pessoa a mais amortiza proportionally a carga de extras do setor;
      //   - reduzir extras mexe no indicador que é feito de hora extra;
      //   - contratar não reduz absenteísmo de forma instantânea.
      const extrasMedioPessoa =
        resumo.coleta.pontos.length > 0
          ? resumo.coleta.pontos.reduce((s, p) => s + p.horaExtraMinutos, 0) / resumo.coleta.pontos.length
          : 0;
      const amaroteamento = clamp((b.prodAdd / Math.max(1, resumo.headcount)) * 100, 0, 60);
      const extrasPoupados = extrasMedioPessoa * b.prodAdd * Math.max(0, -b.horasDelta) / 100;

      // ── Efeito comercial (vendasAdd) ──────────────────────────────────────
      //
      // `vendasAdd` NÃO pode ser campo só visual. O que ele move é a Gargalo, e
      // só quando existe venda E meta no período.
      //
      // Por que Gargalo e não Saúde/Burnout: o NEXUS OS não mede produtividade,
      // então "vender mais" não é observável como ganho de saúde nem como
      // redução de sobrecarga. Venda é resultado comercial, e o indicador do
      // Radar construído sobre resultado é a Gargalo.
      //
      // UNIDADE: pontos percentuais de atingimento da meta — a mesma unidade de
      // `componentes.resultado`. A versão anterior dividia um incremento de venda
      // pelo `metaCount` e produzia -400% para 10 vendas, que não quer dizer
      // nada para o gestor.
      //
      // LIMITAÇÃO DECLARADA: a projeção trata as vendas extras como se fossem
      // realizadas NO PERÍDO INTEIRO, e é por isso que a resposta é menor do que
      // a conta bruta sugere. Uma venda extra vale
      // `(diasRestantes / diasUteis)` da meta, porque a meta do mês ainda tem
      // dias pela frente. Sem essa correção, 10 vendas numa empresa com meta de
      // 100 estourariam o gargalo em -250 pontos.
      const temBaseComercial = resumo.kpis.comercialVendas > 0;
      const ticketMedio = resumo.kpis.comercialVendas > 0
        ? resumo.comercial.vendasTotal / resumo.kpis.comercialVendas
        : 0;
      const metasComerciais = resumo.metasPeriodo.filter((m) => m.tipo === 'VENDAS');
      const baseMeta = metasComerciais.reduce((s, m) => s + m.metaValor, 0);

      // Fração do período que ainda resta: a meta do mês é do mês inteiro, e a
      // janela do Radar são os últimos 30 dias.
      const diasDaJanela = Math.max(1, resumo.diasUteis);
      const diasAteFimDoMes = new Date(
        resumo.janela.fim.getFullYear(),
        resumo.janela.fim.getMonth() + 1,
        0,
      ).getDate();
      const diasRestantes = clamp(diasDaJanela - (diasDaJanela - diasAteFimDoMes), 1, diasDaJanela);
      const fracaoDoPeriodo = clamp(diasRestantes / diasDaJanela, 0.1, 1);

      // O reforço é por pessoa: contratar 1 vendedor numa empresa de 100 move
      // menos a Gargalo do que numa de 5.
      const valorExtra = (b.vendasAdd / Math.max(1, resumo.headcount)) * ticketMedio * fracaoDoPeriodo;

      // Sem venda, sem meta, ou `vendasAdd` zerado: o reforço não tem contra o
      // que ser comparado, e o delta é zero em vez de uma promessa sem base.
      const dResultadoBruto = temBaseComercial && baseMeta > 0
        ? (valorExtra / baseMeta) * 100
        : 0;
      // Saturado: nenhuma projeção pode prometer mais que o próprio indicador.
      const dResultado = -Math.round(clamp(dResultadoBruto, 0, 40) * PESO_COMERCIAL_SIMULACAO);

      // SEMÂNTICA DOS SINAIS (o erro mais fácil de cometer aqui):
      //   amaroteamento  — 0..100, quanto o reforço reduz a carga por pessoa
      //   horasDelta     — positivo = MAIS hora extra
      //   incrementoComercial — vendas extras por pessoa (0 se não há base)
      //
      // Reforço       => reduz sobrecarga  => gargalo cai, SAÚDE SOBE, burnout fica.
      // Delta neg.    => burnout cai, SAÚDE SOBE.
      // Delta pos.    => burnout sobe, SAÚDE CAI.
      // Reforço comercial => resultado melhor => Gargalo cai.
      const dSaude = Math.round(amaroteamento * 0.15 - b.horasDelta * 0.1);
      const dGargalo = Math.round(-amaroteamento * 0.2 + dResultado);
      const dBurnout = Math.round(
        -(extrasPoupados / Math.max(1, resumo.headcount * resumo.diasUteis * LIMITES.extrasMinPorDia)) * 100
        + b.horasDelta * 0.3,
      );

      return reply.send({
        suficiente: true,
        motivo: null,
        cenario: {
          saude: Math.round(clamp(nivelAtual.saude + dSaude, 0, 100)),
          gargalo: Math.round(clamp(nivelAtual.gargalo + dGargalo, 0, 100)),
          burnout: Math.round(clamp(nivelAtual.burnout + dBurnout, 0, 100)),
        },
        nivelAtual,
        deltas: { dSaude, dGargalo, dBurnout },
        pressupostos: [
          `Base: ${resumo.coleta.pontos.length} batida(s) de ${resumo.headcount} pessoa(s) em ${resumo.diasUteis} dias úteis.`,
          `Nível de hoje derivado dos dados observados (não de coeficiente fixo).`,
          `Cada pessoa adicionada amortece a carga proporcionalmente: ~${Math.round(amaroteamento)}% de extras por pessoa.`,
          `Hora extra média atual: ${Math.round(extrasMedioPessoa)} min/registro.`,
          `Reduzir extras em ${Math.abs(b.horasDelta)}% mexe só no indicador que é feito de hora extra.`,
          temBaseComercial
            ? `Reforço comercial: +${b.vendasAdd} venda(s) sobre base de ${resumo.kpis.comercialVendas} no período.`
            : `Reforço comercial ignorado: não há venda registrada no período para servir de base.`,
          resumo.kpis.metaCount > 0
            ? `Metas do período: ${resumo.kpis.metaCount} (o reforço comercial mexe na Gargalo por resultado).`
            : `Reforço comercial não move a Gargalo: não há meta cadastrada no período.`,
        ],
        aviso: 'Projeção linear a partir do observado. Não é previsão estatística: a empresa ainda não tem histórico de cenários anteriores para calibrar um modelo.',
        aplicaNoBanco: false,
      });
    } catch (erro: any) {
      // Falha de validacao: deixa o handler global responder 400 com o detalhe.
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao simular');
      return reply.status(500).send({ error: 'Não foi possível rodar a simulação.' });
    }
  });  // ═════════════════════════════════════════════════════════════════════
  // EXPORTAÇÃO — PDF e CSV de verdade
  //
  // Reusa o que o projeto já tem:
  //   - PDF → `lib/pdf.ts :: gerarPdf` (escritor próprio, sem dependência nova)
  //   - CSV → `relatorios/export.service.ts :: montarPlanilha` (exceljs)
  //
  // O conteúdo é o MESMO read model da tela. Um relatório que não bate com o
  // que o gestor viu é pior do que não ter relatório.  // ═════════════════════════════════════════════════════════════════════
  const exportSchema = z.object({
    formato: z.enum(['pdf', 'csv']),
    periodoInicio: z.string().optional(),
    periodoFim: z.string().optional(),
    /** Recorte opcional, igual ao seletor da aba. */
    setor: z.string().optional(),
  });

  app.post('/relatorio', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = exportSchema.parse(req.body ?? {});
      const janela = resolverJanela(b.periodoInicio, b.periodoFim);
      const resumo = await montarResumo(empresaId, janela);
      const periodo = `${chaveDia(janela.inicio)} a ${chaveDia(janela.fim)}`;
      const alvoSetor = b.setor && b.setor !== 'Todos' ? b.setor : null;

      const colaboradores = montarColaboradores(resumo)
        .filter((c) => !alvoSetor || c.setor === alvoSetor);
      const areas = resumo.areasRisco.filter((a) => !alvoSetor || a.area === alvoSetor);
      const k = resumo.kpis;

      const indicadores = [
        { indicador: 'Pessoas no quadro', valor: String(resumo.headcount) },
        { indicador: 'Dias uteis no periodo', valor: String(resumo.diasUteis) },
        { indicador: 'Registros de ponto', valor: String(resumo.coleta.pontos.length) },
        { indicador: 'Horas extras (h)', valor: k.extras === null ? 'Dados insuficientes' : String(k.extras) },
        { indicador: 'Absenteismo (%)', valor: k.absenteismo === null ? 'Dados insuficientes' : String(k.absenteismo) },
        { indicador: 'Produtividade (%)', valor: k.produtividade === null ? 'Dados insuficientes' : String(k.produtividade) },
        { indicador: 'Turnover (%)', valor: k.turnover === null ? 'Dados insuficientes' : String(k.turnover) },
        { indicador: 'Faltas', valor: String(resumo.sinais.faltas) },
        { indicador: 'Atrasos', valor: String(resumo.sinais.atrasos) },
        { indicador: 'Vendas no periodo (qtd)', valor: String(resumo.comercial.vendasQtd) },
        { indicador: 'Rupturas de estoque', valor: String(resumo.coleta.rupturas.length) },
      ];



      if (b.formato === 'csv') {
        const { montarPlanilha } = await import('../relatorios/export.service.js');
        const tabela = colaboradores.map((c) => ({
          Funcionario: c.nome,
          Setor: c.setor,
          Cargo: c.cargo ?? '—',
          'Dias com ponto': c.sinais.diasRegistrados,
          Faltas: c.sinais.faltas,
          Atrasos: c.sinais.atrasos,
          'Horas trabalhadas': (c.sinais.horasMin / 60).toFixed(1),
          'Horas extras': (c.sinais.horasExtrasMin / 60).toFixed(1),
          'Absenteismo %': c.sinais.absenteismoPct,
          'Dias apos previsto': c.sinais.diasAposPrevisto,
          Vendas: c.sinais.vendasQtd,
          Risco: c.risco,
          'Perfil DISC': c.disc ?? 'sem avaliação',
          'Bem-estar': c.bemEstar === null ? 'sem pesquisa' : c.bemEstar,
        }));
        const { base64, nome } = await montarPlanilha({
          formato: 'csv',
          titulo: `Radar Organizacional ${periodo}${alvoSetor ? ` - ${alvoSetor}` : ''}`,
          kpis: indicadores.map((i) => ({ label: i.indicador, valor: i.valor, delta: '', subiu: true })),
          tabela: tabela as any,
        });
        return reply.send({ base64, nome, mime: 'text/csv' });
      }

      // PDF: cabeçalho, indicadores, áreas de risco e a tabela de pessoas.
      const { gerarPdf } = await import('../../lib/pdf.js');
      const empresa = await prisma.empresa.findFirst({
        where: { id: empresaId },
        select: { nome: true, cnpj: true },
      });

      const linhas: Array<{ texto: string; tamanho?: number; negrito?: boolean; espacoAntes?: number }> = [
        { texto: `Empresa: ${empresa?.nome ?? '—'}${empresa?.cnpj ? ` (CNPJ ${empresa.cnpj})` : ''}`, tamanho: 9 },
        { texto: `Periodo: ${periodo}${alvoSetor ? ` | Setor: ${alvoSetor}` : ''}`, tamanho: 9, espacoAntes: 4 },
        { texto: `Gerado em ${new Date().toLocaleString('pt-BR')} por NEXUS OS`, tamanho: 9 },
        { texto: 'INDICADORES', tamanho: 10, negrito: true, espacoAntes: 14 },
        ...indicadores.map((i) => ({ texto: `${i.indicador}: ${i.valor}`, tamanho: 9 })),
        { texto: 'RISCO POR AREA', tamanho: 10, negrito: true, espacoAntes: 14 },
        ...areas.map((a) => ({
          texto: `${a.area}: ${a.risco}% (${a.tamanho} pessoa(s) - ausencia ${a.componentes.absenteismo}, extras ${a.componentes.horasExtras}, disciplina ${a.componentes.disciplina})`,
          tamanho: 9,
        })),
        { texto: 'PESSOAS', tamanho: 10, negrito: true, espacoAntes: 14 },
        ...colaboradores.map((c) => ({
          texto: `${c.nome} (${c.setor}) - ponto ${c.sinais.diasRegistrados}d, faltas ${c.sinais.faltas}, atrasos ${c.sinais.atrasos}, extras ${(c.sinais.horasExtrasMin / 60).toFixed(1)}h, risco ${c.risco}%`,
          tamanho: 9,
        })),
      ];

      if (colaboradores.length === 0) {
        linhas.push({ texto: 'Nenhum funcionario no recorte selecionado.', tamanho: 9, espacoAntes: 6 });
      }

      const faltando = montarFaltando(resumo);
      if (faltando.length > 0) {
        linhas.push({ texto: 'INDICADORES SEM DADO', tamanho: 10, negrito: true, espacoAntes: 14 });
        for (const f of faltando) linhas.push({ texto: `${f.campo}: ${f.motivo}`, tamanho: 9 });
      }
      linhas.push({
        texto: 'Este documento apresenta sinais observados para analise do gestor/RH. Nao constitui diagnostico de saude nem avaliação de desempenho individual.',
        tamanho: 8, espacoAntes: 14,
      });

      const pdf = gerarPdf({
        titulo: 'RADAR ORGANIZACIONAL',
        subtitulo: `Periodo ${periodo}${alvoSetor ? ` - ${alvoSetor}` : ''}`,
        rodape: 'NEXUS OS - dados reais da empresa. Sem diagnostico.',
        blocos: linhas,
      });

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="radar-organizacional-${periodo.replace(/s/g, '_')}.pdf"`)
        .send(pdf);
    } catch (erro: any) {
      // Falha de validacao: deixa o handler global responder 400 com o detalhe.
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao exportar relatorio do Radar');
      return reply.status(500).send({ error: 'Não foi possível gerar o relatório.' });
    }
  });  // ═════════════════════════════════════════════════════════════════════
  // IA DO RADAR
  //
  // O modelo de linguagem NÃO recebe os dados: ele recebe um RESUMO já
  // filtrado pela empresa e pelas permissões, e é instruído a só afirmar o
  // que está nesse resumo. Sem dado no resumo, ele tem de dizer que não sabe.
  //
  // Por que não passamos o JSON bruto: o modelo veria employees de empresas
  // que o usuário não pode ver se o filtro fosse feito depois. O filtro é
  // feito AQUI, antes, e é o mesmo `montarResumo` que a tela usa.  // ═════════════════════════════════════════════════════════════════════
  const iaSchema = z.object({
    pergunta: z.string().min(3).max(1000),
    periodoInicio: z.string().optional(),
    periodoFim: z.string().optional(),
  });

  app.post('/ia', { preHandler: [(app as any).authenticate, permissaoMiddleware('rh', 'visualizar'), iaLimiter] }, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = iaSchema.parse(req.body ?? {});
      const janela = resolverJanela(b.periodoInicio, b.periodoFim);
      const resumo = await montarResumo(empresaId, janela);

      if (resumo.headcount === 0 && resumo.coleta.pontos.length === 0) {
        return reply.send({
          resposta: 'Dados insuficientes para análise: não há funcionários no quadro nem batidas de ponto no período selecionado. Sem esses dados não é possível responder a pergunta.',
          semBase: true,
          fontes: [],
        });
      }

      // Contexto: SOMENTE fatos observados da empresa do usuário.
      const topExtras = [...resumo.resumos]
        .filter((r) => r.horasExtrasMin > 0)
        .sort((a, b) => b.extrasMediaDiaMin - a.extrasMediaDiaMin)
        .slice(0, 5)
        .map((r) => `${r.nome} (${r.setor}): ${Math.round(r.extrasMediaDiaMin)} min/dia de extras, ${r.faltas} faltas, risco ${riscoDePessoa(r, resumo.diasUteis)}%`);

      const contexto = {
        periodo: `${chaveDia(janela.inicio)} a ${chaveDia(janela.fim)}`,
        diasUteis: resumo.diasUteis,
        quadro: resumo.headcount,
        kpis: resumo.kpis,
        sinais: resumo.sinais,
        comercial: resumo.comercial,
        areasComMaiorRisco: resumo.areasRisco.slice(0, 5).map((a) => `${a.area}: risco ${a.risco}% em ${a.tamanho} pessoa(s)`),
        pessoasComMaiorCarga: topExtras,
        rupturas: resumo.coleta.rupturas.slice(0, 5).map((r) => `${r.produto} (${r.filial}): ${r.quantidade}/${r.minimo}`),
        metasCriticas: resumo.coleta.metas
          .filter((m) => m.metaValor > 0 && (m.realizado / m.metaValor) * 100 < 70)
          .slice(0, 5)
          .map((m) => `${m.tipo} ${m.periodo}: ${Math.round((m.realizado / m.metaValor) * 100)}% da meta`),
        indicadoresSemDado: montarFaltando(resumo).map((f) => f.campo),
      };

      const instrucao = [
        'Você é o assistente do Radar Organizacional do NEXUS OS.',
        'Responda APENAS com base no contexto JSON fornecido. É o único dado que você pode ver.',
        'Se a resposta não estiver no contexto, diga exatamente que não há informação suficiente. NUNCA invente número, causa ou conclusão.',
        'Descreva SINAIS observados, nunca diagnostique doença, burnout, transtorno ou condição de saúde.',
        'Nunca recomende decisão automática sobre pessoa; oriente a análise do gestor/RH.',
        'Seja direto, em português do Brasil, usando números do contexto.',
      ].join(' —');

      const { consultarIA } = await import('../ia/ia.service.js');
      const chamada = await consultarIA(
        `Contexto:n${JSON.stringify(contexto)}nnPergunta: ${b.pergunta}`,
        { papel: instrucao, temperatura: 0.3, maxTokens: 700 },
      );

      if (!chamada.ok) {
        // Sem chave ou modelo fora: dizemos que não deu, e devolvemos o
        // contexto para o gestor não ficar sem nenhuma informação.
        return reply.send({
          resposta: `Não consegui consultar o modelo agora (${chamada.motivo}). O que o Radar tem de fato para o período:`,
          semBase: false,
          modeloIndisponivel: true,
          contextoUsado: contexto,
        });
      }

      return reply.send({ resposta: chamada.texto, semBase: false, contextoUsado: contexto });
    } catch (erro: any) {
      // Falha de validacao: deixa o handler global responder 400 com o detalhe.
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha na IA do Radar');
      return reply.status(500).send({ error: 'Não foi possível consultar a IA do Radar.' });
    }
  });  // ═════════════════════════════════════════════════════════════════════
  // ESCRITA — tudo que o gestor produz a partir do Radar
  //
  // São exatamente as ações que antes mostravam um toast de sucesso sem
  // gravar nada. Agora persistem, e todos exigem `rh:editar` + empresa do
  // usuário no filtro — escrever para outra empresa não é possível.  // ═════════════════════════════════════════════════════════════════════

  /** Plano de ação a partir de um alerta. */
  const planoSchema = z.object({
    alertaRef: z.string().min(1),
    alertaTitulo: z.string().min(1),
    funcionarioId: z.string().optional().nullable(),
    acoes: z.array(z.object({ texto: z.string().min(1), concluida: z.boolean() })).min(1),
    responsavelId: z.string().optional().nullable(),
    prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    observacoes: z.string().max(2000).optional().nullable(),
  });

  app.post('/acoes', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = planoSchema.parse(req.body ?? {});

      // O funcionário precisa ser DESTA empresa — valida antes de gravar.
      if (b.funcionarioId) {
        const f = await prisma.funcionario.findFirst({ where: { id: b.funcionarioId, empresaId }, select: { id: true } });
        if (!f) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });
      }

      const acao = await prisma.acaoRadar.create({
        data: {
          empresaId,
          alertaRef: b.alertaRef,
          alertaTitulo: b.alertaTitulo,
          funcionarioId: b.funcionarioId ?? null,
          responsavelId: b.responsavelId ?? req.user?.id ?? null,
          acoes: b.acoes as any,
          prazo: b.prazo ? new Date(`${b.prazo}T12:00:00`) : null,
          observacoes: b.observacoes ?? null,
          status: 'ABERTA',
        },
      });

      await registrarAuditoria({
        usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'AcaoRadar',
        entidadeId: acao.id, valorNovo: { alertaRef: b.alertaRef, acoes: b.acoes.length },
        origem: 'MANUAL', ip: req.ip, contexto: 'Plano de ação do Radar Organizacional',
      });

      return reply.status(201).send({
        id: acao.id,
        status: acao.status,
        acoes: acao.acoes,
        criadoEm: acao.createdAt,
      });
    } catch (erro: any) {
      // Falha de validacao: deixa o handler global responder 400 com o detalhe.
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao criar plano de ação');
      return reply.status(500).send({ error: 'Não foi possível salvar o plano de ação.' });
    }
  });

  /** Atualiza o status de um plano (concluir, cancelar). */
  const statusPlanoSchema = z.object({
    status: z.enum(['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA']),
    acoes: z.array(z.object({ texto: z.string().min(1), concluida: z.boolean() })).optional(),
    /**
     * Prazo no mesmo formato de `POST /acoes` (AAAA-MM-DD), opcional.
     *
     * O schema NÃO aceitava prazo, mas a tela mostra o campo "Prazo" no modo
     * de EDIÇÃO e o gestor podia alterá-lo: o PATCH recebia só `status` e
     * `acoes`, devolvia 200 e a data digitada era descartada em silêncio — o
     * plano ficava gravado com um prazo diferente do que o gestor informava.
     * `undefined` significa "não mexeu no prazo" (PATCH preserva o valor).
     */
    prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  });

  app.patch('/acoes/:id', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = statusPlanoSchema.parse(req.body ?? {});
      const atual = await prisma.acaoRadar.findFirst({ where: { id: req.params.id, empresaId }, select: { id: true } });
      if (!atual) return reply.status(404).send({ error: 'Plano de ação não encontrado.' });

      // Mesmo tratamento do POST: meio-dia evita que o fuso empurre a data para
      // o dia anterior (o mesmo motivo do `T12:00:00` nos outros pontos do RH).
      const prazo = b.prazo ? new Date(`${b.prazo}T12:00:00`) : null;

      const acao = await prisma.acaoRadar.update({
        where: { id: atual.id },
        data: {
          status: b.status,
          ...(b.acoes ? { acoes: b.acoes as any } : {}),
          // Só sobrescreve quando o cliente mandou algo — inclusive string vazia,
          // que significa "remover o prazo". Ausente = preserva.
          ...(b.prazo !== undefined ? { prazo } : {}),
        },
      });
      return reply.send({ id: acao.id, status: acao.status, acoes: acao.acoes, prazo: acao.prazo ? chaveDiaSql(acao.prazo) : null });
    } catch (erro: any) {
      // Falha de validacao: deixa o handler global responder 400 com o detalhe.
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao atualizar plano de ação');
      return reply.status(500).send({ error: 'Não foi possível atualizar o plano de ação.' });
    }
  });


  /**
   * POST /radar/avaliacoes — o RH registra perfil comportamental.
   *
   * ── É a fonte que faltava para a aba DISC. O Radar NÃO deduz perfil a partir de
   * ponto, vendas ou ausência: perfil comportamental é avaliação humana, e
   * inferir isso automaticamente seria exatamente o "diagnóstico automático"
   * que o prompt proíbe.
   */
  // ══════════════════════════════════════════════════════════════════════
  // QUESTIONÁRIO DISC
  // ══════════════════════════════════════════════════════════════════════

  /**
   * GET /radar/disc/questionario
   *
   * Entrega as perguntas e as alternativas. O campo `fator` NÃO vai na resposta:
   * ver `AlternativaDisc` em `radar.disc.ts`. O front recebe `{ id, texto }` de
   * cada alternativa e é proibido expor qual fator ela alimenta — o respondente
   * escolheria a alternativa que o resultado favorece, e a avaliação deixaria de
   * medir o comportamento.
   */
  /**
   * GET /radar/disc/funcionarios
   *
   * Lista MÍNIMA para o seletor do questionário DISC: id, nome e departamento.
   *
   * Existe para não obrigar quem tem `relatorios` (e não `rh`) a chamar
   * `GET /funcionarios`, que devolve o cadastro inteiro — cargo, salário,
   * admissionista, dados de contato. Para escolher em quem aplicar o
   * questionário, o nome já basta; expor o resto seria dar acesso a dado
   * pessoal que a tela não usa.
   *
   * `departamento` é relação opcional no schema, então vem aninhado em
   * `departamento: { nome }`.
   */
  app.get('/disc/funcionarios', discLeitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const lista = await prisma.funcionario.findMany({
        where: { empresaId },
        select: { id: true, nome: true, departamento: { select: { nome: true } } },
        orderBy: { nome: 'asc' },
      });
      return reply.send(
        lista.map((f) => ({
          id: f.id,
          nome: f.nome,
          departamento: f.departamento?.nome ?? null,
        })),
      );
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao listar funcionários para o DISC');
      return reply.status(500).send({ error: 'Não foi possível carregar a lista de funcionários.' });
    }
  });

  app.get('/disc/questionario', discLeitura, async (req: any, reply) => {
    try {
      return reply.send({
        total: TOTAL_PERGUNTAS_DISC,
        fatores: FATORES_DISC.map((f) => ({ fator: f, nome: NOMES_FATOR[f], descricao: DESCRICAO_FATOR[f] })),
        perguntas: QUESTIONARIO_DISC.map((p) => ({
          id: p.id,
          texto: p.texto,
          // Só id e texto: o mapeamento alternativa → fator é interno.
          alternativas: p.alternativas.map((a) => ({ id: a.id, texto: a.texto })),
        })),
        regras: [
          'Responda escolhendo a alternativa que melhor descreve você, não a que parece correta.',
          'Não existe resposta certa ou errada.',
          'Este questionário não mede desempenho, capacidade nem adequação a cargo.',
        ],
        aviso: 'O resultado descreve o estilo de comportamento observado nas respostas. Não é diagnóstico psicológico e não deve ser usado isoladamente para decisão sobre a pessoa.',
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao servir o questionário DISC');
      return reply.status(500).send({ error: 'Não foi possível carregar o questionário.' });
    }
  });

  /**
   * POST /radar/disc/calcular
   *
   * Pré-visualização: calcula D/I/S/C a partir das respostas SEM gravar. Serve ao
   * passo de confirmação do formulário e permite conferir a soma antes de
   * confirmar.
   */
  const discCalculoSchema = z.object({
    respostas: z.array(z.object({
      perguntaId: z.string().min(1),
      alternativaId: z.string().min(1),
    })).min(1, 'Responda ao menos uma pergunta.'),
  });

  app.post('/disc/calcular', discLeitura, async (req: any, reply) => {
    try {
      const b = discCalculoSchema.parse(req.body ?? {});
      const resultado = calcularDisc(b.respostas);
      return reply.send({ resultado, completo: resultado.answered === resultado.total });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao calcular o DISC');
      return reply.status(500).send({ error: 'Não foi possível calcular o resultado.' });
    }
  });

  /**
   * POST /radar/disc/avaliar
   *
   * Grava a avaliação. Recebe as RESPOSTAS — nunca percentuais. O D/I/S/C é
   * calculado aqui, no servidor: se o front mandasse os números, um cliente
   * adulterado registraria um perfil que ninguém respondeu.
   *
   * Recusa avaliação incompleta: resultado parcial não é resultado.
   */
  const discAvaliacaoSchema = z.object({
    funcionarioId: z.string().min(1),
    respostas: z.array(z.object({
      perguntaId: z.string().min(1),
      alternativaId: z.string().min(1),
    })).min(1, 'Responda ao menos uma pergunta.'),
    observacoes: z.string().max(2000).optional().nullable(),
    /**
     * Opcional de propósito. O frontend NÃO envia a data: ela vem do relógio do
     * navegador, e um usuário em fuso diferente do servidor gravaria a
     * avaliação em "ontem" ou "amanhã" — errando a vigência, que é justamente o
     * que decide o perfil que o Radar mostra. O servidor é a única fonte da
     * data quando ela não é informada explicitamente.
     */
    dataAvaliacao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });

  app.post('/disc/avaliar', discEscrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = discAvaliacaoSchema.parse(req.body ?? {});
      const func = await prisma.funcionario.findFirst({
        where: { id: b.funcionarioId, empresaId },
        select: { id: true, nome: true },
      });
      if (!func) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });

      const resultado = calcularDisc(b.respostas);
      if (resultado.answered < resultado.total) {
        return reply.status(400).send({
          error: `Avaliação incompleta: ${resultado.answered} de ${resultado.total} perguntas respondidas.`,
          pendentes: QUESTIONARIO_DISC
            .filter((p) => !b.respostas.some((r) => r.perguntaId === p.id))
            .map((p) => p.id),
        });
      }

      /**
       * Data da avaliação.
       *
       * Sem `dataAvaliacao` no corpo, usa a data do SERVIDOR. O frontend
       * deliberadamente não manda a data: ela vinha do relógio do navegador, e
       * um usuário em outro fuso gravava a avaliação no dia errado — e como a
       * vigência é decidida pela data, o Radar passaria a exibir o perfil de um
       * dia que não existe.
       *
       * Quando a data É informada (lançamento retroativo, feito pelo RH), ela
       * não pode estar no futuro: uma avaliação de amanhã não foi aplicada, e
       * aceitá-la colocaria o registro à frente de qualquer avaliação real na
       * regra de vigência, bloqueando as próximas por um período inteiro.
       */
      const hoje = new Date();
      const chaveHoje = `${hoje.getUTCFullYear()}-${pad2(hoje.getUTCMonth() + 1)}-${pad2(hoje.getUTCDate())}`;
      const dataInformada = b.dataAvaliacao ?? chaveHoje;
      if (dataInformada > chaveHoje) {
        return reply.status(400).send({
          error: `Não é possível registrar uma avaliação com data futura (${dataInformada}).`,
        });
      }
      const dataAval = new Date(`${dataInformada}T12:00:00`);

      // A vigência (uma única, a de data mais recente) é do helper.
      const salva = await gravarAvaliacaoComVigencia(empresaId, b.funcionarioId, {
        empresaId,
        funcionarioId: b.funcionarioId,
        perfil: resultado.predominante,
        // `scores` guarda o resultado e as respostas. O JSON já é o campo
        // previsto no schema ("Scores brutos por eixo"), então nenhuma coluna
        // nova foi criada.
        scores: {
          D: resultado.D, I: resultado.I, S: resultado.S, C: resultado.C,
          pontos: resultado.pontos,
          respostas: b.respostas,
          metodo: 'forced-choice-12',
        } as any,
        observacoes: b.observacoes ?? null,
        aplicadoPorId: req.user?.id ?? null,
        dataAvaliacao: dataAval,
        origem: 'MANUAL',
      });

      await registrarAuditoria({
        usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'AvaliacaoComportamental',
        entidadeId: salva.id,
        valorNovo: {
          funcionarioId: b.funcionarioId, perfil: resultado.predominante,
          scores: { D: resultado.D, I: resultado.I, S: resultado.S, C: resultado.C },
        },
        origem: 'MANUAL', ip: req.ip,
        contexto: `Avaliação DISC (${resultado.answered}/${resultado.total} perguntas) aplicada a ${func.nome}`,
      });

      return reply.status(201).send({
        id: salva.id,
        funcionarioId: b.funcionarioId,
        perfil: resultado.predominante,
        resultado: { D: resultado.D, I: resultado.I, S: resultado.S, C: resultado.C },
        pontos: resultado.pontos,
        dataAvaliacao: dataInformada,
        // Falso quando a avaliação é retroativa: ela entra no histórico, mas a
        // que continua valendo no Radar é a de data mais recente. A tela mostra
        // isso para o usuário não achar que o registro não salvou.
        vigente: salva.id === salva.vigenteId,
        vigenteId: salva.vigenteId,
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao registrar a avaliação DISC');
      return reply.status(500).send({ error: 'Não foi possível registrar a avaliação.' });
    }
  });

  /**
   * GET /radar/disc/historico?funcionarioId=...
   *
   * Avaliações anteriores, mais recente primeiro. A vigência é derivada da
   * ordem (a última é a vigente) e não de um campo solto: é a MESMA regra que a
   * gravação aplica, então a lista e o Radar nunca discordam.
   */
  app.get('/disc/historico', discLeitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const funcionarioId = z.string().min(1).parse(req.query?.funcionarioId);
      const func = await prisma.funcionario.findFirst({
        where: { id: funcionarioId, empresaId },
        select: { id: true, nome: true },
      });
      if (!func) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });

      const avaliacoes = await prisma.avaliacaoComportamental.findMany({
        where: { empresaId, funcionarioId },
        orderBy: [{ dataAvaliacao: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true, perfil: true, scores: true, observacoes: true,
          dataAvaliacao: true, createdAt: true, aplicadoPorId: true, vigente: true,
        },
      });

      // `aplicadoPorId` é uma coluna sem relação declarada no schema (o padrão
      // do projeto), então o nome de quem aplicou é resolvido numa consulta ao
      // `Usuario` — o mesmo padrão de `vendas.routes.ts` para o vendedor.
      const aplicados = await prisma.usuario.findMany({
        where: { id: { in: avaliacoes.map((a) => a.aplicadoPorId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, nome: true },
      });
      const nomeDe = new Map(aplicados.map((u) => [u.id, u.nome]));

      /**
       * `vigente` vem do BANCO, não da posição na lista. A posição diria "a
       * primeira da ordenação é a vigente", mas o que o Radar lê é justamente
       * esse campo: se as duas fontes divergirem, a tela e o Radar discordam.
       * Aqui mostramos os dois para deixar a divergência visível.
       */
      return reply.send({
        funcionario: { id: func.id, nome: func.nome },
        total: avaliacoes.length,
        avaliacoes: avaliacoes.map((a) => ({
          id: a.id,
          perfil: a.perfil,
          scores: a.scores,
          observacoes: a.observacoes,
          dataAvaliacao: chaveDiaSql(a.dataAvaliacao),
          aplicadoPor: a.aplicadoPorId ? nomeDe.get(a.aplicadoPorId) ?? null : null,
          vigente: a.vigente,
        })),
      });
    } catch (erro: any) {
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao ler o histórico DISC');
      return reply.status(500).send({ error: 'Não foi possível ler o histórico.' });
    }
  });

  const avaliacaoSchema = z.object({
    funcionarioId: z.string().min(1),
    perfil: z.enum(['D', 'I', 'S', 'C']).nullable(),
    scores: z.record(z.string(), z.number().int().min(0).max(100)).nullable().optional(),
    observacoes: z.string().max(2000).optional().nullable(),
    dataAvaliacao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });

  app.post('/avaliacoes', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = avaliacaoSchema.parse(req.body ?? {});
      const func = await prisma.funcionario.findFirst({ where: { id: b.funcionarioId, empresaId }, select: { id: true } });
      if (!func) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });

      /**
       * Lançamento manual de perfil e scores.
       *
       * O caminho preferencial é `POST /radar/disc/avaliar`, que recebe as
       * RESPOSTAS e calcula no servidor. Esta rota existe para o caso em que o
       * RH registra um perfil de outra fonte (entrevista com fornecedor,
       * avaliação externa já concluída) e por isso aceita `perfil` e `scores`
       * prontos.
       *
       * A vigência segue a MESMA regra do questionário — vence a avaliação de
       * data mais recente — para que o Radar não troque de perfil dependendo de
       * qual endpoint foi usado.
       */
      const dataAvalManual = new Date(`${b.dataAvaliacao}T12:00:00`);

      const salva = await gravarAvaliacaoComVigencia(empresaId, b.funcionarioId, {
        empresaId,
        funcionarioId: b.funcionarioId,
        perfil: b.perfil,
        scores: (b.scores ?? null) as any,
        observacoes: b.observacoes ?? null,
        aplicadoPorId: req.user?.id ?? null,
        dataAvaliacao: dataAvalManual,
        origem: 'MANUAL',
      });

      // Perfil comportamental é dado sensível: fica registrado quem aplicou.
      await registrarAuditoria({
        usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'AvaliacaoComportamental',
        entidadeId: salva.id, valorNovo: { funcionarioId: b.funcionarioId, perfil: b.perfil },
        origem: 'MANUAL', ip: req.ip, contexto: 'Avaliação comportamental registrada pelo RH',
      });

      return reply.status(201).send({ id: salva.id, perfil: b.perfil, vigente: salva.id === salva.vigenteId });
    } catch (erro: any) {
      // Falha de validacao: deixa o handler global responder 400 com o detalhe.
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao registrar avaliação comportamental');
      return reply.status(500).send({ error: 'Não foi possível registrar a avaliação.' });
    }
  });

  /** POST /radar/bem-estar — pesquisa registrada pelo RH. */
  const bemEstarSchema = z.object({
    funcionarioId: z.string().min(1),
    /**
     * ESCALA OFICIAL DE BEM-ESTAR: 0–100.
     *
     * O schema declara `nota Int` com comentário "0-100" e é o que `saudeMedia`
     * e `riscoMatriz` (frontend) esperam. Havia histórico em escala 1–5 na mesma
     * coluna, e misturar as duas produz uma diferença absurda: uma nota 4
     * (escala curta) lida como 4% de bem-estar colocaria a pessoa no pior
     * patamar, e uma média entre 4 e 72 não tem significado nenhum.
     *
     * A conversão dos registros antigos é decisão da empresa e não é feita aqui
     * por inferência. O que o módulo garante é o CONTRATO daqui para frente:
     *  - o backend só aceita e devolve 0–100;
     *  - valor fora da escala é REJEITADO, não convertido em silêncio.
     */
    nota: z.coerce.number().int().min(0).max(100, 'A nota de bem-estar vai de 0 a 100.'),
    resposta: z.string().max(2000).optional().nullable(),
    dataPesquisa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });

  app.post('/bem-estar', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = bemEstarSchema.parse(req.body ?? {});
      const func = await prisma.funcionario.findFirst({ where: { id: b.funcionarioId, empresaId }, select: { id: true } });
      if (!func) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });

      const nova = await prisma.pesquisaBemEstar.create({
        data: {
          empresaId,
          funcionarioId: b.funcionarioId,
          nota: b.nota,
          resposta: b.resposta ?? null,
          dataPesquisa: new Date(`${b.dataPesquisa}T12:00:00`),
          aplicadoPorId: req.user?.id ?? null,
        },
      });

      await registrarAuditoria({
        usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'PesquisaBemEstar',
        entidadeId: nova.id, valorNovo: { funcionarioId: b.funcionarioId, nota: b.nota },
        origem: 'MANUAL', ip: req.ip, contexto: 'Pesquisa de bem-estar registrada pelo RH',
      });

      return reply.status(201).send({ id: nova.id, nota: nova.nota });
    } catch (erro: any) {
      // Falha de validacao: deixa o handler global responder 400 com o detalhe.
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao registrar pesquisa de bem-estar');
      return reply.status(500).send({ error: 'Não foi possível registrar a pesquisa.' });
    }
  });


  /**
   * Gamificação — pontos derivados de FATO real, com regra registrada.
   *
   * O placar não é digitado: nasce de um evento que aconteceu (ponto sem
   * atraso, venda finalizada, meta batida) e guarda qual regra o produziu,
   * para que o número seja auditável. Toggle de regra deixa de ser
   * localStorage e vira configuração persistida.
   */
  const registroGamSchema = z.object({
    funcionarioId: z.string().min(1).optional().nullable(),
    tipo: z.enum(['meta', 'objetivo', 'conquista', 'reconhecimento']),
    descricao: z.string().min(1).max(300),
    pontos: z.coerce.number().int().min(-1000).max(1000),
    regraId: z.string().max(80).optional().nullable(),
    eventoOrigem: z.string().max(80).optional().nullable(),
    eventoId: z.string().max(80).optional().nullable(),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });

  app.post('/gamificacao', escrita, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const b = registroGamSchema.parse(req.body ?? {});
      if (b.funcionarioId) {
        const f = await prisma.funcionario.findFirst({ where: { id: b.funcionarioId, empresaId }, select: { id: true } });
        if (!f) return reply.status(404).send({ error: 'Funcionário não encontrado nesta empresa.' });
      }

      /**
       * IDEMPOTÊNCIA.
       *
       * O placar precisa ser auditável: cada ponto aponta para o fato que o
       * produziu (`regraId` + `eventoOrigem` + `eventoId`). Sem trava, o mesmo
       * evento reprocessado — um job que roda duas vezes, um retry de rede, o
       * gestor clicando duas vezes — somaria o mesmo ponto de novo e inflaria o
       * ranking sem que nada tenha acontecido na empresa.
       *
       * A chave é `empresaId + eventoOrigem + eventoId`. Quando o chamador
       * manda `eventoId`, o registro é único por definição: se já existe e está
       * ATIVO, devolvemos o existente com 200 em vez de 201, e a tela pode
       * tratar as duas respostas igual (o evento já foi pontuado).
       *
       * Sem `eventoId` não há chave: o chamador não disse a que fato o ponto se
       * refere, e um lançamento manual legítimo pode ser repetido. Exigir
       * `eventoId` mudaria o contrato de um lançamento manual legítimo.
       */
      if (b.eventoOrigem && b.eventoId) {
        const jaExiste = await prisma.registroGamificacao.findFirst({
          where: { empresaId, eventoOrigem: b.eventoOrigem, eventoId: b.eventoId, status: 'ATIVO' },
          select: { id: true, pontos: true, data: true },
        });
        if (jaExiste) {
          return reply.send({
            id: jaExiste.id,
            pontos: jaExiste.pontos,
            data: jaExiste.data,
            duplicado: true,
          });
        }
      }

      const reg = await prisma.registroGamificacao.create({
        data: {
          empresaId,
          funcionarioId: b.funcionarioId ?? null,
          tipo: b.tipo,
          descricao: b.descricao,
          pontos: b.pontos,
          regraId: b.regraId ?? null,
          eventoOrigem: b.eventoOrigem ?? null,
          eventoId: b.eventoId ?? null,
          data: new Date(`${b.data}T12:00:00`),
          status: 'ATIVO',
        },
      });
      return reply.status(201).send({ id: reg.id, pontos: reg.pontos, data: reg.data, duplicado: false });
    } catch (erro: any) {
      // Falha de validacao: deixa o handler global responder 400 com o detalhe.
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao registrar pontuação');
      return reply.status(500).send({ error: 'Não foi possível registrar a pontuação.' });
    }
  });

  /** Placar por equipe/setor — é o que a aba Gamificação mostra. */
  app.get('/gamificacao', leitura, async (req: any, reply) => {
    try {
      const empresaId = empresaDoRequisicao(req);
      const registros = await prisma.registroGamificacao.findMany({
        where: { empresaId, status: 'ATIVO' },
        select: {
          id: true, funcionarioId: true, tipo: true, descricao: true,
          pontos: true, regraId: true, data: true,
        },
        orderBy: { data: 'desc' },
        take: 300,
      });
      const porSetor = new Map<string, number>();
      for (const r of registros) {
        if (!r.funcionarioId) continue;
        const f = await prisma.funcionario.findFirst({
          where: { id: r.funcionarioId, empresaId },
          select: { departamento: { select: { nome: true } } },
        });
        const setor = f?.departamento?.nome ?? 'Sem departamento';
        porSetor.set(setor, (porSetor.get(setor) ?? 0) + r.pontos);
      }
      return reply.send({
        registros: registros.map((r) => ({ ...r, data: chaveDiaSql(r.data) })),
        totalPontos: registros.reduce((s, r) => s + r.pontos, 0),
        porSetor: [...porSetor.entries()].map(([setor, pontos]) => ({ setor, pontos })),
      });
    } catch (erro: any) {
      // Falha de validacao: deixa o handler global responder 400 com o detalhe.
      if (erro instanceof z.ZodError) throw erro;
      req.log.error(erro, 'Falha ao ler gamificação');
      return reply.status(500).send({ error: 'Não foi possível ler a pontuação.' });
    }
  });
}

