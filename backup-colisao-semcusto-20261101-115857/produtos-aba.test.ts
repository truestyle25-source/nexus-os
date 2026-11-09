/**
 * TESTE DE INTEGRAÇÃO — PRODUTOS
 *
 * Existe um `produtos-postgres.integration.test.ts`, mas ele é **pulado sem
 * `RUN_PRODUCTS_DB_TEST=1`** e depende de dados pré-existentes no banco. Este
 * teste é autocontido (cria empresa, filial, usuário e permissões) e cobre os
 * fluxos que a aba usa E que aquele teste não cobre:
 *
 *   1. Criar (POST /produtos) com os NOMES DE CAMPO que a tela usa, reler do
 *      PostgreSQL e ver na listagem.
 *   2. Editar (PUT /produtos/:id) — atenção: o PUT é de ATUALIZAÇÃO PARCIAL
 *      (todos os campos são `.optional()`). A tela depende disso em dois pontos:
 *      o formulário de edição e, principalmente, a promoção, que manda SÓ os
 *      campos de promoção. Se o PUT apagasse o resto, criar promoção apagaria o
 *      nome e o preço do produto.
 *   3. Status (PATCH /produtos/:id/status), arquivar (DELETE) e arquivar em
 *      lote (PATCH /produtos/status-lote) — cada um persistido.
 *   4. Ajustar estoque (POST /estoque/movimentar): a movimentação persiste e o
 *      saldo do produto muda de verdade.
 *   5. Importar CSV (POST /produtos/importar): persiste o lote inteiro.
 *   6. SKU e código de barras duplicados -> 409.
 *   7. Mascaramento de custo: quem não tem `custos:visualizar` não recebe custo
 *      nem valor de estoque — é o que sustenta o KPI "Valor Estoque: Oculto".
 *   8. Isolamento multi-tenant e permissões em todas as rotas tocadas.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { produtosRoutes } from '../src/modules/produtos/produtos.routes.js';
import { estoqueRoutes } from '../src/modules/estoque/estoque.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-produtos';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Teste bloqueado: defina DATABASE_URL para o banco isolado nexus_os_test.');
  }
  const database = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1'].includes(database.hostname) ||
      database.port !== '5432' ||
      database.pathname.replace(/^\/+/, '') !== 'nexus_os_test') {
    throw new Error('Teste bloqueado: este teste só pode usar localhost:5432/nexus_os_test.');
  }

  const app = Fastify({ logger: false });
  const empresasCriadas: string[] = [];
  const usuariosCriados: string[] = [];

  try {
    app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') {
      return reply.status(400).send({ error: 'Dados inválidos.', detalhes: (error as any).issues });
    }
    if (error instanceof ErroDeNegocio) {
      return reply.status(error.status).send({ error: error.message });
    }
    if (error?.statusCode >= 400 && error?.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    if (error?.constructor === Error) return reply.status(400).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.' });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  await app.register(produtosRoutes);
  await app.register(estoqueRoutes);

  const cnpjBaseTeste = Date.now() * 10;
  const empresa = await prisma.empresa.create({
    data: { nome: `ProdTeste ${SUFIXO}`, cnpj: String(cnpjBaseTeste + 1).padStart(14, '0') },
  });
  empresasCriadas.push(empresa.id);
  const empresa2 = await prisma.empresa.create({
    data: { nome: `ProdOutro ${SUFIXO}`, cnpj: String(cnpjBaseTeste + 2).padStart(14, '0') },
  });
  empresasCriadas.push(empresa2.id);
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Filial Prod' } });
  const filial2 = await prisma.filial.create({ data: { empresaId: empresa2.id, nome: 'Filial Outro' } });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, filialId: filial.id, nome: 'Admin Prod', email: `prod-${SUFIXO}@teste.local`, senhaHash },
  });
  usuariosCriados.push(usuario.id);
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });
  // Usuário SEM `custos:*`: é o cenário do KPI "Valor Estoque: Oculto".
  const semCusto = await prisma.usuario.create({
    data: { empresaId: empresa.id, filialId: filial.id, nome: 'Sem Custo', email: `prodsc-${SUFIXO}@teste.local`, senhaHash },
  });
  usuariosCriados.push(semCusto.id);
  await prisma.permissao.createMany({
    data: permissoes.filter((p) => p.modulo !== 'custos').map((p) => ({ ...p, usuarioId: semCusto.id })),
  });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Sem Permissao', email: `semprod-${SUFIXO}@teste.local`, senhaHash },
  });
  usuariosCriados.push(semPermissao.id);
  const usuario2 = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Outro Tenant', email: `outroprod-${SUFIXO}@teste.local`, senhaHash },
  });
  usuariosCriados.push(usuario2.id);
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario2.id })) });

  const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email })}` };
  const Hsc = { authorization: `Bearer ${app.jwt.sign({ id: semCusto.id, empresaId: empresa.id, email: semCusto.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email })}` };
  const H2 = { authorization: `Bearer ${app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email })}` };

  const req = (m: any, url: string, payload?: unknown, headers = H) => app.inject({ method: m, url, headers, payload });

    console.log('\n1. POST /produtos — criar com os nomes de campo da tela');
    const criar = await req('POST', '/produtos', {
      nome: 'Café, Torrado e Moído', sku: `SKU-${SUFIXO}`, marca: 'Marca Teste',
      custo: 12.5, precoVenda: 30, unidade: 'UN', estoqueMinimo: 5, estoqueMaximo: 100,
      codigoBarras: '7891234567895', origem: 'MANUAL',
    });
    ok('POST /produtos responde com sucesso', criar.statusCode === 200,
      `status=${criar.statusCode} corpo=${criar.body.slice(0, 200)}`);
    const id = criar.json().id;
    const db = await prisma.produto.findUnique({ where: { id } });
    ok('produto PERSISTIDO no PostgreSQL', !!db);
    ok('nome com virgula gravado intacto', db?.nome === 'Café, Torrado e Moído', `nome=${db?.nome}`);
    ok('sku em maiusculo gravado', db?.sku === `SKU-${SUFIXO}`, `sku=${db?.sku}`);
    ok('custo gravado', Number(db?.custo) === 12.5, `custo=${db?.custo}`);
    ok('margem CALCULADA pelo servidor', Number(db?.margem) > 0, `margem=${db?.margem}`);
    const reler = await req('GET', `/produtos/${id}`);
    ok('GET /produtos/:id devolve o produto', reler.statusCode === 200 && reler.json().id === id);
    const listar = await req('GET', `/produtos?search=SKU-${SUFIXO}`);
    ok('o produto aparece na listagem por busca',
      listar.json().produtos?.some?.((p: any) => p.id === id) || listar.json().some?.((p: any) => p.id === id),
      `corpo=${JSON.stringify(listar.json()).slice(0, 160)}`);

    console.log('\n2. PUT parcial (promocao) NAO apaga o resto do produto');
    // É o que `confirmPromo` faz: PUT /produtos/:id com SÓ os campos de promoção.
    // Se o PUT não fosse parcial, criar a promoção apagaria nome, SKU e preço.
    const promo = await req('PUT', `/produtos/${id}`, {
      precoPromocional: 24, promocaoInicio: new Date().toISOString(), promocaoLimite: 50, origem: 'MANUAL',
    });
    ok('PUT parcial da promocao -> 200', promo.statusCode === 200, `status=${promo.statusCode} corpo=${promo.body.slice(0, 180)}`);
    const aposPromo = await prisma.produto.findUnique({ where: { id } });
    ok('o preco promocional foi gravado', Number(aposPromo?.precoPromocional) === 24, `promo=${aposPromo?.precoPromocional}`);
    ok('o NOME sobreviveu ao PUT parcial', aposPromo?.nome === 'Café, Torrado e Moído', `nome=${aposPromo?.nome}`);
    ok('o SKU sobreviveu ao PUT parcial', aposPromo?.sku === `SKU-${SUFIXO}`, `sku=${aposPromo?.sku}`);
    ok('o preco de VENDA sobreviveu ao PUT parcial', Number(aposPromo?.precoVenda) === 30, `pv=${aposPromo?.precoVenda}`);
    ok('o CUSTO sobreviveu ao PUT parcial', Number(aposPromo?.custo) === 12.5, `custo=${aposPromo?.custo}`);

    console.log('\n3. PUT de edicao (formulario completo)');
    const editar = await req('PUT', `/produtos/${id}`, {
      nome: 'Cafe Premium', sku: `SKU-${SUFIXO}`, precoVenda: 35, unidade: 'UN',
      estoqueMinimo: 8, estoqueMaximo: 120, origem: 'MANUAL',
    });
    ok('PUT de edicao -> 200', editar.statusCode === 200, `status=${editar.statusCode}`);
    const aposEdit = await prisma.produto.findUnique({ where: { id } });
    ok('nome editado PERSISTIDO', aposEdit?.nome === 'Cafe Premium', `nome=${aposEdit?.nome}`);
    ok('preco editado PERSISTIDO', Number(aposEdit?.precoVenda) === 35, `pv=${aposEdit?.precoVenda}`);
    ok('estoque minimo PERSISTIDO', Number(aposEdit?.estoqueMinimo) === 8, `min=${aposEdit?.estoqueMinimo}`);
    const promoInvalida = await req('PUT', `/produtos/${id}`, { precoPromocional: 999 });
    ok('preco promocional MAIOR que o de venda -> 400', promoInvalida.statusCode === 400,
      `status=${promoInvalida.statusCode}`);
    const maxMenor = await req('PUT', `/produtos/${id}`, { estoqueMinimo: 90, estoqueMaximo: 10 });
    ok('estoque maximo menor que o minimo -> 400', maxMenor.statusCode === 400, `status=${maxMenor.statusCode}`);
    console.log('\n4. Status, arquivar e arquivar em lote');
    const inativar = await req('PATCH', `/produtos/${id}/status`, { status: 'INATIVO' });
    ok('PATCH /produtos/:id/status -> 200', inativar.statusCode === 200, `status=${inativar.statusCode}`);
    ok('INATIVO PERSISTIDO', (await prisma.produto.findUnique({ where: { id } }))?.status === 'INATIVO');
    const ativar = await req('PATCH', `/produtos/${id}/status`, { status: 'ATIVO' });
    ok('reativar -> 200', ativar.statusCode === 200);
    ok('ATIVO PERSISTIDO', (await prisma.produto.findUnique({ where: { id } }))?.status === 'ATIVO');

    const extras: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await req('POST', '/produtos', {
        nome: `Produto Lote ${i}`, sku: `LOTE-${SUFIXO}-${i}`, custo: 5, precoVenda: 15,
        unidade: 'UN', estoqueMinimo: 1, estoqueMaximo: 10, origem: 'MANUAL',
      });
      extras.push(r.json().id);
    }
    const lote = await req('PATCH', '/produtos/status-lote', { ids: extras, status: 'ARQUIVADO' });
    ok('PATCH /produtos/status-lote -> 200', lote.statusCode === 200, `status=${lote.statusCode} corpo=${lote.body.slice(0, 160)}`);
    const arquivados = await prisma.produto.count({ where: { id: { in: extras }, status: 'ARQUIVADO' } });
    ok('os 3 produtos do lote foram ARQUIVADOS no banco', arquivados === 3, `arquivados=${arquivados}`);

    const apagar = await req('DELETE', `/produtos/${id}`);
    ok('DELETE /produtos/:id -> 200', apagar.statusCode === 200, `status=${apagar.statusCode}`);
    ok('o produto continua no banco como ARQUIVADO (nao e exclusao fisica)',
      (await prisma.produto.findUnique({ where: { id } }))?.status === 'ARQUIVADO');

    console.log('\n5. Ajustar estoque (POST /estoque/movimentar)');
    const antes = await prisma.estoque.findFirst({ where: { produtoId: id, filialId: filial.id } });
    const saldoAntes = Number(antes?.quantidade ?? 0);
    const mov = await req('POST', '/estoque/movimentar', {
      produtoId: id, filialId: filial.id, quantidade: 25, tipo: 'ENTRADA',
      motivo: 'Teste de ajuste via tela', origem: 'MANUAL',
    });
    ok('POST /estoque/movimentar -> 200', mov.statusCode === 200, `status=${mov.statusCode} corpo=${mov.body.slice(0, 180)}`);
    const depoisEst = await prisma.estoque.findFirst({ where: { produtoId: id, filialId: filial.id } });
    ok('o saldo do estoque AUMENTOU de verdade',
      Number(depoisEst?.quantidade) === saldoAntes + 25,
      `antes=${saldoAntes} depois=${depoisEst?.quantidade}`);
    const movs = await req('GET', '/estoque/movimentacoes?take=50');
    ok('a movimentacao aparece no historico', movs.statusCode === 200);
    const estoqueNeg = await req('POST', '/estoque/movimentar', {
      produtoId: id, filialId: filial.id, quantidade: 0, tipo: 'ENTRADA', origem: 'MANUAL',
    });
    ok('quantidade zero -> recusada', estoqueNeg.statusCode >= 400, `status=${estoqueNeg.statusCode}`);
    const filialAlheia = await req('POST', '/estoque/movimentar', {
      produtoId: id, filialId: filial2.id, quantidade: 5, tipo: 'ENTRADA', origem: 'MANUAL',
    });
    ok('movimentar em filial de outra empresa -> recusada', filialAlheia.statusCode >= 400,
      `status=${filialAlheia.statusCode}`);
    console.log('\n6. Importar CSV (POST /produtos/importar)');
    const imp = await req('POST', '/produtos/importar', {
      produtos: [
        { nome: 'Importado Um', sku: `IMP-${SUFIXO}-1`, custo: 3, precoVenda: 9, unidade: 'UN', estoqueMinimo: 1, estoqueMaximo: 10, quantidadeInicial: 7 },
        { nome: 'Importado Dois', sku: `IMP-${SUFIXO}-2`, custo: 4, precoVenda: 11, unidade: 'UN', estoqueMinimo: 1, estoqueMaximo: 10, quantidadeInicial: 3 },
      ],
    });
    ok('POST /produtos/importar responde com sucesso', imp.statusCode === 200,
      `status=${imp.statusCode} corpo=${imp.body.slice(0, 200)}`);
    ok('a resposta informa quantos foram importados', imp.json()?.qtdImportada === 2,
      `qtd=${imp.json()?.qtdImportada}`);
    const importados = await prisma.produto.count({ where: { empresaId: empresa.id, sku: { startsWith: `IMP-${SUFIXO}` } } });
    ok('os 2 importados estao no PostgreSQL', importados === 2, `persistidos=${importados}`);
    const comSaldo = await prisma.estoque.findFirst({ where: { produto: { sku: `IMP-${SUFIXO}-1` } } });
    ok('a quantidade inicial virou saldo de estoque', Number(comSaldo?.quantidade) === 7,
      `saldo=${comSaldo?.quantidade}`);

    console.log('\n7. SKU e codigo de barras duplicados');
    const dupSku = await req('POST', '/produtos', {
      nome: 'Duplicado', sku: `SKU-${SUFIXO}`, custo: 1, precoVenda: 2, origem: 'MANUAL',
    });
    ok('SKU duplicado na mesma empresa -> 409', dupSku.statusCode === 409, `status=${dupSku.statusCode}`);
    const dupBarras = await req('POST', '/produtos', {
      nome: 'Barras Duplicadas', sku: `OUTRO-${SUFIXO}`, codigoBarras: '7891234567895',
      custo: 1, precoVenda: 2, origem: 'MANUAL',
    });
    ok('codigo de barras duplicado -> 409', dupBarras.statusCode === 409, `status=${dupBarras.statusCode}`);
    const semNome = await req('POST', '/produtos', { sku: 'X', custo: 1, precoVenda: 2 });
    ok('nome ausente/curto -> 400', semNome.statusCode === 400, `status=${semNome.statusCode}`);

    console.log('\n8. Mascaramento de custo (sustenta o KPI "Valor Estoque: Oculto")');
    // Contrato real de GET /produtos: { produtos, total, take, skip,
    // podeVerCusto, podeEditarCusto, valorEstoque } no primeiro nível — o
    // `metadata` que a tela usa é montado no cliente por `fetchAllProducts`.
    const comCusto = await req('GET', '/produtos', undefined, H);
    const semCusto = await req('GET', '/produtos', undefined, Hsc);
    ok('usuario SEM custos.visualizar responde 200', semCusto.statusCode === 200, `status=${semCusto.statusCode}`);
    ok('para quem TEM custo, podeVerCusto = true', comCusto.json()?.podeVerCusto === true,
      `podeVerCusto=${comCusto.json()?.podeVerCusto}`);
    ok('para quem NAO tem custo, podeVerCusto = false', semCusto.json()?.podeVerCusto === false,
      `podeVerCusto=${semCusto.json()?.podeVerCusto}`);
    ok('o valor do estoque some SEM a permissao de custo',
      semCusto.json()?.valorEstoque === null, `valor=${semCusto.json()?.valorEstoque}`);
    ok('o valor do estoque aparece COM a permissao',
      typeof comCusto.json()?.valorEstoque === 'number', `valor=${comCusto.json()?.valorEstoque}`);
    const custoVazado = (semCusto.json()?.produtos ?? []).some((p: any) => p.custo !== undefined && p.custo !== null);
    ok('nenhum produto devolve o campo custo para quem nao pode ver', !custoVazado,
      'um produto ainda trouxe custo');
    const editarCusto = await req('PUT', `/produtos/${id}`, { custo: 999 }, Hsc);
    ok('editar custo sem custos.editar -> 403', editarCusto.statusCode === 403, `status=${editarCusto.statusCode}`);

    console.log('\n9. Isolamento multi-tenant e permissoes');
    const listaB = await req('GET', '/produtos', undefined, H2);
    ok('empresa B responde 200', listaB.statusCode === 200);
    ok('empresa B nao ve o produto da empresa A',
      !JSON.stringify(listaB.json()).includes(`SKU-${SUFIXO}`), 'vazou o sku da empresa A');
    const editarAlheio = await req('PUT', `/produtos/${id}`, { nome: 'Invadido' }, H2);
    ok('empresa B nao edita produto da empresa A -> 404', editarAlheio.statusCode === 404,
      `status=${editarAlheio.statusCode}`);
    const getAlheio = await req('GET', `/produtos/${id}`, undefined, H2);
    ok('empresa B nao le o produto da empresa A -> 404', getAlheio.statusCode === 404, `status=${getAlheio.statusCode}`);
    ok('POST /produtos sem permissao -> 403',
      (await req('POST', '/produtos', { nome: 'X', sku: 'Y', custo: 1, precoVenda: 2 }, Hsem)).statusCode === 403);
    ok('GET /produtos sem token -> 401', (await app.inject({ method: 'GET', url: '/produtos' })).statusCode === 401);
    ok('POST /produtos sem token -> 401',
      (await app.inject({ method: 'POST', url: '/produtos', payload: { nome: 'X', sku: 'Y' } })).statusCode === 401);
  } finally {
    const todas = empresasCriadas;
    const errosLimpeza: string[] = [];
    const tentarLimpar = async (descricao: string, operacao: () => Promise<unknown>) => {
      try {
        await operacao();
      } catch (error) {
        const detalhe = error instanceof Error ? error.message : String(error);
        errosLimpeza.push(`${descricao}: ${detalhe}`);
        console.error(`  ERRO NA LIMPEZA (${descricao}): ${detalhe}`);
      }
    };

    if (todas.length > 0) {
      await tentarLimpar('auditoria', () => prisma.auditoria.deleteMany({ where: { empresaId: { in: todas } } }));
      await tentarLimpar('movimentações', () => prisma.estoqueMovimentacao.deleteMany({ where: { empresaId: { in: todas } } }));
      await tentarLimpar('estoques', () => prisma.estoque.deleteMany({ where: { empresaId: { in: todas } } }));
      await tentarLimpar('produtos', () => prisma.produto.deleteMany({ where: { empresaId: { in: todas } } }));
      if (usuariosCriados.length > 0) {
        await tentarLimpar('permissões', () => prisma.permissao.deleteMany({ where: { usuarioId: { in: usuariosCriados } } }));
        await tentarLimpar('usuários', () => prisma.usuario.deleteMany({ where: { id: { in: usuariosCriados } } }));
      }
      await tentarLimpar('filiais', () => prisma.filial.deleteMany({ where: { empresaId: { in: todas } } }));
      await tentarLimpar('empresas', () => prisma.empresa.deleteMany({ where: { id: { in: todas } } }));
    }

    await tentarLimpar('Fastify', () => app.close());
    await tentarLimpar('Prisma', () => prisma.$disconnect());

    if (errosLimpeza.length > 0) {
      throw new Error(`Falha na limpeza do teste:\n${errosLimpeza.join('\n')}`);
    }
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: aba produtos', async () => {
  await main();
});