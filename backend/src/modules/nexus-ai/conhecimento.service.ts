/**
 * Memória empresarial e base documental da NEXUS AI (Fase 04).
 *
 * - Memória: itens curtos e autorizados (metas, políticas, critérios, decisões), por empresa,
 *   editáveis e excluíveis. Texto com cara de instrução para a IA é RECUSADO na gravação.
 * - Documentos: texto (manual, procedimento, política) dividido em trechos de ~900 caracteres;
 *   busca com a pesquisa de texto do PostgreSQL em português (sem extensão nem serviço externo).
 *   `modulo` opcional restringe a leitura a quem tem <modulo>.visualizar.
 * Tudo filtrado pela empresa da sessão (e pelo RLS).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { MODULOS, type Modulo } from '../../lib/permissoes-catalogo.js';
import { temPermissao } from '../../lib/permissoes.js';
import { pareceInjecao } from './seguranca.js';

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
  return prisma.$transaction(async (tx) => {
    const doc = await tx.aIDocumento.create({ data: { empresaId, titulo: d.titulo.trim().slice(0, 200), modulo: d.modulo ?? null, caracteres: conteudo.length, criadoPor: usuarioId } });
    await tx.aITrecho.createMany({ data: trechos.map((texto, ordem) => ({ empresaId, documentoId: doc.id, ordem, texto })) });
    return { ...doc, trechos: trechos.length };
  });
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

/** Busca de texto em português, filtrada pela empresa e pela permissão de módulo do usuário. */
export async function buscarTrechos(empresaId: string, usuarioId: string | null, consulta: string, limite = 5) {
  const linhas = await prisma.$queryRaw<{ id: string; texto: string; titulo: string; modulo: string | null; rank: number }[]>(Prisma.sql`
    SELECT t.id, t.texto, d.titulo, d.modulo, ts_rank(to_tsvector('portuguese', t.texto), plainto_tsquery('portuguese', ${consulta}))::float AS rank
    FROM "AITrecho" t JOIN "AIDocumento" d ON d.id = t."documentoId"
    WHERE t."empresaId" = ${empresaId} AND d."empresaId" = ${empresaId}
      AND to_tsvector('portuguese', t.texto) @@ plainto_tsquery('portuguese', ${consulta})
    ORDER BY rank DESC LIMIT 30`);
  const permitidos: typeof linhas = [];
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
