
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';

export async function gestaoRoutes(app: FastifyInstance) {
  // Financeiro completo Seção 15
  app.get('/financeiro', { preHandler: [(app as any).authenticate, await permissaoMiddleware('financeiro', 'visualizar')] }, async (req:any) => {
    const { tipo, status, periodoInicio, periodoFim } = req.query as any;
    const where:any = { empresaId: req.user.empresaId };
    if (tipo) where.tipo = tipo;
    if (status) where.status = status;
    if (periodoInicio && periodoFim) where.createdAt = { gte: new Date(periodoInicio), lte: new Date(periodoFim) };
    const lancamentos = await prisma.financeiro.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const receitas = lancamentos.filter((l:any)=>l.tipo==='RECEITA').reduce((s:number,l:any)=>s+Number(l.valor),0);
    const despesas = lancamentos.filter((l:any)=>l.tipo==='DESPESA').reduce((s:number,l:any)=>s+Number(l.valor),0);
    const resultado = receitas - despesas;
    const aPagar = await prisma.financeiro.count({ where: { empresaId: req.user.empresaId, tipo: 'DESPESA', status: 'PENDENTE' } });
    const aReceber = await prisma.financeiro.count({ where: { empresaId: req.user.empresaId, tipo: 'RECEITA', status: 'PENDENTE' } });
    return { lancamentos, fluxo: { receitas, despesas, resultado, contasAPagar: aPagar, contasAReceber: aReceber } };
  });

  app.post('/financeiro', { preHandler: [(app as any).authenticate, await permissaoMiddleware('financeiro', 'criar')] }, async (req:any) => {
    const schema = z.object({
      tipo: z.enum(['RECEITA','DESPESA']),
      categoria: z.string().min(2), // vendas, fornecedores, salarios, servicos, impostos, operacionais
      centroCusto: z.string().optional(),
      descricao: z.string().min(2),
      valor: z.number().positive(),
      vencimento: z.string().optional(),
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

  // DRE Seção 16 - baseada em dados reais, nunca fictícios
  app.get('/dre', { preHandler: [(app as any).authenticate, await permissaoMiddleware('financeiro', 'visualizar')] }, async (req:any) => {
    const { periodoInicio, periodoFim, filialId } = req.query as any;
    const inicio = periodoInicio ? new Date(periodoInicio) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const fim = periodoFim ? new Date(periodoFim) : new Date();
    const whereFin:any = { empresaId: req.user.empresaId, createdAt: { gte: inicio, lte: fim }, status: { not: 'CANCELADO' } };
    if (filialId) whereFin.filialId = filialId;

    const financeiros = await prisma.financeiro.findMany({ where: whereFin });
    const receitas = financeiros.filter((f:any)=>f.tipo==='RECEITA');
    const despesas = financeiros.filter((f:any)=>f.tipo==='DESPESA');

    const receitaBruta = receitas.reduce((s:number,f:any)=>s+Number(f.valor),0);
    // Deduções = impostos sobre vendas, devoluções - buscar categoria deduções
    const deducoes = financeiros.filter((f:any)=>f.categoria==='deducoes' || f.categoria==='impostos').reduce((s:number,f:any)=>f.tipo==='DESPESA'?s+Number(f.valor):s,0);
    const receitaLiquida = receitaBruta - deducoes;

    // Custos = custo dos produtos vendidos - calcular pelas vendas no período
    const vendasPeriodo = await prisma.venda.findMany({ where: { empresaId: req.user.empresaId, createdAt: { gte: inicio, lte: fim }, status: 'FINALIZADA', ...(filialId?{filialId}:{}) }, include: { itens: true } });
    const custos = vendasPeriodo.reduce((s,v)=>s+v.itens.reduce((si,item)=>si+Number(item.custoUnitario)*item.quantidade,0),0);

    const despesasOperacionais = despesas.filter((f:any)=>!['deducoes','impostos'].includes(f.categoria)).reduce((s:number,f:any)=>s+Number(f.valor),0);
    const resultadoOperacional = receitaLiquida - custos - despesasOperacionais;
    const lucroPrejuizo = resultadoOperacional; // simplificado sem IR
    const margemBruta = receitaLiquida ? ((receitaLiquida - custos)/receitaLiquida)*100 : 0;
    const margemLiquida = receitaBruta ? (lucroPrejuizo/receitaBruta)*100 : 0;

    // Salva DRE para histórico
    const existenteDre = await prisma.dRE.findFirst({ where:{empresaId:req.user.empresaId,filialId:filialId||null,periodoInicio:inicio,periodoFim:fim} });
    const dre = existenteDre ? await prisma.dRE.update({ where:{id:existenteDre.id}, data:{receitaBruta,deducoes,receitaLiquida,custos,despesas:despesasOperacionais,resultadoOperacional,lucroPrejuizo,margemBruta,margemLiquida,origem:'AUTOMATICO'} }) : await prisma.dRE.create({ data:{empresaId:req.user.empresaId,filialId:filialId||null,periodoInicio:inicio,periodoFim:fim,receitaBruta,deducoes,receitaLiquida,custos,despesas:despesasOperacionais,resultadoOperacional,lucroPrejuizo,margemBruta,margemLiquida,origem:'AUTOMATICO'} });

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

  // Metas Seção 19 - CRUD + ranking
  app.get('/metas', { preHandler: [(app as any).authenticate, await permissaoMiddleware('metas', 'visualizar')] }, async (req:any) => {
    const metas = await prisma.meta.findMany({ where: { empresaId: req.user.empresaId }, orderBy: { percentual: 'desc' } });
    return { metas, ranking: metas.sort((a,b)=>Number(b.percentual)-Number(a.percentual)) };
  });
  app.post('/metas', { preHandler: [(app as any).authenticate, await permissaoMiddleware('metas', 'criar')] }, async (req:any) => {
    const schema = z.object({
      tipo: z.string(), // EMPRESA, FILIAL, SETOR, FUNCIONARIO, VENDAS, FINANCEIRO, PRODUTO, PRODUTIVIDADE, ESTOQUE
      periodo: z.string(), // 2026-09
      metaValor: z.number().positive(),
      filialId: z.string().optional(),
      setorId: z.string().optional(),
      funcionarioId: z.string().optional(),
      origem: z.enum(['MANUAL','IMPORTADO','API','AUTOMATICO']).default('MANUAL')
    });
    const data = schema.parse(req.body);
    if(data.filialId){const f=await prisma.filial.findFirst({where:{id:data.filialId,empresaId:req.user.empresaId}});if(!f)throw new Error('Filial inválida para esta empresa.');}
    if(data.setorId){const setor=await prisma.setor.findFirst({where:{id:data.setorId,empresaId:req.user.empresaId}});if(!setor)throw new Error('Setor inválido para esta empresa.');}
    if(data.funcionarioId){const func=await prisma.funcionario.findFirst({where:{id:data.funcionarioId,empresaId:req.user.empresaId}});if(!func)throw new Error('Funcionário inválido para esta empresa.');}
    const meta = await prisma.meta.create({
      data: {
        empresaId: req.user.empresaId,
        filialId: data.filialId,
        setorId: data.setorId,
        funcionarioId: data.funcionarioId,
        tipo: data.tipo,
        periodo: data.periodo,
        metaValor: data.metaValor,
        origem: data.origem as any
      }
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'Meta', entidadeId: meta.id, valorNovo: meta, origem: data.origem as any, ip: req.ip });
    return meta;
  });
}
