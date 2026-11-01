/**
 * TESTE DE INTEGRACAO — COMPRAS
 *
 * O bug real desta aba era silencioso: o modal de "Nova Compra" enviava ids de
 * filial e fornecedor que NAO EXISTIAM no banco (`matriz`, `f1`..`f4`, hardcoded
 * no front). Toda criacao era recusada com "Filial invalida para esta empresa" e
 * o fluxo de compra simplesmente nao existia — sem erro visivel, porque a tela
 * tratava a falha como "empresa sem compras".
 *
 * Este teste prova o FLUXO COMPLETO contra o PostgreSQL real:
 *   1. `GET /compras` devolve compras + filiais + fornecedores no mesmo payload,
 *      com ids REAIS do banco (e uma lista vazia ainda conta como sucesso).
 *   2. Criar compra: valida filial/fornecedor/produto, grava itens e valorTotal.
 *   3. SOLICITADA -> PEDIDO -> RECEBIDA, com as regras de transição.
 *   4. Recebimento: da baixa no estoque, atualiza custo e gera a despesa.
 *   5. Cancelamento e as recusas (compra ja recebida, editar fora de status).
 *   6. Multi-tenant e permissoes.
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { comprasRoutes } from '../src/modules/compras/compras.routes.js';
import { estoqueRoutes } from '../src/modules/estoque/estoque.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-compras';
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
      return reply.status(400).send({ error: 'Dados invalidos.', detalhes: (error as any).issues });
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
  await app.register(comprasRoutes);
  await app.register(estoqueRoutes);

  const empresa = await prisma.empresa.create({
    data: { nome: `CmpTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `CmpOutro ${SUFIXO}`, cnpj: `${Date.now() + 1}`.padStart(14, '0') },
  });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz Compras' } });
  const filialB = await prisma.filial.create({ data: { empresaId: empresa2.id, nome: 'Filial Outro' } });
const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, filialId: filial.id, nome: 'Admin Compras', email: `cmp-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Sem Permissao', email: `cmpsem-${SUFIXO}@teste.local`, senhaHash },
  });
  const usuario2 = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Outro Tenant', email: `cmpoutro-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario2.id })) });

  const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email })}` };
  const H2 = { authorization: `Bearer ${app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email })}` };
  const req = (m: any, url: string, payload?: unknown, headers = H) => app.inject({ method: m, url, headers, payload });

  // Criar unidade base para o produto (necessário para FK constraint na migration)
  const unidadeBase = await prisma.unidade.create({
    data: { empresa: {
      connect: {
        id: "cmvqxpm200000xtrshfs6aehu"
      }
    },
    simbolo: 'UN',
    fatorCanonico: 1,
    dimensaoId: null,
          nome: "Unidade Padrão" },
  });

  const produto = await prisma.produto.create({
    data: {
      empresaId: empresa.id, nome: 'Cafe Grao 500g', sku: `CMP-${SUFIXO}`, custo: 10, precoVenda: 25,
      unidade: 'UN', unidadeBaseId: unidadeBase.id, estoqueMinimo: 5, estoqueMaximo: 200, status: 'ATIVO', origem: 'MANUAL',
    },
  });
  const produtoB = await prisma.produto.create({
    data: {
      empresaId: empresa2.id, nome: 'Produto Outro', sku: `CMPB-${SUFIXO}`, custo: 10, precoVenda: 25,
      unidade: 'UN', unidadeBaseId: null, estoqueMinimo: 5, estoqueMaximo: 200, status: 'ATIVO', origem: 'MANUAL',
    },
  });
  await prisma.estoque.create({ data: { empresaId: empresa.id, filialId: filial.id, produtoId: produto.id, quantidade: 0, valorTotal: 0 } });
  const fornecedor = await prisma.fornecedor.create({
    data: { empresaId: empresa.id, nome: 'Fornecedor Alfa', cnpj: '11222333000144', status: 'Ativo', origem: 'MANUAL' },
  });
  const fornecedorInativo = await prisma.fornecedor.create({
    data: { empresaId: empresa.id, nome: 'Fornecedor Inativo', cnpj: '11222333000155', status: 'Inativo', origem: 'MANUAL' },
  });
  const saldo = async (filialId: string, produtoId: string) =>
    Number((await prisma.estoque.findUnique({ where: { filialId_produtoId: { filialId, produtoId } } }))?.quantidade ?? 0);

  try {
    console.log('\n1. GET /compras: compras + filiais + fornecedores no mesmo payload');
    const lista = await req('GET', '/compras');
    ok('GET /compras -> 200', lista.statusCode === 200, `status=${lista.statusCode}`);
    ok('comeca vazio: nenhuma compra e um SUCESSO, nao um erro', Array.isArray(lista.json().compras) && lista.json().compras.length === 0,
      `compras=${JSON.stringify(lista.json().compras)}`);
    // Este e o ponto que quebrava a aba inteira: a tela precisa dos ids REAIS
    // para montar o select, e so recebe o que vier no payload.
    ok('devolve as filiais cadastradas com id do banco',
      lista.json().filiais?.some?.((f: any) => f.id === filial.id), `filiais=${JSON.stringify(lista.json().filiais)}`);
    ok('NENHUM id de filial inventado na resposta',
      lista.json().filiais?.every?.((f: any) => f.id !== 'matriz' && f.id !== 'filial-rj' && f.id !== 'cd-campinas'));
    ok('devolve os fornecedores com id do banco',
      lista.json().fornecedores?.some?.((f: any) => f.id === fornecedor.id), `forn=${JSON.stringify(lista.json().fornecedores)}`);
    ok('o fornecedor traz o status (a tela desabilita inativo no select)',
      lista.json().fornecedores?.every?.((f: any) => typeof f.status === 'string'));
    ok('NENHUM id de fornecedor inventado na resposta',
      lista.json().fornecedores?.every?.((f: any) => !['f1', 'f2', 'f3', 'f4'].includes(f.id)));

    console.log('\n2. Criar compra (o botao que nao funcionava)');
    const fil = await req('POST', '/compras', {
      filialId: 'matriz', fornecedorId: fornecedor.id, condPagamento: '30 DDL',
      itens: [{ produtoId: produto.id, quantidade: 10, valorUnit: 5 }], origem: 'MANUAL',
    });
    ok('filial inventada ("matriz") e RECUSADA, com mensagem clara', fil.statusCode >= 400,
      `status=${fil.statusCode} corpo=${fil.body.slice(0, 160)}`);
    ok('nenhuma compra foi criada pela filial inventada',
      await prisma.compra.count({ where: { empresaId: empresa.id } }) === 0);

    const criar = await req('POST', '/compras', {
      filialId: filial.id, fornecedorId: fornecedor.id, condPagamento: '30 DDL',
      itens: [{ produtoId: produto.id, quantidade: 10, valorUnit: 5 }], origem: 'MANUAL',
    });
    ok('POST /compras com ids reais -> 200', criar.statusCode === 200, `status=${criar.statusCode} corpo=${criar.body.slice(0, 160)}`);
    const compraId = criar.json().id;
    ok('a compra nasce SOLICITADA', criar.json().status === 'SOLICITADA', `status=${criar.json().status}`);
    ok('valorTotal calculado e gravado (10 x 5 = 50)', Number(criar.json().valorTotal) === 50, `total=${criar.json().valorTotal}`);
    ok('o item foi gravado no PostgreSQL', await prisma.compraItem.count({ where: { compraId } }) === 1);
    ok('condPagamento persistida', criar.json().condPagamento === '30 DDL');
    ok('o estoque NAO muda so por criar a compra', await saldo(filial.id, produto.id) === 0,
      `saldo=${await saldo(filial.id, produto.id)}`);
console.log('\n3. Validacoes da criacao');
    const fornInativo = await req('POST', '/compras', {
      filialId: filial.id, fornecedorId: fornecedorInativo.id,
      itens: [{ produtoId: produto.id, quantidade: 1, valorUnit: 5 }], origem: 'MANUAL',
    });
    ok('fornecedor INATIVO e recusado', fornInativo.statusCode >= 400, `status=${fornInativo.statusCode}`);
    const prodOutro = await req('POST', '/compras', {
      filialId: filial.id, fornecedorId: fornecedor.id,
      itens: [{ produtoId: produtoB.id, quantidade: 1, valorUnit: 5 }], origem: 'MANUAL',
    });
    ok('produto de outra empresa e recusado', prodOutro.statusCode >= 400, `status=${prodOutro.statusCode}`);
    const filialAlheia = await req('POST', '/compras', {
      filialId: filialB.id, fornecedorId: fornecedor.id,
      itens: [{ produtoId: produto.id, quantidade: 1, valorUnit: 5 }], origem: 'MANUAL',
    });
    ok('filial de outra empresa e recusada', filialAlheia.statusCode >= 400, `status=${filialAlheia.statusCode}`);
    const semItens = await req('POST', '/compras', { filialId: filial.id, fornecedorId: fornecedor.id, itens: [], origem: 'MANUAL' });
    ok('compra sem itens e recusada', semItens.statusCode >= 400, `status=${semItens.statusCode}`);
    const qtdZero = await req('POST', '/compras', {
      filialId: filial.id, fornecedorId: fornecedor.id,
      itens: [{ produtoId: produto.id, quantidade: 0, valorUnit: 5 }], origem: 'MANUAL',
    });
    ok('quantidade zero e recusada', qtdZero.statusCode >= 400, `status=${qtdZero.statusCode}`);
    ok('as tentativas recusadas NAO gravaram compras', await prisma.compra.count({ where: { empresaId: empresa.id } }) === 1,
      `total=${await prisma.compra.count({ where: { empresaId: empresa.id } })}`);

    console.log('\n4. Fluxo SOLICITADA -> PEDIDO -> RECEBIDA');
    const editar = await req('PUT', `/compras/${compraId}`, {
      condPagamento: '45 DDL', itens: [{ produtoId: produto.id, quantidade: 20, valorUnit: 7 }],
    });
    ok('PUT /compras/:id em SOLICITADA -> 200', editar.statusCode === 200, `status=${editar.statusCode}`);
    ok('os itens foram substituidos (nao duplicados)', await prisma.compraItem.count({ where: { compraId } }) === 1);
    ok('valorTotal recalculado (20 x 7 = 140)', Number(editar.json().valorTotal) === 140, `total=${editar.json().valorTotal}`);

    const confirmar = await req('POST', `/compras/${compraId}/confirmar`);
    ok('POST /compras/:id/confirmar -> 200', confirmar.statusCode === 200, `status=${confirmar.statusCode}`);
    ok('agora esta PEDIDO', confirmar.json().status === 'PEDIDO', `status=${confirmar.json().status}`);
    const confirmar2 = await req('POST', `/compras/${compraId}/confirmar`);
    ok('confirmar de novo e recusado (409)', confirmar2.statusCode === 409, `status=${confirmar2.statusCode}`);
    const editarDepois = await req('PUT', `/compras/${compraId}`, { condPagamento: '60 DDL' });
    ok('editar depois do PEDIDO e recusado (negociado nao muda)', editarDepois.statusCode === 409, `status=${editarDepois.statusCode}`);
console.log('\n5. Recebimento: COMPRA -> ESTOQUE -> CUSTO -> FINANCEIRO');
    const custoAntes = Number((await prisma.produto.findUnique({ where: { id: produto.id } }))!.custo);
    const receber = await req('POST', `/compras/${compraId}/receber`);
    ok('POST /compras/:id/receber -> 200', receber.statusCode === 200, `status=${receber.statusCode} corpo=${receber.body.slice(0, 160)}`);
    ok('a compra ficou RECEBIDA', receber.json().status === 'RECEBIDA', `status=${receber.json().status}`);
    ok('dataRecebimento foi gravada', !!receber.json().dataRecebimento);
    ok('o estoque subiu 20 (20 x 7)', await saldo(filial.id, produto.id) === 20, `saldo=${await saldo(filial.id, produto.id)}`);
    const custoDepois = Number((await prisma.produto.findUnique({ where: { id: produto.id } }))!.custo);
    ok('o custo do produto virou o ultimo valor pago (7)', custoDepois === 7, `antes=${custoAntes} depois=${custoDepois}`);
    const despesa = await prisma.financeiro.findFirst({ where: { compraId } });
    ok('a despesa foi gerada no financeiro', !!despesa);
    ok('a despesa e do valor total da compra (140)', Number(despesa?.valor) === 140, `valor=${despesa?.valor}`);
    ok('a despesa e DESPESA e PENDENTE', despesa?.tipo === 'DESPESA' && despesa?.status === 'PENDENTE');
    const movimento = await prisma.estoqueMovimentacao.findFirst({ where: { documento: compraId } });
    ok('o movimento de estoque e do tipo COMPRA', movimento?.tipo === 'COMPRA', `tipo=${movimento?.tipo}`);
    const receber2 = await req('POST', `/compras/${compraId}/receber`);
    ok('receber duas vezes e recusado (409)', receber2.statusCode === 409, `status=${receber2.statusCode}`);
    ok('o estoque NAO foi dobrado pela segunda tentativa', await saldo(filial.id, produto.id) === 20,
      `saldo=${await saldo(filial.id, produto.id)}`);
    ok('NENHUMA despesa duplicada', await prisma.financeiro.count({ where: { compraId } }) === 1);

    console.log('\n6. Cancelamento');
    const cancel = await req('POST', `/compras/${compraId}/cancelar`);
    ok('cancelar compra RECEBIDA e recusado (409)', cancel.statusCode === 409, `status=${cancel.statusCode}`);
    ok('a compra continua RECEBIDA', (await prisma.compra.findUnique({ where: { id: compraId } }))!.status === 'RECEBIDA');
    const compra2 = await req('POST', '/compras', {
      filialId: filial.id, fornecedorId: fornecedor.id,
      itens: [{ produtoId: produto.id, quantidade: 5, valorUnit: 3 }], origem: 'MANUAL',
    });
    const cancel2 = await req('POST', `/compras/${compra2.json().id}/cancelar`);
    ok('cancelar compra SOLICITADA -> 200', cancel2.statusCode === 200, `status=${cancel2.statusCode}`);
    ok('a compra ficou CANCELADA', cancel2.json().status === 'CANCELADA', `status=${cancel2.json().status}`);
    const receberCancelada = await req('POST', `/compras/${compra2.json().id}/receber`);
    ok('receber compra CANCELADA e recusado (409)', receberCancelada.statusCode === 409, `status=${receberCancelada.statusCode}`);
    ok('cancelar de novo e recusado (409)', (await req('POST', `/compras/${compra2.json().id}/cancelar`)).statusCode === 409);
console.log('\n7. Persistencia apos recarregar');
    const relido = await req('GET', `/compras/${compraId}`);
    ok('GET /compras/:id -> 200', relido.statusCode === 200);
    ok('o status RECEBIDA continua gravado', relido.json().status === 'RECEBIDA', `status=${relido.json().status}`);
    ok('os itens continuam gravados', relido.json().itens?.length === 1);
    ok('o item traz o produto com nome e sku (a tela le o objeto produto)',
      relido.json().itens[0].produto?.nome === 'Cafe Grao 500g' && relido.json().itens[0].produto?.sku === `CMP-${SUFIXO}`,
      `produto=${JSON.stringify(relido.json().itens[0].produto)}`);
    ok('o valor unitario volta como numero utilizavel', Number(relido.json().itens[0].valorUnit) === 7);
    const lista2 = await req('GET', '/compras');
    ok('a lista traz as 2 compras', lista2.json().compras?.length === 2, `n=${lista2.json().compras?.length}`);
    ok('a lista traz o nome real da filial', lista2.json().compras.every((c: any) => c.filial?.nome === 'Matriz Compras'));
    ok('a lista traz o nome real do fornecedor', lista2.json().compras.every((c: any) => c.fornecedor?.nome === 'Fornecedor Alfa'));
    ok('a lista traz dataCompra real (nao uma data fixa de exemplo)',
      lista2.json().compras.every((c: any) => !!c.dataCompra && !String(c.dataCompra).startsWith('2025-09-20')));
    ok('o filtro por status funciona no servidor',
      (await req('GET', '/compras?status=RECEBIDA')).json().compras.length === 1);

    console.log('\n8. Multi-tenant e permissoes');
    const outro = await req('GET', '/compras', undefined, H2);
    ok('outra empresa responde 200', outro.statusCode === 200);
    ok('outra empresa nao ve as compras da empresa A', (outro.json().compras ?? []).length === 0,
      `n=${outro.json().compras?.length}`);
    ok('outra empresa nao ve as filiais da empresa A',
      (outro.json().filiais ?? []).every((f: any) => f.id !== filial.id));
    ok('GET /compras/:id de outra empresa -> 404', (await req('GET', `/compras/${compraId}`, undefined, H2)).statusCode === 404);
    ok('POST /compras/:id/confirmar de outra empresa -> 404', (await req('POST', `/compras/${compraId}/confirmar`, undefined, H2)).statusCode === 404);
    ok('POST /compras/:id/receber de outra empresa -> 404', (await req('POST', `/compras/${compraId}/receber`, undefined, H2)).statusCode === 404);
    ok('POST /compras/:id/cancelar de outra empresa -> 404', (await req('POST', `/compras/${compraId}/cancelar`, undefined, H2)).statusCode === 404);
    ok('GET /compras sem permissao -> 403', (await req('GET', '/compras', undefined, Hsem)).statusCode === 403);
    ok('POST /compras sem permissao -> 403',
      (await req('POST', '/compras', { filialId: filial.id, fornecedorId: fornecedor.id, itens: [{ produtoId: produto.id, quantidade: 1, valorUnit: 1 }] }, Hsem)).statusCode === 403);
    ok('POST /compras/:id/receber sem permissao -> 403', (await req('POST', `/compras/${compraId}/receber`, undefined, Hsem)).statusCode === 403);
    ok('POST /compras/:id/confirmar sem permissao -> 403', (await req('POST', `/compras/${compraId}/confirmar`, undefined, Hsem)).statusCode === 403);
    ok('POST /compras/:id/cancelar sem permissao -> 403', (await req('POST', `/compras/${compraId}/cancelar`, undefined, Hsem)).statusCode === 403);
    ok('GET /compras sem token -> 401', (await app.inject({ method: 'GET', url: '/compras' })).statusCode === 401);
    ok('o estoque da empresa A nao foi tocado pelas tentativas recusadas',
      await saldo(filial.id, produto.id) === 20, `saldo=${await saldo(filial.id, produto.id)}`);
  } finally {
    await prisma.financeiro.deleteMany({ where: { empresaId: { in: [empresa.id, empresa2.id] } } });
    await prisma.estoqueMovimentacao.deleteMany({ where: { empresaId: { in: [empresa.id, empresa2.id] } } });
    await prisma.compraItem.deleteMany({ where: { compra: { empresaId: { in: [empresa.id, empresa2.id] } } } });
    await prisma.compra.deleteMany({ where: { empresaId: { in: [empresa.id, empresa2.id] } } });
    await prisma.estoque.deleteMany({ where: { empresaId: { in: [empresa.id, empresa2.id] } } });
    await prisma.fornecedor.deleteMany({ where: { empresaId: { in: [empresa.id, empresa2.id] } } });
    await prisma.produto.deleteMany({ where: { empresaId: { in: [empresa.id, empresa2.id] } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: [usuario.id, semPermissao.id, usuario2.id] } } });
    await prisma.usuario.deleteMany({ where: { id: { in: [usuario.id, semPermissao.id, usuario2.id] } } });
    await prisma.filial.deleteMany({ where: { id: { in: [filial.id, filialB.id] } } });
    await prisma.empresa.deleteMany({ where: { id: { in: [empresa.id, empresa2.id] } } });
    await app.close();
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}

void main();