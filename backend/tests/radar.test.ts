/**
 * TESTE DE INTEGRAÇÃO — MÓDULO RADAR ORGANIZACIONAL
 *
 * Exercita as rotas REAIS de `/radar` contra o PostgreSQL de desenvolvimento,
 * com usuário/empresa descartáveis. O foco é o FLUXO COMPLETO da aba: criar →
 * reler do banco → editar → confirmar persistência depois de recarregar.
 *
 *   1. `GET /radar/resumo` responde e traz `nivelSimulacao` REAL — é a baseline
 *      que a tela usa no Simulador. Antes ela saía da constante `{70,80,70}`
 *      escrita no navegador, e o servidor partia do absenteísmo verdadeiro: os
 *      dois números nunca podiam concordar.
 *   2. `POST /radar/simulacao` devolve `nivelAtual` IGUAL ao `nivelSimulacao`
 *      do resumo (mesma função) e guarda o dado insuficiente.
 *   3. Plano de ação: `POST` cria -> `PATCH` atualiza status, ações E PRAZO.
 *      O prazo era um campo editável que a rota recusava em silêncio.
 *   4. `GET /radar/resumo` volta a trazer o plano com o prazo novo: a
 *      persistência sobrevive ao recarregamento da tela.
 *   5. Cancelar um plano some da lista de alertas (só o CANCELADO sai).
 *   6. Avaliação comportamental e bem-estar gravam e viram vigentes/visíveis.
 *   7. Gamificação: soma por setor e idempotência por `eventoOrigem`+`eventoId`.
 *   8. Isolamento multi-tenant e permissões em todas as rotas tocadas.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { radarRoutes } from '../src/modules/radar/radar.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-radar';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
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
  await app.register(radarRoutes, { prefix: '/radar' });

  const empresa = await prisma.empresa.create({
    data: { nome: `RadarTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `RadarOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: 'Teste Radar', email: `radar-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Sem Permissao', email: `semradar-${SUFIXO}@teste.local`, senhaHash },
  });
  const usuario2 = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Outro Tenant', email: `outro-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario2.id })) });

  const token = app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email });
  const H = { authorization: `Bearer ${token}` };
  const H2 = { authorization: `Bearer ${app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email })}` };
  const hoje = new Date().toISOString().slice(0, 10);
  const admissao = (dias: number) => new Date(new Date().setDate(new Date().getDate() - dias));

  const dept = await prisma.departamento.create({ data: { empresaId: empresa.id, nome: 'Operacoes Radar' } });
  const func = await prisma.funcionario.create({
    data: {
      empresaId: empresa.id, nome: 'Pessoa Radar', matricula: `RAD-${SUFIXO}`,
      dataAdmissao: admissao(120), salario: 3000, status: 'ATIVO', origem: 'MANUAL', departamentoId: dept.id,
    },
  });
  const ids = [usuario.id, semPermissao.id, usuario2.id];

// Ponto REAL dos últimos dias úteis. Sem isso o Radar devolve `suficiente:
 // false` na simulação e NENHUM alerta — que é o comportamento correto, mas
  // deixaria o teste sem o que verificar. Os registros são de verdade: datas
  // passadas, entrada/saída preenchidas e extras em um dos dias.
  // 10 dias ÚNICOS (o `@@unique([funcionarioId, data])` do Ponto recusa repetição).
  // Os 4 últimos são FALTAS e os 6 primeiros têm hora extra: é o que faz o Radar
  // cruzar `LIMITES.faltasAbsenteismo`/`extrasMinPorDia` e gerar alerta de
  // verdade — com ponto "normal" o módulo corretamente não alerta ninguém, e o
  // teste não teria o que verificar.
  const pontos = Array.from({ length: 10 }, (_, i) => {
    const dia = new Date(new Date().setDate(new Date().getDate() - (i + 1)));
    const data = new Date(Date.UTC(dia.getFullYear(), dia.getMonth(), dia.getDate(), 12));
    const falta = i >= 6;
    return {
      empresaId: empresa.id,
      funcionarioId: func.id,
      data,
      entrada: falta ? null : new Date(data.getTime() - 12 * 60 * 1000),
      saida: falta ? null : new Date(data.getTime() + 11 * 60 * 60 * 1000),
      horaExtraMinutos: falta ? 0 : 180,
      atrasoMinutos: falta ? 0 : 20,
      falta,
      origem: 'PONTO' as const,
    };
  });
  await prisma.ponto.createMany({ data: pontos });
  try {
    console.log('\n1. GET /radar/resumo responde com nivelSimulacao real');
    const resumo = await app.inject({ method: 'GET', url: '/radar/resumo', headers: H });
    ok('GET /radar/resumo -> 200', resumo.statusCode === 200, `status=${resumo.statusCode} corpo=${resumo.body.slice(0, 200)}`);
    const r = resumo.json();
    ok('fonte = dados_reais', r.fonte === 'dados_reais', `fonte=${r.fonte}`);
    ok('nivelSimulacao presente no resumo', !!r.nivelSimulacao, `veio ${JSON.stringify(r.nivelSimulacao)}`);
    ok('nivelSimulacao com os 3 indicadores',
      !!r.nivelSimulacao && ['saude', 'gargalo', 'burnout'].every((k) => typeof r.nivelSimulacao[k] === 'number'));
    ok('periodo devolvido', !!r.periodo?.inicio && !!r.periodo?.fim);
    ok('base conta o colaborador', r.base?.colaboradores >= 1, `base=${JSON.stringify(r.base)}`);
    // O plano de ação é amarrado a um alerta REAL devolvido pelo resumo. Com um
    // `ref` inventado o teste provaria só a gravação — não o fluxo completo
    // "alerta detectado -> plano criado -> alerta volta tratado".
    const ALERTA = r.alertas?.[0];
    ok('resumo gera ao menos um alerta a partir do ponto real', !!ALERTA,
      `alertas=${JSON.stringify(r.alertas?.map((a: any) => a.ref))}`);
    const ALERTA_REF = ALERTA?.ref ?? 'SEM-ALERTA';

    console.log('\n2. Simulador: nivelAtual bate com o nivelSimulacao do resumo');
    const sim = await app.inject({
      method: 'POST', url: '/radar/simulacao', headers: H,
      payload: { prodAdd: 1, vendasAdd: 0, horasDelta: -10 },
    });
    ok('POST /radar/simulacao -> 200', sim.statusCode === 200, `status=${sim.statusCode}`);
    const s = sim.json();
    ok('nivelAtual presente', !!s.nivelAtual, `veio ${JSON.stringify(s.nivelAtual)}`);
    ok('mesma funcao: nivelAtual === nivelSimulacao do resumo',
      JSON.stringify(s.nivelAtual) === JSON.stringify(r.nivelSimulacao),
      `resumo=${JSON.stringify(r.nivelSimulacao)} simulacao=${JSON.stringify(s.nivelAtual)}`);
    ok('cenario calculado pelo servidor', !!s.cenario && typeof s.cenario.saude === 'number', `cenario=${JSON.stringify(s.cenario)}`);
    ok('deltas devolvidos', !!s.deltas);
    ok('pressupostos e lista', Array.isArray(s.pressupostos));

    console.log('\n3. Plano de acao: criar -> atualizar status, acoes e PRAZO');
    const criar = await app.inject({
      method: 'POST', url: '/radar/acoes', headers: H,
      payload: {
        alertaRef: ALERTA_REF, alertaTitulo: ALERTA?.titulo ?? 'Alerta de teste', funcionarioId: func.id,
        acoes: [{ texto: 'Primeira acao', concluida: false }], prazo: '2026-12-31',
      },
    });
    ok('POST /radar/acoes -> 201', criar.statusCode === 201, `status=${criar.statusCode} corpo=${criar.body.slice(0, 200)}`);
    const planoId = criar.json().id;
    ok('devolve id', !!planoId);
    ok('status nasce ABERTA', criar.json().status === 'ABERTA', `status=${criar.json().status}`);
    const gravado = await prisma.acaoRadar.findUnique({ where: { id: planoId } });
    ok('plano gravado no PostgreSQL', !!gravado);
    ok('prazo gravado no banco', gravado?.prazo?.toISOString().slice(0, 10) === '2026-12-31', `prazo=${gravado?.prazo}`);

    const novoPrazo = '2027-03-15';
    const att = await app.inject({
      method: 'PATCH', url: `/radar/acoes/${planoId}`, headers: H,
      payload: {
        status: 'EM_ANDAMENTO',
        acoes: [{ texto: 'Primeira acao', concluida: true }, { texto: 'Segunda acao', concluida: false }],
        prazo: novoPrazo,
      },
    });
    ok('PATCH /radar/acoes/:id -> 200', att.statusCode === 200, `status=${att.statusCode} corpo=${att.body.slice(0, 200)}`);
    ok('status atualizado', att.json().status === 'EM_ANDAMENTO');
    ok('acoes atualizadas', Array.isArray(att.json().acoes) && att.json().acoes.length === 2);
    ok('prazo devolvido pela rota', att.json().prazo === novoPrazo, `prazo=${att.json().prazo}`);
    const relido = await prisma.acaoRadar.findUnique({ where: { id: planoId } });
    ok('PRAZO PERSISTIDO no banco', relido?.prazo?.toISOString().slice(0, 10) === novoPrazo, `prazo=${relido?.prazo}`);
    ok('status persistido no banco', relido?.status === 'EM_ANDAMENTO');
    ok('acoes persistidas no banco', Array.isArray(relido?.acoes) && (relido?.acoes as any[]).length === 2);

    console.log('\n4. PATCH sem prazo preserva o prazo gravado');
    const semPrazo = await app.inject({
      method: 'PATCH', url: `/radar/acoes/${planoId}`, headers: H, payload: { status: 'ABERTA' },
    });
    ok('PATCH sem prazo -> 200', semPrazo.statusCode === 200);
    ok('prazo NAO foi apagado', semPrazo.json().prazo === novoPrazo, `prazo=${semPrazo.json().prazo}`);

    console.log('\n5. PATCH com prazo invalido e recusado');
    const prazoRuim = await app.inject({
      method: 'PATCH', url: `/radar/acoes/${planoId}`, headers: H,
      payload: { status: 'ABERTA', prazo: '31/12/2026' },
    });
    ok('prazo fora de AAAA-MM-DD -> 400', prazoRuim.statusCode === 400, `status=${prazoRuim.statusCode}`);
    console.log('\n6. O plano volta no resumo (persistencia apos recarregar a tela)');
    const resumo2 = await app.inject({ method: 'GET', url: '/radar/resumo', headers: H });
    const r2 = resumo2.json();
    const alvo = r2.alertas.find((a: any) => a.ref === ALERTA_REF);
    ok('alerta do plano reaparece no resumo', !!alvo, `refs=${r2.alertas.map((a: any) => a.ref).join(',')}`);
    ok('alerta com plano anexado', !!alvo?.plano, `plano=${JSON.stringify(alvo?.plano)}`);
    ok('plano traz o prazo novo', alvo?.plano?.prazo === novoPrazo, `prazo=${alvo?.plano?.prazo}`);
    ok('status do alerta = Em acao', alvo?.status === 'Em ação', `status=${alvo?.status}`);
    ok('alerta traz as acoes gravadas', (alvo?.plano?.acoes ?? []).length === 2);

    console.log('\n7. Cancelar o plano remove o alerta da lista');
    await app.inject({
      method: 'PATCH', url: `/radar/acoes/${planoId}`, headers: H, payload: { status: 'CANCELADA' },
    });
    const resumo3 = await app.inject({ method: 'GET', url: '/radar/resumo', headers: H });
    ok('alerta CANCELADO nao aparece mais', !resumo3.json().alertas.some((a: any) => a.ref === ALERTA_REF));
    const cancelado = await prisma.acaoRadar.findUnique({ where: { id: planoId } });
    ok('registro preservado no banco (nao apagado)', !!cancelado && cancelado.status === 'CANCELADA');

    console.log('\n8. Avaliacao comportamental e bem-estar');
    const funcB = await prisma.funcionario.create({
      data: {
        empresaId: empresa.id, nome: 'Pessoa Avaliada', matricula: `RDA-${SUFIXO}`,
        dataAdmissao: admissao(60), salario: 4000, status: 'ATIVO', origem: 'MANUAL', departamentoId: dept.id,
      },
    });
    const aval = await app.inject({
      method: 'POST', url: '/radar/avaliacoes', headers: H,
      payload: { funcionarioId: funcB.id, perfil: 'D', scores: { D: 80, I: 10, S: 5, C: 5 }, dataAvaliacao: hoje },
    });
    ok('POST /radar/avaliacoes -> 201', aval.statusCode === 201, `status=${aval.statusCode} corpo=${aval.body.slice(0, 200)}`);
    ok('avaliacao vigente', aval.json().vigente === true, `vigente=${aval.json().vigente}`);
    const avalDb = await prisma.avaliacaoComportamental.findUnique({ where: { id: aval.json().id } });
    ok('perfil gravado no PostgreSQL', avalDb?.perfil === 'D', `perfil=${avalDb?.perfil}`);

    const bem = await app.inject({
      method: 'POST', url: '/radar/bem-estar', headers: H,
      payload: { funcionarioId: funcB.id, nota: 72, resposta: 'Carga ok', dataPesquisa: hoje },
    });
    ok('POST /radar/bem-estar -> 201', bem.statusCode === 201, `status=${bem.statusCode} corpo=${bem.body.slice(0, 200)}`);
    const bemDb = await prisma.pesquisaBemEstar.findUnique({ where: { id: bem.json().id } });
    ok('bem-estar gravado no PostgreSQL', bemDb?.nota === 72, `nota=${bemDb?.nota}`);

    console.log('\n9. Validacao de escala e de funcionario');
    const notaFora = await app.inject({
      method: 'POST', url: '/radar/bem-estar', headers: H,
      payload: { funcionarioId: funcB.id, nota: 150, dataPesquisa: hoje },
    });
    ok('nota fora de 0-100 -> 400', notaFora.statusCode === 400, `status=${notaFora.statusCode}`);
    const orfa = await app.inject({
      method: 'POST', url: '/radar/bem-estar', headers: H,
      payload: { funcionarioId: 'inexistente-xyz', nota: 50, dataPesquisa: hoje },
    });
    ok('funcionario inexistente -> 404', orfa.statusCode === 404, `status=${orfa.statusCode}`);
    console.log('\n10. Gamificacao: soma por setor e idempotencia');
    const depB = await prisma.departamento.create({ data: { empresaId: empresa.id, nome: 'Comercial Radar' } });
    const funcC = await prisma.funcionario.create({
      data: {
        empresaId: empresa.id, nome: 'Pessoa Gamificacao', matricula: `RDG-${SUFIXO}`,
        dataAdmissao: admissao(60), salario: 3500, status: 'ATIVO', origem: 'MANUAL', departamentoId: depB.id,
      },
    });
    const g1 = await app.inject({
      method: 'POST', url: '/radar/gamificacao', headers: H,
      payload: { funcionarioId: funcC.id, tipo: 'conquista', descricao: 'Meta batida', pontos: 100, regraId: 'meta_mensal', data: hoje },
    });
    ok('POST /radar/gamificacao -> 201', g1.statusCode === 201, `status=${g1.statusCode} corpo=${g1.body.slice(0, 200)}`);
    ok('pontos gravados', g1.json().pontos === 100);
    ok('nao marcado como duplicado', g1.json().duplicado === false);

    const g2 = await app.inject({
      method: 'POST', url: '/radar/gamificacao', headers: H,
      payload: { funcionarioId: funcC.id, tipo: 'meta', descricao: 'Venda concluida', pontos: 50, eventoOrigem: 'venda_finalizada', eventoId: 'venda-999', data: hoje },
    });
    ok('segundo registro -> 201', g2.statusCode === 201);
    const g2dup = await app.inject({
      method: 'POST', url: '/radar/gamificacao', headers: H,
      payload: { funcionarioId: funcC.id, tipo: 'meta', descricao: 'Venda concluida', pontos: 50, eventoOrigem: 'venda_finalizada', eventoId: 'venda-999', data: hoje },
    });
    ok('repetir o mesmo evento NAO soma de novo', g2dup.json().duplicado === true, `corpo=${g2dup.body.slice(0, 200)}`);
    ok('devolve o registro ja existente', g2dup.json().id === g2.json().id);

    const placar = await app.inject({ method: 'GET', url: '/radar/gamificacao', headers: H });
    ok('GET /radar/gamificacao -> 200', placar.statusCode === 200);
    const p = placar.json();
    ok('totalPontos = 150 (100 + 50, sem duplicar)', p.totalPontos === 150, `total=${p.totalPontos}`);
    ok('agrupa por setor', p.porSetor.some((x: any) => x.setor === 'Comercial Radar' && x.pontos === 150),
      `porSetor=${JSON.stringify(p.porSetor)}`);

    console.log('\n11. Isolamento multi-tenant');
    const r2empresa = await app.inject({ method: 'GET', url: '/radar/resumo', headers: H2 });
    ok('empresa B ve o proprio resumo', r2empresa.statusCode === 200);
    ok('empresa B nao ve o alerta da empresa A', !r2empresa.json().alertas.some((a: any) => a.ref === ALERTA_REF));
    ok('empresa B nao ve a pontuacao da empresa A', r2empresa.json().gamificacao?.registros === 0,
      `registros=${r2empresa.json().gamificacao?.registros}`);
    const patchAlheio = await app.inject({
      method: 'PATCH', url: `/radar/acoes/${planoId}`, headers: H2, payload: { status: 'CONCLUIDA' },
    });
    ok('empresa B nao edita plano da empresa A -> 404', patchAlheio.statusCode === 404, `status=${patchAlheio.statusCode}`);
    const bemAlheio = await app.inject({
      method: 'POST', url: '/radar/bem-estar', headers: H2,
      payload: { funcionarioId: funcB.id, nota: 10, dataPesquisa: hoje },
    });
    ok('empresa B nao grava em funcionario da empresa A -> 404', bemAlheio.statusCode === 404, `status=${bemAlheio.statusCode}`);

    console.log('\n12. Permissoes e token');
    ok('GET /radar/resumo sem token -> 401',
      (await app.inject({ method: 'GET', url: '/radar/resumo' })).statusCode === 401);
    ok('GET /radar/resumo sem permissao -> 403',
      (await app.inject({ method: 'GET', url: '/radar/resumo', headers: Hsem })).statusCode === 403);
    ok('POST /radar/acoes sem permissao -> 403',
      (await app.inject({
        method: 'POST', url: '/radar/acoes', headers: Hsem,
        payload: { alertaRef: 'X', alertaTitulo: 'X', acoes: [{ texto: 'x', concluida: false }] },
      })).statusCode === 403);
  } finally {
    const todas = [empresa.id, empresa2.id];
    await prisma.registroGamificacao.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.pesquisaBemEstar.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.avaliacaoComportamental.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.acaoRadar.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.ponto.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.funcionario.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.departamento.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: todas } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: radar', async () => {
  await main();
});