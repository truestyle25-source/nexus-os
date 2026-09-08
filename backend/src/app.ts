import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Pool } from 'pg';
import type { AppConfig } from './config/env.js';
import { PostgresCompanyRepository, PostgresRoleRepository, PostgresUserRepository, PostgresAuditRepository, PostgresSessionRepository } from './repositories/postgres/index.js';
import { AuthService } from './services/authService.js';
import { buildAuthRoutes } from './routes/auth.js';
import { buildMeRoutes } from './routes/me.js';

export function buildApp(config: AppConfig) {
  const pool = new Pool({ connectionString: config.databaseUrl });

  const companies = new PostgresCompanyRepository(pool);
  const roles = new PostgresRoleRepository(pool);
  const users = new PostgresUserRepository(pool);
  const sessions = new PostgresSessionRepository(pool);
  const audit = new PostgresAuditRepository(pool);

  const authService = new AuthService(companies, roles, users, audit, config.jwtSecret, pool, sessions);

  const app = express();
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', env: config.nodeEnv }));
  app.use('/api/auth', buildAuthRoutes(authService));
  app.use('/api/me', buildMeRoutes(config.jwtSecret, users, roles));

  // handler de erro genérico — nunca vaza detalhes internos ao cliente
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[unhandled]', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  });

  return { app, pool };
}
