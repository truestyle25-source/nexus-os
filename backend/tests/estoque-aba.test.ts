/**
 * TESTE DE INTEGRAÇÃO — ESTOQUE
 *
 * A aba é 100% leitura + movimentos, e o risco dela está nas REGRAS: um saldo
 * que vaza negativo, uma transferência que some mercadoria, uma contagem de
 * inventário que aplica diferença sozinha. Este teste prova as regras que a
 * tela depende, contra o PostgreSQL real:
 *
 *   1. `GET /estoque` devolve estoque + filiais + indicadores, e o gate de custo
 *      funciona nos DOIS níveis: `podeVerCusto` e a AUSÊNCIA dos campos
 *      `custo`/`valorTotal` no corpo (o SELECT do servidor já os omite).
 *   2. Movimentação: ENTRADA soma, SAIDA subtrai, ambas persistem saldo e
 *      histórico. SAIDA maior que o saldo é recusada — estoque nunca fica
 *      negativo por caminho normal.
 *   3. AJUSTE/INVENTARIO gravam SALDO FINAL (não delta) — a distinção que a
 *      tela avisa com a prévia antes/depois.
 *   4. TRANSFERENCIA: sai da origem, entra no destino, gera as DUAS linhas
 *      ligadas pelo mesmo documento, e é recusada sem saldo ou origem = destino.
 *   5. Inventário: abre folha congelando o saldo, guarda contagem com autor e
 *      hora, recusa segunda folha na mesma filial e NÃO mexe no estoque ao
 *      concluir.
 *   6. Isolamento multi-tenant e permissões.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { estoqueRoutes } from '../src/modules/estoque/estoque.routes.js';
import { inventarioRoutes } from '../src/modules/rh/inventario.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-estoque';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

async function main() {
  const app = Fastify({ logger: false });
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
  await app.register(estoqueRoutes);
  await app.register(inventarioRoutes);

  const empresa = await prisma.empresa.create({
    data: { nome: `EstTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `EstOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Filial Centro' } });
  const filial2 = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Filial Norte' } });
  const filialB = await prisma.filial.create({ data: { empresaId: empresa2.id, nome: 'Filial Outro' } });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, filialId: filial.id, nome: 'Admin Est', email: `est-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });
  const semCusto = await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: 'Sem Custo', email: `estsc-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({
    data: permissoes.filter((p) => p.modulo !== 'custos').map((p) => ({ ...p, usuarioId: semCusto.id })),
  });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Sem Permissao', email: `semest-${SUFIXO}@teste.local`, senhaHash },
  });
  const usuario2 = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Outro Tenant', email: `outroest-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario2.id })) });

  const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email })}` };
  const Hsc = { authorization: `Bearer ${app.jwt.sign({ id: semCusto.id, empresaId: empresa.id, email: semCusto.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email })}` };
  const H2 = { authorization: `Bearer ${app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email })}` };
  const ids = [usuario.id, semCusto.id, semPermissao.id, usuario2.id];
  const req = (m: any, url: string, payload?: unknown, headers = H) => app.inject({ method: m, url, headers, payload });
  const saldo = async (filialId: string, produtoId: string) =>
    Number((await prisma.estoque.findUnique({ where: { filialId_produtoId: { filialId, produtoId } } }))?.quantidade ?? 0);

  const produto = await prisma.produto.create({
    data: {
      empresaId: empresa.id, nome: 'Produto Estoque', sku: `EST-${SUFIXO}`, custo: 10, precoVenda: 25,
      unidade: 'UN', estoqueMinimo: 5, estoqueMaximo: 200, status: 'ATIVO', origem: 'MANUAL',
    },
  });
  const produtoB = await prisma.produto.create({
    data: {
      empresaId: empresa2.id, nome: 'Produto Outro', sku: `ESTB-${SUFIXO}`, custo: 10, precoVenda: 25,
      unidade: 'UN', estoqueMinimo: 5, estoqueMaximo: 200, status: 'ATIVO', origem: 'MANUAL',
    },
  });
  for (const f of [filial, filial2]) {
    await prisma.estoque.create({ data: { empresaId: empresa.id, filialId: f.id, produtoId: produto.id, quantidade: 0, valorTotal: 0 } });
  }
  try {
    console.log('\n1. GET /estoque: saldo, filiais e indicadores');
    const entrar = await req('POST', '/estoque/movimentar', {
      produtoId: produto.id, filialId: filial.id, quantidade: 100, tipo: 'ENTRADA',
      motivo: 'Carga inicial', origem: 'MANUAL',
    });
    ok('POST /estoque/movimentar (ENTRADA) -> 200', entrar.statusCode === 200,
      `status=${entrar.statusCode} corpo=${entrar.body.slice(0, 180)}`);
    ok('o saldo foi para 100 no PostgreSQL', await saldo(filial.id, produto.id) === 100,
      `saldo=${await saldo(filial.id, produto.id)}`);
    const vis = await req('GET', '/estoque');
    ok('GET /estoque -> 200', vis.statusCode === 200);
    ok('devolve as linhas de estoque', Array.isArray(vis.json().estoques) && vis.json().estoques.length >= 2);
    ok('devolve as filiais cadastradas (nao so as que tem estoque)',
      vis.json().filiais?.some?.((f: any) => f.id === filial.id), `filiais=${JSON.stringify(vis.json().filiais)}`);
    ok('devolve os indicadores', !!vis.json().indicadores);
    ok('qtdBaixo conta o item abaixo do minimo (100 nao)', vis.json().indicadores.qtdBaixo === 0,
      `baixo=${vis.json().indicadores.qtdBaixo}`);
    const semCusto = await req('GET', '/estoque', undefined, Hsc);
    ok('sem custos: podeVerCusto = false', semCusto.json().indicadores.podeVerCusto === false);
    ok('sem custos: valorTotal nao vem no corpo',
      semCusto.json().indicadores.valorTotal === undefined, `valor=${semCusto.json().indicadores.valorTotal}`);
    ok('sem custos: o produto NAO traz o campo custo',
      semCusto.json().estoques.every((e: any) => e.produto.custo === undefined), 'custo vazou no SELECT');
    ok('sem custos: a linha NAO traz valorTotal',
      semCusto.json().estoques.every((e: any) => e.valorTotal === undefined), 'valorTotal vazou no SELECT');
    ok('com custos: o produto traz o custo',
      vis.json().estoques.every((e: any) => e.produto.custo !== undefined));

    console.log('\n2. SAIDA subtrai e nunca deixa o estoque negativo');
    const saida = await req('POST', '/estoque/movimentar', {
      produtoId: produto.id, filialId: filial.id, quantidade: 30, tipo: 'SAIDA',
      motivo: 'Venda balcao', origem: 'MANUAL',
    });
    ok('POST /estoque/movimentar (SAIDA) -> 200', saida.statusCode === 200, `status=${saida.statusCode}`);
    ok('o saldo caiu para 70', await saldo(filial.id, produto.id) === 70, `saldo=${await saldo(filial.id, produto.id)}`);
    const estoura = await req('POST', '/estoque/movimentar', {
      produtoId: produto.id, filialId: filial.id, quantidade: 500, tipo: 'SAIDA', origem: 'MANUAL',
    });
    ok('saida maior que o saldo -> recusada', estoura.statusCode === 400, `status=${estoura.statusCode}`);
    ok('o estoque NAO virou negativo', await saldo(filial.id, produto.id) === 70,
      `saldo=${await saldo(filial.id, produto.id)}`);
    const zerado = await req('POST', '/estoque/movimentar', {
      produtoId: produto.id, filialId: filial.id, quantidade: 70, tipo: 'SAIDA', origem: 'MANUAL',
    });
    ok('da para zerar o estoque (ruptura e um estado valido)', zerado.statusCode === 200);
    ok('saldo zerado', await saldo(filial.id, produto.id) === 0);
    const movs = await req('GET', '/estoque/movimentacoes?take=50');
    ok('GET /estoque/movimentacoes -> 200', movs.statusCode === 200);
    ok('o historico traz o total de movimentos registrados', movs.json().movimentacoes.length >= 3,
      `movs=${movs.json().movimentacoes.length}`);

    console.log('\n3. AJUSTE grava SALDO FINAL, nao delta');
    await req('POST', '/estoque/movimentar', { produtoId: produto.id, filialId: filial.id, quantidade: 40, tipo: 'ENTRADA', origem: 'MANUAL' });
    ok('pre-condicao: saldo 40', await saldo(filial.id, produto.id) === 40);
    const ajuste = await req('POST', '/estoque/movimentar', {
      produtoId: produto.id, filialId: filial.id, quantidade: 12, tipo: 'AJUSTE',
      motivo: 'Contagem fisica', origem: 'MANUAL',
    });
    ok('POST com tipo AJUSTE -> 200', ajuste.statusCode === 200, `status=${ajuste.statusCode}`);
    ok('AJUSTE gravou 12 como SALDO FINAL (nao 40+12 nem 40-28)',
      await saldo(filial.id, produto.id) === 12, `saldo=${await saldo(filial.id, produto.id)}`);
    console.log('\n4. Transferencia entre filiais');
    // O saldo ao entrar aqui é o que a seção 3 deixou (12 após o AJUSTE). O teste
    // deriva os valores em vez de cravar números: fixar 50 aqui já produziu uma
    // cadeia de asserções erradas, porque 12 + 50 = 62 e não 50.
    const antesDaEntrada = await saldo(filial.id, produto.id);
    await req('POST', '/estoque/movimentar', { produtoId: produto.id, filialId: filial.id, quantidade: 50, tipo: 'ENTRADA', origem: 'MANUAL' });
    const cheio = antesDaEntrada + 50;
    ok(`pre-condicao: ${cheio} na origem`, await saldo(filial.id, produto.id) === cheio,
      `saldo=${await saldo(filial.id, produto.id)}`);
    const esperadoDepois = cheio - 20;
    const tr = await req('POST', '/estoque/transferir', {
      produtoId: produto.id, filialOrigemId: filial.id, filialDestinoId: filial2.id,
      quantidade: 20, motivo: 'Reposicao', origem: 'MANUAL',
    });
    ok('POST /estoque/transferir -> 200', tr.statusCode === 200, `status=${tr.statusCode} corpo=${tr.body.slice(0, 180)}`);
    ok(`a origem ficou com ${esperadoDepois}`, await saldo(filial.id, produto.id) === esperadoDepois,
      `origem=${await saldo(filial.id, produto.id)}`);
    ok('o destino recebeu 20', await saldo(filial2.id, produto.id) === 20, `destino=${await saldo(filial2.id, produto.id)}`);
    const doc = tr.json().documento;
    ok('a resposta traz o documento que liga as duas pontas', typeof doc === 'string' && doc.length > 0, `doc=${doc}`);
    const duasLinhas = await prisma.estoqueMovimentacao.findMany({ where: { documento: doc } });
    ok('foram gravadas DUAS linhas de movimentacao', duasLinhas.length === 2, `linhas=${duasLinhas.length}`);
    ok('uma com delta negativo (saida da origem) e outra positivo',
      duasLinhas.some((m) => m.quantidade === -20) && duasLinhas.some((m) => m.quantidade === 20),
      `deltas=${duasLinhas.map((m) => m.quantidade).join(',')}`);
    const semSaldo = await req('POST', '/estoque/transferir', {
      produtoId: produto.id, filialOrigemId: filial.id, filialDestinoId: filial2.id, quantidade: 9999, origem: 'MANUAL',
    });
    ok('transferir mais do que existe -> recusada', semSaldo.statusCode >= 400, `status=${semSaldo.statusCode}`);
    const mesma = await req('POST', '/estoque/transferir', {
      produtoId: produto.id, filialOrigemId: filial.id, filialDestinoId: filial.id, quantidade: 1, origem: 'MANUAL',
    });
    ok('transferir para a MESMA filial -> recusada', mesma.statusCode >= 400, `status=${mesma.statusCode}`);
    ok('o saldo da origem nao mudou nas tentativas recusadas',
      await saldo(filial.id, produto.id) === esperadoDepois, `origem=${await saldo(filial.id, produto.id)}`);
    const saldoFixo = await saldo(filial.id, produto.id);

    console.log('\n5. Inventario: folha, contagem e fechamento');
    const abrir = await req('POST', '/estoque/inventarios', {
      nome: `Contagem ${SUFIXO}`, filialId: filial.id, cegas: true,
    });
    ok('POST /estoque/inventarios -> 200', abrir.statusCode === 200, `status=${abrir.statusCode} corpo=${abrir.body.slice(0, 200)}`);
    const sessao = abrir.json().sessao;
    ok('a sessao nasce ABERTA', sessao.status === 'ABERTA', `status=${sessao.status}`);
    ok('a folha congelou o saldo do sistema', sessao.contagens.length >= 1, `itens=${sessao.contagens.length}`);
    const item = sessao.contagens[0];
    ok(`cada item guarda o saldo do instante da abertura`,
      item.quantidadeSistema === saldoFixo, `sistema=${item.quantidadeSistema} esperado=${saldoFixo}`);
    const itemId = item.estoqueId;
    const contar = await req('PUT', `/estoque/inventarios/${sessao.id}/contagens`, {
      contagens: [{ estoqueId: itemId, quantidade: 27 }],
    });
    ok('PUT /contagens -> 200', contar.statusCode === 200, `status=${contar.statusCode} corpo=${contar.body.slice(0, 180)}`);
    const comContagem = contar.json().sessao.contagens.find((c: any) => c.id === item.id);
    ok('a contagem foi gravada', comContagem?.quantidadeContada === 27, `contada=${comContagem?.quantidadeContada}`);
    ok('a divergencia foi CLASSIFICADA (SOBROU/FALTOU)',
      ['SOBROU', 'FALTOU'].includes(comContagem?.divergencia), `divergencia=${comContagem?.divergencia}`);
    ok('guarda QUEM contou', !!comContagem?.contadoPor, `por=${comContagem?.contadoPor}`);
    const segunda = await req('POST', '/estoque/inventarios', {
      nome: `Contagem duplicada ${SUFIXO}`, filialId: filial.id, cegas: false,
    });
    ok('abrir uma 2a folha na MESMA filial -> recusada', segunda.statusCode >= 400,
      `status=${segunda.statusCode}`);
    const fechar = await req('POST', `/estoque/inventarios/${sessao.id}/fechar`, { status: 'CONCLUIDA' });
    ok('POST /fechar -> 200', fechar.statusCode === 200, `status=${fechar.statusCode}`);
    ok('a sessao ficou CONCLUIDA', fechar.json().sessao.status === 'CONCLUIDA');
    ok('CONCLUIR O INVENTARIO NAO ALTERA O ESTOQUE (decisao da empresa)',
      await saldo(filial.id, produto.id) === saldoFixo, `saldo=${await saldo(filial.id, produto.id)}`);
    const hist = await req('GET', '/estoque/inventarios');
    ok('a folha aparece no historico', hist.json().sessoes.some((s: any) => s.id === sessao.id));
    const semItens = await req('POST', '/estoque/inventarios', { nome: 'Sem itens', filialId: filialB.id, cegas: true });
    ok('filial sem nenhum item em estoque -> recusada', semItens.statusCode >= 400, `status=${semItens.statusCode}`);
    console.log('\n6. Isolamento multi-tenant e permissoes');
    const listaB = await req('GET', '/estoque', undefined, H2);
    ok('empresa B responde 200', listaB.statusCode === 200);
    ok('empresa B nao ve o produto da empresa A',
      !JSON.stringify(listaB.json()).includes(`EST-${SUFIXO}`), 'vazou o sku da empresa A');
    const movAlheio = await req('POST', '/estoque/movimentar', {
      produtoId: produto.id, filialId: filial.id, quantidade: 5, tipo: 'ENTRADA', origem: 'MANUAL',
    }, H2);
    ok('empresa B nao movimenta produto da empresa A -> 404', movAlheio.statusCode === 404,
      `status=${movAlheio.statusCode}`);
    ok('o saldo da empresa A nao mudou', await saldo(filial.id, produto.id) === saldoFixo,
      `saldo=${await saldo(filial.id, produto.id)}`);
    ok('movimentar em filial de outra empresa -> recusada',
      (await req('POST', '/estoque/movimentar', {
        produtoId: produto.id, filialId: filialB.id, quantidade: 1, tipo: 'ENTRADA', origem: 'MANUAL',
      })).statusCode >= 400);
    ok('GET /estoque sem permissao -> 403', (await req('GET', '/estoque', undefined, Hsem)).statusCode === 403);
    ok('POST /estoque/movimentar sem permissao -> 403',
      (await req('POST', '/estoque/movimentar', {
        produtoId: produto.id, filialId: filial.id, quantidade: 1, tipo: 'ENTRADA',
      }, Hsem)).statusCode === 403);
    ok('POST /estoque/transferir sem permissao -> 403',
      (await req('POST', '/estoque/transferir', {
        produtoId: produto.id, filialOrigemId: filial.id, filialDestinoId: filial2.id, quantidade: 1,
      }, Hsem)).statusCode === 403);
    ok('GET /estoque sem token -> 401', (await app.inject({ method: 'GET', url: '/estoque' })).statusCode === 401);
    ok('GET /estoque/inventarios sem permissao -> 403',
      (await req('GET', '/estoque/inventarios', undefined, Hsem)).statusCode === 403);
    // Tipo de movimento desconhecido não pode virar saldo qualquer.
    ok('tipo de movimento desconhecido -> recusado',
      (await req('POST', '/estoque/movimentar', {
        produtoId: produto.id, filialId: filial.id, quantidade: 5, tipo: 'TIPO_INEXISTENTE', origem: 'MANUAL',
      })).statusCode >= 400);
    ok('o saldo segue intacto apos as tentativas invalidas',
      await saldo(filial.id, produto.id) === saldoFixo, `saldo=${await saldo(filial.id, produto.id)}`);
  } finally {
    const todas = [empresa.id, empresa2.id];
    await prisma.contagemInventario.deleteMany({ where: { sessao: { empresaId: { in: todas } } } });
    await prisma.sessaoInventario.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.estoqueMovimentacao.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.estoqueSnapshotDiario.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.estoque.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.produto.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.filial.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.empresa.deleteMany({ where: { id: { in: todas } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: aba estoque', async () => {
  await main();
});