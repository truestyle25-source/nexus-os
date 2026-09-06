
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.cargo.upsert({
    where: { nome: 'Vendedor' },
    update: {},
    create: { nome: 'Vendedor', salarioBase: 1800 }
  });
  await prisma.cargo.upsert({
    where: { nome: 'Gerente' },
    update: {},
    create: { nome: 'Gerente', salarioBase: 3500 }
  });
  console.log('Seed RH/PDV OK');
}

main().finally(() => prisma.$disconnect());
