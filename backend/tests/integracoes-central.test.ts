/**
 * TESTE DE INTEGRAÇÃO — Central de Integrações (Fase A).
 *
 * Pela API real (Fastify + Prisma + Postgres de teste), sem mock de provedor:
 *  - catálogo e estados reais; saúde null sem integração em uso;
 *  - Asaas: validação de campos, chave do ambiente errado recusada sem rede, teste sem gravar,
 *    salvar com teste REAL na API sandbox do Asaas (chave fictícia → 401 → ERRO; sem rede →
 *    CREDENCIAIS_SALVAS), segredo cifrado no banco e nunca devolvido, "vazio = manter";
 *  - desconectar / remover (histórico preservado); provedor com bloqueio externo recusa salvar;
 *  - permissões (editar / excluir) e isolamento entre empresas; histórico sem segredos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { centralIntegracoesRoutes } from '../src/modules/integracoes/central/central.routes.js';
import { resumir } from '../src/modules/integracoes/central/central.service.js';
import { mascarar } from '../src/modules/integracoes/central/adaptadores.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);
const SEGREDO = 'segredo-teste-central-integracoes-0123456789';
// Chave com formato de sandbox, mas inexistente: o Asaas responde 401 de verdade.
const CHAVE_FALSA = `$aact_hmlg_000000000000000000000000000000${SUF}`;

test('resumo e máscara (unidade)', () => {
  assert.deepEqual(resumir([]), { conectadas: 0, comErro: 0, naoConfiguradas: 0, indisponiveis: 0, total: 0, saude: null });
  const r = resumir([{ status: 'CONECTADO' }, { status: 'CONECTADO' }, { status: 'CONECTADO' }, { status: 'EXPIRADO' }, { status: 'INDISPONIVEL' }, { status: 'NAO_CONFIGURADO' }]);
  assert.equal(r.saude, 75); assert.equal(r.comErro, 1); assert.equal(r.indisponiveis, 1);
  assert.equal(mascarar('abcdef1234'), '••••1234'); assert.equal(mascarar('ab'), '••••'); assert.equal(mascarar(null), null);
});

async function montarApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.' });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno.', detalhe: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  await app.register(centralIntegracoesRoutes);
  await app.ready();
  return app;
}

async function criarEmpresa(nome: string) {
  const empresa = await prisma.empresa.create({ data: { nome: `${nome} ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
  const mk = async (rotulo: string, negadas: string[]) => {
    const u = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: filial.id, nome: rotulo, email: `${rotulo}-${nome}-${SUF}@teste.local`.toLowerCase(), senhaHash: 'x' } });
    await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.filter((a) => !negadas.includes(`${m}.${a}`)).map((a) => ({ usuarioId: u.id, modulo: m, acao: a, permitido: true }))) });
    return u;
  };
  return { empresa, admin: await mk('admin', []), leitor: await mk('leitor', ['integracoes.editar', 'integracoes.excluir', 'integracoes.criar']) };
}

test('central de integrações — Asaas, estados, segurança e isolamento', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const app = await montarApp();
  const A = await criarEmpresa('IntA');
  const B = await criarEmpresa('IntB');
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });
  const H = tok(A.admin); const HL = tok(A.leitor); const HB = tok(B.admin);
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let body: any; try { body = r.json(); } catch { body = r.body; }
    return { s: r.statusCode, b: body, raw: r.body };
  };

  await t.test('catálogo e estados reais', async () => {
    const r = await call('GET', '/integracoes/central/painel', H);
    assert.equal(r.s, 200);
    const asaas = r.b.provedores.find((p: any) => p.id === 'asaas');
    assert.equal(asaas.disponibilidade, 'CREDENCIAIS');
    assert.ok(asaas.campos.find((c: any) => c.chave === 'apiKey').secreto);
    assert.equal(r.b.estados.find((e: any) => e.provedor === 'asaas').status, 'NAO_CONFIGURADO');
    assert.equal(r.b.estados.find((e: any) => e.provedor === 'shopify').status, 'INDISPONIVEL');
    assert.equal(r.b.resumo.saude, null);
  });

  await t.test('validação: campos obrigatórios e chave do ambiente errado (sem rede, sem gravar)', async () => {
    assert.equal((await call('PUT', '/integracoes/central/asaas', H, { ambiente: 'SANDBOX' })).s, 400);
    const t1 = await call('POST', '/integracoes/central/asaas/testar', H, { ambiente: 'PRODUCAO', apiKey: CHAVE_FALSA });
    assert.equal(t1.s, 200); assert.equal(t1.b.ok, false); assert.equal(t1.b.codigo, 'CREDENCIAL_INVALIDA');
    assert.equal(await prisma.integracaoExterno.count({ where: { empresaId: A.empresa.id, tipo: 'ASAAS' } }), 0, 'testar não grava credenciais');
    assert.equal((await call('PUT', '/integracoes/central/asaas', H, { ambiente: 'OUTRO', apiKey: CHAVE_FALSA })).s, 400);
  });

  await t.test('salvar: teste real no Asaas sandbox, segredo cifrado e nunca devolvido', async () => {
    const r = await call('PUT', '/integracoes/central/asaas', H, { ambiente: 'SANDBOX', apiKey: CHAVE_FALSA });
    assert.equal(r.s, 200, r.raw.slice(0, 200));
    assert.equal(r.b.ok, false, 'chave fictícia nunca pode ficar CONECTADO');
    // 401 real do Asaas → ERRO; sem acesso à internet → falha transitória → CREDENCIAIS_SALVAS.
    assert.ok(['ERRO', 'CREDENCIAIS_SALVAS'].includes(r.b.status), r.b.codigo);
    if (r.b.status === 'ERRO') assert.equal(r.b.codigo, 'CREDENCIAL_INVALIDA');
    console.log('[asaas sandbox] resposta real:', r.b.status, r.b.codigo);
    assert.ok(!r.raw.includes(CHAVE_FALSA));
    const reg = await prisma.integracaoExterno.findFirstOrThrow({ where: { empresaId: A.empresa.id, tipo: 'ASAAS' } });
    assert.ok(reg.credenciais && !reg.credenciais.includes(CHAVE_FALSA) && !reg.credenciais.includes('aact'), 'segredo cifrado no banco');
    assert.deepEqual(reg.config, { ambiente: 'SANDBOX' });
    const g = await call('GET', '/integracoes/central/asaas', H);
    assert.equal(g.b.configuracao.segredosSalvos.apiKey, mascarar(CHAVE_FALSA));
    assert.ok(!g.raw.includes(CHAVE_FALSA));
    assert.ok(g.b.erro);
  });

  await t.test('vazio = manter o segredo salvo; troca registrada sem valor', async () => {
    const antes = (await prisma.integracaoExterno.findFirstOrThrow({ where: { empresaId: A.empresa.id, tipo: 'ASAAS' } })).credenciais;
    const r = await call('PUT', '/integracoes/central/asaas', H, { ambiente: 'SANDBOX', apiKey: '' });
    assert.equal(r.s, 200);
    const g = await call('GET', '/integracoes/central/asaas', H);
    assert.equal(g.b.configuracao.segredosSalvos.apiKey, mascarar(CHAVE_FALSA), 'credencial anterior mantida');
    assert.ok(antes);
    const nova = `${CHAVE_FALSA}x`;
    await call('PUT', '/integracoes/central/asaas', H, { ambiente: 'SANDBOX', apiKey: nova });
    const h = await call('GET', '/integracoes/central/asaas/historico', H);
    assert.ok(h.b.eventos.some((e: any) => e.operacao === 'SALVAR' && /substitu/.test(e.mensagem ?? '')));
    assert.ok(!h.raw.includes(CHAVE_FALSA.slice(11)), 'histórico nunca tem segredo');
    assert.ok(h.b.eventos.some((e: any) => e.operacao === 'TESTAR'));
  });

  await t.test('permissões: sem editar/excluir não testa, não salva, não remove', async () => {
    assert.equal((await call('GET', '/integracoes/central/asaas', HL)).s, 200);
    assert.equal((await call('POST', '/integracoes/central/asaas/testar', HL, {})).s, 403);
    assert.equal((await call('PUT', '/integracoes/central/asaas', HL, { ambiente: 'SANDBOX', apiKey: CHAVE_FALSA })).s, 403);
    assert.equal((await call('POST', '/integracoes/central/asaas/desconectar', HL)).s, 403);
    assert.equal((await call('DELETE', '/integracoes/central/asaas', HL)).s, 403);
    assert.equal((await call('GET', '/integracoes/central/painel', {})).s, 401);
  });

  await t.test('isolamento entre empresas', async () => {
    const g = await call('GET', '/integracoes/central/asaas', HB);
    assert.equal(g.b.status, 'NAO_CONFIGURADO');
    assert.equal(Object.values(g.b.configuracao.segredosSalvos).filter(Boolean).length, 0);
    assert.equal((await call('GET', '/integracoes/central/asaas/historico', HB)).b.eventos.length, 0);
    assert.equal((await call('POST', '/integracoes/central/asaas/desconectar', HB)).s, 404);
    // empresaId no corpo é ignorado: a gravação vai sempre para a empresa da sessão.
    await call('POST', '/integracoes/central/asaas/testar', HB, { empresaId: A.empresa.id, ambiente: 'PRODUCAO', apiKey: CHAVE_FALSA });
    assert.equal(await prisma.integracaoEvento.count({ where: { empresaId: B.empresa.id } }), 1);
  });

  await t.test('provedor indisponível e inexistente', async () => {
    const r = await call('PUT', '/integracoes/central/shopify', H, { x: 'y' });
    assert.equal(r.s, 409); assert.match(r.b.error, /Shopify Partners/);
    assert.equal((await call('GET', '/integracoes/central/inexistente', H)).s, 404);
    assert.equal((await call('GET', '/integracoes/central/..%2Fadmin', H)).s, 400);
  });

  await t.test('desconectar apaga segredos; remover apaga a configuração e preserva o histórico', async () => {
    const d = await call('POST', '/integracoes/central/asaas/desconectar', H);
    assert.equal(d.s, 200);
    const reg = await prisma.integracaoExterno.findFirstOrThrow({ where: { empresaId: A.empresa.id, tipo: 'ASAAS' } });
    assert.equal(reg.credenciais, null); assert.equal(reg.status, 'DESCONECTADO');
    const eventosAntes = await prisma.integracaoEvento.count({ where: { empresaId: A.empresa.id, provedor: 'asaas' } });
    assert.equal((await call('DELETE', '/integracoes/central/asaas', H)).s, 200);
    assert.equal(await prisma.integracaoExterno.count({ where: { empresaId: A.empresa.id, tipo: 'ASAAS' } }), 0);
    assert.equal(await prisma.integracaoEvento.count({ where: { empresaId: A.empresa.id, provedor: 'asaas' } }), eventosAntes + 1);
    assert.equal((await call('GET', '/integracoes/central/asaas', H)).b.status, 'NAO_CONFIGURADO');
  });

  await app.close();
  for (const e of [A, B]) {
    await prisma.integracaoEvento.deleteMany({ where: { empresaId: e.empresa.id } });
    await prisma.integracaoExterno.deleteMany({ where: { empresaId: e.empresa.id } });
    await prisma.permissao.deleteMany({ where: { usuario: { empresaId: e.empresa.id } } });
    await prisma.usuario.deleteMany({ where: { empresaId: e.empresa.id } });
    await prisma.filial.deleteMany({ where: { empresaId: e.empresa.id } });
    await prisma.empresa.delete({ where: { id: e.empresa.id } });
  }
});
