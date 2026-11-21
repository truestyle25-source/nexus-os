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
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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

function capturar(comando: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const processo = spawn(comando, args, { stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
    let saida = '';
    processo.stdout.on('data', (d) => { saida += d; });
    processo.on('error', reject);
    processo.on('exit', (codigo) => (codigo === 0 ? resolve(saida) : reject(new Error(`${comando} saiu com código ${codigo}`))));
  });
}

async function limparBackupsAntigos(): Promise<void> {
  const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
  const arquivos = await readdir(BACKUP_DIR).catch(() => [] as string[]);
  for (const arquivo of arquivos) {
    if (!arquivo.endsWith('.dump') && !arquivo.endsWith('.dump.sha256')) continue;
    const caminho = path.join(BACKUP_DIR, arquivo);
    const info = await stat(caminho);
    if (info.mtimeMs < limite) {
      await unlink(caminho);
      console.log(`[backup] removido por retenção (${RETENCAO_DIAS} dias): ${arquivo}`);
    }
  }
}

async function main(): Promise<void> {
  // Com RLS, o backup precisa do papel dono das tabelas (nexus_migrator, via
  // DIRECT_URL): com nexus_app o pg_dump não lê _prisma_migrations e as
  // policies esconderiam as linhas. DATABASE_URL fica como fallback.
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[backup] DIRECT_URL/DATABASE_URL não configurada — nada para fazer backup.');
    process.exitCode = 1;
    return;
  }
  await mkdir(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(BACKUP_DIR, `nexus_${timestamp}.dump`);

  console.log(`[backup] iniciando pg_dump para ${destino}...`);
  // -F c = formato "custom" do pg_dump: comprimido e restaurável com
  // pg_restore, inclusive parcialmente (schema só, dados só, tabela só).
  // -n public: só o schema da aplicação (no Supabase, auth/storage são do provedor e o
  // dono das tabelas não tem permissão de ler esses schemas).
  await executar('pg_dump', [databaseUrl, '-F', 'c', '-n', 'public', '--no-owner', '-f', destino]);

  // Integridade: o arquivo precisa ser legível pelo pg_restore e ter objetos.
  // A soma SHA-256 é gravada ao lado (detecta corrupção em cópias posteriores).
  const indice = await capturar('pg_restore', ['--list', destino]);
  const objetos = indice.split('\n').filter((l) => l && !l.startsWith(';')).length;
  if (objetos === 0) throw new Error('dump gerado sem objetos restauráveis');
  const soma = createHash('sha256').update(await readFile(destino)).digest('hex');
  await writeFile(`${destino}.sha256`, `${soma}  ${path.basename(destino)}\n`);
  console.log(`[backup] concluído e verificado: ${objetos} objetos, sha256 ${soma.slice(0, 12)}…`);

  await limparBackupsAntigos();
}

main().catch((err) => {
  console.error('[backup] falhou:', err.message);
  process.exitCode = 1;
});
