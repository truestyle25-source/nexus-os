import { test } from "node:test";
import assert from "node:assert/strict";
import { consumoPrevisto, variacaoConsumo, validarFicha } from "../dist/producao.js";

const ficha = {
  produtoId: "P1",
  itens: [
    { materialId: "M1", quantidadePorUnidadeMilesimos: 1250 },
    { materialId: "M2", quantidadePorUnidadeMilesimos: 500 },
  ],
};

test("consumo previsto multiplica a ficha pela quantidade produzida", () => {
  assert.deepEqual(consumoPrevisto(ficha, 4), [
    { materialId: "M1", quantidadeMilesimos: 5000 },
    { materialId: "M2", quantidadeMilesimos: 2000 },
  ]);
});

test("variação compara previsto e realizado, inclusive material sem previsão", () => {
  const previsto = consumoPrevisto(ficha, 4);
  const realizado = [
    { materialId: "M1", quantidadeMilesimos: 5600 },
    { materialId: "M2", quantidadeMilesimos: 2000 },
    { materialId: "M3", quantidadeMilesimos: 300 },
  ];
  const v = variacaoConsumo(previsto, realizado);
  const m1 = v.find((x) => x.materialId === "M1");
  const m3 = v.find((x) => x.materialId === "M3");
  assert.equal(m1.diferencaMilesimos, 600);
  assert.equal(m1.variacaoCentesimosPorCento, 1200, "12,00%");
  assert.equal(m3.variacaoCentesimosPorCento, null, "sem previsão não há percentual");
});

test("ficha inválida é recusada", () => {
  assert.throws(() => validarFicha({ produtoId: "P", itens: [] }), /ao menos um material/);
  assert.throws(
    () => validarFicha({ produtoId: "P", itens: [{ materialId: "M", quantidadePorUnidadeMilesimos: 1 }, { materialId: "M", quantidadePorUnidadeMilesimos: 2 }] }),
    /repetido/,
  );
});

test("quantidade produzida precisa ser inteira e positiva", () => {
  assert.throws(() => consumoPrevisto(ficha, 0), /inteiro e maior que zero/);
  assert.throws(() => consumoPrevisto(ficha, 2.5), /inteiro e maior que zero/);
});
