/**
 * Backup do banco (Seção 37 do prompt mestre).
 *
 * Usa `pg_dump` (ferramenta oficial do Postgres, já presente em qualquer
 * ambiente com cliente Postgres instalado) contra a `DATABASE_URL` do
 * `.env`. Gera um dump comprimido em `BACKUP_DIR` (padrão `./backups`),
 * nomeado com data/hora, e apaga dumps mais antigos que
 * `BACKUP_RETENCAO_DIAS` (padrão 30) para não crescer sem limite.
 *
 * Uso:
 *   npm run backup            # gera um backup agora
 *   npm run backup:restaurar -- ./backups/nexus_2026-09-13T10-00-00.dump
 *
 * Não pude testar isso contra um banco real neste ambiente (sem rede/
 * Postgres aqui) — a lógica de invocação do `pg_dump`/`pg_restore` e de
 * limpeza por retenção foi revisada por inspeção, mas rode uma vez em
 * ambiente de homologação antes de confiar nisso em produção.
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups');
const RETENCAO_DIAS = Number(process.env.BACKUP_RETENCAO_DIAS ?? 30);

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

async function limparBackupsAntigos(): Promise<void> {
  const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
  const arquivos = await readdir(BACKUP_DIR).catch(() => [] as string[]);
  for (const arquivo of arquivos) {
    if (!arquivo.endsWith('.dump')) continue;
    const caminho = path.join(BACKUP_DIR, arquivo);
    const info = await stat(caminho);
    if (info.mtimeMs < limite) {
      await unlink(caminho);
      console.log(`[backup] removido por retenção (${RETENCAO_DIAS} dias): ${arquivo}`);
    }
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[backup] DATABASE_URL não configurada — nada para fazer backup.');
    process.exitCode = 1;
    return;
  }
  await mkdir(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(BACKUP_DIR, `nexus_${timestamp}.dump`);

  console.log(`[backup] iniciando pg_dump para ${destino}...`);
  // -F c = formato "custom" do pg_dump: comprimido e restaurável com
  // pg_restore, inclusive parcialmente (schema só, dados só, tabela só).
  await executar('pg_dump', [databaseUrl, '-F', 'c', '-f', destino]);
  console.log('[backup] concluído.');

  await limparBackupsAntigos();
}

main().catch((err) => {
  console.error('[backup] falhou:', err.message);
  process.exitCode = 1;
});
