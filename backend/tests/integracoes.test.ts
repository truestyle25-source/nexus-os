/**
 * TESTE DE INTEGRAÇÃO — CENTRAL DE INTEGRAÇÕES
 *
 * A aba tem duas partes: a Central (`GET /integracoes`, que agrega PDV + Ponto +
 * IA + E-mail) e a gestão de chaves de API pública (`/api-publica/chaves`).
 * O achado principal da auditoria foi no SEGUNDO bloco, e é o que este teste
 * trava:
 *
 *   A tela oferecia "Expiração" (30d/90d/1ano/nunca) e "IP Whitelist" como
 *   controles interativos de SEGURANÇA, mas `criarChave` enviava só
 *   `{ nome, escopos }`. O schema do backend aceita apenas esses dois campos e
 *   o modelo `ChaveApi` não tem `expiraEm` nem coluna de IP. Quem escolhia
 *   "30 dias" recebia uma chave que nunca expira; quem preenchia o IP achava
 *   que a chave só valia dali — valia de qualquer origem. Aqui provamos que o
 *   contrato é esse: nada além de nome e escopos é aceito ou gravado.
 *
 *   O restante cobre o fluxo completo da Central e das chaves: criar -> reler
 *   do PostgreSQL -> a chave REAL autentica um endpoint público -> revogar ->
 *   a chave deixa de autenticar. Mais validações, permissões e multi-tenant.
 */
import { test } from 'node:test';
import { createServer } from 'node:http';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha } from '../src/lib/auth.js';
import { integracoesRoutes } from '../src/modules/integracoes/integracoes.routes.js';
import { apiPublicaRoutes } from '../src/modules/api-publica/api-publica.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { encryptSecret, decryptSecret } from '../src/lib/secrets.js';
import { redigirUrlSensiveis, serializerDeRequest } from '../src/lib/log-redacao.js';
import { renovarToken } from '../src/modules/integracoes/mercadolivre.service.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-integracoes';
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
  await app.register(integracoesRoutes);
  await app.register(apiPublicaRoutes);

  const empresa = await prisma.empresa.create({
    data: { nome: `IntegTeste ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `IntegOutro ${SUFIXO}`, cnpj: `${Date.now()}`.padStart(14, '0') },
  });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Filial Integ' } });
  const filial2 = await prisma.filial.create({ data: { empresaId: empresa2.id, nome: 'Filial Outro' } });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: 'Teste Integ', email: `integ-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Sem Permissao', email: `seminteg-${SUFIXO}@teste.local`, senhaHash },
  });
  const usuario2 = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Outro Tenant', email: `outrointeg-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario2.id })) });

  const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email })}` };
  const H2 = { authorization: `Bearer ${app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email })}` };
  const ids = [usuario.id, semPermissao.id, usuario2.id];
  const produto = await prisma.produto.create({
    data: { empresaId: empresa.id, nome: 'Produto Integ', sku: `PI-${SUFIXO}`, precoVenda: 30, custo: 10, status: 'ATIVO', origem: 'MANUAL' },
  });
  await prisma.estoque.create({ data: { empresaId: empresa.id, filialId: filial.id, produtoId: produto.id, quantidade: 7 } });

  try {
    console.log('\n1. GET /integracoes agrega registros REAIS');
    const central = await app.inject({ method: 'GET', url: '/integracoes', headers: H });
    ok('GET /integracoes -> 200', central.statusCode === 200, `status=${central.statusCode}`);
    const c = central.json();
    ok('devolve itens e resumo', Array.isArray(c.itens) && !!c.resumo);
    // IA e E-mail sempre entram, com status derivado do ambiente.
    ok('IA_GEMINI presente', c.itens.some((i: any) => i.categoria === 'IA_GEMINI'));
    ok('EMAIL_TRANSACIONAL presente', c.itens.some((i: any) => i.categoria === 'EMAIL_TRANSACIONAL'));
    ok('resumo bate com os itens', c.resumo.total === c.itens.length,
      `resumo=${JSON.stringify(c.resumo)} itens=${c.itens.length}`);
    ok('conectadas + comErro + naoConfiguradas = total',
      c.resumo.conectadas + c.resumo.comErro + c.resumo.naoConfiguradas === c.resumo.total,
      JSON.stringify(c.resumo));

    console.log('\n2. Integracao de PDV gravada aparece na Central');
    await prisma.integracaoPDV.create({
      data: {
        empresaId: empresa.id, nome: 'Equipamento Caixa 1',
        url: 'http://exemplo.local', status: 'CONECTADO',
        tipo: 'API_OFICIAL', qtdRegistros: 12, ultimaSincronizacao: new Date(), origem: 'MANUAL',
      },
    });
    const comPdv = await app.inject({ method: 'GET', url: '/integracoes', headers: H });
    const cp = comPdv.json();
    ok('PDV aparece na lista', cp.itens.some((i: any) => i.categoria === 'PDV' && i.nome === 'Equipamento Caixa 1'));
    const itemPdv = cp.itens.find((i: any) => i.categoria === 'PDV');
    ok('ultima sincronizacao real devolvida', !!itemPdv?.ultimaSincronizacao);
    ok('qtdRegistros real devolvido', itemPdv?.qtdRegistros === 12, `qtd=${itemPdv?.qtdRegistros}`);

    console.log('\n3. Criar chave: o contrato e NOME + ESCOPOS (nada mais)');
    const criar = await app.inject({
      method: 'POST', url: '/api-publica/chaves', headers: H,
      payload: { nome: 'Chave ERP', escopos: ['produtos:leitura', 'vendas:leitura'] },
    });
    ok('POST /api-publica/chaves -> 200', criar.statusCode === 200, `status=${criar.statusCode} corpo=${criar.body.slice(0, 200)}`);
    const chave = criar.json();
    ok('devolve a chave completa UMA vez', typeof chave.chave === 'string' && chave.chave.startsWith('nx_'), `chave=${chave.chave}`);
    ok('devolve prefixo', typeof chave.prefixo === 'string' && chave.prefixo.length > 0);
    ok('aviso de guardar agora', typeof chave.aviso === 'string' && chave.aviso.length > 0);

    console.log('\n4. "Expiracao" e "IP Whitelist" NAO existem no contrato');
    // É o bug corrigido: a tela oferecia esses controles e nada era gravado.
    // O schema não os aceita — e o modelo ChaveApi não tem as colunas.
    const colunas = Object.keys(
      (await prisma.chaveApi.findUnique({ where: { id: chave.id } })) as Record<string, unknown>,
    );
    ok('ChaveApi nao tem coluna de expiracao', !colunas.includes('expiraEm'), `colunas=${colunas.join(',')}`);
    ok('ChaveApi nao tem coluna de IP', !colunas.some((c2) => c2.toLowerCase().includes('ip')), `colunas=${colunas.join(',')}`);
    const comExpiracao = await app.inject({
      method: 'POST', url: '/api-publica/chaves', headers: H,
      payload: { nome: 'Chave Expirando', escopos: ['produtos:leitura'], expiracao: '30d', ipWhitelist: '10.0.0.1' },
    });
    ok('campos extras sao aceitos e IGNORados (nao inventam garantia)',
      comExpiracao.statusCode === 200, `status=${comExpiracao.statusCode}`);
    const criada2 = comExpiracao.json();
    const reg2 = await prisma.chaveApi.findUnique({ where: { id: criada2.id } });
    ok('a chave "com expiracao" NAO carrega expiracao alguma',
      reg2 && !Object.keys(reg2).some((c2) => /expira|whitelist/i.test(c2)));
    console.log('\n5. FLUXO COMPLETO: a chave criada autentica um endpoint publico');
    const pub = await app.inject({ method: 'GET', url: '/api/v1/produtos', headers: { authorization: `Bearer ${chave.chave}` } });
    ok('GET /api/v1/produtos com a chave -> 200', pub.statusCode === 200, `status=${pub.statusCode} corpo=${pub.body.slice(0, 200)}`);
    ok('devolve o produto da empresa', pub.json().some((p: any) => p.id === produto.id));
    const semEscopo = await app.inject({ method: 'GET', url: '/api/v1/clientes', headers: { authorization: `Bearer ${chave.chave}` } });
    ok('chave SEM o escopo clientes -> 403', semEscopo.statusCode === 403, `status=${semEscopo.statusCode}`);
    ok('sem token -> 401',
      (await app.inject({ method: 'GET', url: '/api/v1/produtos' })).statusCode === 401);
    ok('chave inventada -> 401',
      (await app.inject({ method: 'GET', url: '/api/v1/produtos', headers: { authorization: 'Bearer nx_falso_falso' } })).statusCode === 401);

    console.log('\n6. Listagem devolve somente metadados, NUNCA o segredo');
    const lista = await app.inject({ method: 'GET', url: '/api-publica/chaves', headers: H });
    ok('GET /api-publica/chaves -> 200', lista.statusCode === 200);
    ok('chave gravada aparece na lista', lista.json().some((k: any) => k.id === chave.id));
    ok('a listagem NAO devolve o segredo', !JSON.stringify(lista.json()).includes(chave.chave));
    ok('a listagem devolve o prefixo', lista.json().some((k: any) => k.prefixo === chave.prefixo));
    const noBanco = await prisma.chaveApi.findUnique({ where: { id: chave.id } });
    ok('o banco guarda o HASH, nao a chave', noBanco?.chaveHash !== chave.chave && !!noBanco?.chaveHash);

    console.log('\n7. Revogar: muda de verdade e a chave deixa de autenticar');
    const rev = await app.inject({ method: 'POST', url: `/api-publica/chaves/${chave.id}/revogar`, headers: H, payload: {} });
    ok('POST revogar -> 200', rev.statusCode === 200, `status=${rev.statusCode}`);
    ok('status = REVOGADA', rev.json().status === 'REVOGADA', `status=${rev.json().status}`);
    ok('revogadaEm gravado', !!rev.json().revogadaEm);
    const revDb = await prisma.chaveApi.findUnique({ where: { id: chave.id } });
    ok('revogacao persistida no PostgreSQL', revDb?.status === 'REVOGADA');
    const depois = await app.inject({ method: 'GET', url: '/api/v1/produtos', headers: { authorization: `Bearer ${chave.chave}` } });
    ok('chave revogada NAO autentica mais', depois.statusCode === 401, `status=${depois.statusCode}`);
    const rev2 = await app.inject({ method: 'POST', url: `/api-publica/chaves/${chave.id}/revogar`, headers: H, payload: {} });
    ok('revogar duas vezes -> 409', rev2.statusCode === 409, `status=${rev2.statusCode}`);
    const revAlheia = await app.inject({ method: 'POST', url: `/api-publica/chaves/${chave.id}/revogar`, headers: H2, payload: {} });
    ok('empresa B nao revoga chave da A -> 404', revAlheia.statusCode === 404, `status=${revAlheia.statusCode}`);

    console.log('\n8. Validacoes');
    ok('nome curto -> 400',
      (await app.inject({ method: 'POST', url: '/api-publica/chaves', headers: H, payload: { nome: 'a', escopos: ['produtos:leitura'] } })).statusCode === 400);
    ok('sem escopos -> 400',
      (await app.inject({ method: 'POST', url: '/api-publica/chaves', headers: H, payload: { nome: 'Sem escopo', escopos: [] } })).statusCode === 400);
    ok('escopo de escrita recusado -> 400',
      (await app.inject({ method: 'POST', url: '/api-publica/chaves', headers: H, payload: { nome: 'Escopo ruim', escopos: ['produtos:escrita'] } })).statusCode === 400);
    ok('escopo inventado recusado -> 400',
      (await app.inject({ method: 'POST', url: '/api-publica/chaves', headers: H, payload: { nome: 'Escopo inexistente', escopos: ['admin:leitura'] } })).statusCode === 400);

    console.log('\n9. Permissoes e isolamento multi-tenant');
    ok('GET /integracoes sem permissao -> 403',
      (await app.inject({ method: 'GET', url: '/integracoes', headers: Hsem })).statusCode === 403);
    ok('GET /api-publica/chaves sem permissao -> 403',
      (await app.inject({ method: 'GET', url: '/api-publica/chaves', headers: Hsem })).statusCode === 403);
    ok('POST /api-publica/chaves sem permissao -> 403',
      (await app.inject({ method: 'POST', url: '/api-publica/chaves', headers: Hsem, payload: { nome: 'X', escopos: ['produtos:leitura'] } })).statusCode === 403);
    ok('GET /integracoes sem token -> 401',
      (await app.inject({ method: 'GET', url: '/integracoes' })).statusCode === 401);
    const listaB = await app.inject({ method: 'GET', url: '/api-publica/chaves', headers: H2 });
    ok('empresa B nao ve as chaves da empresa A', !listaB.json().some((k: any) => k.id === chave.id));
    const centralB = await app.inject({ method: 'GET', url: '/integracoes', headers: H2 });
    ok('empresa B nao ve o PDV da empresa A',
      !centralB.json().itens.some((i: any) => i.nome === 'Equipamento Caixa 1'));

    console.log('\n10. Mercado Livre: contrato OAuth SEM fingir sucesso');
    // O fluxo real e authorization code com chamadas a API oficial. Sem
    // credenciais/sem rede o sistema DEVE recusar ou reportar erro — nunca
    // marcar CONECTADO. Estes testes travam exatamente isso.
    const mlGet = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre', headers: H });
    ok('GET /integracoes/mercadolivre -> 200', mlGet.statusCode === 200, `status=${mlGet.statusCode}`);
    const mlSt = mlGet.json();
    ok('sem registro o status e NAO_CONFIGURADO', mlSt.status === 'NAO_CONFIGURADO', `status=${mlSt.status}`);
    ok('configuradoAmbiente e booleano (nada de credencial exposta)',
      typeof mlSt.configuradoAmbiente === 'boolean');
    ok('resposta do status NAO carrega tokens/clientSecret',
      !/accessToken|refreshToken|clientSecret/i.test(mlGet.body), mlGet.body.slice(0, 200));

    const centralMl = await app.inject({ method: 'GET', url: '/integracoes', headers: H });
    const itemMl = centralMl.json().itens.find((i: any) => i.categoria === 'MERCADO_LIVRE');
    ok('Central agrega item MERCADO_LIVRE', !!itemMl, JSON.stringify(centralMl.json().itens.map((i: any) => i.categoria)));
    ok('item ML sem registro e NAO_CONFIGURADO', itemMl?.status === 'NAO_CONFIGURADO', `status=${itemMl?.status}`);
    ok('item ML expoe configuradoAmbiente booleano (UI distingue "aguardando credenciais" de "desconectado")',
      typeof itemMl?.configuradoAmbiente === 'boolean', JSON.stringify(itemMl));
    ok('item ML sem conta NUNCA marcado como configurado/conectado',
      itemMl?.configurado === false && itemMl?.status !== 'CONECTADO', JSON.stringify(itemMl));
    ok('resumo continua consistente com o novo item',
      centralMl.json().resumo.total === centralMl.json().itens.length);

    ok('GET ML sem token -> 401',
      (await app.inject({ method: 'GET', url: '/integracoes/mercadolivre' })).statusCode === 401);
    ok('POST conectar ML sem permissao -> 403',
      (await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/conectar', headers: Hsem, payload: {} })).statusCode === 403);
    ok('DELETE ML sem permissao -> 403',
      (await app.inject({ method: 'DELETE', url: '/integracoes/mercadolivre', headers: Hsem })).statusCode === 403);

    // Sem credenciais no ambiente, iniciar o fluxo deve FALHAR em vez de
    // devolver uma authUrl montada com segredo inexistente.
    const temCredenciais = Boolean(
      process.env.MERCADOLIVRE_CLIENT_ID && process.env.MERCADOLIVRE_CLIENT_SECRET && process.env.MERCADOLIVRE_REDIRECT_URI,
    );
    if (!temCredenciais) {
      const semCfg = await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/conectar', headers: H, payload: {} });
      ok('conectar sem credenciais -> erro (nao fabrica authUrl)',
        semCfg.statusCode >= 400, `status=${semCfg.statusCode}`);
      ok('erro aponta as variaveis obrigatorias',
        semCfg.body.includes('MERCADOLIVRE_CLIENT_ID'), semCfg.body.slice(0, 200));
    }

    // Com credenciais no ambiente (mockadas AQUI NO TESTE, sem rede real e
    // sem tocar o .env), o fluxo produz a authUrl oficial campo a campo. É a
    // parte do OAuth que não exige conta: o browser ainda precisa autorizar de
    // verdade para o callback acontecer — o que NÃO está simulado aqui.
    console.log('\n10b. Mercado Livre: authUrl oficial com credenciais simuladas (mock de env, sem rede)');
    const envAnteriorMl = {
      MERCADOLIVRE_CLIENT_ID: process.env.MERCADOLIVRE_CLIENT_ID,
      MERCADOLIVRE_CLIENT_SECRET: process.env.MERCADOLIVRE_CLIENT_SECRET,
      MERCADOLIVRE_REDIRECT_URI: process.env.MERCADOLIVRE_REDIRECT_URI,
    };
    process.env.MERCADOLIVRE_CLIENT_ID = `CID-${SUFIXO}`;
    process.env.MERCADOLIVRE_CLIENT_SECRET = `CSEC-${SUFIXO}`;
    process.env.MERCADOLIVRE_REDIRECT_URI = 'http://localhost:3333/integracoes/mercadolivre/callback';
    try {
      const conectando = await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/conectar', headers: H, payload: {} });
      ok('conectar com credenciais -> 200 com authUrl', conectando.statusCode === 200 && !!conectando.json().authUrl,
        `status=${conectando.statusCode} body=${conectando.body.slice(0, 150)}`);
      const authUrl = conectando.statusCode === 200 && conectando.json().authUrl
        ? new URL(conectando.json().authUrl) : null;
      ok('authUrl aponta para o host oficial auth.mercadolivre.com.br',
        authUrl?.host === 'auth.mercadolivre.com.br', String(authUrl?.host));
      ok('response_type=code (authorization code flow)', authUrl?.searchParams.get('response_type') === 'code');
      ok('client_id vem do ambiente (nunca inventado)', authUrl?.searchParams.get('client_id') === `CID-${SUFIXO}`,
        String(authUrl?.searchParams.get('client_id')));
      ok('redirect_uri bate com o configurado',
        authUrl?.searchParams.get('redirect_uri') === 'http://localhost:3333/integracoes/mercadolivre/callback');
      const escopos = (authUrl?.searchParams.get('scope') || '').split(/\s+/).filter(Boolean);
      ok('scope inclui offline_access (garante refresh_token)', escopos.includes('offline_access'), escopos.join(' '));
      ok('scope inclui read', escopos.includes('read'), escopos.join(' '));
      const state = authUrl?.searchParams.get('state') || '';
      ok('state e nonce aleatorio de 24 bytes em base64url (192 bits)', /^[A-Za-z0-9_-]{32}$/.test(state), state);
      const cadastroAuth = await prisma.integracaoExterno.findFirst({ where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE' } });
      ok('cadastro fica CONECTANDO com o mesmo state da URL',
        cadastroAuth?.status === 'CONECTANDO' && cadastroAuth?.state === state, `status=${cadastroAuth?.status}`);
      ok('resposta do conectar NAO expoe clientSecret', !conectando.body.includes(`CSEC-${SUFIXO}`),
        conectando.body.slice(0, 150));

      const deNovo = await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/conectar', headers: H, payload: {} });
      const state2 = deNovo.statusCode === 200 && deNovo.json().authUrl
        ? new URL(deNovo.json().authUrl).searchParams.get('state') : null;
      ok('segundo conectar RETOMA o cadastro com state novo (uso unico renovado)',
        deNovo.statusCode === 200 && !!state2 && state2 !== state, `status=${deNovo.statusCode}`);
      ok('continua existindo UM unico registro ML da empresa (constraint 1:1)',
        (await prisma.integracaoExterno.count({ where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE' } })) === 1);

      const centralCfg = await app.inject({ method: 'GET', url: '/integracoes', headers: H });
      const itemCfg = centralCfg.json().itens.find((i: any) => i.categoria === 'MERCADO_LIVRE');
      ok('Central expoe configuradoAmbiente=true com env preenchido',
        itemCfg?.configuradoAmbiente === true, JSON.stringify(itemCfg));
      ok('CONECTANDO NAO vira CONECTADO nem "configurado" na Central',
        itemCfg?.status === 'NAO_CONFIGURADO' && itemCfg?.configurado === false, JSON.stringify(itemCfg));
    } finally {
      for (const [chave, valor] of Object.entries(envAnteriorMl)) {
        if (valor === undefined) delete process.env[chave];
        else process.env[chave] = valor;
      }
      await prisma.integracaoExterno.deleteMany({ where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE' } });
    }

    console.log('\n11. Mercado Livre: callback e state (nonce, expiracao, uso unico)');
    // Callback e PUBLICO (o browser volta do ML sem sessao NEXUS): a ancora e
    // o `state` persistido. Nunca pode devolver JSON com detalhe interno.
    const cbError = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre/callback?error=access_denied&error_description=Usu%C3%A1rio+negou' });
    ok('callback com error do ML -> 302', cbError.statusCode === 302, `status=${cbError.statusCode}`);
    ok('redirect vai para a Central com ml=erro',
      String(cbError.headers.location).includes('central-integracoes?ml=erro'), String(cbError.headers.location));

    // Query malformada (parâmetro repetido vira ARRAY no Node): o contrato do
    // handler é SEMPRE redirecionar — nunca devolver JSON de erro com detalhe
    // interno. Antes da correção, o .parse lançava ZodError e o usuário ficava
    // preso num 400 JSON cru no meio do fluxo de login do Mercado Livre.
    const cbMalformado = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre/callback?code=a&code=b&state=x' });
    ok('callback com parametro repetido -> 302 (nunca 400/500 JSON)',
      cbMalformado.statusCode === 302, `status=${cbMalformado.statusCode} body=${cbMalformado.body.slice(0, 150)}`);
    ok('query malformada tambem redireciona para a Central',
      String(cbMalformado.headers.location).includes('central-integracoes?ml=erro'), String(cbMalformado.headers.location));

    const cbSemQuery = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre/callback' });
    ok('callback sem query nenhuma -> 302 com motivo generico',
      cbSemQuery.statusCode === 302 && String(cbSemQuery.headers.location).includes('ml=erro'),
      `status=${cbSemQuery.statusCode} loc=${cbSemQuery.headers.location}`);

    // error_description vem do provedor (ou de link forjado): vai para o
    // Location como motivo — precisa de limite para não gerar URL gigante.
    const cbDescricaoLonga = await app.inject({
      method: 'GET', url: `/integracoes/mercadolivre/callback?error=access_denied&error_description=${'X'.repeat(2000)}`,
    });
    const motivoLongo = new URL(String(cbDescricaoLonga.headers.location)).searchParams.get('motivo') || '';
    ok('motivo vindo do provedor e limitado (sem URL gigante no redirect)',
      motivoLongo.length > 0 && motivoLongo.length <= 300, `len=${motivoLongo.length}`);

    const cbStateFalso = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre/callback?code=abc&state=inexistente' });
    ok('state desconhecido -> 302 ml=erro (nao ha sessao para "conferir")',
      cbStateFalso.statusCode === 302 && String(cbStateFalso.headers.location).includes('ml=erro'),
      `status=${cbStateFalso.statusCode} loc=${cbStateFalso.headers.location}`);

    // State EXPIRADO: gravado manualmente com validade vencida.
    await prisma.integracaoExterno.deleteMany({ where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE' } });
    await prisma.integracaoExterno.create({
      data: {
        empresaId: empresa.id, tipo: 'MERCADO_LIVRE', nome: 'ML Expirado',
        status: 'CONECTANDO', state: `state-exp-${SUFIXO}`, stateExpiraEm: new Date(Date.now() - 1000),
        clientId: encryptSecret('cid-teste'), clientSecret: encryptSecret('csec-teste'),
        redirectUri: 'http://localhost:3333/integracoes/mercadolivre/callback',
      },
    });
    const cbExpirado = await app.inject({ method: 'GET', url: `/integracoes/mercadolivre/callback?code=xyz&state=state-exp-${SUFIXO}` });
    ok('state expirado -> 302 ml=erro',
      cbExpirado.statusCode === 302 && String(cbExpirado.headers.location).includes('ml=erro'),
      `status=${cbExpirado.statusCode} loc=${cbExpirado.headers.location}`);
    const regExp = await prisma.integracaoExterno.findFirst({ where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE' } });
    ok('state expirado marca o registro como EXPIRADO', regExp?.status === 'EXPIRADO', `status=${regExp?.status}`);

    // State VALIDO mas sem API real: aponta a troca de token para uma porta
    // morta para provar que a rota NUNCA conclui sem o Mercado Livre.
    const urlTokenOriginal = process.env.MERCADOLIVRE_TOKEN_URL;
    process.env.MERCADOLIVRE_TOKEN_URL = 'http://127.0.0.1:9/oauth/token';
    try {
      await prisma.integracaoExterno.deleteMany({ where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE' } });
      await prisma.integracaoExterno.create({
        data: {
          empresaId: empresa.id, tipo: 'MERCADO_LIVRE', nome: 'ML Pendente',
          status: 'CONECTANDO', state: `state-ok-${SUFIXO}`, stateExpiraEm: new Date(Date.now() + 600_000),
          clientId: encryptSecret('cid-teste'), clientSecret: encryptSecret('csec-teste'),
          redirectUri: 'http://localhost:3333/integracoes/mercadolivre/callback',
        },
      });
      const cbRede = await app.inject({ method: 'GET', url: `/integracoes/mercadolivre/callback?code=codigo-falso&state=state-ok-${SUFIXO}` });
      ok('sem API real o redirect e ml=erro (nunca "conectado")',
        cbRede.statusCode === 302 && String(cbRede.headers.location).includes('ml=erro'),
        `loc=${cbRede.headers.location}`);
      const regRede = await prisma.integracaoExterno.findFirst({ where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE' } });
      ok('conta NAO marcada CONECTADA sem validar na API',
        regRede?.status !== 'CONECTADO', `status=${regRede?.status}`);
      ok('state consumido (uso unico)', regRede?.state === null, `state=${regRede?.state}`);

      const cbReplay = await app.inject({ method: 'GET', url: `/integracoes/mercadolivre/callback?code=codigo-falso&state=state-ok-${SUFIXO}` });
      ok('replay do mesmo state -> ml=erro (consumo unico)',
        cbReplay.statusCode === 302 && String(cbReplay.headers.location).includes('ml=erro'),
        `loc=${cbReplay.headers.location}`);

      console.log('\n12. Mercado Livre: isolamento por tenant no testar/desconectar');
      // O registro pertence a empresa A. B nao pode testar nem desvincular.
      ok('empresa B testar conta da A -> 404',
        (await app.inject({ method: 'POST', url: '/integracoes/mercadolivre/testar', headers: H2, payload: {} })).statusCode === 404);
      ok('empresa B desconectar conta da A -> 404',
        (await app.inject({ method: 'DELETE', url: '/integracoes/mercadolivre', headers: H2 })).statusCode === 404);
      const statusB = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre', headers: H2 });
      ok('empresa B ve o PROPRIO status (NAO_CONFIGURADO), nao o da A',
        statusB.statusCode === 200 && statusB.json().status === 'NAO_CONFIGURADO', statusB.body.slice(0, 200));
      const statusA = await app.inject({ method: 'GET', url: '/integracoes/mercadolivre', headers: H });
      ok('empresa A em CONECTANDO ainda aparece NAO_CONFIGURADO (sem fingir conexao)',
        statusA.statusCode === 200 && statusA.json().status === 'NAO_CONFIGURADO', statusA.body.slice(0, 200));

      // Desconectar (registro sem accessToken -> nenhuma chamada externa).
      const del = await app.inject({ method: 'DELETE', url: '/integracoes/mercadolivre', headers: H });
      ok('empresa A desconecta a propria conta -> 200',
        del.statusCode === 200, `status=${del.statusCode} corpo=${del.body.slice(0, 200)}`);
      ok('resposta da desconexao nao expoe tokens',
        !/accessToken|refreshToken|clientSecret/i.test(del.body), del.body.slice(0, 200));
      const depoisDel = await prisma.integracaoExterno.findFirst({ where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE' } });
      ok('registro removido do PostgreSQL', depoisDel === null);
      ok('desconectar de novo -> 404',
        (await app.inject({ method: 'DELETE', url: '/integracoes/mercadolivre', headers: H })).statusCode === 404);
    } finally {
      if (urlTokenOriginal === undefined) delete process.env.MERCADOLIVRE_TOKEN_URL;
      else process.env.MERCADOLIVRE_TOKEN_URL = urlTokenOriginal;
    }

    console.log('\n13. Mercado Livre: renovacao concorrente usa UMA chamada e rotaciona o token');
    // Trava em processo de renovarToken: duas chamadas simultaneas para o MESMO
    // cadastro compartilham a mesma renovacao real. O endpoint local conta as
    // chamadas e SEGURA a resposta ate `liberar()` para forcar a sobreposicao.
    const urlTokenConc = process.env.MERCADOLIVRE_TOKEN_URL;
    let chamadasConc = 0;
    let liberarResposta: () => void = () => undefined;
    const respostaLiberada = new Promise<void>((resolveLiberar) => { liberarResposta = resolveLiberar; });
    const servidorToken = createServer(async (_req, resposta) => {
      chamadasConc++;
      await respostaLiberada;
      resposta.writeHead(200, { 'Content-Type': 'application/json' });
      resposta.end(JSON.stringify({ access_token: 'access-rotacionado', refresh_token: 'refresh-rotacionado', expires_in: 3600, token_type: 'bearer' }));
    });
    await new Promise<void>((resolveListen) => servidorToken.listen(0, '127.0.0.1', resolveListen));
    process.env.MERCADOLIVRE_TOKEN_URL = `http://127.0.0.1:${(servidorToken.address() as { port: number }).port}/oauth/token`;
    try {
      const cadastroConc = await prisma.integracaoExterno.create({
        data: {
          empresaId: empresa.id, tipo: 'MERCADO_LIVRE', nome: 'ML Concorrente', status: 'CONECTADO',
          clientId: encryptSecret('cid-conc'), clientSecret: encryptSecret('csec-conc'),
          accessToken: encryptSecret('access-antigo'), refreshToken: encryptSecret('refresh-antigo'),
          tokenExpiry: new Date(Date.now() - 60_000),
        },
      });
      const tentativa1 = renovarToken(empresa.id, cadastroConc.id);
      const tentativa2 = renovarToken(empresa.id, cadastroConc.id);
      await new Promise((resolveTick) => setTimeout(resolveTick, 150));
      ok('duas renovacoes concorrentes fazem UMA chamada real ao /oauth/token',
        chamadasConc === 1, `chamadas=${chamadasConc}`);
      liberarResposta();
      const conc = await Promise.allSettled([tentativa1, tentativa2]);
      ok('ambas as tentativas recebem o resultado real (nenhum resultado inventado)',
        conc.every((r) => r.status === 'fulfilled'), JSON.stringify(conc));
      const renovado = await prisma.integracaoExterno.findUnique({ where: { id: cadastroConc.id } });
      ok('refresh_token rotacionado e persistido (descriptografavel)',
        decryptSecret(renovado!.refreshToken!) === 'refresh-rotacionado');
      ok('access_token novo persistido (descriptografavel)',
        decryptSecret(renovado!.accessToken!) === 'access-rotacionado');
      ok('status segue CONECTADO (nenhuma concorrente marcou REAUTENTICAR)',
        renovado?.status === 'CONECTADO', `status=${renovado?.status}`);
      // Prisma devolve o valor ARMAZENADO (sem descriptografar): se ele não
      // contém o texto plano, a coluna está cifrada em repouso — criptografia
      // conferida no banco, não só na função.
      ok('tokens persistidos CIFRADOS em repouso (gravacao != texto plano)',
        typeof renovado?.accessToken === 'string' && !renovado!.accessToken!.includes('access-rotacionado')
          && typeof renovado?.refreshToken === 'string' && !renovado!.refreshToken!.includes('refresh-rotacionado'),
        `accessToken=${String(renovado?.accessToken).slice(0, 40)}`);
    } finally {
      await new Promise<void>((resolveFecha) => servidorToken.close(() => resolveFecha()));
      if (urlTokenConc === undefined) delete process.env.MERCADOLIVRE_TOKEN_URL;
      else process.env.MERCADOLIVRE_TOKEN_URL = urlTokenConc;
    }

    console.log('\n13b. Mercado Livre: falha REAL de renovacao (invalid_grant) marca REAUTENTICAR uma vez');
    const urlTokenFalha = process.env.MERCADOLIVRE_TOKEN_URL;
    let chamadasFalha = 0;
    const servidorFalha = createServer(async (_req, resposta) => {
      chamadasFalha++;
      resposta.writeHead(400, { 'Content-Type': 'application/json' });
      resposta.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Provided authorization grant is invalid' }));
    });
    await new Promise<void>((resolveListen) => servidorFalha.listen(0, '127.0.0.1', resolveListen));
    process.env.MERCADOLIVRE_TOKEN_URL = `http://127.0.0.1:${(servidorFalha.address() as { port: number }).port}/oauth/token`;
    try {
      // Unico registro ML por empresa (constraint (empresaId,tipo) unico):
      // remove o cadastro da secao 13 antes de criar o da 13b.
      await prisma.integracaoExterno.deleteMany({ where: { empresaId: empresa.id, tipo: 'MERCADO_LIVRE' } });
      const cadastroFalha = await prisma.integracaoExterno.create({
        data: {
          empresaId: empresa.id, tipo: 'MERCADO_LIVRE', nome: 'ML Falha Refresh', status: 'CONECTADO',
          clientId: encryptSecret('cid-falha'), clientSecret: encryptSecret('csec-falha'),
          accessToken: encryptSecret('access-falha'), refreshToken: encryptSecret('refresh-falha'),
          tokenExpiry: new Date(Date.now() - 60_000),
        },
      });
      const falha1 = renovarToken(empresa.id, cadastroFalha.id);
      const falha2 = renovarToken(empresa.id, cadastroFalha.id);
      const respostas = await Promise.allSettled([falha1, falha2]);
      ok('falha real: as duas tentativas rejeitam com a mensagem do provedor',
        respostas.every((r) => r.status === 'rejected'
          && String((r as PromiseRejectedResult).reason?.message ?? '').includes('Autorização revogada no Mercado Livre')),
        JSON.stringify(respostas.map((r) => (r.status === 'rejected' ? String((r as PromiseRejectedResult).reason?.message) : 'fulfilled'))));
      ok('falha real: UMA chamada ao /oauth/token mesmo com duas tentativas',
        chamadasFalha === 1, `chamadas=${chamadasFalha}`);
      const marcado = await prisma.integracaoExterno.findUnique({ where: { id: cadastroFalha.id } });
      ok('invalid_grant marca REAUTENTICAR (erro real, nao mascarado)',
        marcado?.status === 'REAUTENTICAR', `status=${marcado?.status}`);
    } finally {
      await new Promise<void>((resolveFecha) => servidorFalha.close(() => resolveFecha()));
      if (urlTokenFalha === undefined) delete process.env.MERCADOLIVRE_TOKEN_URL;
      else process.env.MERCADOLIVRE_TOKEN_URL = urlTokenFalha;
    }

    console.log('\n14. Callback OAuth: code/state NAO aparecem nos logs do Fastify');
    // Unidade + ponta a ponta: MESMA config de logger do server.ts aplicada a um
    // Fastify real, com o output capturado num stream em memoria.
    const urlRedigida = redigirUrlSensiveis('/integracoes/mercadolivre/callback?code=CODIGO-SIGILOSO&state=STATE-SIGILOSO&ml=ok');
    ok('redigirUrlSensiveis mascara code e state', !urlRedigida.includes('CODIGO-SIGILOSO')
      && !urlRedigida.includes('STATE-SIGILOSO') && urlRedigida.includes('[REDACTED]')
      && urlRedigida.includes('/integracoes/mercadolivre/callback') && urlRedigida.includes('ml=ok'), urlRedigida);
    ok('redigirUrlSensiveis preserva URL sem query', redigirUrlSensiveis('/integracoes') === '/integracoes');
    const linhasDeLog: string[] = [];
    const appLog = Fastify({
      logger: {
        level: 'info',
        stream: { write(conteudo: string) { linhasDeLog.push(String(conteudo)); } },
        serializers: { req: serializerDeRequest },
      } as any,
    });
    appLog.get('/integracoes/mercadolivre/callback', async () => ({ ok: true }));
    await appLog.inject({ method: 'GET', url: '/integracoes/mercadolivre/callback?code=CODIGO-SIGILOSO&state=STATE-SIGILOSO' });
    await appLog.ready();
    const logConcatenado = linhasDeLog.join('');
    ok('log da requisicao NAO contem o code OAuth', !logConcatenado.includes('CODIGO-SIGILOSO'), logConcatenado.slice(0, 300));
    ok('log da requisicao NAO contem o state', !logConcatenado.includes('STATE-SIGILOSO'), logConcatenado.slice(0, 300));
    ok('log da requisicao preserva o caminho util para diagnostico',
      logConcatenado.includes('/integracoes/mercadolivre/callback'), logConcatenado.slice(0, 300));
    await appLog.close();
  } finally {
    const todas = [empresa.id, empresa2.id];
    await prisma.chaveApi.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.integracaoExterno.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.integracaoPDV.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.estoque.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.produto.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.filial.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: todas } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: integrações', async () => {
  await main();
});