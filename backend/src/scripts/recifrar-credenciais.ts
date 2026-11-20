/**
 * Converte credenciais de integração do formato legado (v1, chave derivada do
 * JWT_SECRET) para o formato v2 (CREDENTIALS_ENCRYPTION_KEY).
 *
 * Uso:
 *   npx tsx src/scripts/recifrar-credenciais.ts            # simulação: só conta
 *   npx tsx src/scripts/recifrar-credenciais.ts --aplicar  # grava
 *
 * Requer JWT_SECRET (para ler v1) e CREDENTIALS_ENCRYPTION_KEY (para gravar v2).
 * É idempotente: valores já em v2 são ignorados. Cada registro é validado
 * (decifrar o valor novo e comparar com o original) antes de ser gravado.
 */
import { prisma } from '../lib/prisma.js';
import { decryptSecret, precisaRecifrar, recifrar } from '../lib/secrets.js';
import { comoSistema } from '../lib/tenant-context.js';

type Alvo = {
  nome: string;
  listar: () => Promise<Array<Record<string, any>>>;
  campos: string[];
  gravar: (id: string, dados: Record<string, string>) => Promise<unknown>;
};

const alvos: Alvo[] = [
  {
    nome: 'IntegracaoExterno',
    campos: ['clientId', 'clientSecret', 'accessToken', 'refreshToken'],
    listar: () => prisma.integracaoExterno.findMany({ select: { id: true, clientId: true, clientSecret: true, accessToken: true, refreshToken: true } }),
    gravar: (id, data) => prisma.integracaoExterno.update({ where: { id }, data }),
  },
  {
    nome: 'ShopeeConexao',
    campos: ['accessToken', 'refreshToken'],
    listar: () => prisma.shopeeConexao.findMany({ select: { id: true, accessToken: true, refreshToken: true } }),
    gravar: (id, data) => prisma.shopeeConexao.update({ where: { id }, data }),
  },
  {
    nome: 'PixSettings',
    campos: ['pixKey'],
    listar: () => prisma.pixSettings.findMany({ select: { id: true, pixKey: true } }),
    gravar: (id, data) => prisma.pixSettings.update({ where: { id }, data }),
  },
  {
    nome: 'IntegracaoPonto',
    campos: ['senhaCriptografada'],
    listar: () => prisma.integracaoPonto.findMany({ select: { id: true, senhaCriptografada: true } }),
    gravar: (id, data) => prisma.integracaoPonto.update({ where: { id }, data }),
  },
];

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    console.error('CREDENTIALS_ENCRYPTION_KEY não configurada: nada a fazer.');
    process.exitCode = 1;
    return;
  }
  let total = 0;
  let falhas = 0;
  for (const alvo of alvos) {
    const linhas = await alvo.listar();
    let pendentes = 0;
    for (const linha of linhas) {
      const dados: Record<string, string> = {};
      for (const campo of alvo.campos) {
        const valor = linha[campo] as string | null;
        if (!precisaRecifrar(valor)) continue;
        try {
          const novo = recifrar(valor!);
          if (decryptSecret(novo) !== decryptSecret(valor!)) throw new Error('verificação falhou');
          dados[campo] = novo;
        } catch (e) {
          falhas++;
          console.error(`[${alvo.nome}] id=${linha.id} campo=${campo}: ${(e as Error).message}`);
        }
      }
      if (Object.keys(dados).length === 0) continue;
      pendentes++;
      if (aplicar) await alvo.gravar(linha.id as string, dados);
    }
    total += pendentes;
    console.log(`${alvo.nome}: ${linhas.length} registros, ${pendentes} ${aplicar ? 'recifrados' : 'a recifrar'}`);
  }
  console.log(`${aplicar ? 'Aplicado' : 'Simulação'}: ${total} registros; ${falhas} falhas.`);
  if (falhas > 0) process.exitCode = 1;
}

comoSistema('recifrar-credenciais', main)
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
