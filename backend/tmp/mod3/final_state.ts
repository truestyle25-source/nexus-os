import { prisma } from '../../src/lib/prisma.js';
(async () => {
  const v = await prisma.venda.count();
  const it = await prisma.vendaItem.count();
  const mov = await prisma.estoqueMovimentacao.count();
  const saldos = await prisma.estoque.findMany({ select: { quantidade: true } });
  const min = saldos.length ? Math.min(...saldos.map((s) => Number(s.quantidade))) : null;
  console.log(JSON.stringify({ vendas: v, itens: it, movimentacoes: mov, minSaldo: min }));
  await prisma.$disconnect();
})();
