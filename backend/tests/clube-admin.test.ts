/**
 * NEXUS CLUB — Fase 6: painel da loja (aba NEXUS CLUB em Clientes), API real + Postgres de teste.
 * Permissões (ver / editar vínculo / administrar), indicadores reais, isolamento entre lojas,
 * escolha do cadastro quando há dois com o mesmo CPF, bloqueio (desliga mensagens) e o texto
 * de autorização com versões.
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
import { encryptSecret } from '../src/lib/secrets.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { generateRandomValidCpf, formatCpf } from '../src/domain/cpf.js';
import { adminClubeRoutes } from '../src/modules/clube/admin-clube.routes.js';
import { hashCpf } from '../src/modules/clube/clube-config.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const SEGREDO = randomBytes(24).toString('hex');

test('NEXUS CLUB — painel da loja', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const antes = { cpf: process.env.NEXUS_CLUB_CPF_CHAVE, jwt: process.env.JWT_SECRET };
  process.env.NEXUS_CLUB_CPF_CHAVE = randomBytes(24).toString('hex');
  process.env.JWT_SECRET = SEGREDO;
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: error.issues?.[0]?.message ?? 'Dados inválidos.' });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.', detalhe: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  await app.register(adminClubeRoutes);
  await app.ready();

  const empresa = async (nome: string) => {
    const e = await prisma.empresa.create({ data: { nome: `${nome} ${SUF}`, cnpj: generateRandomValidCnpj() } });
    const f = await prisma.filial.create({ data: { empresaId: e.id, nome: 'Matriz', status: 'ATIVO' } });
    const mk = async (rotulo: string, negadas: string[]) => {
      const u = await prisma.usuario.create({ data: { empresaId: e.id, filialId: f.id, nome: rotulo, email: `${rotulo}-${nome}-${SUF}@teste.local`.toLowerCase(), senhaHash: 'x' } });
      await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.filter((a) => !negadas.includes(`${m}.${a}`)).map((a) => ({ usuarioId: u.id, modulo: m, acao: a, permitido: true }))) });
      return { authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: e.id, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` };
    };
    return { e, f, admin: await mk('admin', []), leitor: await mk('leitor', ['clientes.editar', 'clientes.administrar']) };
  };
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let b: any; try { b = r.json(); } catch { b = r.body; }
    return { s: r.statusCode, b };
  };
  const pessoa = async (nome: string, cpf = generateRandomValidCpf()) => ({
    cpf, conta: await prisma.contaConsumidor.create({ data: { nome, email: `${nome.toLowerCase()}-${SUF}-${randomBytes(2).toString('hex')}@teste.local`, cpfHash: hashCpf(cpf), cpfCifrado: encryptSecret(cpf), senhaHash: 'x', status: 'ATIVA' } }),
  });

  const A = await empresa('LojaA'); const B = await empresa('LojaB');

  try {
    await t.test('configuração: começa sem clube; só quem administra salva; regras de valor', async () => {
      const r0 = await call('GET', '/clientes/clube/config', A.leitor);
      assert.equal(r0.s, 200); assert.equal(r0.b.config, null);
      const corpo = { nome: 'Clube da Loja A', ativo: true, publico: true, beneficioPercentual: 5, limiteBeneficio: 20 };
      assert.equal((await call('PUT', '/clientes/clube/config', A.leitor, corpo)).s, 403, 'sem clientes.administrar');
      assert.equal((await call('PUT', '/clientes/clube/config', A.admin, { ...corpo, beneficioPercentual: 80 })).s, 400);
      const r = await call('PUT', '/clientes/clube/config', A.admin, corpo);
      assert.equal(r.s, 200, JSON.stringify(r.b)); assert.equal(r.b.config.beneficioPercentual, 5);
      const aud = await prisma.auditoria.findFirst({ where: { empresaId: A.e.id, entidade: 'ClubeConfig' } });
      assert.ok(aud, 'auditado');
      assert.equal((await call('GET', '/clientes/clube/config', B.admin)).b.config, null, 'loja B não vê o clube da A');
    });

    let pendente = ''; let doisCadastros: string[] = [];
    await t.test('membros e indicadores reais (só da própria loja)', async () => {
      const ana = await pessoa('Ana'); const beto = await pessoa('Beto'); const caio = await pessoa('Caio');
      const cliAna = await prisma.cliente.create({ data: { empresaId: A.e.id, nome: 'Ana Cliente', documento: ana.cpf } });
      await prisma.membroClube.create({ data: { empresaId: A.e.id, consumidorId: ana.conta.id, clienteId: cliAna.id } });
      await prisma.membroClube.create({ data: { empresaId: A.e.id, consumidorId: caio.conta.id, status: 'SAIU', saiuEm: new Date() } });
      // Beto tem dois cadastros na loja A (com e sem pontuação no CPF): fica aguardando.
      doisCadastros = (await Promise.all([beto.cpf, formatCpf(beto.cpf)].map((d, i) => prisma.cliente.create({ data: { empresaId: A.e.id, nome: `Beto ${i + 1}`, documento: d } })))).map((c) => c.id);
      pendente = (await prisma.membroClube.create({ data: { empresaId: A.e.id, consumidorId: beto.conta.id, status: 'PENDENTE_VINCULO' } })).id;
      await prisma.membroClube.create({ data: { empresaId: B.e.id, consumidorId: ana.conta.id } }); // Ana também na loja B
      const termo = await prisma.termoVersao.create({ data: { empresaId: A.e.id, tipo: 'AUTORIZACAO_MARKETING', versao: 1, texto: 'x'.repeat(90) } });
      const ev = await prisma.consentimentoEvento.create({ data: { empresaId: A.e.id, consumidorId: ana.conta.id, canal: 'WHATSAPP', acao: 'CONCEDIDO', origem: 'APP', termoVersaoId: termo.id } });
      await prisma.consentimentoAtual.create({ data: { empresaId: A.e.id, consumidorId: ana.conta.id, canal: 'WHATSAPP', situacao: 'CONCEDIDO', eventoId: ev.id } });
      await prisma.venda.create({ data: { empresaId: A.e.id, filialId: A.f.id, clienteId: cliAna.id, subtotal: 50, total: 50, status: 'FINALIZADA' } });

      const v = await call('GET', '/clientes/clube/visao-geral', A.leitor);
      assert.equal(v.s, 200, JSON.stringify(v.b));
      assert.deepEqual(
        [v.b.indicadores.membrosAtivos, v.b.indicadores.aguardandoVinculo, v.b.indicadores.sairam, v.b.indicadores.autorizamWhatsapp, v.b.indicadores.comprasMembros30dias, v.b.indicadores.valorMembros30dias],
        [1, 1, 1, 1, 1, 50],
      );
      const vb = await call('GET', '/clientes/clube/visao-geral', B.admin);
      assert.equal(vb.b.indicadores.membrosAtivos, 1, 'loja B conta só a carteirinha dela');
      assert.equal(vb.b.indicadores.autorizamWhatsapp, 0, 'autorização na A não aparece na B');

      const m = await call('GET', '/clientes/clube/membros', A.leitor);
      assert.equal(m.s, 200); assert.equal(m.b.length, 3);
      const anaLinha = m.b.find((x: any) => x.cliente?.nome === 'Ana Cliente');
      assert.match(anaLinha.cliente.documento, /^\*\*\*\.\d{3}\.\d{3}-\*\*$/, 'CPF mascarado');
      assert.deepEqual(anaLinha.autoriza, { WHATSAPP: true, EMAIL: false, APP: false });
      assert.ok(!JSON.stringify(m.b).includes(ana.conta.email), 'a loja não recebe o e-mail da conta global');
      assert.equal((await call('GET', '/clientes/clube/membros?status=PENDENTE_VINCULO', A.leitor)).b.length, 1);
    });

    await t.test('pendente: a loja escolhe entre os cadastros com o mesmo CPF', async () => {
      const c = await call('GET', `/clientes/clube/membros/${pendente}/candidatos`, A.leitor);
      assert.equal(c.s, 200); assert.deepEqual(c.b.map((x: any) => x.id).sort(), [...doisCadastros].sort());
      assert.equal((await call('GET', `/clientes/clube/membros/${pendente}/candidatos`, B.admin)).s, 404, 'loja B não vê a carteirinha da A');
      assert.equal((await call('POST', `/clientes/clube/membros/${pendente}/vincular`, A.leitor, { clienteId: doisCadastros[0] })).s, 403, 'sem clientes.editar');
      const outro = await prisma.cliente.create({ data: { empresaId: A.e.id, nome: 'Outra pessoa' } });
      assert.equal((await call('POST', `/clientes/clube/membros/${pendente}/vincular`, A.admin, { clienteId: outro.id })).s, 400, 'só um dos candidatos');
      assert.equal((await call('POST', `/clientes/clube/membros/${pendente}/vincular`, B.admin, { clienteId: doisCadastros[0] })).s, 404);
      assert.equal((await call('POST', `/clientes/clube/membros/${pendente}/vincular`, A.admin, { clienteId: doisCadastros[0] })).s, 200);
      const m = await prisma.membroClube.findUniqueOrThrow({ where: { id: pendente } });
      assert.equal(m.status, 'ATIVO'); assert.equal(m.clienteId, doisCadastros[0]);
    });

    await t.test('bloquear desliga as mensagens da pessoa nesta loja; desbloquear volta', async () => {
      const ana = await prisma.membroClube.findFirstOrThrow({ where: { empresaId: A.e.id, cliente: { nome: 'Ana Cliente' } } });
      assert.equal((await call('POST', `/clientes/clube/membros/${ana.id}/bloquear`, A.leitor)).s, 403);
      assert.equal((await call('POST', `/clientes/clube/membros/${ana.id}/bloquear`, B.admin)).s, 404);
      assert.equal((await call('POST', `/clientes/clube/membros/${ana.id}/bloquear`, A.admin)).s, 200);
      const atual = await prisma.consentimentoAtual.findFirstOrThrow({ where: { empresaId: A.e.id, consumidorId: ana.consumidorId, canal: 'WHATSAPP' } });
      assert.equal(atual.situacao, 'REVOGADO');
      const ev = await prisma.consentimentoEvento.findFirstOrThrow({ where: { empresaId: A.e.id, consumidorId: ana.consumidorId, acao: 'REVOGADO' } });
      assert.equal(ev.origem, 'GESTOR'); assert.ok(ev.registradoPorId, 'quem bloqueou fica registrado');
      assert.equal((await prisma.membroClube.findUniqueOrThrow({ where: { id: ana.id } })).status, 'BLOQUEADO');
      assert.equal((await call('POST', `/clientes/clube/membros/${ana.id}/desbloquear`, A.admin)).s, 200);
      assert.equal((await prisma.membroClube.findUniqueOrThrow({ where: { id: ana.id } })).status, 'ATIVO');
    });

    await t.test('texto de autorização: versões, sem campos em aberto, só quem administra', async () => {
      const texto = 'Autorizo a Loja A a me enviar ofertas e avisos pelos canais que eu escolher no NEXUS CLUB. Posso desligar quando quiser.';
      assert.equal((await call('POST', '/clientes/clube/termos', A.leitor, { texto })).s, 403);
      assert.equal((await call('POST', '/clientes/clube/termos', A.admin, { texto: 'curto' })).s, 400);
      assert.equal((await call('POST', '/clientes/clube/termos', A.admin, { texto: `${texto} Contato: [E-MAIL DA LOJA].` })).s, 400);
      const r = await call('POST', '/clientes/clube/termos', A.admin, { texto });
      assert.equal(r.s, 201); assert.equal(r.b.versao, 2, 'versão nova depois da 1');
      assert.equal((await call('POST', '/clientes/clube/termos', A.admin, { texto })).b.igual, true, 'mesmo texto não cria versão');
      const l = await call('GET', '/clientes/clube/termos', A.leitor);
      assert.deepEqual(l.b.map((x: any) => x.versao), [2, 1]);
      assert.equal(l.b[1].autorizacoes, 1, 'quantas autorizações usaram cada versão');
      assert.equal((await call('GET', '/clientes/clube/termos', B.admin)).b.length, 0);
    });
  } finally {
    if (antes.cpf === undefined) delete process.env.NEXUS_CLUB_CPF_CHAVE; else process.env.NEXUS_CLUB_CPF_CHAVE = antes.cpf;
    if (antes.jwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = antes.jwt;
    await app.close();
  }
});
