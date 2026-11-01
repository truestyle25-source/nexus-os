import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { fiscalRoutes } from '../src/modules/fiscal/fiscal.routes.js';

const testUrl = process.env.FISCAL_TEST_DATABASE_URL;
const isIsolatedFiscalDatabase = (() => {
  if (process.env.FISCAL_TEST_DATABASE_ISOLATED !== 'yes' || !testUrl) return false;
  try {
    const url = new URL(testUrl);
    return url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' &&
      url.pathname === '/nexus_fiscal_status_test' && Boolean(url.port);
  } catch {
    return false;
  }
})();

test('GET /fiscal/status autentica, autoriza e limita o resultado à empresa/filial do usuário', {
  skip: !isIsolatedFiscalDatabase ? 'Defina explicitamente o PostgreSQL descartável fiscal de teste.' : false,
}, async () => {
  const app = Fastify();
  const jwtSecret = 'fiscal-integration-test-secret-minimum-32';
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const empresaAId = `fisc-empresa-a-${sufixo}`;
  const empresaBId = `fisc-empresa-b-${sufixo}`;
  const filialA1Id = `fisc-filial-a1-${sufixo}`;
  const filialA2Id = `fisc-filial-a2-${sufixo}`;
  const filialBId = `fisc-filial-b-${sufixo}`;
  const usuarioFilialId = `fisc-user-branch-${sufixo}`;
  const usuarioEmpresaId = `fisc-user-company-${sufixo}`;
  const usuarioSemPermissaoId = `fisc-user-denied-${sufixo}`;
  const emails = [
    `fiscal-branch-${sufixo}@test.invalid`,
    `fiscal-company-${sufixo}@test.invalid`,
    `fiscal-denied-${sufixo}@test.invalid`,
  ];

  await app.register(jwt, { secret: jwtSecret });
  await app.register(registerAuthentication);
  await app.register(fiscalRoutes);

  const token = (id: string, empresaId: string, email: string) =>
    app.jwt.sign({ id, empresaId, email }, { expiresIn: '5m' });

  try {
    await prisma.empresa.createMany({ data: [
      { id: empresaAId, nome: 'Fiscal Teste A' },
      { id: empresaBId, nome: 'Fiscal Teste B' },
    ] });
    await prisma.filial.createMany({ data: [
      { id: filialA1Id, empresaId: empresaAId, nome: 'Filial A1' },
      { id: filialA2Id, empresaId: empresaAId, nome: 'Filial A2' },
      { id: filialBId, empresaId: empresaBId, nome: 'Filial B' },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: usuarioFilialId, empresaId: empresaAId, filialId: filialA1Id, nome: 'Usuário Filial', email: emails[0], senhaHash: 'test-only' },
      { id: usuarioEmpresaId, empresaId: empresaAId, nome: 'Usuário Empresa', email: emails[1], senhaHash: 'test-only' },
      { id: usuarioSemPermissaoId, empresaId: empresaAId, filialId: filialA1Id, nome: 'Usuário Sem Permissão', email: emails[2], senhaHash: 'test-only' },
    ] });
    await prisma.permissao.createMany({ data: [
      { usuarioId: usuarioFilialId, modulo: 'fiscal', acao: 'visualizar', permitido: true },
      { usuarioId: usuarioEmpresaId, modulo: 'fiscal', acao: 'visualizar', permitido: true },
    ] });

    await app.ready();
    const semToken = await app.inject({ method: 'GET', url: '/fiscal/status' });
    assert.equal(semToken.statusCode, 401);

    const semPermissao = await app.inject({
      method: 'GET', url: '/fiscal/status',
      headers: { authorization: `Bearer ${token(usuarioSemPermissaoId, empresaAId, emails[2])}` },
    });
    assert.equal(semPermissao.statusCode, 403);

    const porFilial = await app.inject({
      method: 'GET', url: '/fiscal/status',
      headers: { authorization: `Bearer ${token(usuarioFilialId, empresaAId, emails[0])}` },
    });
    assert.equal(porFilial.statusCode, 200);
    assert.deepEqual(JSON.parse(porFilial.body).cadastro.filiais.map((f: { id: string }) => f.id), [filialA1Id]);

    const porEmpresa = await app.inject({
      method: 'GET', url: '/fiscal/status',
      headers: { authorization: `Bearer ${token(usuarioEmpresaId, empresaAId, emails[1])}` },
    });
    assert.equal(porEmpresa.statusCode, 200);
    assert.deepEqual(
      JSON.parse(porEmpresa.body).cadastro.filiais.map((f: { id: string }) => f.id).sort(),
      [filialA1Id, filialA2Id].sort(),
    );
    assert.equal(JSON.parse(porEmpresa.body).emissaoHabilitada, false);

    const tenantForjado = await app.inject({
      method: 'GET', url: '/fiscal/status',
      headers: { authorization: `Bearer ${token(usuarioFilialId, empresaBId, emails[0])}` },
    });
    assert.equal(tenantForjado.statusCode, 403);
    assert.equal(tenantForjado.body.includes(filialBId), false);
  } finally {
    await app.close();
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: [usuarioFilialId, usuarioEmpresaId, usuarioSemPermissaoId] } } });
    await prisma.usuario.deleteMany({ where: { id: { in: [usuarioFilialId, usuarioEmpresaId, usuarioSemPermissaoId] } } });
    await prisma.filial.deleteMany({ where: { id: { in: [filialA1Id, filialA2Id, filialBId] } } });
    await prisma.empresa.deleteMany({ where: { id: { in: [empresaAId, empresaBId] } } });
  }
});
