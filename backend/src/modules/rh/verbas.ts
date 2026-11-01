/* ==========================================================================
 * Cálculo das verbas rescisórias (fonte única).
 *
 * Isento em módulo próprio para poder ser importado pelos testes sem subir
 * o servidor Fastify inteiro, e para deixar explícito que é a única fonte do
 * cálculo: o cliente não tem fórmula.
 * ========================================================================== */
/**
 * Verbas rescisórias — cálculo do que é possível apurar com os dados REAIS que
 * o NEXUS possui hoje. Este arquivo é a FONTE ÚNICA do cálculo.
 *
 * POR QUE ESTE MÓDULO EXISTE
 * -------------------------
 * Havia duas implementações divergentes: uma no servidor (13º = salário cheio,
 * férias = salário/3, aviso = 0.4 do salário) e outra no cliente (13º = 0.58,
 * férias = 0.85, aviso = salário inteiro). Para salário R$ 3.000 a tela
 * mostrava R$ 10.340 e o banco gravava R$ 5.296 no mesmo desligamento. O
 * cliente não calcula mais nada: pede o valor ao servidor.
 *
 * O QUE É CALCULADO (só o que os dados permitem)
 * ----------------------------------------------
 *   • 13º salário proporcional — fração do ano até a data-base
 *   • férias vencidas — anos completos de serviço (CLS art. 130)
 *   • férias proporcionais — meses do período aquisitivo corrente
 *   • adicional de 1/3 constitucional sobre as férias
 *   • saldo de salário — salário ÷ 30 × dias
 *   • aviso prévio — 7 dias (contrato até 45 dias) ou 30 dias (acima),
 *     conforme art. 487 CLT; "trabalhado" e "dispensado" não pagam valor
 *
 * O QUE NÃO É CALCULADO — E POR QUÊ
 * ---------------------------------
 *   • FGTS (8%) e multa rescisória (40%): dependem do SALDO DEPOSITADO do
 *     FGTS do funcionário. Não existe tabela de depósitos no schema
 *     (`DepositoFGTS` não foi criada), então qualquer percentual aqui seria
 *     INVENTADO — e verbas inventadas em termo de rescisão é o tipo de erro
 *     que não pode acontecer. Ficam zerados e identificados como "não apurado"
 *     no termo.
 *
 *     Ponto de extensão: quando existir a tabela de depósitos, o saldo real
 *     entra em `montarVerbas` (`saldoFgts`) e a multa passa a ser
 *     `saldoFgts × 0.4` nos casos do art. 477 §8º. Nada mais no módulo muda.
 */

/** Situações em que a multa rescisória de 40% é devida (art. 477 §8º CLT). */
const MULTA_DEVIDA: Record<string, boolean> = {
'sem-justa-causa': true,
'justa-causa': false, // dispensa por justa causa não gera multa
'pedido': true, // pedido do empregado: devida se contrato < 1 ano (ver `devePagarMulta`)
'acordo': true, // acordo entre as partes
};

/**
 * Rótulo e enquadramento legal de cada tipo de desligamento.
 *
 * Ficam no SERVIDOR de propósito: antes a tela mandava `tipoLabel` e `art` no
 * corpo da requisição e o banco gravava o que o navegador enviou — o cliente
 * podia escrever qualquer coisa no termo. Agora o backend decide a partir do
 * `tipo` e o cliente não influence o enquadramento legal.
 */
export const TIPOS_DESLIGAMENTO: Record<string, { label: string; art: string }> = {
'sem-justa-causa': { label: 'Sem justa causa', art: 'ART. 487 CLT' },
'justa-causa': { label: 'Justa causa', art: 'ART. 482 CLT' },
'pedido': { label: 'Pedido de demissão', art: 'ART. 487 §2º CLT' },
'acordo': { label: 'Acordo / Consolidação', art: 'ART. 428 CLT' },
};

export type TipoAviso = 'trabalhado' | 'indenizado' | 'dispensado';

export interface EntradaVerbas {
salario: number;
dataAdmissao: Date | null;
/** Data-base do desligamento. */
dataDesligamento: Date;
tipo: string;
aviso: TipoAviso;
/** Dias de saldo informado pelo RH (salário ÷ 30 × dias). */
saldoDias: number;
}

export interface Verbas {
/** Meses considerados no 13º (informativo no termo). */
meses13: number;
decimoTerceiro: number;
/** Anos completos de serviço (CLS art. 130). */
anosCompletos: number;
feriasVencidas: number;
/** Meses no período aquisitivo corrente (informativo). */
mesesFeriasProporcionais: number;
feriasProporcionais: number;
tercoConstitucional: number;
/** VALOR em reais do saldo de dias (não a contagem de dias). */
saldoSalario: number;
avisoPrevio: number;
/** Dias de aviso gerados pelo tipo (informativo no termo). */
diasAviso: number;
total: number;
// Reservados para o futuro saldo real de FGTS.
saldoFgts: null;
multaFgts: null;
fgtsApurado: false;
}

const arred = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

/** Meses completos entre duas datas (o mês só conta depois do aniversário). */
export function mesesEntre(de: Date, ate: Date): number {
if (ate <= de) return 0;
let meses = (ate.getFullYear() - de.getFullYear()) * 12 + (ate.getMonth() - de.getMonth());
if (ate.getDate() < de.getDate()) meses -= 1;
return Math.max(0, meses);
}

/** Anos completos de serviço na data-base. */
export function anosCompletos(admissao: Date | null, desligamento: Date): number {
if (!admissao) return 0;
let anos = desligamento.getFullYear() - admissao.getFullYear();
const aniversario =
  admissao.getMonth() > desligamento.getMonth() ||
  (admissao.getMonth() === desligamento.getMonth() && admissao.getDate() > desligamento.getDate());
if (aniversario) anos -= 1;
return Math.max(0, anos);
}

/** Dias totais de contrato (a CLT usa 45 dias como corte do aviso prévio). */
export function diasDeContrato(admissao: Date | null, desligamento: Date): number {
if (!admissao) return 0;
return Math.max(0, Math.floor((desligamento.getTime() - admissao.getTime()) / 86400000));
}

/**
 * Monta as verbas. `saldoDias` é a ÚNICA entrada em dias vinda do usuário —
 * todo o resto é derivado do salário e das datas reais do cadastro.
 */
/**
 * Meses do último ano de contrato (0 a 12) — a fração que o 13º proporcional usa.
 *
 * O 13º é o período de 12 meses que antecede o desligamento, não "meses completos desde
 * a admissão". Admitido em 01/01 e desligado em 30/09 laborou de janeiro a setembro:
 * são 9 meses, e o 13º vale 9/12 do salário.
 */
/**
 * Meses efetivamente trabalhados entre a admissão e a data-base (1 a 12).
 *
 * É o que o 13º proporcional e as férias proporcionais usam. A diferença para
 * `mesesEntre` (que conta meses COMPLETOS) é que aqui o mês da data-base conta:
 * admitido em 01/01 e desligado em 30/09 laborou de janeiro a setembro = 9 meses,
 * ainda que setembro não esteja completo.
 */
export function mesesTrabalhados(admissao: Date | null, desligamento: Date): number {
  if (!admissao) return 12;
  if (desligamento <= admissao) return 0;
  let meses = (desligamento.getFullYear() - admissao.getFullYear()) * 12
    + (desligamento.getMonth() - admissao.getMonth());
  // O mês da admissão entra como mês trabalhado; os intermediários, sempre.
  meses += 1;
  // Se o dia do desligamento ainda não chegou no dia do anésario de admissão,
  // o último mês está incompleto e não conta.
  if (desligamento.getDate() < admissao.getDate()) meses -= 1;
  return Math.max(0, Math.min(12, meses));
}

export function fracaoDeMesesNoAno(admissao: Date, desligamento: Date): number {
  if (desligamento <= admissao) return 0;
  // Admissão no mesmo ano-calendário: conta do mês da admissão até o atual.
  if (admissao.getFullYear() === desligamento.getFullYear()) {
    return Math.max(0, Math.min(12, desligamento.getMonth() - admissao.getMonth() + 1));
  }
  // Admissão em ano anterior: meses do ano da admissão + meses do ano do desligamento.
  const meses = (12 - admissao.getMonth()) + (desligamento.getMonth() + 1);
  return Math.max(0, Math.min(12, meses));
}

export function montarVerbas(e: EntradaVerbas): Verbas {
const salario = Number(e.salario) || 0;
const admissao = e.dataAdmissao;
const desligamento = e.dataDesligamento;
const diasContrato = diasDeContrato(admissao, desligamento);

  // --- 13º proporcional: FRAÇÃO DO ANO de admissão até a data-base -------
  // O 13º corresponde ao período de 12 meses que antecede o desligamento (ou
  // o início do contrato, se for mais recente). Contar "meses completos" daria
  // o número errado: admitido em 01/01 e desligado em 30/09 laborou de janeiro
  // a setembro, o que dá 9/12 de ano, e não 8/12.
  const meses13 = admissao ? mesesTrabalhados(admissao, desligamento) : 12;
const decimoTerceiro = arred((salario / 12) * meses13);

// --- férias vencidas: 30 dias por ano completo de serviço (art. 130) -----
const anos = anosCompletos(admissao, desligamento);
const feriasVencidas = arred(salario * anos);

// --- férias proporcionais: meses do período aquisitivo corrente ----------
// O período conta 12 meses a partir da admissão; o que sobra é proporcional.
// No máximo 11 meses — o 12º fecha o período e vira férias vencida.
const mesesTotais = admissao ? Math.max(0, mesesEntre(admissao, desligamento)) : 12;
  // Período aquisitivo: 12 meses contados da admissão (CLS art. 130). O 12º
  // mês fecha o período e vira férias VENCIDAS, então aqui entra no máximo 11.
  // Para quem foi admitido em 01/01/2026 e sai em 30/09/2026, o período ainda não
  // fechou (falta outubro): 9 mês proporcional + 0 vencidas.
  // 12 meses fecham o período e viram férias vencidas; o máximo proporcional é 11.
  const mesesFeriasProporcionais = Math.min(11, ((mesesTrabalhados(admissao, desligamento) % 12) + 12) % 12);
const feriasProporcionais = arred((salario / 12) * mesesFeriasProporcionais);

// --- 1/3 constitucional sobre as férias (vencidas + proporcionais) -------
const tercoConstitucional = arred((feriasVencidas + feriasProporcionais) / 3);

// --- saldo de salário: salário ÷ 30 × dias ------------------------------
const saldoSalario = arred((salario / 30) * Math.max(0, Number(e.saldoDias) || 0));

// --- aviso prévio (art. 487 CLT) ----------------------------------------
// Contrato até 45 dias → 7 dias de aviso. Acima → 30 dias. "Trabalhado" e
// "dispensado" não geram valor a pagar, só o "indenizado".
let diasAviso = 0;
let avisoPrevio = 0;
if (e.aviso === 'indenizado') {
  diasAviso = diasContrato > 45 ? 30 : 7;
  avisoPrevio = arred((salario / 30) * diasAviso);
}

const total = arred(
  decimoTerceiro + feriasVencidas + feriasProporcionais + tercoConstitucional + saldoSalario + avisoPrevio,
);

return {
  meses13,
  decimoTerceiro,
  anosCompletos: anos,
  feriasVencidas,
  mesesFeriasProporcionais,
  feriasProporcionais,
  tercoConstitucional,
  saldoSalario,
  avisoPrevio,
  diasAviso,
  total,
  saldoFgts: null,
  multaFgts: null,
  fgtsApurado: false,
};
}

/**
 * Indica se a multa rescisória é devida. Fica separada porque o caso "pedido
 * do empregado" depende do tempo de contrato: só é devida abaixo de 1 ano
 * (art. 477 §8º). Hoje o VALOR é `null` em `montarVerbas` — apurar a multa sem
 * o saldo depositado seria inventar número. Quando existir a tabela de depósitos
 * de FGTS, basta multiplicar este booleano pelo saldo.
 */
export function devePagarMulta(tipo: string, dataAdmissao: Date | null, desligamento: Date): boolean {
if (tipo === 'pedido') return diasDeContrato(dataAdmissao, desligamento) < 365;
return MULTA_DEVIDA[tipo] ?? false;
}



/**
 * Período "YYYY-MM" (padrão: mês corrente) → intervalo [início, fim) e a
 * quantidade de dias úteis já decorridos, que é o denominador honesto de
 * presença/produtividade (não existe indicador de RH sem denominador).
 */
function periodoMensal(mes?: string) {
  const texto = String(mes ?? '');
  const referencia = /^\d{4}-\d{2}$/.test(texto) ? new Date(`${texto}-01T00:00:00`) : new Date();
  const inicio = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
  const fim = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 1);
  const hoje = new Date();
  const limite = fim.getTime() > hoje.getTime() ? hoje : new Date(fim.getTime() - 1);
  let diasUteis = 0;
  for (const d = new Date(inicio); d.getTime() <= limite.getTime(); d.setDate(d.getDate() + 1)) {
    const diaSemana = d.getDay();
    if (diaSemana !== 0 && diaSemana !== 6) diasUteis++;
  }
  return {
    mes: `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}`,
    inicio,
    fim,
    diasUteis,
  };
}

/** Minutos efetivamente trabalhados num registro de ponto (desconta o intervalo). */
function minutosTrabalhados(p: { entrada: Date | null; saidaIntervalo: Date | null; retornoIntervalo: Date | null; saida: Date | null }): number {
  if (!p.entrada || !p.saida) return 0;
  const total = (p.saida.getTime() - p.entrada.getTime()) / 60000;
  const intervalo = p.saidaIntervalo && p.retornoIntervalo
    ? (p.retornoIntervalo.getTime() - p.saidaIntervalo.getTime()) / 60000
    : 0;
  return Math.max(0, Math.round(total - intervalo));
}

/** Jornada base de referência (8h/dia), a mesma premissa de expediente já usada no ponto. */
const JORNADA_BASE_MINUTOS = 8 * 60;
