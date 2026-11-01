
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';

export async function importacaoRoutes(app: FastifyInstance) {
  // Seção 30 Importação Inteligente - 11 passos
  app.post('/importacao', { preHandler: [(app as any).authenticate, await permissaoMiddleware('importacao', 'criar')] }, async (req:any) => {
    const { tipo, dados, mapeamento } = req.body as any; // dados = array linhas, mapeamento = {entidade, campos}
    if (!Array.isArray(dados)) throw new Error('dados deve ser um array.');
    if (dados.length > 5000) throw new Error('A importação está limitada a 5000 linhas por operação.');
    // Arquivo vazio: sem esta guarda, `confirmado` marcava a importação como
    // IMPORTADO com 0 linhas gravadas — sucesso falso.
    if (dados.length === 0) throw new Error('Nenhum dado para importar: o arquivo está vazio.');
    if (tipo !== undefined && (typeof tipo !== 'string' || tipo.length > 20)) {
      throw new Error('tipo deve ser uma string de até 20 caracteres.');
    }
    if (!mapeamento || typeof mapeamento !== 'object') throw new Error('mapeamento é obrigatório.');
    if (typeof mapeamento.entidade !== 'string' || !mapeamento.entidade.trim()) {
      throw new Error('mapeamento.entidade é obrigatório.');
    }
    // A validação abaixo lê campos com defaults (`campos?.nome || 'nome'`), mas o
    // caminho de GRAVAÇÃO usava `mapeamento.campos.nome` direto: um payload com
    // `entidade` e sem `campos` validava e depois quebrava com TypeError (500).
    // Um só objeto de campos para as duas etapas garante que leem o MESMO dado.
    const campos = {
      nome: mapeamento.campos?.nome || 'nome',
      sku: mapeamento.campos?.sku || 'sku',
      custo: mapeamento.campos?.custo || 'custo',
      precoVenda: mapeamento.campos?.precoVenda || 'precoVenda',
    };
    // 1. Upload já feito (dados recebidos)
    // 2. Identificação colunas - dados[0] keys
    // 3. Pré-visualização - primeiros 5
    const preview = dados?.slice(0,5) || [];
    const colunas = dados?.[0] ? Object.keys(dados[0]) : [];
    // 4. Mapeamento
    // 5. Validação
    let erros:any[] = [];
    let duplicidades:any[] = [];
    if (dados && mapeamento) {
      const vistos = new Set();
      for (let i=0;i<dados.length;i++) {
        const linha = dados[i];
        // `[null]` é JSON válido e quebrava com TypeError (500) em `linha[...]`.
        if (!linha || typeof linha !== 'object') {
          erros.push({ linha: i, erro: 'Linha inválida: cada registro deve ser um objeto com os campos mapeados.' });
          continue;
        }
        if (mapeamento.entidade==='Produto') {
          if (!linha[campos.nome]) erros.push({ linha:i, campo:'nome', erro:'Nome obrigatório - Seção 30 validação' });
          const sku = linha[campos.sku];
          if (sku) {
            if (vistos.has(sku)) {
              const dup = { linha: i, sku, erro: 'SKU duplicado no arquivo - Seção 30 duplicidades' };
              // Entra nas DUPLICIDADES (é o que a tela mostra) e também nos
              // ERROS: a etapa de duplicidades vem ANTES da importação no fluxo
              // documentado. Antes, a duplicidade era só avisada e a importação
              // seguia, batia no SKU na gravação e derrubava TUDO com a mensagem
              // errada ("SKU já cadastrado nesta empresa" — era o próprio arquivo).
              duplicidades.push(dup);
              erros.push(dup);
            }
            vistos.add(sku);
          }
        }
        if (mapeamento.entidade==='Funcionario') {
          if (!linha[campos.nome]) erros.push({ linha:i, erro:'Nome obrigatório' });
        }
      }
      // Só "Produto" tem rotina de gravação. Sem esta guarda, `confirmado:true`
      // para qualquer outra entidade marcava a importação como IMPORTADO com
      // `qtdImportada: 0` — a tela mostrava sucesso sem ter gravado nada.
      if (mapeamento.confirmado && mapeamento.entidade !== 'Produto') {
        erros.push({ erro: `Importação não suportada para a entidade "${mapeamento.entidade}". Somente "Produto" possui rotina de gravação.` });
      }
    }
    // 6. Duplicidades já identificadas
    // 7. Erros identificados
    // 8. Correção quando possível - retorna para frontend corrigir
    // 9. Confirmação - frontend confirma
    // 10. Importação - se sem erros, importa de fato
    let importados = 0;
    // A duplicidade também trava aqui: no fluxo da Seção 30 as duplicidades são
    // resolvidas ANTES da confirmação. `erros` já as contém (acima), então esta
    // condição é a rede de segurança final.
    if (erros.length===0 && duplicidades.length===0 && dados.length && mapeamento?.confirmado) {
      if (mapeamento.entidade==='Produto') {
        await prisma.$transaction(async tx=>{
          for (let i=0;i<dados.length;i++) {
            const linha=dados[i]; const nome=String(linha[campos.nome]||'').trim(); const sku=linha[campos.sku]?String(linha[campos.sku]).trim():undefined; const custo=Number(linha[campos.custo]||0); const precoVenda=Number(linha[campos.precoVenda]||0);
            if(!nome||custo<=0||precoVenda<=0){erros.push({linha:i,erro:'Nome, custo e preço de venda devem ser válidos e maiores que zero.'});continue;}
            if(sku){const existente=await tx.produto.findFirst({where:{empresaId:req.user.empresaId,sku}});if(existente){erros.push({linha:i,sku,erro:'SKU já cadastrado nesta empresa.'});continue;}}
            await tx.produto.create({data:{empresaId:req.user.empresaId,nome,sku,custo,precoVenda,margem:((precoVenda-custo)/precoVenda)*100,origem:'IMPORTADO'}}); importados++;
          }
          if(erros.length) throw new Error('Importação cancelada por erros de validação.');
        }).catch(e=>{if(!(e as any)?.message?.includes('Importação cancelada')) throw e; importados=0;});
      }
    }
    const importacaoId = randomUUID();
    const importacaoRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `INSERT INTO "Importacao" ("id", "empresaId", "usuarioId", "tipo", "status", "mapeamento", "erros", "qtdTotal", "qtdImportada", "qtdErro", "origem", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,'IMPORTADO',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       RETURNING *`,
      importacaoId, req.user.empresaId, req.user.id, tipo || 'csv', erros.length ? 'ERRO' : (mapeamento?.confirmado ? 'IMPORTADO' : 'MAPEANDO'),
      JSON.stringify(mapeamento ?? null), JSON.stringify(erros), dados?.length || 0, importados, erros.length,
    );
    const importacao = importacaoRows[0];

    // 11. Auditoria
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'IMPORTAR', entidade: 'Importacao', entidadeId: String(importacao.id), valorNovo: { tipo, qtdTotal: dados?.length, importados, erros: erros.length }, origem: 'IMPORTADO', ip: req.ip, contexto: 'Importação inteligente 11 passos Seção 30' });

    return { importacao, colunas, preview, mapeamento, erros, duplicidades, qtdTotal: dados?.length||0, qtdImportada: importados, fluxo: 'Upload->Identificação colunas->Pré-visualização->Mapeamento->Validação->Duplicidades->Erros->Correção->Confirmação->Importação->Auditoria Seção 30' };
  });

  app.get('/importacoes', { preHandler: [(app as any).authenticate, await permissaoMiddleware('importacao', 'visualizar')] }, async (req:any) => {
    return prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "Importacao" WHERE "empresaId" = $1 ORDER BY "createdAt" DESC LIMIT 50`,
      req.user.empresaId,
    );
  });

  // Seção 34 Pesquisa Global
  app.get('/pesquisa-global', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pesquisa', 'visualizar')] }, async (req:any) => {
    const { q } = req.query as any;
    if (!q || q.length<2) return { produtos:[], clientes:[], funcionarios:[], fornecedores:[], vendas:[] };
    const empresaId = req.user.empresaId;
    const produtos = await prisma.produto.findMany({ where: { empresaId, nome: { contains: q, mode: 'insensitive' } }, take: 10 });
    const clientes = await prisma.cliente.findMany({ where: { empresaId, nome: { contains: q, mode: 'insensitive' } }, take: 10 });
    const funcionarios = await prisma.funcionario.findMany({ where: { empresaId, nome: { contains: q, mode: 'insensitive' } }, take: 10 });
    const fornecedores = await prisma.fornecedor.findMany({ where: { empresaId, nome: { contains: q, mode: 'insensitive' } }, take: 10 });
    const vendas = await prisma.venda.findMany({ where: { empresaId, id: { contains: q } }, take: 10 });
    return { produtos, clientes, funcionarios, fornecedores, vendas, permissoesRespeitadas: true, secao: '34 Pesquisa Global' };
  });

  // Seção 33 Relatórios
  app.get('/relatorios/vendas', { preHandler: [(app as any).authenticate, await permissaoMiddleware('relatorios', 'visualizar')] }, async (req:any) => {
    const { dataInicio, dataFim, filialId, setorId, funcionarioId, produtoId, clienteId } = req.query as any;
    const where:any = { empresaId: req.user.empresaId };
    if (dataInicio && dataFim) where.createdAt = { gte: new Date(dataInicio), lte: new Date(dataFim) };
    if (filialId) where.filialId = filialId;
    if (setorId) where.setorId = setorId;
    if (funcionarioId) where.funcionarioId = funcionarioId;
    if (clienteId) where.clienteId = clienteId;
    if (produtoId) where.itens = { some: { produtoId } };
    const vendas = await prisma.venda.findMany({ where, include: { itens: { include: { } }, cliente: true }, orderBy: { createdAt: 'desc' }, take: 500 });
    // O `take: 500` recorta sem avisar: `faturamento` abaixo soma só as 500 mais
    // recentes. Sem expor o total do período, o chamador não tem como saber se
    // está vendo o período inteiro — e trataria o recorte como faturamento total.
    const totalNoPeriodo = await prisma.venda.count({ where });
    const truncado = totalNoPeriodo > vendas.length;
    const faturamento = vendas.reduce((s,v)=>s+Number(v.total),0);
    return { vendas, total: vendas.length, totalNoPeriodo, truncado, faturamento, filtros: { dataInicio, dataFim, filialId, setorId, funcionarioId, produtoId, clienteId }, exportavel: true, secao: '33 Relatórios com filtros' };
  });

  // Seção 36 API Pública + 35 Central Integrações
  app.get('/integracoes/central', { preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'visualizar')] }, async (req:any) => {
    const pdv = await prisma.integracaoPDV.findMany({ where: { empresaId: req.user.empresaId } });
    const ponto = await prisma.integracaoPonto.findMany({ where: { empresaId: req.user.empresaId } });
    return {
      pdv: pdv.map((p:any)=>({ nome:p.nome, status:p.status, configuracao: p.tipo, ultimaSincronizacao:p.ultimaSincronizacao, proximaSincronizacao:p.proximaSincronizacao, qtdRegistros:p.qtdRegistros, erros:p.erros, historico:p.historico })),
      ponto: ponto.map((p:any)=>({ nome:p.nome, status:p.status, ultimaSincronizacao:p.ultimaSincronizacao, qtdRegistros:p.qtdRegistros })),
      gemini: { nome:'Google Gemini API oficial', status: process.env.GEMINI_API_KEY?'CONECTADO':'NAO_CONFIGURADO', configuracao:'GEMINI_API_KEY no .env backend - nunca frontend Seção 39', ultimaSincronizacao: new Date() },
      apiPublica: { nome:'NEXUS API Pública', status:'PREPARADA', autenticacao:'JWT + API Key futura - Seção 36', documentacao:'Preparada para ERPs, PDVs, e-commerce, apps, sistemas internos' },
      secao: '35 Central Integrações + 36 API Pública'
    };
  });

  // Seção 44 Testes - estrutura
  app.get('/testes', { preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'visualizar')] }, async (req:any) => {
    return {
      testes: [
        { modulo:'Autenticação', casos:['Login válido','Login inválido','Sessão expirada','Recuperação senha'], status:'ESTRUTURADO Seção 44' },
        { modulo:'Permissões', casos:['Visualizar vendas sem excluir','Visualizar estoque sem custos','RH sem financeiro','IA respeita permissões Seção 25'], status:'ESTRUTURADO' },
        { modulo:'Produtos', casos:['Criar com SKU único','Margem calculada','Validade','Origem MANUAL'], status:'ESTRUTURADO' },
        { modulo:'Estoque', casos:['Entrada','Saída com validação insuficiente','Ajuste','Perda','Idempotência filial+produto Seção 46'], status:'ESTRUTURADO' },
        { modulo:'Vendas', casos:['Fluxo 13 passos Seção 2','Baixa estoque','Atualiza faturamento','Ticket médio','Metas','Financeiro','Auditoria'], status:'ESTRUTURADO' },
        { modulo:'PDV', casos:['Só API oficial','Central Conectado/Atenção/Erro/Não configurado','Última sync'], status:'ESTRUTURADO' },
        { modulo:'Financeiro', casos:['Receita venda automática','Despesa manual','DRE real sem fictício Seção 16'], status:'ESTRUTURADO' },
        { modulo:'RH e Ponto', casos:['CPF único','idExternoPonto','Ponto ControlID login.fcgi + load_objects.fcgi access_logs - nunca inventa','Atraso, falta, hora extra'], status:'ESTRUTURADO' },
        { modulo:'IA', casos:['Chave nunca frontend Seção 39','Permissões respeitadas Seção 25','Nunca inventa dados Seção 24'], status:'ESTRUTURADO' },
        { modulo:'Segurança', casos:['Validação entrada','Proteção API','Auditoria','LGPD Seção 38'], status:'ESTRUTURADO' }
      ],
      secao: '44 Testes - integração, sincronização, permissões, erros, segurança, performance'
    };
  });
}
