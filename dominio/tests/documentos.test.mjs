import { test } from "node:test";
import assert from "node:assert/strict";
import { cnpjValido } from "../dist/documentos.js";

test("CNPJ com dígitos verificadores corretos é aceito", () => {
  assert.equal(cnpjValido("11.222.333/0001-81"), true);
  assert.equal(cnpjValido("11222333000181"), true);
});

test("CNPJ com dígito verificador errado é recusado", () => {
  assert.equal(cnpjValido("11.222.333/0001-82"), false);
  assert.equal(cnpjValido("11.222.333/0001-80"), false);
});

test("sequências repetidas e tamanho errado são recusados", () => {
  assert.equal(cnpjValido("00000000000000"), false);
  assert.equal(cnpjValido("1122233300018"), false);
  assert.equal(cnpjValido(""), false);
});
