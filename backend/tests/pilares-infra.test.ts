/**
 * TESTE DE INTEGRAÇÃO — melhorias de infraestrutura (2026-11-21)
 *
 *  1. Cabeçalhos de segurança e X-Request-Id em toda resposta da API.
 *  2. /health (vivo) e /health/ready (banco), sem expor detalhes internos.
 *  3. Telemetria de erro do frontend: valida o corpo e tem limite.
 *  4. Rate limit DISTRIBUÍDO: contador atômico no banco (50 incrementos simultâneos = 50),
 *     compartilhado entre "instâncias" (dois limiters independentes somam o mesmo contador)
 *     e chave por usuário / chave de API.
 *  5. Troca de senha encerra TODAS as sessões do usuário, não só a atual.
 *  6. Trava das tarefas diárias: com 10 instâncias disputando, exatamente 1 executa.
 *  7. Restauração de backup: recusa o banco de produção e hosts do Supabase.
 *  8. IP do cliente: cabeçalho confiável configurável e trustProxy por número de saltos.
 *
 * Exige o banco de teste local (localhost:5432/nexus_os_test) com as migrações aplicadas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { prisma } from '../src/lib/prisma.js';
import { comoSistema } from '../src/lib/tenant-context.js';
import { createRateLimiter, incrementarJanela } from '../src/middlewares/rateLimiter.js';
import { reivindicarExecucaoDiaria, concluirExecucao, executarUmaVezPorDia, tarefasAtrasadas } from '../src/lib/tarefa-agendada.js';
import { destinoEhProducao, identidadeDoBanco } from '../src/scripts/restaurar-backup.js';
import { ipDoCliente, configuracaoTrustProxy } from '../src/lib/client-ip.js';
import { hashSenha } from '../src/lib/auth.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUFIXO = Date.now().toString(36);

test('pilares de infraestrutura', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  process.env.JWT_SECRET ||= 'x'.repeat(48);
  const { app } = await import('../src/server.js');
  await app.ready();

  await t.test('1. cabeçalhos de segurança e X-Request-Id', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.match(String(r.headers['permissions-policy']), /camera=\(\)/);
    assert.match(String(r.headers['content-security-policy']), /default-src 'none'; frame-ancestors 'none'/);
    assert.match(String(r.headers['x-request-id']), /^[0-9a-f-]{36}$/);
    const proprio = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'teste-req-12345' } });
    assert.equal(proprio.headers['x-request-id'], 'teste-req-12345', 'reaproveita o id recebido');
    const malicioso = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'x\r\nSet-Cookie: a=b' } });
    assert.notEqual(malicioso.headers['x-request-id'], 'x\r\nSet-Cookie: a=b', 'id com formato inseguro é trocado');
    const semToken = await app.inject({ method: 'GET', url: '/produtos' });
    assert.equal(semToken.statusCode, 401, 'rota privada continua exigindo login');
    assert.equal(semToken.headers['x-frame-options'], 'DENY', 'cabeçalhos também nas respostas de erro');
  });

  await t.test('2. /health/ready confere o banco e não expõe detalhes', async () => {
    const r = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(r.statusCode, 200, r.body);
    const corpo = r.json();
    assert.equal(corpo.banco, 'ok');
    assert.equal(typeof corpo.latenciaBancoMs, 'number');
    assert.ok(Array.isArray(corpo.tarefasAtrasadas));
    assert.ok(!/postgres|localhost|password|senha/i.test(r.body), 'sem host, usuário ou senha na resposta');
  });

  await t.test('3. telemetria de erro do frontend', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const valido = await app.inject({ method: 'POST', url: '/telemetria/erro-frontend', remoteAddress: ip, payload: { mensagem: 'TypeError: x is undefined', pagina: '/financeiro', digest: 'abc' } });
    assert.equal(valido.statusCode, 204);
    const invalido = await app.inject({ method: 'POST', url: '/telemetria/erro-frontend', remoteAddress: ip, payload: { mensagem: '' } });
    assert.equal(invalido.statusCode, 400);
    let ultimo = 0;
    for (let i = 0; i < 31; i++) {
      ultimo = (await app.inject({ method: 'POST', url: '/telemetria/erro-frontend', remoteAddress: ip, payload: { mensagem: `erro ${i}` } })).statusCode;
    }
    assert.equal(ultimo, 429, 'limite de 30 por minuto por IP');
  });

  await t.test('4a. contador atômico: 50 incrementos simultâneos = 50', async () => {
    const chave = `teste-atomico-${SUFIXO}`;
    const resultados = await Promise.all(Array.from({ length: 50 }, () => incrementarJanela(chave, 60_000)));
    const valores = resultados.map((r) => r.contador).sort((a, b) => a - b);
    assert.deepEqual(valores, Array.from({ length: 50 }, (_, i) => i + 1), 'cada incremento recebe um valor único, sem perda');
  });

  await t.test('4b. limite compartilhado entre instâncias e por usuário', async () => {
    // Duas "instâncias" = dois limiters independentes com o mesmo nome (antes, cada processo tinha o seu Map).
    const nome = `teste-instancias-${SUFIXO}`;
    const instanciaA = Fastify({ logger: false });
    const instanciaB = Fastify({ logger: false });
    for (const inst of [instanciaA, instanciaB]) {
      inst.get('/x', { preHandler: createRateLimiter(5, 60_000, { nome }) }, async () => ({ ok: true }));
      inst.get('/u', {
        preHandler: [async (req) => { (req as any).user = { id: String(req.headers['x-usuario']) }; }, createRateLimiter(2, 60_000, { nome: `${nome}-u` })],
      }, async () => ({ ok: true }));
    }
    const status: number[] = [];
    for (let i = 0; i < 6; i++) status.push((await (i % 2 ? instanciaB : instanciaA).inject({ method: 'GET', url: '/x', remoteAddress: '198.51.100.90' })).statusCode);
    assert.deepEqual(status, [200, 200, 200, 200, 200, 429], 'a 6ª requisição é barrada mesmo alternando instâncias');
    const r429 = await instanciaA.inject({ method: 'GET', url: '/x', remoteAddress: '198.51.100.90' });
    assert.ok(Number(r429.headers['retry-after']) >= 1, 'Retry-After presente');
    assert.equal(r429.headers['x-ratelimit-remaining'], '0');
    const outroIp = await instanciaB.inject({ method: 'GET', url: '/x', remoteAddress: '198.51.100.91' });
    assert.equal(outroIp.statusCode, 200, 'outro IP tem contador próprio');
    // Por usuário: o mesmo usuário em IPs diferentes divide o limite.
    const u1 = await instanciaA.inject({ method: 'GET', url: '/u', remoteAddress: '10.0.0.1', headers: { 'x-usuario': `usr-${SUFIXO}` } });
    const u2 = await instanciaB.inject({ method: 'GET', url: '/u', remoteAddress: '10.0.0.2', headers: { 'x-usuario': `usr-${SUFIXO}` } });
    const u3 = await instanciaA.inject({ method: 'GET', url: '/u', remoteAddress: '10.0.0.3', headers: { 'x-usuario': `usr-${SUFIXO}` } });
    assert.deepEqual([u1.statusCode, u2.statusCode, u3.statusCode], [200, 200, 429], 'trocar de IP não burla o limite do usuário');
    await instanciaA.close();
    await instanciaB.close();
  });

  await t.test('5. troca de senha encerra TODAS as sessões', async () => {
    const empresa = await comoSistema('teste', () => prisma.empresa.create({ data: { nome: `Pilares ${SUFIXO}`, cnpj: generateRandomValidCnpj().replace(/\D/g, '') } }));
    const email = `pilares-${SUFIXO}@teste.local`;
    const senhaInicial = 'senhaInicial123';
    const senhaHash = await hashSenha(senhaInicial);
    const usuario = await comoSistema('teste', () => prisma.usuario.create({ data: { empresaId: empresa.id, nome: 'Pilares', email, senhaHash } }));
    try {
      // Duas sessões abertas (ex.: a do dono e a de quem usou a senha vazada), emitidas 2 s no passado.
      const iat = Math.floor(Date.now() / 1000) - 2;
      const sessaoA = app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email, jti: `a-${SUFIXO}`, iat } as any, { expiresIn: '8h' });
      const sessaoB = app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email, jti: `b-${SUFIXO}`, iat } as any, { expiresIn: '8h' });
      const antes = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${sessaoB}` } });
      assert.equal(antes.statusCode, 200, `sessão B válida antes da troca: ${antes.body.slice(0, 120)}`);
      const troca = await app.inject({
        method: 'POST', url: '/auth/alterar-senha', remoteAddress: '198.51.100.55', headers: { authorization: `Bearer ${sessaoA}` },
        payload: { senhaAtual: senhaInicial, novaSenha: 'senhaNova4567' },
      });
      assert.equal(troca.statusCode, 200, troca.body);
      const depoisA = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${sessaoA}` } });
      const depoisB = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${sessaoB}` } });
      assert.equal(depoisA.statusCode, 401, 'a sessão que trocou a senha foi encerrada');
      assert.equal(depoisB.statusCode, 401, 'a OUTRA sessão também foi encerrada (antes continuava valendo por até 8 h)');
      const login = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '198.51.100.56', payload: { email, senha: 'senhaNova4567' } });
      assert.equal(login.statusCode, 200, `login com a senha nova funciona logo em seguida: ${login.body.slice(0, 120)}`);
      const nova = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${login.json().token}` } });
      assert.equal(nova.statusCode, 200, 'a sessão nova vale');
    } finally {
      await comoSistema('teste', async () => {
        await prisma.auditoria.deleteMany({ where: { usuarioId: usuario.id } });
        await prisma.permissao.deleteMany({ where: { usuarioId: usuario.id } });
        await prisma.usuario.delete({ where: { id: usuario.id } });
        await prisma.empresa.delete({ where: { id: empresa.id } });
      });
    }
  });

  await t.test('6. trava diária: 10 instâncias disputando, só 1 executa', async () => {
    const nome = `teste-tarefa-${SUFIXO}`;
    const disputas = await Promise.all(Array.from({ length: 10 }, () => reivindicarExecucaoDiaria(nome)));
    assert.equal(disputas.filter(Boolean).length, 1, 'exatamente uma reivindicação vence');
    assert.equal(await reivindicarExecucaoDiaria(nome), false, 'com a trava ativa, ninguém mais entra');
    await concluirExecucao(nome, { sucesso: false, erro: 'falha simulada' });
    assert.equal(await reivindicarExecucaoDiaria(nome), true, 'depois de uma FALHA, a tarefa pode ser retomada no mesmo dia');
    await concluirExecucao(nome, { sucesso: true });
    assert.equal(await reivindicarExecucaoDiaria(nome), false, 'depois do SUCESSO, não roda de novo no mesmo dia');
    let execucoes = 0;
    const nome2 = `teste-tarefa2-${SUFIXO}`;
    await Promise.all(Array.from({ length: 5 }, () => executarUmaVezPorDia(nome2, async () => { execucoes++; })));
    assert.equal(execucoes, 1, 'executarUmaVezPorDia roda o trabalho uma única vez');
    // Atraso: sucesso há 30 h aparece como atrasada.
    await comoSistema('teste', () => prisma.tarefaAgendada.update({ where: { nome: nome2 }, data: { ultimoSucessoEm: new Date(Date.now() - 30 * 3600_000) } }));
    assert.deepEqual(await tarefasAtrasadas([nome2]), [nome2]);
    await comoSistema('teste', () => prisma.tarefaAgendada.deleteMany({ where: { nome: { in: [nome, nome2] } } }));
  });

  await t.test('7. restauração recusa produção', () => {
    const env = { DATABASE_URL: 'postgresql://app:x@db.exemplo.com:5432/nexus', DIRECT_URL: 'postgresql://mig:y@db.exemplo.com:5432/nexus' } as NodeJS.ProcessEnv;
    assert.equal(destinoEhProducao('postgresql://outro:z@db.exemplo.com:5432/nexus', env).producao, true, 'mesmo host/banco, outro usuário');
    assert.equal(destinoEhProducao('postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres', {}).producao, true, 'host do Supabase');
    assert.equal(destinoEhProducao('postgresql://u:p@localhost:5433/restore_teste', env).producao, false, 'banco isolado é aceito');
    assert.equal(destinoEhProducao('isto-nao-e-url', env).producao, true, 'URL inválida é recusada');
    assert.equal(identidadeDoBanco('postgresql://a:b@HOST.com/banco?sslmode=require'), 'host.com:5432/banco');
  });

  await t.test('8. IP do cliente e trustProxy', () => {
    const req = (headers: Record<string, string>, ip = '10.0.0.9') => ({ headers, ip }) as any;
    delete process.env.CLIENT_IP_HEADER;
    assert.equal(ipDoCliente(req({ 'cf-connecting-ip': '1.2.3.4' })), '10.0.0.9', 'sem configuração, usa req.ip');
    process.env.CLIENT_IP_HEADER = 'cf-connecting-ip';
    assert.equal(ipDoCliente(req({ 'cf-connecting-ip': '1.2.3.4' })), '1.2.3.4', 'com configuração, usa o cabeçalho do proxy');
    assert.equal(ipDoCliente(req({ 'cf-connecting-ip': '<script>' })), '10.0.0.9', 'valor inválido é ignorado');
    delete process.env.CLIENT_IP_HEADER;
    assert.equal(configuracaoTrustProxy(undefined), true);
    const fn = configuracaoTrustProxy('2') as (a: string, h: number) => boolean;
    assert.deepEqual([fn('x', 0), fn('x', 1), fn('x', 2)], [true, true, false], 'confia só nos 2 saltos mais próximos');
    // Prova com Fastify real: com 1 salto confiável, X-Forwarded-For forjado pelo cliente não vira o IP.
  });

  await t.test('8b. X-Forwarded-For forjado não vira o IP com TRUST_PROXY_HOPS=1', async () => {
    const inst = Fastify({ logger: false, trustProxy: configuracaoTrustProxy('1') as any });
    inst.get('/ip', async (req) => ({ ip: req.ip }));
    // Cliente forja "6.6.6.6"; o proxy confiável (127.0.0.1) acrescenta o IP real 203.0.113.7.
    const r = await inst.inject({ method: 'GET', url: '/ip', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' } });
    assert.equal(r.json().ip, '203.0.113.7', 'vale o IP que o proxy viu, não o forjado');
    const comTrue = Fastify({ logger: false, trustProxy: true });
    comTrue.get('/ip', async (req) => ({ ip: req.ip }));
    const r2 = await comTrue.inject({ method: 'GET', url: '/ip', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' } });
    assert.equal(r2.json().ip, '6.6.6.6', 'com trustProxy: true (padrão antigo) o IP forjado é aceito — por isso a variável existe');
    await inst.close();
    await comTrue.close();
  });

  await t.test('9. cancelar venda recalcula o histórico do cliente por agregação no banco', async () => {
    const { MODULOS, ACOES } = await import('../src/lib/permissoes-catalogo.js');
    const empresa = await comoSistema('teste', () => prisma.empresa.create({ data: { nome: `Agreg ${SUFIXO}`, cnpj: generateRandomValidCnpj().replace(/\D/g, '') } }));
    const filial = await comoSistema('teste', () => prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } }));
    const usuario = await comoSistema('teste', async () => prisma.usuario.create({ data: { empresaId: empresa.id, filialId: filial.id, nome: 'Agreg', email: `agreg-${SUFIXO}@teste.local`, senhaHash: await hashSenha('x12345678') } }));
    await comoSistema('teste', () => prisma.permissao.createMany({ data: MODULOS.flatMap((m: string) => ACOES.map((a: string) => ({ usuarioId: usuario.id, modulo: m, acao: a, permitido: true }))) }));
    const H = { authorization: `Bearer ${app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email, jti: `ag-${SUFIXO}`, emitidoEmMs: Date.now() } as any)}` };
    const cliente = await comoSistema('teste', () => prisma.cliente.create({ data: { empresaId: empresa.id, nome: 'Cliente Agreg' } as any }));
    const prod = await app.inject({ method: 'POST', url: '/produtos', headers: H, payload: { nome: `Prod Agreg ${SUFIXO}`, sku: `AG${SUFIXO}`, precoVenda: 10, custo: 4, unidade: 'UN' } });
    assert.ok([200, 201].includes(prod.statusCode), prod.body.slice(0, 200));
    const produtoId = prod.json().id;
    await app.inject({ method: 'POST', url: '/estoque/movimentar', headers: H, payload: { produtoId, filialId: filial.id, tipo: 'ENTRADA', quantidade: 50, motivo: 'teste' } });
    const ids: string[] = [];
    for (const qtd of [1, 2, 3]) {
      const v = await app.inject({ method: 'POST', url: '/vendas', headers: H, payload: { filialId: filial.id, clienteId: cliente.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId, quantidade: qtd, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 10 * qtd }] } });
      assert.ok([200, 201].includes(v.statusCode), v.body.slice(0, 200));
      ids.push(v.json().id ?? v.json().venda?.id);
    }
    const cancel = await app.inject({ method: 'POST', url: `/vendas/${ids[2]}/cancelar`, headers: H, payload: { motivo: 'teste de agregação', estornarFinanceiro: true } });
    assert.equal(cancel.statusCode, 200, cancel.body.slice(0, 200));
    const c = await comoSistema('teste', () => prisma.cliente.findUnique({ where: { id: cliente.id } }));
    assert.equal(Number((c as any).valorTotalComprado), 30, 'sobram as vendas de 10 + 20');
    assert.equal((c as any).frequencia, 2);
    assert.equal(Number((c as any).ticketMedio), 15);
    assert.ok((c as any).ultimaCompra, 'última compra preenchida');
  });

  await app.close();
});
