// Verifica o estado do banco isolado nexus_os_mod3 (read-only).
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres:postgres@localhost:5432/nexus_os_mod3' } } });
async function main() {
  const mig = await prisma.$queryRaw<Array<{ c: bigint }>>`SELECT count(*) AS c FROM _prisma_migrations`;
  const vendas = await prisma.$queryRaw<Array<{ c: bigint }>>`SELECT count(*) AS c FROM "Venda"`;
  const produtos = await prisma.$queryRaw<Array<{ c: bigint }>>`SELECT count(*) AS c FROM "Produto"`;
  const empresas = await prisma.$queryRaw<Array<{ c: bigint }>>`SELECT count(*) AS c FROM "Empresa"`;
  console.log('migrations=%d empresas=%d produtos=%d vendas=%d', Number(mig[0].c), Number(empresas[0].c), Number(produtos[0].c), Number(vendas[0].c));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
