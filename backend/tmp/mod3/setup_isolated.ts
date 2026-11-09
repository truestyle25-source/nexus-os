// Cria o banco isolado de homologação do Módulo 03 (NÃO toca em nexus_os).
// Idempotente: se já existir, apenas confirma.
import { Client } from 'pg';

const ADMIN = 'postgresql://postgres:postgres@localhost:5432/postgres';
const DB = 'nexus_os_mod3';

async function main() {
  const client = new Client({ connectionString: ADMIN });
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE "${DB}"`);
    console.log(`CRIADO banco isolado: ${DB}`);
  } else {
    console.log(`Banco isolado já existe: ${DB}`);
  }
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
