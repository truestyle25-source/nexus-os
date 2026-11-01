/**
 * TESTE DE INTEGRAÇÃO — MIDDLEWARE DE PERMISSÕES (identidade sem claim `id`)
 * =========================================================================
 * Regressão do fail-open corrigido em src/middlewares/auth.ts: um JWT
 * assinado sem a claim `id` (ou com `id` vazio, em branco ou não-string)
 * deixava `request.user.id === undefined` e o Prisma IGNORA campos `undefined`
 * dentro de `where` — a consulta de permissões passava a valer para QUALQUER
 * usuário do banco e uma permissão de OUTRA pessoa autorizava a requisição
 * (confirmado empiricamente: a linha retornada pertencia a outro usuário).
 *
 * Estes testes provam, com o app real (jwt + authenticate + middlewares):
 *   1) identidade inválida → 401 e NENHUMA consulta a prisma.permissao.findFirst
 *      (contador de consultas via monkey-patch do delegate Prisma);
 *   2) fluxos legítimos preservados: dono da permissão, leitura/edição
 *      granulares, qualquer-das-permissões e administrador com todas as
 *      permissões;
 *   3) segurança: permissão de outro usuário ou de outra empresa NUNCA
 *      satisfaz a consulta, falha de banco NÃO concede acesso e as linhas de
 *      permissão permanecem intactas após toda a rodada.
 *
 * Roda contra o banco de desenvolvimento compartilhado (padrão dos testes de
 * integração do projeto); todos os dados criados são marcados com o sufixo da
 * rodada e removidos no final.
 */
import 'dotenv/config';
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { todasPermissoes } from '../src/lib/permissoes-catalogo.js';
import { registerAuthentication, permissaoMiddleware, permissaoQualquerDas } from '../src/middlewares/auth.js';

const SEGREDO = 'segredo-teste-permissao-middleware';
const SUFIXO = Date.now().toString(36);
// Módulos REAIS do catálogo (lib/permissoes-catalogo.ts): o administrador recebe
// todasPermissoes(), que só gera combinações módulo × ação do catálogo oficial.
const MODULO = 'integracoes';
const MODULO_ALT = 'estoque';
let falhas = 0;
let passou = 0;

function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

// ---------------------------------------------------------------------------
// Instrumentação: contamos cada consulta REAL a prisma.permissao.findFirst.
// Se o guard de identidade falhar, os cenários de identidade inválida mostram
// consultas > 0 (exatamente o vetor de fail-open que a correção elimina).
// ---------------------------------------------------------------------------
let consultasPermissao = 0;
const findFirstOriginal = prisma.permissao.findFirst.bind(prisma.permissao);
const findFirstContado = (...args: unknown[]) => {
  consultasPermissao++;
  return (findFirstOriginal as any)(...args);
};
(prisma.permissao as any).findFirst = findFirstContado;

/** Delta de consultas Prisma desde a chamada anterior (prova de "sem consulta"). */
function contadorDeConsultas() {
  const antes = consultasPermissao;
  return () => consultasPermissao - antes;
}

async function main() {
  const idsUsuarios: string[] = [];
  let empresaAId = '';
  let empresaBId = '';

  try {
    console.log('Setup: tenants e permissões de teste');
    const senhaHash = 'nao-usado-login-direto'; // tokens assinados direto, como os demais testes de integração
    const cnpj = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 14);
    const empresaA = await prisma.empresa.create({ data: { nome: `Corr2-A-${SUFIXO}`, cnpj: cnpj() } });
    const empresaB = await prisma.empresa.create({ data: { nome: `Corr2-B-${SUFIXO}`, cnpj: cnpj() } });
    empresaAId = empresaA.id;
    empresaBId = empresaB.id;

    const novoUsuario = (empresaId: string, nome: string) =>
      prisma.usuario.create({
        data: { empresaId, nome: `Corr2-${nome}-${SUFIXO}`, email: `corr2-${nome}-${SUFIXO}@teste.local`, senhaHash },
      });

    const dono = await novoUsuario(empresaA.id, 'dono');      // detém MODULO:visualizar + MODULO:editar
    const semPerm = await novoUsuario(empresaA.id, 'semperm'); // nenhuma permissão
    const outro = await novoUsuario(empresaA.id, 'outro');     // nenhuma permissão (não herda a do dono)
    const admin = await novoUsuario(empresaA.id, 'admin');     // todas as permissões do catálogo
    const altUser = await novoUsuario(empresaA.id, 'alt');     // só MODULO_ALT:visualizar
    const empB = await novoUsuario(empresaB.id, 'empb');       // outra empresa, nenhuma permissão
    idsUsuarios.push(dono.id, semPerm.id, outro.id, admin.id, altUser.id, empB.id);

    await prisma.permissao.createMany({
      data: [
        { usuarioId: dono.id, modulo: MODULO, acao: 'visualizar', permitido: true },
        { usuarioId: dono.id, modulo: MODULO, acao: 'editar', permitido: true },
        { usuarioId: altUser.id, modulo: MODULO_ALT, acao: 'visualizar', permitido: true },
        ...todasPermissoes().map((p) => ({ usuarioId: admin.id, modulo: p.modulo, acao: p.acao, permitido: true })),
      ],
    });

    const app = Fastify();
    await app.register(jwt, { secret: SEGREDO });
    await app.register(registerAuthentication);
    app.get('/protegido/leitura', { preHandler: [app.authenticate, permissaoMiddleware(MODULO, 'visualizar')] },
      async () => ({ ok: true, rota: 'leitura' }));
    app.put('/protegido/edicao', { preHandler: [app.authenticate, permissaoMiddleware(MODULO, 'editar')] },
      async () => ({ ok: true, rota: 'edicao' }));
    app.get('/protegido/qualquer', { preHandler: [app.authenticate, permissaoQualquerDas([
      { modulo: MODULO, acao: 'visualizar' },
      { modulo: MODULO_ALT, acao: 'visualizar' },
    ])] }, async () => ({ ok: true, rota: 'qualquer' }));
    await app.ready();

    // Payloads propositalmente malformados. `as any` aqui é o ÚNICO ponto onde
    // contornamos o tipo de payload: o tipo exige `id: string` e justamente
    // por isso o fail-open existia em runtime — um token que burla essa
    // assinatura de tipos. Nenhum cast assim existe no código de produção.
    const tokenMalformado = (payload: Record<string, unknown>) => app.jwt.sign(payload as any);
    const tokenDe = (usuario: { id: string; email: string }, empresaId: string) =>
      app.jwt.sign({ id: usuario.id, empresaId, email: usuario.email });
    const Bearer = (token: string) => ({ authorization: `Bearer ${token}` });

    // -------------------------------------------------------------------------
    console.log('\n1. Identidade inválida -> 401 ANTES de qualquer consulta Prisma');
    // -------------------------------------------------------------------------
    const semToken = await app.inject({ method: 'GET', url: '/protegido/leitura' });
    ok('sem cabeçalho Authorization -> 401', semToken.statusCode === 401, `status=${semToken.statusCode}`);

    let medir = contadorDeConsultas();
    const semId = await app.inject({ method: 'GET', url: '/protegido/leitura', headers: Bearer(tokenMalformado({ empresaId: empresaAId, email: 'x@y.z' })) });
    ok('JWT sem claim id -> 401', semId.statusCode === 401, `status=${semId.statusCode}`);
    ok('JWT sem claim id -> 0 consultas de permissão no Prisma', medir() === 0, `consultas=${medir()}`);

    medir = contadorDeConsultas();
    const idVazio = await app.inject({ method: 'GET', url: '/protegido/leitura', headers: Bearer(tokenMalformado({ id: '', empresaId: empresaAId, email: 'x@y.z' })) });
    ok('JWT com id vazio -> 401', idVazio.statusCode === 401, `status=${idVazio.statusCode}`);
    ok('JWT com id vazio -> 0 consultas de permissão no Prisma', medir() === 0, `consultas=${medir()}`);

    medir = contadorDeConsultas();
    const idEspacos = await app.inject({ method: 'GET', url: '/protegido/leitura', headers: Bearer(tokenMalformado({ id: '   ', empresaId: empresaAId, email: 'x@y.z' })) });
    ok('JWT com id em branco -> 401', idEspacos.statusCode === 401, `status=${idEspacos.statusCode}`);
    ok('JWT com id em branco -> 0 consultas de permissão no Prisma', medir() === 0, `consultas=${medir()}`);

    medir = contadorDeConsultas();
    const idNumero = await app.inject({ method: 'GET', url: '/protegido/leitura', headers: Bearer(tokenMalformado({ id: 12345, empresaId: empresaAId, email: 'x@y.z' })) });
    ok('JWT com id de tipo inválido (number) -> 401', idNumero.statusCode === 401, `status=${idNumero.statusCode}`);
    ok('JWT com id de tipo inválido -> 0 consultas de permissão no Prisma', medir() === 0, `consultas=${medir()}`);

    medir = contadorDeConsultas();
    const idNulo = await app.inject({ method: 'GET', url: '/protegido/leitura', headers: Bearer(tokenMalformado({ id: null, empresaId: empresaAId, email: 'x@y.z' })) });
    ok('JWT com id null -> 401', idNulo.statusCode === 401, `status=${idNulo.statusCode}`);
    ok('JWT com id null -> 0 consultas de permissão no Prisma', medir() === 0, `consultas=${medir()}`);

    medir = contadorDeConsultas();
    const semIdQualquer = await app.inject({ method: 'GET', url: '/protegido/qualquer', headers: Bearer(tokenMalformado({ empresaId: empresaAId, email: 'x@y.z' })) });
    ok('permissaoQualquerDas sem claim id -> 401', semIdQualquer.statusCode === 401, `status=${semIdQualquer.statusCode}`);
    ok('permissaoQualquerDas sem claim id -> 0 consultas de permissão no Prisma', medir() === 0, `consultas=${medir()}`);

    medir = contadorDeConsultas();
    const semIdEdicao = await app.inject({ method: 'PUT', url: '/protegido/edicao', headers: Bearer(tokenMalformado({ empresaId: empresaAId, email: 'x@y.z' })) });
    ok('rota de edição sem claim id -> 401', semIdEdicao.statusCode === 401, `status=${semIdEdicao.statusCode}`);
    ok('rota de edição sem claim id -> 0 consultas de permissão no Prisma', medir() === 0, `consultas=${medir()}`);

    // -------------------------------------------------------------------------
    console.log('\n2. Usuários legítimos: permissões granulares preservadas');
    // -------------------------------------------------------------------------
    const donoLeitura = await app.inject({ method: 'GET', url: '/protegido/leitura', headers: Bearer(tokenDe(dono, empresaAId)) });
    ok('dono da permissão: leitura com visualizar -> 200', donoLeitura.statusCode === 200, `status=${donoLeitura.statusCode}`);

    medir = contadorDeConsultas();
    const donoEdicao = await app.inject({ method: 'PUT', url: '/protegido/edicao', headers: Bearer(tokenDe(dono, empresaAId)) });
    ok('dono da permissão: edição com editar -> 200', donoEdicao.statusCode === 200, `status=${donoEdicao.statusCode}`);
    ok('fluxo legítimo consultou o banco ao menos uma vez', medir() > 0, `consultas=${medir()}`);

    const semPermLeitura = await app.inject({ method: 'GET', url: '/protegido/leitura', headers: Bearer(tokenDe(semPerm, empresaAId)) });
    ok('autenticado SEM permissão: leitura -> 403', semPermLeitura.statusCode === 403, `status=${semPermLeitura.statusCode}`);

    const semPermEdicao = await app.inject({ method: 'PUT', url: '/protegido/edicao', headers: Bearer(tokenDe(semPerm, empresaAId)) });
    ok('autenticado SEM permissão: edição -> 403', semPermEdicao.statusCode === 403, `status=${semPermEdicao.statusCode}`);

    const outroLeitura = await app.inject({ method: 'GET', url: '/protegido/leitura', headers: Bearer(tokenDe(outro, empresaAId)) });
    ok('permissão pertencente a OUTRO usuário não autoriza (mesma empresa) -> 403', outroLeitura.statusCode === 403, `status=${outroLeitura.statusCode}`);

    const outroEdicao = await app.inject({ method: 'PUT', url: '/protegido/edicao', headers: Bearer(tokenDe(outro, empresaAId)) });
    ok('permissão de outro usuário também não autoriza edição -> 403', outroEdicao.statusCode === 403, `status=${outroEdicao.statusCode}`);

    const empBLeitura = await app.inject({ method: 'GET', url: '/protegido/leitura', headers: Bearer(tokenDe(empB, empresaBId)) });
    ok('usuário de OUTRA empresa (mesmo módulo no banco) -> 403', empBLeitura.statusCode === 403, `status=${empBLeitura.statusCode}`);

    const adminLeitura = await app.inject({ method: 'GET', url: '/protegido/leitura', headers: Bearer(tokenDe(admin, empresaAId)) });
    ok('administrador (todas as permissões do catálogo) -> 200', adminLeitura.statusCode === 200, `status=${adminLeitura.statusCode}`);

    const adminEdicao = await app.inject({ method: 'PUT', url: '/protegido/edicao', headers: Bearer(tokenDe(admin, empresaAId)) });
    ok('administrador: edição -> 200', adminEdicao.statusCode === 200, `status=${adminEdicao.statusCode}`);

    // -------------------------------------------------------------------------
    console.log('\n3. permissaoQualquerDas: alternativa legítima preservada');
    // -------------------------------------------------------------------------
    const altQualquer = await app.inject({ method: 'GET', url: '/protegido/qualquer', headers: Bearer(tokenDe(altUser, empresaAId)) });
    ok('usuário com a permissão ALTERNATIVA -> 200 (qualquerDas)', altQualquer.statusCode === 200, `status=${altQualquer.statusCode}`);

    const donoQualquer = await app.inject({ method: 'GET', url: '/protegido/qualquer', headers: Bearer(tokenDe(dono, empresaAId)) });
    ok('usuário com a permissão PRIMEIRA opção -> 200 (qualquerDas)', donoQualquer.statusCode === 200, `status=${donoQualquer.statusCode}`);

    const semQualquer = await app.inject({ method: 'GET', url: '/protegido/qualquer', headers: Bearer(tokenDe(semPerm, empresaAId)) });
    ok('usuário sem NENHUMA das permissões -> 403 (qualquerDas)', semQualquer.statusCode === 403, `status=${semQualquer.statusCode}`);

    // -------------------------------------------------------------------------
    console.log('\n4. Segurança');
    // -------------------------------------------------------------------------
    (prisma.permissao as any).findFirst = async () => { throw new Error('falha simulada de banco (teste corr2)'); };
    const dbErro = await app.inject({ method: 'GET', url: '/protegido/leitura', headers: Bearer(tokenDe(dono, empresaAId)) });
    ok('falha na consulta ao banco -> 500 (nunca concede acesso)', dbErro.statusCode === 500, `status=${dbErro.statusCode}`);
    (prisma.permissao as any).findFirst = findFirstContado;

    const permissoesDono = await prisma.permissao.findMany({ where: { usuarioId: dono.id } });
    ok('permissões legítimas intactas após toda a rodada (dono segue com exatamente 2)',
      permissoesDono.length === 2 && permissoesDono.every((p) => p.permitido === true),
      `total=${permissoesDono.length}`);

    const ultimaChecagem = await app.inject({ method: 'GET', url: '/protegido/leitura', headers: Bearer(tokenDe(dono, empresaAId)) });
    ok('fluxo legítimo continua autorizado ao final (nada foi enfraquecido)', ultimaChecagem.statusCode === 200, `status=${ultimaChecagem.statusCode}`);

    await app.close();
  } catch (err) {
    console.error('ERRO NO TESTE:', err);
    process.exitCode = 1;
  } finally {
    if (idsUsuarios.length > 0) await prisma.permissao.deleteMany({ where: { usuarioId: { in: idsUsuarios } } }).catch(() => {});
    if (idsUsuarios.length > 0) await prisma.usuario.deleteMany({ where: { id: { in: idsUsuarios } } }).catch(() => {});
    if (empresaAId) await prisma.empresa.deleteMany({ where: { id: empresaAId } }).catch((e) => console.log('  limpeza empresa A pendente:', String(e?.message ?? e).slice(0, 80)));
    if (empresaBId) await prisma.empresa.deleteMany({ where: { id: empresaBId } }).catch((e) => console.log('  limpeza empresa B pendente:', String(e?.message ?? e).slice(0, 80)));
    (prisma.permissao as any).findFirst = findFirstOriginal;
    console.log(`\nRESULTADO: ${passou} ok, ${falhas} falha(s)`);
    if (falhas > 0) process.exitCode = 1;
  }
}

test('middleware de permissões: identidade sem claim id é rejeitada antes do Prisma (fail-open eliminado)', async () => {
  await main();
});
