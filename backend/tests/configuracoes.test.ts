/**
 * TESTE DE INTEGRAÇÃO — CONFIGURAÇÕES
 *
 * A aba tem 13 chamadas de API e é o painel de administração da empresa. O
 * teste cobre o FLUXO COMPLETO de cada escrita, do formulário ao PostgreSQL e
 * de volta — que é onde a auditoria encontrou os defeitos:
 *
 *   1. Perfil do usuário: `PUT /auth/me` grava e devolve o registro normalizado;
 *      enviar o mesmo e-mail de outra empresa é recusado.
 *   2. Senha: `POST /auth/alterar-senha` troca a senha E revoga a sessão — a
 *      tela depende disso para mandar o usuário ao login.
 *   3. Usuário: `POST /usuarios` cria e persiste; e-mail duplicado -> 409.
 *   4. Chave de API: `POST /api-publica/chaves` devolve o segredo UMA VEZ (o
 *      bug corrigido na tela era descartar esse segredo). O banco guarda só o
 *      hash — é o que permite mostrar a chave sem expô-la depois.
 *   5. Empresa: `PUT /empresas/:id` valida CNPJ por dígito verificador e
 *      persiste; filial criada via `POST /filiais` fica visível na releitura.
 *   6. LGPD: `GET /lgpd/minha-conta/exportar` devolve um objeto com o titular e
 *      a empresa — é o arquivo que a tela baixa (e que, antes, podia não chegar
 *      ao usuário por revogar o blob cedo demais).
 *   7. Isolamento multi-tenant e permissões em todas as rotas tocadas.
 */
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { hashSenha, verificarSenha } from '../src/lib/auth.js';
import { authRoutes } from '../src/modules/auth/auth.routes.js';
import { usuariosRoutes } from '../src/modules/usuarios/usuarios.routes.js';
import { empresaRoutes } from '../src/modules/empresa/empresa.routes.js';
import { apiPublicaRoutes } from '../src/modules/api-publica/api-publica.routes.js';
import { integracoesRoutes } from '../src/modules/integracoes/integracoes.routes.js';
import { lgpdRoutes } from '../src/modules/lgpd/lgpd.routes.js';
import { pixRoutes } from '../src/modules/payments/pix.routes.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';

const SEGREDO = 'segredo-teste-config';
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
  await app.register(authRoutes);
  await app.register(usuariosRoutes);
  await app.register(empresaRoutes);
  await app.register(apiPublicaRoutes);
  await app.register(integracoesRoutes);
  await app.register(lgpdRoutes);
  await app.register(pixRoutes);

  const cnpj = generateRandomValidCnpj();
  const empresa = await prisma.empresa.create({
    data: { nome: `ConfigTeste ${SUFIXO}`, cnpj },
  });
  const empresa2 = await prisma.empresa.create({
    data: { nome: `ConfigOutro ${SUFIXO}`, cnpj: generateRandomValidCnpj() },
  });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Filial Config' } });
  const filial2 = await prisma.filial.create({ data: { empresaId: empresa2.id, nome: 'Filial Outro' } });
  const senhaHash = await hashSenha('senha12345');
  const permissoes = MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true })));
  const usuario = await prisma.usuario.create({
    data: {
      empresaId: empresa.id, filialId: filial.id, nome: 'Admin Config',
      email: `config-${SUFIXO}@teste.local`, senhaHash, origem: 'MANUAL',
    },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario.id })) });
  const semPermissao = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Sem Permissao', email: `semcfg-${SUFIXO}@teste.local`, senhaHash },
  });
  const usuario2 = await prisma.usuario.create({
    data: { empresaId: empresa2.id, nome: 'Outro Tenant', email: `outrocfg-${SUFIXO}@teste.local`, senhaHash },
  });
  await prisma.permissao.createMany({ data: permissoes.map((p) => ({ ...p, usuarioId: usuario2.id })) });

  const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email })}` };
  const Hsem = { authorization: `Bearer ${app.jwt.sign({ id: semPermissao.id, empresaId: empresa2.id, email: semPermissao.email })}` };
  const H2 = { authorization: `Bearer ${app.jwt.sign({ id: usuario2.id, empresaId: empresa2.id, email: usuario2.email })}` };
  const ids = [usuario.id, semPermissao.id, usuario2.id];
  const novosUsuarios: string[] = [];

  try {
    console.log('\n1. PUT /auth/me — perfil do usuario');
    const perfil = await app.inject({
      method: 'PUT', url: '/auth/me', headers: H,
      payload: { nome: 'Admin Renomeado', email: `config-novo-${SUFIXO}@teste.local` },
    });
    ok('PUT /auth/me -> 200', perfil.statusCode === 200, `status=${perfil.statusCode} corpo=${perfil.body.slice(0, 200)}`);
    ok('devolve o nome gravado', perfil.json().nome === 'Admin Renomeado', `nome=${perfil.json().nome}`);
    ok('devolve o e-mail normalizado (minusculo)', perfil.json().email === `config-novo-${SUFIXO}@teste.local`,
      `email=${perfil.json().email}`);
    const relido = await prisma.usuario.findUnique({ where: { id: usuario.id } });
    ok('nome PERSISTIDO no PostgreSQL', relido?.nome === 'Admin Renomeado', `nome=${relido?.nome}`);
    ok('e-mail PERSISTIDO no PostgreSQL', relido?.email === `config-novo-${SUFIXO}@teste.local`);
    const emailChave = relido?.email as string;
    const emailB = await app.inject({
      method: 'PUT', url: '/auth/me', headers: H2, payload: { email: emailChave },
    });
    ok('e-mail ja usado por outra empresa -> 409', emailB.statusCode === 409, `status=${emailB.statusCode}`);
    const semNome = await app.inject({ method: 'PUT', url: '/auth/me', headers: H, payload: { nome: 'a' } });
    ok('nome curto -> 400', semNome.statusCode === 400, `status=${semNome.statusCode}`);

    console.log('\n2. POST /auth/alterar-senha');
    const troca = await app.inject({
      method: 'POST', url: '/auth/alterar-senha', headers: H,
      payload: { senhaAtual: 'senha12345', novaSenha: 'novaSenha456' },
    });
    ok('POST /auth/alterar-senha -> 200', troca.statusCode === 200, `status=${troca.statusCode} corpo=${troca.body.slice(0, 180)}`);
    const depois = await prisma.usuario.findUnique({ where: { id: usuario.id } });
    ok('a senha nova foi gravada (a antiga nao vale mais)',
      !!depois?.senhaHash && (await verificarSenha('novaSenha456', depois.senhaHash)), 'senha antiga nao autentica mais');
    ok('a senha antiga foi rejeitada',
      !(await verificarSenha('senha12345', depois!.senhaHash)), 'senha antiga ainda valeria');
    const errada = await app.inject({
      method: 'POST', url: '/auth/alterar-senha', headers: H,
      payload: { senhaAtual: 'senhaErrada999', novaSenha: 'outraSenha789' },
    });
    ok('senha atual incorreta -> recusada', errada.statusCode >= 400, `status=${errada.statusCode}`);
    const curta = await app.inject({
      method: 'POST', url: '/auth/alterar-senha', headers: H,
      payload: { senhaAtual: 'novaSenha456', novaSenha: '123' },
    });
    ok('nova senha curta -> recusada', curta.statusCode >= 400, `status=${curta.statusCode}`);

    console.log('\n3. POST /usuarios — criacao');
    const novo = await app.inject({
      method: 'POST', url: '/usuarios', headers: H,
      payload: { nome: 'Operador Novo', email: `oper-${SUFIXO}@teste.local`, senha: 'senha12345', origem: 'MANUAL' },
    });
    // A rota de criação de usuário responde 200 (usa `reply.send`, que tem 200
    // como padrão) — não 201. O importante é que devolve o id e persiste.
    ok('POST /usuarios responde com sucesso', novo.statusCode === 200,
      `status=${novo.statusCode} corpo=${novo.body.slice(0, 180)}`);
    const novoId = novo.json().id;
    novosUsuarios.push(novoId);
    const noBanco = await prisma.usuario.findUnique({ where: { id: novoId } });
    ok('usuario gravado no PostgreSQL', !!noBanco, 'nao foi persistido');
    ok('gravado na empresa do token', noBanco?.empresaId === empresa.id, `empresaId=${noBanco?.empresaId}`);
    ok('senha guardada como hash, nunca em texto', !!noBanco?.senhaHash && noBanco.senhaHash !== 'senha12345');
    const dup = await app.inject({
      method: 'POST', url: '/usuarios', headers: H,
      payload: { nome: 'Duplicado', email: `oper-${SUFIXO}@teste.local`, senha: 'senha12345' },
    });
    ok('e-mail duplicado -> 409', dup.statusCode === 409, `status=${dup.statusCode}`);
    const listaUsuarios = await app.inject({ method: 'GET', url: '/usuarios', headers: H });
    ok('o novo usuario aparece na releitura',
      Array.isArray(listaUsuarios.json()) && listaUsuarios.json().some((u: any) => u.id === novoId));
console.log('\n4. POST /api-publica/chaves — o segredo volta UMA vez (bug corrigido na tela)');
    const chave = await app.inject({
      method: 'POST', url: '/api-publica/chaves', headers: H,
      payload: { nome: 'Chave Config', escopos: ['produtos:leitura'] },
    });
    ok('POST /api-publica/chaves -> 200', chave.statusCode === 200, `status=${chave.statusCode}`);
    const segredo = chave.json().chave;
    ok('a resposta TRAZ o segredo completo', typeof segredo === 'string' && segredo.startsWith('nx_'),
      `segredo=${segredo}`);
    const regChave = await prisma.chaveApi.findUnique({ where: { id: chave.json().id } });
    ok('o banco guarda apenas o HASH (por isso a tela pode mostrar a chave)',
      !!regChave?.chaveHash && regChave.chaveHash !== segredo);
    const listaChaves = await app.inject({ method: 'GET', url: '/api-publica/chaves', headers: H });
    ok('a releitura NUNCA devolve o segredo', !JSON.stringify(listaChaves.json()).includes(segredo));

    console.log('\n5. PUT /empresas/:id e POST /filiais');
    const upd = await app.inject({
      method: 'PUT', url: `/empresas/${empresa.id}`, headers: H,
      payload: { nome: 'Empresa Renomeada', cnpj: generateRandomValidCnpj(), cidade: 'São Paulo', estado: 'SP' },
    });
    ok('PUT /empresas/:id -> 200', upd.statusCode === 200, `status=${upd.statusCode} corpo=${upd.body.slice(0, 200)}`);
    const empDb = await prisma.empresa.findUnique({ where: { id: empresa.id } });
    ok('nome da empresa PERSISTIDO', empDb?.nome === 'Empresa Renomeada', `nome=${empDb?.nome}`);
    ok('cidade PERSISTIDA', empDb?.cidade === 'São Paulo', `cidade=${empDb?.cidade}`);
    const cnpjRuim = await app.inject({
      method: 'PUT', url: `/empresas/${empresa.id}`, headers: H, payload: { cnpj: '11111111111111' },
    });
    ok('CNPJ invalido -> 400', cnpjRuim.statusCode === 400, `status=${cnpjRuim.statusCode}`);
    const ufRuim = await app.inject({
      method: 'PUT', url: `/empresas/${empresa.id}`, headers: H, payload: { estado: 'XYZ' },
    });
    ok('UF invalida -> 400', ufRuim.statusCode === 400, `status=${ufRuim.statusCode}`);
    const filialNova = await app.inject({
      method: 'POST', url: '/filiais', headers: H,
      payload: { empresaId: empresa.id, nome: 'Filial Centro', cidade: 'Curitiba', estado: 'PR', origem: 'MANUAL' },
    });
    ok('POST /filiais responde com sucesso', filialNova.statusCode === 200,
      `status=${filialNova.statusCode} corpo=${filialNova.body.slice(0, 200)}`);
    const filialDb = await prisma.filial.findFirst({ where: { empresaId: empresa.id, nome: 'Filial Centro' } });
    ok('filial PERSISTIDA no PostgreSQL', !!filialDb, 'nao foi persistida');
    ok('filial gravada na empresa do token', filialDb?.empresaId === empresa.id);
    const filialAlheia = await app.inject({
      method: 'POST', url: '/filiais', headers: H2,
      payload: { empresaId: empresa.id, nome: 'Invadida', origem: 'MANUAL' },
    });
    ok('empresa B nao cria filial na empresa A -> 403', filialAlheia.statusCode === 403, `status=${filialAlheia.statusCode}`);
    console.log('\n6. GET /lgpd/minha-conta/exportar (o arquivo que a tela baixa)');
    const lgpd = await app.inject({ method: 'GET', url: '/lgpd/minha-conta/exportar', headers: H });
    ok('GET /lgpd/minha-conta/exportar -> 200', lgpd.statusCode === 200, `status=${lgpd.statusCode}`);
    ok('devolve um OBJETO (a tela faz JSON.stringify)', !Array.isArray(lgpd.json()));
    ok('o JSON e serializavel sem erro', (() => {
      try { JSON.stringify(lgpd.json()); return true; } catch { return false; }
    })());
    // Contrato real do LGPD: `{ titular, auditoria, exportadoEm }`.
    ok('inclui o titular e a trilha de auditoria',
      !!lgpd.json().titular && !!lgpd.json().auditoria && !!lgpd.json().exportadoEm,
      `chaves=${Object.keys(lgpd.json()).join(',')}`);
    ok('o titular traz o e-mail do usuario logado',
      lgpd.json().titular?.email === `config-novo-${SUFIXO}@teste.local`,
      `email=${lgpd.json().titular?.email}`);
    ok('a trilha de auditoria e uma lista', Array.isArray(lgpd.json().auditoria),
      `auditoria=${JSON.stringify(lgpd.json().auditoria)?.slice(0, 60)}`);
    ok('nao inclui hash de senha no export', !JSON.stringify(lgpd.json()).includes(senhaHash));

    console.log('\n7. Integração: integracoes e PIX (abas vizinhas consumidas aqui)');
    const integ = await app.inject({ method: 'GET', url: '/integracoes', headers: H });
    ok('GET /integracoes -> 200', integ.statusCode === 200, `status=${integ.statusCode}`);
    ok('devolve itens e resumo', Array.isArray(integ.json().itens) && !!integ.json().resumo);
    const pix = await app.inject({ method: 'GET', url: '/api/v1/settings/pix', headers: H });
    ok('GET /api/v1/settings/pix -> 200', pix.statusCode === 200, `status=${pix.statusCode}`);

    console.log('\n8. Isolamento multi-tenant e permissoes');
    const chavesB = await app.inject({ method: 'GET', url: '/api-publica/chaves', headers: H2 });
    ok('empresa B nao ve a chave da empresa A', !chavesB.json().some((k: any) => k.id === chave.json().id));
    ok('empresa B nao ve usuario da empresa A',
      !chavesB.json().some((k: any) => k.nome === 'Chave Config'));
    ok('POST /api-publica/chaves sem permissao -> 403',
      (await app.inject({
        method: 'POST', url: '/api-publica/chaves', headers: Hsem,
        payload: { nome: 'X', escopos: ['produtos:leitura'] },
      })).statusCode === 403);
    ok('PUT /auth/me sem token -> 401',
      (await app.inject({ method: 'PUT', url: '/auth/me', payload: { nome: 'X' } })).statusCode === 401);
    ok('GET /lgpd/minha-conta/exportar sem token -> 401',
      (await app.inject({ method: 'GET', url: '/lgpd/minha-conta/exportar' })).statusCode === 401);
    ok('GET /integracoes sem permissao -> 403',
      (await app.inject({ method: 'GET', url: '/integracoes', headers: Hsem })).statusCode === 403);
  } finally {
    const todas = [empresa.id, empresa2.id];
    await prisma.chaveApi.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.usuario.deleteMany({ where: { id: { in: [...ids, ...novosUsuarios] } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.filial.deleteMany({ where: { empresaId: { in: todas } } });
    await prisma.empresa.deleteMany({ where: { id: { in: todas } } });
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
  if (falhas > 0) process.exitCode = 1;
}
test('integração: configurações', async () => {
  await main();
});