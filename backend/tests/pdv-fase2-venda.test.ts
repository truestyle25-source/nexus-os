import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { vendasRoutes } from '../src/modules/vendas/vendas.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { dataNoFuso } from '../src/lib/fuso.js';

// FASE 2 PDV PRO — integração real em PostgreSQL.
//   1. IDEMPOTÊNCIA: a mesma X-Idempotency-Key não gera segunda venda.
//   2. PAGAMENTO MISTO: a soma bate com o total; só o dinheiro entra na gaveta.
//   3. ALÇADA DE DESCONTO: acima da faixa do operador -> 403 do BACKEND.
test('PDV PRO FASE 2: idempotência, pagamento misto e alçada de desconto no PostgreSQL real', {
  skip: process.env.RUN_PDV_DB_TEST !== '1',
}, async () => {
  const tokenSecret = process.env.JWT_SECRET || 'secret';

  const usuarios = await prisma.usuario.findMany({
    where: { status: 'ATIVO' },
    select: { id: true, empresaId: true, email: true },
  });
  let usuario: (typeof usuarios)[number] | undefined;
  for (const candidato of usuarios) {
    const perms = await prisma.permissao.findMany({
      where: { usuarioId: candidato.id, permitido: true, modulo: { in: ['vendas', 'pdv'] } },
      select: { modulo: true, acao: true },
    });
    const podeCriar = perms.some((p) => (p.modulo === 'vendas' && p.acao === 'criar') || (p.modulo === 'pdv' && p.acao === 'criar'));
    const filiais = await prisma.filial.count({ where: { empresaId: candidato.empresaId, status: 'ATIVO' } });
    if (podeCriar && filiais > 0) { usuario = candidato; break; }
  }
  assert.ok(usuario, 'PostgreSQL precisa conter um usuário ativo com vendas/pdv:criar e uma filial ativa.');
  const filial = await prisma.filial.findFirst({ where: { empresaId: usuario.empresaId, status: 'ATIVO' }, select: { id: true, fusoHorario: true } });
  assert.ok(filial);

  const app = Fastify();
  await app.register(jwt, { secret: tokenSecret });
  await app.register(registerAuthentication);
  await app.register(vendasRoutes);
  await app.ready();
  const token = app.jwt.sign({ id: usuario.id, empresaId: usuario.empresaId, email: usuario.email }, { expiresIn: '1h' });
  const request = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, extra: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...extra }, payload });

  const runId = randomUUID();
  const produtoId = randomUUID();
  const idsCriados: string[] = [];
  let vendaIdCriada: string | null = null;

  try {
    await prisma.produto.create({
      data: {
        id: produtoId, empresaId: usuario.empresaId, nome: `PDV-FASE2-${runId}`,
        sku: `PDV-FASE2-${runId}`, codigoBarras: `789${runId.replace(/-/g, '').slice(0, 10)}`,
        custo: 5, precoVenda: 100, unidade: 'UN', status: 'ATIVO',
      },
    });
    idsCriados.push(produtoId);
    await prisma.estoque.upsert({
      where: { filialId_produtoId: { filialId: filial.id, produtoId } },
      update: { quantidade: 100 },
      create: { empresaId: usuario.empresaId, filialId: filial.id, produtoId, quantidade: 100, valorTotal: 500 },
    });

    // 1) IDEMPOTÊNCIA.
    const idemKey = `idem-${runId}`;
    const corpoVenda = {
      filialId: filial.id, formaPagamento: 'TRANSFERENCIA',
      itens: [{ produtoId, quantidade: 1, desconto: 0 }],
      pagamentos: [{ forma: 'DINHEIRO', valor: 30 }, { forma: 'TRANSFERENCIA', valor: 70 }],
    };
    const primeira = await request('POST', '/vendas', corpoVenda, { 'x-idempotency-key': idemKey });
    assert.equal(primeira.statusCode, 201, `venda deveria ser criada com 201: ${primeira.statusCode} ${primeira.body}`);
    vendaIdCriada = primeira.json().venda.id;
    const vendaPersistida = await prisma.venda.findUniqueOrThrow({ where: { id: vendaIdCriada } });
    assert.ok(vendaPersistida.dataOperacional, 'Venda nova precisa persistir a data operacional da filial.');
    assert.equal(
      vendaPersistida.dataOperacional.toISOString().slice(0, 10),
      dataNoFuso(vendaPersistida.createdAt, filial.fusoHorario),
      'Data operacional persistida deve corresponder ao instante UTC e ao fuso da filial.',
    );
    const diaOperacional = vendaPersistida.dataOperacional.toISOString().slice(0, 10);
    const listagemDoDia = await request('GET', `/vendas?filialId=${filial.id}&de=${diaOperacional}&ate=${diaOperacional}`);
    assert.equal(listagemDoDia.statusCode, 200, listagemDoDia.body);
    assert.ok(listagemDoDia.json().vendas.some((venda: { id: string }) => venda.id === vendaIdCriada), 'Filtro da aba Vendas precisa localizar pelo dia operacional da filial.');
    const retry = await request('POST', '/vendas', corpoVenda, { 'x-idempotency-key': idemKey });
    assert.equal(retry.statusCode, 201, `retry deveria reproduzir o 201 original: ${retry.statusCode} ${retry.body}`);
    assert.equal(retry.json().venda.id, vendaIdCriada, 'Retry com a mesma chave deve devolver a MESMA venda.');

    // 2) PAGAMENTO MISTO.
    const pagamentos = await prisma.vendaPagamento.findMany({ where: { vendaId: vendaIdCriada } });
    assert.equal(pagamentos.length, 2, 'Devem existir 2 linhas de pagamento (30 dinheiro + 70 PIX).');
    const soma = pagamentos.reduce((s, p) => s + Number(p.valor), 0);
    assert.equal(soma, 100, 'A soma dos pagamentos precisa bater com o total da venda.');

    // PIX e cartão não podem ser gravados como pagamentos confirmados sem provider real.
    for (const formaBloqueada of ['PIX', 'CARTAO_CREDITO']) {
      const tentativa = await request('POST', '/vendas', {
        filialId: filial.id,
        formaPagamento: formaBloqueada,
        itens: [{ produtoId, quantidade: 1, desconto: 0 }],
      }, { 'x-idempotency-key': `bloqueio-${formaBloqueada}-${runId}` });
      assert.equal(tentativa.statusCode, 503, `${formaBloqueada} sem provider deve retornar 503: ${tentativa.statusCode} ${tentativa.body}`);
    }

    // 3) ALÇADA DE DESCONTO no backend (40% exige supervisor/gerente).
    //    Torna o teste determinístico: desabilita temporariamente TODAS as
    //    permissões que poderiam autorizar o desconto e as restaura no finally.
    const permsAlcada = await prisma.permissao.findMany({
      where: {
        usuarioId: usuario.id,
        permitido: true,
        OR: [
          { modulo: 'vendas', acao: 'desconto' },
          { modulo: 'vendas', acao: 'editar' },
          { modulo: 'vendas', acao: 'gerente' },
          { modulo: 'pdv', acao: 'editar' },
        ],
      },
      select: { id: true },
    });
    for (const p of permsAlcada) {
      await prisma.permissao.update({ where: { id: p.id }, data: { permitido: false } });
    }
    const semAlcada = await request('POST', '/vendas', {
      filialId: filial.id, formaPagamento: 'DINHEIRO', desconto: 40,
      itens: [{ produtoId, quantidade: 1, desconto: 0 }],
    }, { 'x-idempotency-key': `desc-${runId}` });
    assert.equal(semAlcada.statusCode, 403, `Desconto acima da alçada deve ser rejeitado: ${semAlcada.statusCode} ${semAlcada.body}`);
    // Conta SOMENTE vendas deste run (pelo produto único do teste), evitando
    // que resíduos de execuções antigas interfiram na asserção.
    const vendasDesconto = await prisma.venda.count({
      where: { empresaId: usuario.empresaId, itens: { some: { produtoId } }, desconto: 40 },
    });
    assert.equal(vendasDesconto, 0, 'Nenhuma venda com desconto não autorizado pode ter sido gravada.');
    // Restaura as permissões antes do finally (o finally também restaura por segurança).
    for (const p of permsAlcada) {
      await prisma.permissao.update({ where: { id: p.id }, data: { permitido: true } });
    }
  } finally {
    await cleanupPdv(usuario.empresaId, filial.id, idsCriados, vendaIdCriada, runId);
    await app.close();
    await prisma.$disconnect();
  }
});

/**
 * Limpeza completa e ordenada pelas FKs. Apaga só o que o teste criou —
 * nunca toca em dados de outras execuções. Chamada no finally de cada teste.
 */
async function cleanupPdv(
  empresaId: string,
  filialId: string,
  idsCriados: string[],
  vendaIdCriada: string | null,
  runId: string,
): Promise<void> {
  try {
    const vendaIds = vendaIdCriada ? [vendaIdCriada] : [];
    if (vendaIds.length) {
      await prisma.vendaPagamento.deleteMany({ where: { vendaId: { in: vendaIds } } });
      await prisma.idempotencyKey.deleteMany({ where: { vendaId: { in: vendaIds } } });
      await prisma.financeiro.deleteMany({ where: { vendaId: { in: vendaIds } } });
      await prisma.estoqueMovimentacao.deleteMany({ where: { documento: { in: vendaIds } } });
      await prisma.auditoria.deleteMany({ where: { entidade: 'Venda', entidadeId: { in: vendaIds } } });
      await prisma.venda.deleteMany({ where: { id: { in: vendaIds } } });
    }
    await prisma.idempotencyKey.deleteMany({ where: { empresaId, key: { startsWith: `idem-${runId}` } } });
    await prisma.idempotencyKey.deleteMany({ where: { empresaId, key: { startsWith: `desc-${runId}` } } });
    if (idsCriados.length) {
      await prisma.estoqueMovimentacao.deleteMany({ where: { produtoId: { in: idsCriados } } });
      await prisma.estoque.deleteMany({ where: { produtoId: { in: idsCriados } } });
      await prisma.produto.deleteMany({ where: { empresaId, id: { in: idsCriados } } });
    }
  } catch (e) {
    console.error('cleanupPdv falhou (ignorado):', (e as any)?.message ?? e);
  }
}

