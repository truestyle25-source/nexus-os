const { chromium } = require('playwright');

const baseUrl = 'http://localhost:3000';
const apiBase = 'http://localhost:3333';
const loginEmail = 'admin@nexus.com';
const loginPassword = '12345678';
const today = new Date().toISOString().slice(0, 10);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders(token, companyId) {
  return {
    Authorization: `Bearer ${token}`,
    'x-company-id': companyId,
    'Content-Type': 'application/json',
  };
}

async function apiFetch(path, token, companyId, options = {}) {
  const init = {
    method: options.method || 'GET',
    headers: buildHeaders(token, companyId),
    ...options,
  };

  if (options.body && typeof options.body !== 'string') {
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${apiBase}${path}`, init);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { ok: response.ok, status: response.status, data: payload };
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('input[type="email"]').fill(loginEmail);
  await page.locator('input[type="password"]').fill(loginPassword);
  await page.getByRole('button', { name: /Entrar no NEXUS OS/i }).click();
  await page.waitForTimeout(6000);

  const token = await page.evaluate(() => localStorage.getItem('nexus_token'));
  const companyId = await page.evaluate(() => localStorage.getItem('nexus_companyId'));
  if (!token || !companyId) {
    throw new Error('Falha no login do usuário de teste. Token ou companyId ausentes.');
  }
  return { token, companyId };
}

async function navigateAndCapture(page, route, name) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1200);
  const file = `C:/Users/samue/OneDrive/Documentos/GitHub/nexus-os/frontend/test-results/${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const checks = [];

  try {
    const auth = await login(page);
    console.log('LOGIN_OK', auth.companyId.slice(0, 10));

    const productsRes = await apiFetch('/produtos?take=20&skip=0', auth.token, auth.companyId);
    if (!productsRes.ok) throw new Error(`GET /produtos falhou: ${productsRes.status}`);
    const productList = productsRes.data?.produtos || [];
    let product = productList.find((item) => Number(item.precoVenda || 0) > 0) || null;

    if (!product) {
      const created = await apiFetch('/produtos', auth.token, auth.companyId, {
        method: 'POST',
        body: {
          nome: `Produto simulação ${Date.now()}`,
          sku: `SIM-${Date.now()}`,
          custo: 12.5,
          precoVenda: 30,
          unidade: 'UN',
          estoqueMinimo: 5,
          estoqueMaximo: 200,
          pontoPedido: 10,
          origem: 'MANUAL',
        },
      });
      if (!created.ok) throw new Error(`POST /produtos falhou: ${created.status} ${JSON.stringify(created.data)}`);
      product = created.data;
    }

    const supplierListRes = await apiFetch('/api/v1/fornecedores', auth.token, auth.companyId);
    let supplier = supplierListRes.data?.items?.[0] || supplierListRes.data?.[0] || null;
    if (!supplier) {
      const createdSupplier = await apiFetch('/api/v1/fornecedores', auth.token, auth.companyId, {
        method: 'POST',
        body: {
          nome: `Fornecedor simulado ${Date.now()}`,
          cnpj: `123456780001${String(Date.now()).slice(-2)}`,
          categoria: 'Outros',
          status: 'Ativo',
          contato: 'Operação de teste',
          email: `fornecedor.${Date.now()}@teste.local`,
          telefone: '11999999999',
          condicaoPagamento: '30/60',
          observacoes: 'Fornecedor criado para simulação ERP.',
        },
      });
      if (!createdSupplier.ok) throw new Error(`POST /api/v1/fornecedores falhou: ${createdSupplier.status} ${JSON.stringify(createdSupplier.data)}`);
      supplier = createdSupplier.data;
    }

    const comprasRes = await apiFetch('/compras?take=5&skip=0', auth.token, auth.companyId);
    const filialId = comprasRes.data?.filiais?.[0]?.id || null;
    if (!filialId) throw new Error('Não foi possível localizar uma filial válida para a empresa de teste.');
    if (!supplier?.id) throw new Error('Não foi possível localizar um fornecedor válido.');

    const compraRes = await apiFetch('/compras', auth.token, auth.companyId, {
      method: 'POST',
      body: {
        filialId,
        fornecedorId: supplier.id,
        condPagamento: '30/60',
        origem: 'MANUAL',
        itens: [{ produtoId: product.id, quantidade: 20, valorUnit: Number(product.custo || 12.5), unidadeCompra: 'UN', fornecedorId: supplier.id }],
      },
    });

    if (!compraRes.ok) {
      throw new Error(`POST /compras falhou: ${compraRes.status} ${JSON.stringify(compraRes.data)}`);
    }
    const compra = compraRes.data;
    checks.push({ name: 'compra-criada', ok: true, detail: `compra ${compra.id}` });

    const confirmarRes = await apiFetch(`/compras/${compra.id}/confirmar`, auth.token, auth.companyId, { method: 'POST' });
    if (!confirmarRes.ok) {
      throw new Error(`POST /compras/:id/confirmar falhou: ${confirmarRes.status} ${JSON.stringify(confirmarRes.data)}`);
    }
    checks.push({ name: 'compra-confirmada', ok: true, detail: `status ${confirmarRes.data?.status || 'PEDIDO'}` });

    const receberRes = await apiFetch(`/compras/${compra.id}/receber`, auth.token, auth.companyId, { method: 'POST' });
    if (!receberRes.ok) {
      throw new Error(`POST /compras/:id/receber falhou: ${receberRes.status} ${JSON.stringify(receberRes.data)}`);
    }
    checks.push({ name: 'compra-recebida', ok: true, detail: `status ${receberRes.data?.status || 'RECEBIDA'}` });

    const estoqueRes = await apiFetch('/estoque?take=20&skip=0', auth.token, auth.companyId);
    if (!estoqueRes.ok) throw new Error(`GET /estoque falhou: ${estoqueRes.status}`);
    const estoque = estoqueRes.data?.estoques || [];
    const itemEstoque = estoque.find((item) => item.produtoId === product.id && item.filialId === filialId);
    if (!itemEstoque || Number(itemEstoque.quantidade || 0) < 1) {
      throw new Error(`Recebimento não refletiu em estoque para ${product.id}.`);
    }
    checks.push({ name: 'estoque-atualizado', ok: true, detail: `quantidade ${itemEstoque.quantidade}` });

    const vendaRes = await apiFetch('/vendas', auth.token, auth.companyId, {
      method: 'POST',
      body: {
        filialId,
        origem: 'PDV',
        formaPagamento: 'DINHEIRO',
        parcelas: 1,
        desconto: 0,
        itens: [{ produtoId: product.id, quantidade: 2, desconto: 0 }],
        pagamentos: [{ forma: 'DINHEIRO', valor: Number(product.precoVenda || 30) * 2 }],
      },
    });
    if (!vendaRes.ok) {
      throw new Error(`POST /vendas falhou: ${vendaRes.status} ${JSON.stringify(vendaRes.data)}`);
    }
    const venda = vendaRes.data;
    checks.push({ name: 'venda-criada', ok: true, detail: `venda ${venda.id || 'ok'} total ${venda.total || (Number(product.precoVenda || 30) * 2)}` });

    const financeiroRes = await apiFetch('/financeiro?take=20&skip=0', auth.token, auth.companyId);
    if (!financeiroRes.ok) throw new Error(`GET /financeiro falhou: ${financeiroRes.status}`);
    const financeiro = financeiroRes.data?.lancamentos || financeiroRes.data || [];
    if (!(Array.isArray(financeiro) && financeiro.length > 0)) {
      throw new Error('Financeiro não retornou lançamentos após compra/venda.');
    }
    checks.push({ name: 'financeiro-consistente', ok: true, detail: `lancamentos ${financeiro.length}` });

    const funcionariosRes = await apiFetch('/funcionarios', auth.token, auth.companyId);
    if (!funcionariosRes.ok) throw new Error(`GET /funcionarios falhou: ${funcionariosRes.status}`);

    const funcionarioPayload = {
      nome: `Funcionário RH ${Date.now()}`,
      cpf: `123456789${String(Date.now()).slice(-2)}`,
      email: `rh.${Date.now()}@teste.local`,
      telefone: '11988887777',
      dataAdmissao: today,
      departamentoTexto: 'Recursos Humanos',
      cargoTexto: 'Analista de RH',
      filialId,
      salario: 4200,
      tipoContrato: 'CLT',
      cargaHoraria: '220',
      jornada: '08:00-18:00',
      horarioEntradaPrevisto: '08:00',
      horarioSaidaPrevisto: '18:00',
      status: 'ATIVO',
      origem: 'MANUAL',
    };

    let funcionario = (funcionariosRes.data || []).find((item) => item.email === funcionarioPayload.email) || null;
    if (!funcionario) {
      const funcionarioCreate = await apiFetch('/funcionarios', auth.token, auth.companyId, {
        method: 'POST',
        body: funcionarioPayload,
      });
      if (!funcionarioCreate.ok) {
        throw new Error(`POST /funcionarios falhou: ${funcionarioCreate.status} ${JSON.stringify(funcionarioCreate.data)}`);
      }
      funcionario = funcionarioCreate.data;
    }
    checks.push({ name: 'funcionario-criado', ok: true, detail: `id ${funcionario.id}` });

    const entradaRes = await apiFetch('/ponto/manual', auth.token, auth.companyId, {
      method: 'POST',
      body: { funcionarioId: funcionario.id, tipo: 'ENTRADA', data: today },
    });
    if (!entradaRes.ok) throw new Error(`POST /ponto/manual ENTRADA falhou: ${entradaRes.status} ${JSON.stringify(entradaRes.data)}`);
    checks.push({ name: 'ponto-entrada', ok: true, detail: `entrada ${today}` });

    const saidaRes = await apiFetch('/ponto/manual', auth.token, auth.companyId, {
      method: 'POST',
      body: { funcionarioId: funcionario.id, tipo: 'SAIDA', data: today },
    });
    if (!saidaRes.ok) throw new Error(`POST /ponto/manual SAIDA falhou: ${saidaRes.status} ${JSON.stringify(saidaRes.data)}`);
    checks.push({ name: 'ponto-saida', ok: true, detail: `saida ${today}` });

    const advertenciaRes = await apiFetch('/rh/advertencias', auth.token, auth.companyId, {
      method: 'POST',
      body: {
        funcionarioId: funcionario.id,
        tipo: 'VERBAL',
        motivo: 'Teste de disciplina do módulo RH',
        descricao: 'Registro de teste para verificar a trilha RH em produção.',
        data: today,
        aplicadaPor: 'admin@nexus.com',
      },
    });
    if (!advertenciaRes.ok) throw new Error(`POST /rh/advertencias falhou: ${advertenciaRes.status} ${JSON.stringify(advertenciaRes.data)}`);
    checks.push({ name: 'advertencia-criada', ok: true, detail: `id ${advertenciaRes.data.id}` });

    const suspensaoRes = await apiFetch('/rh/suspensoes', auth.token, auth.companyId, {
      method: 'POST',
      body: {
        funcionarioId: funcionario.id,
        dias: 3,
        motivo: 'Teste de suspensão em simulação ERP.',
        inicio: today,
        fim: today,
        aplicadaPor: 'admin@nexus.com',
      },
    });
    if (!suspensaoRes.ok) throw new Error(`POST /rh/suspensoes falhou: ${suspensaoRes.status} ${JSON.stringify(suspensaoRes.data)}`);
    checks.push({ name: 'suspensao-criada', ok: true, detail: `id ${suspensaoRes.data.id}` });

    const folhaRes = await apiFetch('/rh/folhas', auth.token, auth.companyId, {
      method: 'POST',
      body: { competencia: '2026-11', observacoes: 'Competência criada para validação de RH.' },
    });
    if (!folhaRes.ok && folhaRes.status !== 409) {
      throw new Error(`POST /rh/folhas falhou: ${folhaRes.status} ${JSON.stringify(folhaRes.data)}`);
    }
    const folha = folhaRes.data || { id: null };
    const folhaId = folha.id;
    if (!folhaId) throw new Error('Não foi possível identificar a folha gerada para o RH.');
    checks.push({ name: 'folha-criada', ok: true, detail: `id ${folhaId}` });

    const processFolha = await apiFetch(`/rh/folhas/${folhaId}/processar`, auth.token, auth.companyId, { method: 'POST' });
    if (!processFolha.ok) {
      throw new Error(`POST /rh/folhas/:id/processar falhou: ${processFolha.status} ${JSON.stringify(processFolha.data)}`);
    }
    checks.push({ name: 'folha-processada', ok: true, detail: `processados ${processFolha.data?.processados || 1}` });

    const desligamentoPayload = {
      funcionarioId: funcionario.id,
      data: today,
      tipo: 'sem-justa-causa',
      motivo: 'Encerramento por simulação de rescisão',
      aviso: 'indenizado',
      saldoDias: 0,
      alineas: ['Simulação terminada com registro de auditoria do ERP.'],
      observacoes: 'Teste de rescisão executado pela validação operacional.',
      documentos: [],
    };
    const desligamentoRes = await apiFetch('/rh/desligamentos', auth.token, auth.companyId, {
      method: 'POST',
      body: desligamentoPayload,
    });
    if (!desligamentoRes.ok) {
      throw new Error(`POST /rh/desligamentos falhou: ${desligamentoRes.status} ${JSON.stringify(desligamentoRes.data)}`);
    }
    checks.push({ name: 'rescisao-criada', ok: true, detail: `id ${desligamentoRes.data.id}` });

    await navigateAndCapture(page, '/pdv', 'pdv-operacao');
    await navigateAndCapture(page, '/compras', 'compras-operacao');
    await navigateAndCapture(page, '/estoque', 'estoque-operacao');
    await navigateAndCapture(page, '/financeiro', 'financeiro-operacao');
    await navigateAndCapture(page, '/rh', 'rh-operacao');

    console.log('CHECKS=' + JSON.stringify(checks, null, 2));
    const failures = checks.filter((check) => check.ok === false);
    console.log('FAILURES=' + failures.length);
    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('ERRO_GERAL=' + error.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
