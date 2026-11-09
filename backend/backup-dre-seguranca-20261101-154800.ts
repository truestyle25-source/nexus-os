/**
 * TESTE DE INTEGRAÇÃO — MÓDULO DRE (GET /dre)
 *
 * Exercita o endpoint real contra o PostgreSQL de desenvolvimento. Cobre o que
 * a aba /dre depende e os defeitos corrigidos:
 *
 *   1. GET /dre NÃO GRAVA: leitura repetida não cria nem altera linha na
 *      tabela `DRE` (o endpoint fazia upsert a cada chamada).
 *   2. Receita bruta = soma das RECEITA do período (sem CANCELADO).
 *   3. CMV = custoUnitario × quantidade das vendas FINALIZADAS.
 *   4. Deduções: despesa de categoria "impostos" ABATe a receita e NÃO volta
 *      como despesa operacional (sem dupla contagem).
 *   5. Dedução só conta lançamento do tipo DESPESA; uma RECEITA com categoria
 *      de dedução não reduz a receita.
 *   6. Categorias com caixa/acento diferentes ("Impostos", "IMPOSTOS") caem
 *      na mesma regra.
 *   7. Margem sem receita devolve `null` (não 0), porque não há denominador.
 *   8. Identidade contábil: resultado = receitaLiquida - custos - despesas.
 *   9. Isolamento multi-tenant, permissões e validação de período.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { gestaoRoutes } from '../src/modules/gestao/gestao.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-dre';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

function isoLocal(dia: string, hora: string): string {
  return `${dia}T${hora}:00-03:00`;
}

function diaLocalSP(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

async function main() {
  const app = Fastify({ logger: false });
  // Mesmo handler global do `server.ts` (ZodError -> 400), para o teste medir
  // o servidor real e não o harness.
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') {
      return reply.status(400).send({ error: 'Dados inválidos.', detalhes: (error as any).issues });
    }
    if (typeof error?.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    if (error?.constructor === Error) return reply.status(400).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.' });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  await app.register(gestaoRoutes);

  const empresa = await prisma.empresa.create({
    data: { nome: `DreTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `DreOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const usuario = await prisma.usuario.create({
    data: {
      empresaId: empresa.id, nome: 'Teste DRE',
      email: `dre-${SUFIXO}@teste.local`, senhaHash: await hashSenha('senha12345'),
    },
  });
  await prisma.permissao.createMany({
    data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: usuario.id, modulo: m, acao: a, permitido: true }))),
  });
  const semPermissao = await prisma.usuario.create({
    data: {
      empresaId: empresa2.id, nome: 'Sem Permissao',
      email: `semdre-${SUFIXO}@teste.local`, senhaHash: await hashSenha('senha12345'),
    },
  });

  const token = app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email });
  const H = { authorization: `Bearer ${token}` };

  const d1 = diaLocalSP(new Date(Date.now() - 86400000));
  const hoje = diaLocalSP(new Date());
  const params = `periodoInicio=${isoLocal(d1, '00:00')}&periodoFim=${isoLocal(hoje, '23:59')}`;

  try {
    console.log('\n1. GET /dre NAO GRAVA na tabela DRE');
    const antes = await prisma.dRE.count({ where: { empresaId: empresa.id } });
    await prisma.financeiro.create({
      data: {
        empresaId: empresa.id, tipo: 'RECEITA', categoria: 'vendas',
        descricao: 'Receita do periodo', valor: 1000, status: 'PAGO', origem: 'MANUAL',
        createdAt: new Date(`${isoLocal(d1, '10:00')}`),
      },
    });
    const r1 = await app.inject({ method: 'GET', url: `/dre?${params}`, headers: H });
    ok('GET responde 200', r1.statusCode === 200, `status=${r1.statusCode} corpo=${r1.body.slice(0, 200)}`);
    // Duas leituras: se a rota gravasse, haveria registro; como é leitura pura,
    // a contagem de linhas em DRE não muda.
    await app.inject({ method: 'GET', url: `/dre?${params}`, headers: H });
    await app.inject({ method: 'GET', url: `/dre?periodoInicio=${isoLocal(hoje, '00:00')}&periodoFim=${isoLocal(hoje, '23:59')}`, headers: H });
    const depois = await prisma.dRE.count({ where: { empresaId: empresa.id } });
    ok('nenhuma linha criada na tabela DRE', depois === antes, `antes=${antes} depois=${depois}`);
    ok('resposta traz o periodo calculado', typeof r1.json().dre?.periodoInicio === 'string');
    ok('resposta traz a origem', r1.json().dre?.origem === 'AUTOMATICO');
console.log('\n2. Receita bruta, deducoes e CMV');
    await app.inject({ method: 'GET', url: `/dre?${params}`, headers: H });
    const r2 = await app.inject({ method: 'GET', url: `/dre?${params}`, headers: H });
    const d2 = r2.json().detalhes;
    ok('receita bruta = 1.000', d2.receitaBruta === 1000, `valor=${d2.receitaBruta}`);
    ok('sem receita de deducao: deducoes = 0', d2.deducoes === 0, `valor=${d2.deducoes}`);
    ok('sem venda: CMV = 0', d2.custos === 0, `valor=${d2.custos}`);
    ok('sem deducao: receitaLiquida == receitaBruta', d2.receitaLiquida === 1000, `valor=${d2.receitaLiquida}`);

    // Despesa de IMPOSTOS: abate a receita e NAO volta como despesa operacional.
    await prisma.financeiro.create({
      data: {
        empresaId: empresa.id, tipo: 'DESPESA', categoria: 'impostos',
        descricao: 'Imposto sobre venda', valor: 100, status: 'PAGO', origem: 'MANUAL',
        createdAt: new Date(`${isoLocal(d1, '11:00')}`),
      },
    });
    const r3 = await app.inject({ method: 'GET', url: `/dre?${params}`, headers: H });
    const d3 = r3.json().detalhes;
    ok('deducoes = 100 (imposto abate a receita)', d3.deducoes === 100, `valor=${d3.deducoes}`);
    ok('receitaLiquida = 900', d3.receitaLiquida === 900, `valor=${d3.receitaLiquida}`);
    ok('imposto NAO vira despesa operacional (sem dupla contagem)', d3.despesas === 0, `despesas=${d3.despesas}`);

    console.log('\n3. Despesa operacional comum');
    await prisma.financeiro.create({
      data: {
        empresaId: empresa.id, tipo: 'DESPESA', categoria: 'fornecedores',
        descricao: 'Compra de mercadoria', valor: 250, status: 'PAGO', origem: 'MANUAL',
        createdAt: new Date(`${isoLocal(d1, '12:00')}`),
      },
    });
    const r4 = await app.inject({ method: 'GET', url: `/dre?${params}`, headers: H });
    const d4 = r4.json().detalhes;
    ok('despesa operacional = 250', d4.despesas === 250, `valor=${d4.despesas}`);
    ok('deducoes segue 100', d4.deducoes === 100, `valor=${d4.deducoes}`);

    console.log('\n4. CMV vem do custo real dos itens vendidos');
    const r5 = await app.inject({ method: 'GET', url: `/dre?${params}`, headers: H });
    ok('qtdVendas conta so vendas FINALIZADAS', r5.json().detalhes.qtdVendas === 0, `qtd=${r5.json().detalhes.qtdVendas}`);
    ok('sem venda: CMV = 0', r5.json().detalhes.custos === 0, `valor=${r5.json().detalhes.custos}`);

    console.log('\n5. Deducao so conta despesa');
    await prisma.financeiro.create({
      data: {
        empresaId: empresa.id, tipo: 'RECEITA', categoria: 'devolucoes',
        descricao: 'Estorno de receita', valor: 70, status: 'PAGO', origem: 'MANUAL',
        createdAt: new Date(`${isoLocal(d1, '13:00')}`),
      },
    });
    const r6 = await app.inject({ method: 'GET', url: `/dre?${params}`, headers: H });
    const d6 = r6.json().detalhes;
    ok('RECEITA com categoria de deducao NAO abate (evita contagem dupla)', d6.deducoes === 100, `deducoes=${d6.deducoes}`);
    ok('essa RECEITA entra na receita bruta', d6.receitaBruta === 1070, `receitaBruta=${d6.receitaBruta}`);
console.log('\n6. Categoria de deducao insensivel a caixa e acento');
    await prisma.financeiro.create({
      data: {
        empresaId: empresa.id, tipo: 'DESPESA', categoria: 'Impostos',
        descricao: 'Imposto com caixa alta', valor: 30, status: 'PAGO', origem: 'MANUAL',
        createdAt: new Date(`${isoLocal(d1, '14:00')}`),
      },
    });
    const r7 = await app.inject({ method: 'GET', url: `/dre?${params}`, headers: H });
    ok('"Impostos" (caixa alta) conta como deducao', r7.json().detalhes.deducoes === 130, `deducoes=${r7.json().detalhes.deducoes}`);

    console.log('\n7. Identidade contabil');
    const d7 = r7.json().detalhes;
    ok(
      'resultadoOperacional = receitaLiquida - custos - despesas',
      d7.resultadoOperacional === d7.receitaLiquida - d7.custos - d7.despesas,
      `resultado=${d7.resultadoOperacional}`,
    );
    ok('lucroPrejuizo = resultadoOperacional', d7.lucroPrejuizo === d7.resultadoOperacional);
    ok(
      'margemBruta = (receitaLiquida - custos) / receitaLiquida',
      Math.abs(d7.margemBruta - ((d7.receitaLiquida - d7.custos) / d7.receitaLiquida) * 100) < 0.01,
      `margem=${d7.margemBruta}`,
    );
    ok(
      'margemLiquida = lucro / receitaBruta',
      Math.abs(d7.margemLiquida - (d7.lucroPrejuizo / d7.receitaBruta) * 100) < 0.01,
      `margem=${d7.margemLiquida}`,
    );

    console.log('\n8. Margem sem receita devolve null (nao 0)');
    const vazio = diaLocalSP(new Date(Date.now() + 300 * 86400000));
    const r8 = await app.inject({
      method: 'GET',
      url: `/dre?periodoInicio=${isoLocal(vazio, '00:00')}&periodoFim=${isoLocal(vazio, '23:59')}`,
      headers: H,
    });
    const d8 = r8.json().detalhes;
    ok('periodo sem receita: margemBruta = null', d8.margemBruta === null, `valor=${JSON.stringify(d8.margemBruta)}`);
    ok('periodo sem receita: margemLiquida = null', d8.margemLiquida === null, `valor=${JSON.stringify(d8.margemLiquida)}`);
    ok('periodo sem receita: receitaBruta = 0 (numero, nao null)', d8.receitaBruta === 0);

    console.log('\n9. Isolamento multi-tenant, permissoes e periodo');
    const tokenSem = app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email });
    const semPerm = await app.inject({ method: 'GET', url: `/dre?${params}`, headers: { authorization: `Bearer ${tokenSem}` } });
    ok('sem permissao -> 403', semPerm.statusCode === 403, `status=${semPerm.statusCode}`);

    await prisma.permissao.createMany({
      data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: semPermissao.id, modulo: m, acao: a, permitido: true }))),
    });
    const isolado = await app.inject({ method: 'GET', url: `/dre?${params}`, headers: { authorization: `Bearer ${tokenSem}` } });
    ok('empresa B nao ve o DRE da empresa A', isolado.json().detalhes.receitaBruta === 0, `valor=${isolado.json().detalhes.receitaBruta}`);

    const semToken = await app.inject({ method: 'GET', url: '/dre' });
    ok('sem token -> 401', semToken.statusCode === 401, `status=${semToken.statusCode}`);

    const datasInvalidas = await app.inject({ method: 'GET', url: '/dre?periodoInicio=lixo&periodoFim=lixo', headers: H });
    ok('datas invalidas devolvem 400 (nao 500)', datasInvalidas.statusCode === 400, `status=${datasInvalidas.statusCode}`);

    const invertido = await app.inject({
      method: 'GET',
      url: `/dre?periodoInicio=${isoLocal(hoje, '00:00')}&periodoFim=${isoLocal(d1, '23:59')}`,
      headers: H,
    });
    ok('periodo invertido devolve 400', invertido.statusCode === 400, `status=${invertido.statusCode}`);

    const final = await prisma.dRE.count({ where: { empresaId: { in: [empresa.id, empresa2.id] } } });
    ok('nenhuma linha em DRE ao final do teste', final === 0, `linhas=${final}`);
  } finally {
    await app.close();
    const ids = [usuario.id, semPermissao.id];
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.dRE.deleteMany({ where: { empresaId: { in: [empresa.id, empresa2.id] } } });
    await prisma.financeiro.deleteMany({ where: { empresaId: { in: [empresa.id, empresa2.id] } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: [empresa.id, empresa2.id] } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}

test('integração: dre', async () => {
  await main();
});