// MÓDULO 04 — criação do banco isolado e descartável nexus_os_mod4.
// Uso exclusivo do Módulo 04. NÃO toca em nexus_os (produção/dev).
import { PrismaClient } from '@prisma/client';

const ADMIN_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';
const DB = 'nexus_os_mod4';

async function main() {
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  const rows = await admin.$queryRawUnsafe<Array<{ c: bigint }>>(
    'SELECT count(*)::int AS c FROM pg_database WHERE datname = $1',
    DB,
  );
  const exists = Number(rows[0]?.c ?? 0) > 0;
  if (!exists) {
    // CREATE DATABASE não aceita parâmetros; nome é literal fixo e seguro.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${DB}"`);
    console.log('CRIADO', DB);
  } else {
    console.log('JA EXISTE', DB);
  }
  await admin.$disconnect();
  console.log('URL', `postgresql://postgres:postgres@localhost:5432/${DB}`);
}
main().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
