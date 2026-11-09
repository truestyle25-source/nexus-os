import { prisma } from './node_modules/@prisma/client/index.js';

async function main() {
  const u = await prisma.usuario.findFirst({ include: { empresa: true } });
  console.log('Usuario:', u);
}

main().catch(console.error);