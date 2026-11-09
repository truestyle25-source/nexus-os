// Remove resíduos do teste M4 no banco isolado (tenants M4-* órfãos de runs interrompidos).
import 'dotenv/config';
import { prisma } from '../../src/lib/prisma.js';

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  console.log('banco alvo:', url.split('/').pop());
  if (!url.includes('nexus_os_mod4')) throw new Error('Banco alvo não é nexus_os_mod4 — abortando.');
  const empresas = await prisma.empresa.findMany({ where: { nome: { startsWith: 'M4-' } }, select: { id: true } });
  for (const e of empresas) {
    const vendas = await prisma.venda.findMany({ where: { empresaId: e.id }, select: { id: true } });
    const vids = vendas.map((v) => v.id);
    if (vids.length) {
      await prisma.vendaPagamento.deleteMany({ where: { vendaId: { in: vids } } });
      await prisma.idempotencyKey.deleteMany({ where: { vendaId: { in: vids } } });
      await prisma.financeiro.deleteMany({ where: { vendaId: { in: vids } } });
      await prisma.estoqueMovimentacao.deleteMany({ where: { documento: { in: vids } } });
      await prisma.auditoria.deleteMany({ where: { entidade: 'Venda', entidadeId: { in: vids } } });
      await prisma.venda.deleteMany({ where: { id: { in: vids } } });
    }
    const caixas = await prisma.caixa.findMany({ where: { empresaId: e.id }, select: { id: true } });
    const cids = caixas.map((c) => c.id);
    if (cids.length) {
      await prisma.movimentacaoCaixa.deleteMany({ where: { caixaId: { in: cids } } });
      await prisma.caixa.deleteMany({ where: { id: { in: cids } } });
    }
    await prisma.idempotencyKey.deleteMany({ where: { empresaId: e.id } });
    await prisma.auditoria.deleteMany({ where: { empresaId: e.id } });
    const produtos = await prisma.produto.findMany({ where: { empresaId: e.id }, select: { id: true } });
    const pids = produtos.map((p) => p.id);
    if (pids.length) {
      await prisma.estoqueMovimentacao.deleteMany({ where: { produtoId: { in: pids } } });
      await prisma.estoque.deleteMany({ where: { produtoId: { in: pids } } });
      await prisma.produto.deleteMany({ where: { id: { in: pids } } });
    }
    await prisma.permissao.deleteMany({ where: { usuario: { empresaId: e.id } } });
    await prisma.usuario.deleteMany({ where: { empresaId: e.id } });
    await prisma.filial.deleteMany({ where: { empresaId: e.id } });
    await prisma.empresa.deleteMany({ where: { id: e.id } });
    console.log('removido tenant', e.id);
  }
  console.log('restam: caixas=%d vendas=%d empresas M4=%d',
    await prisma.caixa.count(), await prisma.venda.count(),
    await prisma.empresa.count({ where: { nome: { startsWith: 'M4-' } } }));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
