import 'dotenv/config';
import { loadConfig } from './config/env.js';
import { buildApp } from './app.js';

const config = loadConfig();
const { app, pool } = buildApp(config);

const server = app.listen(config.port, () => {
  console.log(`NEXUS OS backend rodando na porta ${config.port} [${config.nodeEnv}]`);
});

async function shutdown(signal: string) {
  console.log(`Recebido ${signal}, encerrando graciosamente...`);
  server.close(async () => {
    await pool?.end();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
