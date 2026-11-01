/**
 * Restauração de backup (par do backup.ts — Seção 37).
 *
 * Uso: npm run backup:restaurar -- ./backups/nexus_2026-09-13T10-00-00.dump
 *
 * ATENÇÃO: `pg_restore --clean` apaga objetos existentes antes de
 * recriá-los. Rode isso contra um banco vazio ou de homologação, nunca
 * direto contra produção sem um backup novo do estado atual antes.
 */
import { spawn } from 'node:child_process';

function executar(comando: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const processo = spawn(comando, args, { stdio: 'inherit', env: process.env });
    processo.on('error', reject);
    processo.on('exit', (codigo) => {
      if (codigo === 0) resolve();
      else reject(new Error(`${comando} saiu com código ${codigo}`));
    });
  });
}

async function main(): Promise<void> {
  const arquivo = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  if (!arquivo) {
    console.error('[restaurar] uso: npm run backup:restaurar -- <caminho-do-dump>');
    process.exitCode = 1;
    return;
  }
  if (!databaseUrl) {
    console.error('[restaurar] DATABASE_URL não configurada.');
    process.exitCode = 1;
    return;
  }
  console.log(`[restaurar] restaurando ${arquivo} em ${databaseUrl.replace(/:[^:@]+@/, ':***@')}...`);
  await executar('pg_restore', ['--clean', '--if-exists', '-d', databaseUrl, arquivo]);
  console.log('[restaurar] concluído.');
}

main().catch((err) => {
  console.error('[restaurar] falhou:', err.message);
  process.exitCode = 1;
});
