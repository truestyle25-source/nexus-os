import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { ErroDeNegocio } from '../../lib/erros.js';
import { apurarFolha } from '../../lib/folha.js';
import { gerarPdf, type Bloco } from '../../lib/pdf.js';
import { dataBr, valorBr, empresaDoUsuario } from './rh.utils.js';

/**
 * Folha de Pagamento \u2014 rotas.
 *
 *-separadas em arquivo proprio (e nao dentro de `rh.routes.ts`, que ja tem
 * 1765 linhas) para manter a folha legivel e para os testes de ponta a ponta
 * poderem importa-la sem subir o resto do RH.
 *
 * REGRA CENTRAL: o c\u00e1lculo vem SEMPRE de `lib/folha.ts`. Nenhuma rota aqui
 * soma, multiplica ou estima valor \u2014 elas persistem o que o motor devolveu e
 * devolvem o que est\u00e1 no banco. E o que garante que tela, PDF e banco
 * mostrem o mesmo n\u00famero.
 */
export async function folhaRoutes(app: FastifyInstance) {
  // ==========================================================================
  //  Helpers
  // ==========================================================================

  /** Compet\u00eancia no formato AAAA-MM, validada. */
  const competenciaSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Compet\u00eancia deve estar no formato AAAA-MM.');

  /** `AAAA-MM` \u2192 primeiro e \u00faltimo dia do m\u00eas, em UTC (o banco grava `@db.Date`). */
  function intervaloDaCompetencia(competencia: string) {
    const [ano, mes] = competencia.split('-').map(Number);
    const inicio = new Date(Date.UTC(ano, mes - 1, 1));
    // Dia seguinte ao \u00faltimo, porque `lt` \u00e9 exclusivo \u2014 usar o dia 31 como
    // `lt` excluiria o proprio \u00faltimo dia do m\u00eas (o mesmo bug do `/rh/ponto`).
    const fim = new Date(Date.UTC(ano, mes, 1));
    return { inicio, fim };
  }

  /**
   * Apura o ponto REAL do funcion\u00e1rio na compet\u00eancia.
   *
   * Soma minutos das batidas do m\u00eas. Devolve `temDados: false` quando n\u00e3o h\u00e1
   * nenhuma batida \u2014 nesse caso a folha n\u00e3o gera hora extra, em vez de estimar.
   */
  async function apurarPonto(funcionarioId: string, empresaId: string, competencia: string) {
    const { inicio, fim } = intervaloDaCompetencia(competencia);
    const batidas = await prisma.ponto.findMany({
      where: { funcionarioId, empresaId, data: { gte: inicio, lt: fim } },
      select: { horaExtraMinutos: true, bancoHoras: true, atrasoMinutos: true, falta: true },
    });
    return {
      minutosExtra: batidas.reduce((s, b) => s + (b.horaExtraMinutos ?? 0), 0),
      minutosBanco: batidas.reduce((s, b) => s + (b.bancoHoras ?? 0), 0),
      diasFalta: batidas.filter((b) => b.falta).length,
      minutosAtraso: batidas.reduce((s, b) => s + (b.atrasoMinutos ?? 0), 0),
      diasUteis: diasUteisEntre(inicio, fim),
      temDados: batidas.length > 0,
    };
  }

  /**
   * Dias uteis (segunda a sexta) entre `inicio` e `fim` do mes.
   *
   * `inicio` e `fim` sao datas de meia-noite UTC (padrao de `@db.Date`), entao o
   * dia da semana vem de `getUTCDay()` -- usar `getDay()` deslocaria a contagem
   * em fusos negativos e a fracao do desconto de falta sairia errada.
   */
  function diasUteisEntre(inicio: Date, fim: Date): number {
    let total = 0;
    for (let d = inicio.getTime(); d < fim.getTime(); d += 86_400_000) {
      const dia = new Date(d).getUTCDay();
      if (dia !== 0 && dia !== 6) total += 1;
    }
    return total;
  }

  /**
   * Recalcula e persiste a folha de UM funcion\u00e1rio.
   *
   * Chamada tanto pelo processamento em lote quanto pelo lan\u00e7amento manual.
   * Substitui os lan\u00e7amentos AUTOMATICOS e PONTO (que s\u00e3o derivados) e
   * preserva os MANUAIS, que o usu\u00e1rio lan\u00e7ou \u2014 sen\u00e3o um desconto cadastrado
   * desapareceria a cada reprocessamento.
   */
  async function recalcularFuncionario(folhaId: string, empresaId: string, funcionarioId: string) {
    const [folha, func] = await Promise.all([
      prisma.folha.findFirst({ where: { id: folhaId, empresaId } }),
      prisma.funcionario.findFirst({
        where: { id: funcionarioId, empresaId },
        // `valeAlimentacao`/`valeRefeicao` e os valores entram aqui porque o
        // motor (`lib/folha.ts`) gera as rubricas a partir deles. Sem trazer
        // estes campos, o beneficio fica gravado no cadastro mas nunca
        // chegaria a folha.
        select: { id: true, nome: true, matricula: true, salario: true, dataAdmissao: true, dataDesligamento: true, valeAlimentacao: true, valorValeAlimentacao: true, valeRefeicao: true, valorValeRefeicao: true },
      }),
    ]);
    if (!folha) throw new ErroDeNegocio('Folha n\u00e3o encontrada nesta empresa.', 404);
    if (!func) throw new ErroDeNegocio('Funcion\u00e1rio n\u00e3o encontrado nesta empresa.', 404);

    const ponto = await apurarPonto(func.id, empresaId, folha.competencia);
    const manuais = await prisma.lancamentoFolha.findMany({
      where: { folhaId, funcionarioId, origem: 'MANUAL' },
    });
    const somaManual = (tipo: 'PROVENTO' | 'DESCONTO') => Number(
      manuais.filter((l) => l.tipo === tipo).reduce((s, l) => s + Number(l.valor), 0).toFixed(2),
    );

    const r = apurarFolha({
      funcionario: {
        ...func,
        salario: Number(func.salario ?? 0),
        // `Decimal` do Prisma e string no driver: sem converter, o valor
        // chegaria como texto e a comparacao `> 0` compararia string com
        // numero, o que faria o beneficio nunca entrar.
        valorValeAlimentacao: Number(func.valorValeAlimentacao ?? 0),
        valorValeRefeicao: Number(func.valorValeRefeicao ?? 0),
      },
      ponto,
      manuaisProvento: somaManual('PROVENTO'),
      manuaisDesconto: somaManual('DESCONTO'),
    });

    // Apaga os derivados antigos e grava os novos, preservando os manuais.
    await prisma.$transaction([
      prisma.lancamentoFolha.deleteMany({ where: { folhaId, funcionarioId, origem: { in: ['AUTOMATICO', 'PONTO'] } } }),
      prisma.lancamentoFolha.createMany({
        data: r.lancamentos.map((l) => ({
          empresaId, folhaId, funcionarioId,
          codigo: l.codigo, descricao: l.descricao, tipo: l.tipo,
          referencia: l.referencia, valor: l.valor,
          salarioBase: l.codigo === '001' ? Number(func.salario ?? 0) : null,
          observacoes: l.observacoes, origem: l.origem,
        })),
      }),
    ]);

    // Sincroniza o pagamento com o l\u00edquido apurado. Se ainda n\u00e3o foi pago,
    // o valorLiquido acompanha o novo c\u00e1lculo; depois de pago, fica congelado.
    const existente = await prisma.pagamentoRH.findFirst({ where: { folhaId, funcionarioId } });
    if (!existente) {
      await prisma.pagamentoRH.create({
        data: { empresaId, folhaId, funcionarioId, valorLiquido: r.liquido, status: 'PENDENTE' },
      });
    } else if (existente.status === 'PENDENTE') {
      await prisma.pagamentoRH.update({ where: { id: existente.id }, data: { valorLiquido: r.liquido } });
    }

    await atualizarTotaisDaFolha(folhaId, empresaId);
    return r;
  }

  /** Recalcula os totais da compet\u00eancia a partir dos lan\u00e7amentos gravados. */
  async function atualizarTotaisDaFolha(folhaId: string, empresaId: string) {
    const lanc = await prisma.lancamentoFolha.findMany({ where: { folhaId, empresaId } });
    const prov = lanc.filter((l) => l.tipo === 'PROVENTO').reduce((s, l) => s + Number(l.valor), 0);
    const desc = lanc.filter((l) => l.tipo === 'DESCONTO').reduce((s, l) => s + Number(l.valor), 0);
    await prisma.folha.update({
      where: { id: folhaId },
      data: {
        totalProventos: Number(prov.toFixed(2)),
        totalDescontos: Number(desc.toFixed(2)),
        totalLiquido: Number((prov - desc).toFixed(2)),
      },
    });
  }

  // ==========================================================================
  //  Compet\u00eancias
  // ==========================================================================

  /** Lista as compet\u00eancias da empresa com os totais reais. */
  app.get('/rh/folhas', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req: any) => {
    return prisma.folha.findMany({
      where: { empresaId: req.user.empresaId },
      orderBy: { competencia: 'desc' },
      include: { _count: { select: { lancamentos: true, pagamentos: true } } },
    });
  });

  /** Abre uma compet\u00eancia (idempotente: reabrir a mesma n\u00e3o cria duplicata). */
  app.post('/rh/folhas', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req: any) => {
    const { competencia, observacoes } = z.object({
      competencia: competenciaSchema,
      observacoes: z.string().optional(),
    }).parse(req.body ?? {});

    const existente = await prisma.folha.findFirst({ where: { empresaId: req.user.empresaId, competencia } });
    if (existente) return existente;

    const folha = await prisma.folha.create({
      data: { empresaId: req.user.empresaId, competencia, observacoes: observacoes || null },
    });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR',
      entidade: 'Folha', entidadeId: folha.id, valorNovo: { competencia }, origem: 'MANUAL', ip: req.ip,
      contexto: `Folha ${competencia} aberta.`,
    });
    return folha;
  });

  /**
   * Detalha da folha com o resumo por funcion\u00e1rio.
   *
   * `statusPagamento` \u00e9 DERIVADO: `ATRASADO` n\u00e3o \u00e9 guardado no banco, porque
   * depende de "hois". Um pagamento pendente vira atrasado sozinho quando a
   * data prevista passa \u2014 sem nenhum job de nightly.
   */
  app.get('/rh/folhas/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req: any) => {
    const folha = await prisma.folha.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
    });
    if (!folha) throw new ErroDeNegocio('Folha n\u00e3o encontrada nesta empresa.', 404);

    const lancamentos = await prisma.lancamentoFolha.findMany({
      where: { folhaId: folha.id },
      orderBy: [{ tipo: 'asc' }, { codigo: 'asc' }],
    });
    const pagamentos = await prisma.pagamentoRH.findMany({ where: { folhaId: folha.id } });
    const porFuncionario = new Map<string, typeof lancamentos>();
    for (const l of lancamentos) {
      const lista = porFuncionario.get(l.funcionarioId) ?? [];
      lista.push(l);
      porFuncionario.set(l.funcionarioId, lista);
    }
    const funcs = await prisma.funcionario.findMany({
      where: { empresaId: req.user.empresaId },
      // `departamento` precisa do `id`: a tela filtra por `departamento.id`, e com
      // apenas o `nome` a comparacao era sempre `undefined !== algumId`, o que
      // zerava a lista inteira sempre que o operador escolhia um departamento.
      select: { id: true, nome: true, matricula: true, salario: true, cargo: { select: { nome: true } }, departamento: { select: { id: true, nome: true } }, idExternoPonto: true },
    });
    const porId = new Map(funcs.map((f) => [f.id, f]));

    const hoje = new Date();
    const linhas = pagamentos.map((p) => {
      const lanca = porFuncionario.get(p.funcionarioId) ?? [];
      const prov = lanca.filter((l) => l.tipo === 'PROVENTO').reduce((s, l) => s + Number(l.valor), 0);
      const desc = lanca.filter((l) => l.tipo === 'DESCONTO').reduce((s, l) => s + Number(l.valor), 0);
      const atrasado = p.status === 'PENDENTE' && p.dataPrevista !== null && p.dataPrevista < hoje;
      return {
        funcionario: porId.get(p.funcionarioId) ?? null,
        lancamentos: lanca,
        totalProventos: Number(prov.toFixed(2)),
        totalDescontos: Number(desc.toFixed(2)),
        liquido: Number((prov - desc).toFixed(2)),
        pagamento: p,
        statusPagamento: p.status === 'PAGO' ? 'PAGO' : atrasado ? 'ATRASADO' : 'PENDENTE',
      };
    });

    return {
      folha,
      linhas,
      fgts: {
        apurado: false,
        observacao: 'FGTS e multa dependem do saldo depositado do funcion\u00e1rio, que o NEXUS ainda n\u00e3o registra.',
      },
    };
  });

  // ==========================================================================
  //  Processamento
  // ==========================================================================

  /**
   * Processa a folha: roda o c\u00e1lculo de todos os funcion\u00e1rios ativos.
   *
   * Considera quem estava ATIVO na compet\u00eancia. Funcion\u00e1rio desligado antes
   * do m\u00eas n\u00e3o entra; desligado durante o m\u00eas entra (recebeu o sal\u00e1rio do
   * per\u00edodo trabalhado). Isso evita dar folha a quem j\u00e1 saiu e tamb\u00e9m
   * omite quem foi desligado depois e ainda tem folha hist\u00f3rica preservada.
   */
  app.post('/rh/folhas/:id/processar', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req: any) => {
    const folha = await prisma.folha.findFirst({ where: { id: req.params.id, empresaId: req.user.empresaId } });
    if (!folha) throw new ErroDeNegocio('Folha n\u00e3o encontrada nesta empresa.', 404);
    if (folha.status === 'FECHADA') throw new ErroDeNegocio('Folha fechada n\u00e3o pode ser reprocessada.', 409);

    const { inicio, fim } = intervaloDaCompetencia(folha.competencia);
    const ativos = await prisma.funcionario.findMany({
      where: {
        empresaId: req.user.empresaId,
        status: { notIn: ['ARQUIVADO', 'DESLIGADO'] },
      },
      // `dataAdmissao` e consultada porque o filtro ABAIXO depende dela: sem esta
      // coluna, um funcionario admitido depois da competencia entraria na folha e
      // receberia salario cheio por um mes em que nao existia na empresa.
      select: { id: true, dataAdmissao: true, dataDesligamento: true },
    });
    /**
     * Quem estava de fato na empresa durante a competencia.
     *
     * Entrou ANTES do fim do mes E, se desligou, so saiu depois do inicio dele.
     * As duas condicoes sao necessarias, e o filtro original so checava a
     * segunda: `dataAdmissao` nunca era comparada. Admitir alguem em 10/10 e
     * processar a folha de setembro pagava um mes inteiro a quem nao tinha
     * vinculo com a empresa naquele mes.
     *
     * As datas sao `@db.Date`: chegam como meia-noite UTC. A comparacao usa os
     * mesmos limites UTC, sem passar por `getFullYear()`/`getMonth()`, que
     * converteriam para o fuso local do servidor e deslocariam a data em um dia.
     */
    const naCompetencia = ativos.filter(
      (f) =>
        (!f.dataAdmissao || f.dataAdmissao < fim) &&
        (!f.dataDesligamento || f.dataDesligamento >= inicio),
    );

    for (const f of naCompetencia) await recalcularFuncionario(folha.id, req.user.empresaId, f.id);

    const atualizada = await prisma.folha.update({
      where: { id: folha.id },
      data: { status: 'PROCESSADA', dataProcessamento: new Date() },
    });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'ALTERAR_CONFIG',
      entidade: 'Folha', entidadeId: folha.id, origem: 'MANUAL', ip: req.ip,
      contexto: `Folha ${folha.competencia} processada para ${naCompetencia.length} funcion\u00e1rio(s).`,
    });
    return { ...atualizada, processados: naCompetencia.length };
  });

  // ==========================================================================
  //  Lan\u00e7amentos
  // ==========================================================================

  /** Lan\u00e7a um provento ou desconto manual. */
  app.post('/rh/folhas/:id/lancamentos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req: any) => {
    const folha = await prisma.folha.findFirst({ where: { id: req.params.id, empresaId: req.user.empresaId } });
    if (!folha) throw new ErroDeNegocio('Folha n\u00e3o encontrada nesta empresa.', 404);
    if (folha.status === 'FECHADA') throw new ErroDeNegocio('Folha fechada: lan\u00e7amentos n\u00e3o podem ser alterados.', 409);

    const d = z.object({
      funcionarioId: z.string().min(1),
      codigo: z.string().min(1).max(30),
      descricao: z.string().min(2).max(140),
      tipo: z.enum(['PROVENTO', 'DESCONTO']),
      valor: z.number().positive('O valor precisa ser maior que zero.'),
      referencia: z.number().nullable().optional(),
      observacoes: z.string().optional(),
    }).parse(req.body ?? {});

    const func = await prisma.funcionario.findFirst({
      where: { id: d.funcionarioId, empresaId: req.user.empresaId },
      select: { id: true, nome: true, salario: true },
    });
    if (!func) throw new ErroDeNegocio('Funcion\u00e1rio n\u00e3o encontrado nesta empresa.', 404);

    const lancamento = await prisma.lancamentoFolha.create({
      data: {
        empresaId: req.user.empresaId, folhaId: folha.id, funcionarioId: d.funcionarioId,
        codigo: d.codigo, descricao: d.descricao, tipo: d.tipo,
        referencia: d.referencia ?? null, valor: d.valor,
        observacoes: d.observacoes || null, origem: 'MANUAL',
      },
    });
    // Recalcula para o l\u00edquido incluir o lan\u00e7amento rec\u00e9m-digitado.
    const apuracao = await recalcularFuncionario(folha.id, req.user.empresaId, d.funcionarioId);
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR',
      entidade: 'LancamentoFolha', entidadeId: lancamento.id,
      valorNovo: { codigo: d.codigo, tipo: d.tipo, valor: d.valor, funcionario: func.nome },
      origem: 'MANUAL', ip: req.ip,
      contexto: `Lan\u00e7amento ${d.codigo} na folha ${folha.competencia}.`,
    });
    return { lancamento, apuracao };
  });

  /** Remove um lan\u00e7amento manual (automaticos s\u00e3o reprocessados). */
  app.delete('/rh/folhas/lancamentos/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'excluir')] }, async (req: any) => {
    const alvo = await prisma.lancamentoFolha.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
      include: { folha: { select: { status: true, id: true } } },
    });
    if (!alvo) throw new ErroDeNegocio('Lan\u00e7amento n\u00e3o encontrado nesta empresa.', 404);
    if (alvo.folha.status === 'FECHADA') throw new ErroDeNegocio('Folha fechada: lan\u00e7amentos n\u00e3o podem ser removidos.', 409);
    if (alvo.origem !== 'MANUAL') throw new ErroDeNegocio('Lan\u00e7amento autom\u00e1tico n\u00e3o pode ser removido \u2014 ele \u00e9 recalculado. Remova a origem do dado.', 409);

    await prisma.lancamentoFolha.delete({ where: { id: alvo.id } });
    await recalcularFuncionario(alvo.folhaId, req.user.empresaId, alvo.funcionarioId);
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EXCLUIR',
      entidade: 'LancamentoFolha', entidadeId: alvo.id,
      valorAnterior: { codigo: alvo.codigo, valor: String(alvo.valor) },
      origem: 'MANUAL', ip: req.ip, contexto: `Lan\u00e7amento ${alvo.codigo} removido.`,
    });
    return { ok: true };
  });

  // ==========================================================================
  //  Pagamento
  // ==========================================================================

  /** Registra/altera o pagamento de um funcion\u00e1rio na compet\u00eancia. */
  app.put('/rh/folhas/:id/pagamentos/:funcionarioId', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'editar')] }, async (req: any) => {
    const folha = await prisma.folha.findFirst({ where: { id: req.params.id, empresaId: req.user.empresaId } });
    if (!folha) throw new ErroDeNegocio('Folha n\u00e3o encontrada nesta empresa.', 404);
    if (folha.status === 'FECHADA') throw new ErroDeNegocio('Folha fechada: o pagamento n\u00e3o pode ser alterado.', 409);

    const alvo = await prisma.pagamentoRH.findFirst({
      where: { folhaId: folha.id, funcionarioId: req.params.funcionarioId, empresaId: req.user.empresaId },
    });
    if (!alvo) throw new ErroDeNegocio('Pagamento n\u00e3o encontrado para este funcion\u00e1rio na compet\u00eancia.', 404);

    const d = z.object({
      status: z.enum(['PENDENTE', 'PAGO']).optional(),
      dataPrevista: z.string().nullable().optional(),
      dataPagamento: z.string().nullable().optional(),
      formaPagamento: z.string().max(40).nullable().optional(),
      valorPago: z.number().min(0).nullable().optional(),
      observacoes: z.string().max(500).nullable().optional(),
      documentoId: z.string().nullable().optional(),
    }).parse(req.body ?? {});

    const dataDe = (v: string | null | undefined) => (v ? new Date(`${v}T12:00:00`) : null);

    // Comprovante precisa existir e ser desta empresa \u2014 s\u00f3 o id chega do cliente.
    if (d.documentoId) {
      const doc = await prisma.documento.findFirst({ where: { id: d.documentoId, empresaId: req.user.empresaId } });
      if (!doc) throw new ErroDeNegocio('Comprovante n\u00e3o encontrado nesta empresa.', 404);
    }

    // Se est\u00e1 marcando como pago sem data, usa hoje: data de pagamento vazia em
    // holerito pago \u00e9 o tipo de coisa que o RH precisa corrigir depois.
    const marcandoPago = d.status === 'PAGO' && alvo.status !== 'PAGO';
    //
    // ESTORNAR tem de apagar a data do pagamento.
    //
    // Voltar para PENDENTE sem limpar `dataPagamento` deixava a linha mostrando
    // "Pago em 14/09/2026" ao lado do status PENDENTE: dois estados
    // contraditorios na mesma tela. O recibo em PDF nao mentia (ele le o
    // `status`), mas a tela mostrava a data de um pagamento que ja nao valia.
    //
    // A limpeza so acontece quando o proprio pedido traz `status: PENDENTE` e
    // nao manda `dataPagamento`: quem estorna continua podendo informar uma
    // data (ex.: o pagamento foi feito e depois desfeito) ou, se nao mandar,
    // o registro volta a um estado coerente.
    const estornando = d.status === 'PENDENTE' && alvo.status === 'PAGO';
    const LIMPAR = null;
    const atualizado = await prisma.pagamentoRH.update({
      where: { id: alvo.id },
      data: {
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.dataPrevista !== undefined ? { dataPrevista: dataDe(d.dataPrevista) } : {}),
        ...(d.dataPagamento !== undefined ? { dataPagamento: dataDe(d.dataPagamento) } : {}),
        // Estorno sem data informada zera a data; com data informada, o cliente
        // manda a data e ela vale.
        ...(estornando && d.dataPagamento === undefined ? { dataPagamento: LIMPAR } : {}),
        ...(d.formaPagamento !== undefined ? { formaPagamento: d.formaPagamento } : {}),
        ...(d.valorPago !== undefined ? { valorPago: d.valorPago } : {}),
        ...(d.observacoes !== undefined ? { observacoes: d.observacoes } : {}),
        ...(d.documentoId !== undefined ? { documentoId: d.documentoId } : {}),
        ...(marcandoPago && !alvo.dataPagamento ? { dataPagamento: new Date() } : {}),
      },
    });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR',
      entidade: 'PagamentoRH', entidadeId: atualizado.id,
      valorAnterior: { status: alvo.status, dataPagamento: alvo.dataPagamento ? String(alvo.dataPagamento) : null },
      valorNovo: { status: atualizado.status, dataPagamento: atualizado.dataPagamento ? String(atualizado.dataPagamento) : null },
      origem: 'MANUAL', ip: req.ip, contexto: `Pagamento atualizado na folha ${folha.competencia}.`,
    });
    return atualizado;
  });

  // ==========================================================================
  //  Fechamento
  // ==========================================================================

  /** Prévia do fechamento \u2014 o mesmo resumo que a confirmação mostra. */
  app.get('/rh/folhas/:id/fechamento', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req: any) => {
    const folha = await prisma.folha.findFirst({ where: { id: req.params.id, empresaId: req.user.empresaId } });
    if (!folha) throw new ErroDeNegocio('Folha n\u00e3o encontrada nesta empresa.', 404);
    const pagamentos = await prisma.pagamentoRH.findMany({ where: { folhaId: folha.id } });
    const pagos = pagamentos.filter((p) => p.status === 'PAGO').length;
    return {
      competencia: folha.competencia,
      status: folha.status,
      funcionarios: pagamentos.length,
      totalProventos: folha.totalProventos,
      totalDescontos: folha.totalDescontos,
      totalLiquido: folha.totalLiquido,
      quantidadePaga: pagos,
      quantidadePendente: pagamentos.length - pagos,
    };
  });

  /**
   * Fecha a folha.
   *
   * Depois de fechada, lan\u00e7amentos e pagamentos ficam bloqueados (409). O
   * hist\u00f3rico nunca \u00e9 apagado \u2014 fechar grava `dataFechamento` e muda o
   * status, nada mais.
   */
  app.post('/rh/folhas/:id/fechar', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'excluir')] }, async (req: any) => {
    const folha = await prisma.folha.findFirst({ where: { id: req.params.id, empresaId: req.user.empresaId } });
    if (!folha) throw new ErroDeNegocio('Folha n\u00e3o encontrada nesta empresa.', 404);
    if (folha.status === 'FECHADA') throw new ErroDeNegocio('Esta folha j\u00e1 est\u00e1 fechada.', 409);

    const lancamentos = await prisma.lancamentoFolha.findMany({ where: { folhaId: folha.id } });
    if (lancamentos.length === 0) throw new ErroDeNegocio('Folha sem lan\u00e7amentos: processe antes de fechar.', 409);
    await atualizarTotaisDaFolha(folha.id, req.user.empresaId);

    const fechada = await prisma.folha.update({
      where: { id: folha.id },
      data: { status: 'FECHADA', dataFechamento: new Date(), fechadaPorId: req.user.id },
    });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'ALTERAR_CONFIG',
      entidade: 'Folha', entidadeId: folha.id,
      valorAnterior: { status: folha.status },
      valorNovo: { status: 'FECHADA' }, origem: 'MANUAL', ip: req.ip,
      contexto: `Folha ${folha.competencia} fechada.`,
    });
    return fechada;
  });

  /**
   * Reabre uma folha fechada.
   *
   * Exige permiss\u00e3o de `rh:excluir` \u2014 mesma permiss\u00e3o do fechamento. N\u00e3o \u00e9 um
   * "desfazer" silencioso: fica registrado quem reabriu e quando.
   */
  app.post('/rh/folhas/:id/reabrir', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'excluir')] }, async (req: any) => {
    const { motivo } = z.object({ motivo: z.string().min(5, 'Informe o motivo da reabertura.') }).parse(req.body ?? {});
    const folha = await prisma.folha.findFirst({ where: { id: req.params.id, empresaId: req.user.empresaId } });
    if (!folha) throw new ErroDeNegocio('Folha n\u00e3o encontrada nesta empresa.', 404);
    if (folha.status !== 'FECHADA') throw new ErroDeNegocio('Esta folha n\u00e3o est\u00e1 fechada.', 409);

    const reaberta = await prisma.folha.update({
      where: { id: folha.id },
      data: { status: 'PROCESSADA', dataFechamento: null, fechadaPorId: null },
    });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'ALTERAR_CONFIG',
      entidade: 'Folha', entidadeId: folha.id,
      valorAnterior: { status: 'FECHADA' }, valorNovo: { status: 'PROCESSADA', motivo },
      origem: 'MANUAL', ip: req.ip, contexto: `Folha ${folha.competencia} reaberta. Motivo: ${motivo}`,
    });
    return reaberta;
  });

  // ==========================================================================
  //  Documentos
  // ==========================================================================

  /** Recibo/holerite em PDF com os valores REAIS do banco. */
  app.get('/rh/folhas/:id/recibo/:funcionarioId', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req: any, reply: any) => {
    const folha = await prisma.folha.findFirst({ where: { id: req.params.id, empresaId: req.user.empresaId } });
    if (!folha) throw new ErroDeNegocio('Folha n\u00e3o encontrada nesta empresa.', 404);
    const func = await prisma.funcionario.findFirst({
      where: { id: req.params.funcionarioId, empresaId: req.user.empresaId },
      include: { cargo: true, departamento: true },
    });
    if (!func) throw new ErroDeNegocio('Funcion\u00e1rio n\u00e3o encontrado nesta empresa.', 404);

    const [empresa, lancamentos, pagamento] = await Promise.all([
      empresaDoUsuario(req.user.empresaId),
      prisma.lancamentoFolha.findMany({ where: { folhaId: folha.id, funcionarioId: func.id } }),
      prisma.pagamentoRH.findFirst({ where: { folhaId: folha.id, funcionarioId: func.id } }),
    ]);
    const prov = lancamentos.filter((l) => l.tipo === 'PROVENTO').reduce((s, l) => s + Number(l.valor), 0);
    const desc = lancamentos.filter((l) => l.tipo === 'DESCONTO').reduce((s, l) => s + Number(l.valor), 0);
    const liquido = prov - desc;

    const blocos: Bloco[] = [
      { texto: '1. EMPREGADOR', negrito: true, espacoAntes: 0 },
      { texto: `Raz\u00e3o social: ${(empresa as any)?.razaoSocial || (empresa as any)?.nome || '\u2014'}`, espacoAntes: 6 },
      { texto: `CNPJ: ${(empresa as any)?.cnpj || '\u2014'}`, espacoAntes: 4 },
      { texto: '2. EMPREGADO', negrito: true, espacoAntes: 16 },
      { texto: `Nome: ${func.nome}`, espacoAntes: 6 },
      { texto: `Matr\u00edcula: ${func.matricula ?? '\u2014'}`, espacoAntes: 4 },
      { texto: `Cargo: ${func.cargo?.nome ?? '\u2014'}`, espacoAntes: 4 },
      { texto: `Departamento: ${func.departamento?.nome ?? '\u2014'}`, espacoAntes: 4 },
      { texto: `Compet\u00eancia: ${folha.competencia}`, espacoAntes: 4 },
      { texto: `Sal\u00e1rio-base: ${valorBr(func.salario)}`, espacoAntes: 4 },
      { texto: '3. LAN\u00c7AMENTOS', negrito: true, espacoAntes: 16 },
    ];
    for (const l of lancamentos) {
      blocos.push({ texto: `${l.codigo} \u2014 ${l.descricao}: ${valorBr(l.valor)}`, espacoAntes: 4 });
    }
    blocos.push(
      { texto: `TOTAL DE PROVENTOS: ${valorBr(prov)}`, negrito: true, espacoAntes: 12 },
      { texto: `TOTAL DE DESCONTOS: ${valorBr(desc)}`, espacoAntes: 4 },
      { texto: `SAL\u00c1RIO L\u00cdQUIDO: ${valorBr(liquido)}`, negrito: true, espacoAntes: 6 },
      { texto: `Situa\u00e7\u00e3o: ${pagamento?.status === 'PAGO' ? `Pago em ${dataBr(pagamento.dataPagamento)}` : 'Pendente'}`, espacoAntes: 8 },
      { texto: 'FGTS e multa n\u00e3o apurados: dependem do saldo depositado do FGTS, que deve ser conferido no extrato da conta vinculada.', espacoAntes: 8, tamanho: 9 },
      { texto: '_______________________________________     _______________________________________', espacoAntes: 30, tamanho: 10, semQuebra: true },
      { texto: 'O empregado                                Respons\u00e1vel pelo RH', espacoAntes: 6, tamanho: 9, semQuebra: true },
    );

    const nome = `Recibo-${func.nome.replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}-${folha.competencia}.pdf`;
    const pdf = gerarPdf({
      titulo: 'RECIBO DE SAL\u00c1RIO',
      subtitulo: `Compet\u00eancia ${folha.competencia}`,
      rodape: `Gerado em ${dataBr(new Date())} por NEXUS OS.`,
      blocos,
    });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR',
      entidade: 'Folha', entidadeId: folha.id, origem: 'MANUAL', ip: req.ip,
      contexto: `Recibo gerado para ${func.nome} (${folha.competencia}).`,
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${nome}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(pdf);
  });

  /** Folha completa da compet\u00eancia em PDF. */
  app.get('/rh/folhas/:id/completa', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req: any, reply: any) => {
    const folha = await prisma.folha.findFirst({ where: { id: req.params.id, empresaId: req.user.empresaId } });
    if (!folha) throw new ErroDeNegocio('Folha n\u00e3o encontrada nesta empresa.', 404);
    const pagamentos = await prisma.pagamentoRH.findMany({ where: { folhaId: folha.id } });
    const funcs = await prisma.funcionario.findMany({ where: { empresaId: req.user.empresaId }, select: { id: true, nome: true, matricula: true } });
    const porId = new Map(funcs.map((f) => [f.id, f]));
    const lanc = await prisma.lancamentoFolha.findMany({ where: { folhaId: folha.id } });

    const blocos: Bloco[] = [
      { texto: `Folha de pagamento \u2014 compet\u00eancia ${folha.competencia}`, negrito: true, espacoAntes: 0 },
      { texto: `Situa\u00e7\u00e3o: ${folha.status}`, espacoAntes: 4 },
      { texto: `Total de proventos: ${valorBr(folha.totalProventos)}`, espacoAntes: 4 },
      { texto: `Total de descontos: ${valorBr(folha.totalDescontos)}`, espacoAntes: 4 },
      { texto: `Total l\u00edquido: ${valorBr(folha.totalLiquido)}`, negrito: true, espacoAntes: 4 },
      { texto: 'LAN\u00c7AMENTOS POR FUNCION\u00c1RIO', negrito: true, espacoAntes: 16 },
    ];
    for (const p of pagamentos) {
      const lanca = lanc.filter((l) => l.funcionarioId === p.funcionarioId);
      const prov = lanca.filter((l) => l.tipo === 'PROVENTO').reduce((s, l) => s + Number(l.valor), 0);
      const desc = lanca.filter((l) => l.tipo === 'DESCONTO').reduce((s, l) => s + Number(l.valor), 0);
      blocos.push({ texto: `${porId.get(p.funcionarioId)?.nome ?? '\u2014'} (${porId.get(p.funcionarioId)?.matricula ?? 's/ matr\u00edcula'}) \u2014 proventos ${valorBr(prov)} | descontos ${valorBr(desc)} | l\u00edquido ${valorBr(prov - desc)} | ${p.status}`, espacoAntes: 8, tamanho: 9 });
    }
    blocos.push({ texto: 'FGTS e multa n\u00e3o apurados: dependem do saldo depositado do FGTS.', espacoAntes: 16, tamanho: 9 });

    const nome = `Folha-${folha.competencia}.pdf`;
    const pdf = gerarPdf({
      titulo: 'FOLHA DE PAGAMENTO',
      rodape: `Gerado em ${dataBr(new Date())} por NEXUS OS.`,
      blocos,
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${nome}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(pdf);
  });

  // ==========================================================================
  //  13\u00ba salario
  // ==========================================================================

  /** Lista o 13\u00ba por ano, com meses de direito derivados da admiss\u00e3o REAL. */
  app.get('/rh/decimo-terceiro', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req: any) => {
    const { ano } = z.object({ ano: z.coerce.number().int().min(2000).max(2100) }).parse(req.query ?? {});
    const registros = await prisma.decimoTerceiro.findMany({
      where: { empresaId: req.user.empresaId, ano },
      orderBy: { funcionarioId: 'asc' },
    });
    const funcs = await prisma.funcionario.findMany({
      where: { empresaId: req.user.empresaId },
      select: { id: true, nome: true, matricula: true, salario: true, dataAdmissao: true, dataDesligamento: true },
    });
    return registros.map((r) => {
      const f = funcs.find((x) => x.id === r.funcionarioId);
      return { ...r, funcionario: f ?? null };
    });
  });

  /** Gera a cobran\u00e7a de 13\u00ba do ano, com proporcionalidade pela data de admiss\u00e3o. */
  app.post('/rh/decimo-terceiro/gerar', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req: any) => {
    const { ano } = z.object({ ano: z.coerce.number().int().min(2000).max(2100) }).parse(req.body ?? {});
    const fimDoAno = new Date(Date.UTC(ano, 11, 31));
    const funcs = await prisma.funcionario.findMany({
      where: { empresaId: req.user.empresaId, status: { notIn: ['ARQUIVADO'] } },
      select: { id: true, nome: true, salario: true, dataAdmissao: true, dataDesligamento: true },
    });

    const criados: string[] = [];
    for (const f of funcs) {
      // Trabalhou no ano? S\u00f3 tem 13\u00ba quem laborou at\u00e9 31/12 (ou foi
      // desligado dentro do ano \u2014 nesse caso recebe o proporcional).
      if (f.dataAdmissao && f.dataAdmissao > fimDoAno) continue;
      if (f.dataDesligamento && f.dataDesligamento < new Date(Date.UTC(ano, 0, 1))) continue;

      const salario = Number(f.salario ?? 0);
      if (salario <= 0) continue; // Sem sal\u00e1rio cadastrado, geraria zero.

      // Meses de direito: proporcional pela admiss\u00e3o, o mesmo crit\u00e9rio do
      // 13\u00ba na rescis\u00e3o (`lib/verbas.ts`), para n\u00e3o haver diverg\u00eancia.
      let meses = 12;
      if (f.dataAdmissao) {
        // `getUTCFullYear()`/`getUTCMonth()` e obrigatorio: `dataAdmissao` e
        // `@db.Date` (volta como meia-noite UTC) e `fimDoAno` foi montado com
        // `Date.UTC`. Usar os getters locais converteria as duas para o fuso do
        // servidor e, em UTC-3, 01/01 leria como 31/12 do ano anterior.
        const mesesNoAno = (fimDoAno.getUTCFullYear() - f.dataAdmissao.getUTCFullYear()) * 12
          + (fimDoAno.getUTCMonth() - f.dataAdmissao.getUTCMonth()) + 1;
        meses = Math.max(1, Math.min(12, mesesNoAno));
      }
      const bruto = Number(((salario / 12) * meses).toFixed(2));
      const primeiraParcela = bruto > 0 ? Number((bruto / 2).toFixed(2)) : 0;

      const registro = await prisma.decimoTerceiro.upsert({
        where: { id: `${req.user.empresaId}-${ano}-${f.id}` },
        create: {
          id: `${req.user.empresaId}-${ano}-${f.id}`,
          empresaId: req.user.empresaId, funcionarioId: f.id, ano,
          salarioBase: salario, mesesDireito: meses,
          valorBruto: bruto, valorPrimeiraParcela: primeiraParcela,
          valorSegundaParcela: Number((bruto - primeiraParcela).toFixed(2)),
          valorLiquido: bruto, fgtsReferencia: 0.08, saldoFgts: null,
        },
        // Reprocessar atualiza valores SEM perder parcelas j\u00e1 pagas.
        update: {
          salarioBase: salario, mesesDireito: meses, valorBruto: bruto,
          valorPrimeiraParcela: primeiraParcela,
          valorSegundaParcela: Number((bruto - primeiraParcela).toFixed(2)),
        },
      });
      criados.push(registro.id);
    }
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR',
      entidade: 'DecimoTerceiro', origem: 'MANUAL', ip: req.ip,
      contexto: `13\u00ba de ${ano} gerado para ${criados.length} funcion\u00e1rio(s).`,
    });
    return { ano, gerados: criados.length };
  });

  /** Registra o pagamento de uma parcela do 13\u00ba. */
  app.put('/rh/decimo-terceiro/:id/pagamento', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'editar')] }, async (req: any) => {
    const { parcela, dataPagamento, observacoes } = z.object({
      parcela: z.enum(['PRIMEIRA', 'SEGUNDA']),
      dataPagamento: z.string().optional(),
      observacoes: z.string().max(500).optional(),
    }).parse(req.body ?? {});

    const alvo = await prisma.decimoTerceiro.findFirst({ where: { id: req.params.id, empresaId: req.user.empresaId } });
    if (!alvo) throw new ErroDeNegocio('Registro de 13\u00ba n\u00e3o encontrado nesta empresa.', 404);
    const data = dataPagamento ? new Date(`${dataPagamento}T12:00:00`) : new Date();

    const atualizado = await prisma.decimoTerceiro.update({
      where: { id: alvo.id },
      data: parcela === 'PRIMEIRA'
        ? { dataPrimeiraParcela: data, status: alvo.dataSegundaParcela ? 'PAGO' : 'PRIMEIRA_PAGA' }
        : { dataSegundaParcela: data, status: 'PAGO' },
    });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR',
      entidade: 'DecimoTerceiro', entidadeId: alvo.id,
      valorAnterior: { status: alvo.status },
      valorNovo: { status: atualizado.status, parcela },
      origem: 'MANUAL', ip: req.ip, contexto: `Parcela ${parcela} do 13\u00ba paga.`,
    });
    return atualizado;
  });
}
