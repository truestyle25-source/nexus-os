import { test } from "node:test";
import assert from "node:assert/strict";
import { ehDataISO, somarMeses, somarDias, diasEntre, exigirCentavos } from "../dist/datas.js";

test("valida datas reais", () => {
  assert.equal(ehDataISO("2026-10-27"), true);
  assert.equal(ehDataISO("2026-02-30"), false);
  assert.equal(ehDataISO("2026-13-01"), false);
  assert.equal(ehDataISO("27/10/2026"), false);
});

test("somar meses ajusta para o último dia do mês quando necessário", () => {
  assert.equal(somarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(somarMeses("2024-01-31", 1), "2024-02-29");
  assert.equal(somarMeses("2026-11-15", 3), "2027-02-15");
});

test("somar dias atravessa meses e anos", () => {
  assert.equal(somarDias("2026-10-27", 30), "2026-11-26");
  assert.equal(somarDias("2026-12-31", 1), "2027-01-01");
  assert.equal(somarDias("2026-10-27", -1), "2026-10-26");
});

test("diferença em dias", () => {
  assert.equal(diasEntre("2026-10-01", "2026-10-11"), 10);
  assert.equal(diasEntre("2026-10-11", "2026-10-01"), -10);
});

test("valores monetários precisam ser inteiros em centavos", () => {
  assert.equal(exigirCentavos(1250, "valor"), 1250);
  assert.throws(() => exigirCentavos(12.5, "valor"), /inteiro em centavos/);
  assert.throws(() => exigirCentavos(0, "valor"), /maior que zero/);
  assert.equal(exigirCentavos(0, "valor", { permitirZero: true }), 0);
});
