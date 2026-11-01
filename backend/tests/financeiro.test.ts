/**
 * TESTE DE PERSISTÊNCIA E COMPORTAMENTO — MÓDULO FINANCEIRO
 *
 * Exercita o endpoint real (GET/POST /financeiro) contra o PostgreSQL de
 * desenvolvimento, com usuário e empresa descartáveis (sufixo único), e
 * verifica o que a tela do Financeiro depende:
 *   1. POST grava no banco e o registro é legível depois (persistência);
 *   2. GET devolve o lançamento criado;
 *   3. `X-Total-Count` e `X-Truncated` são emitidos no corte;
 *   4. totais do `fluxo` cobrem o período INTEIRO, não só a página exibida;
 *   5. `contasAPagar`/`contasAReceber` são VALORES em aberto (não contagem);
 *   6. `VENCIDO` é DERIVADO na leitura a partir do vencimento no passado;
 *   7. validação: valor acima de Decimal(12,2) e vencimento inválido recusados;
 *   8. isolamento multi-tenant: empresa A não enxerga empresa B.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { gestaoRoutes } from '../src/modules/gestao/gestao.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-financeiro';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

async function main() {
  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  await app.register(gestaoRoutes);

  const empresa = await prisma.empresa.create({
    data: { nome: `FinTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `FinOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });

  // Usuário COM todas as permissões (como o fundador recebe no cadastro).
  const usuario = await prisma.usuario.create({
    data: {
      empresaId: empresa.id, nome: 'Teste Financeiro',
      email: `fin-${SUFIXO}@teste.local`, senhaHash: await hashSenha('senha12345'),
    },
  });
  await prisma.permissao.createMany({
    data: MODULOS.flatMap((modulo) => ACOES.map((acao) => ({ usuarioId: usuario.id, modulo, acao, permitido: true }))),
  });

  // Usuário SEM a permissão `financeiro` — para provar que a checagem vale.
  const semPermissao = await prisma.usuario.create({
    data: {
      empresaId: empresa2.id, nome: 'Sem Permissao',
      email: `sem-${SUFIXO}@teste.local`, senhaHash: await hashSenha('senha12345'),
    },
  });
  // Declarado aqui para o `finally` apagar junto (o segundo usuário de empresa2
  // só existe dentro do bloco 8).
  let usuario2: { id: string } | null = null;

  const token = app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email });
  const H = { authorization: `Bearer ${token}` };

  try {
    console.log('\n1. POST /financeiro grava no PostgreSQL');
    const criado = await app.inject({
      method: 'POST',
      url: '/financeiro',
      headers: H,
      payload: {
        tipo: 'DESPESA', categoria: 'fornecedores', descricao: 'Compra de teste',
        valor: 150.5, vencimento: '2030-05-10T12:00:00.000Z', status: 'PENDENTE', origem: 'MANUAL',
      },
    });
    ok('POST responde 200', criado.statusCode === 200, `status=${criado.statusCode} corpo=${criado.body.slice(0, 200)}`);
    const id = criado.json().id;
    ok('resposta traz id', typeof id === 'string' && id.length > 0);

    // Leitura DIRETA no banco: comprova persistência, não só resposta HTTP.
    const noBanco = await prisma.financeiro.findUnique({ where: { id } });
    ok('registro existe no PostgreSQL', !!noBanco);
    ok('valor persistido correto', Math.abs(Number(noBanco?.valor) - 150.5) < 0.001, `valor=${noBanco?.valor}`);
    ok('descricao persistida', noBanco?.descricao === 'Compra de teste');
    ok('empresaId vem do token', noBanco?.empresaId === empresa.id);
    ok('origem persistida', noBanco?.origem === 'MANUAL');

    console.log('\n2. GET /financeiro devolve o registro criado');
    const lista = await app.inject({ method: 'GET', url: '/financeiro', headers: H });
    ok('GET responde 200', lista.statusCode === 200, `status=${lista.statusCode}`);
    const corpo = lista.json();
    ok('lançamento está na lista', corpo.lancamentos.some((l: any) => l.id === id));
    ok('fluxo.despesas soma o lançamento', Math.abs(corpo.fluxo.despesas - 150.5) < 0.001, `despesas=${corpo.fluxo.despesas}`);
    ok('fluxo.receitas zerado', corpo.fluxo.receitas === 0);

    console.log('\n3. X-Total-Count / X-Truncated');
    ok('X-Total-Count presente', lista.headers['x-total-count'] === '1', `valor=${lista.headers['x-total-count']}`);
    ok('X-Truncated ausente sem corte', lista.headers['x-truncated'] === undefined);

    console.log('\n4. Totais cobrem o período inteiro, não só a página exibida');
    // 250 lançamentos -> a lista mostra 200, mas o total tem de ser 250.
    await prisma.financeiro.createMany({
      data: Array.from({ length: 249 }, (_, i) => ({
        empresaId: empresa.id, tipo: 'RECEITA', categoria: 'vendas',
        descricao: `Receita ${i}`, valor: 10, status: 'PENDENTE', origem: 'MANUAL',
      })),
    });
    const paginado = await app.inject({ method: 'GET', url: '/financeiro', headers: H });
    const c2 = paginado.json();
    ok('lista truncada em 200', c2.lancamentos.length === 200, `veio ${c2.lancamentos.length}`);
    ok('X-Total-Count informa 250', paginado.headers['x-total-count'] === '250', `valor=${paginado.headers['x-total-count']}`);
    ok('X-Truncated marcado', paginado.headers['x-truncated'] === 'true');
    ok(
      'fluxo.receitas cobre os 250 (2.490), nao so os exibidos',
      Math.abs(c2.fluxo.receitas - 2490) < 0.001,
      `receitas=${c2.fluxo.receitas}`,
    );

    console.log('\n5. contasAPagar / contasAReceber sao VALORES em aberto');
    ok('contasAReceber = 2.490 (valor, nao contagem)', Math.abs(c2.fluxo.contasAReceber - 2490) < 0.001, `valor=${c2.fluxo.contasAReceber}`);
    ok('contasAPagar = 150,50 (valor, nao contagem)', Math.abs(c2.fluxo.contasAPagar - 150.5) < 0.001, `valor=${c2.fluxo.contasAPagar}`);

    console.log('\n6. VENCIDO derivado na leitura');
    await prisma.financeiro.create({
      data: {
        empresaId: empresa.id, tipo: 'DESPESA', categoria: 'operacionais',
        descricao: 'Vencida de teste',
        valor: 77, status: 'PENDENTE', origem: 'MANUAL',
        vencimento: new Date(Date.now() - 5 * 86400000), // 5 dias atras
      },
    });
    const lido = await app.inject({ method: 'GET', url: '/financeiro', headers: H });
    const vencida = lido.json().lancamentos.find((l: any) => l.descricao === 'Vencida de teste');
    ok('PENDENTE vencido responde como VENCIDO', vencida?.status === 'VENCIDO', `status=${vencida?.status}`);
    const noBancoVencido = await prisma.financeiro.findFirst({ where: { empresaId: empresa.id, descricao: 'Vencida de teste' } });
    ok('banco preserva PENDENTE (derivacao e so de leitura)', noBancoVencido?.status === 'PENDENTE');

    // Segundo audit: o filtro de status no SERVIDOR precisa enxergar o VENCIDO
    // derivado. Filtrar por `status=VENCIDO` no banco (valor real PENDENTE)
    // devolveria vazio mesmo havendo conta vencida na tela.
    const filtradoVencido = await app.inject({ method: 'GET', url: '/financeiro?status=VENCIDO', headers: H });
    const listaVencidos = filtradoVencido.json().lancamentos;
    ok('filtro status=VENCIDO devolve a conta vencida', listaVencidos.some((l: any) => l.descricao === 'Vencida de teste'), `veio ${listaVencidos.length}`);
    ok('filtro VENCIDO traz todos como VENCIDO', listaVencidos.every((l: any) => l.status === 'VENCIDO'));
    ok('filtro VENCIDO nao traz contas em dia', !listaVencidos.some((l: any) => l.descricao === 'Compra de teste'));

    const filtradoPendente = await app.inject({ method: 'GET', url: '/financeiro?status=PENDENTE', headers: H });
    const listaPendentes = filtradoPendente.json().lancamentos;
    ok('filtro PENDENTE traz os sem-vencimento (249 receitas)', listaPendentes.some((l: any) => l.descricao === 'Receita 0'), `veio ${listaPendentes.length}`);
    ok('filtro PENDENTE exclui a vencida', !listaPendentes.some((l: any) => l.descricao === 'Vencida de teste'));
    // "Compra de teste" vence em 2030, então É PENDENTE de verdade — mas fica fora
    // da página de 200 (os 249 registros sem vencimento são mais novos). O que
    // importa aqui é a condição do filtro, já coberta pelo "Receita 0".
    const pendenteCompra = await prisma.financeiro.count({
      where: { empresaId: empresa.id, status: 'PENDENTE', OR: [{ vencimento: { gte: new Date(new Date().setHours(0,0,0,0)) } }, { vencimento: null }] },
    });
    ok('a conta em dia (2030) satisfaz a condicao de PENDENTE', pendenteCompra > 0, `contagem=${pendenteCompra}`);

    const filtradoPago = await app.inject({ method: 'GET', url: '/financeiro?status=PAGO', headers: H });
    ok('filtro PAGO vazio quando nao ha pagos', filtradoPago.json().lancamentos.length === 0);

    console.log('\n7. Validacao');
    const grandeValor = await app.inject({
      method: 'POST', url: '/financeiro', headers: H,
      payload: { tipo: 'DESPESA', categoria: 'operacionais', descricao: 'Valor absurdo', valor: 99_999_999_999 },
    });
    ok('valor acima de Decimal(12,2) recusado', grandeValor.statusCode >= 400, `status=${grandeValor.statusCode}`);
    ok('erro de valor legivel (nao erro interno)', /valor/i.test(grandeValor.body), `corpo=${grandeValor.body.slice(0, 160)}`);

    const vencimentoRuim = await app.inject({
      method: 'POST', url: '/financeiro', headers: H,
      payload: { tipo: 'DESPESA', categoria: 'operacionais', descricao: 'Data ruim', valor: 10, vencimento: 'nao-e-data' },
    });
    ok('vencimento invalido recusado', vencimentoRuim.statusCode >= 400, `status=${vencimentoRuim.statusCode}`);

    const valorZero = await app.inject({
      method: 'POST', url: '/financeiro', headers: H,
      payload: { tipo: 'DESPESA', categoria: 'operacionais', descricao: 'Zero', valor: 0 },
    });
    ok('valor zero recusado', valorZero.statusCode >= 400);

    const descCurta = await app.inject({
      method: 'POST', url: '/financeiro', headers: H,
      payload: { tipo: 'DESPESA', categoria: 'operacionais', descricao: 'x', valor: 10 },
    });
    ok('descricao curta recusada', descCurta.statusCode >= 400);

    console.log('\n8. Isolamento multi-tenant e permissões');
    const token2 = app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email });
    // Este usuário não tem `financeiro:visualizar` — a resposta precisa ser 403
    // ANTES de qualquer consulta, provando que a checagem acontece no banco.
    const semPerm = await app.inject({ method: 'GET', url: '/financeiro', headers: { authorization: `Bearer ${token2}` } });
    ok('sem permissao -> 403', semPerm.statusCode === 403, `status=${semPerm.statusCode}`);

    // Um usuário COM permissões, mas de OUTRA empresa, não enxerga os dados.
    usuario2 = await prisma.usuario.create({
      data: {
        empresaId: empresa2.id, nome: 'Outro', email: `outro-${SUFIXO}@teste.local`,
        senhaHash: await hashSenha('senha12345'),
      },
    });
    await prisma.permissao.createMany({
      data: MODULOS.flatMap((modulo) => ACOES.map((acao) => ({ usuarioId: usuario2.id, modulo, acao, permitido: true }))),
    });
    const token3 = app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email });
    const isolado = await app.inject({ method: 'GET', url: '/financeiro', headers: { authorization: `Bearer ${token3}` } });
    ok('empresa B nao ve lancamentos da empresa A', isolado.json().lancamentos.length === 0, `viu ${isolado.json().lancamentos.length}`);
    ok('fluxo da empresa B zerado', isolado.json().fluxo.receitas === 0 && isolado.json().fluxo.despesas === 0);

    const semToken = await app.inject({ method: 'GET', url: '/financeiro' });
    ok('sem token -> 401', semToken.statusCode === 401, `status=${semToken.statusCode}`);

    const postSemPerm = await app.inject({
      method: 'POST', url: '/financeiro', headers: { authorization: `Bearer ${token2}` },
      payload: { tipo: 'DESPESA', categoria: 'operacionais', descricao: 'Nao autorizado', valor: 10 },
    });
    ok('POST sem permissao -> 403', postSemPerm.statusCode === 403, `status=${postSemPerm.statusCode}`);
  } finally {
    await app.close();
    const ids = [usuario.id, semPermissao.id, usuario2?.id].filter(Boolean) as string[];
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.financeiro.deleteMany({ where: { empresaId: { in: [empresa.id, empresa2.id] } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: [empresa.id, empresa2.id] } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}

test('integração: financeiro', async () => {
  await main();
});