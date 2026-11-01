/**
 * Testes do motor de folha de pagamento.
 *
 * As tabelas do INSS e do IRRF mudam por LEI todo ano. Estes valores sao a
 * referencia de 2026 e ficam travados por teste: se um dia alguem "simplificar"
 * a tabela, os testes quebram em vez de a folha passar a descontar errado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularInss, calcularIrrf, apurarFolha, VALE_TRANSPORTE_PCT } from "../src/lib/folha.js";

/** Mesma arredondada do motor (2 casas), para comparar totais sem divergir por float. */
const arred = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

const d = (iso: string) => new Date(`${iso}T12:00:00`);
const cents = (v: number) => Math.round(v * 100);

test("INSS 2026: progressivo por faixa cumulativa", () => {
  assert.equal(cents(calcularInss(1500)), cents(112.50));
  assert.equal(cents(calcularInss(2000)), cents(155.69));
  assert.equal(cents(calcularInss(3000)), cents(248.60));
});

test("INSS 2026: acima do teto nao ha desconto (teto produtivo)", () => {
  const teto = calcularInss(8475.55);
  // Acima do teto o segurado empregado nao contribui sobre o excedente: o
  // desconto para de crescer. Aplicar 8% ou 14% sobre o excedente seria erro.
  assert.equal(cents(calcularInss(10000)), cents(teto));
  assert.equal(cents(calcularInss(50000)), cents(teto));
});

test("INSS 2026: zero e negativo nao geram desconto", () => {
  assert.equal(calcularInss(0), 0);
  assert.equal(calcularInss(-500), 0);
});

test("INSS 2026: nunca decresce quando o salario sobe", () => {
  let anterior = 0;
  for (let base = 0; base <= 30000; base += 50) {
    const atual = calcularInss(base);
    assert.ok(atual >= anterior - 0.01, `INSS decresceu em ${base}`);
    anterior = atual;
  }
});

test("IRRF 2026: isencao ate 2.428,80", () => {
  assert.equal(calcularIrrf(2000), 0);
  assert.equal(calcularIrrf(2428.80), 0);
  assert.equal(calcularIrrf(0), 0);
});

test("IRRF 2026: parcela a deduzir por faixa", () => {
  assert.equal(cents(calcularIrrf(2500)), cents(5.34));     // 7,5% - 182,16
  assert.equal(cents(calcularIrrf(3000)), cents(55.84));    // 15% - 394,16
  assert.equal(cents(calcularIrrf(4000)), cents(224.51));   // 22,5% - 675,49
  assert.equal(cents(calcularIrrf(6000)), cents(741.27));   // 27,5% - 908,73
  assert.equal(cents(calcularIrrf(10000)), cents(1841.27)); // 27,5%
});

test("IRRF 2026: nunca decresce quando o salario sobe", () => {
  let anterior = 0;
  for (let base = 0; base <= 30000; base += 50) {
    const atual = calcularIrrf(base);
    assert.ok(atual >= anterior - 0.01, `IRRF decresceu em ${base}`);
    anterior = atual;
  }
});

test("IRRF nunca fica negativo (a parcela a deduzir nao gera desconto)", () => {
  assert.ok(calcularIrrf(2428.81) >= 0);
  assert.equal(calcularIrrf(2428.81), 0);
});

const func = (salario: number) => ({
  id: "f1", nome: "Teste", matricula: null, salario,
  dataAdmissao: d("2020-01-01"), dataDesligamento: null,
});

const semPonto = { minutosExtra: 0, minutosBanco: 0, diasFalta: 0, minutosAtraso: 0, diasUteis: 0, temDados: false };

test("folha sem ponto: so salario-base, INSS, VT e IRRF", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: semPonto });
  assert.equal(r.totalProventos, 3000);
  // VT = 6% do salario, percentual fixo por lei
  assert.equal(cents(180), cents(3000 * VALE_TRANSPORTE_PCT));
  assert.ok(r.lancamentos.some((l) => l.codigo === "001" && l.valor === 3000));
  assert.ok(r.lancamentos.some((l) => l.codigo === "INSS"));
  assert.ok(r.lancamentos.some((l) => l.codigo === "VALE_TRANSPORTE"));
});

test("folha: total e sempre a soma exata dos lancamentos", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: semPonto });
  const somaP = r.lancamentos.filter((l) => l.tipo === "PROVENTO").reduce((s, l) => s + l.valor, 0);
  const somaD = r.lancamentos.filter((l) => l.tipo === "DESCONTO").reduce((s, l) => s + l.valor, 0);
  assert.equal(cents(somaP), cents(r.totalProventos));
  assert.equal(cents(somaD), cents(r.totalDescontos));
  assert.equal(cents(r.liquido), cents(r.totalProventos - r.totalDescontos));
});

test("horas extras entram como provento quando ha batida real", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, minutosExtra: 600, temDados: true } });
  const extra = r.lancamentos.find((l) => l.codigo === "HORA_EXTRA");
  assert.ok(extra, "deveria ter lancamento de hora extra");
  assert.equal(extra!.tipo, "PROVENTO");
  assert.equal(extra!.origem, "PONTO");
  assert.ok(r.totalProventos > 3000);
  assert.equal(r.pontoUtilizado, true);
});

test("sem ponto, a hora extra NAO aparece (nao inventa)", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, minutosExtra: 600, temDados: false } });
  assert.equal(r.lancamentos.find((l) => l.codigo === "HORA_EXTRA"), undefined);
  assert.equal(r.pontoUtilizado, false);
});

test("FGTS e multa ficam null: sem saldo depositado nao se estima", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: semPonto });
  assert.equal(r.fgts, null);
  assert.equal(r.fgtsApurado, false);
  assert.ok(r.fgtsPendente.length > 0, "deve explicar o que falta para apurar");
  // O total nao pode conter FGTS: seria numero inventado.
  assert.equal(cents(r.liquido), cents(r.totalProventos - r.totalDescontos));
// ============================================================================
//  Benefícios (VA e VR)
//
//  A regra que importa: benefício é PROVENTO, não desconto. O empregador paga
//  o benefício e o valor vai para o empregado — o sinal errado descontaria do
//  salário de quem não foi descontado, e ninguém perceberia olhando o líquido.
//
//  VA e VR são independentes: o funcionário pode não receber nenhum, receber só
//  um, ou receber os dois. Cada um tem o seu valor.
// ============================================================================

const funcBen = (extras: Record<string, unknown>) => ({ ...func(3000), ...extras });
const rub = (r: any, codigo: string) => r.lancamentos.find((l: any) => l.codigo === codigo);

test("beneficios: sem cadastro, nenhum beneficio entra na folha", () => {
  const r = apurarFolha({ funcionario: funcBen({}), ponto: semPonto });
  assert.equal(rub(r, "VALE_ALIMENTACAO"), undefined);
  assert.equal(rub(r, "VALE_REFEICAO"), undefined);
});

test("beneficios: somente vale-alimentacao", () => {
  const r = apurarFolha({ funcionario: funcBen({ valeAlimentacao: true, valorValeAlimentacao: 400 }), ponto: semPonto });
  assert.equal(rub(r, "VALE_ALIMENTACAO")?.valor, 400);
  assert.equal(rub(r, "VALE_ALIMENTACAO")?.tipo, "PROVENTO");
  assert.equal(rub(r, "VALE_REFEICAO"), undefined);
});

test("beneficios: somente vale-refeicao", () => {
  const r = apurarFolha({ funcionario: funcBen({ valeRefeicao: true, valorValeRefeicao: 250 }), ponto: semPonto });
  assert.equal(rub(r, "VALE_REFEICAO")?.valor, 250);
  assert.equal(rub(r, "VALE_ALIMENTACAO"), undefined);
});

test("beneficios: os dois juntos, cada um com seu valor", () => {
  const r = apurarFolha({
    funcionario: funcBen({ valeAlimentacao: true, valorValeAlimentacao: 400, valeRefeicao: true, valorValeRefeicao: 250 }),
    ponto: semPonto,
  });
  assert.equal(rub(r, "VALE_ALIMENTACAO")?.valor, 400);
  assert.equal(rub(r, "VALE_REFEICAO")?.valor, 250);
});

test("beneficios: toggle desligado NAO paga, mesmo com valor antigo gravado", () => {
  // Regressão do cadastro: marcar "Sim", digitar 300 e voltar para "Não". O
  // valor continua no registro, e a folha precisa ignorar.
  const r = apurarFolha({ funcionario: funcBen({ valeAlimentacao: false, valorValeAlimentacao: 300 }), ponto: semPonto });
  assert.equal(rub(r, "VALE_ALIMENTACAO"), undefined);
});

test("beneficios: beneficio com valor zero nao gera rubrica", () => {
  const r = apurarFolha({ funcionario: funcBen({ valeAlimentacao: true, valorValeAlimentacao: 0 }), ponto: semPonto });
  assert.equal(rub(r, "VALE_ALIMENTACAO"), undefined);
});

test("beneficios: VA e VR entram no total de proventos", () => {
  const r = apurarFolha({
    funcionario: funcBen({ valeAlimentacao: true, valorValeAlimentacao: 400, valeRefeicao: true, valorValeRefeicao: 250 }),
    ponto: semPonto,
  });
  // 3000 de salario + 650 de beneficios.
  assert.equal(r.totalProventos, 3650);
  assert.equal(r.liquido, Math.round((3650 - r.totalDescontos) * 100) / 100);
});

test("beneficios: INSS incide sobre o provento do beneficio", () => {
  const comBeneficio = apurarFolha({
    funcionario: funcBen({ valeAlimentacao: true, valorValeAlimentacao: 1000 }),
    ponto: semPonto,
  });
  // O beneficio integra a remuneracao, entao o INSS sobe junto.
  const inss = comBeneficio.lancamentos.find((l) => l.codigo === "INSS");
  assert.equal(inss?.valor, calcularInss(4000));
});

});

test("salario zero ou nulo nao quebra e nao gera lancamento", () => {
  const r = apurarFolha({ funcionario: func(0), ponto: semPonto });
  assert.equal(r.lancamentos.length, 0);
  assert.equal(r.liquido, 0);
});

test("lancamentos manuais somam depois dos automaticos", () => {
  const r = apurarFolha({ funcionario: func(2000), ponto: semPonto, manuaisProvento: 300, manuaisDesconto: 50 });
  assert.equal(r.totalProventos, 2300);
  assert.ok(r.lancamentos.some((l) => l.codigo === "OUTRO_PROVENTO" && l.origem === "MANUAL"));
  assert.ok(r.lancamentos.some((l) => l.codigo === "OUTRO_DESCONTO" && l.origem === "MANUAL"));
});

test("adicional noturno e omitido enquanto o ponto nao marcar periodo noturno", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, minutosBanco: 600, temDados: true } });
  assert.equal(r.lancamentos.find((l) => l.codigo === "ADIC_NOTURNO"), undefined);
});

// --- Desconto por falta (proporcional aos dias uteis, CLT art. 130) ---

test("falta desconta a fracao proporcional do salario, nao o salario inteiro", () => {
  // 3 faltas em 22 dias uteis => 3000 * 3/22 = 409.09
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, diasFalta: 3, diasUteis: 22, temDados: true } });
  const falta = r.lancamentos.find((l) => l.codigo === "FALTA");
  assert.ok(falta, "rubrica FALTA nao foi gerada");
  assert.equal(falta!.tipo, "DESCONTO");
  assert.equal(falta!.origem, "PONTO");
  assert.equal(falta!.valor, 409.09);
  assert.equal(falta!.referencia, 3);
});

test("falta do mes inteiro nunca produz liquido negativo", () => {
  // Falta de 22/22 zera o salario, mas INSS/VT/IRRF ainda incidem sobre os
  // proventos cheios; o desconto de ponto e limitado ao saldo disponivel.
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, diasFalta: 22, diasUteis: 22, temDados: true } });
  const falta = r.lancamentos.find((l) => l.codigo === "FALTA");
  assert.ok(falta, "a falta do mes inteiro deve ser lancada");
  assert.ok(r.liquido >= 0, "liquido negativo: desconto maior que a remuneracao");
  assert.equal(r.liquido, 0, "com o salario inteiro comprometido, sobra nao pode sobrar");
  assert.equal(
    r.totalDescontos,
    arred(r.lancamentos.filter((l) => l.tipo === "DESCONTO").reduce((s, l) => s + l.valor, 0)),
  );
});

test("quando o desconto de ponto e limitado, o lancamento fica marcado para o RH", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, diasFalta: 22, minutosAtraso: 600, diasUteis: 22, temDados: true } });
  const doPonto = r.lancamentos.filter((l) => l.origem === "PONTO" && l.tipo === "DESCONTO");
  assert.ok(doPonto.every((l) => (l.observacoes ?? "").includes("Limitado")), "todo lancamento de ponto reduzido deve avisar");
  assert.ok(r.liquido >= 0);
});

test("faltas acima dos dias uteis nao cobram mais que o proprio salario", () => {
  // 40 faltas num mes de 22 dias uteis nao podem gerar um desconto maior que o
  // salario: a fracao e limitada a 22/22 e o saldo impede passar de 1.
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, diasFalta: 40, diasUteis: 22, temDados: true } });
  const falta = r.lancamentos.find((l) => l.codigo === "FALTA")!;
  assert.ok(falta.valor <= 3000, `desconto ${falta.valor} maior que o salario`);
  assert.ok(r.liquido >= 0, "liquido negativo: falta acima dos dias uteis nao pode custar mais que o salary");
});

test("sem dias uteis (divisor desconhecido) nenhuma falta e descontada", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, diasFalta: 5, diasUteis: 0, temDados: true } });
  assert.equal(r.lancamentos.find((l) => l.codigo === "FALTA"), undefined);
  assert.equal(r.liquido, apurarFolha({ funcionario: func(3000), ponto: semPonto }).liquido);
});

test("falta so e descontada com batida real (mesmo se diasFalta vier preenchido)", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, diasFalta: 5, diasUteis: 22, temDados: false } });
  assert.equal(r.lancamentos.find((l) => l.codigo === "FALTA"), undefined);
});

test("desconto de falta entra no total de descontos, nao nos proventos", () => {
  const base = apurarFolha({ funcionario: func(3000), ponto: semPonto });
  const comFalta = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, diasFalta: 2, diasUteis: 22, temDados: true } });
  assert.equal(comFalta.totalProventos, base.totalProventos);
  assert.ok(comFalta.totalDescontos > base.totalDescontos);
});

// --- Desconto por atraso (minutos apurados nas batidas) ---

test("atraso desconta os minutos apurados pelo valor/minuto do salario", () => {
  // 60 min de atraso; valor/minuto = 3000 / 5280 (jornada 44h) = 0.5682 => 34.09
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, minutosAtraso: 60, diasUteis: 22, temDados: true } });
  const atraso = r.lancamentos.find((l) => l.codigo === "ATRASO");
  assert.ok(atraso, "rubrica ATRASO nao foi gerada");
  assert.equal(atraso!.tipo, "DESCONTO");
  assert.equal(atraso!.origem, "PONTO");
  assert.equal(atraso!.valor, 34.09);
  assert.equal(atraso!.referencia, 1);
});

test("atraso e falta somam juntos, cada um com sua propria rubrica", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, diasFalta: 2, minutosAtraso: 120, diasUteis: 22, temDados: true } });
  const falta = r.lancamentos.find((l) => l.codigo === "FALTA")!;
  const atraso = r.lancamentos.find((l) => l.codigo === "ATRASO")!;
  assert.ok(falta && atraso, "as duas rubricas devem existir");
  assert.equal(falta.valor, 272.73);
  assert.equal(atraso.valor, 68.18);
  const soma = r.lancamentos.filter((l) => l.codigo === "FALTA" || l.codigo === "ATRASO").reduce((s, l) => s + l.valor, 0);
  assert.equal(Math.round(soma * 100) / 100, Math.round((falta.valor + atraso.valor) * 100) / 100);
});

test("atraso so e descontado com batida real", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, minutosAtraso: 90, diasUteis: 22, temDados: false } });
  assert.equal(r.lancamentos.find((l) => l.codigo === "ATRASO"), undefined);
});

test("hora extra e provento, falta e atraso sao desconto: liquido cai sem virar negativo", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, minutosExtra: 600, diasFalta: 3, minutosAtraso: 60, diasUteis: 22, temDados: true } });
  const extra = r.lancamentos.find((l) => l.codigo === "HORA_EXTRA")!;
  assert.equal(extra.tipo, "PROVENTO");
  assert.equal(extra.valor, 340.91);
  assert.ok(r.liquido >= 0, "liquido negativo com falta, atraso e hora extra");
});

test("ponto sem batidas nao gera nenhuma das duas rubricas", () => {
  const r = apurarFolha({ funcionario: func(3000), ponto: semPonto });
  assert.equal(r.lancamentos.find((l) => l.codigo === "FALTA"), undefined);
  assert.equal(r.lancamentos.find((l) => l.codigo === "ATRASO"), undefined);
  assert.equal(r.pontoUtilizado, false);
});

test("descontos de ponto sao proporcionais ao salario: dobrar salario dobra o desconto", () => {
  const um = apurarFolha({ funcionario: func(3000), ponto: { ...semPonto, diasFalta: 2, minutosAtraso: 30, diasUteis: 22, temDados: true } });
  const dois = apurarFolha({ funcionario: func(6000), ponto: { ...semPonto, diasFalta: 2, minutosAtraso: 30, diasUteis: 22, temDados: true } });
  const t1 = um.lancamentos.find((l) => l.codigo === "FALTA")!.valor + um.lancamentos.find((l) => l.codigo === "ATRASO")!.valor;
  const t2 = dois.lancamentos.find((l) => l.codigo === "FALTA")!.valor + dois.lancamentos.find((l) => l.codigo === "ATRASO")!.valor;
  // Cada rubrica e arredondada antes de somar, entao o total pode diferir 1 centavo
  // do dobro -- a proporcionalidade e por margem, nao igualdadeAoCentavo.
  assert.ok(Math.abs(t2 - t1 * 2) <= 0.05, `desconto nao proporcional: ${t1} x2 = ${t1 * 2}, mas ${t2}`);
});
