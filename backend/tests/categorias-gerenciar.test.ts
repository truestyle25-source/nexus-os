/**
 * TESTE — Gerenciar classificação (grupos e subgrupos de produto): árvore com contagens,
 * renomear e excluir só quando vazio, permissão de editar produtos e isolamento por empresa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);

test('Gerenciar classificação: renomear e excluir grupos e subgrupos', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test', timeout: 300_000 }, async (t) => {
  const { app } = await import('../src/server.js');
  await app.ready();
  const empresa = await prisma.empresa.create({ data: { nome: `Classif ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const outra = await prisma.empresa.create({ data: { nome: `Classif Outra ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const M = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
  const editor = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: M.id, nome: 'Editor', email: `editor-cat-${SUF}@teste.local`, senhaHash: 'x' } });
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: editor.id, modulo: m, acao: a, permitido: true }))) });
  const leitor = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: M.id, nome: 'Leitor', email: `leitor-cat-${SUF}@teste.local`, senhaHash: 'x' } });
  await prisma.permissao.createMany({ data: [{ usuarioId: leitor.id, modulo: 'produtos', acao: 'visualizar', permitido: true }] });
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });

  const padaria = await prisma.categoria.create({ data: { empresaId: empresa.id, nome: 'padaria', nivel: 0 } });
  const paes = await prisma.categoria.create({ data: { empresaId: empresa.id, nome: 'Pães', nivel: 1, categoriaPaiId: padaria.id } });
  const doces = await prisma.categoria.create({ data: { empresaId: empresa.id, nome: 'Doces', nivel: 1, categoriaPaiId: padaria.id } });
  const bebidas = await prisma.categoria.create({ data: { empresaId: empresa.id, nome: 'Bebidas', nivel: 0 } });
  const alheia = await prisma.categoria.create({ data: { empresaId: outra.id, nome: 'Alheia', nivel: 0 } });
  await prisma.produto.create({ data: { empresaId: empresa.id, nome: 'Pão francês', sku: `PF${SUF}`, unidade: 'UN', custo: 0.3, precoVenda: 1, status: 'ATIVO', categoriaId: paes.id } as any });

  try {
    await t.test('Árvore traz contagens de produtos e subgrupos, só da empresa', async () => {
      const r = await app.inject({ method: 'GET', url: '/categorias/arvore', headers: tok(leitor) });
      assert.equal(r.statusCode, 200);
      const por = new Map((r.json() as any[]).map((c) => [c.nome, c]));
      assert.equal(por.get('padaria').subgrupos, 2); assert.equal(por.get('padaria').produtos, 0);
      assert.equal(por.get('Pães').produtos, 1); assert.equal(por.get('Pães').nivel, 1);
      assert.equal(por.get('Bebidas').subgrupos, 0);
      assert.equal(por.has('Alheia'), false);
    });

    await t.test('Renomear: nome repetido no mesmo nível é recusado; sem permissão, 403', async () => {
      const dup = await app.inject({ method: 'PUT', url: `/categorias/${doces.id}`, headers: tok(editor), payload: { nome: 'pães' } });
      assert.equal(dup.statusCode, 409); assert.match(dup.body, /Já existe/);
      assert.equal((await app.inject({ method: 'PUT', url: `/categorias/${doces.id}`, headers: tok(leitor), payload: { nome: 'Confeitaria' } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'PUT', url: `/categorias/${doces.id}`, headers: tok(editor), payload: { nome: 'x' } })).statusCode, 400);
      const ok = await app.inject({ method: 'PUT', url: `/categorias/${paes.id}`, headers: tok(editor), payload: { nome: '  Pães artesanais ' } });
      assert.equal(ok.statusCode, 200); assert.equal(ok.json().nome, 'Pães artesanais');
      const prod = await prisma.produto.findFirstOrThrow({ where: { empresaId: empresa.id }, include: { categoria: true } });
      assert.equal(prod.categoria?.nome, 'Pães artesanais', 'o produto continua no mesmo subgrupo');
      assert.ok(await prisma.auditoria.findFirst({ where: { empresaId: empresa.id, entidade: 'Categoria', entidadeId: paes.id, acao: 'EDITAR' } }));
    });

    await t.test('Excluir: bloqueado com produtos ou subgrupos (com o motivo); vazio exclui', async () => {
      const comSub = await app.inject({ method: 'DELETE', url: `/categorias/${padaria.id}`, headers: tok(editor) });
      assert.equal(comSub.statusCode, 409); assert.match(comSub.body, /2 subgrupo\(s\)/);
      const comProd = await app.inject({ method: 'DELETE', url: `/categorias/${paes.id}`, headers: tok(editor) });
      assert.equal(comProd.statusCode, 409); assert.match(comProd.body, /1 produto\(s\)/);
      assert.equal((await app.inject({ method: 'DELETE', url: `/categorias/${bebidas.id}`, headers: tok(leitor) })).statusCode, 403);
      assert.equal((await app.inject({ method: 'DELETE', url: `/categorias/${bebidas.id}`, headers: tok(editor) })).statusCode, 200);
      assert.equal(await prisma.categoria.count({ where: { id: bebidas.id } }), 0);
      assert.equal((await app.inject({ method: 'DELETE', url: `/categorias/${doces.id}`, headers: tok(editor) })).statusCode, 200, 'subgrupo vazio');
      assert.ok(await prisma.auditoria.findFirst({ where: { empresaId: empresa.id, entidade: 'Categoria', entidadeId: bebidas.id, acao: 'EXCLUIR' } }));
    });

    await t.test('Outra empresa: não renomeia nem exclui (404)', async () => {
      assert.equal((await app.inject({ method: 'PUT', url: `/categorias/${alheia.id}`, headers: tok(editor), payload: { nome: 'Invadida' } })).statusCode, 404);
      assert.equal((await app.inject({ method: 'DELETE', url: `/categorias/${alheia.id}`, headers: tok(editor) })).statusCode, 404);
      assert.equal((await prisma.categoria.findUniqueOrThrow({ where: { id: alheia.id } })).nome, 'Alheia');
    });
  } finally {
    for (const id of [empresa.id, outra.id]) {
      await prisma.auditoria.deleteMany({ where: { empresaId: id } });
      await prisma.produto.deleteMany({ where: { empresaId: id } });
      await prisma.categoria.deleteMany({ where: { empresaId: id, nivel: { gte: 1 } } }); await prisma.categoria.deleteMany({ where: { empresaId: id } });
      await prisma.permissao.deleteMany({ where: { usuario: { empresaId: id } } }); await prisma.usuario.deleteMany({ where: { empresaId: id } });
      await prisma.filial.deleteMany({ where: { empresaId: id } });
      await prisma.empresa.delete({ where: { id } }).catch((err) => console.log('[limpeza]', String(err.message).match(/constraint[^\n]*/)?.[0]));
    }
    await app.close();
  }
});
