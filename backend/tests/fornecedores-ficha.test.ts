/**
 * TESTE DE INTEGRAÇÃO — cadastro completo de fornecedores (ficha por abas).
 *
 * Pela API real (Fastify + Prisma + Postgres de teste):
 *  - criar (campos obrigatórios, CNPJ/CPF válidos, duplicidade, código sequencial), editar, consultar;
 *  - vários contatos (principal único, não exclui o último, espelho nos campos antigos);
 *  - dados bancários protegidos (mascarados e bloqueados sem fornecedores.administrar; auditoria sem valor);
 *  - produtos do fornecedor (vínculo N:N com o catálogo, referência e preço por fornecedor,
 *    histórico de preço, principal espelhado no produto, remover vínculo sem excluir produto,
 *    último preço atualizado pelo recebimento de compra);
 *  - bloquear: fornecedor bloqueado/inativo não recebe pedido; ativo e crítico recebem;
 *  - avaliação, documentos (storage ausente → 503 claro), alertas de certidões, histórico real;
 *  - listagem (código, UF, busca por código) e KPIs por status; isolamento entre empresas; permissões.
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
import { generateRandomValidCpf } from '../src/domain/cpf.js';
import { fornecedoresRoutes } from '../src/modules/fornecedores/fornecedores.routes.js';
import { fornecedorFichaRoutes } from '../src/modules/fornecedores/fornecedor-ficha.routes.js';
import { comprasRoutes } from '../src/modules/compras/compras.routes.js';
import { produtosRoutes } from '../src/modules/produtos/produtos.routes.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);
const SEGREDO = 'segredo-teste-fornecedores-ficha-0123456789';

async function montarApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.', detalhes: error.issues });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.', detalhe: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  for (const r of [fornecedoresRoutes, fornecedorFichaRoutes, comprasRoutes, produtosRoutes]) await app.register(r);
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
  return { empresa, filial, admin: await mk('admin', []), comprador: await mk('comprador', ['fornecedores.administrar', 'fornecedores.criar', 'fornecedores.excluir']) };
}

test('fornecedores — cadastro completo por abas', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  // Sem storage configurado neste teste (o envio de arquivo deve falhar com mensagem clara).
  const bucketOriginal = process.env.STORAGE_BUCKET;
  delete process.env.STORAGE_BUCKET;
  const app = await montarApp();
  const A = await criarEmpresa('FornA');
  const B = await criarEmpresa('FornB');
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });
  const H = tok(A.admin); const HC = tok(A.comprador); const HB = tok(B.admin);
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let body: any; try { body = r.json(); } catch { body = r.body; }
    return { s: r.statusCode, b: body };
  };
  const cnpj = generateRandomValidCnpj();
  const base = {
    tipoPessoa: 'JURIDICA', documento: cnpj, nome: `Distribuidora Alfa ${SUF}`, nomeFantasia: 'Alfa Embalagens', status: 'Ativo',
    filialId: A.filial.id, categoria: 'Matéria-prima', segmento: 'Embalagens plásticas', inscricaoEstadual: '123.456.789.110', cnae: '4686-9/02',
    regimeTributario: 'Simples Nacional', dataAbertura: '2015-03-15', cep: '01310-100', logradouro: 'Avenida Paulista', numero: '1000',
    bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'sp', codigoIbge: '3550308', site: 'alfa.com.br', emailPedidos: 'pedidos@alfa.com.br', emailNfe: 'nfe@alfa.com.br',
    contatos: [{ nome: 'Mariana Souza', departamento: 'Comercial', telefone: '(11) 3333-4444', whatsapp: '(11) 99999-8888', email: 'mariana@alfa.com.br', principal: true }],
  };
  let fid = '';
  let produtoId = '';
  let produto2Id = '';

  await t.test('criar: obrigatórios, CNPJ/CPF, duplicidade e código sequencial', async () => {
    const semContato = await call('POST', '/api/v1/fornecedores/ficha', H, { ...base, contatos: [] });
    assert.equal(semContato.s, 400, 'ao menos um contato');
    const semCep = await call('POST', '/api/v1/fornecedores/ficha', H, { ...base, cep: undefined });
    assert.equal(semCep.s, 422);
    assert.match(semCep.b.error, /CEP/);
    const cnpjRuim = await call('POST', '/api/v1/fornecedores/ficha', H, { ...base, documento: '11.111.111/1111-11' });
    assert.equal(cnpjRuim.s, 400);
    assert.match(cnpjRuim.b.error, /CNPJ inválido/);
    const cpfRuim = await call('POST', '/api/v1/fornecedores/ficha', H, { ...base, tipoPessoa: 'FISICA', documento: '123.456.789-00' });
    assert.equal(cpfRuim.s, 400);
    assert.match(cpfRuim.b.error, /CPF inválido/);

    const r = await call('POST', '/api/v1/fornecedores/ficha', H, base);
    assert.equal(r.s, 201, JSON.stringify(r.b).slice(0, 300));
    fid = r.b.fornecedor.id;
    assert.equal(r.b.fornecedor.codigoExibido, 'F000001', 'primeiro código da empresa');
    assert.equal(r.b.fornecedor.cnpj, cnpj.replace(/\D/g, ''));
    assert.equal(r.b.fornecedor.uf, 'SP');
    assert.equal(r.b.fornecedor.contato, 'Mariana Souza', 'principal espelhado no campo antigo');
    assert.equal(r.b.auditoria.criadoPor, 'admin', 'criado por (backend)');
    assert.equal(r.b.empresa.id, A.empresa.id);

    const dup = await call('POST', '/api/v1/fornecedores/ficha', H, { ...base, nome: 'Outro' });
    assert.equal(dup.s, 409, 'documento duplicado na empresa');
    const pf = await call('POST', '/api/v1/fornecedores/ficha', H, { ...base, tipoPessoa: 'FISICA', documento: generateRandomValidCpf(), nome: `João Autônomo ${SUF}`, nomeFantasia: null });
    assert.equal(pf.s, 201, JSON.stringify(pf.b).slice(0, 200));
    assert.equal(pf.b.fornecedor.codigoExibido, 'F000002');
    // Cadastro rápido antigo (modal) também recebe código.
    const rapido = await call('POST', '/api/v1/fornecedores', H, { nome: `Rápido ${SUF}`, categoria: 'Outros' });
    assert.equal(rapido.s, 200, JSON.stringify(rapido.b).slice(0, 200));
    assert.equal(rapido.b.codigo, 3);
    // Mesmo documento em OUTRA empresa é permitido (isolamento por empresa).
    const outraEmpresa = await call('POST', '/api/v1/fornecedores/ficha', HB, { ...base, filialId: B.filial.id });
    assert.equal((await call('POST', '/api/v1/fornecedores/ficha', HB, { ...base, documento: generateRandomValidCnpj() })).s, 404, 'filial de outra empresa recusada');
    assert.equal(outraEmpresa.s, 201);
    assert.equal(outraEmpresa.b.fornecedor.codigoExibido, 'F000001', 'código é por empresa');
  });

  await t.test('editar e consultar; auditoria campo a campo e rodapé', async () => {
    const r = await call('PUT', `/api/v1/fornecedores/${fid}/ficha`, H, { nomeFantasia: 'Alfa Embalagens Ltda', prazoEntregaDias: 5, modalidadeFrete: 'CIF', pedidoMinimo: 500, observacoes: 'Entrega só pela manhã' });
    assert.equal(r.s, 200, JSON.stringify(r.b).slice(0, 300));
    assert.equal(r.b.fornecedor.nomeFantasia, 'Alfa Embalagens Ltda');
    assert.equal(r.b.fornecedor.pedidoMinimo, 500);
    assert.equal(r.b.auditoria.atualizadoPor, 'admin');
    const limpaCidade = await call('PUT', `/api/v1/fornecedores/${fid}/ficha`, H, { cidade: '' });
    assert.equal(limpaCidade.s, 422, 'cidade é obrigatória no estado final');
    const g = await call('GET', `/api/v1/fornecedores/${fid}/ficha`, H);
    assert.equal(g.b.fornecedor.prazoEntregaDias, 5, 'persistido');
    const h = await call('GET', `/api/v1/fornecedores/${fid}/historico`, H);
    const alt = h.b.alteracoes.find((a: any) => a.campo === 'nomeFantasia');
    assert.ok(alt, 'alteração registrada');
    assert.equal(alt.anterior, 'Alfa Embalagens');
    assert.equal(alt.novo, 'Alfa Embalagens Ltda');
    assert.equal(alt.usuario, 'admin');
  });

  await t.test('contatos: vários, principal único, não exclui o último', async () => {
    const c2 = await call('POST', `/api/v1/fornecedores/${fid}/contatos`, H, { nome: 'Carlos Lima', cargo: 'Financeiro', email: 'carlos@alfa.com.br' });
    assert.equal(c2.s, 201);
    assert.equal(c2.b.principal, false);
    const c3 = await call('POST', `/api/v1/fornecedores/${fid}/contatos`, H, { nome: 'Paula Reis', celular: '(11) 98888-7777', principal: true });
    assert.equal(c3.b.principal, true);
    const lista = (await call('GET', `/api/v1/fornecedores/${fid}/contatos`, H)).b;
    assert.equal(lista.length, 3);
    assert.equal(lista.filter((c: any) => c.principal).length, 1, 'um único principal');
    assert.equal((await prisma.fornecedor.findUnique({ where: { id: fid } }))?.contato, 'Paula Reis', 'espelho atualizado');
    assert.equal((await call('PUT', `/api/v1/fornecedores/${fid}/contatos/${c3.b.id}`, H, { principal: false })).s, 409);
    for (const c of lista.filter((x: any) => x.id !== c3.b.id)) assert.equal((await call('DELETE', `/api/v1/fornecedores/${fid}/contatos/${c.id}`, H)).s, 200);
    assert.equal((await call('DELETE', `/api/v1/fornecedores/${fid}/contatos/${c3.b.id}`, H)).s, 409, 'último contato fica');
    assert.equal((await call('DELETE', `/api/v1/fornecedores/${fid}/contatos/${c3.b.id}`, HC)).s, 403, 'excluir exige permissão');
  });

  await t.test('dados bancários protegidos e auditados sem o valor', async () => {
    const semPerm = await call('PUT', `/api/v1/fornecedores/${fid}/ficha`, HC, { banco: 'Banco X', agencia: '1234', conta: '987654' });
    assert.equal(semPerm.s, 403);
    const ok = await call('PUT', `/api/v1/fornecedores/${fid}/ficha`, H, { formaPagamento: 'PIX', tipoChavePix: 'CNPJ', chavePix: cnpj, banco: 'Banco X', codigoBanco: '341', agencia: '1234', conta: '987654', contaDigito: '1', tipoConta: 'CORRENTE', titular: 'Distribuidora Alfa', limiteCredito: 25000 });
    assert.equal(ok.s, 200, JSON.stringify(ok.b).slice(0, 200));
    assert.equal(ok.b.fornecedor.conta, '987654', 'quem administra vê');
    const comprador = await call('GET', `/api/v1/fornecedores/${fid}/ficha`, HC);
    assert.equal(comprador.b.podeVerBancario, false);
    assert.equal(comprador.b.fornecedor.conta, '••••54', 'mascarado para quem não administra');
    assert.notEqual(comprador.b.fornecedor.chavePix, cnpj);
    const lista = (await call('GET', '/api/v1/fornecedores', HC)).b;
    assert.ok(!JSON.stringify(lista).includes('987654'), 'listagem nunca expõe a conta');
    const h = (await call('GET', `/api/v1/fornecedores/${fid}/historico`, H)).b;
    const conta = h.alteracoes.find((a: any) => a.campo === 'conta');
    assert.equal(conta.novo, '(protegido)', 'auditoria sem o valor bancário');
  });

  await t.test('produtos do fornecedor: vínculo, preço, histórico, principal e remoção', async () => {
    const p1 = await call('POST', '/produtos', H, { nome: `Caixa papelão ${SUF}`, sku: `CX${SUF}`, custo: 2, precoVenda: 5, ncm: '48191000' });
    const p2 = await call('POST', '/produtos', H, { nome: `Fita adesiva ${SUF}`, sku: `FT${SUF}`, custo: 1, precoVenda: 3 });
    produtoId = p1.b.id; produto2Id = p2.b.id;
    const cand = (await call('GET', `/api/v1/fornecedores/${fid}/produtos/candidatos?busca=${SUF}`, H)).b;
    assert.ok(cand.some((c: any) => c.id === produtoId), 'busca no catálogo central');
    const v = await call('POST', `/api/v1/fornecedores/${fid}/produtos`, H, { produtoId, referencia: 'ALF-CX-01', codigoFornecedor: '7788', preco: 1.8, prazoEntregaDias: 3, principal: true });
    assert.equal(v.s, 201, JSON.stringify(v.b).slice(0, 200));
    assert.equal((await call('POST', `/api/v1/fornecedores/${fid}/produtos`, H, { produtoId })).s, 409, 'sem duplicar o vínculo');
    assert.equal((await prisma.produto.findUnique({ where: { id: produtoId } }))?.fornecedorId, fid, 'principal espelhado no produto');
    const up = await call('PUT', `/api/v1/fornecedores/${fid}/produtos/${v.b.id}`, H, { preco: 1.95 });
    assert.equal(up.s, 200);
    const precos = (await call('GET', `/api/v1/fornecedores/${fid}/produtos/${produtoId}/precos`, H)).b;
    assert.deepEqual(precos.map((p: any) => [p.anterior, p.novo]), [[1.8, 1.95], [null, 1.8]], 'histórico de preços');
    // Segundo fornecedor do mesmo produto: referência própria; vira principal e o primeiro deixa de ser.
    const f2 = await call('POST', '/api/v1/fornecedores/ficha', H, { ...base, documento: generateRandomValidCnpj(), nome: `Beta Papéis ${SUF}`, nomeFantasia: 'Beta' });
    const v2 = await call('POST', `/api/v1/fornecedores/${f2.b.fornecedor.id}/produtos`, H, { produtoId, referencia: 'BETA-77', preco: 1.7, principal: true });
    assert.equal(v2.s, 201);
    assert.equal((await prisma.produto.findUnique({ where: { id: produtoId } }))?.fornecedorId, f2.b.fornecedor.id);
    const lista = (await call('GET', `/api/v1/fornecedores/${fid}/produtos`, H)).b;
    assert.equal(lista.itens[0].principal, false, 'o primeiro deixou de ser principal');
    assert.equal(lista.itens[0].outrosFornecedores[0].principal, true, 'mostra o alternativo/principal');
    assert.equal(lista.itens[0].ncm, '48191000', 'fiscal vem do cadastro central');
    const exp = (await call('GET', `/api/v1/fornecedores/${fid}/produtos/exportar`, H)).b;
    assert.match(Buffer.from(exp.base64, 'base64').toString('utf8'), /ALF-CX-01/);
    // Remover vínculo não exclui o produto nem o histórico.
    const v3 = await call('POST', `/api/v1/fornecedores/${fid}/produtos`, H, { produtoId: produto2Id, preco: 0.9 });
    assert.equal((await call('DELETE', `/api/v1/fornecedores/${fid}/produtos/${v3.b.id}`, H)).s, 200);
    assert.ok(await prisma.produto.findUnique({ where: { id: produto2Id } }), 'produto continua no catálogo');
    assert.equal(await prisma.fornecedorPrecoHistorico.count({ where: { fornecedorId: fid, produtoId: produto2Id } }), 1, 'histórico preservado');
    // Sem permissão de custo não vê nem altera preço.
    await prisma.permissao.updateMany({ where: { usuarioId: A.comprador.id, modulo: 'custos' }, data: { permitido: false } });
    const semCusto = (await call('GET', `/api/v1/fornecedores/${fid}/produtos`, HC)).b;
    assert.equal(semCusto.itens[0].preco, undefined);
    assert.equal((await call('PUT', `/api/v1/fornecedores/${fid}/produtos/${v.b.id}`, HC, { preco: 9 })).s, 403);
  });

  await t.test('pedidos: ativo recebe; bloqueado e inativo não; recebimento atualiza o último preço', async () => {
    const pedido = (h = H) => call('POST', '/compras', h, { filialId: A.filial.id, fornecedorId: fid, itens: [{ produtoId, quantidade: 10, valorUnit: 2.1 }] });
    const c = await pedido();
    assert.ok([200, 201].includes(c.s), JSON.stringify(c.b).slice(0, 200));
    await call('POST', `/compras/${c.b.id}/confirmar`, H);
    const rec = await call('POST', `/compras/${c.b.id}/receber`, H);
    assert.equal(rec.s, 200, JSON.stringify(rec.b).slice(0, 200));
    const v = await prisma.fornecedorProduto.findFirst({ where: { fornecedorId: fid, produtoId } });
    assert.equal(Number(v?.ultimoPrecoCompra), 2.1, 'último preço de compra');
    assert.ok(await prisma.fornecedorPrecoHistorico.findFirst({ where: { fornecedorId: fid, produtoId, campo: 'ULTIMA_COMPRA', origem: 'COMPRA', documento: c.b.id } }));

    assert.equal((await call('PATCH', `/fornecedores/${fid}/status`, H, { status: 'Bloqueado' })).s, 200);
    const bloqueado = await pedido();
    assert.equal(bloqueado.s, 422, JSON.stringify(bloqueado.b));
    assert.match(bloqueado.b.error, /bloqueado/);
    await call('PATCH', `/fornecedores/${fid}/status`, H, { status: 'Inativo' });
    assert.equal((await pedido()).s, 422, 'inativo não recebe');
    await call('PATCH', `/fornecedores/${fid}/status`, H, { status: 'Crítico' });
    assert.ok([200, 201].includes((await pedido()).s), 'crítico recebe (é alerta, não bloqueio)');
    await call('PUT', `/api/v1/fornecedores/${fid}/ficha`, H, { status: 'Ativo' });
  });

  await t.test('avaliação, documentos, certidões e alertas', async () => {
    assert.equal((await call('POST', `/api/v1/fornecedores/${fid}/avaliacoes`, H, { notaGeral: 6 })).s, 400);
    await call('POST', `/api/v1/fornecedores/${fid}/avaliacoes`, H, { notaGeral: 4, pontualidade: 5, qualidade: 4, preco: 3 });
    await call('POST', `/api/v1/fornecedores/${fid}/avaliacoes`, H, { notaGeral: 5, pontualidade: 4, qualidade: 5 });
    const av = (await call('GET', `/api/v1/fornecedores/${fid}/avaliacoes`, H)).b;
    assert.equal(av.medias.notaGeral, 4.5);
    assert.equal(av.indicadores, null, 'sem histórico suficiente, nenhum indicador inventado');
    assert.equal((await call('GET', `/api/v1/fornecedores/${fid}/ficha`, H)).b.resumo.notaMedia, 4.5);

    const doc = await call('POST', `/api/v1/fornecedores/${fid}/documentos`, H, { tipo: 'CARTAO_CNPJ', nome: 'Cartão CNPJ', arquivo: { nome: 'cartao.pdf', base64: Buffer.from('%PDF-1.4 teste').toString('base64') } });
    assert.equal(doc.s, 503, 'sem storage: erro claro, nada gravado');
    assert.match(doc.b.error, /STORAGE_BUCKET/);
    assert.equal((await call('GET', `/api/v1/fornecedores/${fid}/documentos`, H)).b.itens.length, 0);

    const vence = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await call('PUT', `/api/v1/fornecedores/${fid}/ficha`, H, { homologado: true, dataHomologacao: '2026-01-10', homologadoPor: 'Qualidade', validadeCndFederal: vence });
    const alertas = (await call('GET', '/api/v1/fornecedores/alertas-documentos', H)).b;
    const a = alertas.find((x: any) => x.fornecedorId === fid);
    assert.equal(a.situacao, 'A_VENCER');
    assert.equal(a.documento, 'CND federal');
  });

  await t.test('histórico real: pedidos, títulos e total do período', async () => {
    const h = (await call('GET', `/api/v1/fornecedores/${fid}/historico`, H)).b;
    assert.equal(h.totais.entregues, 1);
    assert.equal(h.totais.pendentes, 1);
    assert.equal(h.totais.compradoNoPeriodo, 42);
    assert.ok(h.financeiro, 'com financeiro.visualizar vê os títulos');
    assert.equal(h.financeiro.emAberto.length + h.financeiro.pagos.length >= 1, true, 'título gerado pelo recebimento');
    const ficha = (await call('GET', `/api/v1/fornecedores/${fid}/ficha`, H)).b;
    assert.equal(ficha.resumo.pedidos, 2);
    assert.equal(ficha.recebePedidos, true);
  });

  await t.test('listagem: código, UF, busca por código e KPIs por status', async () => {
    const porCodigo = (await call('GET', '/api/v1/fornecedores?busca=F000001', H)).b;
    assert.equal(porCodigo[0].id, fid);
    assert.equal(porCodigo[0].codigoExibido, 'F000001');
    const porUf = (await call('GET', '/api/v1/fornecedores?uf=SP', H)).b;
    assert.ok(porUf.every((f: any) => f.uf === 'SP') && porUf.length >= 2);
    await call('PATCH', `/fornecedores/${fid}/status`, H, { status: 'Bloqueado' });
    const k = (await call('GET', '/api/v1/fornecedores/kpis', H)).b;
    assert.equal(k.porStatus.bloqueados, 1);
    assert.equal((await call('GET', '/api/v1/fornecedores?status=Bloqueado', H)).b.length, 1);
    await call('PATCH', `/fornecedores/${fid}/status`, H, { status: 'Ativo' });
  });

  await t.test('isolamento entre empresas e permissões', async () => {
    for (const [m, u] of [['GET', `/api/v1/fornecedores/${fid}/ficha`], ['PUT', `/api/v1/fornecedores/${fid}/ficha`], ['GET', `/api/v1/fornecedores/${fid}/contatos`], ['GET', `/api/v1/fornecedores/${fid}/produtos`], ['GET', `/api/v1/fornecedores/${fid}/historico`], ['GET', `/api/v1/fornecedores/${fid}/avaliacoes`], ['GET', `/api/v1/fornecedores/${fid}/documentos`]] as const) {
      assert.equal((await call(m, u, HB, m === 'PUT' ? { nome: 'invasor' } : undefined)).s, 404, `${m} ${u}`);
    }
    const vinculoAlheio = await call('POST', `/api/v1/fornecedores/${(await prisma.fornecedor.findFirst({ where: { empresaId: B.empresa.id } }))!.id}/produtos`, HB, { produtoId });
    assert.equal(vinculoAlheio.s, 404, 'não vincula produto de outra empresa');
    assert.equal((await call('POST', '/api/v1/fornecedores/ficha', HC, { ...base, documento: generateRandomValidCnpj() })).s, 403, 'criar exige fornecedores.criar');
    assert.equal((await call('GET', '/api/v1/cep/123', H)).s, 400, 'CEP inválido');
  });

  await app.close();
  if (bucketOriginal !== undefined) process.env.STORAGE_BUCKET = bucketOriginal;
});
