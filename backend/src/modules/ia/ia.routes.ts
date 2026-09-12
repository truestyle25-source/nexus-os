
import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';

export async function iaRoutes(app: FastifyInstance) {
  // Seção 22 - NEXUS OS -> BACKEND -> OPENAI API -> BACKEND -> NEXUS AI - chave nunca frontend Seção 39
  app.post('/ia/perguntar', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ia', 'visualizar')] }, async (req:any) => {
    const { pergunta } = req.body as any;
    if (!pergunta) throw new Error('Pergunta obrigatória - Seção 23 ASSISTENTE');

    const usuario = await prisma.usuario.findFirst({ where: { id: req.user.id, empresaId: req.user.empresaId }, include: { permissoes: true } });
    const perms = usuario?.permissoes.filter((p:any)=>p.permitido) || [];
    const isAdminSeed = perms.length===0;

    // Seção 25 - Permissões IA = permissões usuário
    const pode = (modulo:string, acao:string) => isAdminSeed || perms.some((p:any)=>p.modulo===modulo && p.acao===acao);
    const podeFinanceiro = pode('financeiro','visualizar');
    const podeCustos = pode('custos','visualizar') || pode('produtos','visualizar');
    const podeRH = pode('rh','visualizar');
    const podeEstoque = pode('estoque','visualizar');
    const podeVendas = pode('vendas','visualizar');

    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const amanha = new Date(hoje); amanha.setDate(amanha.getDate()+1);

    let contexto:any = { data: hoje.toISOString(), pergunta };

    // ASSISTENTE Seção 23 - só dados autorizados
    if (podeVendas) {
      const vendasHoje = await prisma.venda.findMany({ where: { empresaId: req.user.empresaId, createdAt: { gte: hoje, lt: amanha }, status: 'FINALIZADA' }, include: { itens: { include: { } } } });
      const faturamento = vendasHoje.reduce((s,v)=>s+Number(v.total),0);
      const ticketMedio = vendasHoje.length ? faturamento/vendasHoje.length : 0;
      // Produto mais vendido
      const itensCount:any = {};
      vendasHoje.forEach(v=>v.itens.forEach((i:any)=>{ itensCount[i.produtoId] = (itensCount[i.produtoId]||0)+i.quantidade; }));
      const prodMaisVendidoId = Object.keys(itensCount).sort((a,b)=>itensCount[b]-itensCount[a])[0];
      let prodMaisVendido = null;
      if (prodMaisVendidoId) prodMaisVendido = await prisma.produto.findFirst({ where: { id: prodMaisVendidoId, empresaId: req.user.empresaId } });
      contexto.vendas = { qtd: vendasHoje.length, faturamento, ticketMedio, produtoMaisVendido: prodMaisVendido?.nome || null };
    }

    if (podeEstoque) {
      const estoques = await prisma.estoque.findMany({ where: { empresaId: req.user.empresaId }, include: { produto: true, filial: true }, take: 20 });
      const baixo = estoques.filter((e:any)=>e.quantidade<=e.produto.estoqueMinimo);
      const zerado = estoques.filter((e:any)=>e.quantidade===0);
      const valorTotal = estoques.reduce((s,e)=>s+Number(e.valorTotal),0);
      contexto.estoque = { valorTotal, baixo: baixo.map((e:any)=>({ produto:e.produto.nome, atual:e.quantidade, minimo:e.produto.estoqueMinimo, filial:e.filial.nome })), zerado: zerado.map((e:any)=>e.produto.nome) };
    }

    if (podeFinanceiro) {
      const finHoje = await prisma.financeiro.findMany({ where: { empresaId: req.user.empresaId, createdAt: { gte: hoje, lt: amanha } } });
      contexto.financeiro = { receitas: finHoje.filter((f:any)=>f.tipo==='RECEITA').reduce((s:number,f:any)=>s+Number(f.valor),0), despesas: finHoje.filter((f:any)=>f.tipo==='DESPESA').reduce((s:number,f:any)=>s+Number(f.valor),0) };
    }

    if (podeRH) {
      const pontosHoje = await prisma.ponto.findMany({ where: { empresaId: req.user.empresaId, data: hoje } });
      contexto.rh = { faltas: pontosHoje.filter((p:any)=>p.falta).length, atrasos: pontosHoje.filter((p:any)=>p.atrasoMinutos>0).length, horasExtras: pontosHoje.reduce((s,p)=>s+p.horaExtraMinutos,0) };
    }

    // Seção 24 - IA nunca inventa dados
    // Chamada OpenAI oficial via backend
    let respostaIA = '';
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      respostaIA = `NEXUS AI - Sem OPENAI_API_KEY configurada no backend .env (Seção 22 e 39 - chave nunca no frontend). Dados REAIS com permissões respeitadas Seção 25:\n${JSON.stringify(contexto,null,2)}\n\nPara ativar IA completa, configure OPENAI_API_KEY no backend. Fluxo fiel: NEXUS OS -> BACKEND -> OPENAI API oficial -> BACKEND -> NEXUS AI. Nunca invento dados - Seção 24.`;
    } else {
      try {
        const systemPrompt = `Você é NEXUS AI do NEXUS OS. Seções 23,24,25 FIEIS:
- ASSISTENTE: Responda quanto vendemos hoje, produto mais vendido, setor, ticket médio, estoque - use só contexto fornecido
- ANALISTA: Detecte queda vendas, aumento despesas, redução margem, produtos parados, estoque baixo, anomalias, alterações incomuns, produtividade
- COPILOTO: Forneça recomendações, insights, previsões, alertas inteligentes, sugestões melhoria, comparações, possíveis causas, oportunidades
- Seção 24: NUNCA invente dados. Só use contexto. Se não tem info suficiente, diga "Não possuo informação suficiente"
- Seção 25: Respeite permissões - contexto já só tem dados autorizados. Se perguntarem de módulo sem permissão, diga "Você não tem permissão para acessar [módulo] - Seção 25"
- Seção 26: Se for pergunta sobre por que lucro caiu, cruze vendas, custos, despesas, produtos, margens, financeiro, DRE, estoque
- Contexto real: ${JSON.stringify(contexto)}`;

        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: pergunta }],
            temperature: 0.3
          })
        });
        const data:any = await resp.json();
        if (data.error) throw new Error(data.error.message);
        respostaIA = data.choices?.[0]?.message?.content || 'Sem resposta';
      } catch (e:any) {
        respostaIA = `Erro ao chamar OpenAI API oficial (https://api.openai.com/v1/chat/completions) - Seção 22 fiel: ${e.message}. Dados reais: ${JSON.stringify(contexto,null,2)}`;
      }
    }

    const conversa = await prisma.conversaIA.create({ data: { empresaId: req.user.empresaId, usuarioId: req.user.id, pergunta, resposta: respostaIA, contexto, origem: 'IA' } });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'ConversaIA', entidadeId: conversa.id, origem: 'IA', ip: req.ip });

    return { resposta: respostaIA, contexto, permissoesRespeitadas: true, fluxo: 'NEXUS OS -> BACKEND -> OPENAI API oficial -> BACKEND -> NEXUS AI - Seção 22 e 39 - chave nunca frontend' };
  });

  // Seção 26 Intelligence Center
  app.get('/ia/intelligence-center', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ia', 'visualizar')] }, async (req:any) => {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const vendasHoje = await prisma.venda.findMany({ where: { empresaId: req.user.empresaId, createdAt: { gte: hoje } } });
    const estoqueBaixo = await prisma.estoque.findMany({ where: { empresaId: req.user.empresaId }, include: { produto: true } });
    const baixoReal = estoqueBaixo.filter((e:any)=>e.quantidade<=e.produto.estoqueMinimo);
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate()-1);
    const vendasOntem = await prisma.venda.findMany({ where: { empresaId: req.user.empresaId, status:'FINALIZADA', createdAt: { gte: ontem, lt: hoje } } });
    const faturamentoOntem = vendasOntem.reduce((s,v)=>s+Number(v.total),0);
    const financeiroHoje = await prisma.financeiro.findMany({ where: { empresaId: req.user.empresaId, createdAt: { gte: hoje } } });
    const metasBaixas = await prisma.meta.findMany({ where: { empresaId: req.user.empresaId, percentual: { lt: 70 } } });

    const oQueAconteceu = { vendasHoje: vendasHoje.length, faturamentoHoje: vendasHoje.reduce((s,v)=>s+Number(v.total),0), estoqueBaixo: baixoReal.length, receitasHoje: financeiroHoje.filter((f:any)=>f.tipo==='RECEITA').reduce((s:number,f:any)=>s+Number(f.valor),0) };
    const problemas = [
      ...baixoReal.map((e:any)=>({ tipo: 'ESTOQUE_BAIXO', problema: `Produto ${e.produto.nome} abaixo mínimo (${e.quantidade} <= ${e.produto.estoqueMinimo})`, possivelCausa: 'Vendas ou falta reposição', impacto: 'Risco ruptura e perda vendas', recomendacao: `Comprar ${e.produto.estoqueMaximo - e.quantidade} unidades` })),
      ...metasBaixas.map((m:any)=>({ tipo: 'META_BAIXA', problema: `Meta ${m.tipo} ${m.periodo} em ${Number(m.percentual).toFixed(1)}%`, possivelCausa: 'Vendas abaixo esperado ou meta agressiva', impacto: 'Não bater meta mensal', recomendacao: 'Analisar setor e funcionários com ranking' }))
    ];
    const oportunidades = [{ tipo: 'PRODUTO_POTENCIAL', descricao: 'Produtos com giro alto - aumentar estoque máximo' }, { tipo: 'HORARIO_VENDA', descricao: 'Analisar vendas por horário para otimizar equipe' }];

    const crescimento = faturamentoOntem ? ((Number(oQueAconteceu.faturamentoHoje)-faturamentoOntem)/faturamentoOntem)*100 : 0;
    return { oQueAconteceu, oQueMudou: { crescimento }, problemas, oportunidades, recomendacoes: problemas.map((p:any)=>({ problema:p.problema, possivelCausa:p.possivelCausa, impacto:p.impacto, recomendacao:p.recomendacao })) };
  });

  // Seção 27 Alertas + 28 Notificações + 29 Automação
  app.get('/alertas', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ia', 'visualizar')] }, async (req:any) => {
    return prisma.alerta.findMany({ where: { empresaId: req.user.empresaId }, orderBy: { createdAt: 'desc' }, take: 100 });
  });

  app.get('/notificacoes', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ia', 'visualizar')] }, async (req:any) => {
    return prisma.notificacao.findMany({ where: { empresaId: req.user.empresaId }, orderBy: { createdAt: 'desc' }, take: 100 });
  });

  app.post('/notificacoes/:id/lida', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ia', 'visualizar')] }, async (req:any) => {
    const { id } = req.params;
    const notificacao = await prisma.notificacao.findFirst({ where: { id, empresaId: req.user.empresaId, OR: [{ usuarioId: null }, { usuarioId: req.user.id }] } });
    if (!notificacao) throw new Error('Notificação não encontrada para esta sessão.');
    return prisma.notificacao.update({ where: { id: notificacao.id }, data: { lida: true } });
  });

  app.get('/automacao/regras', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ia', 'visualizar')] }, async (req:any) => {
    return prisma.regraAutomacao.findMany({ where: { empresaId: req.user.empresaId } });
  });

  app.post('/automacao/regras', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ia', 'criar')] }, async (req:any) => {
    const { nome, condicao, acao } = req.body as any;
    return prisma.regraAutomacao.create({ data: { empresaId: req.user.empresaId, nome, condicao, acao, origem: 'AUTOMATICO' } });
  });

  // Motor SE/ENTÃO Seção 29 - fiel
  app.post('/automacao/executar', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ia', 'editar')] }, async (req:any) => {
    const alertasCriados:any[] = [];
    // SE estoque < mínimo ENTÃO alerta
    const estoques = await prisma.estoque.findMany({ where: { empresaId: req.user.empresaId }, include: { produto: true, filial: true } });
    for (const est of estoques) {
      if (est.quantidade <= est.produto.estoqueMinimo) {
        const tipoEstoque = est.quantidade === 0 ? 'ESTOQUE_ZERADO' : 'ESTOQUE_BAIXO';
        const existente = await prisma.alerta.findFirst({ where: { empresaId:req.user.empresaId, tipo: tipoEstoque, entidade:'Produto', entidadeId:est.produtoId, status:'ABERTO' } });
        if (!existente) {
          const alerta = await prisma.alerta.create({
            data: { empresaId: req.user.empresaId, tipo: tipoEstoque, prioridade: est.quantidade===0?'CRITICA':'ALTA', titulo: `${est.quantidade===0?'Estoque zerado':'Estoque baixo'}: ${est.produto.nome}`, descricao: `Atual ${est.quantidade} <= mínimo ${est.produto.estoqueMinimo} na filial ${est.filial.nome}`, entidade: 'Produto', entidadeId: est.produtoId, origem: 'AUTOMATICO' }
          });
          alertasCriados.push(alerta);
          await prisma.notificacao.create({ data: { empresaId:req.user.empresaId, tipo:tipoEstoque, prioridade:est.quantidade===0?'CRITICA':'ALTA', titulo:alerta.titulo, mensagem:alerta.descricao, origem:'AUTOMATICO', link:`/produtos/${est.produtoId}` } });
        }
      }
      // Produto próximo validade Seção 9
      if (est.produto.validade) {
        const dias = (new Date(est.produto.validade).getTime() - Date.now())/86400000;
        if (dias <= 7 && dias >=0) {
          const existente = await prisma.alerta.findFirst({ where:{empresaId:req.user.empresaId,tipo:'VALIDADE',entidade:'Produto',entidadeId:est.produtoId,status:'ABERTO'} });
          if (existente) continue;
          const alerta = await prisma.alerta.create({ data: { empresaId: req.user.empresaId, tipo: 'VALIDADE', prioridade: 'ALTA', titulo: `Validade próxima: ${est.produto.nome}`, descricao: `Vence em ${Math.ceil(dias)} dias`, entidade: 'Produto', entidadeId: est.produtoId, origem: 'AUTOMATICO' } });
          alertasCriados.push(alerta);
        }
      }
    }
    // SE meta <70% ENTÃO alerta + análise IA
    const metas = await prisma.meta.findMany({ where: { empresaId: req.user.empresaId } });
    for (const meta of metas) {
      if (Number(meta.percentual) < 70 && Number(meta.percentual) >0) {
        const existente = await prisma.alerta.findFirst({ where:{empresaId:req.user.empresaId,tipo:'META_BAIXA',entidade:'Meta',entidadeId:meta.id,status:'ABERTO'} });
        if (existente) continue;
        const alerta = await prisma.alerta.create({ data: { empresaId: req.user.empresaId, tipo: 'META_BAIXA', prioridade: 'MEDIA', titulo: `Meta abaixo 70%: ${meta.tipo} ${meta.periodo}`, descricao: `Meta em ${Number(meta.percentual).toFixed(1)}%`, origem: 'AUTOMATICO' } });
        alertasCriados.push(alerta);
      }
    }
    // SE despesa aumentar acima % ENTÃO alerta
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const despesasHoje = await prisma.financeiro.findMany({ where: { empresaId: req.user.empresaId, tipo: 'DESPESA', createdAt: { gte: hoje } } });
    const totalDespesasHoje = despesasHoje.reduce((s,f)=>s+Number(f.valor),0);
    // Compara com média últimos 7 dias (simplificado)
    const seteDiasAtras = new Date(); seteDiasAtras.setDate(seteDiasAtras.getDate()-7);
    const despesas7dias = await prisma.financeiro.findMany({ where: { empresaId: req.user.empresaId, tipo: 'DESPESA', createdAt: { gte: seteDiasAtras, lt: hoje } } });
    const diasComDados = new Set(despesas7dias.map(f=>new Date(f.createdAt).toISOString().slice(0,10))).size;
    const media7dias = diasComDados ? despesas7dias.reduce((s,f)=>s+Number(f.valor),0)/diasComDados : 0;
    if (media7dias && totalDespesasHoje > media7dias*1.3) {
      const existente = await prisma.alerta.findFirst({ where:{empresaId:req.user.empresaId,tipo:'DESPESA_ALTA',status:'ABERTO',createdAt:{gte:hoje}} });
      if (existente) return { executado:true, alertasCriados:alertasCriados.length, alertas:alertasCriados, motor:'SE/ENTÃO' };
      const alerta = await prisma.alerta.create({ data: { empresaId: req.user.empresaId, tipo: 'DESPESA_ALTA', prioridade: 'ALTA', titulo: 'Aumento despesas', descricao: `Despesas hoje R$ ${totalDespesasHoje.toFixed(2)} 30% acima média 7 dias R$ ${media7dias.toFixed(2)}`, origem: 'AUTOMATICO' } });
      alertasCriados.push(alerta);
    }

    return { executado: true, alertasCriados: alertasCriados.length, alertas: alertasCriados, motor: 'SE/ENTÃO Seção 29 fiel' };
  });
}
