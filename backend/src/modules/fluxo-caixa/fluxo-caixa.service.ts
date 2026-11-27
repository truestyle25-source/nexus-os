import { createHash } from 'node:crypto';

/**
 * Regras puras do módulo Fluxo de Caixa (sem banco) — testadas em
 * tests/fluxo-caixa-controles.test.ts.
 */

/** Acima deste valor (em R$, absoluto) a divergência é exceção e exige o Gestor. */
export const LIMITE_EXCECAO_GESTOR = 50;

export const FORMAS = ['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'OUTRO'] as const;
export type Forma = (typeof FORMAS)[number];

const c = (v: number) => Math.round(v * 100);
const r = (v: number) => Math.round(v) / 100;

/**
 * Valor esperado por forma de pagamento.
 * DINHEIRO = fundo + vendas em dinheiro − sangrias + suprimentos − estornos
 * (o `dinheiroEsperado` do resumo do PDV: venda cancelada tem o estorno
 * automático, então não conta como recebimento). As outras formas somam só
 * vendas FINALIZADAS (`porForma`). Sangria não mexe em faturamento.
 */
export function esperadoPorForma(resumo: { dinheiroEsperado: number; porForma: Record<string, number> }): Record<string, number> {
  const out: Record<string, number> = { DINHEIRO: r(c(resumo.dinheiroEsperado)) };
  for (const [forma, valor] of Object.entries(resumo.porForma)) {
    if (forma === 'DINHEIRO') continue;
    out[forma] = r(c(Number(valor)));
  }
  return out;
}

/** Monta os itens da conferência: forma ausente no informado conta como 0. */
export function montarConferencia(esperado: Record<string, number>, contado: Array<{ forma: string; valor: number }>) {
  const informado = new Map<string, number>();
  for (const i of contado) informado.set(i.forma, (informado.get(i.forma) ?? 0) + c(i.valor));
  const formas = Array.from(new Set([...Object.keys(esperado), ...informado.keys()]));
  const itens = formas.map((forma) => {
    const e = c(esperado[forma] ?? 0);
    const k = informado.get(forma) ?? 0;
    return { forma, esperado: r(e), contado: r(k), diferenca: r(k - e) };
  });
  const totalEsperado = r(itens.reduce((s, i) => s + c(i.esperado), 0));
  const totalContado = r(itens.reduce((s, i) => s + c(i.contado), 0));
  // Divergência = soma das diferenças ABSOLUTAS: sobra em Pix não compensa falta em dinheiro.
  const divergenciaAbs = r(itens.reduce((s, i) => s + Math.abs(c(i.diferenca)), 0));
  return { itens, totalEsperado, totalContado, diferenca: r(c(totalContado) - c(totalEsperado)), divergenciaAbs };
}

export function nivelExigido(valorAbs: number): 'SUPERVISOR' | 'GESTOR' {
  return Math.abs(valorAbs) > LIMITE_EXCECAO_GESTOR ? 'GESTOR' : 'SUPERVISOR';
}

export type StatusAprov = 'PENDENTE' | 'AUTORIZADA' | 'APROVADA' | 'REJEITADA';

/**
 * Máquina de estados da aprovação. Nunca aprova sozinha: toda transição
 * vem de uma decisão humana de quem tem o nível certo.
 * - nível SUPERVISOR: PENDENTE → AUTORIZADA (final) | REJEITADA
 * - nível GESTOR: PENDENTE → AUTORIZADA (supervisor) → APROVADA (gestor);
 *   o gestor também pode aprovar direto do PENDENTE.
 */
export function proximoStatus(a: { status: StatusAprov; nivelExigido: 'SUPERVISOR' | 'GESTOR' }, nivelDecisor: 'SUPERVISOR' | 'GESTOR', decisao: 'AUTORIZAR' | 'APROVAR' | 'REJEITAR'):
  { ok: true; status: StatusAprov } | { ok: false; erro: string; http: number } {
  const final = a.status === 'APROVADA' || a.status === 'REJEITADA' || (a.status === 'AUTORIZADA' && a.nivelExigido === 'SUPERVISOR');
  if (final) return { ok: false, erro: 'Esta solicitação já foi decidida.', http: 409 };
  if (a.status === 'AUTORIZADA' && nivelDecisor !== 'GESTOR') return { ok: false, erro: 'Já autorizada pelo supervisor: agora só o gestor decide.', http: 403 };
  if (decisao === 'REJEITAR') return { ok: true, status: 'REJEITADA' };
  if (a.nivelExigido === 'SUPERVISOR') return { ok: true, status: 'AUTORIZADA' };
  return { ok: true, status: nivelDecisor === 'GESTOR' ? 'APROVADA' : 'AUTORIZADA' };
}

export type LinhaExtrato = { data: Date; descricao: string; valor: number; documento: string | null; hash: string };

function hashLinha(partes: string[]): string {
  return createHash('sha256').update(partes.join('|')).digest('hex').slice(0, 40);
}

function dataOfx(v: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v.trim());
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null;
}

function tag(bloco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(bloco);
  return m ? m[1].trim() : null;
}

/** OFX (SGML ou XML): cada <STMTTRN> vira uma linha; o FITID do banco é a chave de deduplicação. */
export function lerOfx(texto: string): LinhaExtrato[] {
  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  const out: LinhaExtrato[] = [];
  for (const b of blocos) {
    const data = dataOfx(tag(b, 'DTPOSTED') ?? '');
    const valor = Number((tag(b, 'TRNAMT') ?? '').replace(',', '.'));
    if (!data || !Number.isFinite(valor)) continue;
    const descricao = tag(b, 'MEMO') ?? tag(b, 'NAME') ?? 'Sem descrição';
    const fitid = tag(b, 'FITID');
    out.push({ data, descricao, valor: r(c(valor)), documento: fitid, hash: hashLinha(fitid ? ['FITID', fitid] : [data.toISOString(), String(valor), descricao]) });
  }
  return out;
}

function numeroBr(v: string): number {
  const s = v.trim().replace(/[R$\s]/g, '');
  // "1.234,56" → 1234.56 ; "1234.56" → 1234.56
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return Number(norm);
}

function dataBr(v: string): Date | null {
  const t = v.trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return null;
}

/**
 * CSV com cabeçalho contendo "data", "descri…" e "valor" (separador ; ou ,).
 * Linhas idênticas no mesmo arquivo recebem um número de ocorrência no hash,
 * para que dois Pix iguais no mesmo dia não virem um só.
 */
export function lerCsv(texto: string): LinhaExtrato[] {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) return [];
  const sep = linhas[0].includes(';') ? ';' : ',';
  const cab = linhas[0].split(sep).map((h) => h.trim().toLowerCase());
  const iData = cab.findIndex((h) => h.startsWith('data'));
  const iDesc = cab.findIndex((h) => h.startsWith('descri') || h.startsWith('hist'));
  const iValor = cab.findIndex((h) => h.startsWith('valor'));
  const iDoc = cab.findIndex((h) => h.startsWith('doc'));
  if (iData < 0 || iValor < 0) throw new Error('O CSV precisa ter as colunas "data" e "valor".');
  const vistos = new Map<string, number>();
  const out: LinhaExtrato[] = [];
  for (const l of linhas.slice(1)) {
    const col = l.split(sep);
    const data = dataBr(col[iData] ?? '');
    const valor = numeroBr(col[iValor] ?? '');
    if (!data || !Number.isFinite(valor)) continue;
    const descricao = (iDesc >= 0 ? col[iDesc] : '')?.trim() || 'Sem descrição';
    const documento = iDoc >= 0 ? col[iDoc]?.trim() || null : null;
    const base = [data.toISOString(), String(r(c(valor))), descricao, documento ?? ''].join('|');
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    out.push({ data, descricao, valor: r(c(valor)), documento, hash: hashLinha([base, String(n)]) });
  }
  return out;
}

export function lerExtrato(nome: string, texto: string): { formato: 'OFX' | 'CSV'; linhas: LinhaExtrato[] } {
  const ofx = /\.ofx$/i.test(nome) || /<OFX>/i.test(texto);
  return ofx ? { formato: 'OFX', linhas: lerOfx(texto) } : { formato: 'CSV', linhas: lerCsv(texto) };
}

/** Taxa, líquido e previsão de recebimento de um pagamento em cartão. */
export function calcularCartao(bruto: number, forma: string, data: Date, adq: { taxaDebito: number; taxaCredito: number; prazoDebitoDias: number; prazoCreditoDias: number } | null) {
  if (!adq) return { taxa: null, liquido: null, previsao: null };
  const debito = forma === 'CARTAO_DEBITO';
  const pct = debito ? adq.taxaDebito : adq.taxaCredito;
  const taxa = r(Math.round(c(bruto) * pct / 100));
  const previsao = new Date(data.getTime() + (debito ? adq.prazoDebitoDias : adq.prazoCreditoDias) * 86400000);
  return { taxa, liquido: r(c(bruto) - c(taxa)), previsao };
}
