/**
 * Folha de Pagamento \u2014 motor de c\u00e1lculo (FONTE \u00daNICA).
 *
 * POR QUE ESTE ARQUIVO
 * -------------------
 * O frontend n\u00e3o tem f\u00f3rmula. A tela pede o c\u00e1lculo, o servidor responde, e o
 * mesmo valor \u00e9 gravado no banco, impresso no PDF e exibido no KPI. Sem c\u00f3pia de
 * regra, n\u00e3o existe o tipo de diverg\u00eancia em que a tela mostra R$ X e o banco
 * guarda R$ Y \u2014 que foi exatamente o bug das verbas de rescis\u00e3o.
 *
 * O QUE \u00c9 CALCULADO E COM QUE DADO
 * --------------------------------
 *   \u2022 sal\u00e1rio-base ....... `Funcionario.salario` (cadastro)
 *   \u2022 horas extras ......... `Ponto.horaExtraMinutos` (batidas reais)
 *   \u2022 adicional noturno .... `Ponto.bancoHoras` quando h\u00e1 marcador de noturno; sem
 *                              o dado, a rubrica \u00e9 OMITIDA (n\u00e3o estimada)
 *   \u2022 INSS / IRRF .......... tabela progressiva real (ver tabelas abaixo)
 *   \u2022 vale-transporte ...... percentual LEGAL fixo em lei (6%), sobre sal\u00e1rio
 *
 * O QUE N\u00c3O \u00c9 CALCULADO \u2014 E POR QU\u00ca
 * ---------------------------------------
 *   \u2022 FGTS e multa: dependem do SALDO DEPOSITADO do funcion\u00e1rio. N\u00e3o existe tabela de
 *     dep\u00f3sitos no schema. Aplicar 8% seria numero inventado em documento
 *     trabalhista. Fica `null` e a tela diz "n\u00e3o apur\u00e1vel".
 *   \u2022 sal\u00e1rio-fam\u00edlia, adicional de periculosidade etc.: dependem de
 *     conven\u00e7\u00e3o coletiva ou de contrato espec\u00edfico, que o NEXUS n\u00e3o registra. Se
 *     o usu\u00e1rio cadastrar a rubrica manualmente, ela entra \u2014 o sistema n\u00e3o inventa.
 */

export type Tipo = 'PROVENTO' | 'DESCONTO';

export interface FuncionarioCalculo {
  id: string;
  nome: string;
  matricula: string | null;
  salario: number | null;
  dataAdmissao: Date | null;
  dataDesligamento: Date | null;
  /**
   * Beneficios contratados. VA e VR sao independentes, e o padrao e NAO
   * receber: um funcionario sem informacao e tratado como sem beneficio,
   * porque inventar credito em folha e pior do que nao pagar um beneficio
   * que nao foi cadastrado. `false`/`0` explicitos significam a mesma coisa.
   */
  valeAlimentacao?: boolean;
  valorValeAlimentacao?: number;
  valeRefeicao?: boolean;
  valorValeRefeicao?: number;
}

export interface ApuracaoPonto {
  /** Minutos de hora extra no m\u00eas. */
  minutosExtra: number;
  /** Minutos de banco de horas. */
  minutosBanco: number;
  /** Dias de falta. */
  diasFalta: number;
  /** Minutos de atraso somados. */
  minutosAtraso: number;
  /**
   * Dias uteis (segunda a sexta) da competencia: divisor do salario
   * proporcional da falta.
   *
   * Vem da rota porque e ela que conhece a competencia e tem o calendario;
   * o motor so aplica a regra. Zero significa "nao se sabe": nenhuma falta e
   * descontada, que e a direcao segura -- sem o divisor nao ha calculo, e um
   * desconto sem lastro e pior do que nao descontar.
   */
  diasUteis: number;
  /** true quando a compet\u00eancia tem batidas reais. */
  temDados: boolean;
}

export interface EntradaCalculo {
  funcionario: FuncionarioCalculo;
  ponto: ApuracaoPonto;
  /** Descontos/adiantamentos lan\u00e7ados \u00e0 m\u00e3o, somados depois dos autom\u00e1ticos. */
  manuaisDesconto?: number;
  manuaisProvento?: number;
  /** Valor de refer\u00eancia para o c\u00e1lculo do 13\u00ba (meses de direito). */
}

export interface LancamentoCalculado {
  codigo: string;
  descricao: string;
  tipo: Tipo;
  valor: number;
  referencia: number | null;
  origem: 'AUTOMATICO' | 'PONTO' | 'MANUAL';
  observacoes: string | null;
}

export interface ResultadoFolha {
  lancamentos: LancamentoCalculado[];
  totalProventos: number;
  totalDescontos: number;
  liquido: number;
  /** Saldo de FGTS: sempre null at\u00e9 existir tabela de dep\u00f3sitos. */
  fgts: null;
  fgtsApurado: false;
  /** O que falta para o FGTS virar n\u00famero, para a interface mostrar. */
  fgtsPendente: string;
  /** Informa\u00e7\u00f5es do ponto que compuseram a apura\u00e7\u00e3o (ou a falta delas). */
  pontoUtilizado: boolean;
}

const arred = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

/** Valor/hora e valor/minuto a partir do sal\u00e1rio mensal. CLT: 12 mensalidades. */
function valorMinuto(salario: number): number {
  if (salario <= 0) return 0;
  // Sal\u00e1rio-hora = mensal / 12 / 44h = mensal / 5280 minutos (jornada semanal
  // de 44h, conven\u00e3o CLT art. 7\u00aa). Usamos minutos porque o ponto grava minutos.
  return salario / 5280;
}

// ===========================================================================
//  Tabela progressiva do INSS (employee) \u2014 tabela oficial vigente.
//  Fonte: tabela de 2024 em diante (INSS). Os percentuais s\u00e3o de LEI, n\u00e3o
//  par\u00e2metro: us\u00e1-los n\u00e3o \u00e9 "simplificar", \u00e9 cumprir a tabela.
// ===========================================================================
const TABELA_INSS = [
  // Tabela vigente em 2026. `teto` e CUMULATIVO: cada aliquota incide sobre a
  // parcela entre o teto anterior e este.
  { teto: 1621.00, aliquota: 0.075 },
  { teto: 2902.84, aliquota: 0.09 },
  { teto: 4354.27, aliquota: 0.12 },
  { teto: 8475.55, aliquota: 0.14 },
];

/**
 * INSS do empregado sobre a base de cálculo.
 *
 * Progressivo por faixa: cada trecho paga a alíquota do seu trecho. ACIMA do
 * teto (8.475,55) o segurado empregado NAO contribui sobre o excedente — teto
 * productivas, e o desconto para de crescer. Aplicar 8% ou 14% sobre o
 * excedente é erro comum de folha feita no Excel.
 */
export function calcularInss(base: number): number {
  if (base <= 0) return 0;
  let piso = 0;
  let total = 0;
  for (const faixa of TABELA_INSS) {
    if (base <= piso) break;
    const parcela = Math.min(base, faixa.teto) - piso;
    total += parcela * faixa.aliquota;
    piso = faixa.teto;
  }
  // Acima do teto:_funcional_ não há desconto do empregado.
  return arred(total);
}

// ===========================================================================
//  IRRF \u2014 tabela progressiva com parcela a deduzir (Lei 9.250/95, art. 1\u00ba).
// ===========================================================================
const TABELA_IRRF = [
  // Tabela vigente em 2026. Aqui `teto` é o LIMITE da faixa (não cumulativo como
  // no INSS): a base escolhe UMA faixa, e aplica-se aliquota - parcela.
  { teto: 2428.80, aliquota: 0.00, parcela: 0 },
  { teto: 2826.65, aliquota: 0.075, parcela: 182.16 },
  { teto: 3751.05, aliquota: 0.15, parcela: 394.16 },
  { teto: 4664.68, aliquota: 0.225, parcela: 675.49 },
  { teto: Infinity, aliquota: 0.275, parcela: 908.73 },
];

/**
 * IRRF sobre a base líquida de impostos (total de proventos menos descontos
 * legais). A base já vem calculada pelo servidor; aqui só se aplica a tabela.
 *
 * RESULTADO MONOTÔNICO: a função escolhe a faixa PELA BASE e cai no `return`,
 * então nunca acumula duas faixas. Esse detalhe é o que garante que o IRRF nunca
 * diminua quando o salário sobe.
 */
export function calcularIrrf(base: number): number {
  if (base <= 0) return 0;
  for (const faixa of TABELA_IRRF) {
    if (base <= faixa.teto) {
      const resultado = base * faixa.aliquota - faixa.parcela;
      return arred(Math.max(0, resultado));
    }
  }
  return 0;
}

/** Vale-transporte: 6% do sal\u00e1rio (Lei 8.019/90, art. 7\u00ba, CLT art. 7\u00b2). */
export const VALE_TRANSPORTE_PCT = 0.06;

/**
 * Apura a folha de UM funcion\u00e1rio.
 *
 * Retorna os lan\u00e7amentos e os totais. O servidor grava o que vem daqui; o
 * frontend exibe o que o servidor devolveu.
 */
export function apurarFolha(e: EntradaCalculo): ResultadoFolha {
  const lancamentos: LancamentoCalculado[] = [];
  const salario = Number(e.funcionario.salario ?? 0);
  const minuto = valorMinuto(salario);
  const ponto = e.ponto;

  // --- 1. Sal\u00e1rio-base: sempre, e sempre o do cadastro ---
  if (salario > 0) {
    lancamentos.push({
      codigo: '001',
      descricao: 'Sal\u00e1rio-base',
      tipo: 'PROVENTO',
      valor: arred(salario),
      referencia: 1,
      origem: 'AUTOMATICO',
      observacoes: null,
    });
  }

  // --- 2. Horas extras: s\u00f3 quando h\u00e1 batida real no m\u00eas ---
  if (ponto.temDados && ponto.minutosExtra > 0) {
    const horas = ponto.minutosExtra / 60;
    lancamentos.push({
      codigo: 'HORA_EXTRA',
      descricao: `Horas extras (${horas.toFixed(1)}h)`,
      tipo: 'PROVENTO',
      valor: arred(ponto.minutosExtra * minuto),
      referencia: arred(horas),
      origem: 'PONTO',
      observacoes: 'Apurado das batidas reais do m\u00f4dulo de ponto.',
    });
  }

  // --- 2b. Desconto por falta: salario proporcional aos dias uteis perdidos ---
  // CLT art. 130: o salario do mes e proporcional aos dias uteis trabalhados.
  // Descontar (diasFalta / diasUteis) * salario, e nao o salario inteiro --
  // a faltas do mes inteiro zera a remuneracao, e nao a torna negativa.
  // Sem `diasUteis` nao ha como calcular a fracao, entao nada e descontado.
  if (ponto.temDados && ponto.diasFalta > 0 && ponto.diasUteis > 0) {
    const faltasAjustadas = Math.min(ponto.diasFalta, ponto.diasUteis);
    const valor = arred(salario * (faltasAjustadas / ponto.diasUteis));
    if (valor > 0) {
      lancamentos.push({
        codigo: 'FALTA',
        descricao: `Faltas (${faltasAjustadas} de ${ponto.diasUteis} dias uteis)`,
        tipo: 'DESCONTO',
        valor,
        referencia: faltasAjustadas,
        origem: 'PONTO',
        observacoes:
          'Proporcional aos dias uteis da competencia (CLT art. 130), sobre o salario-base.',
      });
    }
  }

  // --- 2c. Desconto por atraso: minutos de atraso apurados nas batidas ---
  // Pelas mesmas razoes da hora extra, so existe quando ha batida real: sem
  // registro de ponto nao ha atraso apurado, e nao se pode descontar por ele.
  if (ponto.temDados && ponto.minutosAtraso > 0) {
    const horas = ponto.minutosAtraso / 60;
    const valor = arred(ponto.minutosAtraso * minuto);
    if (valor > 0) {
      lancamentos.push({
        codigo: 'ATRASO',
        descricao: `Atrasos (${horas.toFixed(1)}h)`,
        tipo: 'DESCONTO',
        valor,
        referencia: arred(horas),
        origem: 'PONTO',
        observacoes: 'Minutos de atraso apurados das batidas reais do modulo de ponto.',
      });
    }
  }


  // --- 3. Adicional noturno: depende de marcador de per\u00edodo noturno no ponto ---
  // O NEXUS n\u00e3o tem campo de per\u00edodo noturno em `Ponto`; `bancoHoras` \u00e9 de
  // compensa\u00e7\u00e3o de jornada, n\u00e3o de trabalho noturno. Sem o dado certo, a
  // rubrica \u00e9 OMITIDA em vez de estimada.
  const ADICIONAL_NOTURNO_DISPONIVEL = false;
  if (ADICIONAL_NOTURNO_DISPONIVEL && ponto.minutosBanco > 0) {
    lancamentos.push({
      codigo: 'ADIC_NOTURNO',
      descricao: 'Adicional noturno',
      tipo: 'PROVENTO',
      valor: arred(ponto.minutosBanco * minuto * 0.2),
      referencia: arred(ponto.minutosBanco / 60),
      origem: 'PONTO',
      observacoes: null,
    });
  }

  // --- 4. Proventos manuais (comiss\u00f5es, outros) ---
  if (e.manuaisProvento && e.manuaisProvento > 0) {
    lancamentos.push({
      codigo: 'OUTRO_PROVENTO',
      descricao: 'Outros proventos lan\u00e7ados',
      tipo: 'PROVENTO',
      valor: arred(e.manuaisProvento),
      referencia: null,
      origem: 'MANUAL',
      observacoes: 'Somat\u00e1ria dos lan\u00e7amentos manuais de provento.',
    });
  }

  // --- 4b. Beneficios contratados (VA e VR), como PROVENTO ---
  //
  // SAO PROVENTOS, e nao desconto: o empresa paga o beneficio e o valor vai
  // para o empregado. Por isso entra ANTES do total, e o INSS incide sobre
  // ele — o que e o tratamento correto, ja que o valor integra a remuneracao.
  //
  // Cada beneficio so entra se o seu proprio toggle estiver ligado E o valor
  // for maior que zero. Toggle desligado significa "nao recebe", mesmo que
  // sobre um valor antigo, por isso a condicao nao e apenas "valor > 0".
  //
  // Beneficio com valor zero e TAO valido quanto beneficio sem toggle: quem
  // recebe R$ 0 nao recebe nada, e gerar lancamento de R$ 0 poluiria a folha
  // com rubrica que nao movimenta dinheiro.
  const beneficios = e.funcionario;
  const valorVA = Number(beneficios.valorValeAlimentacao ?? 0);
  if (beneficios.valeAlimentacao === true && valorVA > 0) {
    lancamentos.push({
      codigo: 'VALE_ALIMENTACAO',
      descricao: 'Vale-alimentacao',
      tipo: 'PROVENTO',
      valor: arred(valorVA),
      referencia: null,
      origem: 'AUTOMATICO',
      observacoes: 'Beneficio contratado no cadastro do funcionario.',
    });
  }
  const valorVR = Number(beneficios.valorValeRefeicao ?? 0);
  if (beneficios.valeRefeicao === true && valorVR > 0) {
    lancamentos.push({
      codigo: 'VALE_REFEICAO',
      descricao: 'Vale-refeicao',
      tipo: 'PROVENTO',
      valor: arred(valorVR),
      referencia: null,
      origem: 'AUTOMATICO',
      observacoes: 'Beneficio contratado no cadastro do funcionario.',
    });
  }

  const totalProventos = arred(
    lancamentos.filter((l) => l.tipo === 'PROVENTO').reduce((s, l) => s + l.valor, 0),
  );

  // --- 5. INSS sobre a base real (total de proventos) ---
  const inss = calcularInss(totalProventos);
  if (inss > 0) {
    lancamentos.push({
      codigo: 'INSS',
      descricao: 'INSS (tabela progressiva)',
      tipo: 'DESCONTO',
      valor: inss,
      referencia: null,
      origem: 'AUTOMATICO',
      observacoes: 'Tabela progressiva oficial, aplicada sobre os proventos da compet\u00eancia.',
    });
  }

  // --- 6. Vale-transporte: 6% do sal\u00e1rio-base (base legal \u00e9 o sal\u00e1rio) ---
  const vt = arred(salario * VALE_TRANSPORTE_PCT);
  if (vt > 0) {
    lancamentos.push({
      codigo: 'VALE_TRANSPORTE',
      descricao: 'Vale-transporte (6%)',
      tipo: 'DESCONTO',
      valor: vt,
      referencia: 6,
      origem: 'AUTOMATICO',
      observacoes: 'Percentual fixo por lei sobre o sal\u00e1rio-base.',
    });
  }

  // --- 7. IRRF sobre a base l\u00edquida de impostos ---
  const baseIrrf = arred(totalProventos - inss);
  const irrf = calcularIrrf(baseIrrf);
  if (irrf > 0) {
    lancamentos.push({
      codigo: 'IRRF',
      descricao: 'IRRF (tabela progressiva)',
      tipo: 'DESCONTO',
      valor: irrf,
      referencia: null,
      origem: 'AUTOMATICO',
      observacoes: 'Base: total de proventos menos INSS.',
    });
  }

  // --- 8. Descontos manuais (adiantamentos, pensoes) --- ---
  if (e.manuaisDesconto && e.manuaisDesconto > 0) {
    lancamentos.push({
      codigo: 'OUTRO_DESCONTO',
      descricao: 'Outros descontos lan\u00e7ados',
      tipo: 'DESCONTO',
      valor: arred(e.manuaisDesconto),
      referencia: null,
      origem: 'MANUAL',
      observacoes: 'Somat\u00e1ria dos lan\u00e7amentos manuais de desconto.',
    });
  }

  let totalDescontos = arred(
    lancamentos.filter((l) => l.tipo === 'DESCONTO').reduce((s, l) => s + l.valor, 0),
  );

  // --- 9. Teto do desconto por ponto: o liquido nunca fica negativo ---
  // Falta de mes inteiro zera o salario, mas INSS, VT e IRRF sao calculados
  // sobre os proventos e continuariam cobrando de um salario nao auferido --
  // a folha mostraria um liquido negativo, que nenhum pagamento liquidaria e que
  // esconderia a causa. Aqui o desconto do ponto e limitado ao que ainda existe
  // para descontar, do mais flexivel para o mais rigido (atraso antes da falta),
  // e o lancamento fica marcado para o RH ver que houve limite.
  let excedente = arred(totalDescontos - totalProventos);
  if (excedente > 0) {
    const doPonto = lancamentos
      .filter((l) => l.origem === 'PONTO' && l.tipo === 'DESCONTO')
      .sort((a, b) => a.valor - b.valor);
    for (const l of doPonto) {
      if (excedente <= 0) break;
      const reducao = Math.min(l.valor, excedente);
      l.valor = arred(l.valor - reducao);
      l.referencia = null;
      l.observacoes =
        (l.observacoes ? l.observacoes + ' ' : '') + 'Limitado ao saldo da compet\u00eancia: '
        + 'os demais descontos (INSS, VT, IRRF) incidem sobre o salary cheio.';
      excedente = arred(excedente - reducao);
    }
    totalDescontos = arred(
      lancamentos.filter((l) => l.tipo === 'DESCONTO').reduce((s, l) => s + l.valor, 0),
    );
  }

  return {
    lancamentos,
    totalProventos,
    totalDescontos,
    liquido: arred(totalProventos - totalDescontos),
    fgts: null,
    fgtsApurado: false,
    fgtsPendente:
      'FGTS e multa dependem do saldo depositado do funcion\u00e1rio, que o NEXUS ainda n\u00e3o registra. '
      + 'Ser\u00e1 apurado quando houver conv\u00eancio com os dep\u00f3sitos.',
    pontoUtilizado: ponto.temDados,
  };
}
