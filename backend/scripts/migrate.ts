import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL não definida. Configure o arquivo .env (veja .env.example).');
    process.exit(1);
  }

  const schemaPath = join(__dirname, '..', '..', 'database', 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    console.log('Aplicando schema.sql em', databaseUrl.replace(/:[^:@]+@/, ':****@'));
    await pool.query(sql);
    console.log('Migration aplicada com sucesso.');
  } catch (err) {
    console.error('Erro ao aplicar migration:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
