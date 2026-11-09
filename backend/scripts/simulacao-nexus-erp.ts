import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const AUDIT_ID = `AUDIT-${Date.now()}`;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureCompany() {
  const empresa = await prisma.empresa.upsert({
    where: { cnpj: '11222333000181' },
    update: { nome: 'NEXUS CORPORATION', status: 'ATIVO' },
    create: {
      nome: 'NEXUS CORPORATION',
      razaoSocial: 'NEXUS CORPORATION VAREJO E DISTRIBUICAO LTDA',
      cnpj: '11222333000181',
      cidade: 'São Paulo',
      estado: 'SP',
      origem: 'MANUAL',
      status: 'ATIVO',
    },
  });

  const usuario = await prisma.usuario.upsert({
    where: { email: 'admin@nexus.com' },
    update: { nome: 'Samuel Duarte', status: 'ATIVO' },
    create: {
      empresaId: empresa.id,
      nome: 'Samuel Duarte',
      email: 'admin@nexus.com',
      senhaHash: '$2a$10$Q6C2bPk4hI0Y9JeA7R7Zm.0cMt47s9m5y6E7W6hK3rHh4gI9KfcfG',
      origem: 'MANUAL',
      status: 'ATIVO',
    },
  });

  return { empresa, usuario };
}

async function ensureBranches(empresaId: string) {
  const names = ['Filial São Paulo', 'Filial Rio', 'Filial Curitiba', 'Filial Belo Horizonte', 'Filial Porto Alegre'];
  const active = await prisma.filial.findMany({ where: { empresaId }, orderBy: { createdAt: 'asc' } });
  if (active.length >= 5) return active;

  const created: any[] = [];
  for (const name of names) {
    const existing = await prisma.filial.findFirst({ where: { empresaId, nome: name } });
    if (existing) {
      created.push(existing);
      continue;
    }
    const record = await prisma.filial.create({
      data: {
        empresaId,
        nome: name,
        cnpj: '11222333000181',
        cidade: name.includes('São') ? 'São Paulo' : name.includes('Rio') ? 'Rio de Janeiro' : name.includes('Curitiba') ? 'Curitiba' : name.includes('Belo') ? 'Belo Horizonte' : 'Porto Alegre',
        estado: name.includes('São') ? 'SP' : name.includes('Rio') ? 'RJ' : name.includes('Curitiba') ? 'PR' : name.includes('Belo') ? 'MG' : 'RS',
        origem: 'MANUAL',
      },
    });
    created.push(record);
  }
  return created;
}

async function ensureDepartments(empresaId: string) {
  const names = ['Diretoria', 'Recursos Humanos', 'Financeiro', 'Comercial', 'Vendas', 'Estoque', 'Compras', 'Logística', 'Fiscal', 'Tecnologia'];
  const rows = names.map((nome) => ({ empresaId, nome }));
  await prisma.departamento.createMany({ data: rows, skipDuplicates: true });
  return prisma.departamento.findMany({ where: { empresaId } });
}

async function ensureRoles(empresaId: string, departamentoIdMap: Record<string, string>) {
  const roles = [
    'Administrador', 'Diretor', 'Gerente regional', 'Gerente de filial', 'Supervisor', 'Operador de caixa',
    'Estoquista', 'Comprador', 'RH', 'Financeiro',
    'Analista de vendas', 'Assistente comercial', 'Coordenador de logística', 'Analista fiscal', 'Analista de tecnologia',
    'Assistente de compras', 'Supervisor de estoque', 'Gerente comercial', 'Analista financeiro', 'Coordenador de RH',
    'Recepcionista', 'Assistente de loja', 'Promotor de vendas', 'Técnico de suporte', 'Operador de expedição', 'Analista de qualidade',
    'Supervisor de caixa', 'Assistente de faturamento', 'Consultor comercial', 'Controladoria'
  ];

  const records = roles.map((nome, index) => ({
    empresaId,
    departamentoId: Object.values(departamentoIdMap)[index % Object.keys(departamentoIdMap).length],
    nome,
  }));

  await prisma.cargo.createMany({ data: records, skipDuplicates: true });
  return prisma.cargo.findMany({ where: { empresaId } });
}

async function createEmployees(empresaId: string, filialIds: string[], departamentoIds: string[], cargoIds: string[]) {
  const total = 200;
  const existing = await prisma.funcionario.count({ where: { empresaId } });
  if (existing >= total) return prisma.funcionario.findMany({ where: { empresaId } });

  for (let i = 0; i < total; i++) {
    const cpfDigits = String(10000000000 + i + 1).slice(1, 11);
    const cpf = `${cpfDigits.slice(0, 3)}.${cpfDigits.slice(3, 6)}.${cpfDigits.slice(6, 9)}-${cpfDigits.slice(9)}`;
    const deptIdx = i % departamentoIds.length;
    const cargoIdx = i % cargoIds.length;
    const filialId = filialIds[i % filialIds.length];

    const funcionario = await prisma.funcionario.upsert({
      where: { empresaId_cpf: { empresaId, cpf } },
      update: {},
      create: {
        empresaId,
        filialId,
        departamentoId: departamentoIds[deptIdx],
        cargoId: cargoIds[cargoIdx],
        nome: `Funcionário ${i + 1}`,
        cpf,
        email: `funcionario${i + 1}@nexus.com`,
        telefone: `+551199999${String(i + 100).padStart(4, '0')}`,
        salario: new Prisma.Decimal(3500 + (i % 15) * 900),
        tipoContrato: 'CLT',
        horarioEntradaPrevisto: '08:00',
        horarioSaidaPrevisto: '17:00',
        dataAdmissao: new Date(Date.now() - (i + 1) * 86400000 * 12),
        status: 'ATIVO',
        origem: 'MANUAL',
      },
    });

    if (i < 10) {
      await prisma.usuario.upsert({
        where: { email: `operador${i + 1}@nexus.com` },
        update: { nome: funcionario.nome, empresaId, filialId },
        create: {
          empresaId,
          filialId,
          nome: funcionario.nome,
          email: `operador${i + 1}@nexus.com`,
          senhaHash: '$2a$10$U7fZ6Wd3Y5bA7Fo7cuhFjOI4Uyz6kmQk6L2Iz5PE8uK7zNQeM37T2',
          origem: 'MANUAL',
          status: 'ATIVO',
        },
      });
    }
  }

  return prisma.funcionario.findMany({ where: { empresaId } });
}

async function createReferenceData(empresaId: string) {
  const categories = ['Eletrônicos', 'Casa e Jardim', 'Papelaria', 'Bebês', 'Beleza', 'Esporte', 'Alimentos', 'Automotivo', 'Perecíveis', 'Frios', 'Brinquedos', 'Ferramentas', 'Móveis', 'Pet', 'Suplementos', 'Lazer', 'Decoração', 'Roupas', 'Calçados', 'Perfumes', 'Acessórios', 'Eletrodomésticos', 'Cama Mesa e Banho', 'Telefonia', 'Computadores', 'Saúde', 'Limpeza', 'Bazar', 'Material Construção', 'Cervejas', 'Vinhos', 'Tintas', 'Camping', 'Fitness', 'Office', 'Jardinagem', 'Higiene', 'Conveniência', 'Outlet'];
  await prisma.categoria.createMany({ data: categories.map((nome) => ({ empresaId, nome })), skipDuplicates: true });

  const suppliers = Array.from({ length: 100 }, (_, i) => ({
    empresaId,
    nome: `Fornecedor ${i + 1} LTDA`,
    categoria: categories[i % categories.length],
    status: 'Ativo',
    telefone: `+55113000${String(1000 + i).padStart(4, '0')}`,
    email: `fornecedor${i + 1}@example.com`,
    origem: 'MANUAL',
  }));
  await prisma.fornecedor.createMany({ data: suppliers, skipDuplicates: true });

  return {
    categoryIds: (await prisma.categoria.findMany({ where: { empresaId }, select: { id: true } })).map((r) => r.id),
    supplierIds: (await prisma.fornecedor.findMany({ where: { empresaId }, select: { id: true } })).map((r) => r.id),
  };
}

async function createProducts(empresaId: string, categoryIds: string[], supplierIds: string[]) {
  const count = 5000;
  const existing = await prisma.produto.count({ where: { empresaId } });
  if (existing >= count) return prisma.produto.findMany({ where: { empresaId }, select: { id: true, nome: true, custo: true, precoVenda: true, estoqueMinimo: true } });

  const products: Prisma.ProdutoCreateManyInput[] = [];
  for (let i = 0; i < count; i++) {
    const categoryId = categoryIds[i % categoryIds.length];
    const supplierId = supplierIds[i % supplierIds.length];
    const sku = `NX-${String(i + 1).padStart(5, '0')}`;
    const custo = Number((8 + ((i * 13) % 420)) / 10);
    const precoVenda = Number((custo * (1.4 + (i % 9) * 0.1)).toFixed(2));
    products.push({
      empresaId,
      categoriaId: categoryId,
      fornecedorId: supplierId,
      nome: `Produto ${i + 1}`,
      marca: `Marca ${((i % 25) + 1)}`,
      sku,
      codigoBarras: `789${String(i + 100000000000).padStart(12, '0')}`,
      custo: new Prisma.Decimal(custo),
      precoVenda: new Prisma.Decimal(precoVenda),
      estoqueMinimo: new Prisma.Decimal(5),
      estoqueMaximo: new Prisma.Decimal(200),
      unidade: 'UN',
      origem: 'MANUAL',
      status: 'ATIVO',
    });
  }

  await prisma.produto.createMany({ data: products, skipDuplicates: true });
  return prisma.produto.findMany({ where: { empresaId }, select: { id: true, nome: true, custo: true, precoVenda: true, estoqueMinimo: true } });
}

async function createStocks(empresaId: string, filialIds: string[], productIds: string[]) {
  const rows: Prisma.EstoqueCreateManyInput[] = [];
  for (const productId of productIds) {
    for (const filialId of filialIds) {
      rows.push({
        empresaId,
        filialId,
        produtoId: productId,
        quantidade: new Prisma.Decimal(25 + (Math.random() * 80)),
        valorTotal: new Prisma.Decimal(250),
      });
    }
  }
  await prisma.estoque.createMany({ data: rows, skipDuplicates: true });
}

async function createClients(empresaId: string) {
  const count = 10000;
  const existing = await prisma.cliente.count({ where: { empresaId } });
  if (existing >= count) return prisma.cliente.findMany({ where: { empresaId }, select: { id: true } });

  const rows: Prisma.ClienteCreateManyInput[] = [];
  for (let i = 0; i < count; i++) {
    const document = String(10000000000 + i + 1).slice(0, 11);
    rows.push({
      empresaId,
      nome: `Cliente ${i + 1}`,
      documento: document,
      email: `cliente${i + 1}@example.com`,
      telefone: `+551194${String(100 + i).padStart(5, '0')}`,
      endereco: `Rua ${i + 1}, ${((i % 20) + 1)}`,
      status: 'ATIVO',
      origem: 'MANUAL',
      valorTotalComprado: new Prisma.Decimal(150 + (i % 12) * 25),
      ticketMedio: new Prisma.Decimal(50 + (i % 7) * 10),
      frequencia: 1 + (i % 6),
    });
  }

  await prisma.cliente.createMany({ data: rows, skipDuplicates: true });
  return prisma.cliente.findMany({ where: { empresaId }, select: { id: true } });
}

async function createCashiers(empresaId: string, filialIds: string[], userIds: string[]) {
  const caixas = [] as Prisma.CaixaCreateManyInput[];
  for (let i = 0; i < 15; i++) {
    const filialId = filialIds[i % filialIds.length];
    const usuarioId = userIds[i % userIds.length];
    caixas.push({
      empresaId,
      filialId,
      numero: i + 1,
      usuarioId,
      status: 'ABERTO',
      fundoTroco: new Prisma.Decimal(150),
      saldo: new Prisma.Decimal(150),
    });
  }
  await prisma.caixa.createMany({ data: caixas, skipDuplicates: true });
  return prisma.caixa.findMany({ where: { empresaId } });
}

async function createSales(empresaId: string, filialIds: string[], productIds: string[], clientIds: string[], caixaIds: string[]) {
  const saleCount = 600;
  const cashboxes = await prisma.caixa.findMany({ where: { empresaId }, select: { id: true, filialId: true } });
  const productMap = await prisma.produto.findMany({ where: { empresaId }, select: { id: true, custo: true, precoVenda: true, nome: true } });

  for (let i = 0; i < saleCount; i++) {
    const filialId = filialIds[i % filialIds.length];
    const caixa = cashboxes[i % cashboxes.length];
    const product = productMap[i % productMap.length];
    const qty = 1 + (i % 3);
    const subtotal = Number(product.precoVenda) * qty;
    const total = subtotal - (i % 5) * 3;

    const venda = await prisma.venda.create({
      data: {
        empresaId,
        filialId,
        caixaId: caixa.id,
        clienteId: clientIds[i % clientIds.length],
        formaPagamento: i % 4 === 0 ? 'PIX' : i % 3 === 0 ? 'CARTAO_CREDITO' : i % 2 === 0 ? 'DINHEIRO' : 'CARTAO_DEBITO',
        parcelas: 1,
        status: 'FINALIZADA',
        subtotal: new Prisma.Decimal(subtotal),
        desconto: new Prisma.Decimal((i % 5) * 3),
        total: new Prisma.Decimal(total),
        valorRecebido: new Prisma.Decimal(total),
        troco: new Prisma.Decimal(Math.max(0, (i % 3) * 2)),
        origem: 'PDV',
        dataOperacional: new Date(Date.now() - ((i % 15) * 86400000)),
      },
    });

    await prisma.vendaItem.create({
      data: {
        vendaId: venda.id,
        produtoId: product.id,
        quantidade: new Prisma.Decimal(qty),
        unidadeVenda: 'UN',
        preco: new Prisma.Decimal(Number(product.precoVenda)),
        custoUnitario: new Prisma.Decimal(Number(product.custo)),
        total: new Prisma.Decimal(total),
      },
    });

    const estoque = await prisma.estoque.findFirst({ where: { empresaId, filialId, produtoId: product.id } });
    if (estoque) {
      await prisma.estoque.update({
        where: { id: estoque.id },
        data: { quantidade: { decrement: new Prisma.Decimal(qty) } },
      });
    }
  }

  return prisma.venda.count({ where: { empresaId } });
}

async function createPurchases(empresaId: string, filialIds: string[], supplierIds: string[], productIds: string[]) {
  const count = 300;
  const purchases = await prisma.fornecedor.findMany({ where: { empresaId }, select: { id: true } });
  const products = await prisma.produto.findMany({ where: { empresaId }, select: { id: true, custo: true } });

  for (let i = 0; i < count; i++) {
    const filialId = filialIds[i % filialIds.length];
    const fornecedorId = purchases[i % purchases.length].id;
    const product = products[i % products.length];
    const quantidade = 12 + (i % 6);
    const custoUnit = Number(product.custo) + 1;
    const valorTotal = custoUnit * quantidade;

    const purchase = await prisma.compra.create({
      data: {
        empresaId,
        filialId,
        fornecedorId,
        valorTotal: new Prisma.Decimal(valorTotal),
        status: 'RECEBIDA',
        condPagamento: '30/60',
        dataCompra: new Date(Date.now() - (i % 20) * 86400000),
        dataRecebimento: new Date(Date.now() - (i % 20) * 86400000),
        origem: 'MANUAL',
      }
    });

    await prisma.compraItem.create({
      data: {
        compraId: purchase.id,
        produtoId: product.id,
        quantidade: new Prisma.Decimal(quantidade),
        unidadeCompra: 'UN',
        valorUnit: new Prisma.Decimal(custoUnit),
      },
    });
  }

  return prisma.compra.count({ where: { empresaId } });
}

async function runSimulation() {
  const { empresa, usuario } = await ensureCompany();
  const filialList = await ensureBranches(empresa.id);
  const deptList = await ensureDepartments(empresa.id);
  const depMap = Object.fromEntries(deptList.map((d) => [d.nome, d.id]));
  const roleList = await ensureRoles(empresa.id, depMap);
  await createEmployees(empresa.id, filialList.map((f) => f.id), deptList.map((d) => d.id), roleList.map((r) => r.id));

  const { categoryIds, supplierIds } = await createReferenceData(empresa.id);
  const products = await createProducts(empresa.id, categoryIds, supplierIds);
  await createStocks(empresa.id, filialList.map((f) => f.id), products.map((p) => p.id));
  const clients = await createClients(empresa.id);

  const userList = await prisma.usuario.findMany({ where: { empresaId: empresa.id }, select: { id: true } });
  const caixaList = await createCashiers(empresa.id, filialList.map((f) => f.id), userList.map((u) => u.id));
  const salesCount = await createSales(empresa.id, filialList.map((f) => f.id), products.map((p) => p.id), clients.map((c) => c.id), caixaList.map((c) => c.id));
  const purchaseCount = await createPurchases(empresa.id, filialList.map((f) => f.id), supplierIds, products.map((p) => p.id));

  const summary = {
    auditId: AUDIT_ID,
    empresa: empresa.nome,
    empresaId: empresa.id,
    usuario: usuario.email,
    filiais: filialList.length,
    departamentos: deptList.length,
    cargos: roleList.length,
    funcionarios: await prisma.funcionario.count({ where: { empresaId: empresa.id } }),
    categorias: await prisma.categoria.count({ where: { empresaId: empresa.id } }),
    fornecedores: await prisma.fornecedor.count({ where: { empresaId: empresa.id } }),
    produtos: await prisma.produto.count({ where: { empresaId: empresa.id } }),
    clientes: await prisma.cliente.count({ where: { empresaId: empresa.id } }),
    vendas: salesCount,
    compras: purchaseCount,
    caixas: await prisma.caixa.count({ where: { empresaId: empresa.id } }),
    estoqueItens: await prisma.estoque.count({ where: { empresaId: empresa.id } }),
  };

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

runSimulation()
  .catch((error) => {
    console.error('ERRO NA SIMULAÇÃO', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
