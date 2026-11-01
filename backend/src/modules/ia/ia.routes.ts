import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { createRateLimiter } from '../../middlewares/rateLimiter.js';
import { consultarIA } from './ia.service.js';
import { ErroDeNegocio } from '../../lib/erros.js';

/* ========================================================================= *
 * Motor SE/ENTÃO — regras cadastradas da aba Alertas (Seção 29)
 *
 * Correção de comportamento simulado: POST /automacao/executar rodava cinco
 * verificações fixas e NUNCA lia a tabela RegraAutomacao. A regra criada na
 * tela era só um registro de catálogo — `condicao.param` e a severidade
 * escolhidas não influenciavam nada e a ação `notificar_gestor` nunca gerava
 * notificação. As funções deste bloco executam de fato as regras ativas; o
 * handler as chama ANTES das verificações fixas, para que quando os dois
 * enxergarem o mesmo fato o alerta nasça com a severidade que o usuário
 * escolheu e a checagem fixa apenas deduplique em cima dele.
 * ========================================================================= */

/** Subconjunto do enum TipoAlerta que este motor sabe gerar. */
type TipoAlertaLocal =
  | 'ESTOQUE_BAIXO'
  | 'ESTOQUE_ZERADO'
  | 'VALIDADE'
  | 'META_BAIXA'
  | 'DESPESA_ALTA'
  | 'COMPRA_PENDENTE';

type Prioridade = 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA';

const PRIORIDADES_VALIDAS: Prioridade[] = ['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'];
const PESO_PRIORIDADE: Record<Prioridade, number> = { BAIXA: 0, MEDIA: 1, ALTA: 2, CRITICA: 3 };

/** As cinco condições do construtor -> tipo real do enum TipoAlerta. */
const TIPO_DA_CONDICAO: Record<string, TipoAlertaLocal> = {
  estoque_min: 'ESTOQUE_BAIXO', // com saldo 0 o alerta vira ESTOQUE_ZERADO
  validade: 'VALIDADE',
  meta_70: 'META_BAIXA',
  despesa_up: 'DESPESA_ALTA',
  compra_parada: 'COMPRA_PENDENTE',
};

/** Link canônico da aba de destino — nada de link quebrado na notificação. */
const LINK_DA_ENTIDADE: Record<string, string> = {
  Produto: '/produtos',
  Meta: '/metas',
  Compra: '/compras',
};

interface RegraLida {
  se: string;
  param: number;
  tipo: TipoAlertaLocal;
  severidade: Prioridade;
}

/**
 * Lê a coluna `condicao` (JSON gravado pelo modal). Texto livre legado ou JSON
 * fora do formato devolve `null`: a regra é pulada e contada como ignorada,
 * jamais derruba a execução do motor por causa de um registro antigo.
 */
function lerCondicaoDaRegra(condicao: string): RegraLida | null {
  let dados: { se?: unknown; param?: unknown; severidade?: unknown };
  try {
    dados = JSON.parse(condicao);
  } catch {
    return null;
  }
  if (!dados || typeof dados !== 'object') return null;
  const se = typeof dados.se === 'string' ? dados.se : '';
  const tipo = TIPO_DA_CONDICAO[se];
  if (!tipo) return null;
  const param = Number(dados.param);
  if (!Number.isFinite(param) || param < 0) return null;
  const bruto = typeof dados.severidade === 'string' ? dados.severidade.toUpperCase() : 'ALTA';
  const severidade = PRIORIDADES_VALIDAS.find((p) => p === bruto) ?? 'ALTA';
  return { se, param, tipo, severidade };
}

/** Lê a coluna `acao` (JSON array de ids). Texto livre legado vira item único. */
function lerAcoesDaRegra(acao: string): string[] {
  if (!acao) return [];
  try {
    const ids = JSON.parse(acao);
    if (Array.isArray(ids)) return ids.map((id) => String(id));
  } catch {
    // legado em texto livre — tratado abaixo
  }
  return [acao];
}

/**
 * Severidade efetiva do alerta: a escolhida no modal, elevada a ALTA quando a
 * ação `alerta_critico` está marcada. Nenhuma ação ABAIXA a severidade.
 */
function prioridadeDaRegra(severidade: Prioridade, acoes: string[]): Prioridade {
  if (acoes.includes('alerta_critico') && PESO_PRIORIDADE.ALTA > PESO_PRIORIDADE[severidade]) {
    return 'ALTA';
  }
  return severidade;
}

/**
 * Valida o corpo de POST /automacao/regras. Antes, o `req.body as any` ia
 * direto para o Prisma: payload sem nome (ou com nome não-string) virava
 * PrismaClientValidationError e o gestor recebia HTTP 500 sem entender nada.
 */
function validarCorpoDeRegra(body: unknown): { nome: string; condicao: string; acao: string } {
  const bruto = (body ?? {}) as Record<string, unknown>;
  const nome = typeof bruto.nome === 'string' ? bruto.nome.trim() : '';
  const condicao = typeof bruto.condicao === 'string' ? bruto.condicao.trim() : '';
  const acao = typeof bruto.acao === 'string' ? bruto.acao.trim() : '';

  if (nome.length < 3) {
    throw new ErroDeNegocio('Dê um nome com pelo menos 3 caracteres para a regra.');
  }
  if (nome.length > 120) throw new ErroDeNegocio('Nome da regra pode ter no máximo 120 caracteres.');
  if (!condicao) throw new ErroDeNegocio('A condição da regra (SE) é obrigatória.');
  if (condicao.length > 2000) {
    throw new ErroDeNegocio('Condição muito longa (máximo 2000 caracteres).');
  }
  if (!acao) throw new ErroDeNegocio('A ação da regra (ENTÃO) é obrigatória.');
  if (acao.length > 2000) throw new ErroDeNegocio('Ação muito longa (máximo 2000 caracteres).');
  // Uma regra que o motor não sabe ler seria um botão que "cria" mas não faz
  // nada — recusamos na origem, com mensagem que o próprio modal entende.
  if (!lerCondicaoDaRegra(condicao)) {
    throw new ErroDeNegocio(
      'Condição fora do formato aceito. Use uma das cinco condições do construtor SE/ENTÃO, com parâmetro numérico.',
    );
  }
  if (lerAcoesDaRegra(acao).length === 0) {
    throw new ErroDeNegocio('Selecione ao menos uma ação em ENTÃO.');
  }
  return { nome, condicao, acao };
}

/**
 * Executa as regras ativas da empresa.
 *
 * Devolve as regras efetivamente avaliadas, quantas ficaram ignoradas por
 * formato legado e os alertas criados — cada um com notificação quando a ação
 * `notificar_gestor` está marcada. A deduplicação é a mesma das verificações
 * fixas: no máximo um alerta ABERTO por (tipo, entidade, entidadeId), ou por
 * dia no caso de DESPESA_ALTA, então rodar o motor duas vezes nunca duplica.
 */
async function executarRegrasCadastradas(empresaId: string): Promise<{
  regrasExecutadas: number;
  regrasIgnoradas: number;
  alertas: any[];
}> {
  const regras = await prisma.regraAutomacao.findMany({
    where: { empresaId, ativa: true },
    orderBy: { createdAt: 'asc' },
  });

  const regrasValidas: Array<{ regra: (typeof regras)[number]; cond: RegraLida }> = [];
  let regrasIgnoradas = 0;
  for (const regra of regras) {
    const cond = lerCondicaoDaRegra(regra.condicao);
    if (cond) regrasValidas.push({ regra, cond });
    else regrasIgnoradas += 1;
  }

  const alertasCriados: any[] = [];
  if (regrasValidas.length === 0) {
    return { regrasExecutadas: 0, regrasIgnoradas, alertas: alertasCriados };
  }

  const agora = new Date();
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);

  const seAtivas = new Set(regrasValidas.map((item) => item.cond.se));

  // Dados consultados só quando alguma regra os usa — mesmo critério das
  // verificações fixas, para as duas rodadas enxergarem o mesmo mundo.
  const estoques =
    seAtivas.has('estoque_min') || seAtivas.has('validade')
      ? await prisma.estoque.findMany({ where: { empresaId }, include: { produto: true, filial: true } })
      : [];
  const metas = seAtivas.has('meta_70') ? await prisma.meta.findMany({ where: { empresaId } }) : [];

  let totalDespesasHoje = 0;
  let media7dias = 0;
  if (seAtivas.has('despesa_up')) {
    const despesasHoje = await prisma.financeiro.findMany({
      where: { empresaId, tipo: 'DESPESA', createdAt: { gte: hoje } },
    });
    const despesas7dias = await prisma.financeiro.findMany({
      where: { empresaId, tipo: 'DESPESA', createdAt: { gte: seteDiasAtras, lt: hoje } },
    });
    totalDespesasHoje = despesasHoje.reduce((s, f) => s + Number(f.valor), 0);
    const diasComDados = new Set(
      despesas7dias.map((f) => new Date(f.createdAt).toISOString().slice(0, 10)),
    ).size;
    media7dias = diasComDados
      ? despesas7dias.reduce((s, f) => s + Number(f.valor), 0) / diasComDados
      : 0;
  }

  const compras = seAtivas.has('compra_parada')
    ? await prisma.compra.findMany({
        where: { empresaId, status: { in: ['SOLICITADA', 'PEDIDO'] } },
        include: { fornecedor: true, filial: true },
      })
    : [];

  interface Candidato {
    tipo: TipoAlertaLocal;
    titulo: string;
    descricao: string;
    entidade?: string;
    entidadeId?: string;
  }

  for (const { regra, cond } of regrasValidas) {
    const acoes = lerAcoesDaRegra(regra.acao);
    const prioridade = prioridadeDaRegra(cond.severidade, acoes);
    const notificar = acoes.includes('notificar_gestor');
    const nomeRegra = regra.nome;
    const candidatos: Candidato[] = [];

    if (cond.se === 'estoque_min') {
      for (const est of estoques) {
        if (Number(est.quantidade) > cond.param) continue;
        const zerado = Number(est.quantidade) === 0;
        candidatos.push({
          tipo: zerado ? 'ESTOQUE_ZERADO' : 'ESTOQUE_BAIXO',
          titulo: `${zerado ? 'Estoque zerado' : 'Estoque baixo'}: ${est.produto.nome}`,
          descricao: `Regra "${nomeRegra}": saldo de ${est.quantidade} un. na filial ${est.filial.nome} (parâmetro: <= ${cond.param}).`,
          entidade: 'Produto',
          entidadeId: est.produtoId,
        });
      }
    } else if (cond.se === 'validade') {
      for (const est of estoques) {
        if (!est.produto.validade) continue;
        const dias = (new Date(est.produto.validade).getTime() - agora.getTime()) / 86_400_000;
        if (dias > cond.param || dias < 0) continue;
        candidatos.push({
          tipo: 'VALIDADE',
          titulo: `Validade próxima: ${est.produto.nome}`,
          descricao: `Regra "${nomeRegra}": vence em aproximadamente ${Math.ceil(dias)} dia(s) (parâmetro: ${cond.param} dias).`,
          entidade: 'Produto',
          entidadeId: est.produtoId,
        });
      }
    } else if (cond.se === 'meta_70') {
      for (const meta of metas) {
        const pct = Number(meta.percentual);
        if (!(pct > 0 && pct < cond.param)) continue;
        candidatos.push({
          tipo: 'META_BAIXA',
          titulo: `Meta abaixo de ${cond.param}%: ${meta.tipo} (${meta.periodo})`,
          descricao: `Regra "${nomeRegra}": meta atingiu apenas ${pct.toFixed(1)}%.`,
          entidade: 'Meta',
          entidadeId: meta.id,
        });
      }
    } else if (cond.se === 'despesa_up') {
      if (media7dias && totalDespesasHoje > media7dias * (1 + cond.param / 100)) {
        candidatos.push({
          tipo: 'DESPESA_ALTA',
          titulo: 'Aumento expressivo de despesas',
          descricao:
            `Regra "${nomeRegra}": despesas de hoje (R$ ${totalDespesasHoje.toFixed(2)}) acima de ` +
            `${cond.param}% da média dos últimos 7 dias (R$ ${media7dias.toFixed(2)}).`,
        });
      }
    } else if (cond.se === 'compra_parada') {
      const corte = new Date(agora.getTime());
      corte.setDate(corte.getDate() - cond.param);
      for (const compra of compras) {
        if (compra.createdAt.getTime() >= corte.getTime()) continue;
        const fornecedorNome = compra.fornecedor?.nome ? ` do fornecedor ${compra.fornecedor.nome}` : '';
        const filialNome = compra.filial?.nome ? ` para a filial ${compra.filial.nome}` : '';
        candidatos.push({
          tipo: 'COMPRA_PENDENTE',
          titulo: `Compra parada há mais de ${cond.param} dias: Pedido #${compra.id.slice(-6)}`,
          descricao:
            `Regra "${nomeRegra}": pedido em status ${compra.status}${fornecedorNome}${filialNome}, ` +
            `criado em ${compra.createdAt.toLocaleDateString('pt-BR')}, sem confirmação nem recebimento.`,
          entidade: 'Compra',
          entidadeId: compra.id,
        });
      }
    }

    for (const cand of candidatos) {
      const chaves = { empresaId, tipo: cand.tipo, status: 'ABERTO' as const };
      const existente = cand.entidade
        ? await prisma.alerta.findFirst({
            where: { ...chaves, entidade: cand.entidade, entidadeId: cand.entidadeId ?? null },
          })
        : cand.tipo === 'DESPESA_ALTA'
          ? await prisma.alerta.findFirst({ where: { ...chaves, createdAt: { gte: hoje } } })
          : await prisma.alerta.findFirst({ where: chaves });
      if (existente) continue;

      const alerta = await prisma.alerta.create({
        data: {
          empresaId,
          tipo: cand.tipo,
          prioridade,
          titulo: cand.titulo,
          descricao: cand.descricao,
          entidade: cand.entidade ?? null,
          entidadeId: cand.entidadeId ?? null,
          origem: 'AUTOMATICO',
        },
      });
      alertasCriados.push(alerta);

      if (notificar) {
        await prisma.notificacao.create({
          data: {
            empresaId,
            tipo: cand.tipo,
            prioridade,
            titulo: alerta.titulo,
            mensagem: alerta.descricao,
            origem: 'AUTOMATICO',
            link: cand.entidade ? (LINK_DA_ENTIDADE[cand.entidade] ?? null) : null,
          },
        });
      }
    }
  }

  return { regrasExecutadas: regrasValidas.length, regrasIgnoradas, alertas: alertasCriados };
}

export async function iaRoutes(app: FastifyInstance): Promise<void> {
  const iaLimiter = createRateLimiter(20, 60_000); // 20 requests per minute
  
  // Seção 22 a 25 — Assistente de IA com cruzamento de dados e checagem de permissão
  const perguntarHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const { pergunta, message } = (req.body as { pergunta?: string; message?: string }) || {};
    const textoPergunta = (pergunta || message || '').trim();
    if (!textoPergunta) {
      throw new Error('Pergunta obrigatória');
    }

    const user = (req as any).user;
    const usuarioId = user.id;
    const empresaId = user.empresaId;

    const usuario = await prisma.usuario.findFirst({
      where: { id: usuarioId, empresaId },
      include: { permissoes: true },
    });

    const perms = usuario?.permissoes.filter((p: any) => p.permitido) || [];
    const isAdminSeed = perms.length === 0;
    const pode = (modulo: string, acao: string) =>
      isAdminSeed || perms.some((p: any) => p.modulo === modulo && p.acao === acao);

    let contextoDados = '';
    try {
      if (pode('produtos', 'visualizar')) {
        const criticos = await prisma.produto.count({
          where: {
            empresaId,
            estoques: {
              some: {
                quantidade: { lte: 5 },
              },
            },
          },
        });
        contextoDados += `\n- ESTOQUE: ${criticos} itens com estoque crítico (<= 5)`;
      }
      if (pode('vendas', 'visualizar')) {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const vendasHoje = await prisma.venda.count({
          where: { empresaId, createdAt: { gte: hoje } },
        });
        contextoDados += `\n- VENDAS HOJE: ${vendasHoje}`;
      }
    } catch (err) {
      req.log.warn({ err }, 'Erro ao montar contexto para IA');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const msg = `Olá! Sou a IA da NEXUS OS. Configure GEMINI_API_KEY no .env para respostas completas de IA. ${contextoDados}`;
      return reply.send({ resposta: msg, text: msg, fallback: true });
    }

    // A chamada ao modelo vive em `ia.service.ts` — o mesmo serviço que o
    // Radar usa, para não existirem duas copias do fetch/timeout divergentes.
    const systemPrompt = `${contextoDados}`;
    const chamada = await consultarIA(`Dados reais da empresa: ${systemPrompt}\n\nPergunta: ${textoPergunta}`, {
      papel: 'Você é o NEXUS, a IA do NEXUS OS, em português do Brasil, direta, empática e precisa.',
      temperatura: 0.7,
      maxTokens: 400,
    });

    if (!chamada.ok) {
      req.log.error({ motivo: chamada.motivo }, 'Gemini indisponível');
      const fallback = `Olá! Sou a IA da NEXUS OS. Não consegui consultar o Gemini agora (${chamada.motivo}). ${contextoDados || 'Tudo pronto para ajudar com estoque, finanças e vendas.'}`;
      return reply.status(502).send({ error: chamada.motivo, fallback: true, resposta: fallback, text: fallback });
    }
    const resposta = chamada.texto || 'Olá! Como posso ajudar?';

    // Registra histórico na ConversaIA
    try {
      await prisma.conversaIA.create({
        data: {
          empresaId,
          usuarioId,
          pergunta: textoPergunta,
          resposta,
          origem: 'IA',
        },
      });
    } catch (histErr) {
      req.log.warn({ err: histErr }, 'Falha ao salvar histórico ConversaIA (resposta mantida)');
    }

    return reply.send({ resposta, text: resposta, fallback: false });
  };

  app.post(
    '/ia/perguntar',
    { preHandler: [app.authenticate, await permissaoMiddleware('ia', 'visualizar'), iaLimiter] },
    perguntarHandler,
  );

  app.post(
    '/chat',
    { preHandler: [app.authenticate, await permissaoMiddleware('ia', 'visualizar'), iaLimiter] },
    perguntarHandler,
  );

  // Seção 26 — Central de Inteligência / Informação Cruzada
  app.get(
    '/ia/intelligence-center',
    { preHandler: [app.authenticate, await permissaoMiddleware('ia', 'visualizar')] },
    async (req: FastifyRequest) => {
      const empresaId = (req as any).user.empresaId;
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const amanha = new Date(hoje);
      amanha.setDate(amanha.getDate() + 1);
      const ontem = new Date(hoje);
      ontem.setDate(ontem.getDate() - 1);

      const [vendasHoje, vendasOntem, estoques, financeiroHoje, metasBaixas] = await Promise.all([
        prisma.venda.findMany({
          where: { empresaId, createdAt: { gte: hoje, lt: amanha }, status: 'FINALIZADA' },
          include: { itens: { select: { produtoId: true, quantidade: true } } },
        }),
        prisma.venda.findMany({
          where: { empresaId, createdAt: { gte: ontem, lt: hoje }, status: 'FINALIZADA' },
        }),
        prisma.estoque.findMany({
          where: { empresaId },
          include: { produto: true, filial: true },
        }),
        prisma.financeiro.findMany({
          where: { empresaId, createdAt: { gte: hoje, lt: amanha } },
        }),
        prisma.meta.findMany({
          where: { empresaId, percentual: { lt: 70 } },
        }),
      ]);

      const baixoReal = estoques.filter((e) => e.quantidade <= e.produto.estoqueMinimo);
      const faturamentoOntem = vendasOntem.reduce((s, v) => s + Number(v.total), 0);
      const faturamentoHoje = vendasHoje.reduce((s, v) => s + Number(v.total), 0);
      const receitasHoje = financeiroHoje
        .filter((f) => f.tipo === 'RECEITA')
        .reduce((s, f) => s + Number(f.valor), 0);

      const oQueAconteceu = {
        vendasHoje: vendasHoje.length,
        faturamentoHoje,
        estoqueBaixo: baixoReal.length,
        receitasHoje,
      };

      const problemas = [
        ...baixoReal.map((e) => ({
          tipo: 'ESTOQUE_BAIXO',
          problema: `Produto ${e.produto.nome} abaixo do mínimo (${e.quantidade} <= ${e.produto.estoqueMinimo}) na filial ${e.filial.nome}`,
          possivelCausa: 'Volume recente de vendas ou reposição pendente',
          impacto: 'Risco de ruptura de estoque e perda de vendas',
          recomendacao: `Comprar ${Math.max(1, Number(e.produto.estoqueMaximo) - Number(e.quantidade))} unidades`,
        })),
        ...metasBaixas.map((m) => ({
          tipo: 'META_BAIXA',
          problema: `Meta ${m.tipo} (${m.periodo}) atingiu apenas ${Number(m.percentual).toFixed(1)}%`,
          possivelCausa: 'Ritmo de conversão abaixo do previsto para o período',
          impacto: 'Não cumprimento da meta estipulada',
          recomendacao: 'Analisar produtos mais vendidos e engajar a equipe comercial',
        })),
      ];

      /**
       * Oportunidades: o que os DADOS apontam, e só quando apontam.
       *
       * Antes eram DOIS textos fixos, escritos à mão e devolvidos sempre, para
       * qualquer empresa, sem consultar nada: "Produtos com giro alto" e
       * "Concentrar atendimentos nos períodos de maior faturamento". A tela
       * os listava como se fossem achados da análise cruzada, com contador e
       * tudo — número/insight decorativo é pior do que ausência dele, porque o
       * gestor cite "a IA identificou uma oportunidade" sem base nenhuma.
       *
       * Agora cada oportunidade nasce de um fato observável hoje:
       *   • giro real x cobertura de estoque (produto que VENDEU e está no
       *     mínimo é risco real de perda de venda, não sugestão genérica);
       *   • comparação de faturamento de hoje contra ontem, nos dois sentidos.
       * Sem base, a lista volta VAZIA e a tela já mostra "Nenhuma oportunidade
       * identificada." — que é a resposta honesta.
       */
      const vendidosHoje = new Map<string, number>();
      for (const v of vendasHoje) {
        for (const item of v.itens ?? []) {
          vendidosHoje.set(item.produtoId, (vendidosHoje.get(item.produtoId) ?? 0) + Number(item.quantidade));
        }
      }
      const giroEmRisco = estoques
        .filter((e) => (vendidosHoje.get(e.produtoId) ?? 0) > 0 && e.quantidade <= e.produto.estoqueMinimo)
        .map((e) => ({
          tipo: 'GIRO_EM_RISCO',
          descricao:
            `${e.produto.nome} vendeu ${vendidosHoje.get(e.produtoId)} unidade(s) hoje na filial ` +
            `${e.filial.nome} e está em ${e.quantidade} (mínimo ${e.produto.estoqueMinimo}): ` +
            `risco real de ruptura com demanda comprovada hoje.`,
        }));

      const oportunidades = [
        ...giroEmRisco,
        ...(faturamentoOntem > 0 && faturamentoHoje > faturamentoOntem
          ? [{
            tipo: 'RITMO_POSITIVO',
            descricao:
              `Faturamento de hoje (R$ ${faturamentoHoje.toFixed(2)}) está acima do de ontem ` +
              `(R$ ${faturamentoOntem.toFixed(2)}): o ritmo atual está rendendo e vale preservar ` +
              `a operação que o sustenta.`,
          }]
          : faturamentoOntem > 0
            ? [{
              tipo: 'RESSAO_VENDAS',
              descricao:
                `Faturamento de hoje (R$ ${faturamentoHoje.toFixed(2)}) está abaixo do de ontem ` +
                `(R$ ${faturamentoOntem.toFixed(2)}): vale investigar a causa antes que a queda ` +
                `se consolide.`,
            }]
            : []),
      ];

      const crescimento = faturamentoOntem
        ? ((faturamentoHoje - faturamentoOntem) / faturamentoOntem) * 100
        : 0;

      return {
        oQueAconteceu,
        oQueMudou: { crescimento },
        problemas,
        oportunidades,
        recomendacoes: problemas.map((p) => ({
          problema: p.problema,
          possivelCausa: p.possivelCausa,
          impacto: p.impacto,
          recomendacao: p.recomendacao,
        })),
      };
    },
  );

  // Seção 27 — Alertas
  app.get(
    '/alertas',
    // Permissões vindas do catálogo (permissoes-catalogo.ts): até aqui TODAS
    // as rotas abaixo usavam 'ia.*', deixando os módulos 'alertas',
    // 'notificacoes' e 'automacao' sem efeito — permissão concedida em
    // Usuários não liberava nem barrava nada.
    { preHandler: [app.authenticate, await permissaoMiddleware('alertas', 'visualizar')] },
    async (req: FastifyRequest) => {
      const empresaId = (req as any).user.empresaId;
      return prisma.alerta.findMany({
        where: { empresaId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    },
  );

  // Seção 28 — Central de Notificações
  app.get(
    '/notificacoes',
    { preHandler: [app.authenticate, await permissaoMiddleware('notificacoes', 'visualizar')] },
    async (req: FastifyRequest) => {
      const user = (req as any).user;
      return prisma.notificacao.findMany({
        where: {
          empresaId: user.empresaId,
          OR: [{ usuarioId: null }, { usuarioId: user.id }],
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    },
  );

  app.post(
    '/notificacoes/:id/lida',
    { preHandler: [app.authenticate, await permissaoMiddleware('notificacoes', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const user = (req as any).user;
      const notificacao = await prisma.notificacao.findFirst({
        where: {
          id,
          empresaId: user.empresaId,
          OR: [{ usuarioId: null }, { usuarioId: user.id }],
        },
      });
      if (!notificacao) throw new Error('Notificação não encontrada.');
      return prisma.notificacao.update({
        where: { id: notificacao.id },
        data: { lida: true },
      });
    },
  );

  // Seção 29 — Regras de Automação
  app.get(
    '/automacao/regras',
    { preHandler: [app.authenticate, await permissaoMiddleware('automacao', 'visualizar')] },
    async (req: FastifyRequest) => {
      const empresaId = (req as any).user.empresaId;
      // Mesma ordem de /alertas e /notificacoes (mais recente primeiro). Sem
      // orderBy a ordem era a do banco e a regra recém-criada mudava de
      // posição no reload, contradizendo o toast de "Regra criada".
      return prisma.regraAutomacao.findMany({
        where: { empresaId },
        orderBy: { createdAt: 'desc' },
      });
    },
  );

  app.post(
    '/automacao/regras',
    { preHandler: [app.authenticate, await permissaoMiddleware('automacao', 'criar')] },
    async (req: FastifyRequest) => {
      // Payload validado antes do Prisma: antes, `req.body as any` sem nome
      // gerava PrismaClientValidationError e o gestor via HTTP 500.
      const { nome, condicao, acao } = validarCorpoDeRegra(req.body);
      const empresaId = (req as any).user.empresaId;
      // Quem cria é o usuário, não o motor: `origem` aparece no card da regra
      // e `AUTOMATICO` mentia sobre quem mandou.
      return prisma.regraAutomacao.create({
        data: { empresaId, nome, condicao, acao, origem: 'MANUAL' },
      });
    },
  );

  // Motor SE/ENTÃO — Execução de Regras Automáticas
  app.post(
    '/automacao/executar',
    { preHandler: [app.authenticate, await permissaoMiddleware('automacao', 'criar')] },
    async (req: FastifyRequest) => {
      const empresaId = (req as any).user.empresaId;
      const alertasCriados: any[] = [];

      // 1) Regras cadastradas na aba Alertas. Rodam ANTES das verificações
      // fixas: quando as duas enxergam o mesmo fato, o alerta nasce com a
      // severidade/parâmetro que o usuário escolheu e a fixa deduplica.
      const { regrasExecutadas, regrasIgnoradas, alertas: alertasDaRegra } =
        await executarRegrasCadastradas(empresaId);
      alertasCriados.push(...alertasDaRegra);
      if (regrasIgnoradas > 0) {
        req.log.warn(
          { regrasIgnoradas },
          'Regras de automação ignoradas por condição fora do formato aceito',
        );
      }

      // 2) SE estoque < mínimo ENTÃO gerar alerta
      const estoques = await prisma.estoque.findMany({
        where: { empresaId },
        include: { produto: true, filial: true },
      });
      for (const est of estoques) {
        if (Number(est.quantidade) <= Number(est.produto.estoqueMinimo)) {
          const tipoEstoque = Number(est.quantidade) === 0 ? 'ESTOQUE_ZERADO' : 'ESTOQUE_BAIXO';
          const existente = await prisma.alerta.findFirst({
            where: {
              empresaId,
              tipo: tipoEstoque,
              entidade: 'Produto',
              entidadeId: est.produtoId,
              status: 'ABERTO',
            },
          });
          if (!existente) {
            const alerta = await prisma.alerta.create({
              data: {
                empresaId,
                tipo: tipoEstoque,
                prioridade: Number(est.quantidade) === 0 ? 'CRITICA' : 'ALTA',
                titulo: `${Number(est.quantidade) === 0 ? 'Estoque zerado' : 'Estoque baixo'}: ${est.produto.nome}`,
                descricao: `Saldo de ${est.quantidade} un. na filial ${est.filial.nome} (mínimo: ${est.produto.estoqueMinimo})`,
                entidade: 'Produto',
                entidadeId: est.produtoId,
                origem: 'AUTOMATICO',
              },
            });
            alertasCriados.push(alerta);
            await prisma.notificacao.create({
              data: {
                empresaId,
                tipo: tipoEstoque,
                prioridade: Number(est.quantidade) === 0 ? 'CRITICA' : 'ALTA',
                titulo: alerta.titulo,
                mensagem: alerta.descricao,
                origem: 'AUTOMATICO',
                link: '/produtos',
              },
            });
          }
        }

        // Validade próxima (<= 7 dias)
        if (est.produto.validade) {
          const dias = (new Date(est.produto.validade).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          if (dias <= 7 && dias >= 0) {
            const existente = await prisma.alerta.findFirst({
              where: {
                empresaId,
                tipo: 'VALIDADE',
                entidade: 'Produto',
                entidadeId: est.produtoId,
                status: 'ABERTO',
              },
            });
            if (!existente) {
              const alerta = await prisma.alerta.create({
                data: {
                  empresaId,
                  tipo: 'VALIDADE',
                  prioridade: 'ALTA',
                  titulo: `Validade próxima: ${est.produto.nome}`,
                  descricao: `Vence em aproximadamente ${Math.ceil(dias)} dia(s)`,
                  entidade: 'Produto',
                  entidadeId: est.produtoId,
                  origem: 'AUTOMATICO',
                },
              });
              alertasCriados.push(alerta);
            }
          }
        }
      }

      // SE meta < 70% ENTÃO gerar alerta
      const metas = await prisma.meta.findMany({ where: { empresaId } });
      for (const meta of metas) {
        if (Number(meta.percentual) < 70 && Number(meta.percentual) > 0) {
          const existente = await prisma.alerta.findFirst({
            where: {
              empresaId,
              tipo: 'META_BAIXA',
              entidade: 'Meta',
              entidadeId: meta.id,
              status: 'ABERTO',
            },
          });
          if (!existente) {
            const alerta = await prisma.alerta.create({
              data: {
                empresaId,
                tipo: 'META_BAIXA',
                prioridade: 'MEDIA',
                titulo: `Meta abaixo de 70%: ${meta.tipo} (${meta.periodo})`,
                descricao: `Meta atingiu apenas ${Number(meta.percentual).toFixed(1)}%`,
                entidade: 'Meta',
                entidadeId: meta.id,
                origem: 'AUTOMATICO',
              },
            });
            alertasCriados.push(alerta);
          }
        }
      }

      // SE despesa diária subir > 30% acima da média dos últimos 7 dias
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const despesasHoje = await prisma.financeiro.findMany({
        where: { empresaId, tipo: 'DESPESA', createdAt: { gte: hoje } },
      });
      const totalDespesasHoje = despesasHoje.reduce((s, f) => s + Number(f.valor), 0);

      const seteDiasAtras = new Date();
      seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
      const despesas7dias = await prisma.financeiro.findMany({
        where: { empresaId, tipo: 'DESPESA', createdAt: { gte: seteDiasAtras, lt: hoje } },
      });
      const diasComDados = new Set(despesas7dias.map((f) => new Date(f.createdAt).toISOString().slice(0, 10))).size;
      const media7dias = diasComDados ? despesas7dias.reduce((s, f) => s + Number(f.valor), 0) / diasComDados : 0;

      if (media7dias && totalDespesasHoje > media7dias * 1.3) {
        const existente = await prisma.alerta.findFirst({
          where: {
            empresaId,
            tipo: 'DESPESA_ALTA',
            status: 'ABERTO',
            createdAt: { gte: hoje },
          },
        });
        if (!existente) {
          const alerta = await prisma.alerta.create({
            data: {
              empresaId,
              tipo: 'DESPESA_ALTA',
              prioridade: 'ALTA',
              titulo: 'Aumento expressivo de despesas',
              descricao: `Despesas de hoje (R$ ${totalDespesasHoje.toFixed(2)}) superam em 30% a média dos últimos 7 dias (R$ ${media7dias.toFixed(2)})`,
              origem: 'AUTOMATICO',
            },
          });
          alertasCriados.push(alerta);
        }
      }

      return {
        executado: true,
        alertasCriados: alertasCriados.length,
        alertas: alertasCriados,
        regrasExecutadas,
        regrasIgnoradas,
        motor: 'SE/ENTÃO Seção 29',
      };
    },
  );

  // Seção 29 / Débito Técnico #11 — Alerta para Compras Paradas
  app.post(
    '/automacao/executar-compras-paradas',
    { preHandler: [app.authenticate, await permissaoMiddleware('automacao', 'criar')] },
    async (req: FastifyRequest) => {
      const empresaId = (req as any).user.empresaId;
      const cincoDiasAtras = new Date();
      cincoDiasAtras.setDate(cincoDiasAtras.getDate() - 5);

      const comprasParadas = await prisma.compra.findMany({
        where: {
          empresaId,
          status: { in: ['SOLICITADA', 'PEDIDO'] },
          createdAt: { lt: cincoDiasAtras },
        },
        include: { fornecedor: true, filial: true },
      });

      const alertasCriados: any[] = [];
      for (const compra of comprasParadas) {
        const existente = await prisma.alerta.findFirst({
          where: {
            empresaId,
            tipo: 'COMPRA_PENDENTE',
            entidade: 'Compra',
            entidadeId: compra.id,
            status: 'ABERTO',
          },
        });
        if (!existente) {
          const fornecedorNome = compra.fornecedor?.nome ? ` do fornecedor ${compra.fornecedor.nome}` : '';
          const filialNome = compra.filial?.nome ? ` para a filial ${compra.filial.nome}` : '';
          const alerta = await prisma.alerta.create({
            data: {
              empresaId,
              tipo: 'COMPRA_PENDENTE',
              prioridade: 'ALTA',
              titulo: `Compra parada há mais de 5 dias: Pedido #${compra.id.slice(-6)}`,
              descricao: `Pedido em status ${compra.status}${fornecedorNome}${filialNome}, criado em ${compra.createdAt.toLocaleDateString('pt-BR')}, sem confirmação nem recebimento.`,
              entidade: 'Compra',
              entidadeId: compra.id,
              origem: 'AUTOMATICO',
            },
          });
          alertasCriados.push(alerta);

          await prisma.notificacao.create({
            data: {
              empresaId,
              tipo: 'COMPRA_PENDENTE',
              prioridade: 'ALTA',
              titulo: alerta.titulo,
              mensagem: alerta.descricao,
              origem: 'AUTOMATICO',
              link: `/compras`,
            },
          });
        }
      }

      return {
        executado: true,
        alertasCriados: alertasCriados.length,
        alertas: alertasCriados,
      };
    },
  );
}
