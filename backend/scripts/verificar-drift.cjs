#!/usr/bin/env node
/**
 * Drift entre o banco migrado e o schema.prisma, tolerando SÓ o que o Prisma não sabe
 * representar no schema:
 *  - "AITrecho_embedding_idx": índice HNSW (pgvector) criado na migração
 *    202611290000_nexus_ai_pgvector. O Prisma não tem tipo de índice HNSW e sempre proporia
 *    apagá-lo.
 * Qualquer outra diferença (tabela, coluna, índice, enum) faz o comando falhar.
 * Uso: node scripts/verificar-drift.cjs   (lê DATABASE_URL)
 */
const { execFileSync } = require('node:child_process');

const TOLERADOS = [/^DROP INDEX "AITrecho_embedding_idx";$/];

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL não definido.'); process.exit(2); }
const prisma = require.resolve('prisma/build/index.js', { paths: [process.cwd()] });
const script = execFileSync(process.execPath, [prisma, 'migrate', 'diff', '--from-url', url, '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], { encoding: 'utf8' });

const comandos = script.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('--') && l !== '-- This is an empty migration.');
const restantes = comandos.filter((l) => !TOLERADOS.some((r) => r.test(l)));
if (restantes.length) {
  console.error('Schema e migrações fora de sincronia. Diferenças:\n' + restantes.join('\n'));
  process.exit(1);
}
console.log(`Schema e migrações em sincronia (${comandos.length - restantes.length} diferença(s) tolerada(s): índice vetorial).`);
