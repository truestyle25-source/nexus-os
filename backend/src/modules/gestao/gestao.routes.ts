
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';

/**
 * Categorias de lançamento que entram como DEDUÇÃO DA RECEITA, e não como
 * despesa operacional.
 *
 * A comparação é feita em minúsculas e sem acento de propósito: a categoria é
 * texto digitado (`POST /financeiro` aceita qualquer string com 2+ caracteres),
 * então "Impostos", "impostos" e "IMPOSTOS" precisam cair na mesma regra. Antes
 * a checagem era `categoria === 'impostos'` — sensível a caixa e a acento, e a
 * mesma lista aparecia repetida em três lugares do cálculo, onde qualquer
 * divergência viraria dedução contada duas vezes (ou nunca contada).
 *
 * Categoria que não for desta lista é despesa operacional — que é o padrão
 * seguro: um erro de digitação vira despesa, não um ajuste na receita bruta.
 */
const CATEGORIAS_DEDUCAO = ['deducoes', 'imposto', 'impostos', 'devolucao', 'devolucoes'];

/** Normaliza a categoria para comparar (minúsculas, sem acento). */
const chaveCategoria = (c: string): string =>
  c
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Verdadeiro quando o lançamento é dedução da receita. */
const ehDeducao = (categoria: string): boolean =>
  CATEGORIAS_DEDUCAO.includes(chaveCategoria(categoria));

export async function gestaoRoutes(app: FastifyInstance) {
  // Financeiro completo Seção 15
  //
  // LIMITE E HONESTIDADE DO CORTE
  // ------------------------------
  // A lista vem limitada a 200 lançamentos (a mais recente primeiro). Antes
  // esse corte era SILENCIOSO: uma empresa com 900 lançamentos no período via
  // 200 na tela, mas os totais eram calculados só sobre esses 200 — o KPI
  // "Receitas" ficava errado e, pior, sem nenhum aviso de que estava cortado.
  // Era exatamente o defeito que o módulo de Ponto já resolveu com
  // `X-Truncated`/`X-Total-Count`; aqui o mesmo aviso é aplicado, e os totais
  // passam a ser calculados sobre o conjunto INTEIRO do filtro (aggregate),
  // não sobre a página exibida.
  app.get('/financeiro', { preHandler: [(app as any).authenticate, await permissaoMiddleware('financeiro', 'visualizar')] }, async (req:any, reply:any) => {
    const { tipo, status, periodoInicio, periodoFim } = req.query as any;
    const where:any = { empresaId: req.user.empresaId };
    if (tipo) where.tipo = tipo;
    // `VENCIDO` é DERIVADO (abaixo), nunca gravado. Filtrar por ele no banco
    // como `status = 'VENCIDO'` nunca encontraria nada, porque o valor real é
    // PENDENTE — o filtro "Vencido" voltaria vazio mesmo com contas vencidas na
    // tela. Por isso ele vira uma condição sobre `vencimento`.
    //
    // O mesmo vale para o filtro inverso: "PENDENTE" precisa SIGNIFICAR
    // "em aberto e ainda não vencido". Sem a exclusão por vencimento, um
    // PENDENTE vencido entrava nos DOIS filtros ao mesmo tempo, mas era
    // rotulado VENCIDO na resposta — o filtro "Pendente" mostrava um item que
    // a própria tela insistia em chamar de Vencido. Filtro e rótulo precisam
    // contar a mesma história.
    const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0);
    if (status === 'VENCIDO') {
      where.status = 'PENDENTE';
      where.vencimento = { lt: hoje0 };
    } else if (status === 'PENDENTE') {
      where.status = 'PENDENTE';
      // Sem vencimento definido a conta não é vencida: o `OR` traz as que
      // ainda não venceram e as que vieram sem data.
      where.OR = [{ vencimento: { gte: hoje0 } }, { vencimento: null }];
    } else if (status) {
      where.status = status;
    }
    if (periodoInicio && periodoFim) where.createdAt = { gte: new Date(periodoInicio), lte: new Date(periodoFim) };

    const LIMITE = 200;
    const lancamentosBrutos = await prisma.financeiro.findMany({ where, orderBy: { createdAt: 'desc' }, take: LIMITE });

    // ── STATUS DERIVADO (VENCIDO) ────────────────────────────────────────
    // `VENCIDO` existe no enum do Prisma e aparece no filtro da tela, mas
    // NADA o escrevia: o `POST /financeiro` grava o que o corpo manda, o
    // frontend manda sempre PENDENTE, e não há job que vire o status. O filtro
    // "Vencido" portanto devolvia vazio para sempre, e o gráfico de "Atrasadas"
    // só funcionava por causa de uma conta de dias calculada no navegador.
    //
    // Em vez de inventar um agendador, o status de exibição é DERIVADO na
    // leitura: um PENDENTE cujo vencimento já passou responde como VENCIDO.
    // Isso não grava nada no banco (o valor real continua PENDENTE, e é isso
    // que o fluxo de caixa usa para projetar) — apenas passa a refletir a
    // realidade que o usuário já via na coluna de atraso.
    const lancamentos = lancamentosBrutos.map((l: any) => {
      const vencido =
        l.status === 'PENDENTE' && l.vencimento !== null && l.vencimento < hoje0;
      return vencido ? { ...l, status: 'VENCIDO' } : l;
    });

    // Totais do PERÍODO INTEIRO, somados no banco (aggregate). Somar em JS
    // sobre os 200 truncados daria um número errado silenciosamente sempre que
    // houvesse mais de 200 lançamentos no filtro.
    const [agReceitas, agDespesas, totalPeriodo] = await Promise.all([
      prisma.financeiro.aggregate({ where: { ...where, tipo: 'RECEITA' }, _sum: { valor: true } }),
      prisma.financeiro.aggregate({ where: { ...where, tipo: 'DESPESA' }, _sum: { valor: true } }),
      prisma.financeiro.count({ where }),
    ]);
    const receitas = Number(agReceitas._sum.valor ?? 0);
    const despesas = Number(agDespesas._sum.valor ?? 0);
    const resultado = receitas - despesas;

    // Sinaliza o corte para a tela avisar (mesmo contrato de /ponto).
    reply.header('X-Total-Count', String(totalPeriodo));
    if (totalPeriodo > lancamentosBrutos.length) reply.header('X-Truncated', 'true');

    // Contas a pagar/receber: VALORES em aberto, não quantidade de registros.
    // O nome da chave é `contasAPagar`/`contasAReceber` e é usada como dinheiro
    // — antes vinha `count()`, que é a QUANTIDADE de lançamentos, então o
    // mesmo nome devolvia duas grandezas diferentes conforme o contexto.
    // Essas duas NÃO são filtradas por período: uma conta a pagar vence na data
    // dela, e um filtro por data de criação esconderia o que está vencido hoje.
    const [abertoPagar, abertoReceber] = await Promise.all([
      prisma.financeiro.aggregate({
        where: { empresaId: req.user.empresaId, tipo: 'DESPESA', status: { in: ['PENDENTE', 'VENCIDO'] } },
        _sum: { valor: true },
      }),
      prisma.financeiro.aggregate({
        where: { empresaId: req.user.empresaId, tipo: 'RECEITA', status: { in: ['PENDENTE', 'VENCIDO'] } },
        _sum: { valor: true },
      }),
    ]);

    return {
      lancamentos,
      fluxo: {
        receitas,
        despesas,
        resultado,
        contasAPagar: Number(abertoPagar._sum.valor ?? 0),
        contasAReceber: Number(abertoReceber._sum.valor ?? 0),
      },
    };
  });

  app.post('/financeiro', { preHandler: [(app as any).authenticate, await permissaoMiddleware('financeiro', 'criar')] }, async (req:any) => {
    const schema = z.object({
      tipo: z.enum(['RECEITA','DESPESA']),
      categoria: z.string().min(2), // vendas, fornecedores, salarios, servicos, impostos, operacionais
      centroCusto: z.string().optional(),
      descricao: z.string().min(2),
      // `valor` é `Decimal @db.Decimal(12, 2)` no schema: até 9.999.999.999,99.
      // Sem este teto, um valor maior passava pelo zod e quebrava DENTRO do
      // Prisma, devolvendo um erro interno genérico em vez de dizer ao usuário
      // que o valor não cabe no campo. `finite` barra `NaN`/`Infinity`, que o
      // `JSON.stringify` do navegador também não pode gerar.
      valor: z.number().positive().finite().max(9_999_999_999.99),
      // Data de vencimento precisa ser uma data REAL. `z.string()` aceitava
      // "abc" e virava `new Date("abc")` → `Invalid Date`, que o Prisma
      // rejeitava com erro interno. Aceita o ISO que o frontend envia e o
      // formato `YYYY-MM-DD` do `<input type="date">`.
      vencimento: z
        .string()
        .optional()
        .refine((v) => v === undefined || !Number.isNaN(new Date(v).getTime()), {
          message: 'Vencimento inválido. Use uma data real.',
        }),
      status: z.enum(['PENDENTE','PAGO','VENCIDO','CANCELADO']).default('PENDENTE'),
      origem: z.enum(['MANUAL','IMPORTADO','API','AUTOMATICO']).default('MANUAL')
    });
    const data = schema.parse(req.body);
    const fin = await prisma.financeiro.create({
      data: {
        empresaId: req.user.empresaId,
        tipo: data.tipo as any,
        categoria: data.categoria,
        centroCusto: data.centroCusto,
        descricao: data.descricao,
        valor: data.valor,
        vencimento: data.vencimento ? new Date(data.vencimento) : null,
        status: data.status as any,
        origem: data.origem as any
      }
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'Financeiro', entidadeId: fin.id, valorNovo: fin, origem: data.origem as any, ip: req.ip });
    return fin;
  });

  // Fluxo de caixa (item do menu "Fluxo" — antes não existia nenhum
  // endpoint pra isso; /financeiro já devolvia um resumo, mas não a
  // série diária de entradas/saídas/saldo que "fluxo de caixa" pede).
  // Série diária por DIA LOCAL DA EMPRESA (ver `diaDe` abaixo) — não por dia UTC.
  // Entradas/saídas realizadas = lançamentos com status PAGO no período.
  // Projeção = PENDENTES com vencimento em até +30 dias (vencidos inclusos).
  // Período por `periodoInicio`/`periodoFim` (offset real enviado pela tela);
  // sem período, assume o mês corrente.
  app.get('/fluxo-caixa', { preHandler: [(app as any).authenticate, await permissaoMiddleware('financeiro', 'visualizar')] }, async (req:any, reply:any) => {
    // `periodoInicio`/`periodoFim` chegam como texto e viram `Date` na linha
    // seguinte. `new Date('lixo')` é um `Invalid Date`, e comparar com um
    // `Invalid Date` no Prisma derrubava a rota com 500 — mensagem interna que
    // não diz nada ao usuário. Aqui a data é validada na entrada, devolvendo
    // 400 com o motivo (tratado pelo handler global de ZodError).
    const query = z.object({
      periodoInicio: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
        message: 'periodoInicio inválido. Use uma data real.',
      }).optional(),
      periodoFim: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
        message: 'periodoFim inválido. Use uma data real.',
      }).optional(),
    }).parse(req.query);
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const inicio = query.periodoInicio ? new Date(query.periodoInicio) : new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const fim = query.periodoFim ? new Date(query.periodoFim) : new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);
    // Janela invertida é erro de uso, não "resultado vazio": sem esta guarda,
    // `lte < gte` devolvia lista vazia e a tela mostrava "sem movimento",
    // parecendo que a empresa não tinha nada no período.
    if (inicio > fim) {
      return reply.status(400).send({ error: 'O início do período é posterior ao fim.' });
    }
    const proximos30 = new Date(hoje); proximos30.setDate(proximos30.getDate() + 30);

    const realizados = await prisma.financeiro.findMany({
      where: { empresaId: req.user.empresaId, status: 'PAGO', createdAt: { gte: inicio, lte: fim } },
      orderBy: { createdAt: 'asc' },
    });
    // Contas em aberto que entram na projeção: PENDENTE com vencimento ATÉ +30 dias.
    // `VENCIDO` é DERIVADO na leitura (ver GET /financeiro) — o valor gravado é
    // PENDENTE — e a projeção precisa incluir a conta vencida, porque é
    // exatamente ela cujo dinheiro não vai cair.
    const pendentes = await prisma.financeiro.findMany({
      where: {
        empresaId: req.user.empresaId,
        status: 'PENDENTE',
        // `lte: proximos30` e NÃO `gte: hoje`: uma conta JÁ VENCIDA é exatamente
        // o que o gestor precisa ver — o dinheiro não vai cair, e escondê-la da
        // projeção dava uma falsa sensação de saldo. O limite superior mantém
        // o horizonte em 30 dias; o inferior fica aberto para o passado.
        vencimento: { lte: proximos30 },
      },
      orderBy: { vencimento: 'asc' },
    });

    // ── DIA LOCAL DA EMPRESA, não o dia UTC ──────────────────────────────
    // Antes: `l.createdAt.toISOString().slice(0, 10)`. `toISOString()` converte
    // para UTC, e o servidor roda em UTC — mas o ANTES-DE-MEIA-NOITE local
    // virava o dia SEGUINTE no rótulo. Um pagamento de 21h de uma empresa em
    // São Paulo aparecia na série do dia seguinte, e a linha do dia correto
    // ficava zerada. O filtro do período também usa `inicio`/`fim` com o offset
    // real enviado pela tela (`comFuso`), então o corte e o rótulo precisam
    // falar do MESMO dia: o do fuso em que a empresa opera.
    const TZ = String(process.env.EMPRESA_FUSO || 'America/Sao_Paulo');
    const diaDe = (d: Date): string => {
      try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      } catch {
        return d.toISOString().slice(0, 10);
      }
    };

    const porDia: Record<string, { entradas: number; saidas: number }> = {};
    for (const l of realizados) {
      const dia = diaDe(l.createdAt);
      porDia[dia] = porDia[dia] || { entradas: 0, saidas: 0 };
      if (l.tipo === 'RECEITA') porDia[dia].entradas += Number(l.valor); else porDia[dia].saidas += Number(l.valor);
    }
    const dias = Object.keys(porDia).sort();
    let saldoAcumulado = 0;
    const serie = dias.map((dia) => {
      const { entradas, saidas } = porDia[dia];
      saldoAcumulado += entradas - saidas;
      return { dia, entradas, saidas, saldoDia: entradas - saidas, saldoAcumulado };
    });

    const totalEntradas = realizados.filter((l:any)=>l.tipo==='RECEITA').reduce((s:number,l:any)=>s+Number(l.valor),0);
    const totalSaidas = realizados.filter((l:any)=>l.tipo==='DESPESA').reduce((s:number,l:any)=>s+Number(l.valor),0);
    const projecaoEntradas = pendentes.filter((l:any)=>l.tipo==='RECEITA').reduce((s:number,l:any)=>s+Number(l.valor),0);
    const projecaoSaidas = pendentes.filter((l:any)=>l.tipo==='DESPESA').reduce((s:number,l:any)=>s+Number(l.valor),0);

    // ── PROJEÇÃO: SOMENTE O QUE VENCE NOS PRÓXIMOS 30 DIAS ───────────────
    // `pendentes` acima já restringe a `vencimento <= hoje+30dias`, então a
    // projeção inclui o que vence nesse intervalo e o que já está vencido, e
    // exclui o que vence depois. Não é preciso refiltrar aqui.
    return {
      periodo: { inicio, fim, fuso: TZ },
      serie,
      resumo: { totalEntradas, totalSaidas, saldo: totalEntradas - totalSaidas },
      projecao30dias: {
        entradas: projecaoEntradas,
        saidas: projecaoSaidas,
        // Contribuição líquida do horizonte de 30 dias, sobre o saldo do período.
        saldoProjetado: (totalEntradas - totalSaidas) + (projecaoEntradas - projecaoSaidas),
      },
    };
  });

  // DRE Seção 16 - baseada em dados reais, nunca fictícios
  app.get('/dre', { preHandler: [(app as any).authenticate, await permissaoMiddleware('financeiro', 'visualizar')] }, async (req:any, reply:any) => {
    // Mesma validação de `/fluxo-caixa`: `new Date('lixo')` é `Invalid Date` e
    // quebrava a comparação no Prisma, devolvendo 500 em vez de dizer o motivo.
    const query = z.object({
      periodoInicio: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
        message: 'periodoInicio inválido. Use uma data real.',
      }).optional(),
      periodoFim: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
        message: 'periodoFim inválido. Use uma data real.',
      }).optional(),
      filialId: z.string().optional(),
    }).parse(req.query);
    const { periodoInicio, periodoFim, filialId } = query as any;
    const inicio = periodoInicio ? new Date(periodoInicio) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const fim = periodoFim ? new Date(periodoFim) : new Date();
    if (inicio > fim) {
      return reply.status(400).send({ error: 'O início do período é posterior ao fim.' });
    }
    const whereFin:any = { empresaId: req.user.empresaId, createdAt: { gte: inicio, lte: fim }, status: { not: 'CANCELADO' } };
    if (filialId) whereFin.filialId = filialId;

    const financeiros = await prisma.financeiro.findMany({ where: whereFin });
    const receitas = financeiros.filter((f:any)=>f.tipo==='RECEITA');
    const despesas = financeiros.filter((f:any)=>f.tipo==='DESPESA');

    const receitaBruta = receitas.reduce((s:number,f:any)=>s+Number(f.valor),0);
    // Deduções = impostos sobre vendas e devoluções. Só contam lançamentos de
    // DESPESA: um lançamento de RECEITA com categoria "impostos" (estorno,
    // por exemplo) NÃO reduz a receita — ele já entra em `receitaBruta` pelo
    // próprio tipo, e descontá-lo aqui contaria o mesmo valor duas vezes.
    const deducoes = despesas.filter((f:any)=>ehDeducao(f.categoria)).reduce((s:number,f:any)=>s+Number(f.valor),0);
    const receitaLiquida = receitaBruta - deducoes;

    // Custos = custo dos produtos vendidos - calcular pelas vendas no período
    const vendasPeriodo = await prisma.venda.findMany({ where: { empresaId: req.user.empresaId, createdAt: { gte: inicio, lte: fim }, status: 'FINALIZADA', ...(filialId?{filialId}:{}) }, include: { itens: true } });
    const custos = vendasPeriodo.reduce((s,v)=>s+v.itens.reduce((si,item)=>si+Number(item.custoUnitario)*Number(item.quantidade),0),0);

    const despesasOperacionais = despesas.filter((f:any)=>!CATEGORIAS_DEDUCAO.includes(f.categoria)).reduce((s:number,f:any)=>s+Number(f.valor),0);
    const resultadoOperacional = receitaLiquida - custos - despesasOperacionais;
    const lucroPrejuizo = resultadoOperacional; // simplificado sem IR

    // ── MARGEM SEM RECEITA NÃO É "0%", é "não calculável" ────────────────
    // Antes: `receitaLiquida ? ... : 0`. Uma empresa com R$ 0 de receita e
    // R$ 5.000 de CMV recebia margem bruta de 0,0% — que se lê como
    // "empate", quando na verdade não vendeu nada e perdeu tudo. O valor
    // impossível de calcular volta como `null`, e a interface mostra "—"
    // (padrão que o próprio módulo já usa em `num()`/KpiCard).
    const margemBruta = receitaLiquida > 0 ? ((receitaLiquida - custos) / receitaLiquida) * 100 : null;
    const margemLiquida = receitaBruta > 0 ? (lucroPrejuizo / receitaBruta) * 100 : null;

    // ── GET /dre NÃO GRAVA NADA ───────────────────────────────────────────
    // Esta rota fazia `prisma.dRE.findFirst` + `update`/`create` a CADA
    // leitura. Um GET deve ser seguro e idempotente: abrir a aba, alternar
    // "Comparar" (que consulta o período anterior) ou apenas abrir o Dashboard
    // — que também chama /dre — gravavam linhas na tabela `DRE`. Cada
    // combinação de datas criava um registro novo e nenhuma era consultada de
    // volta: era escrita sem leitor, sem propósito e sem trilha de auditoria.
    //
    // O `dre` devolvido mantém o mesmo formato (a tela lê `dre.origem` no
    // rodapé), mas passa a descrever o período CALCULADO, sem persistir.
    // Quem quiser histórico de DRE fechado precisa de um POST próprio, com
    // nome e data de fechamento — não de um GET que grava por efeito colateral.
    const dre = {
      periodoInicio: inicio.toISOString(),
      periodoFim: fim.toISOString(),
      origem: 'AUTOMATICO',
    };

    return { dre, detalhes: { receitaBruta, deducoes, receitaLiquida, custos, despesas: despesasOperacionais, resultadoOperacional, lucroPrejuizo, margemBruta, margemLiquida, qtdVendas: vendasPeriodo.length } };
  });

  // ROI Seção 17
  app.get('/roi', { preHandler: [(app as any).authenticate, await permissaoMiddleware('financeiro', 'visualizar')] }, async (req:any) => {
    const { periodoInicio, periodoFim, filialId } = req.query as any;
    const inicio=periodoInicio?new Date(periodoInicio):new Date(new Date().getFullYear(),new Date().getMonth(),1); const fim=periodoFim?new Date(periodoFim):new Date();
    const vendas=await prisma.venda.findMany({where:{empresaId:req.user.empresaId,status:'FINALIZADA',createdAt:{gte:inicio,lte:fim},...(filialId?{filialId}:{})},include:{itens:true}});
    const retorno=vendas.reduce((s,v)=>s+Number(v.total),0);
    const compras=await prisma.compra.findMany({where:{empresaId:req.user.empresaId,status:'RECEBIDA',dataRecebimento:{gte:inicio,lte:fim}}});
    const investimento=compras.reduce((s,c)=>s+Number(c.valorTotal),0);
    const roi=investimento?((retorno-investimento)/investimento)*100:0;
    return {periodo:{inicio,fim},investimento,retorno,resultado:retorno-investimento,roi,base:'compras recebidas no período x vendas finalizadas no período',limitacao:'O projeto não possui ainda entidade específica de campanha/projeto/investimento; o cálculo usa somente dados financeiros existentes.'};
  });

  // Ticket Médio Seção 18 - por período, setor, funcionário, filial
  app.get('/ticket-medio', { preHandler: [(app as any).authenticate, await permissaoMiddleware('financeiro', 'visualizar')] }, async (req:any) => {
    const { filialId, setorId, funcionarioId, periodoInicio, periodoFim } = req.query as any;
    const where:any = { empresaId: req.user.empresaId };
    if (filialId) where.filialId = filialId;
    if (setorId) where.setorId = setorId;
    if (funcionarioId) where.funcionarioId = funcionarioId;
    const inicio = periodoInicio ? new Date(periodoInicio) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const fim = periodoFim ? new Date(periodoFim) : new Date();
    where.createdAt = { gte: inicio, lte: fim };
    where.status = 'FINALIZADA';
    const vendas = await prisma.venda.findMany({ where });
    const faturamento = vendas.reduce((s,v)=>s+Number(v.total),0);
    const qtd = vendas.length;
    const ticket = qtd ? faturamento/qtd : 0;
    // Agrupado por dia
    const porDia = await prisma.indicadorDiario.findMany({ where: { empresaId: req.user.empresaId, ...(filialId?{filialId}:{}), data: { gte: inicio, lte: fim } }, orderBy: { data: 'asc' } });
    return { geral: { faturamento, qtdVendas: qtd, ticketMedio: ticket, formula: 'faturamento / numero de vendas' }, porDia, porPeriodo: { inicio, fim } };
  });

  // Metas Seção 19 - CRUD + ranking + progresso
  app.get('/metas', { preHandler: [(app as any).authenticate, await permissaoMiddleware('metas', 'visualizar')] }, async (req: any) => {
    const { tipo, periodo, status, filialId, setorId, funcionarioId } = req.query as any;
    const where: any = { empresaId: req.user.empresaId };
    if (tipo) where.tipo = tipo;
    if (periodo) where.periodo = periodo;
    if (status) where.status = status;
    if (filialId) where.filialId = filialId;
    if (setorId) where.setorId = setorId;
    if (funcionarioId) where.funcionarioId = funcionarioId;

    const metas = await prisma.meta.findMany({ where, orderBy: { percentual: 'desc' } });
    const ranking = [...metas].sort((a, b) => Number(b.percentual) - Number(a.percentual));
    return { metas, ranking };
  });

  app.post('/metas', { preHandler: [(app as any).authenticate, await permissaoMiddleware('metas', 'criar')] }, async (req: any) => {
    const schema = z.object({
      tipo: z.string().min(1, 'Tipo é obrigatório.'),
      periodo: z.string().min(1, 'Período é obrigatório.'),
      metaValor: z.number().positive('Valor da meta deve ser maior que zero.').finite().max(9_999_999_999.99),
      realizado: z.number().nonnegative().finite().max(9_999_999_999.99).default(0),
      filialId: z.string().optional(),
      setorId: z.string().optional(),
      funcionarioId: z.string().optional(),
      status: z.string().optional(),
      origem: z.enum(['MANUAL', 'IMPORTADO', 'API', 'AUTOMATICO']).default('MANUAL'),
    });
    const data = schema.parse(req.body);
    if (data.filialId) {
      const f = await prisma.filial.findFirst({ where: { id: data.filialId, empresaId: req.user.empresaId } });
      if (!f) throw new Error('Filial inválida para esta empresa.');
    }
    if (data.setorId) {
      const setor = await prisma.setor.findFirst({ where: { id: data.setorId, empresaId: req.user.empresaId } });
      if (!setor) throw new Error('Setor inválido para esta empresa.');
    }
    if (data.funcionarioId) {
      const func = await prisma.funcionario.findFirst({ where: { id: data.funcionarioId, empresaId: req.user.empresaId } });
      if (!func) throw new Error('Funcionário inválido para esta empresa.');
    }

    const valorMeta = data.metaValor;
    const realizado = data.realizado ?? 0;
    const percentualBruto = valorMeta > 0 ? (realizado / valorMeta) * 100 : 0;
    const percentual = Math.min(999.99, Number(percentualBruto.toFixed(2)));
    const diferenca = Number((realizado - valorMeta).toFixed(2));
    const statusPadrao = percentual >= 100 ? 'ATINGIDA' : percentual >= 90 ? 'QUASE_ATINGIDA' : percentual < 75 ? 'EM_RISCO' : 'EM_ANDAMENTO';

    const meta = await prisma.meta.create({
      data: {
        empresaId: req.user.empresaId,
        filialId: data.filialId || null,
        setorId: data.setorId || null,
        funcionarioId: data.funcionarioId || null,
        tipo: data.tipo,
        periodo: data.periodo,
        metaValor: valorMeta,
        realizado,
        percentual,
        diferenca,
        status: data.status || statusPadrao,
        origem: data.origem as any,
      },
    });
    await registrarAuditoria({
      usuarioId: req.user.id,
      empresaId: req.user.empresaId,
      acao: 'CRIAR',
      entidade: 'Meta',
      entidadeId: meta.id,
      valorNovo: meta,
      origem: data.origem as any,
      ip: req.ip,
    });
    return meta;
  });

  app.put('/metas/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('metas', 'editar')] }, async (req: any, reply: any) => {
    const existing = await prisma.meta.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
    });
    if (!existing) {
      return reply.status(404).send({ error: 'Meta não encontrada.' });
    }

    const schema = z.object({
      tipo: z.string().min(1).optional(),
      periodo: z.string().min(1).optional(),
      metaValor: z.number().positive().finite().max(9_999_999_999.99).optional(),
      realizado: z.number().nonnegative().finite().max(9_999_999_999.99).optional(),
      filialId: z.string().nullable().optional(),
      setorId: z.string().nullable().optional(),
      funcionarioId: z.string().nullable().optional(),
      status: z.string().optional(),
      projecao: z.number().finite().optional(),
    });
    const data = schema.parse(req.body);

    if (data.filialId) {
      const f = await prisma.filial.findFirst({ where: { id: data.filialId, empresaId: req.user.empresaId } });
      if (!f) throw new Error('Filial inválida para esta empresa.');
    }
    if (data.setorId) {
      const setor = await prisma.setor.findFirst({ where: { id: data.setorId, empresaId: req.user.empresaId } });
      if (!setor) throw new Error('Setor inválido para esta empresa.');
    }
    if (data.funcionarioId) {
      const func = await prisma.funcionario.findFirst({ where: { id: data.funcionarioId, empresaId: req.user.empresaId } });
      if (!func) throw new Error('Funcionário inválido para esta empresa.');
    }

    const valorMeta = data.metaValor !== undefined ? data.metaValor : Number(existing.metaValor);
    const realizado = data.realizado !== undefined ? data.realizado : Number(existing.realizado);
    const percentualBruto = valorMeta > 0 ? (realizado / valorMeta) * 100 : 0;
    const percentual = Math.min(999.99, Number(percentualBruto.toFixed(2)));
    const diferenca = Number((realizado - valorMeta).toFixed(2));

    let status = data.status;
    if (!status) {
      if (existing.status === 'PAUSADA' || existing.status === 'CANCELADA') {
        status = existing.status;
      } else {
        status = percentual >= 100 ? 'ATINGIDA' : percentual >= 90 ? 'QUASE_ATINGIDA' : percentual < 75 ? 'EM_RISCO' : 'EM_ANDAMENTO';
      }
    }

    const updated = await prisma.meta.update({
      where: { id: existing.id },
      data: {
        tipo: data.tipo ?? existing.tipo,
        periodo: data.periodo ?? existing.periodo,
        metaValor: valorMeta,
        realizado,
        percentual,
        diferenca,
        status,
        projecao: data.projecao !== undefined ? data.projecao : existing.projecao,
        filialId: data.filialId !== undefined ? data.filialId : existing.filialId,
        setorId: data.setorId !== undefined ? data.setorId : existing.setorId,
        funcionarioId: data.funcionarioId !== undefined ? data.funcionarioId : existing.funcionarioId,
      },
    });

    await registrarAuditoria({
      usuarioId: req.user.id,
      empresaId: req.user.empresaId,
      acao: 'EDITAR',
      entidade: 'Meta',
      entidadeId: updated.id,
      valorAnterior: existing,
      valorNovo: updated,
      origem: 'MANUAL',
      ip: req.ip,
    });

    return updated;
  });

  app.delete('/metas/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('metas', 'excluir')] }, async (req: any, reply: any) => {
    const existing = await prisma.meta.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
    });
    if (!existing) {
      return reply.status(404).send({ error: 'Meta não encontrada.' });
    }

    await prisma.meta.delete({ where: { id: existing.id } });

    await registrarAuditoria({
      usuarioId: req.user.id,
      empresaId: req.user.empresaId,
      acao: 'EXCLUIR',
      entidade: 'Meta',
      entidadeId: existing.id,
      valorAnterior: existing,
      origem: 'MANUAL',
      ip: req.ip,
    });

    return { ok: true, id: existing.id };
  });

  app.patch('/metas/:id/progresso', { preHandler: [(app as any).authenticate, await permissaoMiddleware('metas', 'editar')] }, async (req: any, reply: any) => {
    const existing = await prisma.meta.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
    });
    if (!existing) {
      return reply.status(404).send({ error: 'Meta não encontrada.' });
    }

    const schema = z.object({
      novoValor: z.number().nonnegative().finite().max(9_999_999_999.99).optional(),
      incremento: z.number().finite().optional(),
      motivo: z.string().optional(),
      obs: z.string().optional(),
    });
    const data = schema.parse(req.body);

    let realizado: number;
    if (data.novoValor !== undefined) {
      realizado = data.novoValor;
    } else if (data.incremento !== undefined) {
      realizado = Math.max(0, Number(existing.realizado) + data.incremento);
    } else {
      realizado = Number(existing.realizado);
    }

    const valorMeta = Number(existing.metaValor);
    const percentualBruto = valorMeta > 0 ? (realizado / valorMeta) * 100 : 0;
    const percentual = Math.min(999.99, Number(percentualBruto.toFixed(2)));
    const diferenca = Number((realizado - valorMeta).toFixed(2));
    const status = percentual >= 100 ? 'ATINGIDA' : percentual >= 90 ? 'QUASE_ATINGIDA' : percentual < 75 ? 'EM_RISCO' : 'EM_ANDAMENTO';

    const updated = await prisma.meta.update({
      where: { id: existing.id },
      data: {
        realizado,
        percentual,
        diferenca,
        status: existing.status === 'PAUSADA' ? 'PAUSADA' : status,
      },
    });

    await registrarAuditoria({
      usuarioId: req.user.id,
      empresaId: req.user.empresaId,
      acao: 'EDITAR',
      entidade: 'Meta',
      entidadeId: updated.id,
      valorAnterior: existing,
      valorNovo: { ...updated, motivo: data.motivo, obs: data.obs },
      origem: 'MANUAL',
      ip: req.ip,
    });

    return updated;
  });
}
