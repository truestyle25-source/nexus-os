import Fastify from 'fastify';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import dotenv from 'dotenv';
import { Prisma } from '@prisma/client';
import { authRoutes } from './modules/auth/auth.routes.js';
import { empresaRoutes } from './modules/empresa/empresa.routes.js';
import { usuariosRoutes } from './modules/usuarios/usuarios.routes.js';
import { produtosRoutes } from './modules/produtos/produtos.routes.js';
import { estoqueRoutes } from './modules/estoque/estoque.routes.js';
import { comprasRoutes } from './modules/compras/compras.routes.js';
import { vendasRoutes } from './modules/vendas/vendas.routes.js';
import { pdvRoutes } from './modules/pdv/pdv.routes.js';
import { gestaoRoutes } from './modules/gestao/gestao.routes.js';
import { rhRoutes } from './modules/rh/rh.routes.js';
import { iaRoutes } from './modules/ia/ia.routes.js';
import { importacaoRoutes } from './modules/importacao/importacao.routes.js';
import { assinaturaRoutes } from './modules/assinatura/assinatura.routes.js';
import { registerAuthentication } from './middlewares/auth.js';
import { prisma } from './lib/prisma.js';
import { ErroDeNegocio } from './lib/erros.js';

dotenv.config();

const app = Fastify({ logger: true });

const allowedOrigins = (process.env.FRONTEND_URLS || '')
  .split(',')
  .map((v: string) => v.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET || '';

if (isProduction && (!jwtSecret || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres em produção.');
}
if (isProduction && allowedOrigins.length === 0) {
  throw new Error('FRONTEND_URLS deve ser configurado em produção.');
}

await app.register(cors, {
  origin: allowedOrigins.length ? allowedOrigins : isProduction ? false : true,
  credentials: true,
});
await app.register(cookie);
await app.register(jwt, { secret: jwtSecret || 'local-development-secret-change-me-32chars' });

registerAuthentication(app);

/**
 * Tratamento de erros centralizado (Seção 45). Ordem importa:
 *  1. Zod (validação de entrada) -> 400 com os issues detalhados.
 *  2. ErroDeNegocio -> usa o status explícito que a rota escolheu.
 *  3. Erros conhecidos do Prisma (unicidade, registro não encontrado) ->
 *     status apropriado sem vazar detalhes internos do banco.
 *  4. `new Error('mensagem')` lançado deliberadamente dentro de uma rota
 *     (convenção usada em todos os módulos deste projeto) -> 400 com a
 *     própria mensagem, porque foi escrita para o usuário final.
 *  5. Qualquer outra coisa (bug real, exceção não prevista) -> 500 genérico;
 *     o detalhe completo vai só para o log do servidor, nunca na resposta.
 */
app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
  request.log.error(error);

  if (error.name === 'ZodError') {
    const zodError = error as unknown as { issues: unknown };
    return reply.status(400).send({ error: 'Dados inválidos.', detalhes: zodError.issues });
  }

  if (error instanceof ErroDeNegocio) {
    return reply.status(error.status).send({ error: error.message });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return reply.status(409).send({ error: 'Registro duplicado.' });
    if (error.code === 'P2025') return reply.status(404).send({ error: 'Registro não encontrado.' });
  }

  if (error.constructor === Error) {
    return reply.status(400).send({ error: error.message });
  }

  return reply.status(500).send({ error: 'Erro interno do servidor.' });
});

app.get('/health', async () => ({ status: 'ok', service: 'NEXUS OS' }));

await app.register(authRoutes);
await app.register(empresaRoutes);
await app.register(usuariosRoutes);
await app.register(produtosRoutes);
await app.register(estoqueRoutes);
await app.register(comprasRoutes);
await app.register(vendasRoutes);
await app.register(pdvRoutes);
await app.register(gestaoRoutes);
await app.register(rhRoutes);
await app.register(iaRoutes);
await app.register(importacaoRoutes);
await app.register(assinaturaRoutes);

const port = Number(process.env.PORT || 3333);
await app.listen({ port, host: '0.0.0.0' });

async function encerrarComCuidado(sinal: string): Promise<void> {
  app.log.info(`${sinal} recebido, encerrando NEXUS OS...`);
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void encerrarComCuidado('SIGTERM'));
process.on('SIGINT', () => void encerrarComCuidado('SIGINT'));
