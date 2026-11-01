import { test } from "node:test";
import assert from "node:assert/strict";
import { renovarAte, contratosVencendo, validarContrato } from "../dist/contratos.js";

const base = (over = {}) => ({
  id: "C1",
  inicio: "2025-01-01",
  fim: "2025-12-31",
  valorCentavos: 1_200_000,
  renovacaoAutomatica: true,
  periodoRenovacaoMeses: 12,
  reajustePontosBase: 1000,
  ...over,
});

test("renovação automática avança o período e aplica o reajuste", () => {
  const r = renovarAte(base(), "2026-03-10");
  assert.equal(r.inicio, "2026-01-01");
  assert.equal(r.fim, "2026-12-31");
  assert.equal(r.valorCentavos, 1_320_000);
});

test("renovação repete enquanto o contrato estiver vencido", () => {
  const r = renovarAte(base(), "2028-06-01");
  assert.equal(r.inicio, "2028-01-01");
  assert.equal(r.fim, "2028-12-31");
  assert.equal(r.valorCentavos, Math.round(1_200_000 * 1.1 ** 3));
});

test("contrato sem renovação automática permanece como está", () => {
  const c = base({ renovacaoAutomatica: false });
  assert.deepEqual(renovarAte(c, "2026-03-10"), c);
});

test("contrato vigente não é alterado", () => {
  const c = base({ fim: "2027-06-30" });
  assert.equal(renovarAte(c, "2026-03-10").fim, "2027-06-30");
});

test("alerta de vencimento só para contratos sem renovação automática", () => {
  const alertas = contratosVencendo(
    [
      base({ id: "A", fim: "2026-11-10", renovacaoAutomatica: false }),
      base({ id: "B", fim: "2026-11-10", renovacaoAutomatica: true }),
      base({ id: "C", fim: "2027-06-01", renovacaoAutomatica: false }),
    ],
    "2026-10-27",
    30,
  );
  assert.deepEqual(alertas.map((a) => [a.id, a.diasRestantes]), [["A", 14]]);
});

test("validação de contrato", () => {
  assert.throws(() => validarContrato(base({ fim: "2024-12-31" })), /posterior/);
  assert.throws(() => validarContrato(base({ reajustePontosBase: -1 })), /pontos base/);
  assert.throws(() => validarContrato(base({ periodoRenovacaoMeses: 0 })), /pelo menos 1 mês/);
});
