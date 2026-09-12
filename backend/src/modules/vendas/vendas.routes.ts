import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { aplicarMovimento } from '../estoque/estoque.service.js';

const origemSchema=z.enum(['MANUAL','IMPORTADO','API','AUTOMATICO','PDV','PONTO','INTEGRACAO','IA']);

export async function vendasRoutes(app: FastifyInstance) {
  app.get('/vendas',{preHandler:[(app as any).authenticate,await permissaoMiddleware('vendas','visualizar')]},async(req:any)=>prisma.venda.findMany({where:{empresaId:req.user.empresaId},include:{itens:true,cliente:true},orderBy:{createdAt:'desc'},take:100}));

  app.post('/vendas',{preHandler:[(app as any).authenticate,await permissaoMiddleware('vendas','criar')]},async(req:any)=>{
    const data=z.object({filialId:z.string(),setorId:z.string().optional(),clienteId:z.string().optional(),formaPagamento:z.enum(['DINHEIRO','PIX','CARTAO_CREDITO','CARTAO_DEBITO','BOLETO','TRANSFERENCIA','OUTRO']).default('DINHEIRO'),desconto:z.number().min(0).default(0),itens:z.array(z.object({produtoId:z.string(),quantidade:z.number().int().positive(),desconto:z.number().min(0).default(0)})).min(1),origem:origemSchema.default('MANUAL'),pdvId:z.string().optional()}).parse(req.body);
    const result=await prisma.$transaction(async tx=>{
      const filial=await tx.filial.findFirst({where:{id:data.filialId,empresaId:req.user.empresaId}}); if(!filial) throw new Error('Filial inválida para esta empresa.');
      if(data.setorId){const setor=await tx.setor.findFirst({where:{id:data.setorId,empresaId:req.user.empresaId}});if(!setor)throw new Error('Setor inválido para esta empresa.');}
      if(data.clienteId){const cliente=await tx.cliente.findFirst({where:{id:data.clienteId,empresaId:req.user.empresaId}});if(!cliente)throw new Error('Cliente inválido para esta empresa.');}
      const itensCalculados:any[]=[]; let subtotal=0;
      for(const item of data.itens){
        const produto=await tx.produto.findFirst({where:{id:item.produtoId,empresaId:req.user.empresaId,status:'ATIVO'}}); if(!produto)throw new Error(`Produto ${item.produtoId} não encontrado.`);
        const estoque=await tx.estoque.findUnique({where:{filialId_produtoId:{filialId:data.filialId,produtoId:item.produtoId}}});
        const qtdAtual=estoque?.quantidade??0; if(qtdAtual<item.quantidade)throw new Error(`Estoque insuficiente para ${produto.nome}: tem ${qtdAtual}, precisa ${item.quantidade}.`);
        const preco=Number(produto.precoVenda); const totalItem=preco*item.quantidade-item.desconto; if(totalItem<0)throw new Error('Desconto do item não pode superar o valor do item.');
        subtotal+=totalItem; itensCalculados.push({produto,quantidade:item.quantidade,preco,desconto:item.desconto,total:totalItem});
      }
      const total=subtotal-data.desconto; if(total<0)throw new Error('Desconto da venda não pode superar o subtotal.');
      const venda=await tx.venda.create({data:{empresaId:req.user.empresaId,filialId:data.filialId,setorId:data.setorId,clienteId:data.clienteId,funcionarioId:req.user.id,formaPagamento:data.formaPagamento as any,subtotal,desconto:data.desconto,total,origem:data.origem as any,pdvId:data.pdvId,status:'FINALIZADA',itens:{create:itensCalculados.map(i=>({produtoId:i.produto.id,quantidade:i.quantidade,preco:i.preco,custoUnitario:Number(i.produto.custo),desconto:i.desconto,total:i.total}))}},include:{itens:true}});
      // Baixa de estoque via service compartilhado (Fase 3: elimina a
      // duplicação que existia aqui — a mesma lógica de concorrência
      // segura já vive em estoque.service.ts e é usada por Estoque/Compras).
      for(const item of itensCalculados){
        await aplicarMovimento(tx,{empresaId:req.user.empresaId,filialId:data.filialId,produtoId:item.produto.id,usuarioId:req.user.id,tipo:'VENDA',quantidade:item.quantidade,motivo:`Venda ${venda.id}`,documento:venda.id,origem:data.origem});
      }
      const hoje=new Date();hoje.setHours(0,0,0,0);
      const indicador=await tx.indicadorDiario.upsert({where:{empresaId_filialId_data:{empresaId:req.user.empresaId,filialId:data.filialId,data:hoje}},update:{faturamento:{increment:total},qtdVendas:{increment:1}},create:{empresaId:req.user.empresaId,filialId:data.filialId,data:hoje,faturamento:total,qtdVendas:1,ticketMedio:total}});
      await tx.indicadorDiario.update({where:{id:indicador.id},data:{ticketMedio:Number(indicador.faturamento)/indicador.qtdVendas}});
      const periodo=`${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`; const metas=await tx.meta.findMany({where:{empresaId:req.user.empresaId,tipo:'VENDAS',periodo}});
      for(const meta of metas){const novo=Number(meta.realizado)+total;await tx.meta.update({where:{id:meta.id},data:{realizado:novo,percentual:Number(meta.metaValor)?novo/Number(meta.metaValor)*100:0,diferenca:novo-Number(meta.metaValor)}});}
      await tx.financeiro.create({data:{empresaId:req.user.empresaId,filialId:data.filialId,tipo:'RECEITA',categoria:'vendas',centroCusto:data.setorId,descricao:`Venda ${venda.id} - ${data.formaPagamento}`,valor:total,status:'PAGO',vendaId:venda.id,origem:data.origem as any}});
      if(data.clienteId){const cliente=await tx.cliente.findFirst({where:{id:data.clienteId,empresaId:req.user.empresaId}});if(cliente){const novoTotal=Number(cliente.valorTotalComprado)+total;const novaFreq=cliente.frequencia+1;await tx.cliente.update({where:{id:cliente.id},data:{valorTotalComprado:novoTotal,frequencia:novaFreq,ticketMedio:novaFreq?novoTotal/novaFreq:0,ultimaCompra:new Date()}});}}
      return {venda,ticketMedio:Number(indicador.faturamento)/indicador.qtdVendas,faturamento:Number(indicador.faturamento),qtdVendas:indicador.qtdVendas};
    });
    await registrarAuditoria({usuarioId:req.user.id,empresaId:req.user.empresaId,acao:'CRIAR',entidade:'Venda',entidadeId:result.venda.id,valorNovo:result.venda,origem:result.venda.origem,ip:req.ip}); return result;
  });

  app.post('/vendas/:id/cancelar',{preHandler:[(app as any).authenticate,await permissaoMiddleware('vendas','editar')]},async(req:any)=>{
    const {id}=req.params;
    const vendaCancelada=await prisma.$transaction(async tx=>{
      const venda=await tx.venda.findFirst({where:{id,empresaId:req.user.empresaId},include:{itens:true}}); if(!venda)throw new Error('Venda não encontrada'); if(venda.status==='CANCELADA')throw new Error('Já cancelada');
      for(const item of venda.itens){
        await aplicarMovimento(tx,{empresaId:venda.empresaId,filialId:venda.filialId,produtoId:item.produtoId,usuarioId:req.user.id,tipo:'DEVOLUCAO',quantidade:item.quantidade,motivo:`Cancelamento venda ${id}`,documento:id,origem:'MANUAL'});
      }
      await tx.financeiro.updateMany({where:{vendaId:id,empresaId:req.user.empresaId},data:{status:'CANCELADO'}});
      const hoje=new Date(venda.createdAt);hoje.setHours(0,0,0,0);
      const indicador=await tx.indicadorDiario.findUnique({where:{empresaId_filialId_data:{empresaId:venda.empresaId,filialId:venda.filialId,data:hoje}}});
      if(indicador){const faturamento=Math.max(0,Number(indicador.faturamento)-Number(venda.total));const qtd=Math.max(0,indicador.qtdVendas-1);await tx.indicadorDiario.update({where:{id:indicador.id},data:{faturamento,qtdVendas:qtd,ticketMedio:qtd?faturamento/qtd:0}});}
      const periodo=`${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`; const metas=await tx.meta.findMany({where:{empresaId:req.user.empresaId,tipo:'VENDAS',periodo}});
      for(const meta of metas){const novo=Math.max(0,Number(meta.realizado)-Number(venda.total));await tx.meta.update({where:{id:meta.id},data:{realizado:novo,percentual:Number(meta.metaValor)?novo/Number(meta.metaValor)*100:0,diferenca:novo-Number(meta.metaValor)}});}
      if(venda.clienteId){const vendasCliente=await tx.venda.findMany({where:{empresaId:req.user.empresaId,clienteId:venda.clienteId,status:'FINALIZADA'},select:{total:true,createdAt:true}});const totalCliente=vendasCliente.reduce((s,v)=>s+Number(v.total),0);const freq=vendasCliente.length;const ultima=vendasCliente.sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime())[0]?.createdAt??null;await tx.cliente.update({where:{id:venda.clienteId},data:{valorTotalComprado:totalCliente,frequencia:freq,ticketMedio:freq?totalCliente/freq:0,ultimaCompra:ultima}});}
      return tx.venda.update({where:{id},data:{status:'CANCELADA'}});
    });
    await registrarAuditoria({usuarioId:req.user.id,empresaId:req.user.empresaId,acao:'EDITAR',entidade:'Venda',entidadeId:id,valorNovo:vendaCancelada,origem:'MANUAL',ip:req.ip,contexto:'Cancelamento transacional com reversão de estoque, financeiro, indicadores, metas e cliente'}); return vendaCancelada;
  });

  app.get('/vendas/dashboard',{preHandler:[(app as any).authenticate,await permissaoMiddleware('vendas','visualizar')]},async(req:any)=>{
    const indicadores=await prisma.indicadorDiario.findMany({where:{empresaId:req.user.empresaId},orderBy:{data:'desc'},take:30}); const faturamento=indicadores.reduce((s,i)=>s+Number(i.faturamento),0);const qtdVendas=indicadores.reduce((s,i)=>s+i.qtdVendas,0);const ticketMedio=qtdVendas?faturamento/qtdVendas:0;
    const [ultimo,anterior]=[indicadores[0],indicadores[1]]; const crescimento=anterior&&Number(anterior.faturamento)!==0?((Number(ultimo?.faturamento||0)-Number(anterior.faturamento))/Number(anterior.faturamento))*100:0;
    return {faturamento,qtdVendas,ticketMedio,indicadores,crescimento,meta:null};
  });
}
