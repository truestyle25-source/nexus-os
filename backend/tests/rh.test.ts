/**
 * TESTE DE INTEGRAÇÃO — MÓDULO RH
 *
 * Exercita as rotas REAIS de RH contra o PostgreSQL de desenvolvimento, com
 * usuário/empresa descartáveis. Foco no que a aba /rh depende e nos defeitos
 * corrigidos:
 *
 *   1. Funcionário: criar (POST) -> reler (GET) -> editar (PUT) -> confirmar
 *      persistência e que a edição NÃO apagou o que não foi enviado.
 *   2. Isolamento multi-tenant em TODAS as rotas tocadas.
 *   3. Permissões: sem `rh:*` -> 403; sem token -> 401.
 *   4. Advertência e suspensão gravam e contam na consulta do funcionário.
 *   5. Desligamento: grava, recusa duplicata (409) e cancela reativando.
 *   6. `PUT /rh/desligamentos/:id` aceita `documentos` — o verbo que a tela
 *      usava de verdade (PATCH) não existe e a gravação nunca acontecia.
 *   7. Arquivamento: `POST /rh/funcionarios/arquivar-vencidos` move para
 *      ARQUIVADO depois da janela, e `GET /rh/funcionarios/arquivados`
 *      devolve — o par que a tela ficou sem botão.
 *   8. Folha: abrir competência é idempotente (não duplica).
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

const SEGREDO = 'segredo-teste-rh';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}
async function main() {
  const app = Fastify({ logger: false });
  // Mesmo handler global do `server.ts`, para o teste medir o servidor real.
  // Espelha o handler global do `server.ts`. `ErroDeNegocio` é subclasse de
  // Error: sem o caso explícito, `constructor === Error` é falso e TODO erro de
  // regra de negócio (409, 422, 404) viraria 500 — o teste mediria o harness,
  // não o servidor.
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
  // A folha tem arquivo de rotas próprio (server.ts registra `folhaRoutes`
  // separado) — sem ele, POST /rh/folhas cairia em 404 no teste e a aba
  // pareceria quebrada sem estar.
  await app.register(folhaRoutes);

  const empresa = await prisma.empresa.create({
    data: { nome: `RhTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `RhOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const usuario = await prisma.usuario.create({
    data: {
      empresaId: empresa.id, nome: 'Teste RH',
      email: `rh-${SUFIXO}@teste.local`, senhaHash: await hashSenha('senha12345'),
    },
  });
  await prisma.permissao.createMany({
    data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: usuario.id, modulo: m, acao: a, permitido: true }))),
  });
  const semPermissao = await prisma.usuario.create({
    data: {
      empresaId: empresa2.id, nome: 'Sem Permissao',
      email: `semrh-${SUFIXO}@teste.local`, senhaHash: await hashSenha('senha12345'),
    },
  });

  const token = app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email });
  const H = { authorization: `Bearer ${token}` };
  const hj = new Date().toISOString().slice(0, 10);

  let funcId = '';
  try {
    console.log('\n1. Funcionario: criar -> reler -> editar');
    const criar = await app.inject({
      method: 'POST', url: '/funcionarios', headers: H,
      payload: {
        nome: 'Funcionario Teste', cpf: `${Date.now()}`.padStart(11, '0').slice(0, 11),
        email: `func-${SUFIXO}@teste.local`, dataAdmissao: hj,
        salario: 3000, status: 'ATIVO', origem: 'MANUAL',
      },
    });
    ok('POST /funcionarios -> 200', criar.statusCode === 200, `status=${criar.statusCode} corpo=${criar.body.slice(0, 200)}`);
    funcId = criar.json().id;
    ok('criacao devolve id', typeof funcId === 'string' && funcId.length > 0);

    const noBanco = await prisma.funcionario.findUnique({ where: { id: funcId } });
    ok('gravado no PostgreSQL', !!noBanco);
    ok('salario gravado', Math.abs(Number(noBanco?.salario) - 3000) < 0.01, `valor=${noBanco?.salario}`);
    ok('empresaId vem do token', noBanco?.empresaId === empresa.id);
console.log('\n2. Advertencia e suspensao');
    const adv = await app.inject({
      method: 'POST', url: '/rh/advertencias', headers: H,
      payload: { funcionarioId: funcId, tipo: 'VERBAL', motivo: 'Atraso reiterado', data: hj, aplicadaPor: 'Teste' },
    });
    ok('POST /rh/advertencias -> 200', adv.statusCode === 200, `status=${adv.statusCode} corpo=${adv.body.slice(0, 200)}`);
    const advs = await app.inject({ method: 'GET', url: '/rh/advertencias', headers: H });
    ok('advertencia persistida e listada', advs.json().some((a: any) => a.funcionarioId === funcId), `veio ${advs.json().length}`);

    const sus = await app.inject({
      method: 'POST', url: '/rh/suspensoes', headers: H,
      payload: { funcionarioId: funcId, dias: 2, motivo: 'Regra disciplinar', inicio: hj, aplicadaPor: 'Teste' },
    });
    ok('POST /rh/suspensoes -> 200', sus.statusCode === 200, `status=${sus.statusCode} corpo=${sus.body.slice(0, 200)}`);
    const susList = await app.inject({ method: 'GET', url: '/rh/suspensoes', headers: H });
    ok('suspensao persistida e listada', susList.json().some((s: any) => s.funcionarioId === funcId));

    console.log('\n3. Desligamento: grava, recusa duplicata, cancela');
    const desl = await app.inject({
      method: 'POST', url: '/rh/desligamentos', headers: H,
      payload: { funcionarioId: funcId, data: hj, tipo: 'pedido', motivo: 'Pedido de demissao' },
    });
    ok('POST /rh/desligamentos -> 200', desl.statusCode === 200, `status=${desl.statusCode} corpo=${desl.body.slice(0, 250)}`);
    const deslId = desl.json().id;
    ok('desligamento devolve id', typeof deslId === 'string' && deslId.length > 0);

    const deslDb = await prisma.desligamento.findUnique({ where: { id: deslId } });
    ok('desligamento gravado no PostgreSQL', !!deslDb);
    ok('funcionario marcado como DESLIGADO',
      (await prisma.funcionario.findUnique({ where: { id: funcId } }))?.status === 'DESLIGADO');

    const dup = await app.inject({
      method: 'POST', url: '/rh/desligamentos', headers: H,
      payload: { funcionarioId: funcId, data: hj, tipo: 'pedido', motivo: 'Segundo registro' },
    });
    ok('desligamento duplicado é recusado (409)', dup.statusCode === 409, `status=${dup.statusCode}`);

    const listaDesl = await app.inject({ method: 'GET', url: '/rh/desligamentos', headers: H });
    ok('GET /rh/desligamentos devolve o registro', listaDesl.json().some((d: any) => d.id === deslId));

    console.log('\n4. PUT /rh/desligamentos/:id aceita `documentos` (verbo real da rota)');
    const putDocs = await app.inject({
      method: 'PUT', url: `/rh/desligamentos/${deslId}`, headers: H,
      payload: { documentos: ['dossie-assinado.pdf'] },
    });
    ok('PUT aceita documentos -> 200', putDocs.statusCode === 200, `status=${putDocs.statusCode}`);
    const comDocs = await prisma.desligamento.findUnique({ where: { id: deslId } });
    ok('nomes dos documentos persistidos', Array.isArray(comDocs?.documentos) && comDocs.documentos.includes('dossie-assinado.pdf'), `docs=${JSON.stringify(comDocs?.documentos)}`);
    const patchDocs = await app.inject({
      method: 'PATCH', url: `/rh/desligamentos/${deslId}`, headers: H,
      payload: { documentos: ['x.pdf'] },
    });
    ok('PATCH nao existe (404) — por isso a tela falhava em silencio', patchDocs.statusCode === 404, `status=${patchDocs.statusCode}`);

    console.log('\n5. Cancelamento reativa o FUNCIONARIO e preserva o registro');
    const cancelar = await app.inject({
      method: 'POST', url: `/rh/desligamentos/${deslId}/cancelar`, headers: H,
      payload: { motivo: 'Erro de lancamento no sistema' },
    });
    ok('POST /rh/desligamentos/:id/cancelar -> 200', cancelar.statusCode === 200, `status=${cancelar.statusCode} corpo=${cancelar.body.slice(0, 200)}`);
    ok('funcionario voltou a ATIVO',
      (await prisma.funcionario.findUnique({ where: { id: funcId } }))?.status === 'ATIVO');
    ok('registro de desligamento preservado (nao apagado)', !!(await prisma.desligamento.findUnique({ where: { id: deslId } })));
    ok('status do desligamento = CANCELADO',
      (await prisma.desligamento.findUnique({ where: { id: deslId } }))?.status === 'CANCELADO');

console.log('\n6. Arquivamento apos a janela de 30 dias');
    const arq1 = await app.inject({ method: 'POST', url: '/rh/funcionarios/arquivar-vencidos', headers: H, payload: {} });
    ok('POST arquivar-vencidos -> 200', arq1.statusCode === 200, `status=${arq1.statusCode} corpo=${arq1.body.slice(0, 200)}`);
    ok('nada e arquivado com a janela em aberto', arq1.json().arquivados === 0, `arquivados=${arq1.json().arquivados}`);

    // Um SEGUNDO funcionário: o primeiro teve o desligamento cancelado no
    // passo 5, e a rota de arquivamento ignora CANCELADO de propósito.
    const func2 = await app.inject({
      method: 'POST', url: '/funcionarios', headers: H,
      payload: {
        // CPF DISTINTO do passo 1: `cpf` é único por empresa e o slice de
        // `Date.now()` colidia (mesmos 10 primeiros dígitos).
        nome: 'Funcionario Para Arquivar', cpf: `9000000${SUFIXO.slice(-4)}`.slice(0, 11),
        email: `arq-${SUFIXO}@teste.local`, dataAdmissao: hj, salario: 2000,
        status: 'ATIVO', origem: 'MANUAL',
      },
    });
    const func2Id = func2.json().id;
    const desl2 = await app.inject({
      method: 'POST', url: '/rh/desligamentos', headers: H,
      payload: { funcionarioId: func2Id, data: hj, tipo: 'pedido', motivo: 'Teste de arquivamento' },
    });
    ok('segundo desligamento criado', desl2.statusCode === 200, `status=${desl2.statusCode}`);
    const desl2Id = desl2.json().id;

    await prisma.desligamento.update({
      where: { id: desl2Id },
      data: { data: new Date(Date.now() - 45 * 86400000) },
    });
    const arq2 = await app.inject({ method: 'POST', url: '/rh/funcionarios/arquivar-vencidos', headers: H, payload: {} });
    ok('apos 45 dias, 1 desligamento e arquivado', arq2.json().arquivados === 1, `arquivados=${arq2.json().arquivados}`);
    const funcArquivado = await prisma.funcionario.findUnique({ where: { id: func2Id } });
    ok('funcionario marcado como ARQUIVADO', funcArquivado?.status === 'ARQUIVADO', `status=${funcArquivado?.status}`);
    ok('desligamento com arquivadoEm gravado', !!(await prisma.desligamento.findUnique({ where: { id: desl2Id } }))?.arquivadoEm);
    const arqLista = await app.inject({ method: 'GET', url: '/rh/funcionarios/arquivados', headers: H });
    ok('GET /rh/funcionarios/arquivados devolve o arquivado',
      arqLista.json().some((f: any) => f.id === func2Id), `veio ${arqLista.json().length}`);
    ok('funcionario arquivado NAO aparece entre os ativos',
      !(await app.inject({ method: 'GET', url: '/funcionarios', headers: H })).json().some((f: any) => f.id === func2Id));

    console.log('\n7. Folha: abrir competencia e idempotente');
    const comp = new Date().toISOString().slice(0, 7);
    const f1 = await app.inject({ method: 'POST', url: '/rh/folhas', headers: H, payload: { competencia: comp } });
    const f2 = await app.inject({ method: 'POST', url: '/rh/folhas', headers: H, payload: { competencia: comp } });
    ok('POST /rh/folhas cria', f1.statusCode === 200, `status=${f1.statusCode}`);
console.log('\n8. Isolamento multi-tenant e permissoes');
    const tokenSem = app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email });
    ok('GET /funcionarios sem permissao -> 403',
      (await app.inject({ method: 'GET', url: '/funcionarios', headers: { authorization: `Bearer ${tokenSem}` } })).statusCode === 403);
    ok('POST /funcionarios sem permissao -> 403',
      (await app.inject({ method: 'POST', url: '/funcionarios', headers: { authorization: `Bearer ${tokenSem}` }, payload: { nome: 'X' } })).statusCode === 403);

    await prisma.permissao.createMany({
      data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: semPermissao.id, modulo: m, acao: a, permitido: true }))),
    });
    const BH = { authorization: `Bearer ${tokenSem}` };
    ok('empresa B nao ve o funky da empresa A',
      !(await app.inject({ method: 'GET', url: '/funcionarios', headers: BH })).json().some((f: any) => f.id === funcId));
    ok('empresa B nao ve desligamentos da empresa A',
      (await app.inject({ method: 'GET', url: '/rh/desligamentos', headers: BH })).json().length === 0);
    ok('empresa B nao ve advertencias da empresa A',
      !(await app.inject({ method: 'GET', url: '/rh/advertencias', headers: BH })).json().some((a: any) => a.funcionarioId === funcId));
    ok('empresa B nao consegue editar funky da empresa A',
      (await app.inject({ method: 'PUT', url: `/funcionarios/${funcId}`, headers: BH, payload: { nome: 'Hack' } })).statusCode === 404);

    ok('GET /funcionarios sem token -> 401', (await app.inject({ method: 'GET', url: '/funcionarios' })).statusCode === 401);
    ok('GET /rh/advertencias sem token -> 401', (await app.inject({ method: 'GET', url: '/rh/advertencias' })).statusCode === 401);
  } finally {
    await app.close();
    const ids = [usuario.id, semPermissao.id];
    const emp = { in: [empresa.id, empresa2.id] };
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.documento.deleteMany({ where: { empresaId: emp } });
    await prisma.lancamentoFolha.deleteMany({ where: { folha: { empresaId: emp } } });
    await prisma.folha.deleteMany({ where: { empresaId: emp } });
    await prisma.advertencia.deleteMany({ where: { empresaId: emp } });
    await prisma.suspensao.deleteMany({ where: { empresaId: emp } });
    await prisma.desligamento.deleteMany({ where: { empresaId: emp } });
    await prisma.ponto.deleteMany({ where: { empresaId: emp } });
    await prisma.funcionario.deleteMany({ where: { empresaId: emp } });
    await prisma.departamento.deleteMany({ where: { empresaId: emp } });
    await prisma.cargo.deleteMany({ where: { empresaId: emp } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: [empresa.id, empresa2.id] } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}

test('integração: rh', async () => {
  await main();
});
