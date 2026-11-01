import { test } from "node:test";
import assert from "node:assert/strict";
import { efeitosCompraAprovada, efeitosVendaFinalizada, dividirParcelas } from "../dist/integracao.js";

test("compra aprovada gera título a pagar com vencimento pelo prazo e entrada de estoque", () => {
  const e = efeitosCompraAprovada({
    id: "C9",
    dataAprovacao: "2026-10-27",
    valorCentavos: 50_000,
    prazoDias: 30,
    itens: [{ materialId: "M1", quantidadeMilesimos: 2000 }],
  });
  assert.equal(e.titulos.length, 1);
  assert.equal(e.titulos[0].tipo, "pagar");
  assert.equal(e.titulos[0].vencimento, "2026-11-26");
  assert.deepEqual(e.estoque.map((x) => [x.sentido, x.materialId, x.quantidadeMilesimos]), [["entrada", "M1", 2000]]);
});

test("efeitos têm chave de idempotência determinística", () => {
  const compra = { id: "C9", dataAprovacao: "2026-10-27", valorCentavos: 50_000, prazoDias: 30, itens: [{ materialId: "M1", quantidadeMilesimos: 1 }] };
  const a = efeitosCompraAprovada(compra);
  const b = efeitosCompraAprovada(compra);
  assert.deepEqual(a, b);
  assert.equal(a.titulos[0].chave, "compra:C9:titulo");
});

test("parcelas somam exatamente o valor, com diferença na última", () => {
  assert.deepEqual(dividirParcelas(1000, 3), [333, 333, 334]);
  const soma = dividirParcelas(10_001, 4).reduce((s, v) => s + v, 0);
  assert.equal(soma, 10_001);
});

test("venda finalizada gera uma conta a receber por parcela e saída de estoque", () => {
  const e = efeitosVendaFinalizada({
    id: "V1",
    dataVenda: "2026-10-27",
    valorCentavos: 10_000,
    parcelas: 3,
    intervaloDias: 30,
    itens: [{ produtoId: "P1", quantidadeMilesimos: 1000 }],
  });
  assert.deepEqual(e.titulos.map((t) => [t.tipo, t.valorCentavos, t.vencimento]), [
    ["receber", 3333, "2026-11-26"],
    ["receber", 3333, "2026-12-26"],
    ["receber", 3334, "2027-01-25"],
  ]);
  assert.equal(e.estoque[0].sentido, "saida");
  const chaves = [...e.titulos, ...e.estoque].map((x) => x.chave);
  assert.equal(new Set(chaves).size, chaves.length, "chaves devem ser únicas");
});

test("compra ou venda inválida é recusada", () => {
  assert.throws(() => efeitosCompraAprovada({ id: "C", dataAprovacao: "2026-10-27", valorCentavos: 10, prazoDias: 1, itens: [] }), /sem itens/);
  assert.throws(() => efeitosVendaFinalizada({ id: "V", dataVenda: "2026-10-27", valorCentavos: 10, parcelas: 0, intervaloDias: 30, itens: [{ produtoId: "P", quantidadeMilesimos: 1 }] }), /parcelas/);
});
