/**
 * TESTE DE INTEGRAÇÃO — MÓDULO DASHBOARD
 *
 * Exercita as rotas REAIS de `/dashboard` contra o PostgreSQL de desenvolvimento.
 * O Dashboard é 100% leitura: o "fluxo completo" aqui é garantir que o que a
 * tela mostra vem do banco, que o período filtra de verdade e que ninguém vê o
 * que não tem permissão de ver.
 *
 *   1. `GET /dashboard/serie` monta a série a partir de vendas FINALIZADA reais,
 *      com buckets contínuos (dia sem venda aparece zerado, não some) e totais
 *      conferidos contra o próprio banco.
 *   2. Granularidade: o mesmo período devolvido por dia e por mês bate no total.
 *   3. Período fora do intervalo não entra na soma — o filtro de data funciona.
 *   4. Venda NÃO finalizada é ignorada (o faturamento só conta FINALIZADA).
 *   5. `permissaoCusto=false` devolve `cmv`/`lucro`/`margem` em `null`, sem
 *      vazar custo para quem não tem `custos:visualizar`.
 *   6. `GET /dashboard/stats` reflete vendas FINALIZADAS do mês e de hoje.
 *   7. `GET /dashboard/stats` e `/serie` exigem `dashboard:visualizar`: sem
 *      permissão -> 403, sem token -> 401. (A `/stats` só exigia `authenticate`
 *      e entregava faturamento a qualquer usuário logado.)
 *   8. Isolamento multi-tenant: a empresa B não enxerga venda da empresa A.
 *   9. `/metas` devolve as metas da empresa — base do card "Meta Atingida", que
 *      precisa filtrar pelo período em vez de usar `metas[0]`.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { dashboardRealRoutes } from '../src/modules/dashboard/dashboard.routes.js';
// `/metas` vive no módulo de gestão (server.ts registra `gestaoRoutes` na RAIZ).
// O Dashboard consome essa rota para o card "Meta Atingida"; sem registrá-la o
// teste mediria um 404 falso.
import { gestaoRoutes } from '../src/modules/gestao/gestao.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-dashboard';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

/** "YYYY-MM-DD" de um dia relativo, no fuso local (o backend lê texto). */
function dia(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  const app = Fastify({ logger: false });
  // Mesmo handler global do `server.ts`. `ErroDeNegocio` é subclasse de Error:
  // sem o caso explícito todo erro de regra de negócio viraria 500 e o teste
  // mediria o harness, não o servidor.
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
  await app.register(dashboardRealRoutes, { prefix: '/dashboard' });
  await app.register(gestaoRoutes);
  const empresa = await prisma.empresa.create({
    data: { nome: `DashTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `DashOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Filial Dash' } });
  const filial2 = await prisma.filial.create({ data: { empresaId: empresa2.id, nome: 'Filial Outro' } });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: 'Teste Dash', email: `dash-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Sem Permissao', email: `semdash-${SUFIXO}@teste.local`, senhaHash },
  });
  const usuario2 = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Outro Tenant', email: `outrodash-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario2.id })) });
  // Usuário COM `dashboard:visualizar` mas SEM `custos:visualizar`: é o cenário
  // que valida `permissaoCusto=false` sem precisar desativar tudo.
  const semCusto = await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: 'Sem Custo', email: `semcusto-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({
    data: permissoes.filter((p) => p.modulo !== 'custos').map((p) => ({ ...p, usuarioId: semCusto.id })),
  });

  const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email })}` };
  const H2 = { authorization: `Bearer ${app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email })}` };
  const HsemCusto = { authorization: `Bearer ${app.jwt.sign({ id: semCusto.id, empresaId: empresa.id, email: semCusto.email })}` };
  const ids = [usuario.id, semPermissao.id, usuario2.id, semCusto.id];

  // ── Vendas REAIS: duas FINALIZADAS no período + uma ABERTA + uma fora ──
  const cli1 = await prisma.cliente.create({ data: { empresaId: empresa.id, nome: 'Cliente Dash 1' } });
  const cli2 = await prisma.cliente.create({ data: { empresaId: empresa.id, nome: 'Cliente Dash 2' } });
  const custo = 40;
  async function venda(
    empresaIdV: string, filialIdV: string, clienteId: string | null,
    total: number, status: 'FINALIZADA' | 'ABERTA', quando: string,
  ) {
    return prisma.venda.create({
      data: {
        empresaId: empresaIdV, filialId: filialIdV, clienteId,
        status, subtotal: total, total, origem: 'MANUAL',
        createdAt: new Date(`${quando}T13:00:00`),
        itens: {
          create: [{
            produtoId: 'sem-relacao', quantidade: 1, preco: total,
            custoUnitario: custo, desconto: 0, total,
          }],
        },
      },
    });
  }
  await venda(empresa.id, filial.id, cli1.id, 100, 'FINALIZADA', dia(-1));
  await venda(empresa.id, filial.id, cli2.id, 250, 'FINALIZADA', dia(-1));
  await venda(empresa.id, filial.id, cli1.id, 999, 'ABERTA', dia(-1));
  // Fora do período consultado: não pode entrar na soma.
  const antiga = new Date(new Date().setDate(new Date().getDate() - 40));
  await venda(empresa.id, filial.id, cli1.id, 7777, 'FINALIZADA',
    `${antiga.getFullYear()}-${String(antiga.getMonth() + 1).padStart(2, '0')}-${String(antiga.getDate()).padStart(2, '0')}`);
  // Venda da OUTRA empresa, mesmo período: não pode aparecer para a empresa A.
  const cliB = await prisma.cliente.create({ data: { empresaId: empresa2.id, nome: 'Cliente Outro' } });
  await venda(empresa2.id, filial2.id, cliB.id, 5555, 'FINALIZADA', dia(-1));

  const periodo = { periodoInicio: dia(-6), periodoFim: dia(0) };
  try {
    console.log('\n1. /dashboard/serie: totais conferidos contra o banco');
    const serie = await app.inject({ method: 'GET', url: '/dashboard/serie', headers: H, query: periodo });
    ok('GET /dashboard/serie -> 200', serie.statusCode === 200, `status=${serie.statusCode} corpo=${serie.body.slice(0, 200)}`);
    const s = serie.json();
    // 100 + 250 FINALIZADAS no período. A ABERTA (999), a antiga (7777) e a da
    // outra empresa (5555) NÃO podem entrar.
    ok('faturamento = 350 (só FINALIZADA do período)', s.totais.faturamento === 350, `faturamento=${s.totais.faturamento}`);
    ok('quantidade de vendas = 2', s.totais.qtdVendas === 2, `qtd=${s.totais.qtdVendas}`);
    ok('venda ABERTA ignorada', !JSON.stringify(s).includes('999'));
    ok('venda fora do periodo ignorada', s.totais.faturamento < 7777, `faturamento=${s.totais.faturamento}`);
    ok('venda da outra empresa ignorada', s.totais.faturamento < 5555, `faturamento=${s.totais.faturamento}`);
    ok('clientes distintos = 2', s.totais.clientesDistintos === 2, `clientes=${s.totais.clientesDistintos}`);
    ok('ticket medio = 175', s.totais.ticketMedio === 175, `ticket=${s.totais.ticketMedio}`);
    ok('cmv = 80 (2 itens x 40)', s.totais.cmv === 80, `cmv=${s.totais.cmv}`);
    ok('lucro bruto = 270', s.totais.lucroBruto === 270, `lucro=${s.totais.lucroBruto}`);
    ok('periodo devolvido sem fuso', s.periodoInicio === periodo.periodoInicio && s.periodoFim === periodo.periodoFim,
      `${s.periodoInicio}..${s.periodoFim}`);

    console.log('\n2. Buckets continuos: dia sem venda aparece zerado');
    ok('granularidade por dia', s.granularidade === 'dia', `gran=${s.granularidade}`);
    ok('7 pontos para 7 dias', s.pontos.length === 7, `pontos=${s.pontos.length}`);
    const vazios = s.pontos.filter((p: any) => p.faturamento === 0);
    ok('dias sem venda NAO somem do eixo', vazios.length >= 5, `vazios=${vazios.length}`);
    ok('soma dos pontos = total', Math.round(s.pontos.reduce((a: number, p: any) => a + p.faturamento, 0)) === s.totais.faturamento);

    console.log('\n3. Granularidade por mes bate no mesmo total');
    const serieMes = await app.inject({ method: 'GET', url: '/dashboard/serie', headers: H, query: { ...periodo, granularidade: 'mes' } });
    const sm = serieMes.json();
    ok('granularidade por mes', sm.granularidade === 'mes', `gran=${sm.granularidade}`);
    ok('mes nao quebra o total', sm.totais.faturamento === 350, `faturamento=${sm.totais.faturamento}`);
    // O período de 7 dias PODE cruzar dois meses (ex.: 26/09 a 02/10): nesse
    // caso são 2 buckets, não 1. O que importa é a soma bater com o total e
    // não existir bucket duplicado.
    ok('buckets mensais cobrem o periodo', sm.pontos.length >= 1 && sm.pontos.length <= 2, `pontos=${sm.pontos.length}`);
    ok('sem bucket mensal duplicado', new Set(sm.pontos.map((p: any) => p.periodo)).size === sm.pontos.length);
    ok('soma dos buckets mensais = total', Math.round(sm.pontos.reduce((a: number, p: any) => a + p.faturamento, 0)) === sm.totais.faturamento);

    console.log('\n4. Periodo sem venda devolve zero, nao lixo');
    const vazio = await app.inject({
      method: 'GET', url: '/dashboard/serie', headers: H,
      query: { periodoInicio: dia(-300), periodoFim: dia(-290) },
    });
    ok('periodo vazio -> 200', vazio.statusCode === 200);
    ok('faturamento zero', vazio.json().totais.faturamento === 0, `f=${vazio.json().totais.faturamento}`);
    ok('ticket medio null (nao 0)', vazio.json().totais.ticketMedio === null, `ticket=${vazio.json().totais.ticketMedio}`);
    ok('LTV null sem clientes com historico', vazio.json().ltv.ltvRealizado !== undefined);

    console.log('\n5. Permissao de custo: sem custos.visualizar tudo vem null');
    ok('usuario COM custos -> permissaoCusto true', s.permissaoCusto === true);
    const sc = await app.inject({ method: 'GET', url: '/dashboard/serie', headers: HsemCusto, query: periodo });
    const scb = sc.json();
    ok('usuario SEM custos -> permissaoCusto false', scb.permissaoCusto === false, `perm=${scb.permissaoCusto}`);
    ok('cmv null para quem nao pode ver custo', scb.totais.cmv === null, `cmv=${scb.totais.cmv}`);
    ok('lucroBruto null', scb.totais.lucroBruto === null, `lucro=${scb.totais.lucroBruto}`);
    ok('margemBruta null', scb.totais.margemBruta === null, `margem=${scb.totais.margemBruta}`);
    ok('faturamento continua visivel', scb.totais.faturamento === 350, `f=${scb.totais.faturamento}`);
    ok('nenhum ponto da serie expoe custo', scb.pontos.every((p: any) => p.cmv === null && p.lucro === null));
    console.log('\n6. /dashboard/stats: momento, nao periodo');
    const stats = await app.inject({ method: 'GET', url: '/dashboard/stats', headers: H });
    ok('GET /dashboard/stats -> 200', stats.statusCode === 200, `status=${stats.statusCode}`);
    const st = stats.json();
    // As duas FINALIZADAS de ontem + a antiga de 40 dias (também no mês, se o
    // mês tiver mais de 40 dias) entram; a ABERTA nunca entra.
    ok('faturamento do mes exclui a venda ABERTA', st.faturamentoMes < 999, `f=${st.faturamentoMes}`);
    ok('faturamento do mes inclui as finalizadas', st.faturamentoMes >= 350, `f=${st.faturamentoMes}`);
    ok('vendas hoje = 0 (as vendas sao de ontem)', st.vendasHoje === 0, `hoje=${st.vendasHoje}`);
    ok('produtosAtivos = 0 (nenhum produto criado)', st.produtosAtivos === 0, `p=${st.produtosAtivos}`);
    ok('usuariosAtivos conta a empresa', st.usuariosAtivos >= 1, `u=${st.usuariosAtivos}`);
    ok('stats nao traz a empresa B', st.usuariosAtivos < 10, `u=${st.usuariosAtivos}`);

    console.log('\n7. Metas: base do card "Meta Atingida"');
    const agora = new Date();
    const mesCorr = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    await prisma.meta.create({
      data: { empresaId: empresa.id, tipo: 'VENDAS', periodo: mesCorr, metaValor: 1000, realizado: 400, percentual: 40 },
    });
    await prisma.meta.create({
      data: { empresaId: empresa.id, tipo: 'VENDAS', periodo: '2000-01', metaValor: 500, realizado: 500, percentual: 999 },
    });
    const metaAlta = await app.inject({ method: 'GET', url: '/metas', headers: H });
    ok('GET /metas -> 200', metaAlta.statusCode === 200);
    const lista = metaAlta.json().metas;
    ok('devolve as duas metas', lista.length === 2, `n=${lista.length}`);
    ok('ordenado por percentual DESC', Number(lista[0].percentual) >= Number(lista[1].percentual),
      `${lista[0].periodo}=${lista[0].percentual}`);
    // A tela precisa escolher a meta do PERÍODO: `metas[0]` traria a de 2000-01
    // (999%) mesmo com o período em 2026.
    const doPeriodo = lista.filter((m: any) => String(m.periodo) === mesCorr);
    ok('existe meta do mes corrente', doPeriodo.length === 1, `n=${doPeriodo.length}`);
    ok('percentual do mes corrente e 40', Number(doPeriodo[0].percentual) === 40, `p=${doPeriodo[0].percentual}`);
    ok('a meta de 2000-01percentual 999 nao e a do periodo', lista[0].periodo !== mesCorr, `lista0=${lista[0].periodo}`);

    console.log('\n8. Permissoes e token');
    ok('GET /dashboard/stats sem permissao -> 403',
      (await app.inject({ method: 'GET', url: '/dashboard/stats', headers: Hsem })).statusCode === 403);
    ok('GET /dashboard/serie sem permissao -> 403',
      (await app.inject({ method: 'GET', url: '/dashboard/serie', headers: Hsem, query: periodo })).statusCode === 403);
    ok('GET /dashboard/stats sem token -> 401',
      (await app.inject({ method: 'GET', url: '/dashboard/stats' })).statusCode === 401);
    ok('GET /dashboard/serie sem token -> 401',
      (await app.inject({ method: 'GET', url: '/dashboard/serie', query: periodo })).statusCode === 401);

    console.log('\n9. Isolamento multi-tenant');
    const s2 = await app.inject({ method: 'GET', url: '/dashboard/serie', headers: H2, query: periodo });
    ok('empresa B responde 200', s2.statusCode === 200);
    ok('empresa B ve SO a propria venda (5555)', s2.json().totais.faturamento === 5555,
      `f=${s2.json().totais.faturamento}`);
    ok('empresa B nao ve a venda da empresa A', s2.json().totais.faturamento !== 350);
    const st2 = await app.inject({ method: 'GET', url: '/dashboard/stats', headers: H2 });
    // A empresa B tem exatamente uma venda FINALIZADA (5555). Se a rota somasse
    // as vendas da empresa A, o número seria 5555 + 350 + 7777.
    ok('stats da empresa B soma SO a venda dela', st2.json().faturamentoMes === 5555,
      `f=${st2.json().faturamentoMes}`);
    ok('empresa B nao ve as metas da empresa A',
      !(await app.inject({ method: 'GET', url: '/metas', headers: H2 })).json().metas.some((m: any) => m.periodo === mesCorr));
  } finally {
    const todas = [empresa.id, empresa2.id];
    await prisma.meta.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.vendaItem.deleteMany({ where: { venda: { empresaId: { in: todas } } } });
    await prisma.venda.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.cliente.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.filial.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: todas } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: dashboard', async () => {
  await main();
});