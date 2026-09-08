export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigin: string;
  nodeEnv: 'development' | 'production' | 'test';
}

/**
 * Lê e valida as variáveis de ambiente necessárias.
 * Lança erro imediatamente na inicialização se algo crítico faltar —
 * é preferível o servidor não subir a subir com JWT_SECRET vazio, por exemplo.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const required = ['DATABASE_URL', 'JWT_SECRET'] as const;
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(', ')}. Confira o arquivo .env (veja .env.example).`);
  }

  if ((env.JWT_SECRET as string).length < 32) {
    throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres. Gere um com: openssl rand -hex 32');
  }

  return {
    port: Number(env.PORT ?? 3333),
    databaseUrl: env.DATABASE_URL as string,
    jwtSecret: env.JWT_SECRET as string,
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:3000',
    nodeEnv: (env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
  };
}
