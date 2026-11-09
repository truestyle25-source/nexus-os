import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  await p.$connect();
  
  try {
    // Try to create the PoliticaCusto enum type
    await p.$executeRaw`CREATE TYPE "PoliticaCusto" AS ENUM ('ULTIMO_CUSTO', 'MEDIO_PONDERADO', 'PADRAO')`;
    console.log('✓ Enum "PoliticaCusto" created successfully');
  } catch (error) {
    console.log('Enum might already exist or error:', error.message);
  }
  
  // Verify the enum was created
  try {
    const result = await p.$queryRaw`SELECT enum_range(NULL::"PoliticaCusto") as values`;
    console.log('✓ Enum values:', result);
  } catch (error) {
    console.log('✗ Failed to query enum:', error.message);
  }
}

main().finally(() => p.$disconnect());