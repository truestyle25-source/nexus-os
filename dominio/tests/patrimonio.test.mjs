import { test } from "node:test";
import assert from "node:assert/strict";
import { cronogramaDepreciacao, depreciadoAte, validarBem } from "../dist/patrimonio.js";

const bem = (over = {}) => ({
  id: "B1",
  descricao: "Notebook",
  dataAquisicao: "2026-01-15",
  valorAquisicaoCentavos: 1_000_000,
  valorResidualCentavos: 0,
  vidaUtilMeses: 3,
  ...over,
});

test("o cronograma fecha exatamente na base depreciável", () => {
  const linhas = cronogramaDepreciacao(bem());
  const soma = linhas.reduce((s, l) => s + l.depreciacaoCentavos, 0);
  assert.equal(soma, 1_000_000);
});

test("o resto de centavos vai para o último mês", () => {
  const linhas = cronogramaDepreciacao(bem());
  assert.deepEqual(
    linhas.map((l) => l.depreciacaoCentavos),
    [333_333, 333_333, 333_334],
  );
  assert.equal(linhas[2].valorContabilCentavos, 0);
});

test("datas mensais seguem a aquisição", () => {
  const linhas = cronogramaDepreciacao(bem());
  assert.deepEqual(linhas.map((l) => l.data), ["2026-02-15", "2026-03-15", "2026-04-15"]);
});

test("valor residual é preservado no fim da vida útil", () => {
  const linhas = cronogramaDepreciacao(bem({ valorResidualCentavos: 100_000, vidaUtilMeses: 36 }));
  const ultimo = linhas[linhas.length - 1];
  assert.equal(ultimo.valorContabilCentavos, 100_000);
});

test("depreciado até um mês intermediário e limitado à vida útil", () => {
  assert.equal(depreciadoAte(bem(), 0), 0);
  assert.equal(depreciadoAte(bem(), 2), 666_666);
  assert.equal(depreciadoAte(bem(), 99), 1_000_000);
});

test("validação de bem", () => {
  assert.throws(() => validarBem(bem({ valorResidualCentavos: 1_000_000 })), /residual/);
  assert.throws(() => validarBem(bem({ vidaUtilMeses: 0 })), /Vida útil/);
  assert.throws(() => validarBem(bem({ valorAquisicaoCentavos: 10.5 })), /centavos/);
  assert.throws(() => validarBem(bem({ descricao: " " })), /descrição/);
});
