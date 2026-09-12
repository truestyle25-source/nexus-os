import { prisma } from './lib/prisma.js';

// O NEXUS OS não cria empresa, usuário ou números fictícios em produção.
// O primeiro acesso deve usar POST /auth/register-company.
async function main() {
  console.log('Seed sem dados fictícios: use /auth/register-company para criar a primeira empresa.');
}
main().finally(() => prisma.$disconnect());
