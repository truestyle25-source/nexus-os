import api from '@/lib/api';
import { db } from './db';
import { sincronizarCatalogo } from './catalogo';
import type { ContextoLocal, ProdutoLocal } from './tipos';

const TAKE = 500;

/** Downloads only the minimum product fields and branch stock for this tenant. */
export async function atualizarCatalogoLocal(contexto: ContextoLocal, filialId: string): Promise<number> {
  const database = db();
  const chave = `catalogo:${contexto.empresaId}:${contexto.usuarioId}:${filialId}`;
  const marcador = await database.meta.get(chave);
  // One-second overlap protects updates that share the same timestamp boundary.
  const desdeMs = marcador ? Math.max(0, Number(marcador.valor) - 1000) : null;
  let skip = 0;
  let recebidos = 0;
  let capturadoEm = Date.now();

  while (true) {
    const { data } = await api.get('/pdv/catalogo', {
      params: {
        filialId,
        take: TAKE,
        skip,
        ...(desdeMs === null ? {} : { desde: new Date(desdeMs).toISOString() }),
      },
    });
    const produtos = (data.produtos ?? []).map((produto: any): Omit<ProdutoLocal, 'idLocal'> => ({
      id: produto.id,
      empresaId: produto.empresaId,
      filialId: produto.filialId,
      nome: produto.nome,
      sku: produto.sku ?? null,
      codigoBarras: produto.codigoBarras ?? null,
      precoVenda: Number(produto.precoVenda),
      precoPromocional: produto.precoPromocional == null ? null : Number(produto.precoPromocional),
      promocaoInicio: produto.promocaoInicio ?? null,
      promocaoFim: produto.promocaoFim ?? null,
      categoriaId: produto.categoriaId ?? null,
      unidade: produto.unidade,
      imagem: produto.imagem ?? null,
      ativo: Boolean(produto.ativo),
      estoqueFilial: Number(produto.estoqueFilial ?? 0),
      atualizadoEm: Date.parse(produto.atualizadoEm),
    }));
    await sincronizarCatalogo(contexto, filialId, produtos);
    recebidos += produtos.length;
    capturadoEm = Date.parse(data.capturadoEm) || capturadoEm;
    if (produtos.length < TAKE) break;
    skip += produtos.length;
  }

  await database.meta.put({ chave, valor: String(capturadoEm), atualizadoEm: Date.now() });
  return recebidos;
}

export async function listarCatalogoLocal(contexto: ContextoLocal, filialId: string): Promise<ProdutoLocal[]> {
  return db().catalogoProdutos.where('[empresaId+filialId]').equals([contexto.empresaId, filialId]).toArray();
}
