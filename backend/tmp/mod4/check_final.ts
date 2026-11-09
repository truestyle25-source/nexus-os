// Verifica resíduos do teste no banco isolado e a integridade da produção (read-only).
import 'dotenv/config';
import { prisma } from '../../src/lib/prisma.js';

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  console.log('DATABASE_URL banco alvo:', url.split('/').pop());
  const emp = await prisma.empresa.findMany({ where: { nome: { startsWith: 'M4-' } }, select: { id: true, nome: true } });
  console.log('empresas M4 residuais:', emp.length);
  for (const e of emp) console.log('  -', e.nome);
  const c = await prisma.caixa.count();
  const v = await prisma.venda.count();
  const m = await prisma.movimentacaoCaixa.count();
  console.log('totais no banco: caixas=%d vendas=%d movimentacoes=%d', c, v, m);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
