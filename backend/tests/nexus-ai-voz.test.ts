/**
 * TESTE — velocidade do modo voz da ATMA:
 *  - roteamento direto ao especialista quando a pergunta é de uma área só (com permissão);
 *  - especialistas pedidos no mesmo passo rodam em PARALELO, sem furar o limite de 4;
 *  - no modo voz o modelo recebe a instrução de resposta curta para fala.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { carregarCatalogo } from '../src/modules/nexus-ai/catalogo.js';
import { contexto, iniciarInvestigacao } from '../src/modules/nexus-ai/motor.js';
import { areaUnica, agenteParaVoz } from '../src/modules/nexus-ai/roteamento-voz.js';
import { definirProvedorDeTeste } from '../src/modules/nexus-ai/provedores/roteador.js';
import type { Provedor } from '../src/modules/nexus-ai/tipos.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);

test('Roteamento por voz: uma área vai ao especialista; causa ou várias áreas vão ao BRAIN', () => {
  assert.equal(areaUnica('Quanto vendi hoje?'), 'comercial');
  assert.equal(areaUnica('Qual o ticket médio da semana?'), 'comercial');
  assert.equal(areaUnica('Estoque baixo?'), 'estoque');
  assert.equal(areaUnica('O que preciso repor esta semana?'), 'estoque');
  assert.equal(areaUnica('Resumo financeiro'), 'financeiro');
  assert.equal(areaUnica('Tenho contas vencidas?'), 'financeiro');
  assert.equal(areaUnica('Algum pedido de compra atrasado?'), 'compras');
  assert.equal(areaUnica('Por que o lucro caiu?'), null, 'pede causa: precisa cruzar áreas');
  assert.equal(areaUnica('Como estão as vendas e o caixa?'), null, 'duas áreas');
  assert.equal(areaUnica('Bom dia, tudo bem?'), null, 'nenhuma área');
});

test('NEXUS AI — modo voz: permissão, paralelismo e resposta curta', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test', timeout: 300_000 }, async (t) => {
  carregarCatalogo();
  const empresa = await prisma.empresa.create({ data: { nome: `Voz Rápida ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const M = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
  const gestor = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: M.id, nome: 'Gestora', email: `gestora-voz-${SUF}@teste.local`, senhaHash: 'x' } });
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: gestor.id, modulo: m, acao: a, permitido: true }))) });
  const semVendas = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: M.id, nome: 'Estoquista', email: `estoq-voz-${SUF}@teste.local`, senhaHash: 'x' } });
  await prisma.permissao.createMany({ data: [['ia', 'visualizar'], ['estoque', 'visualizar'], ['produtos', 'visualizar']].map(([modulo, acao]) => ({ usuarioId: semVendas.id, modulo, acao, permitido: true })) });

  // Provedor de teste: o BRAIN pede N especialistas de uma vez; cada especialista "pensa" 400 ms.
  let pedidosNoPasso = 2;
  const sistemas: string[] = [];
  const provedor: Provedor = {
    nome: 'teste', configurado: () => true,
    async gerar({ sistema, mensagens }) {
      sistemas.push(sistema);
      const base = { tokensEntrada: 10, tokensSaida: 5, modelo: 'teste' };
      if (sistema.includes('Sua especialidade: NEXUS BRAIN')) {
        if (!mensagens.some((m) => m.tipo === 'ferramenta')) {
          const ags = ['comercial', 'financeiro', 'estoque', 'compras', 'comercial'].slice(0, pedidosNoPasso);
          return { ...base, chamadas: ags.map((agente) => ({ nome: 'consultar_especialista', args: { agente, pergunta: 'Como está a sua área?' } })) };
        }
        return { ...base, texto: 'Consultei os especialistas e está tudo em ordem.' };
      }
      await new Promise((ok) => setTimeout(ok, 400));
      return { ...base, texto: 'Sem pendências na minha área.' };
    },
  };

  try {
    definirProvedorDeTeste(provedor);

    await t.test('Sem permissão de vendas, a pergunta comercial volta ao BRAIN', async () => {
      assert.equal(await agenteParaVoz('Quanto vendi hoje?', gestor.id), 'comercial');
      assert.equal(await agenteParaVoz('Quanto vendi hoje?', semVendas.id), 'nexus');
      assert.equal(await agenteParaVoz('Estoque baixo?', semVendas.id), 'estoque');
    });

    await t.test('Dois especialistas no mesmo passo rodam em paralelo', async () => {
      pedidosNoPasso = 2;
      const t0 = Date.now();
      const r = await iniciarInvestigacao(contexto(empresa.id, gestor.id), { agenteId: 'nexus', pergunta: 'Como está a empresa?' });
      const ms = Date.now() - t0;
      assert.equal(r.status, 'CONCLUIDA');
      assert.ok(ms < 800, `2 × 400 ms em sequência levariam ≥ 800 ms; levou ${ms} ms`);
      const filhos = await prisma.aIExecucao.findMany({ where: { execucaoPaiId: r.execucaoId }, select: { agente: true } });
      assert.deepEqual(filhos.map((f) => f.agente).sort(), ['comercial', 'financeiro']);
    });

    await t.test('Cinco pedidos simultâneos: exatamente 4 especialistas (limite preservado)', async () => {
      pedidosNoPasso = 5;
      const r = await iniciarInvestigacao(contexto(empresa.id, gestor.id), { agenteId: 'nexus', pergunta: 'Analise tudo' });
      assert.equal(r.status, 'CONCLUIDA');
      assert.equal(await prisma.aIExecucao.count({ where: { execucaoPaiId: r.execucaoId } }), 4);
      const consultas = await prisma.aIExecucaoFerramenta.findMany({ where: { execucaoId: r.execucaoId, ferramenta: 'consultar_especialista' }, select: { resultado: true } });
      assert.equal(consultas.filter((c) => JSON.stringify(c.resultado).includes('Limite de 4')).length, 1);
    });

    await t.test('Modo voz: instrução de resposta curta chega ao modelo (e aos especialistas)', async () => {
      pedidosNoPasso = 1; sistemas.length = 0;
      const ctx = contexto(empresa.id, gestor.id); ctx.voz = true;
      await iniciarInvestigacao(ctx, { agenteId: 'nexus', pergunta: 'Como está a empresa?' });
      assert.ok(sistemas.length >= 2 && sistemas.every((s) => s.includes('MODO VOZ')), 'BRAIN e especialista recebem a regra');
      sistemas.length = 0;
      await iniciarInvestigacao(contexto(empresa.id, gestor.id), { agenteId: 'comercial', pergunta: 'Quanto vendi?' });
      assert.ok(sistemas.every((s) => !s.includes('MODO VOZ')), 'em texto, sem a regra');
    });

    await t.test('Rota: pergunta por voz de uma área vai direto ao especialista', async () => {
      const { app } = await import('../src/server.js');
      await app.ready();
      const tok = { authorization: `Bearer ${app.jwt.sign({ id: gestor.id, empresaId: empresa.id, email: gestor.email, jti: `j-${SUF}`, emitidoEmMs: Date.now() } as any)}` };
      sistemas.length = 0;
      const voz = await app.inject({ method: 'POST', url: '/api/v1/nexus-ai/perguntar', headers: tok, payload: { pergunta: 'Quanto vendi hoje?', agente: 'nexus', modo: 'voz' } });
      assert.equal(voz.statusCode, 200, voz.body);
      assert.equal(voz.json().detalhes.agente, 'comercial');
      assert.ok(sistemas[0].includes('MODO VOZ'));
      const texto = await app.inject({ method: 'POST', url: '/api/v1/nexus-ai/perguntar', headers: tok, payload: { pergunta: 'Quanto vendi hoje?', agente: 'nexus' } });
      assert.equal(texto.json().detalhes.agente, 'nexus', 'por texto continua no BRAIN');
      await app.close();
    });
  } finally {
    definirProvedorDeTeste(null);
    const id = empresa.id;
    await prisma.aIMensagem.deleteMany({ where: { empresaId: id } }); await prisma.aIConversa.deleteMany({ where: { empresaId: id } });
    await prisma.aIExecucaoFerramenta.deleteMany({ where: { empresaId: id } }); await prisma.aIExecucao.deleteMany({ where: { empresaId: id } });
    await prisma.aIConsumo.deleteMany({ where: { empresaId: id } }); await prisma.auditoria.deleteMany({ where: { empresaId: id } });
    await prisma.permissao.deleteMany({ where: { usuario: { empresaId: id } } }); await prisma.usuario.deleteMany({ where: { empresaId: id } });
    await prisma.filial.deleteMany({ where: { empresaId: id } });
    await prisma.empresa.delete({ where: { id } }).catch((err) => console.log('[limpeza]', String(err.message).match(/constraint[^\n]*/)?.[0]));
  }
});
