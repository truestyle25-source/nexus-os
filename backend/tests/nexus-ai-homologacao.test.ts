/**
 * TESTE — NEXUS AI, pendências da homologação:
 *  - exportações registradas pelo gancho do servidor (rotas reais) e regra EXPORTACAO_MASSA;
 *  - avaliação "correta / incorreta" das respostas (só quem perguntou; resumo só para admin);
 *  - novas ações aprováveis: ajustar estoque mínimo e bloquear usuário (a partir de alerta),
 *    sempre com aprovação humana (não automatizáveis);
 *  - descobertas diárias em lotes (só empresas com movimento).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { carregarCatalogo } from '../src/modules/nexus-ai/catalogo.js';
import { executarFerramenta } from '../src/modules/nexus-ai/ferramentas/registro.js';
import { contexto } from '../src/modules/nexus-ai/motor.js';
import { agente } from '../src/modules/nexus-ai/agentes/registro.js';
import { foraDoHorario, varrer } from '../src/modules/nexus-ai/eventos/regras.js';
import { processarFila } from '../src/modules/nexus-ai/eventos/worker.js';
import { empresasComMovimento } from '../src/modules/nexus-ai/eventos/agendador.js';
import { decidir, salvarAutomacao, listarAutomacoes } from '../src/modules/nexus-ai/aprovacoes.service.js';
import { ROTA_EXPORTACAO, moduloDaExportacao } from '../src/modules/nexus-ai/eventos/exportacoes.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);

test('Rotas de exportação reconhecidas pelo gancho', () => {
  for (const r of ['/relatorios/export', '/api/v1/fornecedores/export', '/api/v1/fornecedores/:id/produtos/exportar', '/lgpd/clientes/:id/exportar', '/produtos/:id/movimentacoes/exportar', '/api/v1/compras/:id/pdf', '/radar/relatorio']) assert.ok(ROTA_EXPORTACAO.test(r), r);
  for (const r of ['/api/v1/fornecedores', '/relatorios', '/api/v1/exportacoes-config', '/radar/relatorios']) assert.equal(ROTA_EXPORTACAO.test(r), false, r);
  assert.equal(moduloDaExportacao('/lgpd/funcionarios/:id/exportar'), 'rh');
  assert.equal(moduloDaExportacao('/api/v1/fornecedores/export'), 'fornecedores');
});

test('NEXUS AI — homologação: exportações, avaliação e novas ações', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test', timeout: 600_000 }, async (t) => {
  carregarCatalogo();
  const { app } = await import('../src/server.js');
  await app.ready();
  const empresa = await prisma.empresa.create({ data: { nome: `Loja Homolog ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const M = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
  const novoUsuario = async (nome: string, perms: [string, string][] | 'todas') => {
    const u = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: M.id, nome, email: `${nome.toLowerCase()}-hom-${SUF}@teste.local`, senhaHash: 'x' } });
    const lista = perms === 'todas' ? MODULOS.flatMap((m) => ACOES.map((a) => [m, a] as [string, string])) : perms;
    await prisma.permissao.createMany({ data: lista.map(([modulo, acao]) => ({ usuarioId: u.id, modulo, acao, permitido: true })) });
    return u;
  };
  const admin = await novoUsuario('Admin', 'todas');
  const analista = await novoUsuario('Analista', [['ia', 'visualizar'], ['fornecedores', 'visualizar'], ['estoque', 'visualizar'], ['produtos', 'visualizar']]);
  const semExport = await novoUsuario('Caixa', [['ia', 'visualizar']]);
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}-${Math.random()}`, emitidoEmMs: Date.now() } as any)}` });
  const farinha = await prisma.produto.create({ data: { empresaId: empresa.id, nome: 'Farinha', sku: `FH${SUF}`, unidade: 'kg', custo: 5, precoVenda: 9, estoqueMinimo: 5, status: 'ATIVO' } as any });

  try {
    await t.test('Exportação pela rota real fica na auditoria; recusada (403) não', async () => {
      const ok = await app.inject({ method: 'POST', url: '/api/v1/fornecedores/export', headers: tok(analista), payload: { formato: 'csv' } });
      assert.equal(ok.statusCode, 200);
      const negado = await app.inject({ method: 'POST', url: '/api/v1/fornecedores/export', headers: tok(semExport), payload: { formato: 'csv' } });
      assert.equal(negado.statusCode, 403);
      await new Promise((r) => setTimeout(r, 300)); // onResponse roda depois do envio
      const reg = await prisma.auditoria.findMany({ where: { empresaId: empresa.id, acao: 'EXPORTAR' } });
      assert.equal(reg.length, 1); assert.equal(reg[0].usuarioId, analista.id); assert.equal(reg[0].entidadeId, 'fornecedores');
      assert.equal(reg[0].contexto, '/api/v1/fornecedores/export');
    });

    await t.test('Regra EXPORTACAO_MASSA: volume e fora do horário', async () => {
      for (let i = 0; i < 9; i++) assert.equal((await app.inject({ method: 'POST', url: '/api/v1/fornecedores/export', headers: tok(analista), payload: { formato: 'csv' } })).statusCode, 200);
      await new Promise((r) => setTimeout(r, 300));
      // 23h30 em São Paulo (02h30 UTC): exportação de clientes fora do horário.
      const madrugada = new Date(); madrugada.setUTCHours(2, 30, 0, 0); if (madrugada > new Date()) madrugada.setUTCDate(madrugada.getUTCDate() - 1);
      await prisma.auditoria.create({ data: { empresaId: empresa.id, usuarioId: admin.id, acao: 'EXPORTAR', entidade: 'Exportacao', entidadeId: 'clientes', contexto: '/lgpd/clientes/:id/exportar', origem: 'MANUAL', createdAt: madrugada } });
      await varrer(26 * 60);
      const ev = await prisma.aIEvento.findMany({ where: { empresaId: empresa.id, tipo: 'EXPORTACAO_MASSA' } });
      const volume = ev.filter((e) => (e.dados as any).motivo === 'volume');
      const hora = ev.filter((e) => (e.dados as any).motivo === 'fora do horário');
      assert.equal(volume.length, 1, JSON.stringify(ev.map((e) => e.dados)));
      assert.equal((volume[0].dados as any).exportacoes, 10); assert.equal(volume[0].severidade, 'ALTA'); assert.equal((volume[0].dados as any).usuarioId, analista.id);
      // A exportação do Admin foi às 23h30: sempre fora do horário. As 10 do Analista foram feitas
      // "agora": também viram alerta de horário se o teste rodar entre 22h e 6h (ex.: CI de madrugada).
      const doAdmin = hora.filter((e) => (e.dados as any).usuario === 'Admin');
      const doAnalista = hora.filter((e) => (e.dados as any).usuario === 'Analista');
      assert.equal(doAdmin.length, 1);
      assert.equal(doAnalista.length, foraDoHorario(new Date()) ? 10 : 0, 'exportações de agora só alertam por horário se for madrugada');
      await processarFila(50);
      const ins = await prisma.aIInsight.findMany({ where: { empresaId: empresa.id, tipo: 'EXPORTACAO_MASSA' } });
      assert.equal(ins.length, ev.length); assert.ok(ins.every((i) => i.modulo === 'auditoria'));
      assert.match(ins.find((i) => i.severidade === 'ALTA')!.titulo, /10 exportações em 60 min — Analista/);
      await varrer(26 * 60);
      assert.equal(await prisma.aIEvento.count({ where: { empresaId: empresa.id, tipo: 'EXPORTACAO_MASSA' } }), ev.length, 'não duplica');
    });

    await t.test('Avaliação correta/incorreta: só quem perguntou; resumo só para admin', async () => {
      const ex = await prisma.aIExecucao.create({ data: { empresaId: empresa.id, usuarioId: analista.id, agente: 'estoque', entrada: 'Quanto de farinha tenho?', status: 'CONCLUIDA', resposta: 'x' } });
      const url = `/api/v1/nexus-ai/execucoes/${ex.id}/avaliacao`;
      assert.equal((await app.inject({ method: 'POST', url, headers: tok(admin), payload: { avaliacao: 'CORRETA' } })).statusCode, 404, 'outro usuário não avalia');
      assert.equal((await app.inject({ method: 'POST', url, headers: tok(analista), payload: { avaliacao: 'TALVEZ' } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url, headers: tok(analista), payload: { avaliacao: 'INCORRETA', comentario: 'o saldo estava desatualizado' } })).statusCode, 200);
      const salvo = await prisma.aIExecucao.findUniqueOrThrow({ where: { id: ex.id } });
      assert.equal(salvo.avaliacao, 'INCORRETA'); assert.equal(salvo.avaliacaoComentario, 'o saldo estava desatualizado'); assert.equal(salvo.avaliadoPor, analista.id);
      const resultado = await app.inject({ method: 'GET', url: `/api/v1/nexus-ai/execucoes/${ex.id}`, headers: tok(analista) });
      assert.equal(resultado.json().detalhes.avaliacao, 'INCORRETA');
      const doAdmin = (await app.inject({ method: 'GET', url: '/api/v1/nexus-ai/automacoes', headers: tok(admin) })).json();
      assert.equal(doAdmin.avaliacoes.incorretas, 1); assert.equal(doAdmin.avaliacoes.ultimasIncorretas[0].comentario, 'o saldo estava desatualizado');
      const doAnalista = (await app.inject({ method: 'GET', url: '/api/v1/nexus-ai/automacoes', headers: tok(analista) })).json();
      assert.equal(doAnalista.avaliacoes.incorretas, 1); assert.equal(doAnalista.avaliacoes.ultimasIncorretas, null, 'perguntas de outros só para quem administra a IA');
    });

    await t.test('Ajustar estoque mínimo: a IA propõe, só quem edita produtos aprova', async () => {
      const r = (await executarFerramenta(contexto(empresa.id, analista.id), 'propor_ajuste_estoque_minimo', agente('estoque')!.ferramentas, { produtoId: farinha.id, estoqueMinimo: 12, motivo: 'demanda subiu' })).resultado as any;
      assert.equal(r.status, 'PENDENTE'); assert.match(r.titulo, /5 → 12 kg/);
      assert.equal(Number((await prisma.produto.findUniqueOrThrow({ where: { id: farinha.id } })).estoqueMinimo), 5, 'nada muda antes da aprovação');
      await assert.rejects(decidir(empresa.id, analista.id, r.aprovacaoId, 'aprovar'), /não tem permissão \(produtos\.editar\)/);
      const ok = await decidir(empresa.id, admin.id, r.aprovacaoId, 'aprovar');
      assert.equal(ok.status, 'EXECUTADA'); assert.deepEqual(ok.resultado, { produtoId: farinha.id, anterior: 5, estoqueMinimo: 12 });
      assert.equal(Number((await prisma.produto.findUniqueOrThrow({ where: { id: farinha.id } })).estoqueMinimo), 12);
      const igual = (await executarFerramenta(contexto(empresa.id, analista.id), 'propor_ajuste_estoque_minimo', agente('estoque')!.ferramentas, { produtoId: farinha.id, estoqueMinimo: 12 })).resultado as any;
      assert.match(igual.erro, /já é 12/);
    });

    await t.test('Bloquear usuário a partir de alerta: encerra as sessões na hora; nunca automático', async () => {
      const alvo = await novoUsuario('Vitima', [['ia', 'visualizar']]);
      await prisma.loginAttempt.createMany({ data: Array.from({ length: 6 }, (_, i) => ({ ip: '198.51.100.7', email: alvo.email, sucesso: false, createdAt: new Date(Date.now() - 60_000 + i * 1000) })) });
      await varrer(30); await processarFila(50);
      const ins = await prisma.aIInsight.findFirstOrThrow({ where: { empresaId: empresa.id, tipo: 'LOGIN_FALHO' } });
      const tokenAntigo = tok(alvo);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/nexus-ai/insights', headers: tokenAntigo })).statusCode, 200);
      // Sem permissão de ver usuários, o alerta (módulo usuarios) não aparece e não pode ser usado.
      assert.equal((await app.inject({ method: 'POST', url: `/api/v1/nexus-ai/insights/${ins.id}/propor-bloqueio`, headers: tok(analista) })).statusCode, 404);
      const prop = await app.inject({ method: 'POST', url: `/api/v1/nexus-ai/insights/${ins.id}/propor-bloqueio`, headers: tok(admin) });
      assert.equal(prop.statusCode, 200, prop.body); assert.equal(prop.json().status, 'PENDENTE');
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: alvo.id } })).status, 'ATIVO', 'nada muda antes da aprovação');
      const ok = await decidir(empresa.id, admin.id, prop.json().id, 'aprovar');
      assert.equal(ok.status, 'EXECUTADA');
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: alvo.id } })).status, 'INATIVO');
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/nexus-ai/insights', headers: tokenAntigo })).statusCode, 401, 'sessão aberta encerrada');
      // Não automatizável e não bloqueia a si mesmo.
      await assert.rejects(salvarAutomacao(empresa.id, admin.id, 'bloquear_usuario', { ativa: true, valorMaxCentavos: 100 }), /sempre exige aprovação humana/);
      assert.deepEqual((await listarAutomacoes(empresa.id)).map((a) => a.acao), ['criar_compra_rascunho']);
      const { criarProposta } = await import('../src/modules/nexus-ai/aprovacoes.service.js');
      const proprio = await criarProposta({ empresaId: empresa.id, usuarioId: admin.id, acao: 'bloquear_usuario', args: { usuarioId: admin.id } });
      const f = await decidir(empresa.id, admin.id, proprio.id, 'aprovar');
      assert.equal(f.status, 'FALHOU'); assert.match(f.erro!, /própria conta/);
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: admin.id } })).status, 'ATIVO');
      // Alerta sobre a própria conta: a proposta é recusada já na preparação.
      await prisma.loginAttempt.createMany({ data: Array.from({ length: 6 }, (_, i) => ({ ip: '198.51.100.9', email: admin.email, sucesso: false, createdAt: new Date(Date.now() - 30_000 + i * 1000) })) });
      await varrer(30); await processarFila(50);
      const doAdmin = await prisma.aIInsight.findFirstOrThrow({ where: { empresaId: empresa.id, tipo: 'LOGIN_FALHO', titulo: { contains: 'Admin' } } });
      const r = await app.inject({ method: 'POST', url: `/api/v1/nexus-ai/insights/${doAdmin.id}/propor-bloqueio`, headers: tok(admin) });
      assert.equal(r.statusCode, 422); assert.match(r.json().error ?? r.body, /própria conta/);
    });

    await t.test('Descobertas diárias: só empresas com movimento entram no lote', async () => {
      const antes = await empresasComMovimento(new Date(Date.now() - 63 * 86_400_000));
      assert.equal(antes.includes(empresa.id), false);
      await prisma.estoqueMovimentacao.create({ data: { empresaId: empresa.id, filialId: M.id, produtoId: farinha.id, tipo: 'VENDA', quantidade: 1, origem: 'MANUAL' } });
      assert.ok((await empresasComMovimento(new Date(Date.now() - 63 * 86_400_000))).includes(empresa.id));
    });
  } finally {
    const id = empresa.id;
    const emails = (await prisma.usuario.findMany({ where: { empresaId: id }, select: { email: true } })).map((u) => u.email);
    await prisma.loginAttempt.deleteMany({ where: { email: { in: emails } } });
    await prisma.aIInsight.deleteMany({ where: { empresaId: id } }); await prisma.aIEvento.deleteMany({ where: { empresaId: id } });
    await prisma.aIAprovacao.deleteMany({ where: { empresaId: id } }); await prisma.aIAutomacao.deleteMany({ where: { empresaId: id } });
    await prisma.alerta.deleteMany({ where: { empresaId: id } }); await prisma.aIExecucao.deleteMany({ where: { empresaId: id } });
    await prisma.auditoria.deleteMany({ where: { empresaId: id } }); await prisma.estoqueMovimentacao.deleteMany({ where: { empresaId: id } });
    await prisma.produto.deleteMany({ where: { empresaId: id } });
    await prisma.permissao.deleteMany({ where: { usuario: { empresaId: id } } }); await prisma.usuario.deleteMany({ where: { empresaId: id } });
    await prisma.filial.deleteMany({ where: { empresaId: id } });
    await prisma.empresa.delete({ where: { id } }).catch((err) => console.log('[limpeza]', String(err.message).match(/constraint[^\n]*/)?.[0]));
    await app.close();
  }
});
