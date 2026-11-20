// Mantido só por compatibilidade: reexporta o cliente ÚNICO da aplicação.
// Antes este arquivo criava um segundo PrismaClient, que não enviaria o
// contexto da empresa (RLS). Nunca crie outro PrismaClient no backend.
import { prisma } from '../lib/prisma.js';
export { prisma };
export default prisma;
