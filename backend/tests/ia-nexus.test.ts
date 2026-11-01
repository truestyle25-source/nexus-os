/**
 * TESTE DE INTEGRAÇÃO — IA NEXUS (abas /ia e /intelligence)
 *
 * Duas correções foram feitas nesta aba e é exatamente o que este teste prende:
 *
 *   1. `/ia/perguntar` devolvia HTTP 200 com um texto FIXO ("Olá! Sou a IA...")
 *      quando `GEMINI_API_KEY` não está configurada, marcado com `fallback:
 *      true`. A tela ignorava essa marca e mostrava o texto dentro de um balão
 *      normal — o gestor acreditava que a IA tinha respondido. Aqui provamos
 *      que (a) sem chave a resposta vem com `fallback: true` e NÃO é gravada
 *      como conversa, e (b) a tela precisa receber esse sinal.
 *
 *   2. As "Oportunidades" do Intelligence Center eram DOIS textos escritos à mão,
 *      devolvidos para qualquer empresa sem consultar nada. Aqui provamos que as
 *      oportunidades passam a nascer de FATOS: giro real com estoque no mínimo,
 *      e comparação de faturamento de hoje contra ontem. Empresa sem dado não
 *      recebe oportunidade inventada.
 *
 *   3. Permissões, isolamento multi-tenant e rate limit das rotas de IA.
 *
 * NOTA SOBRE O MODELO: o teste NÃO chama o Gemini (exige cota e rede). Ele
 * exercita o caminho de chave ausente, que é justamente onde estava o bug de
 * "sucesso falso", e garante que o histórico NÃO é gravado quando o modelo não
 * respondeu — conversar não é o mesmo que persistir.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { iaRoutes } from '../src/modules/ia/ia.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-ia';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

async function main() {
  // Garante o cenário do bug: sem chave, o backend responde 200 com o texto
  // fixo. Guardamos e restauramos a variável para não afetar outros testes.
  const chaveAnterior = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

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
  await app.register(iaRoutes);

  const empresa = await prisma.empresa.create({
    data: { nome: `IaTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `IaOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Filial IA' } });
  const filial2 = await prisma.filial.create({ data: { empresaId: empresa2.id, nome: 'Filial Outro IA' } });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: 'Teste IA', email: `ia-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Sem Permissao', email: `semia-${SUFIXO}@teste.local`, senhaHash },
  });
  const usuario2 = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Outro Tenant', email: `outroia-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario2.id })) });

  const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email })}` };
  const H2 = { authorization: `Bearer ${app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email })}` };
  const ids = [usuario.id, semPermissao.id, usuario2.id];

  try {
    console.log('\n1. /ia/perguntar sem GEMINI_API_KEY: 200 mas COM fallback: true');
    const semChave = await app.inject({
      method: 'POST', url: '/ia/perguntar', headers: H, payload: { pergunta: 'Quanto vendi hoje?' },
    });
    ok('POST /ia/perguntar -> 200', semChave.statusCode === 200, `status=${semChave.statusCode}`);
    const b = semChave.json();
    // A tela precisa deste sinal para não fingir que a IA respondeu.
    ok('resposta vem marcada como fallback', b.fallback === true, `fallback=${b.fallback}`);
    ok('texto devolvido nao esta vazio', typeof b.resposta === 'string' && b.resposta.length > 0, `resposta=${b.resposta}`);
    ok('campo `text` espelha `resposta`', b.text === b.resposta, `text=${b.text}`);
    ok('texto cita a chave ausente (honesto com o gestor)', /GEMINI_API_KEY/.test(b.resposta), `resposta=${b.resposta}`);

    console.log('\n2. Conversa NAO e persistida quando o modelo nao respondeu');
    const gravadas = await prisma.conversaIA.count({ where: { empresaId: empresa.id } });
    ok('nenhuma conversa gravada no fallback', gravadas === 0, `gravadas=${gravadas}`);

    console.log('\n3. Pergunta vazia e recusada');
    const vazia = await app.inject({ method: 'POST', url: '/ia/perguntar', headers: H, payload: { pergunta: '   ' } });
    ok('pergunta em branco -> 400', vazia.statusCode === 400, `status=${vazia.statusCode}`);
    const semCampo = await app.inject({ method: 'POST', url: '/ia/perguntar', headers: H, payload: {} });
    ok('sem pergunta -> 400', semCampo.statusCode === 400, `status=${semCampo.statusCode}`);

    console.log('\n4. Intelligence Center: oportunidades vem de DADOS, nao de texto fixo');
    const vazio = await app.inject({ method: 'GET', url: '/ia/intelligence-center', headers: H });
    ok('GET /ia/intelligence-center -> 200', vazio.statusCode === 200, `status=${vazio.statusCode}`);
    const v = vazio.json();
    ok('sem venda e sem estoque, oportunidades VAZIAS', (v.oportunidades ?? []).length === 0,
      `veio ${JSON.stringify(v.oportunidades)}`);
    ok('nenhuma oportunidade com os textos fixos antigos',
      !JSON.stringify(v.oportunidades).includes('PRODUTO_POTENCIAL')
      && !JSON.stringify(v.oportunidades).includes('HORARIO_VENDA'),
      `veio ${JSON.stringify(v.oportunidades)}`);
    ok('oQueAconteceu presente', !!v.oQueAconteceu);
    ok('problemas e lista', Array.isArray(v.problemas));

    console.log('\n5. Oportunidade real: produto que VENDEU hoje e esta no minimo');
    const produto = await prisma.produto.create({
      data: { empresaId: empresa.id, nome: 'Produto Giro IA', sku: `GI-${SUFIXO}`, precoVenda: 50, custo: 20, estoqueMinimo: 5, estoqueMaximo: 50, status: 'ATIVO', origem: 'MANUAL' },
    });
    await prisma.estoque.create({ data: { empresaId: empresa.id, filialId: filial.id, produtoId: produto.id, quantidade: 2 } });
    const hoje = new Date(); hoje.setHours(11, 0, 0, 0);
    await prisma.venda.create({
      data: {
        empresaId: empresa.id, filialId: filial.id, status: 'FINALIZADA',
        subtotal: 50, total: 50, origem: 'MANUAL', createdAt: hoje,
        itens: { create: [{ produtoId: produto.id, quantidade: 1, preco: 50, custoUnitario: 20, desconto: 0, total: 50 }] },
      },
    });
    const comGiro = await app.inject({ method: 'GET', url: '/ia/intelligence-center', headers: H });
    const cg = comGiro.json();
    ok('oportunidade de giro apareceu', cg.oportunidades.some((o: any) => o.tipo === 'GIRO_EM_RISCO'),
      `oportunidades=${JSON.stringify(cg.oportunidades)}`);
    ok('a oportunidade CITA o nome do produto real',
      JSON.stringify(cg.oportunidades).includes('Produto Giro IA'), `veio ${JSON.stringify(cg.oportunidades)}`);
    ok('o problema de estoque tambem foi detectado',
      cg.problemas.some((p: any) => p.tipo === 'ESTOQUE_BAIXO'), `problemas=${JSON.stringify(cg.problemas)}`);
    ok('faturamento de hoje refletido no resumo', cg.oQueAconteceu.faturamentoHoje === 50,
      `f=${cg.oQueAconteceu.faturamentoHoje}`);

    console.log('\n6. Oportunidade de ritmo (hoje vs ontem)');
    const ontem = new Date(hoje.getTime() - 86400000);
    await prisma.venda.create({
      data: {
        empresaId: empresa.id, filialId: filial.id, status: 'FINALIZADA',
        subtotal: 900, total: 900, origem: 'MANUAL', createdAt: ontem,
        itens: { create: [{ produtoId: produto.id, quantidade: 1, preco: 900, custoUnitario: 20, desconto: 0, total: 900 }] },
      },
    });
    const comOntem = await app.inject({ method: 'GET', url: '/ia/intelligence-center', headers: H });
    const co = comOntem.json();
    ok('queda de faturamento gera oportunidade de RESSAO_VENDAS',
      co.oportunidades.some((o: any) => o.tipo === 'RESSAO_VENDAS'), `oportunidades=${JSON.stringify(co.oportunidades)}`);
    ok('crescimento negativo calculado', co.oQueMudou.crescimento < 0, `crescimento=${co.oQueMudou.crescimento}`);
    console.log('\n7. Permissoes e token');
    ok('POST /ia/perguntar sem permissao -> 403',
      (await app.inject({ method: 'POST', url: '/ia/perguntar', headers: Hsem, payload: { pergunta: 'oi' } })).statusCode === 403);
    ok('GET /ia/intelligence-center sem permissao -> 403',
      (await app.inject({ method: 'GET', url: '/ia/intelligence-center', headers: Hsem })).statusCode === 403);
    ok('POST /ia/perguntar sem token -> 401',
      (await app.inject({ method: 'POST', url: '/ia/perguntar', payload: { pergunta: 'oi' } })).statusCode === 401);
    ok('GET /ia/intelligence-center sem token -> 401',
      (await app.inject({ method: 'GET', url: '/ia/intelligence-center' })).statusCode === 401);

    console.log('\n8. Isolamento multi-tenant');
    const b2 = await app.inject({ method: 'GET', url: '/ia/intelligence-center', headers: H2 });
    ok('empresa B responde 200', b2.statusCode === 200);
    ok('empresa B nao ve o faturamento da empresa A', b2.json().oQueAconteceu.faturamentoHoje === 0,
      `f=${b2.json().oQueAconteceu.faturamentoHoje}`);
    ok('empresa B nao ve o problema de estoque da empresa A',
      !JSON.stringify(b2.json().problemas).includes('Produto Giro IA'),
      `problemas=${JSON.stringify(b2.json().problemas)}`);
    ok('empresa B nao ve a oportunidade da empresa A',
      !JSON.stringify(b2.json().oportunidades).includes('Produto Giro IA'));
  } finally {
    const todas = [empresa.id, empresa2.id];
    await prisma.conversaIA.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.vendaItem.deleteMany({ where: { venda: { empresaId: { in: todas } } } });
    await prisma.venda.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.estoque.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.produto.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.filial.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: todas } } });
    await prisma.$disconnect();
    if (chaveAnterior !== undefined) process.env.GEMINI_API_KEY = chaveAnterior;
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: ia nexus', async () => {
  await main();
});