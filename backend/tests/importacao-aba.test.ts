/**
 * TESTE DE INTEGRAÇÃO — ABA IMPORTAÇÃO
 *
 * A aba é um fluxo de 11 passos (Seção 30) que termina em duas escritas: os
 * PRODUTOS importados e o registro de AUDITORIA da operação. O teste existe
 * porque o endpoint tinha dois defeitos de lógica que só aparecem no fim do
 * fluxo:
 *
 *   1. SUCESSO FALSO: `confirmado:true` para entidade sem rotina de gravação
 *      (ou para arquivo vazio) devolvia status IMPORTADO com qtdImportada: 0 —
 *      a tela mostrava sucesso sem gravar nada.
 *   2. DUPLICIDADE IGNORADA: a duplicidade de SKU no arquivo era apenas
 *      AVISADA; a importação seguia, batia no SKU na gravação e derrubava a
 *      transação INTEIRA com a mensagem errada ("SKU já cadastrado nesta
 *      empresa", sendo que era o próprio arquivo). No fluxo documentado, a
 *      duplicidade vem ANTES da confirmação e deve travar a importação.
 *
 * Cobertura:
 *   1. Importação feliz: produtos gravados, margem calculada, Importacao e
 *      auditoria persistidos.
 *   2. Rollback real: erro só detectado dentro da transação desfaz TUDO.
 *   3. Duplicidade no arquivo trava a importação (com mensagem correta).
 *   4. SKU já existente na empresa trava a importação.
 *   5. Sucesso falso eliminado (arquivo vazio, entidade não suportada).
 *   6. Entrada inválida devolve 400 e não grava nada.
 *   7. GET /importacoes: persistência, ordenação, isolamento por empresa.
 *   8. Permissões (401/403) e multi-tenant.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { importacaoRoutes } from '../src/modules/importacao/importacao.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-importacao';
const SUFIXO = Date.now().toString(36);
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

/** Registro gravado na tabela `Importacao` (não modelada no schema.prisma —
 *  o código usa SQL bruto, então o teste também precisa ler via SQL bruto). */
async function registroImportacao(id: string) {
  const linhas = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM "Importacao" WHERE "id" = $1`, id,
  );
  return linhas[0];
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
    // Espelha o handler global do server.ts: Error puro = 400 (erro de cliente).
    if (error?.constructor === Error) return reply.status(400).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.' });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  await app.register(importacaoRoutes);

  const empresa = await prisma.empresa.create({
    data: { nome: `Empresa Import ${SUFIXO}`, cnpj: `imp${SUFIXO}`, status: 'ATIVO' as any },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `Empresa Import 2 ${SUFIXO}`, cnpj: `imp2${SUFIXO}`, status: 'ATIVO' as any },
  });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Filial Import' } });
  const filial2 = await prisma.filial.create({ data: { empresaId: empresa2.id, nome: 'Filial Import 2' } });
  const senhaHash = await hashSenha('senha12345');

  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, filialId: filial.id, nome: 'Admin Import', email: `admin.imp.${SUFIXO}@teste.com`, senhaHash },
  });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa.id, filialId: filial.id, nome: 'Sem Permissão', email: `semperm.imp.${SUFIXO}@teste.com`, senhaHash },
  });
  const usuario2 = await prisma.usuario.create({
    data: { empresaId: empresa2.id, filialId: filial2.id, nome: 'Admin Import 2', email: `admin2.imp.${SUFIXO}@teste.com`, senhaHash },
  });

  await prisma.permissao.createMany({
    data: MODULOS.flatMap((modulo) => ACOES.map((acao) => ({ usuarioId: usuario.id, modulo, acao, permitido: true }))),
    skipDuplicates: true,
  });
  await prisma.permissao.createMany({
    data: MODULOS.flatMap((modulo) => ACOES.map((acao) => ({ usuarioId: usuario2.id, modulo, acao, permitido: true }))),
    skipDuplicates: true,
  });

  const token = app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email });
  const token2 = app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email });
  const tokenSem = app.jwt.sign({ id: semPermissao.id, empresaId: empresa.id, email: semPermissao.email });

  const H = { authorization: `Bearer ${token}` };
  const H2 = { authorization: `Bearer ${token2}` };
  const Hsem = { authorization: `Bearer ${tokenSem}` };
  const req = (metodo: string, url: string, payload?: any, headers: any = H) =>
    app.inject({ method: metodo as any, url, payload, headers });

  const mapaProduto = () => ({ entidade: 'Produto', campos: { nome: 'nome', sku: 'sku', custo: 'custo', precoVenda: 'precoVenda' }, confirmado: true });

  try {
    console.log('\n--- 1. Importação feliz: grava produto, Importacao e auditoria ---');
    const feliz = await req('POST', '/importacao', {
      tipo: 'json',
      dados: [
        { nome: `Café ${SUFIXO}`, sku: `CAFE-${SUFIXO}`, custo: 10, precoVenda: 20 },
        { nome: `Açúcar ${SUFIXO}`, sku: `ACUC-${SUFIXO}`, custo: 4, precoVenda: 10 },
      ],
      mapeamento: mapaProduto(),
    });
    ok('POST /importacao -> 200', feliz.statusCode === 200, `status=${feliz.statusCode} body=${JSON.stringify(feliz.json())}`);
    const corpo = feliz.json();
    ok('qtdImportada = 2', corpo.qtdImportada === 2, `qtdImportada=${corpo.qtdImportada}`);
    ok('sem erros', Array.isArray(corpo.erros) && corpo.erros.length === 0, JSON.stringify(corpo.erros));
    ok('sem duplicidades', Array.isArray(corpo.duplicidades) && corpo.duplicidades.length === 0);
    ok('colunas identificadas a partir da 1ª linha', Array.isArray(corpo.colunas) && corpo.colunas.includes('sku'), JSON.stringify(corpo.colunas));
    ok('pré-visualização traz as linhas', corpo.preview?.length === 2, `preview=${corpo.preview?.length}`);
    ok('o registro de Importacao diz IMPORTADO', corpo.importacao?.status === 'IMPORTADO', `status=${corpo.importacao?.status}`);
    ok('qtdTotal/qtdImportada/qtdErro corretos',
      Number(corpo.importacao?.qtdTotal) === 2 && Number(corpo.importacao?.qtdImportada) === 2 && Number(corpo.importacao?.qtdErro) === 0,
      JSON.stringify({ t: corpo.importacao?.qtdTotal, i: corpo.importacao?.qtdImportada, e: corpo.importacao?.qtdErro }));

    // PERSISTÊNCIA — reler do banco, não confiar na resposta.
    const produtos = await prisma.produto.findMany({
      where: { empresaId: empresa.id, sku: { in: [`CAFE-${SUFIXO}`, `ACUC-${SUFIXO}`] } },
    });
    ok('os 2 produtos existem no PostgreSQL', produtos.length === 2, `encontrados=${produtos.length}`);
    const cafe = produtos.find((p) => p.sku === `CAFE-${SUFIXO}`);
    ok('produto carrega origem IMPORTADO', cafe?.origem === 'IMPORTADO', `origem=${cafe?.origem}`);
    ok('margem calculada (10/20 -> 50%)', Math.abs(Number(cafe?.margem) - 50) < 0.001, `margem=${cafe?.margem}`);
    ok('status ATIVO por padrão', cafe?.status === 'ATIVO', `status=${cafe?.status}`);
    const registro = await registroImportacao(String(corpo.importacao.id));
    ok('o registro de Importacao foi persistido no banco', !!registro, String(registro?.id));
    ok('o registro persistido diz IMPORTADO', registro?.status === 'IMPORTADO', `status=${registro?.status}`);
    const auditorias = await prisma.auditoria.findMany({
      where: { empresaId: empresa.id, acao: 'IMPORTAR', entidade: 'Importacao', entidadeId: String(corpo.importacao.id) },
    });
    ok('a operação foi auditada', auditorias.length === 1, `n=${auditorias.length}`);

    console.log('\n--- 2. Rollback real: erro detectado SÓ dentro da transação ---');
    const antes = await prisma.produto.count({ where: { empresaId: empresa.id } });
    // `custo: 0` passa na validação prévia (que só checa nome) e só estoura
    // dentro do $transaction — é o caminho que precisa desfazer o produto já
    // criado na linha anterior.
    const rollback = await req('POST', '/importacao', {
      tipo: 'json',
      dados: [
        { nome: `Rollback Bom ${SUFIXO}`, sku: `RKB-${SUFIXO}`, custo: 10, precoVenda: 20 },
        { nome: `Rollback Ruim ${SUFIXO}`, sku: `RKR-${SUFIXO}`, custo: 0, precoVenda: 20 },
      ],
      mapeamento: mapaProduto(),
    });
    ok('POST com erro interno -> 200 (erros vêm no corpo)', rollback.statusCode === 200, `status=${rollback.statusCode}`);
    ok('qtdImportada = 0 no erro', rollback.json().qtdImportada === 0, `qtdImportada=${rollback.json().qtdImportada}`);
    ok('status ERRO registrado', rollback.json().importacao?.status === 'ERRO', `status=${rollback.json().importacao?.status}`);
    ok('o erro de custo foi reportado', rollback.json().erros.some((e: any) => String(e.erro).includes('custo')), JSON.stringify(rollback.json().erros));
    const depois = await prisma.produto.count({ where: { empresaId: empresa.id } });
    ok('NENHUM produto foi criado (rollback efetivo)', depois === antes, `antes=${antes} depois=${depois}`);
    const registroRb = await registroImportacao(String(rollback.json().importacao.id));
    ok('registro de Importacao persistido como ERRO', registroRb?.status === 'ERRO', `status=${registroRb?.status}`);
    ok('qtdErro persistida > 0', Number(registroRb?.qtdErro) > 0, `qtdErro=${registroRb?.qtdErro}`);

    console.log('\n--- 3. Duplicidade de SKU NO ARQUIVO trava a importação ---');
    const antesDup = await prisma.produto.count({ where: { empresaId: empresa.id } });
    const dup = await req('POST', '/importacao', {
      tipo: 'json',
      dados: [
        { nome: `Dup A ${SUFIXO}`, sku: `DUP-${SUFIXO}`, custo: 10, precoVenda: 20 },
        { nome: `Dup B ${SUFIXO}`, sku: `DUP-${SUFIXO}`, custo: 11, precoVenda: 21 },
      ],
      mapeamento: mapaProduto(),
    });
    ok('a duplicidade é reportada', dup.json().duplicidades?.length === 1, JSON.stringify(dup.json().duplicidades));
    ok('a duplicidade identifica a linha', dup.json().duplicidades?.[0]?.linha === 1, JSON.stringify(dup.json().duplicidades));
    ok('qtdImportada = 0', dup.json().qtdImportada === 0, `qtdImportada=${dup.json().qtdImportada}`);
    ok('status ERRO', dup.json().importacao?.status === 'ERRO', `status=${dup.json().importacao?.status}`);
    ok('a mensagem é de duplicidade NO ARQUIVO, não "já cadastrado"',
      dup.json().erros.some((e: any) => String(e.erro).includes('duplicado no arquivo')) &&
      !dup.json().erros.some((e: any) => String(e.erro).includes('já cadastrado nesta empresa')),
      JSON.stringify(dup.json().erros));
    const depoisDup = await prisma.produto.count({ where: { empresaId: empresa.id } });
    ok('nenhum produto criado pela duplicidade', depoisDup === antesDup, `antes=${antesDup} depois=${depoisDup}`);

    console.log('\n--- 4. SKU já existente NA EMPRESA trava a importação ---');
    const antesSku = await prisma.produto.count({ where: { empresaId: empresa.id } });
    const skuExistente = await req('POST', '/importacao', {
      tipo: 'json',
      dados: [
        { nome: `Novo ${SUFIXO}`, sku: `CAFE-${SUFIXO}`, custo: 5, precoVenda: 9 },
      ],
      mapeamento: mapaProduto(),
    });
    ok('SKU existente gera erro', skuExistente.json().erros?.length === 1, JSON.stringify(skuExistente.json().erros));
    ok('a mensagem é de SKU já cadastrado', skuExistente.json().erros?.[0]?.erro?.includes('já cadastrado'), JSON.stringify(skuExistente.json().erros));
    ok('qtdImportada = 0', skuExistente.json().qtdImportada === 0, `qtdImportada=${skuExistente.json().qtdImportada}`);
    const depoisSku = await prisma.produto.count({ where: { empresaId: empresa.id } });
    ok('nenhum produto criado (não duplica o existente)', depoisSku === antesSku, `antes=${antesSku} depois=${depoisSku}`);
    const cafeAinda = await prisma.produto.findMany({ where: { empresaId: empresa.id, sku: `CAFE-${SUFIXO}` } });
    ok('o produto original permanece intacto (1 registro)', cafeAinda.length === 1, `n=${cafeAinda.length}`);

    console.log('\n--- 5. Sucesso falso eliminado ---');
    const vazio = await req('POST', '/importacao', { tipo: 'json', dados: [], mapeamento: mapaProduto() });
    ok('arquivo vazio -> 400', vazio.statusCode === 400, `status=${vazio.statusCode}`);
    ok('mensagem de arquivo vazio', String(vazio.json().error).includes('vazio'), JSON.stringify(vazio.json()));

    const outraEntidade = await req('POST', '/importacao', {
      tipo: 'json',
      dados: [{ nome: `Func ${SUFIXO}` }],
      mapeamento: { entidade: 'Funcionario', campos: { nome: 'nome' }, confirmado: true },
    });
    ok('entidade sem rotina de gravação NÃO reporta sucesso falso',
      outraEntidade.json().importacao?.status === 'ERRO' && Number(outraEntidade.json().importacao?.qtdImportada) === 0,
      JSON.stringify({ s: outraEntidade.json().importacao?.status, i: outraEntidade.json().importacao?.qtdImportada }));
    ok('o motivo é explicado', outraEntidade.json().erros.some((e: any) => String(e.erro).includes('não suportada')), JSON.stringify(outraEntidade.json().erros));

    const semConfirmar = await req('POST', '/importacao', {
      tipo: 'json',
      dados: [{ nome: `SemConf ${SUFIXO}`, sku: `SC-${SUFIXO}`, custo: 1, precoVenda: 2 }],
      mapeamento: { ...mapaProduto(), confirmado: false },
    });
    ok('sem confirmação -> status MAPEANDO', semConfirmar.json().importacao?.status === 'MAPEANDO', `status=${semConfirmar.json().importacao?.status}`);
    ok('sem confirmação nada é gravado',
      (await prisma.produto.count({ where: { empresaId: empresa.id, sku: `SC-${SUFIXO}` } })) === 0);

    console.log('\n--- 6. Entrada inválida -> 400, nada gravado ---');
    const naoArray = await req('POST', '/importacao', { tipo: 'json', dados: 'oops', mapeamento: mapaProduto() });
    ok('dados não-array -> 400', naoArray.statusCode === 400, `status=${naoArray.statusCode}`);
    const acima = await req('POST', '/importacao', {
      tipo: 'json',
      dados: Array.from({ length: 5001 }, (_, i) => ({ nome: `x${i}` })),
      mapeamento: mapaProduto(),
    });
    ok('5001 linhas -> 400 com limite claro', acima.statusCode === 400 && String(acima.json().error).includes('5000'), `status=${acima.statusCode}`);
    const semMapeamento = await req('POST', '/importacao', { tipo: 'json', dados: [{ nome: 'x' }] });
    ok('sem mapeamento -> 400', semMapeamento.statusCode === 400, `status=${semMapeamento.statusCode}`);
    const semEntidade = await req('POST', '/importacao', { tipo: 'json', dados: [{ nome: 'x' }], mapeamento: { campos: {} } });
    ok('mapeamento sem entidade -> 400', semEntidade.statusCode === 400, `status=${semEntidade.statusCode}`);

    // Regressão da 2ª auditoria: validação lia com defaults, gravação lia
    // `mapeamento.campos.nome` sem optional chaining -> TypeError (500).
    const semCampos = await req('POST', '/importacao', {
      tipo: 'json',
      dados: [{ nome: `SemCampos ${SUFIXO}`, custo: 3, precoVenda: 6 }],
      mapeamento: { entidade: 'Produto', confirmado: true },
    });
    ok('mapeamento SEM campos usa os mesmos defaults da validação (não 500)',
      semCampos.statusCode === 200 && semCampos.json().qtdImportada === 1,
      `status=${semCampos.statusCode} body=${JSON.stringify(semCampos.json())}`);
    ok('o produto do mapeamento sem campos foi gravado',
      (await prisma.produto.count({ where: { empresaId: empresa.id, nome: `SemCampos ${SUFIXO}` } })) === 1);

    // Regressão da 2ª auditoria: `[null]` é JSON válido e derrubava com TypeError.
    const linhaNula = await req('POST', '/importacao', { tipo: 'json', dados: [null], mapeamento: mapaProduto() });
    ok('dados [null] -> 200 com erro de validação (não 500)',
      linhaNula.statusCode === 200 && linhaNula.json().qtdImportada === 0,
      `status=${linhaNula.statusCode} body=${JSON.stringify(linhaNula.json())}`);
    ok('a linha nula é reportada como inválida',
      linhaNula.json().erros?.some((e: any) => String(e.erro).includes('Linha inválida')), JSON.stringify(linhaNula.json().erros));


    console.log('\n--- 7. GET /importacoes: persistência, ordenação e isolamento ---');
    const lista = await req('GET', '/importacoes');
    ok('GET /importacoes -> 200', lista.statusCode === 200, `status=${lista.statusCode}`);
    const ids = lista.json().map((r: any) => r.id);
    ok('a listagem devolve os registros criados', ids.includes(String(corpo.importacao.id)) && ids.includes(String(rollback.json().importacao.id)), `n=${ids.length}`);
    const datas = lista.json().map((r: any) => new Date(r.createdAt).getTime());
    ok('ordenado do mais recente para o mais antigo', datas.every((d: number, i: number) => i === 0 || d <= datas[i - 1]), JSON.stringify(datas));
    const somenteCafe = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS n FROM "Importacao" WHERE "empresaId" = $1 AND "tipo" = 'json'`, empresa.id);
    ok('registros persistidos para a empresa logada', Number(somenteCafe[0].n) >= 4, `n=${somenteCafe[0].n}`);
    const daOutra = await req('GET', '/importacoes', undefined, H2);
    ok('a outra empresa não vê estas importações',
      daOutra.statusCode === 200 && daOutra.json().every((r: any) => r.empresaId !== empresa.id),
      JSON.stringify(daOutra.json().map((r: any) => r.empresaId)));

    console.log('\n--- 8. Permissões e autenticação ---');
    ok('sem token -> 401', (await req('POST', '/importacao', { dados: [], mapeamento: {} }, {})).statusCode === 401);
    ok('sem permissão importacao.criar -> 403',
      (await req('POST', '/importacao', { tipo: 'json', dados: [{ nome: 'x' }], mapeamento: mapaProduto() }, Hsem)).statusCode === 403);
    ok('sem permissão importacao.visualizar -> 403',
      (await req('GET', '/importacoes', undefined, Hsem)).statusCode === 403);
    ok('token de outra empresa não lê esta empresa', (await req('GET', '/importacoes', undefined, H2)).statusCode === 200);
  } finally {
    const empresas = [empresa.id, empresa2.id];
    const usuarios = [usuario.id, semPermissao.id, usuario2.id];
    // Importacao e Auditoria têm FK para Empresa/Usuario (RESTRICT) — saem antes.
    await prisma.$executeRawUnsafe(`DELETE FROM "Importacao" WHERE "empresaId" = ANY($1::text[])`, empresas);
    await prisma.auditoria.deleteMany({ where: { empresaId: { in: empresas } } });
    await prisma.produto.deleteMany({ where: { empresaId: { in: empresas } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: usuarios } } });
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
    await prisma.filial.deleteMany({ where: { empresaId: { in: empresas } } });
    await prisma.empresa.deleteMany({ where: { id: { in: empresas } } });
    await app.close();
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: aba importação', async () => {
  await main();
});

