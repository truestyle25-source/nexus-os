/**
 * TESTE DE INTEGRAÇÃO — ABA CLIENTES
 *
 * A aba é CRUD + leitura de números derivados de vendas. O risco está em dois
 * pontos que este teste trava:
 *
 *   1. O `status` NÃO era aceito no POST/PUT. A tela gravava o cliente e depois
 *      fazia um PATCH separado só para o status. Essa 2ª chamada podia falhar
 *      (usuário com `criar` e sem `editar`, queda de rede) DEPOIS do cadastro
 *      já estar no banco — a tela acusava erro, o modal ficava aberto e o
 *      retry criava um cliente DUPLICADO. Aqui: status vai na MESMA escrita.
 *   2. Os números da aba (Valor total, Ticket médio, Última compra, Compras) são
 *      colunas mantidas pelo módulo Vendas. Se a venda não chegasse nelas, a aba
 *      exibiria zeros com cara de dado real. Aqui: venda → colunas, e
 *      cancelamento → recálculo.
 *
 * Demais coberturas: documento duplicado, atualização parcial, o filtro que
 * esconde ARQUIVADO, permissões (incluindo a guarda de arquivar), multi-tenant
 * e o fluxo cadastro → venda → edição → arquivamento.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { comprasRoutes } from '../src/modules/compras/compras.routes.js';
import { vendasRoutes } from '../src/modules/vendas/vendas.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-clientes';
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
  await app.register(comprasRoutes);
  await app.register(vendasRoutes);

  const empresa = await prisma.empresa.create({
    data: { nome: `CliTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `CliOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Filial Centro' } });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));

  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, filialId: filial.id, nome: 'Admin Cli', email: `cli-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });

  // Só `criar` em clientes — reproduz o caso em que o PATCH de status (que exige
  // `editar`/`excluir`) falharia depois do cadastro já gravado.
  const soCriar = await prisma.usuario.create({
    data: { empresaId: empresa.id, filialId: filial.id, nome: 'So Criar', email: `criar-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({
    data: permissoes
      .filter((p) => !(p.modulo === 'clientes' && (p.acao === 'editar' || p.acao === 'excluir')))
      .map((p) => ({ ...p, usuarioId: soCriar.id })),
  });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Sem Permissao', email: `semcli-${SUFIXO}@teste.local`, senhaHash },
  });
  const usuario2 = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Outro Tenant', email: `outrocli-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario2.id })) });

  const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email })}` };
  const Hcriar = { authorization: `Bearer ${app.jwt.sign({ id: soCriar.id, empresaId: empresa.id, email: soCriar.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email })}` };
  const H2 = { authorization: `Bearer ${app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email })}` };
  const ids = [usuario.id, soCriar.id, semPermissao.id, usuario2.id];
  const req = (m: any, url: string, payload?: unknown, headers = H) => app.inject({ method: m, url, headers, payload });

  const CNPJ = `55${Date.now()}`.slice(0, 14).padEnd(14, '0');
  /** Lê o cliente do banco (fonte da verdade), sem passar pela listagem. */
  const linha = (id: string) => prisma.cliente.findUnique({ where: { id } });
  /**
   * Lê o cliente COMO A ABA LÊ: via `GET /clientes?status=...`, que é o que a
   * tela consome e onde os números são derivados de `Venda`. Usar a coluna do
   * banco aqui esconderia justamente o defeito do cancelamento.
   */
  const clienteNaTela = async (id: string) => {
    const status = (await linha(id))?.status;
    const r = await req('GET', `/clientes?status=${status}`);
    return r.json().find((c: any) => c.id === id);
  };

  try {
    console.log('\n1. Cadastro: persiste, valida e grava o status na MESMA escrita');
    const criado = await req('POST', '/clientes', {
      nome: `Cliente Alfa ${SUFIXO}`, documento: CNPJ, telefone: '(11) 98888-0000',
      email: 'alfa@teste.local', endereco: 'Rua A, 100', status: 'ATIVO',
    });
    ok('POST /clientes -> 200', criado.statusCode === 200,
      `status=${criado.statusCode} corpo=${criado.body.slice(0, 180)}`);
    const c1 = criado.json();
    ok('o status volta como enviado', c1.status === 'ATIVO', `status=${c1.status}`);
    ok('o documento é gravado só com dígitos', c1.documento === CNPJ, `documento=${c1.documento}`);
    const noBanco = await linha(c1.id);
    ok('o cadastro foi GRAVADO no PostgreSQL', !!noBanco);
    ok('telefone/e-mail/endereço sobreviveram à gravação',
      noBanco?.telefone === '(11) 98888-0000' && noBanco?.email === 'alfa@teste.local' && noBanco?.endereco === 'Rua A, 100',
      `fone=${noBanco?.telefone}`);
    ok('um cliente novo nasce com os números zerados',
      Number(noBanco?.valorTotalComprado) === 0 && noBanco?.frequencia === 0);
    const dup = await req('POST', '/clientes', { nome: `Dup ${SUFIXO}`, documento: CNPJ });
    ok('documento repetido na mesma empresa -> 409', dup.statusCode === 409, `status=${dup.statusCode}`);
    ok('nome com 1 caractere -> 400', (await req('POST', '/clientes', { nome: 'A' })).statusCode === 400);
    ok('e-mail inválido -> 400',
      (await req('POST', '/clientes', { nome: `Y ${SUFIXO}`, email: 'nao-e-email' })).statusCode === 400);
    ok('status inválido -> 400',
      (await req('POST', '/clientes', { nome: `Z ${SUFIXO}`, status: 'MEIO_ESTADO' })).statusCode === 400);

    console.log('\n2. A correção central: status sem segunda requisição');
    // Cenário do bug: `criar` sem `editar`. Antes, o POST criava ATIVO e o PATCH
    // de status era rejeitado com 403 — cadastro gravado + erro na tela + modal
    // aberto + retry duplicando o cliente.
    const docBeta = `${CNPJ.slice(0, 13)}8`;
    const inativo = await req('POST', '/clientes', {
      nome: `Cliente Beta ${SUFIXO}`, documento: docBeta, status: 'INATIVO',
    }, Hcriar);
    ok('usuário só com `criar` cadastra cliente INATIVO numa requisição só',
      inativo.statusCode === 200, `status=${inativo.statusCode} corpo=${inativo.body.slice(0, 160)}`);
    ok('o status INATIVO foi gravado direto, sem PATCH seguinte',
      inativo.json().status === 'INATIVO', `status=${inativo.json().status}`);
    const noBancoB = await linha(inativo.json().id);
    ok('INATIVO confirmado no banco', noBancoB?.status === 'INATIVO', `status=${noBancoB?.status}`);
    const arqSemPerm = await req('POST', '/clientes', {
      nome: `Cliente Gamma ${SUFIXO}`, status: 'ARQUIVADO',
    }, Hcriar);
    ok('cadastrar já ARQUIVADO sem `clientes.excluir` -> 403',
      arqSemPerm.statusCode === 403, `status=${arqSemPerm.statusCode}`);
    ok('e o cadastro NÃO ficou gravado (falhou antes de criar)',
      (await prisma.cliente.count({ where: { empresaId: empresa.id, nome: `Cliente Gamma ${SUFIXO}` } })) === 0);
    const arquivado = await req('POST', '/clientes', {
      nome: `Cliente Gamma ${SUFIXO}`, status: 'ARQUIVADO',
    });
    ok('com `clientes.excluir`, cadastrar ARQUIVADO -> 200', arquivado.statusCode === 200,
      `status=${arquivado.statusCode} corpo=${arquivado.body.slice(0, 160)}`);
    ok('o ARQUIVADO foi gravado', arquivado.json().status === 'ARQUIVADO');

    console.log('\n3. Listagem e o filtro que esconde ARQUIVADO');
    const padrao = (await req('GET', '/clientes')).json();
    ok('GET /clientes sem filtro traz ATIVOS e INATIVOS',
      padrao.some((c: any) => c.id === c1.id) && padrao.some((c: any) => c.id === inativo.json().id),
      `n=${padrao.length}`);
    ok('e NÃO traz ARQUIVADO (comportamento documentado do backend)',
      !padrao.some((c: any) => c.id === arquivado.json().id));
    const soArq = (await req('GET', '/clientes?status=ARQUIVADO')).json();
    ok('GET /clientes?status=ARQUIVADO devolve o arquivado',
      soArq.length === 1 && soArq[0].id === arquivado.json().id, `n=${soArq.length}`);
    ok('status fora do enum -> 400',
      (await req('GET', '/clientes?status=BANANA')).statusCode === 400);
    ok('a busca por nome filtra',
      (await req('GET', `/clientes?search=${encodeURIComponent('Alfa')}`)).json().length === 1);
    ok('a lista vem ordenada por nome',
      padrao.length < 2 || padrao[0].nome.localeCompare(padrao[1].nome, 'pt-BR') <= 0,
      `${padrao[0]?.nome} / ${padrao[1]?.nome}`);
    console.log('\n4. INTEGRAÇÃO COM VENDAS: os números da aba têm que ser reais');
    const produto = await prisma.produto.create({
      data: { empresaId: empresa.id, nome: `Produto ${SUFIXO}`, sku: `SKC-${SUFIXO}`, precoVenda: 50, custo: 20, status: 'ATIVO' },
    });
    await prisma.estoque.create({
      data: { empresaId: empresa.id, filialId: filial.id, produtoId: produto.id, quantidade: 100 },
    });
    ok('antes da venda o cliente está zerado na tela (linha de base)',
      Number((await clienteNaTela(c1.id))?.valorTotalComprado) === 0);

    const venda = await req('POST', '/vendas', {
      filialId: filial.id, clienteId: c1.id, formaPagamento: 'DINHEIRO',
      itens: [{ produtoId: produto.id, quantidade: 2, desconto: 0 }],
    });
    // FASE 1 PDV PRO: POST /vendas devolve 201 Created (era 200).
    ok('POST /vendas -> 201', venda.statusCode === 201,
      `status=${venda.statusCode} corpo=${venda.body.slice(0, 200)}`);
    // A rota responde { venda, ticketMedio, faturamento, qtdVendas } — o id do
    // registro está dentro de `venda`, não no topo.
    const vendaId = venda.json().venda.id;
    ok('a resposta traz a venda criada com id', typeof vendaId === 'string' && vendaId.length > 0,
      `id=${vendaId}`);
    // 2 x R$ 50 = R$ 100
    const aposVenda = await clienteNaTela(c1.id);
    ok('"Valor total comprado" recebeu o valor da venda',
      Number(aposVenda?.valorTotalComprado) === 100, `valor=${aposVenda?.valorTotalComprado}`);
    ok('"Compras" subiu para 1', aposVenda?.frequencia === 1, `frequencia=${aposVenda?.frequencia}`);
    ok('"Ticket médio" = 100 / 1', Number(aposVenda?.ticketMedio) === 100, `ticket=${aposVenda?.ticketMedio}`);
    ok('"Última compra" foi preenchida', !!aposVenda?.ultimaCompra, `ultima=${aposVenda?.ultimaCompra}`);

    const venda2 = await req('POST', '/vendas', {
      filialId: filial.id, clienteId: c1.id, formaPagamento: 'DINHEIRO',
      itens: [{ produtoId: produto.id, quantidade: 4, desconto: 0 }],
    });
    // FASE 1 PDV PRO: POST /vendas devolve 201 Created (era 200).
    ok('segunda venda -> 201', venda2.statusCode === 201, `status=${venda2.statusCode}`);
    // total 100 + 200 = 300 em 2 compras
    const apos2 = await clienteNaTela(c1.id);
    ok('"Valor total" acumulou as duas vendas (300)',
      Number(apos2?.valorTotalComprado) === 300, `valor=${apos2?.valorTotalComprado}`);
    ok('"Compras" = 2', apos2?.frequencia === 2, `frequencia=${apos2?.frequencia}`);
    ok('"Ticket médio" recalculado para 150 (300/2)',
      Number(apos2?.ticketMedio) === 150, `ticket=${apos2?.ticketMedio}`);

    const cancelamento = await req('POST', `/vendas/${vendaId}/cancelar`, {});
    ok('POST /vendas/:id/cancelar -> 200', cancelamento.statusCode === 200,
      `status=${cancelamento.statusCode} corpo=${cancelamento.body.slice(0, 200)}`);
    // Sobra só a venda de 200 -> total 200, 1 compra, ticket 200.
    // Esta é a asserção que reprova o defeito do módulo Vendas: a coluna do banco
    // continua em 300 porque o cancelamento recalcula antes de marcar CANCELADA.
    const aposCancelar = await clienteNaTela(c1.id);
    ok('cancelar reduz o "Valor total" exibido (300 -> 200)',
      Number(aposCancelar?.valorTotalComprado) === 200, `valor=${aposCancelar?.valorTotalComprado}`);
    ok('cancelar reduz "Compras" exibidas (2 -> 1)',
      aposCancelar?.frequencia === 1, `frequencia=${aposCancelar?.frequencia}`);
    ok('cancelar recalcula o "Ticket médio" exibido (200)',
      Number(aposCancelar?.ticketMedio) === 200, `ticket=${aposCancelar?.ticketMedio}`);

    const listaApos = (await req('GET', '/clientes')).json().find((c: any) => c.id === c1.id);
    ok('a listagem da aba reflete o valor recalculado',
      Number(listaApos?.valorTotalComprado) === 200 && listaApos?.frequencia === 1,
      `valor=${listaApos?.valorTotalComprado}`);
    ok('"ticketMedio" por cliente confere com valor/frequência',
      Number(listaApos?.ticketMedio) === Number(listaApos?.valorTotalComprado) / listaApos?.frequencia,
      `ticket=${listaApos?.ticketMedio}`);

    console.log('\n5. Edição: parcial, sem apagar campos, status na mesma chamada');
    const editado = await req('PUT', `/clientes/${c1.id}`, { telefone: '(11) 97777-1111' });
    ok('PUT /clientes/:id -> 200', editado.statusCode === 200,
      `status=${editado.statusCode} corpo=${editado.body.slice(0, 180)}`);
    const aposEdicao = await linha(c1.id);
    ok('o telefone foi alterado', aposEdicao?.telefone === '(11) 97777-1111', `fone=${aposEdicao?.telefone}`);
    ok('a atualização parcial NÃO apagou nome/e-mail/endereço',
      aposEdicao?.nome === `Cliente Alfa ${SUFIXO}` && aposEdicao?.email === 'alfa@teste.local'
      && aposEdicao?.endereco === 'Rua A, 100',
      `nome=${aposEdicao?.nome} email=${aposEdicao?.email}`);
    ok('a atualização parcial NÃO apagou o documento', aposEdicao?.documento === CNPJ);
    ok('a atualização parcial NÃO zerou os números de compra',
      Number((await clienteNaTela(c1.id))?.valorTotalComprado) === 200,
      `valor=${(await clienteNaTela(c1.id))?.valorTotalComprado}`);
    ok('o status não mudou quando não foi enviado', aposEdicao?.status === 'ATIVO');

    const mudaStatus = await req('PUT', `/clientes/${c1.id}`, { status: 'INATIVO' });
    ok('PUT com status -> 200 numa requisição só', mudaStatus.statusCode === 200,
      `status=${mudaStatus.statusCode}`);
    ok('o status foi alterado direto', (await linha(c1.id))?.status === 'INATIVO',
      `status=${(await linha(c1.id))?.status}`);
    ok('PUT arquivar sem `clientes.excluir` -> 403',
      (await req('PUT', `/clientes/${c1.id}`, { status: 'ARQUIVADO' }, Hcriar)).statusCode === 403);
    ok('e o cliente NÃO foi arquivado (a guarda barrou de verdade)',
      (await linha(c1.id))?.status === 'INATIVO', `status=${(await linha(c1.id))?.status}`);
    ok('PUT com documento repetido de outro cliente -> 409',
      (await req('PUT', `/clientes/${c1.id}`, { documento: docBeta })).statusCode === 409);
    ok('PUT em cliente inexistente -> 404',
      (await req('PUT', '/clientes/nao-existe-xyz', { nome: 'Fulano' })).statusCode === 404);
    console.log('\n6. Arquivar pelo botão da aba (PATCH) e permissões');
    const arq = await req('PATCH', `/clientes/${c1.id}/status`, { status: 'ARQUIVADO' });
    ok('PATCH /clientes/:id/status -> 200', arq.statusCode === 200,
      `status=${arq.statusCode} corpo=${arq.body.slice(0, 160)}`);
    ok('o cliente ficou ARQUIVADO no banco', (await linha(c1.id))?.status === 'ARQUIVADO');
    ok('o arquivado some da listagem padrão e aparece na de ARQUIVADO',
      !(await req('GET', '/clientes')).json().some((c: any) => c.id === c1.id)
      && (await req('GET', '/clientes?status=ARQUIVADO')).json().some((c: any) => c.id === c1.id));
    const restaura = await req('PATCH', `/clientes/${c1.id}/status`, { status: 'ATIVO' });
    ok('desarquivar -> 200 e volta a ATIVO', restaura.statusCode === 200
      && (await linha(c1.id))?.status === 'ATIVO', `status=${(await linha(c1.id))?.status}`);
    ok('PATCH arquivar sem `clientes.excluir` -> 403',
      (await req('PATCH', `/clientes/${c1.id}/status`, { status: 'ARQUIVADO' }, Hcriar)).statusCode === 403);
    ok('PATCH em cliente inexistente -> 404',
      (await req('PATCH', '/clientes/nao-existe-xyz/status', { status: 'INATIVO' })).statusCode === 404);
    ok('PATCH sem token -> 401',
      (await app.inject({ method: 'PATCH', url: `/clientes/${c1.id}/status`, payload: { status: 'INATIVO' } })).statusCode === 401);

    console.log('\n7. Multi-tenant e permissões gerais');
    ok('a empresa B não enxerga os clientes da empresa A',
      (await req('GET', '/clientes', undefined, H2)).json().length === 0);
    ok('a empresa B não edita cliente da A -> 404',
      (await req('PUT', `/clientes/${c1.id}`, { nome: 'Invadido' }, H2)).statusCode === 404);
    ok('a empresa B não arquiva cliente da A -> 404',
      (await req('PATCH', `/clientes/${c1.id}/status`, { status: 'ARQUIVADO' }, H2)).statusCode === 404);
    ok('o cliente da A não foi alterado',
      (await linha(c1.id))?.nome === `Cliente Alfa ${SUFIXO}`, `nome=${(await linha(c1.id))?.nome}`);
    ok('GET /clientes sem token -> 401',
      (await app.inject({ method: 'GET', url: '/clientes' })).statusCode === 401);
    ok('GET sem permissão -> 403', (await req('GET', '/clientes', undefined, Hsem)).statusCode === 403);
    ok('GET detalhe sem permissão -> 403',
      (await req('GET', `/clientes/${c1.id}`, undefined, Hsem)).statusCode === 403);
    ok('POST sem permissão -> 403',
      (await req('POST', '/clientes', { nome: `Z ${SUFIXO}` }, Hsem)).statusCode === 403);
    ok('PUT sem permissão -> 403',
      (await req('PUT', `/clientes/${c1.id}`, { nome: 'X' }, Hsem)).statusCode === 403);
    ok('PATCH sem permissão -> 403',
      (await req('PATCH', `/clientes/${c1.id}/status`, { status: 'INATIVO' }, Hsem)).statusCode === 403);
    // CHECK_MARKER
console.log('\n8. Detalhe (histórico de vendas) e fluxo completo');
    const detalhe = await req('GET', `/clientes/${c1.id}`);
    ok('GET /clientes/:id -> 200', detalhe.statusCode === 200, `status=${detalhe.statusCode}`);
    ok('o detalhe traz o histórico de vendas',
      Array.isArray(detalhe.json().historicoVendas) && detalhe.json().historicoVendas.length === 2,
      `n=${detalhe.json().historicoVendas?.length}`);
    ok('o histórico traz a venda CANCELADA também (fato, não opinião)',
      detalhe.json().historicoVendas.some((v: any) => v.status === 'CANCELADA'),
      JSON.stringify(detalhe.json().historicoVendas.map((v: any) => v.status)));
    ok('o detalhe traz o valor total real', Number(detalhe.json().valorTotalComprado) === 200);

    // FLUXO COMPLETO: cadastrar -> vender -> conferir na listagem -> editar ->
    // arquivar -> desarquivar, sempre relendo do banco.
    const fimAFim = await req('POST', '/clientes', {
      nome: `Fluxo Completo ${SUFIXO}`, documento: `${CNPJ.slice(0, 13)}7`, status: 'ATIVO',
    });
    const novo = fimAFim.json();
    const vendaNovo = await req('POST', '/vendas', {
      filialId: filial.id, clienteId: novo.id, formaPagamento: 'DINHEIRO',
      itens: [{ produtoId: produto.id, quantidade: 1, desconto: 0 }],
    });
    // FASE 1 PDV PRO: POST /vendas devolve 201 Created (era 200).
    ok('fluxo: venda do cliente recém-criado -> 201', vendaNovo.statusCode === 201,
      `status=${vendaNovo.statusCode}`);
    const naListagem = (await req('GET', '/clientes')).json().find((c: any) => c.id === novo.id);
    ok('fluxo: o valor aparece na listagem logo após a venda',
      Number(naListagem?.valorTotalComprado) === 50, `valor=${naListagem?.valorTotalComprado}`);
    await req('PUT', `/clientes/${novo.id}`, { endereco: 'Rua Nova, 999' });
    ok('fluxo: a edição persiste e não mexe nos números',
      (await linha(novo.id))?.endereco === 'Rua Nova, 999'
      && Number((await linha(novo.id))?.valorTotalComprado) === 50);
    await req('PATCH', `/clientes/${novo.id}/status`, { status: 'ARQUIVADO' });
    ok('fluxo: arquivar persiste', (await linha(novo.id))?.status === 'ARQUIVADO');
    await req('PATCH', `/clientes/${novo.id}/status`, { status: 'ATIVO' });
    ok('fluxo: desarquivar persiste e volta para a listagem padrão',
      (await linha(novo.id))?.status === 'ATIVO'
      && (await req('GET', '/clientes')).json().some((c: any) => c.id === novo.id));
  } finally {
    const todas = [empresa.id, empresa2.id];
    await prisma.vendaItem.deleteMany({ where: { venda: { empresaId: { in: todas } } } });
    await prisma.financeiro.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.venda.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.indicadorDiario.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.estoqueMovimentacao.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.estoque.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.produto.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.cliente.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.filial.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.empresa.deleteMany({ where: { id: { in: todas } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: aba clientes', async () => {
  await main();
});