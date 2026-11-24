/**
 * Memória empresarial e base documental da NEXUS AI (Fase 04).
 *
 * - Memória: itens curtos e autorizados (metas, políticas, critérios, decisões), por empresa,
 *   editáveis e excluíveis. Texto com cara de instrução para a IA é RECUSADO na gravação.
 * - Documentos: texto (manual, procedimento, política) dividido em trechos de ~900 caracteres;
 *   busca HÍBRIDA: pesquisa de texto do PostgreSQL em português + busca por sentido (pgvector,
 *   embeddings do Gemini). Sem vetor (provedor fora do ar), a busca de texto continua funcionando.
 *   `modulo` opcional restringe a leitura a quem tem <modulo>.visualizar.
 * Tudo filtrado pela empresa da sessão (e pelo RLS).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { MODULOS, type Modulo } from '../../lib/permissoes-catalogo.js';
import { temPermissao } from '../../lib/permissoes.js';
import { pareceInjecao } from './seguranca.js';
import { gerarEmbeddings, literalVetor } from './provedores/embeddings.js';

export const TIPOS_MEMORIA = ['META', 'POLITICA', 'CRITERIO', 'PREFERENCIA', 'DECISAO'] as const;

function recusarInjecao(...textos: string[]) {
  if (textos.some((t) => pareceInjecao(t))) throw new ErroDeNegocio('O texto contém instruções direcionadas à IA (ex.: "ignore as instruções"). Escreva apenas a informação da empresa.', 400);
}

export async function listarMemoria(empresaId: string, termo?: string) {
  return prisma.aIMemoria.findMany({
    where: { empresaId, ativa: true, ...(termo ? { OR: [{ titulo: { contains: termo, mode: 'insensitive' } }, { conteudo: { contains: termo, mode: 'insensitive' } }] } : {}) },
    orderBy: [{ tipo: 'asc' }, { updatedAt: 'desc' }], take: 50, select: { id: true, tipo: true, titulo: true, conteudo: true, updatedAt: true },
  });
}

export async function salvarMemoria(empresaId: string, usuarioId: string, d: { id?: string; tipo: string; titulo: string; conteudo: string }) {
  if (!TIPOS_MEMORIA.includes(d.tipo as never)) throw new ErroDeNegocio('Tipo de memória inválido.', 400);
  recusarInjecao(d.titulo, d.conteudo);
  if (d.id) {
    const r = await prisma.aIMemoria.updateMany({ where: { id: d.id, empresaId }, data: { tipo: d.tipo, titulo: d.titulo, conteudo: d.conteudo } });
    if (!r.count) throw NaoEncontrado('Memória não encontrada.');
    return prisma.aIMemoria.findUniqueOrThrow({ where: { id: d.id } });
  }
  return prisma.aIMemoria.create({ data: { empresaId, tipo: d.tipo, titulo: d.titulo, conteudo: d.conteudo, criadoPor: usuarioId } });
}

export async function excluirMemoria(empresaId: string, id: string) {
  const r = await prisma.aIMemoria.deleteMany({ where: { id, empresaId } });
  if (!r.count) throw NaoEncontrado('Memória não encontrada.');
  return { ok: true };
}

/** Divide em trechos por parágrafo, até ~900 caracteres cada. Exportada para os testes. */
export function dividirEmTrechos(texto: string, tamanho = 900): string[] {
  const paragrafos = texto.replace(/\r/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const trechos: string[] = [];
  let atual = '';
  for (const p of paragrafos) {
    if ((atual + '\n\n' + p).length > tamanho && atual) { trechos.push(atual); atual = ''; }
    if (p.length > tamanho) { for (let i = 0; i < p.length; i += tamanho) trechos.push(p.slice(i, i + tamanho)); continue; }
    atual = atual ? `${atual}\n\n${p}` : p;
  }
  if (atual) trechos.push(atual);
  return trechos;
}

export async function adicionarDocumento(empresaId: string, usuarioId: string, d: { titulo: string; conteudo: string; modulo?: string | null }) {
  const conteudo = d.conteudo.trim();
  if (conteudo.length < 20 || conteudo.length > 500_000) throw new ErroDeNegocio('O documento precisa ter entre 20 e 500.000 caracteres de texto.', 400);
  if (d.modulo && !MODULOS.includes(d.modulo as Modulo)) throw new ErroDeNegocio('Módulo inválido.', 400);
  const trechos = dividirEmTrechos(conteudo);
  const doc = await prisma.$transaction(async (tx) => {
    const novo = await tx.aIDocumento.create({ data: { empresaId, titulo: d.titulo.trim().slice(0, 200), modulo: d.modulo ?? null, caracteres: conteudo.length, criadoPor: usuarioId } });
    await tx.aITrecho.createMany({ data: trechos.map((texto, ordem) => ({ empresaId, documentoId: novo.id, ordem, texto })) });
    return novo;
  });
  const vetorizados = await indexarDocumento(empresaId, doc.id);
  return { ...doc, trechos: trechos.length, vetorizados };
}

/** Gera os vetores dos trechos ainda sem vetor. Melhor esforço: falha do provedor só adia. */
export async function indexarDocumento(empresaId: string, documentoId?: string) {
  const pend = await prisma.$queryRaw<{ id: string; texto: string }[]>(Prisma.sql`
    SELECT id, texto FROM "AITrecho" WHERE "empresaId" = ${empresaId} AND embedding IS NULL
    ${documentoId ? Prisma.sql`AND "documentoId" = ${documentoId}` : Prisma.empty} ORDER BY ordem LIMIT 500`);
  if (!pend.length) return 0;
  const vetores = await gerarEmbeddings(pend.map((p) => p.texto), 'RETRIEVAL_DOCUMENT');
  if (!vetores) return 0;
  for (let i = 0; i < pend.length; i++) {
    await prisma.$executeRaw`UPDATE "AITrecho" SET embedding = ${literalVetor(vetores[i])}::vector WHERE id = ${pend[i].id} AND "empresaId" = ${empresaId}`;
  }
  return pend.length;
}

export async function listarDocumentos(empresaId: string) {
  const docs = await prisma.aIDocumento.findMany({ where: { empresaId }, orderBy: { createdAt: 'desc' }, select: { id: true, titulo: true, modulo: true, caracteres: true, createdAt: true, _count: { select: { trechos: true } } } });
  return docs.map(({ _count, ...d }) => ({ ...d, trechos: _count.trechos }));
}

export async function excluirDocumento(empresaId: string, id: string) {
  const r = await prisma.aIDocumento.deleteMany({ where: { id, empresaId } });
  if (!r.count) throw NaoEncontrado('Documento não encontrado.');
  return { ok: true };
}

/**
 * Busca híbrida, filtrada pela empresa e pela permissão de módulo do usuário:
 * texto (português) + sentido (pgvector), combinadas por fusão de posições (RRF).
 */
export async function buscarTrechos(empresaId: string, usuarioId: string | null, consulta: string, limite = 5) {
  type Linha = { id: string; texto: string; titulo: string; modulo: string | null };
  const porTexto = await prisma.$queryRaw<Linha[]>(Prisma.sql`
    SELECT t.id, t.texto, d.titulo, d.modulo
    FROM "AITrecho" t JOIN "AIDocumento" d ON d.id = t."documentoId"
    WHERE t."empresaId" = ${empresaId} AND d."empresaId" = ${empresaId}
      AND to_tsvector('portuguese', t.texto) @@ plainto_tsquery('portuguese', ${consulta})
    ORDER BY ts_rank(to_tsvector('portuguese', t.texto), plainto_tsquery('portuguese', ${consulta})) DESC LIMIT 30`);
  let porSentido: Linha[] = [];
  const [v] = (await gerarEmbeddings([consulta], 'RETRIEVAL_QUERY')) ?? [];
  if (v) {
    porSentido = await prisma.$queryRaw<Linha[]>(Prisma.sql`
      SELECT t.id, t.texto, d.titulo, d.modulo
      FROM "AITrecho" t JOIN "AIDocumento" d ON d.id = t."documentoId"
      WHERE t."empresaId" = ${empresaId} AND d."empresaId" = ${empresaId} AND t.embedding IS NOT NULL
        AND (t.embedding <=> ${literalVetor(v)}::vector) < ${LIMIAR_DISTANCIA}
      ORDER BY t.embedding <=> ${literalVetor(v)}::vector LIMIT 30`);
  }
  const pontos = new Map<string, { l: Linha; p: number }>();
  for (const lista of [porTexto, porSentido]) lista.forEach((l, i) => { const a = pontos.get(l.id); pontos.set(l.id, { l, p: (a?.p ?? 0) + 1 / (60 + i) }); });
  const linhas = [...pontos.values()].sort((a, b) => b.p - a.p).map((x) => x.l);
  const permitidos: Linha[] = [];
  const cache = new Map<string, boolean>();
  for (const l of linhas) {
    if (l.modulo) {
      if (!usuarioId) continue;
      if (!cache.has(l.modulo)) cache.set(l.modulo, await temPermissao(usuarioId, l.modulo as Modulo, 'visualizar'));
      if (!cache.get(l.modulo)) continue;
    }
    permitidos.push(l);
    if (permitidos.length >= limite) break;
  }
  return permitidos.map((l) => ({ documento: l.titulo, trecho: l.texto }));
}

/** Distância de cosseno máxima para um trecho contar como "do mesmo assunto" (0 = idêntico, 2 = oposto). */
const LIMIAR_DISTANCIA = Number(process.env.NEXUS_AI_LIMIAR_SEMANTICO ?? 0.45);
