/**
 * TESTE DE INTEGRAÇÃO — ABA FORNECEDORES
 *
 * Esta aba é CRUD simples em cima de uma INTEGRAÇÃO com o módulo Compras: os
 * números que ela mostra (Total Comprado, Pedidos, gasto do mês, ticket médio,
 * histórico do gráfico, pendentes/atrasados e 2 dos 3 insights) só fazem
 * sentido se refletirem as compras reais.
 *
 * O bug que este teste existe para travar: `CompraFornecedor` e as colunas
 * `Fornecedor.totalComprado/totalPedidos/ultimoPedidoAt` NÃO eram escritos por
 * nenhum código da aplicação (só pela migração 202609240003, via backfill).
 * Logo, todo pedido criado DEPOIS da migração era invisível para a aba — KPIs
 * em zero, gráfico achatado e insights sempre em "sem histórico". Aqui cada
 * compra criada pelo módulo Compras precisa aparecer imediatamente na aba.
 *
 * Cobertura:
 *   1. Cadastro persiste, valida e aparece na lista.
 *   2. INTEGRAÇÃO COMPRAS: pedido novo soma em totalComprado/totalPedidos/
 *      gasto do mês/ticket/histórico.
 *   3. Compra CANCELADA não conta em nada (não é pedido).
 *   4. Pedido confirmado (PEDIDO) com mais de 30 dias vira "Atrasado".
 *   5. Listagem ordena pelo total REAL e os filtros funcionam.
 *   6. Edição (PUT) — corrige o impasse de status travado para sempre.
 *   7. Multi-tenant, permissões, exportação e detalhe.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { fornecedoresRoutes } from '../src/modules/fornecedores/fornecedores.routes.js';
import { comprasRoutes } from '../src/modules/compras/compras.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-fornecedores';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

async function main() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') {
      return reply.status(400).send({ error: 'Dados inválidos.', detalhes: (error as any).issues });
    }
    if (error instanceof ErroDeNegocio) {
      return reply.status(error.status).send({ error: error.message });
    }
    if (error?.statusCode >= 400 && error?.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    if (error?.constructor === Error) return reply.status(400).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.' });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  await app.register(fornecedoresRoutes);
  await app.register(comprasRoutes);

  const empresa = await prisma.empresa.create({
    data: { nome: `FornTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `FornOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Filial Centro' } });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, filialId: filial.id, nome: 'Admin Forn', email: `forn-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Sem Permissao', email: `semforn-${SUFIXO}@teste.local`, senhaHash },
  });
  const usuario2 = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Outro Tenant', email: `outroforn-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario2.id })) });

  const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email })}` };
  const H2 = { authorization: `Bearer ${app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email })}` };
  const ids = [usuario.id, semPermissao.id, usuario2.id];
  const req = (m: any, url: string, payload?: unknown, headers = H) => app.inject({ method: m, url, headers, payload });

  const CNPJ = `99${Date.now()}`.slice(0, 14).padEnd(14, '0');
  const linha = async (id: string) => (await req('GET', '/api/v1/fornecedores')).json().find((f: any) => f.id === id);

  try {
    console.log('\n1. Cadastro: persiste, valida e devolve');
    const criado = await req('POST', '/api/v1/fornecedores', {
      nome: `Fornecedor Alfa ${SUFIXO}`, cnpj: CNPJ, categoria: 'Malharia', status: 'Ativo',
      contato: 'Fulano', whatsapp: '(11) 90000-0000', email: 'fulano@teste.local',
      condicaoPagamento: '30 dias', produtos: 'Camisa', observacoes: 'Nota de teste',
    });
    ok('POST /api/v1/fornecedores -> 200', criado.statusCode === 200,
      `status=${criado.statusCode} corpo=${criado.body.slice(0, 180)}`);
    const f1 = criado.json();
    ok('o id é gerado pelo banco', typeof f1.id === 'string' && f1.id.length > 0);
    ok('o status volta normalizado como Ativo', f1.status === 'Ativo', `status=${f1.status}`);
    ok('o CNPJ é gravado limpo (só dígitos)', f1.cnpj === CNPJ, `cnpj=${f1.cnpj}`);
    // Persistência real: relê do banco, fora do app.
    const noBanco = await prisma.fornecedor.findUnique({ where: { id: f1.id } });
    ok('o registro foi GRAVADO no PostgreSQL', !!noBanco);
    ok('os campos sobreviveram à gravação (condição/produtos/observações)',
      noBanco?.condicaoPagamento === '30 dias' && noBanco?.produtos === 'Camisa' && noBanco?.observacoes === 'Nota de teste',
      `cond=${noBanco?.condicaoPagamento} prod=${noBanco?.produtos}`);
    ok('um fornecedor novo começa com total 0',
      Number(noBanco?.totalComprado) === 0 && noBanco?.totalPedidos === 0);
    const dup = await req('POST', '/api/v1/fornecedores', { nome: `Duplicado ${SUFIXO}`, cnpj: CNPJ, categoria: 'Outros' });
    ok('CNPJ repetido na mesma empresa -> 409', dup.statusCode === 409, `status=${dup.statusCode}`);
    ok('nome com 1 caractere -> 400',
      (await req('POST', '/api/v1/fornecedores', { nome: 'A', categoria: 'Outros' })).statusCode === 400);
    ok('categoria inválida -> 400',
      (await req('POST', '/api/v1/fornecedores', { nome: `X ${SUFIXO}`, categoria: 'Inexistente' })).statusCode === 400);
    ok('email inválido -> 400',
      (await req('POST', '/api/v1/fornecedores', { nome: `Y ${SUFIXO}`, categoria: 'Outros', email: 'nao-e-email' })).statusCode === 400);

    console.log('\n2. INTEGRAÇÃO COM COMPRAS: o pedido tem que aparecer na aba');
    const f2 = (await req('POST', '/api/v1/fornecedores', {
      nome: `Fornecedor Beta ${SUFIXO}`, categoria: 'Jeans', status: 'Ativo',
    })).json();
    ok('a aba começa com Total Comprado = 0 em ambos',
      (await linha(f1.id)).totalComprado === 0 && (await linha(f2.id)).totalComprado === 0);

    const produto = await prisma.produto.create({
      data: { empresaId: empresa.id, nome: `Camisa ${SUFIXO}`, sku: `SKF-${SUFIXO}`, precoVenda: 50, custo: 20, status: 'ATIVO' },
    });
    const compra = await req('POST', '/compras', {
      fornecedorId: f1.id, filialId: filial.id, condPagamento: '30 dias',
      itens: [{ produtoId: produto.id, quantidade: 10, valorUnit: 20 }],
    });
    ok('POST /compras (módulo Compras) -> 200', compra.statusCode === 200,
      `status=${compra.statusCode} corpo=${compra.body.slice(0, 180)}`);
    const compraId = compra.json().id;

    // >>> A ASSERÇÃO CENTRAL: a compra acabou de nascer; a aba tem que saber.
    const l1 = await linha(f1.id);
    ok('"Total Comprado" do fornecedor passou a 200 (era 0)',
      l1.totalComprado === 200, `totalComprado=${l1.totalComprado}`);
    ok('"Pedidos" passou a 1', l1.totalPedidos === 1, `totalPedidos=${l1.totalPedidos}`);
    ok('"Último pedido" foi preenchido', !!l1.ultimoPedidoAt, `ultimoPedidoAt=${l1.ultimoPedidoAt}`);
    const l2 = await linha(f2.id);
    ok('o OUTRO fornecedor continua em 0 (não houve contaminação)',
      l2.totalComprado === 0 && l2.totalPedidos === 0, `f2=${l2.totalComprado}/${l2.totalPedidos}`);

    const kpis = (await req('GET', '/api/v1/fornecedores/kpis')).json();
    ok('KPI "Total Fornecedores" = 2', kpis.totalFornecedores === 2, `valor=${kpis.totalFornecedores}`);
    ok('KPI "Gasto do mês" = R$ 200', kpis.gastoMes === 200, `gastoMes=${kpis.gastoMes}`);
    ok('KPI "Ticket médio" = R$ 200', kpis.ticketMedio === 200, `ticketMedio=${kpis.ticketMedio}`);
    ok('KPI "Pedidos pendentes" = 1 (SOLICITADA é pedido em aberto)',
      kpis.pedidosPendentes === 1, `pedidosPendentes=${kpis.pedidosPendentes}`);
    ok('KPI "Atrasados" = 0 no dia do pedido', kpis.pedidosAtrasados === 0, `atrasados=${kpis.pedidosAtrasados}`);
    ok('o histórico tem 6 meses e o mês corrente tem o gasto',
      kpis.historico.length === 6 && kpis.historico[5].valor === 200,
      `hist=${JSON.stringify(kpis.historico)}`);
    const somaHist = kpis.historico.reduce((s: number, h: any) => s + h.valor, 0);
    ok('os outros 5 meses são 0 (não inventa passado)', somaHist === 200, `soma=${somaHist}`);

    const insights = (await req('GET', '/api/v1/fornecedores/insights')).json();
    ok('o insight de atraso diz que não há atraso (honesto)',
      insights.atrasoCritico.includes('Nenhum pedido atrasado'), insights.atrasoCritico);
    ok('o insight de negociação admite que não há base com 1 pedido',
      insights.melhorNegociacao.includes('Sem base para comparar'), insights.melhorNegociacao);
    console.log('\n3. Compra CANCELADA deixa de ser pedido');
    await req('POST', `/compras/${compraId}/cancelar`, {});
    const aposCancelar = await linha(f1.id);
    ok('"Total Comprado" voltou a 0 ao cancelar', aposCancelar.totalComprado === 0,
      `totalComprado=${aposCancelar.totalComprado}`);
    ok('"Pedidos" voltou a 0', aposCancelar.totalPedidos === 0, `totalPedidos=${aposCancelar.totalPedidos}`);
    const kpis2 = (await req('GET', '/api/v1/fornecedores/kpis')).json();
    ok('o "Gasto do mês" não conta compra cancelada', kpis2.gastoMes === 0, `gastoMes=${kpis2.gastoMes}`);
    ok('o "Ticket médio" não conta compra cancelada', kpis2.ticketMedio === 0, `ticketMedio=${kpis2.ticketMedio}`);
    ok('"Pendentes" não conta compra cancelada', kpis2.pedidosPendentes === 0, `p=${kpis2.pedidosPendentes}`);

    console.log('\n4. Pedido confirmado e antigo vira ATRASADO');
    const c2 = (await req('POST', '/compras', {
      fornecedorId: f1.id, filialId: filial.id,
      itens: [{ produtoId: produto.id, quantidade: 5, valorUnit: 20 }],
    })).json();
    await prisma.compra.update({ where: { id: c2.id }, data: { status: 'PEDIDO' } });
    const k3 = (await req('GET', '/api/v1/fornecedores/kpis')).json();
    ok('PEDIDO de hoje ainda NÃO é atraso', k3.pedidosAtrasados === 0, `atrasados=${k3.pedidosAtrasados}`);
    ok('PEDIDO de hoje está pendente', k3.pedidosPendentes === 1, `p=${k3.pedidosPendentes}`);
    // Envelhece o pedido em 45 dias direto no banco (não há rota para a data).
    await prisma.compra.update({
      where: { id: c2.id },
      data: { dataCompra: new Date(Date.now() - 45 * 86400000) },
    });
    const k4 = (await req('GET', '/api/v1/fornecedores/kpis')).json();
    ok('PEDIDO com 45 dias passou a ATRASADO', k4.pedidosAtrasados === 1, `atrasados=${k4.pedidosAtrasados}`);
    ok('o atrasado saiu de "pendente" (os dois KPIs não se somam em dobro)',
      k4.pedidosPendentes === 0, `p=${k4.pedidosPendentes}`);
    const ins4 = (await req('GET', '/api/v1/fornecedores/insights')).json();
    ok('o insight de atraso nomeia o fornecedor real',
      ins4.atrasoCritico.includes(`Fornecedor Alfa ${SUFIXO}`), ins4.atrasoCritico);

    console.log('\n5. Listagem: ordenação real e filtros');
    const lista = (await req('GET', '/api/v1/fornecedores')).json();
    ok('a lista traz os 2 fornecedores', lista.length === 2, `n=${lista.length}`);
    ok('a lista vem ordenada pelo total comprado, decrescente',
      Number(lista[0].totalComprado) >= Number(lista[1].totalComprado),
      `${lista[0].totalComprado} / ${lista[1].totalComprado}`);
    await req('PUT', `/api/v1/fornecedores/${f2.id}`, { status: 'Inativo' });
    ok('filtro status=Inativo devolve só o inativo',
      (await req('GET', '/api/v1/fornecedores?status=Inativo')).json().length === 1);
    ok('filtro status=Ativo devolve só o ativo',
      (await req('GET', '/api/v1/fornecedores?status=Ativo')).json().length === 1);
    ok('status legado ARQUIVADO é lido como Inativo (e não como Ativo)',
      (await req('GET', '/api/v1/fornecedores?status=ARQUIVADO')).json().length === 1);
    const banana = await req('GET', '/api/v1/fornecedores?status=Banana');
    ok('status desconhecido -> 400 (antes virava Ativo silenciosamente)',
      banana.statusCode === 400, `status=${banana.statusCode}`);
    ok('filtro categoria=Jeans devolve o Beta',
      (await req('GET', '/api/v1/fornecedores?categoria=Jeans')).json().length === 1);
    ok('busca pelo nome acha o fornecedor',
      (await req('GET', `/api/v1/fornecedores?busca=${encodeURIComponent('Alfa')}`)).json().length === 1);
    ok('busca pelo CNPJ acha o fornecedor',
      (await req('GET', `/api/v1/fornecedores?busca=${CNPJ}`)).json().length === 1);
    ok('busca sem resultado devolve lista vazia, não erro',
      (await req('GET', '/api/v1/fornecedores?busca=zzznaoexiste')).json().length === 0);
    console.log('\n6. Edição (PUT) — o impasse do status travado');
    const f3 = (await req('POST', '/api/v1/fornecedores', {
      nome: `Fornecedor Gamma ${SUFIXO}`, categoria: 'Bonés', status: 'Inativo',
    })).json();
    const compraTravada = await req('POST', '/compras', {
      fornecedorId: f3.id, filialId: filial.id,
      itens: [{ produtoId: produto.id, quantidade: 1, valorUnit: 10 }],
    });
    ok('fornecedor Inativo é REJEITADO pelo módulo Compras',
      compraTravada.statusCode >= 400, `status=${compraTravada.statusCode}`);
    const editado = await req('PUT', `/api/v1/fornecedores/${f3.id}`, {
      status: 'Ativo', nome: `Fornecedor Gamma Editado ${SUFIXO}`,
    });
    ok('PUT /api/v1/fornecedores/:id -> 200', editado.statusCode === 200,
      `status=${editado.statusCode} corpo=${editado.body.slice(0, 180)}`);
    ok('o status foi corrigido para Ativo', editado.json().status === 'Ativo', `status=${editado.json().status}`);
    ok('o nome foi corrigido', editado.json().nome === `Fornecedor Gamma Editado ${SUFIXO}`);
    const noBanco3 = await prisma.fornecedor.findUnique({ where: { id: f3.id } });
    ok('a edição foi GRAVADA no PostgreSQL',
      noBanco3?.status === 'Ativo' && noBanco3?.nome === `Fornecedor Gamma Editado ${SUFIXO}`,
      `status=${noBanco3?.status} nome=${noBanco3?.nome}`);
    ok('a categoria NÃO foi apagada pela atualização parcial', noBanco3?.categoria === 'Bonés',
      `categoria=${noBanco3?.categoria}`);
    const compraDepois = await req('POST', '/compras', {
      fornecedorId: f3.id, filialId: filial.id,
      itens: [{ produtoId: produto.id, quantidade: 1, valorUnit: 10 }],
    });
    ok('depois de corrigir o status, o mesmo fornecedor ACEITA compra',
      compraDepois.statusCode === 200, `status=${compraDepois.statusCode}`);
    ok('o PUT devolve os totais já calculados pelo servidor',
      typeof editado.json().totalComprado === 'number', `total=${editado.json().totalComprado}`);
    ok('PUT com CNPJ repetido de outro fornecedor -> 409',
      (await req('PUT', `/api/v1/fornecedores/${f2.id}`, { cnpj: CNPJ })).statusCode === 409);
    ok('PUT em fornecedor inexistente -> 404',
      (await req('PUT', '/api/v1/fornecedores/nao-existe-xyz', { nome: 'Fulano' })).statusCode === 404);
    console.log('\n7. Multi-tenant, permissões e recusas');
    ok('a empresa B não enxerga os fornecedores da empresa A',
      (await req('GET', '/api/v1/fornecedores', undefined, H2)).json().length === 0);
    ok('a empresa B não consegue editar um fornecedor da empresa A',
      (await req('PUT', `/api/v1/fornecedores/${f1.id}`, { nome: 'Invadido' }, H2)).statusCode === 404);
    ok('a empresa A não foi alterada pela tentativa da B',
      (await prisma.fornecedor.findUnique({ where: { id: f1.id } }))?.nome === `Fornecedor Alfa ${SUFIXO}`);
    ok('GET sem token -> 401', (await app.inject({ method: 'GET', url: '/api/v1/fornecedores' })).statusCode === 401);
    ok('GET sem permissão -> 403', (await req('GET', '/api/v1/fornecedores', undefined, Hsem)).statusCode === 403);
    ok('POST sem permissão -> 403',
      (await req('POST', '/api/v1/fornecedores', { nome: `Z ${SUFIXO}`, categoria: 'Outros' }, Hsem)).statusCode === 403);
    ok('PUT sem permissão -> 403',
      (await req('PUT', `/api/v1/fornecedores/${f1.id}`, { nome: 'X' }, Hsem)).statusCode === 403);
    ok('KPIs sem permissão -> 403',
      (await req('GET', '/api/v1/fornecedores/kpis', undefined, Hsem)).statusCode === 403);
    ok('Insights sem permissão -> 403',
      (await req('GET', '/api/v1/fornecedores/insights', undefined, Hsem)).statusCode === 403);
    ok('Export sem permissão -> 403',
      (await req('POST', '/api/v1/fornecedores/export', { formato: 'csv' }, Hsem)).statusCode === 403);

    console.log('\n8. Exportação e detalhe');
    const exp = await req('POST', '/api/v1/fornecedores/export', { formato: 'csv' });
    ok('POST /export -> 200', exp.statusCode === 200, `status=${exp.statusCode}`);
    const csv = Buffer.from(exp.json().base64, 'base64').toString('utf8');
    ok('o CSV traz o cabeçalho com as colunas da aba', csv.includes('Condição Pagamento'), csv.split('\n')[0]);
    ok('o CSV contém o fornecedor gravado', csv.includes(`Fornecedor Alfa ${SUFIXO}`));
    // Compara com o que a API devolve, e não com um número cravado: nesta
    // altura Alfa tem 100 (a compra de 200 foi cancelada) e Gamma tem 10.
    const totalAlfa = (await linha(f1.id)).totalComprado;
    const totalGamma = (await linha(f3.id)).totalComprado;
    ok('o CSV traz o total comprado REAL do Alfa, não zero',
      totalAlfa === 100 && csv.includes(String(totalAlfa)), `total=${totalAlfa}`);
    ok('o CSV traz o total comprado REAL do Gamma (compra criada depois da edição)',
      totalGamma === 10 && csv.includes(String(totalGamma)), `total=${totalGamma}`);
    const xlsx = await req('POST', '/api/v1/fornecedores/export', { formato: 'excel' });
    ok('exportação em xlsx -> 200 com base64', xlsx.statusCode === 200 && !!xlsx.json().base64);
    ok('o nome do arquivo vem com a data', /\d{4}-\d{2}-\d{2}\.xlsx/.test(xlsx.json().nome), xlsx.json().nome);

    const detalhe = await req('GET', `/api/v1/fornecedores/${f1.id}`);
    ok('GET /api/v1/fornecedores/:id -> 200', detalhe.statusCode === 200, `status=${detalhe.statusCode}`);
    ok('o detalhe devolve os pedidos reais (derivados de Compra)',
      Array.isArray(detalhe.json().compras) && detalhe.json().compras.length >= 1,
      `n=${detalhe.json().compras?.length}`);
    ok('o detalhe classifica o pedido atrasado como Atrasado',
      detalhe.json().compras.some((c: any) => c.statusPedido === 'Atrasado'),
      JSON.stringify(detalhe.json().compras.map((c: any) => c.statusPedido)));
    ok('o detalhe traz o total real do fornecedor', detalhe.json().totalComprado === 100,
      `total=${detalhe.json().totalComprado}`);
    ok('GET de fornecedor de outra empresa -> 404',
      (await req('GET', `/api/v1/fornecedores/${f1.id}`, undefined, H2)).statusCode === 404);
  } finally {
const todas = [empresa.id, empresa2.id];
    await prisma.compraItem.deleteMany({ where: { compra: { empresaId: { in: todas } } } });
    await prisma.compra.deleteMany({ where: { empresaId: { in: todas } } });
    // Produto ANTES de Fornecedor: Produto.fornecedorId � FK para Fornecedor.
    await prisma.produto.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.fornecedor.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.filial.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.empresa.deleteMany({ where: { id: { in: todas } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: aba fornecedores', async () => {
  await main();
});
