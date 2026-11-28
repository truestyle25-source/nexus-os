/**
 * NEXUS CLUB — Fase 7: promoções do clube.
 * Regra única de preço (pura) e, com o Postgres de teste, a API real: permissões de marketing,
 * alçada de desconto (mesmas faixas do PDV), nunca abaixo do custo, ciclo de vida, vitrine do
 * cliente (só membros, só ativas, por filial) e isolamento entre lojas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { promocoesClubeRoutes } from '../src/modules/clube/promocoes.routes.js';
import { emitirCrachaConsumidor } from '../src/modules/clube/token-consumidor.js';
import { precoComPromocao, situacaoPromocao, percentualDesconto, type PromocaoParaPreco } from '../src/modules/clube/preco-clube.js';
import { TERMOS_OBRIGATORIOS_CADASTRO, termosVigentes } from '../src/modules/clube/consentimento.service.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const H = 3600_000;

test('regra única de preço: menor preço entre as promoções que valem para a pessoa e a filial', () => {
  const agora = new Date('2026-12-10T12:00:00Z');
  const p = (o: Partial<PromocaoParaPreco>): PromocaoParaPreco => ({ id: Math.random().toString(), tipo: 'TODOS', status: 'PUBLICADA', precoPromocional: 9, inicio: new Date(agora.getTime() - H), fim: new Date(agora.getTime() + H), todasFiliais: true, filiais: [], ...o });
  const todos = p({ precoPromocional: 9 }); const membros = p({ tipo: 'MEMBROS', precoPromocional: 8 });
  assert.equal(precoComPromocao(10, [todos, membros], { membro: false, agora }).preco, 9, 'não membro: só a de todos');
  assert.equal(precoComPromocao(10, [todos, membros], { membro: true, agora }).preco, 8, 'membro: a menor');
  assert.equal(precoComPromocao(10, [p({ inicio: new Date(agora.getTime() + 1) })], { membro: true, agora }).preco, 10, 'agendada não vale');
  assert.equal(precoComPromocao(10, [p({ fim: agora })], { membro: true, agora }).preco, 10, 'vencida não vale');
  assert.equal(precoComPromocao(10, [p({ status: 'RASCUNHO' })], { membro: true, agora }).preco, 10, 'rascunho não vale');
  assert.equal(precoComPromocao(10, [p({ precoPromocional: 12 })], { membro: true, agora }).preco, 10, 'nunca encarece');
  const soF1 = p({ todasFiliais: false, filiais: ['f1'], precoPromocional: 7 });
  assert.equal(precoComPromocao(10, [soF1], { membro: true, filialId: 'f2', agora }).preco, 10, 'outra filial');
  assert.deepEqual(precoComPromocao(10, [soF1], { membro: true, filialId: 'f1', agora }), { preco: 7, promocao: soF1, desconto: 3 });
  assert.equal(situacaoPromocao(p({ inicio: new Date(agora.getTime() + H) }), agora), 'AGENDADA');
  assert.equal(situacaoPromocao(p({}), agora), 'ATIVA');
  assert.equal(situacaoPromocao(p({ fim: new Date(agora.getTime() - 1) }), agora), 'VENCIDA');
  assert.equal(percentualDesconto(24.9, 19.9), 20.1);
});

test('NEXUS CLUB — promoções (API)', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const antes = Object.fromEntries(['NEXUS_CLUB_HABILITADO', 'NEXUS_CLUB_JWT_SECRET', 'NEXUS_CLUB_CPF_CHAVE', 'JWT_SECRET'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { NEXUS_CLUB_HABILITADO: 'true', NEXUS_CLUB_JWT_SECRET: randomBytes(24).toString('hex'), NEXUS_CLUB_CPF_CHAVE: randomBytes(24).toString('hex'), JWT_SECRET: randomBytes(24).toString('hex') });
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: error.issues?.[0]?.message ?? 'Dados inválidos.' });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.', detalhe: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: process.env.JWT_SECRET! });
  await registerAuthentication(app);
  await app.register(promocoesClubeRoutes);
  await app.ready();
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let b: any; try { b = r.json(); } catch { b = r.body; }
    return { s: r.statusCode, b };
  };

  const loja = async (nome: string) => {
    const e = await prisma.empresa.create({ data: { nome: `${nome} ${SUF}`, cnpj: generateRandomValidCnpj() } });
    const f1 = await prisma.filial.create({ data: { empresaId: e.id, nome: 'Centro', status: 'ATIVO' } });
    const f2 = await prisma.filial.create({ data: { empresaId: e.id, nome: 'Bairro', status: 'ATIVO' } });
    const mk = async (rotulo: string, negadas: string[]) => {
      const u = await prisma.usuario.create({ data: { empresaId: e.id, filialId: f1.id, nome: rotulo, email: `${rotulo}-${nome}-${SUF}@teste.local`.toLowerCase(), senhaHash: 'x' } });
      await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.filter((a) => !negadas.includes(`${m}.${a}`)).map((a) => ({ usuarioId: u.id, modulo: m, acao: a, permitido: true }))) });
      return { authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: e.id, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` };
    };
    const clube = await prisma.clubeConfig.create({ data: { empresaId: e.id, nome: `Clube ${nome} ${SUF}`, ativo: true, publico: true } });
    const cafe = await prisma.produto.create({ data: { empresaId: e.id, nome: `Café ${nome}`, precoVenda: 24.9, custo: 14.2, unidade: 'UN', status: 'ATIVO' } });
    return {
      e, f1, f2, clube, cafe,
      admin: await mk('admin', []), // tem vendas:editar → alçada de supervisor (até 30%)
      operador: await mk('operador', ['vendas.editar']), // só alçada de operador (até 10%)
      leitor: await mk('leitor', ['produtos.editar']),
    };
  };
  const A = await loja('LojaA'); const B = await loja('LojaB');
  const corpo = (o: Record<string, unknown> = {}) => ({ produtoId: A.cafe.id, tipo: 'MEMBROS', precoPromocional: 19.9, inicio: new Date(Date.now() - H).toISOString(), fim: new Date(Date.now() + 48 * H).toISOString(), ...o });

  // Cliente membro do clube A (com os termos vigentes aceitos).
  const vig = await termosVigentes(TERMOS_OBRIGATORIOS_CADASTRO);
  const conta = await prisma.contaConsumidor.create({ data: { nome: 'Ana', email: `ana-promo-${SUF}@teste.local`, cpfHash: `h-${SUF}`, cpfCifrado: 'x', senhaHash: 'x', status: 'ATIVA' } });
  if (vig.length) await prisma.termoAceite.createMany({ data: vig.map((v) => ({ consumidorId: conta.id, termoVersaoId: v.id })) });
  await prisma.membroClube.create({ data: { empresaId: A.e.id, consumidorId: conta.id } });
  const cliente = { authorization: `Bearer ${emitirCrachaConsumidor(conta.id).token}` };

  try {
    let ativa = '';
    await t.test('permissões e regras de preço ao publicar', async () => {
      assert.equal((await call('POST', '/clientes/clube/promocoes', A.leitor, corpo({ publicar: true }))).s, 403, 'sem produtos:editar');
      const op = await call('POST', '/clientes/clube/promocoes', A.operador, corpo({ publicar: true }));
      assert.equal(op.s, 403, '20,1% passa da alçada de operador'); assert.match(op.b.error, /supervisor/);
      assert.equal((await call('POST', '/clientes/clube/promocoes', A.admin, corpo({ precoPromocional: 24.9 }))).s, 400, 'por igual ao de');
      const custo = await call('POST', '/clientes/clube/promocoes', A.admin, corpo({ precoPromocional: 13 }));
      assert.equal(custo.s, 400); assert.match(custo.b.error, /abaixo do custo/);
      assert.equal((await call('POST', '/clientes/clube/promocoes', A.admin, corpo({ fim: new Date(Date.now() - 2 * H).toISOString() }))).s, 400, 'fim antes do início');
      assert.equal((await call('POST', '/clientes/clube/promocoes', A.admin, corpo({ filialIds: [B.f1.id] }))).s, 400, 'filial de outra loja');
      assert.equal((await call('POST', '/clientes/clube/promocoes', A.admin, corpo({ produtoId: B.cafe.id }))).s, 404, 'produto de outra loja');
      assert.equal((await call('POST', '/clientes/clube/promocoes', A.admin, corpo({ precoPromocional: 14.9, publicar: true }))).s, 403, '40% passa da alçada de supervisor');
      const ok = await call('POST', '/clientes/clube/promocoes', A.admin, corpo({ publicar: true, titulo: 'Café do clube', limitePorCliente: 3 }));
      assert.equal(ok.s, 200, JSON.stringify(ok.b)); assert.equal(ok.b.status, 'PUBLICADA');
      ativa = ok.b.id;
      const okOp = await call('POST', '/clientes/clube/promocoes', A.operador, corpo({ precoPromocional: 23, tipo: 'TODOS', publicar: true }));
      assert.equal(okOp.s, 200, 'operador publica até 10%');
    });

    let agendada = ''; let rascunho = '';
    await t.test('ciclo de vida: rascunho, agendada, ativa, encerrar e cancelar', async () => {
      rascunho = (await call('POST', '/clientes/clube/promocoes', A.admin, corpo({ precoPromocional: 21 }))).b.id;
      agendada = (await call('POST', '/clientes/clube/promocoes', A.admin, corpo({ precoPromocional: 22, filialIds: [A.f2.id], inicio: new Date(Date.now() + 24 * H).toISOString(), publicar: true }))).b.id;
      const l = await call('GET', '/clientes/clube/promocoes', A.leitor);
      const sit = Object.fromEntries(l.b.map((p: any) => [p.id, p.situacao]));
      assert.equal(sit[ativa], 'ATIVA'); assert.equal(sit[agendada], 'AGENDADA'); assert.equal(sit[rascunho], 'RASCUNHO');
      const linha = l.b.find((p: any) => p.id === ativa);
      assert.equal(linha.de, 24.9); assert.equal(linha.por, 19.9); assert.equal(linha.desconto, 20.1);
      assert.equal((await call('PUT', `/clientes/clube/promocoes/${ativa}`, A.admin, corpo({ precoPromocional: 18 }))).s, 409, 'ativa não se edita');
      assert.equal((await call('POST', `/clientes/clube/promocoes/${ativa}/cancelar`, A.admin)).s, 409, 'ativa: encerra, não cancela');
      assert.equal((await call('POST', `/clientes/clube/promocoes/${agendada}/cancelar`, A.admin)).s, 200);
      assert.equal((await call('POST', `/clientes/clube/promocoes/${rascunho}/publicar`, A.admin)).s, 200);
      assert.equal((await call('POST', `/clientes/clube/promocoes/${rascunho}/publicar`, A.admin)).s, 409, 'já publicada');
      assert.equal((await call('GET', '/clientes/clube/promocoes', B.admin)).b.length, 0, 'loja B não vê as promoções da A');
      assert.equal((await call('POST', `/clientes/clube/promocoes/${ativa}/encerrar`, B.admin)).s, 404);
      const aud = await prisma.auditoria.count({ where: { empresaId: A.e.id, entidade: 'Promocao' } });
      assert.ok(aud >= 5, 'cada passo auditado');
    });

    await t.test('vitrine do cliente: só ativas, menor preço, só da loja do clube', async () => {
      const v = await call('GET', `/club/clubes/${A.clube.id}/promocoes`, cliente);
      assert.equal(v.s, 200, JSON.stringify(v.b));
      const precos = v.b.map((p: any) => p.por).sort();
      assert.deepEqual(precos, [19.9, 21, 23], 'ativa de membros + publicada agora + a de todos; sem a cancelada');
      const cafe = v.b.find((p: any) => p.id === ativa);
      assert.equal(cafe.de, 24.9); assert.equal(cafe.desconto, 20.1); assert.equal(cafe.titulo, 'Café do clube'); assert.equal(cafe.limitePorCliente, 3);
      assert.equal('custo' in cafe.produto || 'custo' in cafe, false, 'nada de custo para o cliente');
      assert.equal((await call('GET', `/club/clubes/${B.clube.id}/promocoes`, cliente)).s, 403, 'não é membro da loja B');
      await call('POST', `/clientes/clube/promocoes/${ativa}/encerrar`, A.admin);
      const v2 = await call('GET', `/club/clubes/${A.clube.id}/promocoes`, cliente);
      assert.equal(v2.b.some((p: any) => p.id === ativa), false, 'encerrada some da vitrine');
      await prisma.produto.update({ where: { id: A.cafe.id }, data: { status: 'INATIVO' } });
      assert.equal((await call('GET', `/club/clubes/${A.clube.id}/promocoes`, cliente)).b.length, 0, 'produto inativo some');
    });
  } finally {
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await app.close();
  }
});
