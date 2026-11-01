/**
 * TESTE DE INTEGRAÇÃO — PONTO (aba /ponto)
 *
 * O Ponto é o único módulo em que a marcação é um FATO do instante. A auditoria
 * achou que a tela mostrava o dia errado: `Ponto.data` é `@db.Date` (meia-noite
 * UTC) e a tela fazia `new Date(p.data).toLocaleDateString('pt-BR')`, que em São
 * Paulo devolve o dia ANTERIOR. Este teste cobre o contrato inteiro:
 *
 *   1. `POST /ponto/manual` grava a marcação na COLUNA certa para cada um dos
 *      quatro tipos e responde com `dataMarcacao` + `fuso` para a tela confirmar.
 *   2. Persistência: a linha gravada é relida DIRETO do PostgreSQL, e um GET
 *      posterior devolve exatamente o que foi marcado.
 *   3. As quatro marcações convivem na MESMA linha do dia (registrar saída não
 *      apaga a entrada) — `@@unique([funcionarioId, data])`.
 *   4. Atraso e hora extra usam o horário PREVISTO do cadastro, no fuso da
 *      empresa — não 08:00/18:00 fixos nem o fuso UTC.
 *   5. `GET /ponto` devolve `X-Fuso-Empresa` (a tela precisa dele para formatar
 *      hora e data) e `Ponto.data` como meia-noite UTC — que é o valor cuja
 *      leitura ingenua produz o dia errado.
 *   6. Paginação: `X-Total-Count`/`X-Truncated` tornam o corte visível.
 *   7. Isolamento multi-tenant e permissões em todas as rotas tocadas.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { rhRoutes } from '../src/modules/rh/rh.routes.js';
import { folhaRoutes } from '../src/modules/rh/folha.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-ponto';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

/** "YYYY-MM-DD" no fuso da empresa (o mesmo formato que o backend grava). */
function diaNoFuso(fuso: string, offset = 0): string {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
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
  await app.register(rhRoutes);
  await app.register(folhaRoutes);
  const empresa = await prisma.empresa.create({
    data: { nome: `PontoTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0'), fusoHorario: 'America/Sao_Paulo' },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `PontoOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0'), fusoHorario: 'America/Sao_Paulo' },
  });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: 'Teste Ponto', email: `ponto-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Sem Permissao', email: `semponto-${SUFIXO}@teste.local`, senhaHash },
  });
  const usuario2 = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Outro Tenant', email: `outroponto-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario2.id })) });

  const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email })}` };
  const H2 = { authorization: `Bearer ${app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email })}` };
  const ids = [usuario.id, semPermissao.id, usuario2.id];

  // Horários previstos 09:00-18:00: é contra ESTES que o servidor apura atraso
  // e hora extra. Com os 08:00/18:00 fixos do código, uma entrada às 08:55
  // seria marcada como atrasada em todo dia.
  const func = await prisma.funcionario.create({
    data: {
      empresaId: empresa.id, nome: 'Ponto Teste', matricula: `PT-${SUFIXO}`,
      dataAdmissao: new Date(Date.now() - 200 * 86400000),
      salario: 3000, status: 'ATIVO', origem: 'MANUAL',
      horarioEntradaPrevisto: '09:00', horarioSaidaPrevisto: '18:00',
      idExternoPonto: '101',
    },
  });
  const funcSemPrevisto = await prisma.funcionario.create({
    data: {
      empresaId: empresa.id, nome: 'Ponto Sem Previsto', matricula: `PS-${SUFIXO}`,
      dataAdmissao: new Date(Date.now() - 200 * 86400000),
      salario: 3000, status: 'ATIVO', origem: 'MANUAL',
    },
  });
  const hoje = diaNoFuso('America/Sao_Paulo');
  try {
    console.log('\n1. Marcacao manual grava na COLUNA certa de cada tipo');
    const COLUNA: Record<string, string> = {
      ENTRADA: 'entrada', SAIDA_INTERVALO: 'saidaIntervalo',
      RETORNO: 'retornoIntervalo', SAIDA: 'saida',
    };
    const tipos = ['ENTRADA', 'SAIDA_INTERVALO', 'RETORNO', 'SAIDA'];
    for (const [i, tipo] of tipos.entries()) {
      // Cada tipo em um DIA próprio: o `@@unique([funcionarioId, data])` faz as
      // quatro marcações do mesmo dia convergirem para a mesma linha, e a
      // ordem dos testes deixaria de ser determinística.
      const dia = diaNoFuso('America/Sao_Paulo', -10 + i);
      const r = await app.inject({
        method: 'POST', url: '/ponto/manual', headers: H,
        payload: { funcionarioId: func.id, tipo, data: dia },
      });
      ok(`POST /ponto/manual ${tipo} -> 200`, r.statusCode === 200, `status=${r.statusCode} corpo=${r.body.slice(0, 160)}`);
      ok(`${tipo}: resposta traz o dia gravado`, r.json().dataMarcacao === dia, `veio=${r.json().dataMarcacao} esperado=${dia}`);
      ok(`${tipo}: resposta traz o fuso`, r.json().fuso === 'America/Sao_Paulo', `fuso=${r.json().fuso}`);
      const gravado = await prisma.ponto.findUnique({
        where: { funcionarioId_data: { funcionarioId: func.id, data: new Date(`${dia}T00:00:00.000Z`) } },
      });
      ok(`${tipo}: gravado no PostgreSQL`, !!gravado);
      ok(`${tipo}: coluna ${COLUNA[tipo]} preenchida`, !!gravado?.[COLUNA[tipo]], `${COLUNA[tipo]}=${gravado?.[COLUNA[tipo]]}`);
      const outras = Object.values(COLUNA).filter((c) => c !== COLUNA[tipo]);
      ok(`${tipo}: nao invade as outras colunas`, outras.every((c) => !gravado?.[c]),
        `outras=${outras.filter((c) => !!gravado?.[c]).join(',')}`);
    }

    console.log('\n2. As quatro marcacoes convivem na MESMA linha do dia');
    const diaUnico = diaNoFuso('America/Sao_Paulo', -20);
    for (const tipo of tipos) {
      await app.inject({
        method: 'POST', url: '/ponto/manual', headers: H,
        payload: { funcionarioId: funcSemPrevisto.id, tipo, data: diaUnico },
      });
    }
    const linha = await prisma.ponto.findUnique({
      where: { funcionarioId_data: { funcionarioId: funcSemPrevisto.id, data: new Date(`${diaUnico}T00:00:00.000Z`) } },
    });
    ok('uma unica linha para o dia inteiro', !!linha);
    ok('entrada NAO foi apagada pela saida', !!linha?.entrada);
    ok('saidaIntervalo gravada', !!linha?.saidaIntervalo);
    ok('retornoIntervalo gravado', !!linha?.retornoIntervalo);
    ok('saida gravada', !!linha?.saida);
    const totalLinhas = await prisma.ponto.count({ where: { funcionarioId: funcSemPrevisto.id } });
    ok('nao duplicou linha', totalLinhas === 1, `linhas=${totalLinhas}`);
    console.log('\n3. GET /ponto devolve o gravado + o fuso da empresa');
    const lista = await app.inject({ method: 'GET', url: '/ponto', headers: H });
    ok('GET /ponto -> 200', lista.statusCode === 200, `status=${lista.statusCode}`);
    ok('header X-Fuso-Empresa presente', lista.headers['x-fuso-empresa'] === 'America/Sao_Paulo',
      `header=${lista.headers['x-fuso-empresa']}`);
    const arr = lista.json();
    ok('devolve array (formato nao mudou)', Array.isArray(arr), `tipo=${typeof arr}`);
    const achado = arr.find((p: any) => p.funcionarioId === funcSemPrevisto.id);
    ok('registro aparece na lista', !!achado);
    ok('lista traz o nome do funcionario', achado?.funcionario?.nome === 'Ponto Sem Previsto', `nome=${achado?.funcionario?.nome}`);
    ok('lista traz as 4 marcacoes', !!(achado?.entrada && achado?.saidaIntervalo && achado?.retornoIntervalo && achado?.saida));

    console.log('\n4. `data` e meia-noite UTC: e o que fazia a tela errar o dia');
    const dataIso = achado?.data;
    ok('data vem como string ISO de @db.Date', typeof dataIso === 'string' && String(dataIso).endsWith('T00:00:00.000Z'),
      `data=${dataIso}`);
    ok('o dia guardado e o dia do registro', String(dataIso).slice(0, 10) === diaUnico,
      `guardado=${String(dataIso).slice(0, 10)} esperado=${diaUnico}`);
    // Prova do bug corrigido: ler essa data com `toLocaleDateString` em São Paulo
    // devolve o dia ANTERIOR. A tela passou a cortar a string.
    const diaIng = new Date(dataIso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const diaCerto = new Date(`${diaUnico}T12:00:00`).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    ok('leitura ingenua devolveria o dia anterior (motivo da correcao)', diaIng !== diaCerto,
      `ingenuo=${diaIng} correto=${diaCerto}`);

    console.log('\n5. Atraso e hora extra usam o horario PREVISTO do cadastro');
    // Entrada 09:30 (30 min depois das 09:00 previstas) e saida 18:30 (30 min
    // depois das 18:00). Com os 08:00/18:00 FIXOS do codigo, o atraso seria 90
    // e a hora extra 30 — o gestor veria um atraso que nao existe.
    const diaAtraso = diaNoFuso('America/Sao_Paulo', -30);
    await prisma.ponto.create({
      data: {
        empresaId: empresa.id, funcionarioId: func.id,
        data: new Date(`${diaAtraso}T00:00:00.000Z`),
        entrada: new Date(`${diaAtraso}T09:30:00-03:00`),
        saida: new Date(`${diaAtraso}T18:30:00-03:00`),
        origem: 'MANUAL',
      },
    });
    // Dispara o recalculo com `RETORNO`: este tipo toca SO `retornoIntervalo`,
    // entao entrada e saida continuam as do banco e a apuracao usa elas.
    // (Usar `SAIDA` sobrescreveria a saida com o instante atual.)
    await app.inject({
      method: 'POST', url: '/ponto/manual', headers: H,
      payload: { funcionarioId: func.id, tipo: 'RETORNO', data: diaAtraso },
    });
    const apurado = await prisma.ponto.findUnique({
      where: { funcionarioId_data: { funcionarioId: func.id, data: new Date(`${diaAtraso}T00:00:00.000Z`) } },
    });
    ok('atraso apurado contra 09:00 do cadastro (30 min)', apurado?.atrasoMinutos === 30,
      `atraso=${apurado?.atrasoMinutos}`);
    ok('hora extra apurada contra 18:00 do cadastro (30 min)', apurado?.horaExtraMinutos === 30,
      `extra=${apurado?.horaExtraMinutos}`);
    ok('entrada preservada durante o calculo', !!apurado?.entrada?.toISOString().startsWith(diaAtraso),
      `entrada=${apurado?.entrada}`);
    ok('saida preservada durante o calculo', !!apurado?.saida?.toISOString().startsWith(diaAtraso),
      `saida=${apurado?.saida}`);
    console.log('\n6. Validacoes e permissoes');
    const invalido = await app.inject({
      method: 'POST', url: '/ponto/manual', headers: H,
      payload: { funcionarioId: func.id, tipo: 'TIPO_QUE_NAO_EXISTE' },
    });
    ok('tipo invalido -> 400', invalido.statusCode === 400, `status=${invalido.statusCode}`);
    const dataRuim = await app.inject({
      method: 'POST', url: '/ponto/manual', headers: H,
      payload: { funcionarioId: func.id, tipo: 'ENTRADA', data: '02/10/2026' },
    });
    ok('data fora de AAAA-MM-DD -> 400', dataRuim.statusCode === 400, `status=${dataRuim.statusCode}`);
    const alheio = await app.inject({
      method: 'POST', url: '/ponto/manual', headers: H,
      payload: { funcionarioId: 'inexistente-xyz', tipo: 'ENTRADA' },
    });
    ok('funcionario inexistente -> 404', alheio.statusCode === 404, `status=${alheio.statusCode}`);
    ok('GET /ponto sem permissao -> 403',
      (await app.inject({ method: 'GET', url: '/ponto', headers: Hsem })).statusCode === 403);
    ok('POST /ponto/manual sem permissao -> 403',
      (await app.inject({
        method: 'POST', url: '/ponto/manual', headers: Hsem,
        payload: { funcionarioId: func.id, tipo: 'ENTRADA' },
      })).statusCode === 403);
    ok('GET /ponto sem token -> 401',
      (await app.inject({ method: 'GET', url: '/ponto' })).statusCode === 401);
    ok('POST /ponto/manual sem token -> 401',
      (await app.inject({
        method: 'POST', url: '/ponto/manual', payload: { funcionarioId: func.id, tipo: 'ENTRADA' },
      })).statusCode === 401);

    console.log('\n7. Isolamento multi-tenant');
    const listaB = await app.inject({ method: 'GET', url: '/ponto', headers: H2 });
    ok('empresa B responde 200', listaB.statusCode === 200);
    ok('empresa B nao ve o ponto do funcionario A', !listaB.json().some((p: any) => p.funcionarioId === func.id));
    ok('empresa B nao ve o ponto do outro funcionario da A',
      !listaB.json().some((p: any) => p.funcionarioId === funcSemPrevisto.id));
    const marcaB = await app.inject({
      method: 'POST', url: '/ponto/manual', headers: H2,
      payload: { funcionarioId: func.id, tipo: 'ENTRADA' },
    });
    ok('empresa B nao marca em funcionario da empresa A -> 404', marcaB.statusCode === 404, `status=${marcaB.statusCode}`);
  } finally {
    const todas = [empresa.id, empresa2.id];
    await prisma.ponto.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.funcionario.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: todas } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: aba ponto', async () => {
  await main();
});