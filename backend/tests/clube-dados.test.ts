/**
 * NEXUS CLUB — Fase 2 (dados): regras que o PRÓPRIO BANCO garante, mesmo que o código erre.
 *
 * Com o Postgres de teste (papel postgres, e de novo no CI com o papel nexus_app):
 *  - uma pessoa = uma conta (e-mail e CPF únicos);
 *  - uma carteirinha por pessoa em cada clube; código do QR único dentro do clube;
 *  - carteirinha não pode apontar para cliente de outra empresa;
 *  - termo da plataforma com versão única; aceite só cita termo da mesma empresa;
 *  - autorização atual única por pessoa/empresa/canal; novo valor NEXUS_CLUB em Origem.
 * Quando conectado como nexus_app (2ª rodada do CI), confere também o isolamento:
 * consumidor só vê a própria conta; empresa não vê a conta global; históricos só crescem.
 * (O roteiro completo de isolamento em SQL está em prisma/seguranca/04_validacao_rls.sql, T11.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function rejeita(p: Promise<unknown>, padrao: RegExp, rotulo: string) {
  await assert.rejects(p, (e: any) => padrao.test(`${e?.code ?? ''} ${e?.message ?? ''}`), rotulo);
}

test('NEXUS CLUB — dados: regras garantidas pelo banco', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const [A, B] = await Promise.all(['A', 'B'].map((x) => prisma.empresa.create({ data: { nome: `Clube ${x} ${SUF}`, cnpj: generateRandomValidCnpj() } })));
  const cliA = await prisma.cliente.create({ data: { empresaId: A.id, nome: 'Cliente A', origem: 'NEXUS_CLUB' } });
  const cliB = await prisma.cliente.create({ data: { empresaId: B.id, nome: 'Cliente B' } });
  const conta = (n: string) => prisma.contaConsumidor.create({ data: { email: `p${n}-${SUF}@teste.local`, cpfHash: `h${n}-${SUF}`, cpfCifrado: 'cifrado', nome: `Pessoa ${n}`, senhaHash: 'hash' } });
  const p1 = await conta('1');
  const p2 = await conta('2');

  await t.test('conta: começa pendente de verificação; e-mail e CPF não se repetem', async () => {
    assert.equal(p1.status, 'PENDENTE_VERIFICACAO');
    await rejeita(prisma.contaConsumidor.create({ data: { email: p1.email, cpfHash: `outro-${SUF}`, cpfCifrado: 'x', nome: 'x', senhaHash: 'x' } }), /P2002/, 'e-mail repetido');
    await rejeita(prisma.contaConsumidor.create({ data: { email: `outro-${SUF}@teste.local`, cpfHash: p1.cpfHash, cpfCifrado: 'x', nome: 'x', senhaHash: 'x' } }), /P2002/, 'CPF repetido');
    assert.equal((await prisma.cliente.findUnique({ where: { id: cliA.id } }))!.origem, 'NEXUS_CLUB');
  });

  await t.test('carteirinha: uma por pessoa em cada clube; QR único dentro do clube', async () => {
    await prisma.membroClube.create({ data: { empresaId: A.id, consumidorId: p1.id, clienteId: cliA.id, codigoQr: `qr-${SUF}` } });
    await prisma.membroClube.create({ data: { empresaId: B.id, consumidorId: p1.id, codigoQr: `qr-${SUF}` } }); // mesmo código em outro clube: permitido
    await rejeita(prisma.membroClube.create({ data: { empresaId: A.id, consumidorId: p1.id } }), /P2002/, 'segunda carteirinha no mesmo clube');
    await rejeita(prisma.membroClube.create({ data: { empresaId: A.id, consumidorId: p2.id, codigoQr: `qr-${SUF}` } }), /P2002/, 'QR repetido no mesmo clube');
  });

  await t.test('carteirinha não aponta para cliente de outra empresa', async () => {
    await rejeita(prisma.membroClube.create({ data: { empresaId: A.id, consumidorId: p2.id, clienteId: cliB.id } }), /não pertence à empresa/, 'cliente de B em carteirinha de A');
    const m = await prisma.membroClube.create({ data: { empresaId: A.id, consumidorId: p2.id, status: 'PENDENTE_VINCULO' } });
    await rejeita(prisma.membroClube.update({ where: { id: m.id }, data: { clienteId: cliB.id } }), /não pertence à empresa/, 'troca para cliente de B');
  });

  await t.test('termos: versão única na plataforma; aceite cita termo da mesma empresa', async () => {
    const versao = 800000 + Math.floor(Math.random() * 99999);
    const plat = await prisma.termoVersao.create({ data: { tipo: 'TERMOS_USO', versao, texto: 'Termos de teste' } });
    await rejeita(prisma.termoVersao.create({ data: { tipo: 'TERMOS_USO', versao, texto: 'duplicado' } }), /unique|P2002|duplicate/i, 'versão repetida na plataforma');
    const termoA = await prisma.termoVersao.create({ data: { empresaId: A.id, tipo: 'AUTORIZACAO_MARKETING', versao: 1, texto: 'Autorização A' } });
    await prisma.termoAceite.create({ data: { consumidorId: p1.id, termoVersaoId: plat.id } });
    await prisma.termoAceite.create({ data: { consumidorId: p1.id, termoVersaoId: termoA.id, empresaId: A.id } });
    await rejeita(prisma.termoAceite.create({ data: { consumidorId: p2.id, termoVersaoId: termoA.id, empresaId: B.id } }), /não é desta empresa/, 'aceite do termo de A registrado como de B');
    await rejeita(prisma.termoAceite.create({ data: { consumidorId: p2.id, termoVersaoId: termoA.id } }), /não é desta empresa/, 'termo de empresa aceito como se fosse da plataforma');
    await rejeita(prisma.consentimentoEvento.create({ data: { empresaId: B.id, consumidorId: p1.id, canal: 'EMAIL', acao: 'CONCEDIDO', origem: 'APP', termoVersaoId: termoA.id } }), /não é desta empresa/, 'consentimento em B citando termo de A');
  });

  await t.test('autorização: histórico + situação atual única por pessoa/empresa/canal', async () => {
    const ev = await prisma.consentimentoEvento.create({ data: { empresaId: A.id, consumidorId: p1.id, canal: 'WHATSAPP', acao: 'CONCEDIDO', origem: 'APP' } });
    assert.equal(ev.finalidade, 'MARKETING');
    await prisma.consentimentoAtual.create({ data: { empresaId: A.id, consumidorId: p1.id, canal: 'WHATSAPP', situacao: 'CONCEDIDO', eventoId: ev.id } });
    await rejeita(prisma.consentimentoAtual.create({ data: { empresaId: A.id, consumidorId: p1.id, canal: 'WHATSAPP', situacao: 'REVOGADO', eventoId: ev.id } }), /P2002/, 'duas situações para o mesmo canal');
    const cfg = await prisma.clubeConfig.create({ data: { empresaId: A.id, nome: 'Clube A' } });
    assert.equal(cfg.ativo, false, 'clube começa desligado');
    assert.equal(cfg.publico, false, 'clube começa fora da busca de lojas');
  });

  await t.test('isolamento com o papel da aplicação (nexus_app)', async (st) => {
    const [{ usuario }] = await prisma.$queryRaw<Array<{ usuario: string }>>`select current_user as usuario`;
    if (usuario !== 'nexus_app') { st.skip('só com o papel nexus_app (2ª rodada do CI)'); return; }
    const contar = async (cfg: { consumidor?: string; empresa?: string; escopo?: string }, sql: string) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`select set_config('app.consumidor_id', ${cfg.consumidor ?? ''}, true), set_config('app.empresa_id', ${cfg.empresa ?? ''}, true), set_config('app.escopo', ${cfg.escopo ?? ''}, true)`;
        const [{ n }] = await tx.$queryRawUnsafe<Array<{ n: number }>>(sql);
        return Number(n);
      });
    const ids = `('${p1.id}','${p2.id}')`;
    assert.equal(await contar({ consumidor: p1.id }, `select count(*) n from "ContaConsumidor" where id in ${ids}`), 1, 'consumidor vê só a própria conta');
    assert.equal(await contar({ consumidor: p1.id }, `select count(*) n from "MembroClube" where "consumidorId" in ${ids}`), 2, 'consumidor vê só as próprias carteirinhas (A e B)');
    assert.equal(await contar({ empresa: A.id, escopo: 'tenant' }, `select count(*) n from "ContaConsumidor" where id in ${ids}`), 0, 'empresa não vê a conta global');
    assert.equal(await contar({ empresa: B.id, escopo: 'tenant' }, `select count(*) n from "MembroClube" where "consumidorId" in ${ids}`), 1, 'empresa B vê só a carteirinha dela');
    await rejeita(prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.empresa_id', ${A.id}, true), set_config('app.escopo', 'tenant', true)`;
      await tx.$executeRawUnsafe(`delete from "ConsentimentoEvento" where "consumidorId" = '${p1.id}'`);
    }), /permission denied|42501/i, 'histórico de consentimento não se apaga');
  });
});
