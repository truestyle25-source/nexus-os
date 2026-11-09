import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_ML,
  TravaEnvio,
  atualizarUsuarioML,
  classificarErroML,
  consultarAplicacaoML,
  consultarEnderecosML,
  consultarMarcasML,
  consultarMeiosPagamentoML,
  consultarNotificacoesPerdidasML,
  consultarPacotesPromocaoML,
  consultarUsuarioLogadoML,
  consultarUsuarioPorIdML,
  dadosDeSucesso,
  executarConsulta,
  montarCorpoAtualizacaoML,
  type ClienteApiML,
} from '../lib/mercadolivre-dados';

/** ETAPA 2 - testes COM MOCKS (nao validam a API oficial; Etapa 3 valida). */
function clienteFalso(resposta: unknown, quebra?: unknown): ClienteApiML & {
  chamadas: Array<{ metodo: string; path: string; params?: unknown; corpo?: unknown }>;
} {
  const chamadas: Array<{ metodo: string; path: string; params?: unknown; corpo?: unknown }> = [];
  return {
    chamadas,
    async get(path: string, config?: { params?: Record<string, unknown> }) {
      chamadas.push({ metodo: 'GET', path, params: config?.params });
      if (quebra !== undefined) throw quebra;
      return { data: resposta as never };
    },
    async put(path: string, body?: unknown) {
      chamadas.push({ metodo: 'PUT', path, corpo: body });
      if (quebra !== undefined) throw quebra;
      return { data: resposta as never };
    },
  };
}

const FALHA_REDE = new Error('Network Error');

test('1. usuario por ID - sucesso, validacao, 401/403/nao-conectado/falha e endpoint real', async () => {
  const c = clienteFalso({ ok: true, dados: { id: 123, nickname: 'loja' } });
  const ok = await consultarUsuarioPorIdML(c, '123');
  assert.equal(ok.estado, 'sucesso');
  assert.equal(c.chamadas[0]?.path, `${BASE_ML}/users/123`);
  assert.deepEqual(await consultarUsuarioPorIdML(c, '   '), {
    estado: 'validacao',
    mensagem: 'Informe o ID do usuário do Mercado Livre.',
  });
  assert.equal((await consultarUsuarioPorIdML(clienteFalso(null, { status: 401 }), '1')).estado, 'sessao_invalida');
  assert.equal((await consultarUsuarioPorIdML(clienteFalso(null, { status: 403, message: 'negado' }), '1')).estado, 'sem_permissao');
  const nc = await consultarUsuarioPorIdML(clienteFalso(null, { status: 400, message: 'Conta Mercado Livre nao conectada' }), '1');
  assert.equal(nc.estado, 'nao_conectado');
  assert.equal((await consultarUsuarioPorIdML(clienteFalso(null, FALHA_REDE), '1')).estado, 'falha_comunicacao');
  assert.equal((await consultarUsuarioPorIdML(clienteFalso({ ok: true, dados: [] }), '1')).estado, 'inesperado');
  assert.equal((await consultarUsuarioPorIdML(clienteFalso({ ok: false, dados: {} }), '1')).estado, 'inesperado');
});

test('2. PUT parcial - allowlist/trim, corpo vazio barrado, sucesso e 400', async () => {
  const montado = montarCorpoAtualizacaoML({
    first_name: '  Ana  ',
    last_name: 'Souza',
    phone_area_code: '11',
    phone_number: '99999-0000',
    address_city: 'Sao Paulo',
    company_brand_name: 'Loja X',
  });
  assert.deepEqual(montado.corpo, {
    first_name: 'Ana',
    last_name: 'Souza',
    phone: { area_code: '11', number: '99999-0000' },
    address: { city: 'Sao Paulo' },
    company: { brand_name: 'Loja X' },
  });
  assert.equal(montarCorpoAtualizacaoML({ first_name: '   ' }).erro, 'Preencha ao menos um campo para atualizar.');
  assert.equal(montarCorpoAtualizacaoML({}).erro, 'Preencha ao menos um campo para atualizar.');
  const c = clienteFalso({ ok: true, dados: { id: 1, first_name: 'Ana' } });
  const r = await atualizarUsuarioML(c, montado.corpo!);
  assert.equal(r.estado, 'sucesso');
  assert.deepEqual(dadosDeSucesso<{ first_name?: string }>(r)?.first_name, 'Ana');
  assert.equal(c.chamadas[0]?.metodo, 'PUT');
  assert.equal(c.chamadas[0]?.path, `${BASE_ML}/users/me`);
  assert.deepEqual(Object.keys(c.chamadas[0]?.corpo as object).sort(), ['address', 'company', 'first_name', 'last_name', 'phone']);
  const r400 = await atualizarUsuarioML(
    clienteFalso(null, { status: 400, message: 'Dados invalidos: campos permitidos' }),
    { first_name: 'Ana' },
  );
  assert.equal(r400.estado, 'validacao');
  assert.equal((await atualizarUsuarioML(clienteFalso(null, FALHA_REDE), { first_name: 'A' })).estado, 'falha_comunicacao');
  const trava = new TravaEnvio();
  let execucoes = 0;
  const lenta = () => new Promise<string>((res) => setTimeout(() => { execucoes += 1; res('ok'); }, 20));
  const [r1, r2] = await Promise.all([trava.executar(lenta), trava.executar(lenta)]);
  assert.equal(r1.executou, true);

test('3. usuario autenticado - GET /users/me (sem ID na URL)', async () => {
  const c = clienteFalso({ ok: true, dados: { id: 7 } });
  assert.equal((await consultarUsuarioLogadoML(c)).estado, 'sucesso');
  assert.equal(c.chamadas[0]?.path, `${BASE_ML}/users/me`);
  assert.equal((await consultarUsuarioLogadoML(clienteFalso({ ok: true, dados: [] }))).estado, 'inesperado');
});

test('4. enderecos - lista, vazia, malformada e endpoint real', async () => {
  const c = clienteFalso({ ok: true, dados: [{ id: 1, city: 'SP' }] });
  assert.equal((await consultarEnderecosML(c, '9')).estado, 'sucesso');
  assert.equal(c.chamadas[0]?.path, `${BASE_ML}/users/9/addresses`);
  assert.equal((await consultarEnderecosML(clienteFalso({ ok: true, dados: [] }), '9')).estado, 'vazio');
  assert.equal((await consultarEnderecosML(clienteFalso({ ok: true, dados: { id: 1 } }), '9')).estado, 'inesperado');
  assert.equal((await consultarEnderecosML(c, '')).estado, 'validacao');
});

test('5. meios de pagamento - endpoint accepted_payment_methods', async () => {
  const c = clienteFalso({ ok: true, dados: [{ id: 'pix' }] });
  assert.equal((await consultarMeiosPagamentoML(c, '9')).estado, 'sucesso');
  assert.equal(c.chamadas[0]?.path, `${BASE_ML}/users/9/accepted_payment_methods`);
  assert.equal((await consultarMeiosPagamentoML(clienteFalso({ ok: true, dados: [] }), '9')).estado, 'vazio');
});

test('6. aplicacao - endpoint /applications/{id}', async () => {
  const c = clienteFalso({ ok: true, dados: { id: '4242' } });
  assert.equal((await consultarAplicacaoML(c, '4242')).estado, 'sucesso');
  assert.equal(c.chamadas[0]?.path, `${BASE_ML}/applications/4242`);
  assert.equal((await consultarAplicacaoML(c, '')).estado, 'validacao');
  assert.equal((await consultarAplicacaoML(clienteFalso(null, { status: 500, message: 'ML fora' }), '1')).estado, 'erro');
});

test('7. marcas - endpoint /brands, vazia e falha', async () => {
  const c = clienteFalso({ ok: true, dados: [{ id: 'm1' }] });
  assert.equal((await consultarMarcasML(c, '5')).estado, 'sucesso');
  assert.equal(c.chamadas[0]?.path, `${BASE_ML}/users/5/brands`);
  assert.equal((await consultarMarcasML(clienteFalso({ ok: true, dados: [] }), '5')).estado, 'vazio');
  assert.equal((await consultarMarcasML(clienteFalso(null, FALHA_REDE), '5')).estado, 'falha_comunicacao');
});

test('8. pacotes de promocao - endpoint classifieds_promotion_packs', async () => {
  const c = clienteFalso({ ok: true, dados: [{ id: 'p1' }] });
  assert.equal((await consultarPacotesPromocaoML(c, '5')).estado, 'sucesso');
  assert.equal(c.chamadas[0]?.path, `${BASE_ML}/users/5/classifieds_promotion_packs`);
  assert.equal((await consultarPacotesPromocaoML(clienteFalso({ ok: true, dados: [] }), '5')).estado, 'vazio');
});

test('9. missed_feeds - lista, vazia, user_id opcional, sem processamento', async () => {
  const c = clienteFalso({ ok: true, dados: [{ id: 'f1', topic: 'orders' }] });
  assert.equal((await consultarNotificacoesPerdidasML(c, '777')).estado, 'sucesso');
  assert.equal(c.chamadas[0]?.path, `${BASE_ML}/missed_feeds`);
  assert.deepEqual(c.chamadas[0]?.params, { user_id: '777' });
  const semFiltro = clienteFalso({ ok: true, dados: [] });
  assert.equal((await consultarNotificacoesPerdidasML(semFiltro)).estado, 'vazio');
  assert.equal(semFiltro.chamadas[0]?.params, undefined);
  assert.equal((await consultarNotificacoesPerdidasML(clienteFalso({ ok: true, dados: { messages: [] } }))).estado, 'inesperado');
  assert.equal((await consultarNotificacoesPerdidasML(clienteFalso(null, FALHA_REDE), '1')).estado, 'falha_comunicacao');
});

test('classificarErroML cobre 401/403/400-conectado/400-validacao/generico/rede', () => {
  assert.equal(classificarErroML({ status: 401 }, 'p').estado, 'sessao_invalida');
  assert.equal(classificarErroML({ status: 403, message: 'negado' }, 'p').estado, 'sem_permissao');
  assert.equal(classificarErroML({ status: 400, message: 'Conta Mercado Livre nao conectada' }, 'p').estado, 'nao_conectado');
  assert.equal(classificarErroML({ status: 400, message: 'Dados invalidos: campos' }, 'p').estado, 'validacao');
  assert.equal(classificarErroML({ status: 500, message: 'quebrou' }, 'p').estado, 'erro');
  assert.equal(classificarErroML(new Error('boom'), 'p').estado, 'falha_comunicacao');
});

test('executarConsulta nunca confunde vazio com erro nem erro com sucesso', async () => {
  assert.equal((await executarConsulta(async () => ({ data: { ok: true, dados: [] } }), { tipo: 'lista' })).estado, 'vazio');
  assert.equal((await executarConsulta(async () => ({ data: { ok: true, dados: {} } }), { tipo: 'objeto' })).estado, 'sucesso');
  assert.equal((await executarConsulta(async () => ({ data: { ok: true } }), { tipo: 'objeto' })).estado, 'inesperado');
  assert.equal((await executarConsulta(async () => { throw { status: 401 }; }, { tipo: 'objeto' })).estado, 'sessao_invalida');
});

  assert.equal(r2.executou, false);
  assert.equal(execucoes, 1);
  assert.equal(trava.emAndamento, false);
});
