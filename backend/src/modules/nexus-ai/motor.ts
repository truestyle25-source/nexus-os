/**
 * Motor de execução da NEXUS AI (uma investigação = um AIExecucao).
 *
 *  pergunta → permissão do agente → limite de consumo → proteção contra manipulação →
 *  laço [modelo ⇄ ferramentas] com limite de passos e tempo → verificador de números →
 *  filtro de saída → resposta com fontes, período e limitações.
 *
 * Retomada: cada passo (chamadas e resultados) é gravado em `etapas`. Se o provedor cair, a
 * investigação fica AGUARDANDO_PROVEDOR e `retomarInvestigacao` continua do último passo,
 * sem repetir ferramentas já executadas. Chave de idempotência evita investigação duplicada.
 * Nenhuma rota do ERP depende deste motor: falha aqui não afeta vendas, estoque etc.
 */
import { prisma } from '../../lib/prisma.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { temPermissao } from '../../lib/permissoes.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import type { Agente, ContextoIA, MensagemIA } from './tipos.js';
import { ProvedorIndisponivel, ProvedorRecusou } from './tipos.js';
import { agente as buscarAgente } from './agentes/registro.js';
import { executarFerramenta, ferramenta as buscarFerramenta, FerramentaNegada } from './ferramentas/registro.js';
import { provedorAtual } from './provedores/roteador.js';
import { custoCentavos, registrarConsumo, situacaoConsumo } from './consumo.js';
import { filtrarSaida, pareceInjecao, REGRAS_GERAIS } from './seguranca.js';
import { verificarResposta, type ResultadoVerificacao } from './verificador.js';

type Etapa = MensagemIA;

export interface ResultadoInvestigacao {
  execucaoId: string;
  conversaId: string | null;
  status: string;
  resposta: string | null;
  detalhes: { fontes: { ferramenta: string; args: unknown }[]; verificacao: ResultadoVerificacao | null; limitacoes: string | null; agente: string; modelo: string | null } | null;
}

const MENSAGEM_NAO_VERIFICADA = 'Não consegui confirmar com segurança os números desta análise nos dados do sistema, então não vou apresentá-los. Tente reformular a pergunta ou restringir o período.';

export function contexto(empresaId: string, usuarioId: string | null, opcoes: { filialId?: string | null; sistema?: boolean } = {}): ContextoIA {
  return { empresaId, usuarioId, filialId: opcoes.filialId ?? null, permissoes: new Map(), sistema: opcoes.sistema };
}

function papelCompleto(a: Agente) {
  return `${REGRAS_GERAIS}\n\nSua especialidade: ${a.nome}.\n${a.papel}\nData de hoje: ${new Date().toISOString().slice(0, 10)}.`;
}

async function historicoDaConversa(empresaId: string, conversaId: string | null): Promise<MensagemIA[]> {
  if (!conversaId) return [];
  const msgs = await prisma.aIMensagem.findMany({ where: { empresaId, conversaId }, orderBy: { createdAt: 'desc' }, take: 6, select: { papel: true, conteudo: true } });
  return msgs.reverse().map((m) => (m.papel === 'USUARIO' ? { tipo: 'usuario', texto: m.conteudo } : { tipo: 'modelo', texto: m.conteudo }) as MensagemIA);
}

export async function iniciarInvestigacao(ctx: ContextoIA, p: { agenteId: string; pergunta: string; conversaId?: string | null; idempotencyKey?: string | null; origem?: 'PERGUNTA' | 'EVENTO' | 'AGENDADO' }): Promise<ResultadoInvestigacao> {
  const a = buscarAgente(p.agenteId);
  if (!a) throw NaoEncontrado('Agente não encontrado.');
  if (!ctx.sistema) {
    if (!ctx.usuarioId || !(await temPermissao(ctx.usuarioId, a.permissaoMinima.modulo, a.permissaoMinima.acao))) {
      throw new ErroDeNegocio(`Você não tem permissão para usar o ${a.nome} (${a.permissaoMinima.modulo}.${a.permissaoMinima.acao}).`, 403);
    }
  }
  const pergunta = p.pergunta.trim();
  if (!pergunta || pergunta.length > 2000) throw new ErroDeNegocio('Pergunta vazia ou longa demais (máx. 2000 caracteres).', 400);

  if (p.idempotencyKey) {
    const existente = await prisma.aIExecucao.findUnique({ where: { empresaId_idempotencyKey: { empresaId: ctx.empresaId, idempotencyKey: p.idempotencyKey } } });
    if (existente) return montarResultado(existente.id);
  }

  const consumo = await situacaoConsumo(ctx.empresaId);
  if (consumo.bloqueado) throw new ErroDeNegocio(`${consumo.motivo} O restante do NEXUS OS continua funcionando normalmente.`, 429);

  // Conversa (sempre da empresa e do usuário da sessão).
  let conversaId = p.conversaId ?? null;
  if (conversaId) {
    const c = await prisma.aIConversa.findFirst({ where: { id: conversaId, empresaId: ctx.empresaId, ...(ctx.usuarioId ? { usuarioId: ctx.usuarioId } : {}) }, select: { id: true } });
    if (!c) throw NaoEncontrado('Conversa não encontrada.');
  } else if (ctx.usuarioId && (p.origem ?? 'PERGUNTA') === 'PERGUNTA') {
    conversaId = (await prisma.aIConversa.create({ data: { empresaId: ctx.empresaId, usuarioId: ctx.usuarioId, titulo: pergunta.slice(0, 80) } })).id;
  }
  const historico = await historicoDaConversa(ctx.empresaId, conversaId);
  if (conversaId) {
    await prisma.aIMensagem.create({ data: { empresaId: ctx.empresaId, conversaId, papel: 'USUARIO', conteudo: pergunta } });
    await prisma.aIConversa.update({ where: { id: conversaId }, data: { updatedAt: new Date() } });
  }

  // Tentativa de manipular a IA pela própria pergunta: bloqueia e registra.
  if (pareceInjecao(pergunta)) {
    const ex = await prisma.aIExecucao.create({ data: { empresaId: ctx.empresaId, usuarioId: ctx.usuarioId, conversaId, agente: a.id, origem: p.origem ?? 'PERGUNTA', entrada: pergunta, status: 'BLOQUEADA', erro: 'Possível tentativa de manipulação da IA.', idempotencyKey: p.idempotencyKey ?? null } });
    await registrarAuditoria({ empresaId: ctx.empresaId, usuarioId: ctx.usuarioId ?? undefined, acao: 'CRIAR', entidade: 'AIEventoSeguranca', entidadeId: ex.id, valorNovo: { motivo: 'possivel_manipulacao_ia' }, origem: 'IA' } as any).catch(() => {});
    const resposta = 'Não posso atender a esse pedido: ele tenta alterar minhas regras ou obter informações protegidas. O pedido foi registrado.';
    await finalizar(ex.id, ctx, conversaId, { status: 'BLOQUEADA', resposta, verificacao: null, fontes: [], modelo: null });
    return montarResultado(ex.id);
  }

  const ex = await prisma.aIExecucao.create({ data: { empresaId: ctx.empresaId, usuarioId: ctx.usuarioId, conversaId, agente: a.id, origem: p.origem ?? 'PERGUNTA', entrada: pergunta, status: 'EXECUTANDO', etapas: [], idempotencyKey: p.idempotencyKey ?? null } });
  await registrarConsumo(ctx.empresaId, { execucoes: 1 });
  return executarLaco(ctx, a, ex.id, [...historico, { tipo: 'usuario', texto: pergunta }], []);
}

export async function retomarInvestigacao(ctx: ContextoIA, execucaoId: string): Promise<ResultadoInvestigacao> {
  const ex = await prisma.aIExecucao.findFirst({ where: { id: execucaoId, empresaId: ctx.empresaId } });
  if (!ex) throw NaoEncontrado('Investigação não encontrada.');
  if (ex.status !== 'AGUARDANDO_PROVEDOR') return montarResultado(ex.id);
  const a = buscarAgente(ex.agente);
  if (!a) throw NaoEncontrado('Agente não encontrado.');
  // Trava simples contra retomada dupla: só quem muda o status de AGUARDANDO para EXECUTANDO segue.
  const tomou = await prisma.aIExecucao.updateMany({ where: { id: ex.id, status: 'AGUARDANDO_PROVEDOR' }, data: { status: 'EXECUTANDO' } });
  if (!tomou.count) return montarResultado(ex.id);
  const historico = await historicoDaConversa(ctx.empresaId, ex.conversaId);
  const base = historico.length && historico[historico.length - 1].tipo === 'usuario' ? historico : [...historico, { tipo: 'usuario', texto: ex.entrada } as MensagemIA];
  return executarLaco(ctx, a, ex.id, base, (ex.etapas ?? []) as Etapa[]);
}

async function executarLaco(ctx: ContextoIA, a: Agente, execucaoId: string, base: MensagemIA[], etapasIniciais: Etapa[]): Promise<ResultadoInvestigacao> {
  const inicio = Date.now();
  const etapas: Etapa[] = [...etapasIniciais];
  const ferramentasDoAgente = a.ferramentas.map(buscarFerramenta).filter(Boolean) as NonNullable<ReturnType<typeof buscarFerramenta>>[];
  const prov = provedorAtual();
  let tokensE = 0; let tokensS = 0; let modelo: string | null = null;
  let tentativasVerificacao = 0;
  const salvarEtapas = () => prisma.aIExecucao.update({ where: { id: execucaoId }, data: { etapas: etapas as any } });
  const resultadosFerramentas = () => etapas.filter((e) => e.tipo === 'ferramenta').flatMap((e) => (e as Extract<Etapa, { tipo: 'ferramenta' }>).resultados.map((r) => r.resposta));
  const fontes = () => etapas.filter((e) => e.tipo === 'modelo').flatMap((e) => ((e as Extract<Etapa, { tipo: 'modelo' }>).chamadas ?? []).map((c) => ({ ferramenta: c.nome, args: c.args })));

  try {
    for (let passo = 0; passo < a.limites.passos; passo++) {
      if (Date.now() - inicio > a.limites.tempoMs) break;
      const r = await prov.gerar({ sistema: papelCompleto(a), mensagens: [...base, ...etapas], ferramentas: ferramentasDoAgente, nivel: a.modelo ?? 'AVANCADO' });
      tokensE += r.tokensEntrada; tokensS += r.tokensSaida; modelo = r.modelo;
      if (r.chamadas?.length) {
        etapas.push({ tipo: 'modelo', chamadas: r.chamadas, ...(r.texto ? { texto: r.texto } : {}), bruto: r.bruto });
        const resultados: { nome: string; resposta: unknown }[] = [];
        for (const c of r.chamadas) {
          const t0 = Date.now();
          try {
            const { args, resultado, injecoes } = await executarFerramenta(ctx, c.nome, a.ferramentas, c.args);
            resultados.push({ nome: c.nome, resposta: resultado });
            await prisma.aIExecucaoFerramenta.create({ data: { empresaId: ctx.empresaId, execucaoId, ferramenta: c.nome, entrada: args as any, resultado: resultado as any, ok: true, duracaoMs: Date.now() - t0, ...(injecoes.length ? { erro: `Instruções embutidas neutralizadas em: ${injecoes.slice(0, 5).join(', ')}` } : {}) } });
            if (injecoes.length) await registrarAuditoria({ empresaId: ctx.empresaId, usuarioId: ctx.usuarioId ?? undefined, acao: 'CRIAR', entidade: 'AIEventoSeguranca', entidadeId: execucaoId, valorNovo: { motivo: 'instrucao_embutida_em_dados', ferramenta: c.nome, campos: injecoes.slice(0, 5) }, origem: 'IA' } as any).catch(() => {});
          } catch (e) {
            const msg = e instanceof FerramentaNegada ? e.message : e instanceof Error && e.name === 'ZodError' ? 'Argumentos inválidos para a ferramenta.' : 'Falha ao consultar os dados.';
            resultados.push({ nome: c.nome, resposta: { erro: msg } });
            await prisma.aIExecucaoFerramenta.create({ data: { empresaId: ctx.empresaId, execucaoId, ferramenta: c.nome, entrada: c.args as any, ok: false, erro: msg, duracaoMs: Date.now() - t0 } });
          }
        }
        etapas.push({ tipo: 'ferramenta', resultados });
        await salvarEtapas();
        continue;
      }
      // Primeiro remove segredos (o que nunca pode chegar à tela), depois verifica os números.
      const texto = filtrarSaida((r.texto ?? '').trim()).texto;
      const verificacao = verificarResposta(texto, resultadosFerramentas());
      if (!verificacao.aprovada && tentativasVerificacao === 0) {
        tentativasVerificacao++;
        etapas.push({ tipo: 'modelo', texto, bruto: r.bruto });
        etapas.push({ tipo: 'usuario', texto: `REVISÃO OBRIGATÓRIA: os números ${verificacao.divergentes.slice(0, 8).join(', ')} não aparecem nos resultados das ferramentas. Reescreva a resposta usando apenas números que aparecem exatamente nos resultados, ou consulte a ferramenta adequada.` });
        await salvarEtapas();
        continue;
      }
      const resposta = verificacao.aprovada ? texto : MENSAGEM_NAO_VERIFICADA;
      await finalizar(execucaoId, ctx, null, { status: 'CONCLUIDA', resposta, verificacao, fontes: fontes(), modelo, tokensE, tokensS, inicio });
      return montarResultado(execucaoId);
    }
    const resposta = 'A investigação atingiu o limite de etapas sem chegar a uma conclusão confiável. Tente uma pergunta mais específica (produto, período ou filial).';
    await finalizar(execucaoId, ctx, null, { status: 'CONCLUIDA', resposta, verificacao: null, fontes: fontes(), modelo, tokensE, tokensS, inicio });
    return montarResultado(execucaoId);
  } catch (e) {
    await salvarEtapas().catch(() => {});
    const custo = custoCentavos(tokensE, tokensS);
    await registrarConsumo(ctx.empresaId, { tokensEntrada: tokensE, tokensSaida: tokensS, custoCentavos: custo });
    const indisponivel = e instanceof ProvedorIndisponivel;
    await prisma.aIExecucao.update({ where: { id: execucaoId }, data: { status: indisponivel ? 'AGUARDANDO_PROVEDOR' : 'FALHOU', erro: e instanceof Error ? e.message.slice(0, 300) : 'erro', modelo, tokensEntrada: { increment: tokensE }, tokensSaida: { increment: tokensS }, custoCentavos: { increment: custo }, duracaoMs: Date.now() - inicio } });
    if (!indisponivel && !(e instanceof ProvedorRecusou)) throw e;
    return montarResultado(execucaoId);
  }
}

async function finalizar(execucaoId: string, ctx: ContextoIA, _conversa: string | null, d: { status: string; resposta: string; verificacao: ResultadoVerificacao | null; fontes: { ferramenta: string; args: unknown }[]; modelo: string | null; tokensE?: number; tokensS?: number; inicio?: number }) {
  const tokensE = d.tokensE ?? 0; const tokensS = d.tokensS ?? 0;
  const custo = custoCentavos(tokensE, tokensS);
  const ex = await prisma.aIExecucao.update({
    where: { id: execucaoId },
    data: { status: d.status, resposta: d.resposta, verificacao: d.verificacao as any, modelo: d.modelo, tokensEntrada: { increment: tokensE }, tokensSaida: { increment: tokensS }, custoCentavos: { increment: custo }, duracaoMs: d.inicio ? Date.now() - d.inicio : null },
  });
  if (tokensE || tokensS) await registrarConsumo(ctx.empresaId, { tokensEntrada: tokensE, tokensSaida: tokensS, custoCentavos: custo });
  if (ex.conversaId) {
    const limitacoes = d.resposta.match(/Limita[cç][oõ]es:\s*(.+)$/im)?.[1]?.trim() ?? null;
    await prisma.aIMensagem.create({ data: { empresaId: ctx.empresaId, conversaId: ex.conversaId, papel: 'NEXUS', conteudo: d.resposta, execucaoId, detalhes: { fontes: d.fontes, verificacao: d.verificacao, limitacoes, agente: ex.agente, modelo: d.modelo } as any } });
  }
}

export async function montarResultado(execucaoId: string): Promise<ResultadoInvestigacao> {
  const ex = await prisma.aIExecucao.findUniqueOrThrow({ where: { id: execucaoId }, include: { ferramentas: { select: { ferramenta: true, entrada: true, ok: true }, orderBy: { createdAt: 'asc' } } } });
  const limitacoes = ex.resposta?.match(/Limita[cç][oõ]es:\s*(.+)$/im)?.[1]?.trim() ?? null;
  return {
    execucaoId: ex.id, conversaId: ex.conversaId, status: ex.status,
    resposta: ex.resposta ?? (ex.status === 'AGUARDANDO_PROVEDOR' ? 'O provedor de IA está indisponível no momento. A investigação foi guardada e pode ser retomada sem refazer o que já foi feito.' : ex.status === 'FALHOU' ? 'A investigação não pôde ser concluída.' : null),
    detalhes: { fontes: ex.ferramentas.filter((f) => f.ok).map((f) => ({ ferramenta: f.ferramenta, args: f.entrada })), verificacao: (ex.verificacao as any) ?? null, limitacoes, agente: ex.agente, modelo: ex.modelo },
  };
}
