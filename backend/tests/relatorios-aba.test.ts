/**
 * TESTE DE INTEGRAÇÃO — ABA RELATÓRIOS (Seção 33)
 *
 * Cobertura completa:
 *  1. Fontes reais de dados (Vendas, Financeiro, Estoque) agregadas sem mocks.
 *  2. Gerador por IA (interpretação de perguntas, agrupamentos, fallback determinístico, persistência no PostgreSQL).
 *  3. Histórico de relatórios gerados com ordenação decrescente e multi-tenant.
 *  4. Exportação para Excel (.xlsx) e CSV (.csv) de fontes diretas e relatórios salvos.
 *  5. Módulo DISC (questionário do backend, cálculo de escores 100%, gravação e histórico de vigência).
 *  6. Isolamento multi-tenant rigoroso (Empresa A nunca acessa nem exporta relatórios ou DISC da Empresa B).
 *  7. Permissões RBAC (401 sem autenticação, 403 sem permissão adequada).
 *  8. Trilha de auditoria em operações de criação de relatórios e avaliações.
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { relatoriosRoutes } from '../src/modules/relatorios/relatorios.routes.js';
import { radarRoutes } from '../src/modules/radar/radar.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-relatorios';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) {
    passou++;
    console.log(`  ok   ${nome}`);
  } else {
    falhas++;
    console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`);
  }
}

async function main() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') {
      return reply.status(400).send({ error: 'Dados inválidos.', detalhes: error.issues });
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
  await app.register(relatoriosRoutes);
  await app.register(radarRoutes, { prefix: '/radar' });

  console.log('--- SETUP TENANTS, USUÁRIOS E DADOS REAIS ---');

  // Empresa A e B
  const empresaA = await prisma.empresa.create({
    data: {
      nome: `Empresa Relatorios A ${SUFIXO}`,
      cnpj: `${Date.now()}1`.slice(-14).padStart(14, '0'),
    },
  });

  const empresaB = await prisma.empresa.create({
    data: {
      nome: `Empresa Relatorios B ${SUFIXO}`,
      cnpj: `${Date.now()}2`.slice(-14).padStart(14, '0'),
    },
  });

  const filialA = await prisma.filial.create({ data: { empresaId: empresaA.id, nome: 'Filial A' } });
  const filialB = await prisma.filial.create({ data: { empresaId: empresaB.id, nome: 'Filial B' } });

  const senhaHash = await hashSenha('senha12345');
  const todasPerms = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));

  // Admin A (com todas as permissões)
  const userAdminA = await prisma.usuario.create({
    data: {
      empresaId: empresaA.id,
      filialId: filialA.id,
      nome: 'Admin Rel A',
      email: `admin-a-${SUFIXO}@teste.local`,
      senhaHash,
    },
  });
  await prisma.permissao.createMany({
    data: todasPerms.map((p) => ({ ...p, usuarioId: userAdminA.id })),
  });

  // Usuário Sem Permissão de Relatórios
  const userSemPermA = await prisma.usuario.create({
    data: {
      empresaId: empresaA.id,
      filialId: filialA.id,
      nome: 'Sem Perm A',
      email: `semperm-a-${SUFIXO}@teste.local`,
      senhaHash,
    },
  });
  await prisma.permissao.createMany({
    data: todasPerms
      .filter((p) => p.modulo !== 'relatorios' && p.modulo !== 'rh')
      .map((p) => ({ ...p, usuarioId: userSemPermA.id })),
  });

  // Admin B (Empresa B)
  const userAdminB = await prisma.usuario.create({
    data: {
      empresaId: empresaB.id,
      filialId: filialB.id,
      nome: 'Admin Rel B',
      email: `admin-b-${SUFIXO}@teste.local`,
      senhaHash,
    },
  });
  await prisma.permissao.createMany({
    data: todasPerms.map((p) => ({ ...p, usuarioId: userAdminB.id })),
  });

  const HAdminA = { authorization: `Bearer ${app.jwt.sign({ id: userAdminA.id, empresaId: empresaA.id, email: userAdminA.email })}` };
  const HSemPermA = { authorization: `Bearer ${app.jwt.sign({ id: userSemPermA.id, empresaId: empresaA.id, email: userSemPermA.email })}` };
  const HAdminB = { authorization: `Bearer ${app.jwt.sign({ id: userAdminB.id, empresaId: empresaB.id, email: userAdminB.email })}` };

  // Dados reais para Empresa A: Produtos, Vendas, Financeiro, Estoque, Funcionário
  const prodA1 = await prisma.produto.create({
    data: {
      empresaId: empresaA.id,
      nome: 'Mouse Sem Fio Pro',
      precoVenda: 150.0,
      custo: 80.0,
    },
  });

  const prodA2 = await prisma.produto.create({
    data: {
      empresaId: empresaA.id,
      nome: 'Teclado Mecânico RGB',
      precoVenda: 350.0,
      custo: 200.0,
    },
  });

  // Estoque A
  await prisma.estoque.create({
    data: {
      empresaId: empresaA.id,
      filialId: filialA.id,
      produtoId: prodA1.id,
      quantidade: 15,
      valorTotal: 1200.0,
    },
  });

  await prisma.estoque.create({
    data: {
      empresaId: empresaA.id,
      filialId: filialA.id,
      produtoId: prodA2.id,
      quantidade: 3, // Crítico (<= 5)
      valorTotal: 600.0,
    },
  });

  // Vendas A
  await prisma.venda.create({
    data: {
      empresaId: empresaA.id,
      filialId: filialA.id,
      subtotal: 300.0,
      desconto: 0,
      total: 300.0,
      formaPagamento: 'PIX',
      status: 'FINALIZADA',
      itens: {
        create: [
          { produtoId: prodA1.id, quantidade: 2, preco: 150.0, custoUnitario: 80.0, desconto: 0, total: 300.0 },
        ],
      },
    },
  });

  await prisma.venda.create({
    data: {
      empresaId: empresaA.id,
      filialId: filialA.id,
      subtotal: 350.0,
      desconto: 0,
      total: 350.0,
      formaPagamento: 'CARTAO_CREDITO',
      status: 'FINALIZADA',
      itens: {
        create: [
          { produtoId: prodA2.id, quantidade: 1, preco: 350.0, custoUnitario: 200.0, desconto: 0, total: 350.0 },
        ],
      },
    },
  });

  // Financeiro A
  await prisma.financeiro.create({
    data: {
      empresaId: empresaA.id,
      tipo: 'RECEITA',
      categoria: 'Vendas de Produtos',
      descricao: 'Receita Venda 1',
      valor: 650.0,
      status: 'PAGO',
      vencimento: new Date(),
    },
  });

  await prisma.financeiro.create({
    data: {
      empresaId: empresaA.id,
      tipo: 'DESPESA',
      categoria: 'Fornecedores',
      descricao: 'Compra de Estoque',
      valor: 280.0,
      status: 'PAGO',
      vencimento: new Date(),
    },
  });

  // Funcionário A
  const funcA = await prisma.funcionario.create({
    data: {
      empresaId: empresaA.id,
      nome: 'Carlos Silva',
      cpf: `${Date.now()}3`.slice(-11).padStart(11, '0'),
    },
  });

  // Funcionário B
  const funcB = await prisma.funcionario.create({
    data: {
      empresaId: empresaB.id,
      nome: 'Mariana Costa',
      cpf: `${Date.now()}4`.slice(-11).padStart(11, '0'),
    },
  });

  console.log('\n--- TESTES: GERAÇÃO DE RELATÓRIOS POR IA (POST /relatorios/ia/criar) ---');

  // 1. Pergunta curta (< 5 caracteres) -> 400
  const rCurta = await app.inject({
    method: 'POST',
    url: '/relatorios/ia/criar',
    headers: HAdminA,
    payload: { pergunta: 'Oi' },
  });
  ok('Rejeita pergunta com menos de 5 caracteres com 400', rCurta.statusCode === 400);

  // 2. Relatório de Vendas (linguagem natural sobre pagamentos / PIX -> doughnut)
  const rVendasIa = await app.inject({
    method: 'POST',
    url: '/relatorios/ia/criar',
    headers: HAdminA,
    payload: { pergunta: 'Vendas por forma de pagamento e PIX nos últimos dias' },
  });
  ok('Cria relatório de vendas por IA com status 200', rVendasIa.statusCode === 200);
  const jsonVendasIa = rVendasIa.json();
  ok('Relatório possui ID persistido', typeof jsonVendasIa.id === 'string' && jsonVendasIa.id.length > 0);
  ok('Tipo de relatório é vendas', jsonVendasIa.tipo === 'vendas');
  ok('Gráfico identificado como doughnut para forma de pagamento', jsonVendasIa.dados.grafico.tipo === 'doughnut');
  ok('KPIs reais presentes e calculados', Array.isArray(jsonVendasIa.dados.kpis) && jsonVendasIa.dados.kpis.length > 0);
  ok('Insights gerados com sucesso', Array.isArray(jsonVendasIa.insights) && jsonVendasIa.insights.length > 0);

  // Verifica persistência no PostgreSQL
  const relSalvoNoBanco = await prisma.relatorioGerado.findUnique({
    where: { id: jsonVendasIa.id },
  });
  ok('Relatório salvo existe fisicamente no PostgreSQL', !!relSalvoNoBanco && relSalvoNoBanco.empresaId === empresaA.id);

  // 3. Relatório de Financeiro (receitas e despesas)
  const rFinIa = await app.inject({
    method: 'POST',
    url: '/relatorios/ia/criar',
    headers: HAdminA,
    payload: { pergunta: 'Demonstrativo financeiro de receitas e despesas da empresa' },
  });
  ok('Cria relatório financeiro com status 200', rFinIa.statusCode === 200);
  const jsonFinIa = rFinIa.json();
  ok('Tipo de relatório é financeiro', jsonFinIa.tipo === 'financeiro');
  ok('KPIs de receitas e despesas presentes', jsonFinIa.dados.kpis.some((k: any) => k.label.includes('Receita')));

  // 4. Relatório de Estoque (produtos críticos / ruptura)
  const rEstIa = await app.inject({
    method: 'POST',
    url: '/relatorios/ia/criar',
    headers: HAdminA,
    payload: { pergunta: 'Posição atual do estoque e produtos com ruptura' },
  });
  ok('Cria relatório de estoque com status 200', rEstIa.statusCode === 200);
  const jsonEstIa = rEstIa.json();
  ok('Tipo de relatório é estoque', jsonEstIa.tipo === 'estoque');
  ok('KPI de estoque crítico identificado', jsonEstIa.dados.kpis.some((k: any) => k.label.includes('crítico')));

  console.log('\n--- TESTES: HISTÓRICO (GET /relatorios/ia/historico) ---');

  // 5. Histórico da Empresa A
  const rHistA = await app.inject({
    method: 'GET',
    url: '/relatorios/ia/historico',
    headers: HAdminA,
  });
  ok('Retorna histórico da empresa A com status 200', rHistA.statusCode === 200);
  const jsonHistA = rHistA.json();
  ok('Histórico contém os 3 relatórios gerados', Array.isArray(jsonHistA) && jsonHistA.length >= 3);
  ok('Ordenação decrescente por criadoEm', new Date(jsonHistA[0].criadoEm).getTime() >= new Date(jsonHistA[1].criadoEm).getTime());

  // 6. Multi-tenant no histórico: Empresa B não vê relatórios da Empresa A
  const rHistB = await app.inject({
    method: 'GET',
    url: '/relatorios/ia/historico',
    headers: HAdminB,
  });
  ok('Retorna histórico da empresa B com status 200', rHistB.statusCode === 200);
  const jsonHistB = rHistB.json();
  ok('Empresa B não enxerga relatórios da empresa A (lista vazia)', Array.isArray(jsonHistB) && jsonHistB.length === 0);

  console.log('\n--- TESTES: EXPORTAÇÃO EXCEL E CSV (POST /relatorios/export) ---');

  // 7. Exportar relatório salvo da Empresa A para Excel
  const rExpExcelSalvo = await app.inject({
    method: 'POST',
    url: '/relatorios/export',
    headers: HAdminA,
    payload: {
      formato: 'excel',
      relatorioId: jsonVendasIa.id,
    },
  });
  ok('Exporta relatório salvo em Excel com 200', rExpExcelSalvo.statusCode === 200);
  const jsonExpExcel = rExpExcelSalvo.json();
  ok('Retorna payload base64 e nome do arquivo .xlsx', typeof jsonExpExcel.base64 === 'string' && jsonExpExcel.nome.endsWith('.xlsx'));

  // 8. Exportar relatório salvo da Empresa A para CSV
  const rExpCsvSalvo = await app.inject({
    method: 'POST',
    url: '/relatorios/export',
    headers: HAdminA,
    payload: {
      formato: 'csv',
      relatorioId: jsonVendasIa.id,
    },
  });
  ok('Exporta relatório salvo em CSV com 200', rExpCsvSalvo.statusCode === 200);
  const jsonExpCsv = rExpCsvSalvo.json();
  ok('Retorna payload base64 e nome do arquivo .csv', typeof jsonExpCsv.base64 === 'string' && jsonExpCsv.nome.endsWith('.csv'));

  // 9. Exportação direta de fontes (sem relatório salvo)
  const rExpFonteVendas = await app.inject({
    method: 'POST',
    url: '/relatorios/export',
    headers: HAdminA,
    payload: { formato: 'excel', fonte: 'vendas' },
  });
  ok('Exporta fonte direta de vendas para Excel', rExpFonteVendas.statusCode === 200 && rExpFonteVendas.json().nome.endsWith('.xlsx'));

  const rExpFonteFin = await app.inject({
    method: 'POST',
    url: '/relatorios/export',
    headers: HAdminA,
    payload: { formato: 'csv', fonte: 'financeiro' },
  });
  ok('Exporta fonte direta de financeiro para CSV', rExpFonteFin.statusCode === 200 && rExpFonteFin.json().nome.endsWith('.csv'));

  const rExpFonteEst = await app.inject({
    method: 'POST',
    url: '/relatorios/export',
    headers: HAdminA,
    payload: { formato: 'excel', fonte: 'estoque' },
  });
  ok('Exporta fonte direta de estoque para Excel', rExpFonteEst.statusCode === 200 && rExpFonteEst.json().nome.endsWith('.xlsx'));

  // 10. Multi-tenant na exportação: Empresa B tenta exportar relatório salvo da Empresa A -> 404
  const rExpAlien = await app.inject({
    method: 'POST',
    url: '/relatorios/export',
    headers: HAdminB,
    payload: {
      formato: 'excel',
      relatorioId: jsonVendasIa.id,
    },
  });
  ok('Empresa B não pode exportar relatório da Empresa A (retorna 404)', rExpAlien.statusCode === 404);

  console.log('\n--- TESTES: FLUXO DE AVALIAÇÃO DISC (/radar/disc/...) ---');

  // 11. Questionário DISC
  const rQuest = await app.inject({
    method: 'GET',
    url: '/radar/disc/questionario',
    headers: HAdminA,
  });
  ok('Busca questionário DISC com 200', rQuest.statusCode === 200);
  const jsonQuest = rQuest.json();
  ok('Questionário possui 12 perguntas estruturadas', jsonQuest.total === 12 && jsonQuest.perguntas.length === 12);
  ok('Cada pergunta possui 4 alternativas', jsonQuest.perguntas.every((p: any) => p.alternativas.length === 4));

  // 12. Listagem de funcionários para DISC
  const rFuncsDisc = await app.inject({
    method: 'GET',
    url: '/radar/disc/funcionarios',
    headers: HAdminA,
  });
  ok('Lista funcionários da empresa A para DISC com 200', rFuncsDisc.statusCode === 200);
  const jsonFuncsDisc = rFuncsDisc.json();
  ok('Retorna funcionário Carlos Silva', jsonFuncsDisc.some((f: any) => f.id === funcA.id));
  ok('Não vaza funcionário da Empresa B', !jsonFuncsDisc.some((f: any) => f.id === funcB.id));

  // Prepara 12 respostas para o cálculo
  const respostas = jsonQuest.perguntas.map((p: any) => ({
    perguntaId: p.id,
    alternativaId: p.alternativas[0].id,
  }));

  // 13. Cálculo prévio do resultado (POST /radar/disc/calcular)
  const rCalc = await app.inject({
    method: 'POST',
    url: '/radar/disc/calcular',
    headers: HAdminA,
    payload: { respostas },
  });
  ok('Calcula resultado DISC com 200', rCalc.statusCode === 200);
  const jsonCalc = rCalc.json();
  const soma = jsonCalc.resultado.D + jsonCalc.resultado.I + jsonCalc.resultado.S + jsonCalc.resultado.C;
  ok('Soma dos percentuais D + I + S + C fecha exatamente 100%', soma === 100);
  ok('Identifica perfil predominante', ['D', 'I', 'S', 'C'].includes(jsonCalc.resultado.predominante));

  // 14. Gravação da Avaliação DISC (POST /radar/disc/avaliar)
  const rAvaliar = await app.inject({
    method: 'POST',
    url: '/radar/disc/avaliar',
    headers: HAdminA,
    payload: {
      funcionarioId: funcA.id,
      respostas,
      observacoes: 'Avaliação inicial para programa de liderança.',
    },
  });
  ok('Grava avaliação DISC no PostgreSQL com status 201/200', rAvaliar.statusCode === 201 || rAvaliar.statusCode === 200);
  const jsonAvaliar = rAvaliar.json();
  ok('Avaliação marcada como vigente', jsonAvaliar.vigente === true);
  ok('ID da avaliação retornado', typeof jsonAvaliar.id === 'string');

  // 15. Consulta do Histórico DISC do funcionário (GET /radar/disc/historico)
  const rHistDisc = await app.inject({
    method: 'GET',
    url: `/radar/disc/historico?funcionarioId=${funcA.id}`,
    headers: HAdminA,
  });
  ok('Consulta histórico DISC do funcionário com 200', rHistDisc.statusCode === 200);
  const jsonHistDisc = rHistDisc.json();
  ok('Histórico traz a avaliação registrada', jsonHistDisc.avaliacoes.length >= 1);
  ok('Avaliação registrada consta como vigente', jsonHistDisc.avaliacoes[0].vigente === true);
  ok('Observação preservada', jsonHistDisc.avaliacoes[0].observacoes === 'Avaliação inicial para programa de liderança.');

  // 16. Multi-tenant DISC: Empresa B tenta avaliar funcionário da Empresa A -> 404
  const rDiscAlien = await app.inject({
    method: 'POST',
    url: '/radar/disc/avaliar',
    headers: HAdminB,
    payload: {
      funcionarioId: funcA.id,
      respostas,
    },
  });
  ok('Empresa B não pode avaliar funcionário da Empresa A (retorna 404)', rDiscAlien.statusCode === 404);

  console.log('\n--- TESTES: PERMISSÕES RBAC E AUTENTICAÇÃO ---');

  // 17. 401 sem autenticação em rota de relatórios
  const rSemAuth = await app.inject({
    method: 'GET',
    url: '/relatorios/ia/historico',
  });
  ok('Sem token retorna 401 Não Autorizado', rSemAuth.statusCode === 401);

  // 18. 403 para usuário sem permissão de relatórios
  const rSemPerm = await app.inject({
    method: 'POST',
    url: '/relatorios/ia/criar',
    headers: HSemPermA,
    payload: { pergunta: 'Relatório geral de vendas' },
  });
  ok('Usuário sem permissão relatorios:visualizar recebe 403', rSemPerm.statusCode === 403);

  // 19. Auditoria registrada no PostgreSQL
  const auditorias = await prisma.auditoria.findMany({
    where: { empresaId: empresaA.id, entidade: 'RelatorioGerado' },
  });
  ok('Trilha de auditoria gerada para criação de relatórios', auditorias.length >= 3);

  console.log('\n========================================');
  console.log(`RESULTADO DOS TESTES: ${passou} passaram, ${falhas} falharam.`);
  console.log('========================================\n');

  if (falhas > 0) {
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error('ERRO FATAL NOS TESTES:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
