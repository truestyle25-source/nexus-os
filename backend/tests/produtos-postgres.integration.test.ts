import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { produtosRoutes } from '../src/modules/produtos/produtos.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';

test('Produtos: CRUD, filtros, paginação e máscara persistem no PostgreSQL real', {
  skip: process.env.RUN_PRODUCTS_DB_TEST !== '1',
}, async () => {
  const tokenSecret = process.env.JWT_SECRET || 'secret';
  const usuarios = await prisma.usuario.findMany({ where: { status: 'ATIVO' }, select: { id: true, empresaId: true, email: true } });
  let usuario: (typeof usuarios)[number] | undefined;
  for (const candidato of usuarios) {
    const permissoes = await prisma.permissao.findMany({
      where: { usuarioId: candidato.id, permitido: true, modulo: { in: ['produtos', 'custos'] } },
      select: { modulo: true, acao: true },
    });
    const possui = (modulo: string, acao: string) => permissoes.some((permissao) => permissao.modulo === modulo && permissao.acao === acao);
    const filiais = await prisma.filial.count({ where: { empresaId: candidato.empresaId, status: 'ATIVO' } });
    if (possui('produtos', 'visualizar') && possui('produtos', 'criar') && possui('produtos', 'editar') && possui('produtos', 'excluir') && possui('custos', 'visualizar') && possui('custos', 'editar') && filiais > 0) {
      usuario = candidato;
      break;
    }
  }
  assert.ok(usuario, 'PostgreSQL precisa conter um usuário ativo autorizado e uma filial ativa para o teste real.');

  const app = Fastify();
  await app.register(jwt, { secret: tokenSecret });
  await app.register(registerAuthentication);
  await app.register(produtosRoutes);
  await app.ready();
  const token = app.jwt.sign({ id: usuario.id, empresaId: usuario.empresaId, email: usuario.email }, { expiresIn: '1h' });
  const headers = { authorization: `Bearer ${token}` };
  const runId = randomUUID();
  const sku = `INTEGRACAO-${runId}`;
  const prefixoPaginacao = `PAGINACAO-${runId}`;
  const idsCriados: string[] = [];
  const filialTeste = await prisma.filial.findFirst({ where: { empresaId: usuario.empresaId, status: 'ATIVO' }, select: { id: true } });
  assert.ok(filialTeste);
  let categoriaTesteId: string | undefined;
  let categoriaCriadaId: string | undefined;
  const permissaoCustoVisualizar = await prisma.permissao.findUnique({ where: { usuarioId_modulo_acao: { usuarioId: usuario.id, modulo: 'custos', acao: 'visualizar' } } });
  const permissaoCustoEditar = await prisma.permissao.findUnique({ where: { usuarioId_modulo_acao: { usuarioId: usuario.id, modulo: 'custos', acao: 'editar' } } });
  assert.ok(permissaoCustoVisualizar && permissaoCustoEditar);

  const request = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, headers, payload });
  const criar = async (nome: string, skuProduto: string) => {
    const resposta = await request('POST', '/produtos', {
      nome,
      categoriaId: categoriaTesteId,
      sku: skuProduto,
      marca: 'Validação PostgreSQL',
      codigoBarras: `789${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      custo: 10,
      precoVenda: 20,
      unidade: 'UN',
      estoqueMinimo: 2,
      estoqueMaximo: 20,
      pontoPedido: 4,
      peso: '0,25kg',
      ncm: '22021000',
      local: 'TESTE-A-01',
      descricao: 'Registro temporário de integração PostgreSQL',
    });
    assert.equal(resposta.statusCode, 200, resposta.body);
    const produto = resposta.json();
    idsCriados.push(produto.id);
    return produto;
  };

  try {
    const categoriaExistente = await prisma.categoria.findFirst({ where: { empresaId: usuario.empresaId }, select: { id: true } });
    if (categoriaExistente) {
      categoriaTesteId = categoriaExistente.id;
    } else {
      const respostaCategoria = await request('POST', '/categorias', { nome: `Categoria ${runId}` });
      assert.equal(respostaCategoria.statusCode, 200, respostaCategoria.body);
      categoriaTesteId = respostaCategoria.json().id;
      categoriaCriadaId = categoriaTesteId;
    }
    const produto = await criar(`Produto integração ${runId}`, sku);
    assert.equal(produto.marca, 'Validação PostgreSQL');
    assert.equal(produto.unidade, 'UN');
    assert.equal(produto.pontoPedido, 4);

    const detalheInicial = await request('GET', `/produtos/${produto.id}`);
    assert.equal(detalheInicial.statusCode, 200);
    const detalheBody = detalheInicial.json();
    assert.equal(detalheBody.categoriaId, categoriaTesteId);
    assert.ok(detalheBody.estoques.some((estoque: any) => estoque.local === 'TESTE-A-01'));
    assert.equal(Number(detalheBody.custo), 10);

    const importacao = await request('POST', '/produtos/importar', {
      produtos: [{
        nome: `Produto CSV ${runId}`,
        sku: `CSV-${runId}`,
        categoriaId: categoriaTesteId,
        marca: 'Importação PostgreSQL',
        custo: 8,
        precoVenda: 16,
        unidade: 'UN',
        estoqueMinimo: 1,
        estoqueMaximo: 50,
        pontoPedido: 3,
        quantidadeInicial: 7,
        filialId: filialTeste.id,
        local: 'CSV-A-01',
      }],
    });
    assert.equal(importacao.statusCode, 200, importacao.body);
    assert.equal(importacao.json().qtdImportada, 1);
    idsCriados.push(...importacao.json().ids);
    const produtoImportado = await request('GET', `/produtos?search=${encodeURIComponent(`CSV-${runId}`)}`);
    assert.equal(produtoImportado.json().produtos[0].estoques.reduce((total: number, estoque: any) => total + estoque.quantidade, 0), 7);

    const edicao = await request('PUT', `/produtos/${produto.id}`, {
      nome: `Produto editado ${runId}`,
      codigoBarras: null,
      custo: 12,
      precoVenda: 24,
      pontoPedido: 6,
      local: 'TESTE-B-02',
      peso: '0,5kg',
      ncm: '10063000',
      precoPromocional: 18,
      promocaoInicio: '2026-10-01T00:00:00.000Z',
      promocaoFim: '2026-10-31T23:59:59.999Z',
      promocaoLimite: 5,
    });
    assert.equal(edicao.statusCode, 200, edicao.body);

    const recarregado = await request('GET', `/produtos/${produto.id}`);
    const produtoPersistido = recarregado.json();
    assert.equal(produtoPersistido.nome, `Produto editado ${runId}`);
    assert.equal(produtoPersistido.codigoBarras, null);
    assert.equal(Number(produtoPersistido.custo), 12);
    assert.equal(Number(produtoPersistido.precoVenda), 24);
    assert.equal(Number(produtoPersistido.precoPromocional), 18);
    assert.equal(produtoPersistido.promocaoLimite, 5);
    assert.ok(produtoPersistido.estoques.some((estoque: any) => estoque.local === 'TESTE-B-02'));

    const busca = await request('GET', `/produtos?search=${encodeURIComponent(sku)}&take=10`);
    assert.equal(busca.statusCode, 200);
    assert.ok(busca.json().produtos.some((item: any) => item.id === produto.id));
    const filtroPrecoMargem = await request('GET', `/produtos?search=${encodeURIComponent(sku)}&precoMin=23&precoMax=25&margemMin=49&margemMax=51`);
    assert.ok(filtroPrecoMargem.json().produtos.some((item: any) => item.id === produto.id));
    const filtroCategoria = await request('GET', `/produtos?categoriaId=${encodeURIComponent(categoriaTesteId!)}&search=${encodeURIComponent(sku)}`);
    assert.ok(filtroCategoria.json().produtos.some((item: any) => item.id === produto.id));
    const filtroSemEstoque = await request('GET', `/produtos?estoque=SEM_ESTOQUE&search=${encodeURIComponent(sku)}`);
    assert.ok(filtroSemEstoque.json().produtos.some((item: any) => item.id === produto.id));

    const inativado = await request('PATCH', `/produtos/${produto.id}/status`, { status: 'INATIVO' });
    assert.equal(inativado.statusCode, 200);
    const recargaInativo = await request('GET', `/produtos?status=INATIVO&search=${encodeURIComponent(sku)}`);
    assert.equal(recargaInativo.json().produtos[0].status, 'INATIVO');
    assert.equal(Number(recargaInativo.json().produtos[0].custo), 12);

    const loteA = await criar(`Produto lote A ${runId}`, `LOTE-A-${runId}`);
    const loteB = await criar(`Produto lote B ${runId}`, `LOTE-B-${runId}`);
    const arquivamentoLote = await request('PATCH', '/produtos/status-lote', { ids: [loteA.id, loteB.id], status: 'ARQUIVADO' });
    assert.equal(arquivamentoLote.statusCode, 200, arquivamentoLote.body);
    assert.equal(arquivamentoLote.json().total, 2);
    const recargaLote = await request('GET', `/produtos?status=ARQUIVADO&search=${encodeURIComponent(runId)}`);
    assert.ok(recargaLote.json().produtos.filter((item: any) => item.status === 'ARQUIVADO').length >= 2);

    const arquivamentoIndividual = await request('DELETE', `/produtos/${produto.id}`);
    assert.equal(arquivamentoIndividual.statusCode, 200);
    const recargaArquivado = await request('GET', `/produtos?status=ARQUIVADO&search=${encodeURIComponent(sku)}`);
    assert.equal(recargaArquivado.json().produtos[0].status, 'ARQUIVADO');

    await prisma.permissao.update({ where: { id: permissaoCustoVisualizar.id }, data: { permitido: false } });
    const semCustos = await request('GET', `/produtos?status=ARQUIVADO&search=${encodeURIComponent(sku)}`);
    assert.equal(semCustos.statusCode, 200);
    assert.equal(semCustos.json().podeVerCusto, false);
    const produtoSemCustos = semCustos.json().produtos[0];
    assert.equal('custo' in produtoSemCustos, false);
    assert.equal('margem' in produtoSemCustos, false);
    assert.ok(produtoSemCustos.estoques.every((estoque: any) => !('valorTotal' in estoque)));
    const detalheSemCustos = await request('GET', `/produtos/${produto.id}`);
    assert.equal(detalheSemCustos.statusCode, 200);
    assert.equal('custo' in detalheSemCustos.json(), false);
    assert.equal('margem' in detalheSemCustos.json(), false);
    assert.ok(detalheSemCustos.json().estoques.every((estoque: any) => !('valorTotal' in estoque)));
    const filtroMargemSemPermissao = await request('GET', '/produtos?margemMin=10');
    assert.equal(filtroMargemSemPermissao.statusCode, 403);
    const statusSemCustos = await request('PATCH', `/produtos/${produto.id}/status`, { status: 'ATIVO' });
    assert.equal(statusSemCustos.statusCode, 200);
    assert.equal('custo' in statusSemCustos.json(), false);
    await prisma.permissao.update({ where: { id: permissaoCustoEditar.id }, data: { permitido: false } });
    const tentativaEditarCusto = await request('PUT', `/produtos/${produto.id}`, { custo: 99 });
    assert.equal(tentativaEditarCusto.statusCode, 403);
    const tentativaImportarCusto = await request('POST', '/produtos/importar', {
      produtos: [{ nome: `Negado ${runId}`, custo: 1, precoVenda: 2 }],
    });
    assert.equal(tentativaImportarCusto.statusCode, 403);

    await prisma.permissao.update({ where: { id: permissaoCustoVisualizar.id }, data: { permitido: true } });
    await prisma.permissao.update({ where: { id: permissaoCustoEditar.id }, data: { permitido: true } });

    for (let indice = 0; indice < 205; indice++) {
      const sequencia = String(indice).padStart(3, '0');
      const respostaCadastro = await request('POST', '/produtos', {
        nome: `${prefixoPaginacao}-${sequencia}`,
        sku: `${prefixoPaginacao}-${sequencia}`,
        custo: 5,
        precoVenda: 10,
      });
      assert.equal(respostaCadastro.statusCode, 200, respostaCadastro.body);
      idsCriados.push(respostaCadastro.json().id);
    }
    const paginaFinal = await request('GET', `/produtos?search=${encodeURIComponent(prefixoPaginacao)}&take=200&skip=200`);
    assert.equal(paginaFinal.statusCode, 200);
    assert.equal(paginaFinal.json().total, 205);
    assert.equal(paginaFinal.json().produtos.length, 5);
    assert.ok(paginaFinal.json().produtos.every((item: any) => item.nome.startsWith(prefixoPaginacao)));
  } finally {
    if (permissaoCustoVisualizar) await prisma.permissao.update({ where: { id: permissaoCustoVisualizar.id }, data: { permitido: true } });
    if (permissaoCustoEditar) await prisma.permissao.update({ where: { id: permissaoCustoEditar.id }, data: { permitido: true } });
    if (idsCriados.length) {
      await prisma.estoqueMovimentacao.deleteMany({ where: { produtoId: { in: idsCriados } } });
      await prisma.estoque.deleteMany({ where: { produtoId: { in: idsCriados } } });
      await prisma.auditoria.deleteMany({ where: { entidade: 'Produto', entidadeId: { in: idsCriados } } });
      await prisma.produto.deleteMany({ where: { empresaId: usuario.empresaId, id: { in: idsCriados } } });
      assert.equal(await prisma.produto.count({ where: { id: { in: idsCriados } } }), 0, 'Produtos temporários precisam ser removidos do PostgreSQL.');
      assert.equal(await prisma.estoque.count({ where: { produtoId: { in: idsCriados } } }), 0, 'Estoques temporários precisam ser removidos do PostgreSQL.');
    }
    if (categoriaCriadaId) await prisma.categoria.deleteMany({ where: { id: categoriaCriadaId, empresaId: usuario.empresaId } });
    await app.close();
    await prisma.$disconnect();
  }
});