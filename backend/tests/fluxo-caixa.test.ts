/**
 * TESTE DE INTEGRAÇÃO — MÓDULO FLUXO DE CAIXA (GET /fluxo-caixa)
 *
 * Exercita o endpoint real contra o PostgreSQL de desenvolvimento, com
 * usuário/empresa descartáveis. O que a aba /fluxo depende de estar certo:
 *
 *   1. Série DIÁRIA agrupada pelo dia LOCAL da empresa (não o dia UTC): um
 *      lançamento às 22h de São Paulo tem de aparecer no dia 19, e não no 20.
 *   2. `saldoAcumulado` é a soma corrida da série e termina igual ao
 *      `resumo.saldo`.
 *   3. `resumo` soma só o que é PAGO e está dentro da janela informada.
 *   4. A projeção usa o horizonte de 30 dias e NÃO inclui contas que vencem
 *      depois disso (um aluguel em 6 meses não entra em "próximo mês").
 *   5. A projeção INCLUI contas já VENCIDAS (o valor gravado é PENDENTE).
 *   6. Isolamento multi-tenant, permissões e validação de datas.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { gestaoRoutes } from '../src/modules/gestao/gestao.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-fluxo';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

/** Dia local em America/Sao_Paulo, no mesmo formato que `diaDe` usa. */
function diaLocalSP(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** ISO com offset -03:00, que é o que `comFuso()` envia da tela. */
function isoLocal(dia: string, hora: string): string {
  return `${dia}T${hora}:00-03:00`;
}
async function main() {
  const app = Fastify({ logger: false });
  // Mesmo handler global do `server.ts`: sem ele o teste mediria o comportamento
  // do harness e não o do servidor real (o ZodError viraria 500 aqui e 400 em
  // produção, e a validação de data pareceria quebrada à toa).
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
    data: { nome: `FluxoTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `FluxoOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const usuario = await prisma.usuario.create({
    data: {
      empresaId: empresa.id, nome: 'Teste Fluxo',
      email: `fluxo-${SUFIXO}@teste.local`, senhaHash: await hashSenha('senha12345'),
    },
  });
  await prisma.permissao.createMany({
    data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: usuario.id, modulo: m, acao: a, permitido: true }))),
  });
  const semPermissao = await prisma.usuario.create({
    data: {
      empresaId: empresa2.id, nome: 'Sem Permissao',
      email: `semfluxo-${SUFIXO}@teste.local`, senhaHash: await hashSenha('senha12345'),
    },
  });

  const token = app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email });
  const H = { authorization: `Bearer ${token}` };

  // Janelas em dias recentes (ontem/anteontem) para não depender de "hoje".
  const d1 = diaLocalSP(new Date(Date.now() - 86400000));
  const d2 = diaLocalSP(new Date(Date.now() - 2 * 86400000));
  const hoje = diaLocalSP(new Date());
  const params = `periodoInicio=${isoLocal(d2, '00:00')}&periodoFim=${isoLocal(d1, '23:59')}`;
try {
    console.log('\n1. Serie diaria usa o dia LOCAL da empresa, nao o UTC');
    // 22h30 em Sao Paulo = 01h30 UTC do dia SEGUINTE. Com o `toISOString()`
    // antigo, isto aparecia no dia errado.
    await prisma.financeiro.create({
      data: {
        empresaId: empresa.id, tipo: 'RECEITA', categoria: 'vendas',
        descricao: 'Venda da noite', valor: 1000, status: 'PAGO', origem: 'MANUAL',
        createdAt: new Date(`${isoLocal(d1, '22:30')}`),
      },
    });
    const r1 = await app.inject({ method: 'GET', url: `/fluxo-caixa?${params}`, headers: H });
    ok('GET responde 200', r1.statusCode === 200, `status=${r1.statusCode} corpo=${r1.body.slice(0, 200)}`);
    const serie1 = r1.json().serie as any[];
    const pontoNoite = serie1.find((p) => p.dia === d1);
    ok(`lancamento das 22h30 fica no dia ${d1}`, !!pontoNoite, `dias: ${serie1.map((p) => p.dia).join(',')}`);
    ok('valor da noite esta no dia certo', pontoNoite?.entradas === 1000, `entradas=${pontoNoite?.entradas}`);
    ok('a serie traz o dia uma unica vez', serie1.filter((p) => p.dia === d1).length === 1);

    console.log('\n2. saldoAcumulado e resumo');
    await prisma.financeiro.create({
      data: {
        empresaId: empresa.id, tipo: 'DESPESA', categoria: 'fornecedores',
        descricao: 'Despesa dia 1', valor: 300, status: 'PAGO', origem: 'MANUAL',
        createdAt: new Date(`${isoLocal(d1, '10:00')}`),
      },
    });
    await prisma.financeiro.create({
      data: {
        empresaId: empresa.id, tipo: 'RECEITA', categoria: 'vendas',
        descricao: 'Receita dia 2', valor: 500, status: 'PAGO', origem: 'MANUAL',
        createdAt: new Date(`${isoLocal(d2, '11:00')}`),
      },
    });
    const r2 = await app.inject({ method: 'GET', url: `/fluxo-caixa?${params}`, headers: H });
    const j2 = r2.json();
    const s2 = j2.serie as any[];
    ok('dois dias na serie', s2.length === 2, `veio ${s2.length}`);
    ok('resumo.entradas = 1.500', j2.resumo.totalEntradas === 1500, `valor=${j2.resumo.totalEntradas}`);
    ok('resumo.saidas = 300', j2.resumo.totalSaidas === 300, `valor=${j2.resumo.totalSaidas}`);
    ok('resumo.saldo = 1.200', j2.resumo.saldo === 1200, `valor=${j2.resumo.saldo}`);
    ok('saldoAcumulado final = resumo.saldo', s2[s2.length - 1].saldoAcumulado === j2.resumo.saldo, `acumulado=${s2[s2.length - 1].saldoAcumulado}`);
    ok('saldoDia = entradas - saidas', s2[0].saldoDia === s2[0].entradas - s2[0].saidas);
console.log('\n3. So conta PAGO dentro da janela');
    await prisma.financeiro.create({
      data: {
        empresaId: empresa.id, tipo: 'RECEITA', categoria: 'vendas',
        descricao: 'Pendente na janela', valor: 9999, status: 'PENDENTE', origem: 'MANUAL',
        createdAt: new Date(`${isoLocal(d1, '09:00')}`),
        vencimento: new Date(`${isoLocal(hoje, '12:00')}`),
      },
    });
    const r3 = await app.inject({ method: 'GET', url: `/fluxo-caixa?${params}`, headers: H });
    ok('PENDENTE nao entra no resumo realizado', r3.json().resumo.totalEntradas === 1500, `valor=${r3.json().resumo.totalEntradas}`);

    const r4 = await app.inject({
      method: 'GET',
      url: `/fluxo-caixa?periodoInicio=${isoLocal(hoje, '00:00')}&periodoFim=${isoLocal(hoje, '23:59')}`,
      headers: H,
    });
    ok('periodo sem movimento zera o resumo', r4.json().resumo.totalEntradas === 0, `valor=${r4.json().resumo.totalEntradas}`);

    console.log('\n4. Horizonte de 30 dias na projecao');
    // Vence em 40 dias: fora do horizonte de 30, NAO pode entrar na projecao.
    const em40 = diaLocalSP(new Date(Date.now() + 40 * 86400000));
    await prisma.financeiro.create({
      data: {
        empresaId: empresa.id, tipo: 'RECEITA', categoria: 'vendas',
        descricao: 'Longe demais', valor: 7777, status: 'PENDENTE', origem: 'MANUAL',
        vencimento: new Date(`${isoLocal(em40, '12:00')}`),
      },
    });
    const r5 = await app.inject({ method: 'GET', url: `/fluxo-caixa?${params}`, headers: H });
    ok('receita vencendo em 40 dias NAO entra na projecao',
      r5.json().projecao30dias.entradas === 9999,
      `entradas=${r5.json().projecao30dias.entradas}`);

    console.log('\n5. Contas JA VENCIDAS entram na projecao');
    await prisma.financeiro.create({
      data: {
        empresaId: empresa.id, tipo: 'DESPESA', categoria: 'operacionais',
        descricao: 'Vencida ha 10 dias', valor: 500, status: 'PENDENTE', origem: 'MANUAL',
        vencimento: new Date(Date.now() - 10 * 86400000),
      },
    });
    const r6 = await app.inject({ method: 'GET', url: `/fluxo-caixa?${params}`, headers: H });
    const proj6 = r6.json().projecao30dias;
    ok('despesa vencida entra em "a pagar" da projecao', proj6.saidas === 500, `saidas=${proj6.saidas}`);
    ok('saldoProjetado = realizado + projecao',
      proj6.saldoProjetado === r6.json().resumo.saldo + (proj6.entradas - proj6.saidas),
      `saldoProjetado=${proj6.saldoProjetado} resumo=${r6.json().resumo.saldo}`);

console.log('\n6. Formato dos dias e do fuso');
    ok('todos os dias em YYYY-MM-DD', r6.json().serie.every((p: any) => /^\d{4}-\d{2}-\d{2}$/.test(p.dia)));
    ok('resposta informa o fuso usado', typeof r6.json().periodo?.fuso === 'string', `fuso=${r6.json().periodo?.fuso}`);

    console.log('\n7. Isolamento multi-tenant e permissoes');
    const tokenSem = app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email });
    const semPerm = await app.inject({ method: 'GET', url: `/fluxo-caixa?${params}`, headers: { authorization: `Bearer ${tokenSem}` } });
    ok('sem permissao -> 403', semPerm.statusCode === 403, `status=${semPerm.statusCode}`);

    await prisma.permissao.createMany({
      data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: semPermissao.id, modulo: m, acao: a, permitido: true }))),
    });
    const isolado = await app.inject({ method: 'GET', url: `/fluxo-caixa?${params}`, headers: { authorization: `Bearer ${tokenSem}` } });
    ok('empresa B nao ve a serie da empresa A', isolado.json().serie.length === 0, `veio ${isolado.json().serie.length}`);
    ok('empresa B com resumo zerado', isolado.json().resumo.totalEntradas === 0 && isolado.json().resumo.totalSaidas === 0);

    const semToken = await app.inject({ method: 'GET', url: '/fluxo-caixa' });
    ok('sem token -> 401', semToken.statusCode === 401, `status=${semToken.statusCode}`);

    const dataInvalida = await app.inject({ method: 'GET', url: '/fluxo-caixa?periodoInicio=lixo&periodoFim=lixo', headers: H });
    ok('datas invalidas devolvem 400 (nao 500)', dataInvalida.statusCode === 400, `status=${dataInvalida.statusCode}`);
    ok('erro de data e legivel', /inválido/i.test(dataInvalida.body), `corpo=${dataInvalida.body.slice(0, 160)}`);

    const invertido = await app.inject({
      method: 'GET',
      url: `/fluxo-caixa?periodoInicio=${isoLocal(d1, '00:00')}&periodoFim=${isoLocal(d2, '23:59')}`,
      headers: H,
    });
    ok('periodo invertido (inicio > fim) devolvem 400', invertido.statusCode === 400, `status=${invertido.statusCode}`);
  } finally {
    await app.close();
    const ids = [usuario.id, semPermissao.id];
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.financeiro.deleteMany({ where: { empresaId: { in: [empresa.id, empresa2.id] } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: [empresa.id, empresa2.id] } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}

test('integração: fluxo caixa', async () => {
  await main();
});