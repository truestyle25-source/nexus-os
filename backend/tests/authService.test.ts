import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, AuthError } from '../src/services/authService.js';
import { verifyJwt } from '../src/auth/jwt.js';
import {
  InMemoryCompanyRepository,
  InMemoryRoleRepository,
  InMemoryUserRepository,
  InMemoryAuditRepository,
  InMemorySessionRepository,
} from '../src/repositories/memory/index.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres-000';

function buildService() {
  const companies = new InMemoryCompanyRepository();
  const roles = new InMemoryRoleRepository();
  const users = new InMemoryUserRepository();
  const audit = new InMemoryAuditRepository();
  const sessions = new InMemorySessionRepository();
  const service = new AuthService(companies, roles, users, audit, SECRET, undefined, sessions);
  return { service, companies, roles, users, audit, sessions };
}

test('fluxo completo: criar empresa gera 7 papéis padrão e usuário admin com acesso total', async () => {
  const { service, roles } = buildService();

  const result = await service.registerCompany({
    companyName: 'True Style',
    cnpj: '11.222.333/0001-81',
    responsibleName: 'Samuel Duarte',
    email: 'samuelsantosduarte8@gmail.com',
    password: 'SenhaForte123',
    confirmPassword: 'SenhaForte123',
  });

  assert.equal(result.company.name, 'True Style');
  assert.equal(result.company.cnpj, '11222333000181'); // normalizado, sem pontuação
  assert.equal(result.company.status, 'trial');
  assert.equal(result.user.email, 'samuelsantosduarte8@gmail.com');

  const adminRole = await roles.findById(result.user.roleId);
  assert.ok(adminRole);
  assert.equal(adminRole!.name, 'admin');
  assert.ok(adminRole!.permissions.has('rh:excluir'));
});

test('registro rejeita CNPJ inválido', async () => {
  const { service } = buildService();
  await assert.rejects(
    service.registerCompany({
      companyName: 'Empresa X', cnpj: '11.111.111/1111-11', responsibleName: 'Fulano',
      email: 'a@a.com', password: 'SenhaForte123', confirmPassword: 'SenhaForte123',
    }),
    (err: unknown) => err instanceof AuthError && err.code === 'INVALID_CNPJ'
  );
});

test('registro rejeita senhas que não coincidem', async () => {
  const { service } = buildService();
  await assert.rejects(
    service.registerCompany({
      companyName: 'Empresa X', cnpj: '11.222.333/0001-81', responsibleName: 'Fulano',
      email: 'a@a.com', password: 'SenhaForte123', confirmPassword: 'Diferente123',
    }),
    (err: unknown) => err instanceof AuthError && err.code === 'PASSWORD_MISMATCH'
  );
});

test('registro rejeita CNPJ duplicado', async () => {
  const { service } = buildService();
  await service.registerCompany({
    companyName: 'Empresa X', cnpj: '11.222.333/0001-81', responsibleName: 'Fulano',
    email: 'a@a.com', password: 'SenhaForte123', confirmPassword: 'SenhaForte123',
  });
  await assert.rejects(
    service.registerCompany({
      companyName: 'Empresa Y', cnpj: '11.222.333/0001-81', responsibleName: 'Ciclano',
      email: 'b@b.com', password: 'SenhaForte123', confirmPassword: 'SenhaForte123',
    }),
    (err: unknown) => err instanceof AuthError && err.code === 'CNPJ_ALREADY_EXISTS'
  );
});

test('login com credenciais corretas retorna tokens válidos', async () => {
  const { service } = buildService();
  await service.registerCompany({
    companyName: 'True Style', cnpj: '11.222.333/0001-81', responsibleName: 'Samuel',
    email: 'samuel@truestyle.com', password: 'SenhaForte123', confirmPassword: 'SenhaForte123',
  });

  const login = await service.login({ email: 'samuel@truestyle.com', password: 'SenhaForte123' });
  const payload = verifyJwt(login.accessToken, SECRET);
  assert.equal(payload.type, 'access');
  assert.equal(login.user.email, 'samuel@truestyle.com');
});

test('login com senha errada é rejeitado com mensagem genérica (não revela qual campo errou)', async () => {
  const { service } = buildService();
  await service.registerCompany({
    companyName: 'True Style', cnpj: '11.222.333/0001-81', responsibleName: 'Samuel',
    email: 'samuel@truestyle.com', password: 'SenhaForte123', confirmPassword: 'SenhaForte123',
  });

  await assert.rejects(
    service.login({ email: 'samuel@truestyle.com', password: 'SenhaErrada' }),
    (err: unknown) => err instanceof AuthError && err.code === 'INVALID_CREDENTIALS'
  );
});

test('login com e-mail inexistente é rejeitado sem revelar que o e-mail não existe', async () => {
  const { service } = buildService();
  await assert.rejects(
    service.login({ email: 'naoexiste@nada.com', password: 'qualquercoisa' }),
    (err: unknown) => err instanceof AuthError && err.code === 'INVALID_CREDENTIALS'
  );
});

test('tentativa de login com senha errada é registrada na auditoria', async () => {
  const { service, audit } = buildService();
  const reg = await service.registerCompany({
    companyName: 'True Style', cnpj: '11.222.333/0001-81', responsibleName: 'Samuel',
    email: 'samuel@truestyle.com', password: 'SenhaForte123', confirmPassword: 'SenhaForte123',
  });

  await assert.rejects(service.login({ email: 'samuel@truestyle.com', password: 'errada' }));

  const entries = await audit.listByCompany(reg.company.id);
  const failedLogin = entries.find((e) => e.action === 'login_failed');
  assert.ok(failedLogin, 'esperava um registro de auditoria de login_failed');
});

test('login bem-sucedido também é registrado na auditoria', async () => {
  const { service, audit } = buildService();
  const reg = await service.registerCompany({
    companyName: 'True Style', cnpj: '11.222.333/0001-81', responsibleName: 'Samuel',
    email: 'samuel@truestyle.com', password: 'SenhaForte123', confirmPassword: 'SenhaForte123',
  });
  await service.login({ email: 'samuel@truestyle.com', password: 'SenhaForte123' });

  const entries = await audit.listByCompany(reg.company.id);
  assert.ok(entries.some((e) => e.action === 'login'));
  assert.ok(entries.some((e) => e.action === 'create' && e.entity === 'companies'));
});

test('rotaciona refresh token e rejeita reutilização do token antigo', async () => {
  const { service } = buildService();
  await service.registerCompany({
    companyName: 'True Style', cnpj: '11.222.333/0001-81', responsibleName: 'Samuel',
    email: 'samuel@truestyle.com', password: 'SenhaForte123', confirmPassword: 'SenhaForte123',
  });

  const login = await service.login({ email: 'samuel@truestyle.com', password: 'SenhaForte123' });
  const refreshed = await service.refreshToken(login.refreshToken, { ip: '127.0.0.1', userAgent: 'test-agent' });

  assert.notEqual(refreshed.refreshToken, login.refreshToken);
  await assert.rejects(
    () => service.refreshToken(login.refreshToken, { ip: '127.0.0.1', userAgent: 'test-agent' }),
    (err: unknown) => err instanceof AuthError && err.code === 'INVALID_REFRESH_TOKEN'
  );
});

test('logout revoga refresh token e bloqueia uso posterior', async () => {
  const { service } = buildService();
  await service.registerCompany({
    companyName: 'True Style', cnpj: '11.222.333/0001-81', responsibleName: 'Samuel',
    email: 'samuel@truestyle.com', password: 'SenhaForte123', confirmPassword: 'SenhaForte123',
  });

  const login = await service.login({ email: 'samuel@truestyle.com', password: 'SenhaForte123' });
  await service.logout(login.refreshToken);

  await assert.rejects(
    () => service.refreshToken(login.refreshToken, { ip: '127.0.0.1', userAgent: 'test-agent' }),
    (err: unknown) => err instanceof AuthError && err.code === 'INVALID_REFRESH_TOKEN'
  );
});
