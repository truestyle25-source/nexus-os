import { test } from "node:test";
import assert from "node:assert/strict";
import { validarParaTransmissao, mudarEstado, provedorNaoConfigurado } from "../dist/fiscal.js";

const nota = (over = {}) => ({
  id: "N1",
  numero: 1,
  serie: 1,
  emitenteCnpj: "11.222.333/0001-81",
  destinatarioDocumento: "123.456.789-09",
  valorTotalCentavos: 10_000,
  itens: [{ descricao: "Item", quantidade: 2, valorUnitarioCentavos: 5000 }],
  estado: "rascunho",
  ...over,
});

test("nota válida passa na validação de transmissão", () => {
  assert.deepEqual(validarParaTransmissao(nota()), []);
});

test("CNPJ do emitente com dígito errado é apontado", () => {
  const erros = validarParaTransmissao(nota({ emitenteCnpj: "11.222.333/0001-82" }));
  assert.ok(erros.some((e) => /CNPJ do emitente/.test(e)));
});

test("total divergente dos itens é apontado", () => {
  const erros = validarParaTransmissao(nota({ valorTotalCentavos: 9999 }));
  assert.ok(erros.some((e) => /difere da soma/.test(e)));
});

test("usuário não pode marcar nota como autorizada", () => {
  assert.throws(() => mudarEstado(nota(), "autorizada", "usuario"), /só pode ser informado pelo provedor/);
  assert.throws(() => mudarEstado(nota(), "transmitida", "usuario"), /provedor/);
});

test("autorização do provedor exige protocolo", () => {
  assert.throws(() => mudarEstado(nota(), "autorizada", "provedor"), /protocolo/);
  const ok = mudarEstado(nota(), "autorizada", "provedor", "PROT-123");
  assert.equal(ok.estado, "autorizada");
  assert.equal(ok.protocolo, "PROT-123");
});

test("rascunho vai para pronta só se a nota estiver válida", () => {
  assert.equal(mudarEstado(nota(), "pronta", "usuario").estado, "pronta");
  assert.throws(() => mudarEstado(nota({ valorTotalCentavos: 1 }), "pronta", "usuario"), /difere/);
});

test("transição inválida pelo usuário é recusada", () => {
  const pronta = mudarEstado(nota(), "pronta", "usuario");
  assert.throws(() => mudarEstado(pronta, "pronta", "usuario"), /não é permitida/);
  assert.throws(() => mudarEstado(nota(), "rascunho", "usuario"), /não é permitida/);
});

test("sem provedor configurado, a emissão falha e nada é declarado emitido", async () => {
  await assert.rejects(() => provedorNaoConfigurado.transmitir(nota()), /não foi emitida/);
});
