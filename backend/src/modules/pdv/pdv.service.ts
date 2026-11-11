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
  const porForma: Record<string, number> = {};
  let totalVendas = 0;
  let qtdVendas = 0;
  let dinheiroVendas = 0;
  for (const v of vendas) {
    const total = Number(v.total);
    const pagamentos = v.pagamentos?.length ? v.pagamentos : [{ forma: v.formaPagamento, valor: v.total }];
    // O valor pago continua sendo caixa recebido mesmo quando a venda foi
    // cancelada; a devolução correspondente é contabilizada em `estornos`.
    dinheiroVendas += pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + Number(p.valor), 0);
    if (v.status !== 'FINALIZADA') continue;
    totalVendas += total;
    qtdVendas += 1;
    for (const pagamento of pagamentos) {
      porForma[pagamento.forma] = (porForma[pagamento.forma] ?? 0) + Number(pagamento.valor);
    }
  }
  const saidas = movimentacoes.filter((m) => m.tipo === 'SANGRIA');
  // `origem` ausente em registro antigo é tratado como MANUAL: sem esse
  // fallback, todo estorno já gravado passaria a contar como manual e o
  // número da tela voltaria a misturar os dois.
  const estornos = saidas.filter((m) => m.origem === 'AUTOMATICO').reduce((s, m) => s + Number(m.valor), 0);
  const sangrias = saidas.filter((m) => m.origem !== 'AUTOMATICO').reduce((s, m) => s + Number(m.valor), 0);
  const suprimentos = movimentacoes.filter((m) => m.tipo === 'SUPRIMENTO').reduce((s, m) => s + Number(m.valor), 0);
  const fundoTroco = Number(caixa.fundoTroco);
  const dinheiroEsperado = fundoTroco + suprimentos + dinheiroVendas - sangrias - estornos;
  return { totalVendas, qtdVendas, porForma, dinheiroVendas, fundoTroco, sangrias, suprimentos, estornos, dinheiroEsperado, saldoRegistrado: Number(caixa.saldo), abertoEm: caixa.abertoEm };
}