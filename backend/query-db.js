import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  // Replace with your actual connection string
});

async function main() {
  try {
    // Override connection URL
    prisma.$use(async (params, next) => {
      if (params.model === 'usuario' || params.model === 'empresa') {
        // Just proceed with default
      }
      return next(params);
    });
    
    const e = await prisma.empresa.findFirst({
      include: { filiais: true, usuarios: true }
    });
    console.log('Empresa:', e.nome);
    console.log('Filiais:', e.filiais.length);
    console.log('Total usuarios:', e.usuarios.length);
    
    const f = await prisma.filial.count();
    console.log('Filiais totais:', f);
    
    const p = await prisma.produto.count();
    console.log('Produtos:', p);
    
    const v = await prisma.venda.count();
    console.log('Vendas:', v);
    
    const fp = await prisma.fornecedor.count();
    console.log('Fornecedores:', fp);
    
    const cp = await prisma.contaPagar.count();
    console.log('Contas a pagar:', cp);
    
    const cr = await prisma.contaReceber.count();
    console.log('Contas a receber:', cr);
    
    const me = await prisma.estoqueMovimentacao.count();
    console.log('Movimentacao estoque:', me);
    
    const ua = await prisma.usuario.count({ where: { status: 'ATIVO' } });
    console.log('Usuarios ativos:', ua);
    
    const ui = await prisma.usuario.count({ where: { status: 'INATIVO' } });
    console.log('Usuarios inativos:', ui);
    
    const fol = await prisma.folhaPagamento.findFirst({
      orderBy: { createdAt: 'desc' }
    });
    console.log('Ultima folha:', fol ? fol.competencia : 'none');
    
    const indicadores = await prisma.indicadorDiario.findMany({
      orderBy: { data: 'desc' },
      take: 5
    });
    console.log('Ultimos indicadores:', indicadores.length);
    
    console.log('---');
    // List model names
    const modelNames = Object.keys(prisma.$docsGQL || {}).map(k => k.replace('__', '.'));
    console.log('Models accessible via Prisma Client');
    
  } catch (err) {
    console.error('Error:', err);
  }
}

main();