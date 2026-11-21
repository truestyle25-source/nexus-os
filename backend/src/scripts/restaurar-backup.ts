/**
 * Restauração de backup (par do backup.ts — Seção 37), com travas de segurança.
 *
 * Uso:
 *   npm run backup:restaurar -- <arquivo.dump> --destino <URL do banco de DESTINO>
 *   (ou a URL em RESTORE_TARGET_URL)
 *
 * Travas (revisão de 2026-11-21 — antes o destino padrão era a própria DATABASE_URL,
 * e `pg_restore --clean` contra ela APAGARIA a produção):
 *  1. O destino é OBRIGATÓRIO e explícito. DATABASE_URL e DIRECT_URL nunca são usadas como destino.
 *  2. Se o destino for o mesmo banco da DATABASE_URL/DIRECT_URL configuradas (ou um host do
 *     Supabase), a restauração é recusada, a menos que se passe `--sobrescrever-producao=<nome do banco>`.
 *  3. O arquivo é validado ANTES (`pg_restore --list`): dump corrompido não toca no destino.
 *  4. O destino precisa estar VAZIO (sem tabelas em public), a menos que se passe `--limpar`
 *     (que usa `pg_restore --clean`).
 *  5. DEPOIS, confere: tabelas, migrações do Prisma, chaves estrangeiras e contagem de linhas,
 *     e grava um relatório JSON ao lado do dump.
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

function executar(comando: string, args: string[], capturar = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const processo = spawn(comando, args, { stdio: capturar ? ['ignore', 'pipe', 'inherit'] : 'inherit', env: process.env });
    let saida = '';
    processo.stdout?.on('data', (d) => { saida += d; });
    processo.on('error', reject);
    processo.on('exit', (codigo) => (codigo === 0 ? resolve(saida) : reject(new Error(`${comando} saiu com código ${codigo}`))));
  });
}

const mascarar = (url: string) => url.replace(/:[^:@/]+@/, ':***@');

/** host:porta/banco normalizado, para comparar destinos sem depender de usuário/senha/parâmetros. */
export function identidadeDoBanco(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}:${u.port || '5432'}/${u.pathname.replace(/^\//, '') || 'postgres'}`;
  } catch {
    return null;
  }
}

/** Decide se o destino é (ou parece ser) produção. */
export function destinoEhProducao(destino: string, env: NodeJS.ProcessEnv = process.env): { producao: boolean; motivo?: string } {
  const id = identidadeDoBanco(destino);
  if (!id) return { producao: true, motivo: 'URL de destino inválida' };
  for (const nome of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const v = env[nome];
    if (v && identidadeDoBanco(v) === id) return { producao: true, motivo: `o destino é o mesmo banco de ${nome}` };
  }
  if (/supabase\.(co|com)$/.test(id.split(':')[0])) return { producao: true, motivo: 'o destino é um host do Supabase' };
  return { producao: false };
}

function argumento(nome: string): string | undefined {
  const i = process.argv.findIndex((a) => a === nome || a.startsWith(`${nome}=`));
  if (i < 0) return undefined;
  const a = process.argv[i];
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : process.argv[i + 1];
}

async function main(): Promise<void> {
  const arquivo = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
  const destino = argumento('--destino') || process.env.RESTORE_TARGET_URL;
  if (!arquivo || !destino) {
    console.error('[restaurar] uso: npm run backup:restaurar -- <arquivo.dump> --destino <URL do banco de destino>');
    console.error('[restaurar] o destino é obrigatório: DATABASE_URL/DIRECT_URL nunca são usadas como destino.');
    process.exitCode = 1;
    return;
  }

  const prod = destinoEhProducao(destino);
  const nomeBanco = identidadeDoBanco(destino)?.split('/')[1];
  if (prod.producao && argumento('--sobrescrever-producao') !== nomeBanco) {
    console.error(`[restaurar] RECUSADO: ${prod.motivo}. Restaure num banco isolado.`);
    console.error(`[restaurar] Só para recuperação de desastre, com autorização: --sobrescrever-producao=${nomeBanco ?? '<banco>'}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[restaurar] 1/4 validando o arquivo ${arquivo} (pg_restore --list)...`);
  const indice = await executar('pg_restore', ['--list', arquivo], true);
  const objetos = indice.split('\n').filter((l) => l && !l.startsWith(';')).length;
  if (objetos === 0) throw new Error('o arquivo não contém objetos restauráveis');
  console.log(`[restaurar]     arquivo íntegro: ${objetos} objetos no índice.`);

  const cliente = new PrismaClient({ datasources: { db: { url: destino } } });
  try {
    const [{ tabelas }] = await cliente.$queryRaw<{ tabelas: number }[]>`SELECT count(*)::int AS tabelas FROM pg_tables WHERE schemaname = 'public'`;
    const limpar = process.argv.includes('--limpar');
    if (tabelas > 0 && !limpar) {
      throw new Error(`o destino ${mascarar(destino)} já tem ${tabelas} tabela(s) em public. Use um banco vazio ou passe --limpar.`);
    }

    console.log(`[restaurar] 2/4 restaurando em ${mascarar(destino)}${limpar ? ' (com --clean)' : ''}...`);
    await executar('pg_restore', [...(limpar ? ['--clean', '--if-exists'] : []), '--no-owner', '--no-acl', '-d', destino, arquivo]).catch((err) => {
      // pg_restore devolve código 1 também para avisos (ex.: "schema public already exists").
      // A conferência abaixo decide se a restauração é válida.
      console.warn(`[restaurar]     pg_restore terminou com aviso: ${err.message}`);
    });

    console.log('[restaurar] 3/4 conferindo a integridade...');
    const [estrutura] = await cliente.$queryRaw<{ tabelas: number; fks: number; fks_invalidas: number }[]>`
      SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tabelas,
             (SELECT count(*)::int FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace) AS fks,
             (SELECT count(*)::int FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND NOT convalidated) AS fks_invalidas`;
    const [migracoes] = await cliente.$queryRaw<{ aplicadas: number; pendentes: number }[]>`
      SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS aplicadas,
             count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS pendentes
      FROM "_prisma_migrations"`;
    const linhas = await cliente.$queryRaw<{ tabela: string; linhas: number }[]>`
      SELECT relname AS tabela, n_live_tup::int AS linhas FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY relname`;
    const contagens: Record<string, number> = {};
    for (const t of ['Empresa', 'Usuario', 'Produto', 'Venda', 'Financeiro']) {
      const [{ n }] = await cliente.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t}"`);
      contagens[t] = n;
    }

    const problemas: string[] = [];
    if (estrutura.tabelas === 0) problemas.push('nenhuma tabela restaurada');
    if (estrutura.fks_invalidas > 0) problemas.push(`${estrutura.fks_invalidas} chave(s) estrangeira(s) não validadas`);
    if (migracoes.aplicadas === 0) problemas.push('nenhuma migração do Prisma registrada');
    if (migracoes.pendentes > 0) problemas.push(`${migracoes.pendentes} migração(ões) incompleta(s)`);

    const relatorio = {
      arquivo, destino: mascarar(destino), em: new Date().toISOString(),
      objetosNoArquivo: objetos, ...estrutura, migracoesAplicadas: migracoes.aplicadas, contagens,
      linhasPorTabela: Object.fromEntries(linhas.map((l) => [l.tabela, l.linhas])),
      aprovado: problemas.length === 0, problemas,
    };
    await writeFile(`${arquivo}.restauracao.json`, JSON.stringify(relatorio, null, 2));
    console.log(`[restaurar] 4/4 ${relatorio.aprovado ? 'APROVADO' : 'REPROVADO'}: ${estrutura.tabelas} tabelas, ${estrutura.fks} FKs, ${migracoes.aplicadas} migrações, contagens ${JSON.stringify(contagens)}`);
    if (!relatorio.aprovado) {
      console.error(`[restaurar] problemas: ${problemas.join('; ')}`);
      process.exitCode = 1;
    }
    console.log(`[restaurar] relatório: ${arquivo}.restauracao.json`);
  } finally {
    await cliente.$disconnect();
  }
}

if (process.argv[1]?.includes('restaurar-backup')) {
  main().catch((err) => {
    console.error('[restaurar] falhou:', err.message);
    process.exitCode = 1;
  });
}
