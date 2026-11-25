import { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma.js';
import { NaoEncontrado, ErroDeNegocio } from '../../lib/erros.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';

/** Soma os totais do turno de caixa: vendas por forma de pagamento,
 * sangrias, suprimentos e dinheiro esperado.
 *
 * SANGRIA MANUAL x ESTORNO AUTOMÁTICO
 * -----------------------------------
 * O cancelamento de uma venda em dinheiro cria uma `MovimentacaoCaixa` do tipo
 * `SANGRIA` (vendas.routes.ts) e reduz `Caixa.saldo` na mesma transação. Isso é
 * correto para o dinheiro — mas a linha "Sangrias" da tela somava as duas
 * coisas, então o operador via "Sangrias: R$ 500" sem nunca ter tirado nada.
 * No fechamento contestado é esse número que cai nele.
 *
 * A conta NÃO pode mudar: o estorno tem que sair do dinheiro esperado, senão o
 * fechamento com certeza diverge. Por que ele continua sendo subtraído — só
 * que numa linha própria (`estornos`), identificada pela `origem` que o
 * próprio estorno grava (`AUTOMATICO` vs `MANUAL`).
 */

/** Calcula o resumo do caixa a partir das vendas e movimentações. */
export function resumoDoCaixa(caixa: { id: string; fundoTroco: unknown; saldo: unknown; abertoEm: Date }, vendas: Array<{ formaPagamento: string; total: unknown; status: string; pagamentos?: Array<{ forma: string; valor: unknown }> }>, movimentacoes: Array<{ tipo: string; valor: unknown; origem?: string }>) {
  // Toda a conta é feita em CENTAVOS inteiros e só volta a reais no fim:
  // somar `Number` de reais acumula erro de ponto flutuante (0,1 + 0,2).
  const porFormaC: Record<string, number> = {};
  let totalVendasC = 0;
  let qtdVendas = 0;
  let dinheiroVendasC = 0;
  for (const v of vendas) {
    const pagamentos = v.pagamentos?.length ? v.pagamentos : [{ forma: v.formaPagamento, valor: v.total }];
    // O valor pago continua sendo caixa recebido mesmo quando a venda foi
    // cancelada; a devolução correspondente é contabilizada em `estornos`.
    dinheiroVendasC += pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + centavos(p.valor), 0);
    if (v.status !== 'FINALIZADA') continue;
    totalVendasC += centavos(v.total);
    qtdVendas += 1;
    for (const pagamento of pagamentos) {
      porFormaC[pagamento.forma] = (porFormaC[pagamento.forma] ?? 0) + centavos(pagamento.valor);
    }
  }
  const saidas = movimentacoes.filter((m) => m.tipo === 'SANGRIA');
  // `origem` ausente em registro antigo é tratado como MANUAL: sem esse
  // fallback, todo estorno já gravado passaria a contar como manual e o
  // número da tela voltaria a misturar os dois.
  const estornosC = saidas.filter((m) => m.origem === 'AUTOMATICO').reduce((s, m) => s + centavos(m.valor), 0);
  const sangriasC = saidas.filter((m) => m.origem !== 'AUTOMATICO').reduce((s, m) => s + centavos(m.valor), 0);
  const suprimentosC = movimentacoes.filter((m) => m.tipo === 'SUPRIMENTO').reduce((s, m) => s + centavos(m.valor), 0);
  const fundoTrocoC = centavos(caixa.fundoTroco);
  const dinheiroEsperadoC = fundoTrocoC + suprimentosC + dinheiroVendasC - sangriasC - estornosC;
  const porForma = Object.fromEntries(Object.entries(porFormaC).map(([f, c]) => [f, reais(c)]));
  return {
    totalVendas: reais(totalVendasC), qtdVendas, porForma, dinheiroVendas: reais(dinheiroVendasC), fundoTroco: reais(fundoTrocoC),
    sangrias: reais(sangriasC), suprimentos: reais(suprimentosC), estornos: reais(estornosC), dinheiroEsperado: reais(dinheiroEsperadoC),
    saldoRegistrado: Number(caixa.saldo), abertoEm: caixa.abertoEm,
  };
}

/** Converte um valor monetário (Decimal, string ou number) para centavos inteiros. */
export function centavos(valor: unknown): number {
  return Math.round(Number(valor) * 100);
}

/** Converte centavos inteiros de volta para reais. */
export function reais(c: number): number {
  return c / 100;
}