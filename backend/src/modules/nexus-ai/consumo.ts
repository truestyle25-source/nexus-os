/**
 * Controle financeiro da NEXUS AI: livro de consumo por empresa/dia e limites mensais.
 * O bloqueio desliga SÓ a IA (o ERP continua). Aviso a partir de 80% do limite.
 *
 * Preço estimado (centavos de real por 1 milhão de tokens), configurável no servidor:
 *   NEXUS_AI_PRECO_ENTRADA_MILHAO (padrão 200 = R$ 2,00) · NEXUS_AI_PRECO_SAIDA_MILHAO (padrão 1200)
 * Limites padrão da plataforma (cada empresa pode ter limite próprio em AILimite):
 *   NEXUS_AI_EXECUCOES_MES (padrão 500) · NEXUS_AI_CUSTO_MES_CENTAVOS (padrão 5000 = R$ 50,00)
 */
import { prisma } from '../../lib/prisma.js';

const num = (v: string | undefined, padrao: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : padrao; };

export function custoCentavos(tokensEntrada: number, tokensSaida: number): number {
  const entrada = num(process.env.NEXUS_AI_PRECO_ENTRADA_MILHAO, 200);
  const saida = num(process.env.NEXUS_AI_PRECO_SAIDA_MILHAO, 1200);
  return Math.ceil((tokensEntrada * entrada + tokensSaida * saida) / 1_000_000);
}

const diaUTC = (d = new Date()) => d.toISOString().slice(0, 10);
const inicioMesUTC = (d = new Date()) => `${d.toISOString().slice(0, 7)}-01`;

export async function usoDoMes(empresaId: string, agora = new Date()) {
  const linhas = await prisma.aIConsumo.findMany({ where: { empresaId, dia: { gte: inicioMesUTC(agora), lte: diaUTC(agora) } } });
  return linhas.reduce((t, l) => ({ execucoes: t.execucoes + l.execucoes, tokensEntrada: t.tokensEntrada + l.tokensEntrada, tokensSaida: t.tokensSaida + l.tokensSaida, custoCentavos: t.custoCentavos + l.custoCentavos }), { execucoes: 0, tokensEntrada: 0, tokensSaida: 0, custoCentavos: 0 });
}

export async function limitesDaEmpresa(empresaId: string) {
  const l = await prisma.aILimite.findUnique({ where: { empresaId } });
  return {
    execucoesMes: l?.execucoesMes ?? num(process.env.NEXUS_AI_EXECUCOES_MES, 500),
    custoMesCentavos: l?.custoMesCentavos ?? num(process.env.NEXUS_AI_CUSTO_MES_CENTAVOS, 5000),
    bloqueadoManualmente: l?.bloqueadoManualmente ?? false,
  };
}

export async function situacaoConsumo(empresaId: string) {
  const [uso, limites] = await Promise.all([usoDoMes(empresaId), limitesDaEmpresa(empresaId)]);
  const pctExec = limites.execucoesMes ? uso.execucoes / limites.execucoesMes : 0;
  const pctCusto = limites.custoMesCentavos ? uso.custoCentavos / limites.custoMesCentavos : 0;
  const pct = Math.max(pctExec, pctCusto);
  const bloqueado = limites.bloqueadoManualmente || pctExec >= 1 || pctCusto >= 1;
  return { uso, limites, percentual: Math.round(pct * 100), alerta: pct >= 0.8 && !bloqueado, bloqueado, motivo: limites.bloqueadoManualmente ? 'IA bloqueada pelo administrador.' : bloqueado ? 'Limite mensal de uso da IA atingido.' : null };
}

export async function registrarConsumo(empresaId: string, d: { execucoes?: number; tokensEntrada?: number; tokensSaida?: number; custoCentavos?: number }) {
  const dia = diaUTC();
  await prisma.aIConsumo.upsert({
    where: { empresaId_dia: { empresaId, dia } },
    create: { empresaId, dia, execucoes: d.execucoes ?? 0, tokensEntrada: d.tokensEntrada ?? 0, tokensSaida: d.tokensSaida ?? 0, custoCentavos: d.custoCentavos ?? 0 },
    update: { execucoes: { increment: d.execucoes ?? 0 }, tokensEntrada: { increment: d.tokensEntrada ?? 0 }, tokensSaida: { increment: d.tokensSaida ?? 0 }, custoCentavos: { increment: d.custoCentavos ?? 0 } },
  });
}
