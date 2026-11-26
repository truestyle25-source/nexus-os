/**
 * TESTE — Correções da análise da aba RH (26/11/2026).
 * A1 suspensão ≤ 30 dias · A2 folha reprocessada com quem saiu depois · A3 situação
 * DESLIGADO só pela aba Desligamento · A4 batida manual · M1 indicadores · M2 desempenho
 * · M3 CPF · M4 disciplina de desligado · M6 nome obrigatório.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { generateRandomValidCpf, formatCpf } from '../src/domain/cpf.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);

test('RH: correções da análise', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test', timeout: 300_000 }, async (t) => {
  const { app } = await import('../src/server.js');
  await app.ready();
  const empresa = await prisma.empresa.create({ data: { nome: `RhAnalise ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const gestor = await prisma.usuario.create({ data: { empresaId: empresa.id, nome: 'Gestor', email: `g-${SUF}@teste.local`, senhaHash: 'x', cargo: 'GESTOR' } });
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: gestor.id, modulo: m, acao: a, permitido: true }))) });
  const H = { authorization: `Bearer ${app.jwt.sign({ id: gestor.id, empresaId: empresa.id, email: gestor.email, jti: `j-${SUF}`, emitidoEmMs: Date.now() } as any)}` };
  const criar = async (payload: any) => { const r = await app.inject({ method: 'POST', url: '/funcionarios', headers: H, payload }); assert.equal(r.statusCode, 200, r.body); return r.json(); };

  try {
    const ana = await criar({ nome: 'Ana Ativa', salario: 3000, dataAdmissao: '2025-01-10' });
    // Desligado em data fixa no passado recente, direto no banco (cenário da folha).
    const bruno = await criar({ nome: 'Bruno Saiu', salario: 3000, dataAdmissao: '2025-01-10' });
    await prisma.funcionario.update({ where: { id: bruno.id }, data: { status: 'DESLIGADO', dataDesligamento: new Date('2026-11-15T00:00:00Z') } });

    await t.test('A1: suspensão acima de 30 dias é recusada; 30 passa', async () => {
      const r = await app.inject({ method: 'POST', url: '/rh/suspensoes', headers: H, payload: { funcionarioId: ana.id, dias: 31, motivo: 'Teste' } });
      assert.equal(r.statusCode, 422); assert.match(r.body, /474/);
      const ok = await app.inject({ method: 'POST', url: '/rh/suspensoes', headers: H, payload: { funcionarioId: ana.id, dias: 30, motivo: 'Teste', fim: '2030-01-01' } });
      assert.equal(ok.statusCode, 200, ok.body);
      const s = ok.json(); const dias = Math.round((new Date(s.fim).getTime() - new Date(s.inicio).getTime()) / 86400000) + 1;
      assert.equal(dias, 30, 'o fim enviado à parte não estica a suspensão');
    });

    await t.test('M4: desligado não recebe advertência nem suspensão; tipo inválido recusado', async () => {
      assert.equal((await app.inject({ method: 'POST', url: '/rh/advertencias', headers: H, payload: { funcionarioId: bruno.id, motivo: 'x' } })).statusCode, 409);
      assert.equal((await app.inject({ method: 'POST', url: '/rh/suspensoes', headers: H, payload: { funcionarioId: bruno.id, dias: 1, motivo: 'x' } })).statusCode, 409);
      assert.equal((await app.inject({ method: 'POST', url: '/rh/advertencias', headers: H, payload: { funcionarioId: ana.id, motivo: 'x', tipo: 'GRAVISSIMA' } })).statusCode, 400);
    });

    await t.test('A2: folha de outubro reprocessada inclui quem saiu em novembro; a de novembro não', async () => {
      const out = (await app.inject({ method: 'POST', url: '/rh/folhas', headers: H, payload: { competencia: '2026-10' } })).json();
      assert.equal((await app.inject({ method: 'POST', url: `/rh/folhas/${out.id}/processar`, headers: H })).statusCode, 200);
      const doOut = await prisma.lancamentoFolha.count({ where: { folhaId: out.id, funcionarioId: bruno.id } });
      assert.ok(doOut > 0, 'Bruno trabalhou em outubro');
      const nov = (await app.inject({ method: 'POST', url: '/rh/folhas', headers: H, payload: { competencia: '2026-11' } })).json();
      assert.equal((await app.inject({ method: 'POST', url: `/rh/folhas/${nov.id}/processar`, headers: H })).statusCode, 200);
      assert.equal(await prisma.lancamentoFolha.count({ where: { folhaId: nov.id, funcionarioId: bruno.id } }), 0, 'no mês do desligamento o saldo vai na rescisão');
      assert.ok((await prisma.lancamentoFolha.count({ where: { folhaId: nov.id, funcionarioId: ana.id } })) > 0);
    });

    await t.test('A3: edição não desliga; desligado com registro não volta pela edição; antigo sem registro volta', async () => {
      const r = await app.inject({ method: 'PUT', url: `/funcionarios/${ana.id}`, headers: H, payload: { nome: 'Ana Ativa', status: 'DESLIGADO' } });
      assert.equal(r.statusCode, 409);
      assert.equal((await app.inject({ method: 'POST', url: '/funcionarios', headers: H, payload: { nome: 'Nasce Desligado', status: 'DESLIGADO' } })).statusCode, 409);
      // Bruno: desligado antigo, sem registro de desligamento → pode voltar.
      const volta = await app.inject({ method: 'PUT', url: `/funcionarios/${bruno.id}`, headers: H, payload: { nome: 'Bruno Saiu', status: 'ATIVO' } });
      assert.equal(volta.statusCode, 200, volta.body);
      // Com registro: desliga pela aba e tenta voltar pela edição → recusado.
      const hoje = new Date().toISOString().slice(0, 10);
      assert.equal((await app.inject({ method: 'POST', url: '/rh/desligamentos', headers: H, payload: { funcionarioId: bruno.id, data: hoje, tipo: 'pedido', motivo: 'Pedido' } })).statusCode, 200);
      const tenta = await app.inject({ method: 'PUT', url: `/funcionarios/${bruno.id}`, headers: H, payload: { nome: 'Bruno Saiu', status: 'ATIVO' } });
      assert.equal(tenta.statusCode, 409); assert.match(tenta.body, /cancele o desligamento/);
    });

    await t.test('A4: batida manual recusa desligado, dia futuro e dia passado sem horário; dia passado usa o horário informado', async () => {
      assert.equal((await app.inject({ method: 'POST', url: '/ponto/manual', headers: H, payload: { funcionarioId: bruno.id, tipo: 'ENTRADA' } })).statusCode, 409);
      assert.equal((await app.inject({ method: 'POST', url: '/ponto/manual', headers: H, payload: { funcionarioId: ana.id, tipo: 'ENTRADA', data: '2099-01-01', hora: '08:00' } })).statusCode, 422);
      assert.equal((await app.inject({ method: 'POST', url: '/ponto/manual', headers: H, payload: { funcionarioId: ana.id, tipo: 'ENTRADA', data: '2026-11-02' } })).statusCode, 422);
      const ok = await app.inject({ method: 'POST', url: '/ponto/manual', headers: H, payload: { funcionarioId: ana.id, tipo: 'ENTRADA', data: '2026-11-02', hora: '08:05' } });
      assert.equal(ok.statusCode, 200, ok.body);
      const p = await prisma.ponto.findFirstOrThrow({ where: { funcionarioId: ana.id, data: new Date('2026-11-02T00:00:00Z') } });
      assert.equal(p.entrada!.toISOString().slice(0, 10), '2026-11-02', 'a batida fica no próprio dia, não com a data de hoje');
      assert.equal((await app.inject({ method: 'POST', url: '/ponto/manual', headers: H, payload: { funcionarioId: ana.id, tipo: 'ENTRADA' } })).statusCode, 200, 'hoje sem horário continua valendo');
    });

    await t.test('M1/M2: indicadores e desempenho não contam desligados de meses anteriores', async () => {
      const antigo = await criar({ nome: 'Carlos Antigo', dataAdmissao: '2024-01-10' });
      await prisma.funcionario.update({ where: { id: antigo.id }, data: { status: 'DESLIGADO', dataDesligamento: new Date('2025-06-01T00:00:00Z') } });
      const ind = (await app.inject({ method: 'GET', url: '/rh/indicadores', headers: H })).json();
      const quadro = await prisma.funcionario.count({ where: { empresaId: empresa.id, status: { notIn: ['DESLIGADO', 'ARQUIVADO'] } } });
      assert.equal(ind.totalFuncionarios, quadro);
      const des = (await app.inject({ method: 'GET', url: '/rh/desempenho', headers: H })).body;
      assert.ok(!des.includes('Carlos Antigo'));
      assert.ok(des.includes('Ana Ativa'));
    });

    await t.test('M3: CPF inválido recusado; o mesmo CPF com e sem pontos é duplicado', async () => {
      assert.equal((await app.inject({ method: 'POST', url: '/funcionarios', headers: H, payload: { nome: 'Cpf Ruim', cpf: '111.111.111-11' } })).statusCode, 422);
      const cpf = generateRandomValidCpf();
      await criar({ nome: 'Cpf Um', cpf: formatCpf(cpf) });
      const dup = await app.inject({ method: 'POST', url: '/funcionarios', headers: H, payload: { nome: 'Cpf Dois', cpf } });
      assert.equal(dup.statusCode, 409); assert.match(dup.body, /Cpf Um/);
      // Cadastro antigo com CPF inválido continua editável se o CPF não mudar.
      await prisma.funcionario.update({ where: { id: ana.id }, data: { cpf: '000' } });
      assert.equal((await app.inject({ method: 'PUT', url: `/funcionarios/${ana.id}`, headers: H, payload: { nome: 'Ana Ativa', cpf: '000', telefone: '11999990000' } })).statusCode, 200);
    });

    await t.test('M6: departamento e cargo sem nome dão mensagem clara (400), não erro interno', async () => {
      assert.equal((await app.inject({ method: 'POST', url: '/departamentos', headers: H, payload: {} })).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url: '/cargos', headers: H, payload: { nome: ' ' } })).statusCode, 400);
    });
  } finally {
    const id = empresa.id;
    await prisma.lancamentoFolha.deleteMany({ where: { folha: { empresaId: id } } }).catch(() => {});
    await prisma.folha.deleteMany({ where: { empresaId: id } }).catch((e) => console.log('[limpeza folha]', String(e.message).slice(0, 120)));
    await prisma.desligamento.deleteMany({ where: { empresaId: id } }).catch(() => {});
    await prisma.suspensao.deleteMany({ where: { empresaId: id } });
    await prisma.advertencia.deleteMany({ where: { empresaId: id } });
    await prisma.ponto.deleteMany({ where: { empresaId: id } });
    await prisma.auditoria.deleteMany({ where: { empresaId: id } });
    await prisma.funcionario.deleteMany({ where: { empresaId: id } });
    await prisma.cargo.deleteMany({ where: { empresaId: id } }); await prisma.departamento.deleteMany({ where: { empresaId: id } });
    await prisma.permissao.deleteMany({ where: { usuario: { empresaId: id } } }); await prisma.usuario.deleteMany({ where: { empresaId: id } });
    await prisma.empresa.delete({ where: { id } }).catch((err) => console.log('[limpeza]', String(err.message).match(/constraint[^\n]*/)?.[0]));
    await app.close();
  }
});
