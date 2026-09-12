/**
 * Gera o snapshot diário de estoque (Seção 9 — base do giro real) para
 * TODAS as empresas ativas. Pensado para rodar uma vez por dia via cron
 * externo (`npm run estoque:snapshot`). Este projeto não tem um scheduler
 * embutido — sem um cron real apontando para isto (ou para
 * POST /estoque/snapshot/gerar), o giro de estoque continua no fallback
 * aproximado indefinidamente (ver DEBITO-TECNICO.md item 8).
 */
import { prisma } from '../lib/prisma.js';
import { gerarSnapshotDoDia } from '../modules/estoque/estoque-indicadores.service.js';

async function main(): Promise<void> {
  const empresas = await prisma.empresa.findMany({ where: { status: 'ATIVO' }, select: { id: true, nome: true } });
  let total = 0;
  for (const empresa of empresas) {
    const { processados } = await gerarSnapshotDoDia(empresa.id);
    total += processados;
    console.log(`[snapshot] ${empresa.nome} (${empresa.id}): ${processados} linhas de estoque capturadas.`);
  }
  console.log(`[snapshot] concluído: ${empresas.length} empresas, ${total} linhas no total.`);
}

main()
  .catch((err) => {
    console.error('[snapshot] falhou:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
