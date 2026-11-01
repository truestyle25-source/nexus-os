/**
 * Fuso horário — o dia da marcação de ponto.
 *
 * POR QUE ESTE ARQUIVO
 * -------------------
 * `Ponto.data` é `@db.Date`: o Postgres guarda a data pura (2026-09-27) e o
 * Prisma devolve meia-noite UTC. A pergunta "a que dia pertence o instante
 * 2026-09-28T02:30:00Z?" — que em São Paulo é 2026-09-27 23:30, meia-noite e
 * meia depois de fechar o expediente — não tem resposta sem o fuso da empresa.
 *
 * Usar `getDate()`/`getHours()` resolveria com o fuso da MÁQUINA, e em deploy o
 * servidor pode estar em UTC: a batida da noite cairia no dia seguinte e o
 * espelho mostraria um dia que não houve. Foi exatamente o que aconteceu no
 * `/rh/indicadores`, corrigido em outro lugar; a regra é a mesma e mora aqui
 * para não ser rediscovered.
 *
 * `Intl.DateTimeFormat` com `timeZone` faz a conversão respeitando o fuso real
 * — inclusive as regras de horário de verão do país, que um deslocamento fixo
 * (`-03:00`) não acompanha.
 */

/** Fuso usado quando a empresa não tem um configurado. */
export const FUSO_PADRAO = 'America/Sao_Paulo';

/**
 * Valida um nome de fuso.
 *
 * `Intl` lança `RangeError` para um fuso inválido. Deixar o throw vazar
 * derrubaria a marcação de ponto por causa de um dado cadastral — o registro
 * tem de ser gravado, então um fuso ruim cai no padrão.
 */
export function normalizarFuso(fuso?: string | null): string {
  if (!fuso) return FUSO_PADRAO;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO;
  }
}

/**
 * O dia, no fuso da empresa, do instante informado — `YYYY-MM-DD`.
 *
 * `en-CA` é o que devolve `YYYY-MM-DD` (a ordem é a do Canadá, não a nossa);
 * é o truque mais direto para obter a data de um fuso sem montar na mão.
 */
export function dataNoFuso(instante: Date, fuso?: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizarFuso(fuso),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/** Representa YYYY-MM-DD como meia-noite UTC para persistir em uma coluna DATE. */
export function dataOperacionalDate(instante: Date, fuso?: string | null): Date {
  return new Date(`${dataNoFuso(instante, fuso)}T00:00:00.000Z`);
}

/**
 * O instante que corresponde a uma hora local da empresa.
 *
 * É o inverso de `dataNoFuso`: dado `2026-09-27` e `08:00` no fuso da empresa,
 * devolve o `Date` real. Necessário para o cálculo de atraso, que compara a
 * marcação contra um horário expediente — comparar um instante real contra
 * "08:00 montada com `setHours`" mistura fuso e dá diferença errada.
 *
 * Duas-passadas: a primeira monta a hipótese em UTC, a segunda corrige pelo
 * deslocamento real daquele dia. Uma passada só erra quando o fuso não está em
 * UTC; duas passam acertam também nos dias de transição de horário de verão.
 */
export function instanteNaHoraLocal(
  data: string,
  hora: string,
  fuso?: string | null,
): Date {
  const tz = normalizarFuso(fuso);
  const [ano, mes, dia] = data.split('-').map(Number);
  const [h, m] = hora.split(':').map(Number);

  const hipotese = Date.UTC(ano, (mes || 1) - 1, dia, h || 0, m || 0, 0, 0);
  const primeiraPassada = new Date(hipotese);

  // Onde o fuso estava às 12h00 UTC daquele dia: a diferença para 00:00 UTC é o
  // deslocamento em minutos.
  const deslocamento = deslocamentoMinutos(primeiraPassada, tz);
  return new Date(hipotese - deslocamento * 60_000);
}

/** Quantos minutos o fuso está à frente de UTC no instante informado. */
export function deslocamentoMinutos(instante: Date, fuso?: string | null): number {
  const tz = normalizarFuso(fuso);
  // Formata o instante no fuso como se os getters fossem locais, e reconstrói
  // esse mesmo relógio como se fosse UTC. A diferença entre as duas leituras é o
  // deslocamento do fuso.
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(instante);

  const pega = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  // `hour12: false` pode devolver "24" para meia-noite em alguns runtimes; 24h
  // é meia-noite do dia seguinte, e normalizar evita um dia inteiro de erro.
  const hora = pega('hour');
  const minuto = pega('minute');
  const segundo = pega('second');

  const relogioComoUtc = Date.UTC(
    pega('year'), pega('month') - 1, pega('day'),
    hora === 24 ? 0 : hora, minuto, segundo,
  );
  const utcReal = Math.floor(instante.getTime() / 1000) * 1000;
  return Math.round((relogioComoUtc - utcReal) / 60_000);
}
