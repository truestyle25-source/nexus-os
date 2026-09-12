<<<<<<< HEAD

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { decryptSecret, encryptSecret } from '../../lib/secrets.js';
=======
import { Router } from 'express';
import { rhController } from './rh.controller.js';
import { authMiddleware } from '../../middleware/auth.js';
>>>>>>> 9a24c34c6d11c3f2872b796a0c1af740ba42af22

export async function rhRoutes(app: FastifyInstance) {
  // Departamentos
  app.get('/departamentos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    return prisma.departamento.findMany({ where: { empresaId: req.user.empresaId }, include: { cargos: true, _count: { select: { funcionarios: true } } } });
  });
  app.post('/departamentos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req:any) => {
    const { nome, descricao } = req.body as any;
    const dep = await prisma.departamento.create({ data: { empresaId: req.user.empresaId, nome, descricao } });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'Departamento', entidadeId: dep.id, valorNovo: dep, origem: 'MANUAL', ip: req.ip });
    return dep;
  });

  // Cargos
  app.get('/cargos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    return prisma.cargo.findMany({ where: { empresaId: req.user.empresaId }, include: { departamento: true } });
  });
  app.post('/cargos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req:any) => {
    const { nome, departamentoId, descricao } = req.body as any;
    return prisma.cargo.create({ data: { empresaId: req.user.empresaId, nome, departamentoId, descricao } });
  });

<<<<<<< HEAD
  // Funcionários Seção 20 - CPF único, idExternoPonto
  app.get('/funcionarios', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    return prisma.funcionario.findMany({ where: { empresaId: req.user.empresaId }, include: { cargo: true, departamento: true }, orderBy: { createdAt: 'desc' } });
  });
  app.post('/funcionarios', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req:any) => {
    const schema = z.object({
      nome: z.string().min(2),
      cpf: z.string().optional(),
      idExternoPonto: z.string().optional(),
      departamentoId: z.string().optional(),
      cargoId: z.string().optional(),
      filialId: z.string().optional(),
      dataAdmissao: z.string().optional(),
      origem: z.enum(['MANUAL','IMPORTADO','API','AUTOMATICO']).default('MANUAL')
    });
    const data = schema.parse(req.body);
    if (data.filialId) { const f=await prisma.filial.findFirst({where:{id:data.filialId,empresaId:req.user.empresaId}}); if(!f)throw new Error('Filial inválida para esta empresa.'); }
    if (data.departamentoId) { const d=await prisma.departamento.findFirst({where:{id:data.departamentoId,empresaId:req.user.empresaId}}); if(!d)throw new Error('Departamento inválido para esta empresa.'); }
    if (data.cargoId) { const c=await prisma.cargo.findFirst({where:{id:data.cargoId,empresaId:req.user.empresaId}}); if(!c)throw new Error('Cargo inválido para esta empresa.'); }
    // CPF único validação
    if (data.cpf) {
      const existe = await prisma.funcionario.findUnique({ where: { cpf: data.cpf } });
      if (existe) throw new Error('CPF já cadastrado - CPF único Seção 20');
    }
    const func = await prisma.funcionario.create({
      data: {
        empresaId: req.user.empresaId,
        filialId: data.filialId,
        departamentoId: data.departamentoId,
        cargoId: data.cargoId,
        nome: data.nome,
        cpf: data.cpf,
        idExternoPonto: data.idExternoPonto,
        dataAdmissao: data.dataAdmissao ? new Date(data.dataAdmissao) : null,
        origem: data.origem as any
      }
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'Funcionario', entidadeId: func.id, valorNovo: func, origem: data.origem as any, ip: req.ip });
    return func;
  });

  // Indicadores RH Seção 20
  app.get('/rh/indicadores', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    const total = await prisma.funcionario.count({ where: { empresaId: req.user.empresaId } });
    const ativos = await prisma.funcionario.count({ where: { empresaId: req.user.empresaId, status: 'ATIVO' } });
    const porSetor = await prisma.departamento.findMany({ where: { empresaId: req.user.empresaId }, include: { _count: { select: { funcionarios: true } } } });
    const pontosHoje = await prisma.ponto.findMany({ where: { empresaId: req.user.empresaId, data: new Date(new Date().setHours(0,0,0,0)) } });
    const faltas = pontosHoje.filter(p=>p.falta).length;
    const atrasos = pontosHoje.filter(p=>p.atrasoMinutos>0).length;
    const horasExtras = pontosHoje.reduce((s,p)=>s+p.horaExtraMinutos,0);
    const absenteismo = total ? (faltas/total)*100 : 0;
    // Turnover simplificado: desligados no mês / total
    const desligadosMes = await prisma.funcionario.count({ where: { empresaId: req.user.empresaId, dataDesligamento: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } });
    const turnover = total ? (desligadosMes/total)*100 : 0;
    return { totalFuncionarios: total, ativos, porSetor, faltas, atrasos, horasExtras, absenteismo, turnover, produtividade: 100-absenteismo };
  });

  // Controle de Ponto Seção 21
  app.get('/ponto', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ponto', 'visualizar')] }, async (req:any) => {
    const { funcionarioId, dataInicio, dataFim } = req.query as any;
    const where:any = { empresaId: req.user.empresaId };
    if (funcionarioId) where.funcionarioId = funcionarioId;
    if (dataInicio && dataFim) where.data = { gte: new Date(dataInicio), lte: new Date(dataFim) };
    return prisma.ponto.findMany({ where, include: { funcionario: true }, orderBy: { data: 'desc' }, take: 200 });
  });

  app.post('/ponto/manual', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ponto', 'criar')] }, async (req:any) => {
    const schema = z.object({
      funcionarioId: z.string(),
      data: z.string(),
      entrada: z.string().optional(),
      saidaIntervalo: z.string().optional(),
      retornoIntervalo: z.string().optional(),
      saida: z.string().optional()
    });
    const data = schema.parse(req.body);
    const funcionario = await prisma.funcionario.findFirst({ where: { id:data.funcionarioId, empresaId:req.user.empresaId } }); if(!funcionario) throw new Error('Funcionário inválido para esta empresa.');
    const dataPonto = new Date(data.data); dataPonto.setHours(0,0,0,0);
    const ponto = await prisma.ponto.upsert({
      where: { funcionarioId_data: { funcionarioId: data.funcionarioId, data: dataPonto } },
      update: {
        entrada: data.entrada ? new Date(data.entrada) : undefined,
        saidaIntervalo: data.saidaIntervalo ? new Date(data.saidaIntervalo) : undefined,
        retornoIntervalo: data.retornoIntervalo ? new Date(data.retornoIntervalo) : undefined,
        saida: data.saida ? new Date(data.saida) : undefined,
        origem: 'MANUAL'
      },
      create: {
        empresaId: req.user.empresaId,
        funcionarioId: data.funcionarioId,
        data: dataPonto,
        entrada: data.entrada ? new Date(data.entrada) : null,
        saidaIntervalo: data.saidaIntervalo ? new Date(data.saidaIntervalo) : null,
        retornoIntervalo: data.retornoIntervalo ? new Date(data.retornoIntervalo) : null,
        saida: data.saida ? new Date(data.saida) : null,
        origem: 'MANUAL'
      }
    });
    // Calcula atraso, hora extra, falta, inconsistência
    // Regra simples: expediente 08:00-18:00
    let atraso = 0, horaExtra = 0, falta = false, inconsistencia = null;
    if (!ponto.entrada && !ponto.saida) falta = true;
    if (ponto.entrada) {
      const entradaEsperada = new Date(data.data); entradaEsperada.setHours(8,0,0,0);
      const diff = (ponto.entrada.getTime() - entradaEsperada.getTime())/60000;
      if (diff>0) atraso = Math.round(diff);
    }
    if (ponto.saida) {
      const saidaEsperada = new Date(data.data); saidaEsperada.setHours(18,0,0,0);
      const diff = (ponto.saida.getTime() - saidaEsperada.getTime())/60000;
      if (diff>0) horaExtra = Math.round(diff);
    }
    if (ponto.entrada && ponto.saida && ponto.entrada > ponto.saida) inconsistencia = 'Entrada após saída';

    const pontoAtualizado = await prisma.ponto.update({ where: { id: ponto.id }, data: { atrasoMinutos: atraso, horaExtraMinutos: horaExtra, falta, inconsistencia } });
    // Fluxo: PONTO -> RH -> INDICADORES -> DASHBOARD -> IA (Seção 21)
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'Ponto', entidadeId: ponto.id, valorNovo: pontoAtualizado, origem: 'MANUAL', ip: req.ip, contexto: 'Ponto -> RH -> Indicadores -> Dashboard -> IA' });
    return pontoAtualizado;
  });

  // Integração ControlID iDClass: somente endpoints documentados pelo fabricante.
  app.post('/ponto/integracao', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ponto', 'criar')] }, async (req:any) => {
    const data=z.object({nome:z.string().min(2),url:z.string().url(),usuario:z.string().min(1),senha:z.string().min(1)}).parse(req.body);
    const integracao=await prisma.integracaoPonto.create({data:{empresaId:req.user.empresaId,nome:data.nome,url:data.url.replace(/\/$/,''),usuario:data.usuario,senhaCriptografada:encryptSecret(data.senha),status:'NAO_CONFIGURADO'}});
    return {integracao:{...integracao,senhaCriptografada:undefined},aviso:'Credencial armazenada criptografada no backend. A sincronização usa somente /login.fcgi, /load_objects.fcgi e /logout.fcgi da API oficial Control iD.'};
  });

  app.post('/ponto/sincronizar/:integracaoId', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ponto', 'editar')] }, async (req:any,reply) => {
    const {integracaoId}=req.params; const integracao=await prisma.integracaoPonto.findFirst({where:{id:integracaoId,empresaId:req.user.empresaId}}); if(!integracao)throw new Error('Integração não encontrada nesta empresa.');
    let session:string|undefined;
    try {
      if(!integracao.senhaCriptografada) throw new Error('Credencial da integração não configurada. Reconfigure a integração.'); const senha=decryptSecret(integracao.senhaCriptografada);
      const loginResp=await fetch(`${integracao.url}/login.fcgi`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:integracao.usuario,password:senha})});
      if(!loginResp.ok)throw new Error(`Falha no login do equipamento: HTTP ${loginResp.status}`);
      const loginBody:any=await loginResp.json(); session=loginBody.session; if(!session)throw new Error('Equipamento não retornou sessão.');
      const logs:any[]=[]; let offset=0; const ultimaSync=integracao.ultimaSincronizacao?Math.floor(integracao.ultimaSincronizacao.getTime()/1000):null;
      while(true){const body:any={object:'access_logs',fields:['id','time','event','user_id'],limit:1000,offset};if(ultimaSync)body.where=[{object:'access_logs',field:'time',operator:'>',value:ultimaSync}];const logsResp=await fetch(`${integracao.url}/load_objects.fcgi?session=${encodeURIComponent(session)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!logsResp.ok)throw new Error(`Falha ao carregar access_logs: HTTP ${logsResp.status}`);const logsBody:any=await logsResp.json();const page=Array.isArray(logsBody.access_logs)?logsBody.access_logs:[];logs.push(...page);if(page.length<1000)break;offset+=1000;}
      const logsValidos=logs.filter((l:any)=>Number(l.event)===7 && l.user_id!==undefined && l.time!==undefined).sort((a:any,b:any)=>Number(a.time)-Number(b.time));
      const porFuncionario=new Map<string,any[]>();
      for(const log of logsValidos){const func=await prisma.funcionario.findFirst({where:{empresaId:req.user.empresaId,idExternoPonto:String(log.user_id)}});if(!func)continue;const dataLog=new Date(Number(log.time)*1000);const dia=new Date(Date.UTC(dataLog.getUTCFullYear(),dataLog.getUTCMonth(),dataLog.getUTCDate()));const key=`${func.id}:${dia.toISOString().slice(0,10)}`;if(!porFuncionario.has(key))porFuncionario.set(key,[]);porFuncionario.get(key)!.push({func,dataLog,log,dia});}
      let processados=0;
      for(const batidas of porFuncionario.values()){const {func,dia}=batidas[0];const ordered=batidas.slice(0,4);const dados:any={entrada:ordered[0]?.dataLog||null,saidaIntervalo:ordered[1]?.dataLog||null,retornoIntervalo:ordered[2]?.dataLog||null,saida:ordered[3]?.dataLog||null,origem:'PONTO'};const ids=ordered.map((b:any)=>String(b.log.id));const inconsistencia=batidas.length>4?'Mais de quatro batidas no dia; somente as quatro primeiras foram vinculadas aos campos disponíveis.':null;await prisma.ponto.upsert({where:{funcionarioId_data:{funcionarioId:func.id,data:dia}},update:{...dados,idExterno:ids[ids.length-1],inconsistencia},create:{empresaId:req.user.empresaId,funcionarioId:func.id,data:dia,...dados,idExterno:ids[ids.length-1],inconsistencia}});processados++;}
      await prisma.integracaoPonto.update({where:{id:integracao.id},data:{status:'CONECTADO',ultimaSincronizacao:new Date(),qtdRegistros:processados,erros:null}});
      await fetch(`${integracao.url}/logout.fcgi?session=${encodeURIComponent(session)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})}).catch(()=>undefined);
      await registrarAuditoria({usuarioId:req.user.id,empresaId:req.user.empresaId,acao:'SINCRONIZAR',entidade:'IntegracaoPonto',entidadeId:integracao.id,origem:'PONTO',ip:req.ip,contexto:`Control iD: ${processados} registros processados`});
      return {ok:true,processados,status:'CONECTADO',metodoOficial:['POST /login.fcgi','POST /load_objects.fcgi','POST /logout.fcgi']};
    } catch(error:any) {
      await prisma.integracaoPonto.update({where:{id:integracao.id},data:{status:'ERRO',erros:{message:error?.message||'Falha na sincronização'}}}).catch(()=>undefined);
      if(session) await fetch(`${integracao.url}/logout.fcgi?session=${encodeURIComponent(session)}`,{method:'POST'}).catch(()=>undefined);
      return reply.status(502).send({error:'Falha na sincronização com o equipamento.',detalhe:error?.message||'Erro desconhecido',status:'ERRO'});
    }
  });

}
=======
export const rhRoutes = router;
export default router;
>>>>>>> 9a24c34c6d11c3f2872b796a0c1af740ba42af22
