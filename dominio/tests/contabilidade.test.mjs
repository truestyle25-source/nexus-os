import { test } from "node:test";
import assert from "node:assert/strict";
import { validarPlano, contasAnaliticas, validarLancamento, registrarLancamento, balancete } from "../dist/contabilidade.js";

const plano = [
  { codigo: "1", nome: "Ativo", natureza: "ativo" },
  { codigo: "1.1", nome: "Ativo circulante", natureza: "ativo" },
  { codigo: "1.1.01", nome: "Caixa", natureza: "ativo" },
  { codigo: "2", nome: "Passivo", natureza: "passivo" },
  { codigo: "2.1", nome: "Passivo circulante", natureza: "passivo" },
  { codigo: "2.1.01", nome: "Fornecedores", natureza: "passivo" },
];

const lanc = (partidas) => ({ id: "LC1", data: "2026-10-27", historico: "Pagamento de fornecedor", partidas });

test("plano válido não tem erros", () => {
  assert.deepEqual(validarPlano(plano), []);
});

test("plano com pai inexistente e código duplicado é recusado", () => {
  const ruim = [
    { codigo: "2.1.01", nome: "Fornecedores", natureza: "passivo" },
    { codigo: "2.1.01", nome: "Duplicada", natureza: "passivo" },
  ];
  const erros = validarPlano(ruim);
  assert.ok(erros.some((e) => /pai inexistente/.test(e)));
  assert.ok(erros.some((e) => /duplicado/.test(e)));
});

test("contas sintéticas são as que têm filhas", () => {
  assert.deepEqual([...contasAnaliticas(plano)].sort(), ["1.1.01", "2.1.01"]);
});

test("lançamento balanceado é aceito", () => {
  const l = lanc([
    { conta: "2.1.01", tipo: "D", valorCentavos: 1250 },
    { conta: "1.1.01", tipo: "C", valorCentavos: 1250 },
  ]);
  assert.deepEqual(validarLancamento(l, plano), []);
  assert.equal(registrarLancamento(l, plano), l);
});

test("lançamento desbalanceado é recusado", () => {
  const erros = validarLancamento(
    lanc([
      { conta: "2.1.01", tipo: "D", valorCentavos: 1000 },
      { conta: "1.1.01", tipo: "C", valorCentavos: 1250 },
    ]),
    plano,
  );
  assert.ok(erros.some((e) => /desbalanceado/.test(e)));
});

test("conta sintética não recebe lançamento", () => {
  const erros = validarLancamento(
    lanc([
      { conta: "2.1", tipo: "D", valorCentavos: 100 },
      { conta: "1.1.01", tipo: "C", valorCentavos: 100 },
    ]),
    plano,
  );
  assert.ok(erros.some((e) => /sintética/.test(e)));
});

test("lançamento com menos de duas partidas ou conta inexistente é recusado", () => {
  assert.ok(validarLancamento(lanc([{ conta: "1.1.01", tipo: "D", valorCentavos: 10 }]), plano).length > 0);
  const erros = validarLancamento(
    lanc([
      { conta: "9.9.99", tipo: "D", valorCentavos: 10 },
      { conta: "1.1.01", tipo: "C", valorCentavos: 10 },
    ]),
    plano,
  );
  assert.ok(erros.some((e) => /não existe/.test(e)));
});

test("registrarLancamento lança erro quando há problemas", () => {
  assert.throws(() => registrarLancamento(lanc([{ conta: "1.1.01", tipo: "D", valorCentavos: 10 }]), plano));
});

test("balancete fecha em equilíbrio com lançamentos válidos", () => {
  const l1 = lanc([
    { conta: "1.1.01", tipo: "D", valorCentavos: 5000 },
    { conta: "2.1.01", tipo: "C", valorCentavos: 5000 },
  ]);
  const l2 = lanc([
    { conta: "2.1.01", tipo: "D", valorCentavos: 2000 },
    { conta: "1.1.01", tipo: "C", valorCentavos: 2000 },
  ]);
  const b = balancete([l1, l2]);
  assert.equal(b.equilibrado, true);
  assert.equal(b.totalDebitos, 7000);
  assert.deepEqual(
    b.contas.map((c) => [c.conta, c.saldo]),
    [["1.1.01", 3000], ["2.1.01", -3000]],
  );
});
