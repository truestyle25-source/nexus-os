/**
 * TESTE — Cargo do RH define o cargo de referência (acessos) do login do funcionário.
 * Cobre: propagação ao salvar funcionário e ao mudar o cargo, recusa sem permissão
 * de editar usuários, recusa de mudar o próprio acesso, bloqueio da troca manual
 * e isolamento entre empresas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);

test('Cargo do RH define o acesso do login', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test', timeout: 300_000 }, async (t) => {
  const { app } = await import('../src/server.js');
  await app.ready();
  const empresa = await prisma.empresa.create({ data: { nome: `CargoRH ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const outra = await prisma.empresa.create({ data: { nome: `CargoRH Outra ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const novoUsuario = (empresaId: string, nome: string) => prisma.usuario.create({ data: { empresaId, nome, email: `${nome.toLowerCase()}-${SUF}@teste.local`, senhaHash: 'x' } });
  const gestor = await novoUsuario(empresa.id, 'Gestor');
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: gestor.id, modulo: m, acao: a, permitido: true }))) });
  // RH sem permissão de editar usuários.
  const rh = await novoUsuario(empresa.id, 'Rh');
  await prisma.permissao.createMany({ data: ['visualizar', 'criar', 'editar'].map((a) => ({ usuarioId: rh.id, modulo: 'rh', acao: a, permitido: true })) });
  const maria = await novoUsuario(empresa.id, 'Maria');
  await prisma.usuario.update({ where: { id: maria.id }, data: { cargo: 'OPERADOR' } });
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });

  try {
    let caixa: any; let gerente: any; let funcMaria: any;

    await t.test('Criar cargo com referência exige permissão de editar usuários', async () => {
      const negado = await app.inject({ method: 'POST', url: '/cargos', headers: tok(rh), payload: { nome: 'Gerente', cargoReferencia: 'SUPERVISOR' } });
      assert.equal(negado.statusCode, 403);
      caixa = (await app.inject({ method: 'POST', url: '/cargos', headers: tok(gestor), payload: { nome: 'Caixa', cargoReferencia: 'OPERADOR' } })).json();
      gerente = (await app.inject({ method: 'POST', url: '/cargos', headers: tok(gestor), payload: { nome: 'Gerente', cargoReferencia: 'SUPERVISOR' } })).json();
      assert.equal(caixa.cargoReferencia, 'OPERADOR'); assert.equal(gerente.cargoReferencia, 'SUPERVISOR');
      const invalido = await app.inject({ method: 'POST', url: '/cargos', headers: tok(gestor), payload: { nome: 'X', cargoReferencia: 'DONO' } });
      assert.equal(invalido.statusCode, 400);
    });

    await t.test('Funcionário no cargo Caixa ligado ao login: acesso igual (nada muda)', async () => {
      const r = await app.inject({ method: 'POST', url: '/funcionarios', headers: tok(rh), payload: { nome: 'Maria Silva', cargoId: caixa.id, usuarioId: maria.id } });
      assert.equal(r.statusCode, 200, r.body); funcMaria = r.json();
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: maria.id } })).cargo, 'OPERADOR');
    });

    await t.test('RH sem editar usuários não promove a Gerente; o gestor promove e as permissões mudam', async () => {
      const negado = await app.inject({ method: 'PUT', url: `/funcionarios/${funcMaria.id}`, headers: tok(rh), payload: { nome: 'Maria Silva', cargoId: gerente.id, usuarioId: maria.id } });
      assert.equal(negado.statusCode, 403); assert.match(negado.body, /Supervisor/);
      assert.equal((await prisma.funcionario.findUniqueOrThrow({ where: { id: funcMaria.id } })).cargoId, caixa.id, 'nada foi gravado');
      const ok = await app.inject({ method: 'PUT', url: `/funcionarios/${funcMaria.id}`, headers: tok(gestor), payload: { nome: 'Maria Silva', cargoId: gerente.id, usuarioId: maria.id } });
      assert.equal(ok.statusCode, 200, ok.body);
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: maria.id } })).cargo, 'SUPERVISOR');
      assert.ok(await prisma.permissao.findFirst({ where: { usuarioId: maria.id, modulo: 'pdv', acao: 'supervisor' } }));
      assert.ok(await prisma.auditoria.findFirst({ where: { empresaId: empresa.id, entidade: 'Usuario', entidadeId: maria.id, acao: 'ALTERAR_PERMISSAO' } }));
    });

    await t.test('Troca manual do cargo de um login definido pelo RH é recusada; lista mostra a origem', async () => {
      const r = await app.inject({ method: 'PUT', url: `/usuarios/${maria.id}/cargo`, headers: tok(gestor), payload: { cargo: 'GESTOR' } });
      assert.equal(r.statusCode, 409); assert.match(r.body, /definido pelo RH/);
      const lista = (await app.inject({ method: 'GET', url: '/usuarios', headers: tok(gestor) })).json() as any[];
      assert.equal(lista.find((u) => u.id === maria.id).cargoDoRh.nome, 'Gerente');
      assert.equal(lista.find((u) => u.id === gestor.id).cargoDoRh, null);
    });

    await t.test('Mudar a referência do cargo atualiza os logins nele; não muda o próprio acesso', async () => {
      const r = await app.inject({ method: 'PUT', url: `/cargos/${gerente.id}`, headers: tok(gestor), payload: { nome: 'Gerente', cargoReferencia: 'FINANCEIRO' } });
      assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().loginsAtualizados, 1);
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: maria.id } })).cargo, 'FINANCEIRO');
      // Gestor como funcionário do cargo Caixa: mudaria o próprio acesso → recusado.
      const negado = await app.inject({ method: 'POST', url: '/funcionarios', headers: tok(gestor), payload: { nome: 'O Gestor', cargoId: caixa.id, usuarioId: gestor.id } });
      assert.equal(negado.statusCode, 403); assert.match(negado.body, /próprio acesso/);
      const semRh = await app.inject({ method: 'PUT', url: `/cargos/${caixa.id}`, headers: tok(rh), payload: { nome: 'Caixa', cargoReferencia: 'GESTOR' } });
      assert.equal(semRh.statusCode, 403);
      // Só renomear (sem mexer na referência) continua liberado para o RH.
      assert.equal((await app.inject({ method: 'PUT', url: `/cargos/${caixa.id}`, headers: tok(rh), payload: { nome: 'Caixa PDV' } })).statusCode, 200);
    });

    await t.test('Outra empresa: cargo alheio não serve', async () => {
      const alheio = await prisma.cargo.create({ data: { empresaId: outra.id, nome: 'Alheio', cargoReferencia: 'GESTOR' } });
      const r = await app.inject({ method: 'PUT', url: `/funcionarios/${funcMaria.id}`, headers: tok(gestor), payload: { nome: 'Maria Silva', cargoId: alheio.id, usuarioId: maria.id } });
      assert.notEqual(r.statusCode, 200);
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: maria.id } })).cargo, 'FINANCEIRO');
    });
  } finally {
    for (const id of [empresa.id, outra.id]) {
      await prisma.auditoria.deleteMany({ where: { empresaId: id } });
      await prisma.funcionario.deleteMany({ where: { empresaId: id } });
      await prisma.cargo.deleteMany({ where: { empresaId: id } });
      await prisma.permissao.deleteMany({ where: { usuario: { empresaId: id } } }); await prisma.usuario.deleteMany({ where: { empresaId: id } });
      await prisma.empresa.delete({ where: { id } }).catch((err) => console.log('[limpeza]', String(err.message).match(/constraint[^\n]*/)?.[0]));
    }
    await app.close();
  }
});
