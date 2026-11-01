import { test } from "node:test";
import assert from "node:assert/strict";
import { criarTitulo, baixar, cancelar, saldo, situacao, fluxoDeCaixa, conciliar } from "../dist/financeiro.js";

const receber = (id, valor, venc) => criarTitulo({ id, tipo: "receber", valorCentavos: valor, vencimento: venc });
const pagar = (id, valor, venc) => criarTitulo({ id, tipo: "pagar", valorCentavos: valor, vencimento: venc });

test("baixa parcial reduz o saldo e muda a situação", () => {
  const t = receber("T1", 10000, "2026-10-10");
  const parcial = baixar(t, "2026-10-05", 4000);
  assert.equal(saldo(parcial), 6000);
  assert.equal(situacao(parcial, "2026-10-06"), "parcial");
  assert.equal(saldo(t), 10000, "o título original não pode ser alterado");
});

test("baixa total marca como pago", () => {
  const t = baixar(receber("T1", 10000, "2026-10-10"), "2026-10-09", 10000);
  assert.equal(saldo(t), 0);
  assert.equal(situacao(t, "2026-10-20"), "pago");
});

test("baixa acima do saldo é recusada", () => {
  const t = baixar(receber("T1", 10000, "2026-10-10"), "2026-10-05", 6000);
  assert.throws(() => baixar(t, "2026-10-06", 4001), /excede o saldo/);
});

test("baixa com data inválida é recusada", () => {
  assert.throws(() => baixar(receber("T1", 100, "2026-10-10"), "2026-02-31", 50), /data da baixa/);
});

test("situação por vencimento", () => {
  const t = receber("T1", 100, "2026-10-10");
  assert.equal(situacao(t, "2026-10-09"), "aberto");
  assert.equal(situacao(t, "2026-10-11"), "vencido");
});

test("título com baixa não pode ser cancelado; sem baixa, pode", () => {
  const t = baixar(receber("T1", 100, "2026-10-10"), "2026-10-01", 10);
  assert.throws(() => cancelar(t), /estorne/);
  assert.equal(situacao(cancelar(receber("T2", 100, "2026-10-10")), "2026-10-01"), "cancelado");
});

test("fluxo de caixa acumula entradas e saídas por dia", () => {
  const fluxo = fluxoDeCaixa({
    saldoInicialCentavos: 0,
    dataInicio: "2026-10-01",
    dias: 3,
    titulos: [receber("R", 5000, "2026-10-02"), pagar("P", 3000, "2026-10-03")],
  });
  assert.deepEqual(
    fluxo.map((d) => [d.data, d.entradas, d.saidas, d.saldoProjetado]),
    [
      ["2026-10-01", 0, 0, 0],
      ["2026-10-02", 5000, 0, 5000],
      ["2026-10-03", 0, 3000, 2000],
    ],
  );
});

test("títulos vencidos antes do início entram no primeiro dia do fluxo", () => {
  const fluxo = fluxoDeCaixa({
    saldoInicialCentavos: 10000,
    dataInicio: "2026-10-01",
    dias: 2,
    titulos: [pagar("P", 1000, "2026-09-20")],
  });
  assert.equal(fluxo[0].saidas, 1000);
  assert.equal(fluxo[0].saldoProjetado, 9000);
});

test("títulos já pagos não entram no fluxo", () => {
  const paga = baixar(pagar("P", 1000, "2026-10-02"), "2026-10-01", 1000);
  const fluxo = fluxoDeCaixa({ saldoInicialCentavos: 0, dataInicio: "2026-10-01", dias: 3, titulos: [paga] });
  assert.equal(fluxo.reduce((s, d) => s + d.saidas, 0), 0);
});

test("conciliação casa valor exato e data dentro da tolerância", () => {
  const r = conciliar({
    lancamentos: [
      { id: "L1", data: "2026-10-05", valorCentavos: 10000 },
      { id: "L2", data: "2026-10-06", valorCentavos: -3000 },
      { id: "L3", data: "2026-10-20", valorCentavos: 7777 },
    ],
    titulos: [receber("T1", 10000, "2026-10-04"), pagar("T2", 3000, "2026-10-06"), receber("T3", 7777, "2026-10-01")],
  });
  assert.deepEqual(r.conciliados, [
    { lancamentoId: "L1", tituloId: "T1" },
    { lancamentoId: "L2", tituloId: "T2" },
  ]);
  assert.deepEqual(r.semTitulo, ["L3"]);
  assert.deepEqual(r.semLancamento, ["T3"]);
});

test("um título não é conciliado duas vezes", () => {
  const r = conciliar({
    lancamentos: [
      { id: "L1", data: "2026-10-05", valorCentavos: 10000 },
      { id: "L2", data: "2026-10-05", valorCentavos: 10000 },
    ],
    titulos: [receber("T1", 10000, "2026-10-05")],
  });
  assert.equal(r.conciliados.length, 1);
  assert.deepEqual(r.semTitulo, ["L2"]);
});

test("pagamento parcial não é conciliado automaticamente", () => {
  const parcial = baixar(receber("T1", 10000, "2026-10-05"), "2026-10-01", 4000);
  const r = conciliar({
    lancamentos: [{ id: "L1", data: "2026-10-05", valorCentavos: 6000 }],
    titulos: [parcial],
  });
  assert.equal(r.conciliados.length, 0);
  assert.deepEqual(r.semTitulo, ["L1"]);
});
