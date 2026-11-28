/**
 * Publica uma NOVA versão de um termo da plataforma NEXUS CLUB (Termos de Uso ou Política
 * de Privacidade). O texto vem de um arquivo escrito/revisado pelo responsável jurídico;
 * o sistema nunca inventa texto. Versões anteriores ficam guardadas (o aceite de cada pessoa
 * aponta para a versão exata que ela aceitou); publicar versão nova pede novo aceite.
 *
 * Uso (com DATABASE_URL apontando para o banco certo):
 *   npm run club:publicar-termo -- TERMOS_USO caminho/termos-de-uso.md
 *   npm run club:publicar-termo -- POLITICA_PRIVACIDADE caminho/politica.md
 * Acrescente --confirmar para gravar; sem ele, só mostra o que seria publicado.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '../lib/prisma.js';
import { comoSistema } from '../lib/tenant-context.js';

const TIPOS = ['TERMOS_USO', 'POLITICA_PRIVACIDADE'] as const;

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--confirmar');
  const confirmar = process.argv.includes('--confirmar');
  const [tipo, arquivo] = args;
  if (!TIPOS.includes(tipo as (typeof TIPOS)[number]) || !arquivo) {
    console.error(`Uso: npm run club:publicar-termo -- <${TIPOS.join('|')}> <arquivo> [--confirmar]`);
    process.exit(2);
  }
  const texto = readFileSync(arquivo, 'utf8').trim();
  if (texto.length < 200) {
    console.error('Texto muito curto (menos de 200 caracteres): confira o arquivo.');
    process.exit(2);
  }
  // Minuta não vai ao ar: campos a preencher ([RAZÃO SOCIAL], [CNPJ]...) ou a marca MINUTA bloqueiam.
  const pendentes = [...new Set(texto.match(/\[[A-ZÀ-Ú0-9][^\]\n]{1,80}\]/g) ?? [])];
  if (pendentes.length || /\bMINUTA\b/i.test(texto)) {
    console.error('Texto NÃO publicado: ainda é minuta.');
    if (pendentes.length) console.error(`Campos a preencher (${pendentes.length}): ${pendentes.slice(0, 12).join(', ')}${pendentes.length > 12 ? ', …' : ''}`);
    if (/\bMINUTA\b/i.test(texto)) console.error('Remova a marca "MINUTA" depois da revisão jurídica.');
    process.exit(2);
  }
  await comoSistema('club:publicar-termo', async () => {
    const atual = await prisma.termoVersao.findFirst({ where: { tipo: tipo as (typeof TIPOS)[number], empresaId: null }, orderBy: { versao: 'desc' }, select: { versao: true, texto: true } });
    if (atual?.texto.trim() === texto) {
      console.log(`Nada a fazer: o texto é igual à versão ${atual.versao} já publicada.`);
      return;
    }
    const versao = (atual?.versao ?? 0) + 1;
    console.log(`${tipo}: versão atual ${atual?.versao ?? '(nenhuma)'} → nova versão ${versao} (${texto.length} caracteres).`);
    if (!confirmar) {
      console.log('Simulação: nada foi gravado. Rode de novo com --confirmar para publicar.');
      return;
    }
    await prisma.termoVersao.create({ data: { tipo: tipo as (typeof TIPOS)[number], versao, texto, empresaId: null } });
    console.log(`Publicado: ${tipo} versão ${versao}.`);
  });
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
