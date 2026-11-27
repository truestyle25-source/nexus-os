/**
 * TESTE — RH e login do sistema.
 * - O acesso é definido só em Usuários (cargo do login); departamento/cargo do RH não mexem nele.
 * - Card e lista de login mostram o login e o cargo dele.
 * - Desligar o funcionário (edição ou aba Desligamento) desativa o login e derruba a sessão.
 * - Ninguém desliga a si mesmo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);

test('RH e login: acesso só por Usuários; desligar desativa o login', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test', timeout: 300_000 }, async (t) => {
  const { app } = await import('../src/server.js');
  await app.ready();
  const empresa = await prisma.empresa.create({ data: { nome: `RhLogin ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const novoUsuario = (nome: string, cargo: string | null = null) =>
    prisma.usuario.create({ data: { empresaId: empresa.id, nome, email: `${nome.toLowerCase()}-${SUF}@teste.local`, senhaHash: 'x', cargo } });
  const gestor = await novoUsuario('Gestor', 'GESTOR');
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: gestor.id, modulo: m, acao: a, permitido: true }))) });
  const maria = await novoUsuario('Maria', 'OPERADOR');
  await prisma.permissao.create({ data: { usuarioId: maria.id, modulo: 'dashboard', acao: 'visualizar', permitido: true } });
  const joao = await novoUsuario('Joao', 'OPERADOR');
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}-${Math.random()}`, emitidoEmMs: Date.now() } as any)}` });

  try {
    let funcMaria: any;

    await t.test('Departamento e cargo do RH não mudam o acesso do login', async () => {
      const r = await app.inject({ method: 'POST', url: '/funcionarios', headers: tok(gestor), payload: { nome: 'Maria Silva', departamentoTexto: 'Gerência', cargoTexto: 'Gerente', usuarioId: maria.id } });
      assert.equal(r.statusCode, 200, r.body); funcMaria = r.json();
      const u = await prisma.usuario.findUniqueOrThrow({ where: { id: maria.id } });
      assert.equal(u.cargo, 'OPERADOR', 'o acesso continua o definido em Usuários');
      // Troca manual em Usuários continua valendo para quem está ligado ao RH.
      assert.equal((await app.inject({ method: 'PUT', url: `/usuarios/${maria.id}/cargo`, headers: tok(gestor), payload: { cargo: 'SUPERVISOR' } })).statusCode, 200);
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: maria.id } })).cargo, 'SUPERVISOR');
    });

    await t.test('Card mostra o login e o cargo; lista de login traz o cargo', async () => {
      const lista = (await app.inject({ method: 'GET', url: '/funcionarios', headers: tok(gestor) })).json() as any[];
      const card = lista.find((f) => f.id === funcMaria.id);
      assert.equal(card.usuario.nome, 'Maria'); assert.equal(card.usuario.cargo, 'SUPERVISOR');
      assert.equal(card.usuario.senhaHash, undefined, 'não vaza dados do login');
      const vinc = (await app.inject({ method: 'GET', url: '/rh/usuarios-vinculaveis', headers: tok(gestor) })).json() as any[];
      assert.equal(vinc.find((u) => u.id === maria.id).cargo, 'SUPERVISOR');
    });

    await t.test('Desligar pela edição é recusado: desligar é pela aba Desligamento', async () => {
      const r = await app.inject({ method: 'PUT', url: '/funcionarios/' + funcMaria.id, headers: tok(gestor), payload: { nome: 'Maria Silva', usuarioId: maria.id, status: 'DESLIGADO' } });
      assert.equal(r.statusCode, 409); assert.match(r.body, /aba Desligamento/);
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: maria.id } })).status, 'ATIVO');
    });

    await t.test('Desligar pela aba Desligamento também desativa o login', async () => {
      const f = (await app.inject({ method: 'POST', url: '/funcionarios', headers: tok(gestor), payload: { nome: 'Joao Souza', usuarioId: joao.id, salario: 2000, dataAdmissao: '2025-01-10' } })).json();
      const hoje = new Date().toISOString().slice(0, 10);
      const r = await app.inject({ method: 'POST', url: '/rh/desligamentos', headers: tok(gestor), payload: { funcionarioId: f.id, data: hoje, tipo: 'pedido', motivo: 'Pedido de demissão' } });
      assert.equal(r.statusCode, 200, r.body);
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: joao.id } })).status, 'INATIVO');
    });

    await t.test('Ninguém desliga a si mesmo; cancelar avisa que o login segue desativado', async () => {
      const f = (await app.inject({ method: 'POST', url: '/funcionarios', headers: tok(gestor), payload: { nome: 'O Gestor', usuarioId: gestor.id, salario: 3000, dataAdmissao: '2025-01-10' } })).json();
      const hoje = new Date().toISOString().slice(0, 10);
      const r = await app.inject({ method: 'POST', url: '/rh/desligamentos', headers: tok(gestor), payload: { funcionarioId: f.id, data: hoje, tipo: 'pedido', motivo: 'Teste' } });
      assert.equal(r.statusCode, 403);
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: gestor.id } })).status, 'ATIVO');
      const deslJoao = await prisma.desligamento.findFirstOrThrow({ where: { empresaId: empresa.id, funcionario: { usuarioId: joao.id } } });
      const c = await app.inject({ method: 'POST', url: '/rh/desligamentos/' + deslJoao.id + '/cancelar', headers: tok(gestor), payload: { motivo: 'Lançado por engano' } });
      assert.equal(c.statusCode, 200, c.body); assert.equal(c.json().loginInativo, true);
    });
  } finally {
    await prisma.desligamento.deleteMany({ where: { empresaId: empresa.id } }).catch(() => {});
    await prisma.auditoria.deleteMany({ where: { empresaId: empresa.id } });
    await prisma.funcionario.deleteMany({ where: { empresaId: empresa.id } });
    await prisma.cargo.deleteMany({ where: { empresaId: empresa.id } });
    await prisma.departamento.deleteMany({ where: { empresaId: empresa.id } });
    await prisma.permissao.deleteMany({ where: { usuario: { empresaId: empresa.id } } }); await prisma.usuario.deleteMany({ where: { empresaId: empresa.id } });
    await prisma.empresa.delete({ where: { id: empresa.id } }).catch((err) => console.log('[limpeza]', String(err.message).match(/constraint[^\n]*/)?.[0]));
    await app.close();
  }
});
