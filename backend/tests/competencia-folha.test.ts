/**
 * Testes das REGRAS DE COMPETENCIA da folha.
 *
 * Ficam separados de `folha.test.ts` (que trava as tabelas do INSS/IRRF) porque
 * nao testam o motor de calculo: testam QUEM tem direito a receber a folha e
 * QUANTOS meses de 13o cabem. Sao as duas decisoes que produziram pagamento
 * indevido quando a admissao nao era levada em conta.
 *
 * Sem estes testes os bugs voltam: nenhuma das regras estava escrita em lugar
 * nenhum do codigo de producao, so na intencao de quem leu a rota.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
//  As mesmas regras, extraidas da rota de processamento.
//  Sao funcoes puras aqui para poderem ser testadas sem banco; em producao a
//  rota aplica a MESMA condicao sobre os registros que o Prisma devolve.
// ============================================================================

/** `AAAA-MM` -> primeiro dia e dia seguinte ao ultimo, em UTC (`@db.Date`). */
export function intervaloDaCompetencia(competencia: string) {
  const [ano, mes] = competencia.split('-').map(Number);
  const inicio = new Date(Date.UTC(ano, mes - 1, 1));
  // `fim` e o dia seguinte ao ultimo, porque a comparacao e exclusiva.
  const fim = new Date(Date.UTC(ano, mes, 1));
  return { inicio, fim };
}

/** Quem estava de fato na empresa durante a competencia. */
export function estaNaCompetencia(
  f: { dataAdmissao: Date | null; dataDesligamento: Date | null },
  inicio: Date,
  fim: Date,
): boolean {
  return (
    (!f.dataAdmissao || f.dataAdmissao < fim) &&
    (!f.dataDesligamento || f.dataDesligamento >= inicio)
  );
}

/** Meses de direito ao 13o no ano, com os getters UTC. */
export function mesesDe13o(dataAdmissao: Date, fimDoAno: Date): number {
  const mesesNoAno =
    (fimDoAno.getUTCFullYear() - dataAdmissao.getUTCFullYear()) * 12 +
    (fimDoAno.getUTCMonth() - dataAdmissao.getUTCMonth()) +
    1;
  return Math.max(1, Math.min(12, mesesNoAno));
}

/** Como o banco devolve um `@db.Date`: meia-noite UTC. */
const data = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// ============================================================================
//  BUG 1: /processar filtrava por desligamento e NUNCA por admissao.
// ============================================================================

test("funcionario admitido depois da competencia nao entra na folha", () => {
  const { inicio, fim } = intervaloDaCompetencia('2026-09');
  // Admitido em 10/10, folha de setembro: nao existia na empresa.
  const f = { dataAdmissao: data('2026-10-10'), dataDesligamento: null };
  assert.equal(estaNaCompetencia(f, inicio, fim), false);
});

test("funcionario admitido no primeiro dia do mes entra na folha", () => {
  const { inicio, fim } = intervaloDaCompetencia('2026-09');
  // 01/09 as 00:00 UTC e ANTES do `fim` (01/10): trabalhou o mes inteiro.
  const f = { dataAdmissao: data('2026-09-01'), dataDesligamento: null };
  assert.equal(estaNaCompetencia(f, inicio, fim), true);
});

test("funcionario admitido no ultimo dia do mes entra na folha", () => {
  const { inicio, fim } = intervaloDaCompetencia('2026-09');
  // 30/09 00:00 UTC < 01/10: trabalhou, mesmo sendo o ultimo dia.
  const f = { dataAdmissao: data('2026-09-30'), dataDesligamento: null };
  assert.equal(estaNaCompetencia(f, inicio, fim), true);
});


// ============================================================================
//  O filtro do desligamento mudou de semantica e precisa ficar explicito.
//  Antes: `dataDesligamento < fim` (excluia quem saiu dentro do mes).
//  Agora: `>= inicio` (so sai quem ja estava fora no primeiro dia).
// ============================================================================

test("desligado antes do mes nao entra na folha", () => {
  const { inicio, fim } = intervaloDaCompetencia('2026-09');
  const f = { dataAdmissao: data('2020-01-01'), dataDesligamento: data('2026-08-20') };
  assert.equal(estaNaCompetencia(f, inicio, fim), false);
});

test("desligado dentro do mes ainda recebe a folha", () => {
  const { inicio, fim } = intervaloDaCompetencia('2026-09');
  // Saiu em 15/09: trabalhou parte do mes, com direito ao proporcional.
  const f = { dataAdmissao: data('2020-01-01'), dataDesligamento: data('2026-09-15') };
  assert.equal(estaNaCompetencia(f, inicio, fim), true);
});

test("desligado no primeiro dia do mes ainda entra", () => {
  const { inicio, fim } = intervaloDaCompetencia('2026-09');
  const f = { dataAdmissao: data('2020-01-01'), dataDesligamento: data('2026-09-01') };
  assert.equal(estaNaCompetencia(f, inicio, fim), true);
});

test("competencia muda o resultado: mesmo desligamento, meses diferentes", () => {
  // Saiu em 15/09. Em setembro ele estava na empresa e ganha folha; em outubro,
  // ja nao estava no primeiro dia e nao entra. E o que prova que a regra olha
  // para a competencia, e nao apenas para o status do cadastro.
  const f = { dataAdmissao: data('2020-01-01'), dataDesligamento: data('2026-09-15') };
  const setembro = intervaloDaCompetencia('2026-09');
  const outubro = intervaloDaCompetencia('2026-10');
  assert.equal(estaNaCompetencia(f, setembro.inicio, setembro.fim), true);
  assert.equal(estaNaCompetencia(f, outubro.inicio, outubro.fim), false);
});

// ============================================================================
//  BUG 4: 13o usava getFullYear()/getMonth() (fuso local) sobre datas UTC.
// ============================================================================

test("13o: janeiro conta 12 meses, e nao 13", () => {
  // Com os getters LOCAIS, em UTC-3, 01/01/2026T00:00Z leria ano 2025 e a
  // conta daria 13. O clamp mascarava; a conta correta ja nasce assim.
  assert.equal(mesesDe13o(data('2026-01-01'), new Date(Date.UTC(2026, 11, 31))), 12);
});

test("13o: admissao no meio do ano conta proporcional", () => {
  const fim = new Date(Date.UTC(2026, 11, 31));
  assert.equal(mesesDe13o(data('2026-06-15'), fim), 7); // jun-dez
  assert.equal(mesesDe13o(data('2026-02-01'), fim), 11);
  assert.equal(mesesDe13o(data('2026-12-01'), fim), 1);
});

test("13o: admitido em ano anterior tem 12 meses", () => {
  const fim = new Date(Date.UTC(2026, 11, 31));
  for (const iso of ['2020-01-01', '2023-01-01', '2025-01-01', '2025-12-31']) {
    assert.equal(mesesDe13o(data(iso), fim), 12, `falhou para ${iso}`);
  }
});

test("13o: admissao no dia 1o nunca produz menos de 1 nem mais de 12", () => {
  // Trava o regresso em ambos os extremos da regra.
  for (let ano = 2020; ano <= 2030; ano++) {
    const meses = mesesDe13o(data(`${ano}-01-01`), new Date(Date.UTC(ano, 11, 31)));
    assert.ok(meses >= 1 && meses <= 12, `ano ${ano} produziu ${meses}`);
  }
});

test("13o: a contagem nunca diminui conforme o ano avanca", () => {
  const adm = data('2020-03-10');
  let anterior = 0;
  for (let ano = 2020; ano <= 2030; ano++) {
    const meses = mesesDe13o(adm, new Date(Date.UTC(ano, 11, 31)));
    assert.ok(meses >= anterior, `13o de ${ano} (${meses}) menor que o de antes (${anterior})`);
    anterior = meses;
  }
});
