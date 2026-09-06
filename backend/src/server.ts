import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import router from './routes';

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_, res) => res.json({ ok: true, version: '1.0.0', status: 'NEXUS-OS Backend Online' }));
app.get('/', (_, res) => res.json({ status: 'NEXUS-OS Backend Online' }));

app.use('/api', router);
app.use('/rh', router);
app.use('/pdv', router);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 NEXUS API rodando na porta ${PORT}`);
});
