/**
 * NEXUS CLUB — travas entre o cliente e o sistema da empresa (critério da Fase 4 do plano):
 * percorre TODAS as rotas do servidor real (server.ts) e confere que
 *  - o crachá de CLIENTE não abre nada da empresa: em cada rota fora de /club a resposta é
 *    igual à de quem não está logado;
 *  - um crachá "de cliente" forjado com o segredo da EMPRESA também não abre nada;
 *  - o crachá de FUNCIONÁRIO não abre nada do clube: nas rotas /club a resposta é igual à de
 *    quem não está logado.
 * "Igual a anônimo" pega rota pública e protegida do mesmo jeito: o crachá não dá acesso extra.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);

/** printRoutes({ commonPrefix: false }) devolve uma árvore: remonta o caminho completo de cada rota. */
function rotasDaArvore(arvore: string): Array<{ metodo: string; url: string }> {
  const pilha: string[] = [];
  const rotas: Array<{ metodo: string; url: string }> = [];
  for (const linha of arvore.split('\n')) {
    const i = linha.indexOf('── ');
    if (i < 0) continue;
    const nivel = Math.round(i / 4);
    const resto = linha.slice(i + 3);
    const m = resto.match(/^(.*?)(?: \(([A-Z, ]+)\))?$/);
    if (!m) continue;
    pilha.length = nivel;
    pilha[nivel] = m[1];
    if (!m[2]) continue;
    const url = pilha.join('');
    for (const metodo of m[2].split(',').map((x) => x.trim()).filter((x) => x && x !== 'HEAD' && x !== 'OPTIONS')) rotas.push({ metodo, url });
  }
  return rotas;
}

test('travas: crachá de cliente não abre a empresa; crachá de funcionário não abre o clube', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async () => {
  const antes = Object.fromEntries(['JWT_SECRET', 'NEXUS_CLUB_HABILITADO', 'NEXUS_CLUB_JWT_SECRET', 'NEXUS_CLUB_CPF_CHAVE'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { JWT_SECRET: randomBytes(24).toString('hex'), NEXUS_CLUB_HABILITADO: 'true', NEXUS_CLUB_JWT_SECRET: randomBytes(24).toString('hex'), NEXUS_CLUB_CPF_CHAVE: randomBytes(24).toString('hex') });
  const { app } = await import('../src/server.js');
  const { prisma } = await import('../src/lib/prisma.js');
  const { emitirCrachaConsumidor } = await import('../src/modules/clube/token-consumidor.js');
  const { generateRandomValidCnpj } = await import('../src/domain/cnpj.js');
  await app.ready();
  try {
    const rotas = rotasDaArvore(app.printRoutes({ commonPrefix: false }));
    assert.ok(rotas.length > 200, `rotas encontradas: ${rotas.length}`);

    // Uma pessoa real (conta ATIVA) e um funcionário real, para os crachás serem "bons" do lado deles.
    const conta = await prisma.contaConsumidor.create({ data: { nome: 'Trava', email: `trava-${randomBytes(4).toString('hex')}@teste.local`, cpfHash: randomBytes(8).toString('hex'), cpfCifrado: 'x', senhaHash: 'x', status: 'ATIVA' } });
    const empresa = await prisma.empresa.create({ data: { nome: `Trava ${randomBytes(3).toString('hex')}`, cnpj: generateRandomValidCnpj() } });
    const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
    const func = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: filial.id, nome: 'Func', email: `func-trava-${randomBytes(4).toString('hex')}@teste.local`, senhaHash: 'x' } });
    const crachaCliente = emitirCrachaConsumidor(conta.id).token;
    const crachaFuncionario = app.jwt.sign({ id: func.id, empresaId: empresa.id, email: func.email, jti: `t-${func.id}`, emitidoEmMs: Date.now() } as any);
    const forjado = app.jwt.sign({ id: func.id, empresaId: empresa.id, sub: conta.id, tipo: 'CONSUMIDOR', aud: 'nexus-club', jti: `f-${func.id}`, emitidoEmMs: Date.now() } as any);

    let n = 0;
    const status = async (metodo: string, url: string, token?: string) => {
      const r = await app.inject({
        method: metodo as any, url: url.replace(/:[^/]+/g, 'x').replace(/\*/g, 'x'),
        // IP diferente a cada chamada: o limite de tentativas não pode mascarar a comparação.
        remoteAddress: `10.9.${Math.floor(++n / 250) % 250}.${n % 250}`,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(metodo === 'GET' ? {} : { 'content-type': 'application/json' }) },
        payload: metodo === 'GET' ? undefined : '{}',
      });
      return r.statusCode;
    };

    const divergencias: string[] = [];
    for (const { metodo, url } of rotas) {
      const anonimo = await status(metodo, url);
      if (url.startsWith('/club')) {
        const func2 = await status(metodo, url, crachaFuncionario);
        if (func2 !== anonimo) divergencias.push(`FUNCIONÁRIO em ${metodo} ${url}: ${func2} (anônimo ${anonimo})`);
      } else {
        const cli = await status(metodo, url, crachaCliente);
        const forj = await status(metodo, url, forjado);
        if (cli !== anonimo) divergencias.push(`CLIENTE em ${metodo} ${url}: ${cli} (anônimo ${anonimo})`);
        if (forj !== anonimo) divergencias.push(`FORJADO em ${metodo} ${url}: ${forj} (anônimo ${anonimo})`);
        if (cli >= 200 && cli < 300 && anonimo >= 400) divergencias.push(`ACESSO INDEVIDO ${metodo} ${url}`);
      }
    }
    // Controle: o crachá do cliente FUNCIONA no clube (o teste não passa por estar tudo quebrado).
    assert.equal(await status('GET', '/club/eu', crachaCliente), 200, 'controle: cliente entra no /club/eu');
    assert.equal(await status('GET', '/auth/me', crachaFuncionario), 200, 'controle: funcionário entra no /auth/me');
    assert.deepEqual(divergencias, [], divergencias.join('\n'));
  } finally {
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await app.close();
  }
});
