import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

type Tx = Prisma.TransactionClient;

/**
 * Catálogo padrão de unidades e tipos de produto (idempotente).
 *
 * Diagnóstico de 2026-11-21: o schema tinha Dimensao/Unidade/TipoProduto, mas
 * NENHUMA rota os criava — na produção havia 0 unidades e 0 tipos, então unidade
 * de compra/venda/tributável e conversões (caixa → unidade) eram impossíveis.
 *
 * Os fatores são FACTUAIS (1 g = 0,001 kg; 1 dz = 12 UN). Embalagens (CX, PCT, FD,
 * SC) ficam numa dimensão própria com fator 1: quantas unidades cabem numa caixa
 * varia por produto e é cadastrado em FatorConversao (ver conversao.service.ts).
 * Nada é sobrescrito: só cria o que falta (skipDuplicates).
 */
const DIMENSOES = [
  { codigo: 'CONTAGEM', nome: 'Contagem' },
  { codigo: 'MASSA', nome: 'Massa' },
  { codigo: 'VOLUME', nome: 'Volume' },
  { codigo: 'COMPRIMENTO', nome: 'Comprimento' },
  { codigo: 'AREA', nome: 'Área' },
  { codigo: 'EMBALAGEM', nome: 'Embalagem' },
] as const;

const UNIDADES: Array<{ dimensao: (typeof DIMENSOES)[number]['codigo']; simbolo: string; nome: string; fator: string }> = [
  { dimensao: 'CONTAGEM', simbolo: 'UN', nome: 'Unidade', fator: '1' },
  { dimensao: 'CONTAGEM', simbolo: 'PAR', nome: 'Par', fator: '2' },
  { dimensao: 'CONTAGEM', simbolo: 'DZ', nome: 'Dúzia', fator: '12' },
  { dimensao: 'CONTAGEM', simbolo: 'CENTO', nome: 'Cento', fator: '100' },
  { dimensao: 'MASSA', simbolo: 'kg', nome: 'Quilograma', fator: '1' },
  { dimensao: 'MASSA', simbolo: 'g', nome: 'Grama', fator: '0.001' },
  { dimensao: 'MASSA', simbolo: 'mg', nome: 'Miligrama', fator: '0.000001' },
  { dimensao: 'MASSA', simbolo: 't', nome: 'Tonelada', fator: '1000' },
  { dimensao: 'VOLUME', simbolo: 'L', nome: 'Litro', fator: '1' },
  { dimensao: 'VOLUME', simbolo: 'mL', nome: 'Mililitro', fator: '0.001' },
  { dimensao: 'VOLUME', simbolo: 'm3', nome: 'Metro cúbico', fator: '1000' },
  { dimensao: 'COMPRIMENTO', simbolo: 'm', nome: 'Metro', fator: '1' },
  { dimensao: 'COMPRIMENTO', simbolo: 'cm', nome: 'Centímetro', fator: '0.01' },
  { dimensao: 'COMPRIMENTO', simbolo: 'mm', nome: 'Milímetro', fator: '0.001' },
  { dimensao: 'AREA', simbolo: 'm2', nome: 'Metro quadrado', fator: '1' },
  { dimensao: 'EMBALAGEM', simbolo: 'CX', nome: 'Caixa', fator: '1' },
  { dimensao: 'EMBALAGEM', simbolo: 'PCT', nome: 'Pacote', fator: '1' },
  { dimensao: 'EMBALAGEM', simbolo: 'FD', nome: 'Fardo', fator: '1' },
  { dimensao: 'EMBALAGEM', simbolo: 'SC', nome: 'Saco', fator: '1' },
  { dimensao: 'EMBALAGEM', simbolo: 'GL', nome: 'Galão', fator: '1' },
];

const TIPOS: Array<{ codigo: 'MERCADORIA' | 'INSUMO' | 'FABRICADO' | 'USO_INTERNO' | 'MATERIA_PRIMA' | 'PRODUTO_ACABADO' | 'SERVICO' | 'KIT' | 'FABRICA' | 'NAO_CLASSIFICADO'; nome: string; descricao: string }> = [
  { codigo: 'MERCADORIA', nome: 'Mercadoria para revenda', descricao: 'Comprado pronto e revendido.' },
  { codigo: 'MATERIA_PRIMA', nome: 'Matéria-prima', descricao: 'Transformado na fabricação.' },
  { codigo: 'INSUMO', nome: 'Insumo', descricao: 'Consumido na produção ou na operação.' },
  { codigo: 'FABRICADO', nome: 'Fabricação própria', descricao: 'Produzido pela empresa a partir de ficha técnica.' },
  { codigo: 'PRODUTO_ACABADO', nome: 'Produto acabado', descricao: 'Pronto para venda, resultado da produção.' },
  { codigo: 'USO_INTERNO', nome: 'Material de uso interno', descricao: 'Consumo próprio, não vendido.' },
  { codigo: 'SERVICO', nome: 'Serviço', descricao: 'Sem controle de estoque.' },
  { codigo: 'KIT', nome: 'Kit', descricao: 'Vendido como um produto; a venda baixa os componentes da composição.' },
  { codigo: 'FABRICA', nome: 'Fábrica', descricao: 'Produto ligado à operação de fábrica.' },
  { codigo: 'NAO_CLASSIFICADO', nome: 'Não classificado', descricao: 'Ainda sem classificação definida.' },
];

export async function garantirCatalogoPadrao(empresaId: string, tx: Tx | typeof prisma = prisma): Promise<void> {
  await tx.dimensao.createMany({ data: DIMENSOES.map((d) => ({ empresaId, codigo: d.codigo, nome: d.nome })), skipDuplicates: true });
  const dimensoes = await tx.dimensao.findMany({ where: { empresaId }, select: { id: true, codigo: true } });
  const idDe = new Map(dimensoes.map((d) => [d.codigo, d.id]));
  await tx.unidade.createMany({
    data: UNIDADES.filter((u) => idDe.has(u.dimensao)).map((u) => ({ empresaId, dimensaoId: idDe.get(u.dimensao)!, simbolo: u.simbolo, nome: u.nome, fatorCanonico: u.fator })),
    skipDuplicates: true,
  });
  await tx.tipoProduto.createMany({ data: TIPOS.map((t) => ({ empresaId, codigo: t.codigo, nome: t.nome, descricao: t.descricao })), skipDuplicates: true });
}
