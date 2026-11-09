// Limpeza pontual de resíduos de execuções antigas do teste PDV FASE 2.
// Uso manual/excepcional: apaga vendas de teste (produto PDV-FASE2-*) para
// restaurar um estado limpo. NÃO faz parte do app.
import 'dotenv/config';
import { prisma } from './src/lib/prisma.js';

async function main() {
  const produtos = await prisma.produto.findMany({ where: { nome: { startsWith: 'PDV-FASE2-' } }, select: { id: true } });
  const pids = produtos.map((p) => p.id);
  let ids: string[] = [];
  if (pids.length) {
    const vendasTeste = await prisma.venda.findMany({
      where: { itens: { some: { produtoId: { in: pids } } } },
      select: { id: true },
    });
    ids = vendasTeste.map((v) => v.id);
  }
  console.log('Vendas de teste encontradas:', ids.length);
  if (ids.length) {
    await prisma.vendaPagamento.deleteMany({ where: { vendaId: { in: ids } } });
    await prisma.idempotencyKey.deleteMany({ where: { vendaId: { in: ids } } });
    await prisma.financeiro.deleteMany({ where: { vendaId: { in: ids } } });
    await prisma.estoqueMovimentacao.deleteMany({ where: { documento: { in: ids } } });
    await prisma.auditoria.deleteMany({ where: { entidade: 'Venda', entidadeId: { in: ids } } });
    await prisma.venda.deleteMany({ where: { id: { in: ids } } });
  }
  if (pids.length) {
    await prisma.estoqueMovimentacao.deleteMany({ where: { produtoId: { in: pids } } });
    await prisma.estoque.deleteMany({ where: { produtoId: { in: pids } } });
    await prisma.produto.deleteMany({ where: { id: { in: pids } } });
    console.log('Produtos de teste removidos:', pids.length);
  }
  const orfas = await prisma.idempotencyKey.deleteMany({ where: { OR: [{ key: { startsWith: 'idem-' } }, { key: { startsWith: 'desc-' } }], vendaId: null } });
  console.log('IdempotencyKeys órfãs removidas:', orfas.count);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
