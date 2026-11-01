/**
 * Fechamento de expediente — apuração de FALTA (regra do negócio).
 *
 * A falta NÃO pode ser marcada no momento da marcação: bater ponto registra um
 * fato, e "a pessoa não apareceu" só é verdade depois que o dia terminou. Por
 * isso o campo `Ponto.falta` fica `false` enquanto o dia corre (ver
 * `/ponto/manual`) e é este serviço que o vira `true` ao fechar o expediente.
 *
 * REGRA
 * -----
 * Faltou quem, em dia ÚTIL (segunda a sexta), com vínculo no período, não
 * registrou NENHUMA batida. Sem batida nenhuma não existe linha em `Ponto`, e
 * é essa ausência de registro que se apura aqui.
 *
 * O que NÃO é falta, e por quê:
 * - Dia não útil: sábado não gera falta, ninguém é escalado por padrao.
 * - Antes da admissão / depois do desligamento: não havia vínculo.
 * - Dia ainda em curso: enquanto o expediente não fecha, a pessoa pode estar
 *   trabalhando. Fechar o mesmo dia às 18h01 zeraria quem registrou a entrada
 *   às 18h05.
 * - Jornada incompleta (entrada sem saída): é divergência de registro, não
 *   ausência. Vira `inconsistencia`, e o RH decide.
 *
 * IDEMPOTÊNCIA
 * ------------
 * Rodar duas vezes no mesmo dia não duplica nem duplica desconto: a rotina só
 * atua sobre dias úteis ANTERIORES a hoje, e a folha só lê `falta` de linhas
 * existentes. A linha de falta é criada uma única vez (upsert por
 * funcionarioId+data, a chave única do modelo).
 */
import { prisma } from '../../lib/prisma.js';
import { dataNoFuso, normalizarFuso } from '../../lib/fuso.js';

/** `YYYY-MM-DD` → `Date` de meia-noite UTC (como `Ponto.data`, que é `@db.Date`). */
export function diaDoPonto(data: string): Date {
  return new Date(`${data}T00:00:00.000Z`);
}

/** Avança `n` dias a partir de uma data `YYYY-MM-DD`, sem passar por `Date` local. */
export function somaDias(data: string, n: number): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + n));
  return d.toISOString().slice(0, 10);
}

/** Dia da semana de uma data `YYYY-MM-DD`: 0 domingo, 6 sábado. */
export function diaDaSemana(data: string): number {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

export interface ResumoFechamento {
  /** Linhas de ponto criadas com `falta = true`. */
  faltasMarcadas: number;
  /** Funcionários considerados no período. */
  funcionarios: number;
  /** Dias úteis apurados no período. */
  diasUteis: number;
  /** Primeiro dia apurado, inclusive. */
  de: string;
  /** Último dia apurado, inclusive. */
  ate: string;
  /**
   * Dia de referência da chamada (o "hoje" do fuso da empresa).
   *
   * Fica separado de `ate` porque são coisas diferentes: `ate` é o último dia
   * apurado, que é o dia anterior quando a chamada é a do dia, e o dia que o
   * RH pediu quando ele pediu um período antigo. Sem separar, a resposta dizia
   * que apurou até 27/09 num pedido de julho.
   */
  referencia: string;
}

/** Uma linha de ponto já existente, no formato enxuto que a apuração precisa. */
export interface BatidaExistente {
  funcionarioId: string;
  data: Date;
}

export interface FuncionarioApurado {
  id: string;
  dataAdmissao: Date | null;
  dataDesligamento: Date | null;
}

/**
 * QUEM FALTOU — a regra, isolada do banco.
 *
 * Devolve as datas `YYYY-MM-DD` que devem virar falta para um funcionário.
 * Dia útil, com vínculo no período e sem nenhuma batida. Cada regra de exclusão
 * está comentada porque qualquer uma delas errada transforma um absences em
 * desconto na folha.
 */
export function diasDeFalta(
  funcionario: FuncionarioApurado,
  batidas: Set<string>,
  primeiro: string,
  ultimo: string,
): string[] {
  const datas: string[] = [];
  for (let data = primeiro; data <= ultimo; data = somaDias(data, 1)) {
    const dow = diaDaSemana(data);
    // Sábado e domingo não são dia útil: marcar falta neles geraria desconto
    // para quem não é escalado no fim de semana.
    if (dow === 0 || dow === 6) continue;

    // Antes da admissão não havia vínculo com a empresa.
    const admissao = funcionario.dataAdmissao ? dataNoFuso(funcionario.dataAdmissao, 'UTC') : null;
    if (admissao && admissao > data) continue;

    // No dia do desligamento a pessoa ainda é da empresa, mas NÃO se apura falta
    // nele: cobrar o functoolsário no último dia de vínculo é a acusação mais
    // contestável possível — ele já saiu, não registrou ponto e não tem como
    // recorrer. Entre acusar e não acusar, a folha não acusa. Por isso `<=`.
    const desligamento = funcionario.dataDesligamento ? dataNoFuso(funcionario.dataDesligamento, 'UTC') : null;
    if (desligamento && desligamento <= data) continue;

    // Compareceu: existe registro no dia, mesmo incompleto. Jornada sem saída é
    // divergência de registro (`inconsistencia`), não ausência de trabalho.
    if (batidas.has(`${funcionario.id}|${data}`)) continue;

    datas.push(data);
  }
  return datas;
}

/**
 * A data mais antiga de vínculo da empresa, para a apuração de um período longo.
 *
 * Fechar um trimestre inteiro não deveria falhar por causa de uma janela fixa:
 * a apuração começa onde a empresa começou a ter gente, e a regra de
 * `diasDeFalta` já descarta os dias anteriores a cada admissão.
 */
async function menorDataDeVinculo(empresaId: string, ate: string): Promise<string> {
  const maisAntigo = await prisma.funcionario.findFirst({
    where: { empresaId, dataAdmissao: { not: null, lte: diaDoPonto(ate) } },
    orderBy: { dataAdmissao: 'asc' },
    select: { dataAdmissao: true },
  });
  if (!maisAntigo?.dataAdmissao) return somaDias(ate, -90);
  const admissao = dataNoFuso(maisAntigo.dataAdmissao, 'UTC');
  // Não apura antes de dois anos atrás: mesmo que o cadastro seja antigo, um
  // volume absurdo de linhas atrasaria o fechamento sem nenhum ganho prático.
  return admissao < somaDias(ate, -730) ? somaDias(ate, -730) : admissao;
}

/**
 * Fecha o expediente de um dia e marca as faltas.
 *
 * @param empresaId Empresa dono do ponto.
 * @param refData   Data de referência (`YYYY-MM-DD`): o próprio dia da chamada,
 *                  usado como referência de fuso. O expediente do dia ainda
 *                  NÃO é fechado aqui — por isso a apuração vai até o dia
 *                  anterior.
 * @param ate      Apura o período todo até esta data, em vez da janela padrão
 *                  de 90 dias. É o que o RH usa para fechar um mês antigo que
 *                  ficou de fora; sem ele, a apuração é só a janela recente.
 */
export async function fecharExpediente(
  empresaId: string,
  refData?: string,
  ate?: string,
): Promise<ResumoFechamento> {
  const empresa = await prisma.empresa.findFirst({
    where: { id: empresaId },
    select: { fusoHorario: true },
  });
  const fuso = normalizarFuso(empresa?.fusoHorario);
  const hoje = refData ?? dataNoFuso(new Date(), fuso);

  // O expediente de HOJE nunca é fechado aqui: fechar o mesmo dia às 18h01
  // zeraria quem registrou a entrada às 18h05. Por isso o fim é sempre o dia
  // anterior. Sem `ate` a apuração cobre a janela padrão de 90 dias; com ele,
  // `ate` é o ÚLTIMO dia apurado — é o que permite fechar só o mês antigo que
  // ficou de fora, sem varrer o que já está em dia.
  const ultimo = ate ?? somaDias(hoje, -1);
  if (ultimo >= hoje) {
    throw new Error('O fechamento de expediente nao pode apurar o dia de hoje: o expediente ainda nao fechou.');
  }
  const primeiro = ate
    ? await menorDataDeVinculo(empresaId, ate)
    : somaDias(hoje, -90);

  const funcionarios = await prisma.funcionario.findMany({
    where: { empresaId, status: { in: ['ATIVO', 'FERIAS', 'AFASTADO'] } },
    select: { id: true, dataAdmissao: true, dataDesligamento: true },
  });

  const inicioUtc = diaDoPonto(primeiro);
  const fimUtc = diaDoPonto(somaDias(ultimo, 1)); // exclusivo

  const registros = await prisma.ponto.findMany({
    where: {
      empresaId,
      data: { gte: inicioUtc, lt: fimUtc },
    },
    select: { funcionarioId: true, data: true },
  });
  const comBatida = new Set(registros.map((r) => `${r.funcionarioId}|${dataNoFuso(r.data, 'UTC')}`));

  const aCriar: { empresaId: string; funcionarioId: string; data: Date; falta: boolean; inconsistencia: string | null; origem: 'PONTO' }[] = [];
  let diasUteis = 0;

  for (let data = primeiro; data <= ultimo; data = somaDias(data, 1)) {
    const dow = diaDaSemana(data);
    if (dow === 0 || dow === 6) continue; // sábado e domingo: não são dia útil
    diasUteis += 1;
  }

  for (const f of funcionarios) {
    for (const data of diasDeFalta(f, comBatida, primeiro, ultimo)) {
      aCriar.push({
        empresaId,
        funcionarioId: f.id,
        data: diaDoPonto(data),
        falta: true,
        inconsistencia: 'Falta apurada no fechamento do expediente: nenhuma batida registrada no dia.',
        origem: 'PONTO',
      });
    }
  }

  if (aCriar.length > 0) {
    // `skipDuplicates` protege contra dois fechamentos simultâneos (a chave
    // única funcionarioId+data transformaria o segundo em erro).
    await prisma.ponto.createMany({ data: aCriar, skipDuplicates: true });
  }

  return {
    faltasMarcadas: aCriar.length,
    funcionarios: funcionarios.length,
    diasUteis,
    de: primeiro,
    ate: ultimo,
    referencia: hoje,
  };
}