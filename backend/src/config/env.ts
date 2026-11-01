export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  corsOrigin: string;
  nodeEnv: 'development' | 'production' | 'test';
}

/**
 * Lê e valida as variáveis de ambiente necessárias.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const required = ['DATABASE_URL', 'JWT_SECRET'] as const;
  const missing = required.filter((key) =>!env[key]);
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
  }

  return {
    databaseUrl: env.DATABASE_URL!,
    jwtSecret: env.JWT_SECRET!,
    corsOrigin: env.CORS_ORIGIN || 'http://localhost:5173',
    nodeEnv: (env.NODE_ENV as AppConfig['nodeEnv']) || 'development',
  };
}