import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esperadoPorForma, montarConferencia, nivelExigido, proximoStatus, lerCsv, lerOfx, lerExtrato, calcularCartao, LIMITE_EXCECAO_GESTOR } from '../src/modules/fluxo-caixa/fluxo-caixa.service.js';
import { resumoDoCaixa } from '../src/modules/pdv/pdv.service.js';

test('dinheiro esperado: fundo + vendas em dinheiro − sangrias + suprimentos; cancelada não conta', () => {
  const resumo = resumoDoCaixa(
    { id: 'c', fundoTroco: 100, saldo: 0, abertoEm: new Date() },
    [
      { formaPagamento: 'DINHEIRO', total: 50, status: 'FINALIZADA' },
      { formaPagamento: 'PIX', total: 20, status: 'FINALIZADA' },
      // cancelada: entrou em dinheiro e saiu pelo estorno automático
      { formaPagamento: 'DINHEIRO', total: 15, status: 'CANCELADA' },
    ],
    [
      { tipo: 'SANGRIA', valor: 30, origem: 'MANUAL' },
      { tipo: 'SUPRIMENTO', valor: 10, origem: 'MANUAL' },
      { tipo: 'SANGRIA', valor: 15, origem: 'AUTOMATICO' },
    ],
  );
  const e = esperadoPorForma(resumo);
  assert.equal(e.DINHEIRO, 130); // 100 + 50 − 30 + 10 (a cancelada se anula)
  assert.equal(e.PIX, 20);
  assert.equal(resumo.totalVendas, 70, 'sangria não reduz faturamento; cancelada não fatura');
});

test('conferência por forma: sobra num meio não compensa falta noutro', () => {
  const c = montarConferencia({ DINHEIRO: 100, PIX: 50 }, [{ forma: 'DINHEIRO', valor: 90 }, { forma: 'PIX', valor: 60 }]);
  assert.equal(c.diferenca, 0);
  assert.equal(c.divergenciaAbs, 20);
  const semPix = montarConferencia({ DINHEIRO: 10.1, PIX: 0.2 }, [{ forma: 'DINHEIRO', valor: 10.1 }]);
  assert.deepEqual(semPix.itens.find((i) => i.forma === 'PIX'), { forma: 'PIX', esperado: 0.2, contado: 0, diferenca: -0.2 });
});

test('nível de aprovação e máquina de estados nunca aprova sozinha', () => {
  assert.equal(nivelExigido(LIMITE_EXCECAO_GESTOR), 'SUPERVISOR');
  assert.equal(nivelExigido(LIMITE_EXCECAO_GESTOR + 0.01), 'GESTOR');
  assert.equal(nivelExigido(100, 150), 'SUPERVISOR', 'limite da empresa');
  assert.equal(nivelExigido(150.01, 150), 'GESTOR');
  assert.equal(nivelExigido(0.01, 0), 'GESTOR', 'limite zero: toda diferença vai ao gestor');
  assert.deepEqual(proximoStatus({ status: 'PENDENTE', nivelExigido: 'SUPERVISOR' }, 'SUPERVISOR', 'AUTORIZAR'), { ok: true, status: 'AUTORIZADA' });
  assert.deepEqual(proximoStatus({ status: 'PENDENTE', nivelExigido: 'GESTOR' }, 'SUPERVISOR', 'AUTORIZAR'), { ok: true, status: 'AUTORIZADA' });
  assert.equal(proximoStatus({ status: 'AUTORIZADA', nivelExigido: 'GESTOR' }, 'SUPERVISOR', 'APROVAR').ok, false);
  assert.deepEqual(proximoStatus({ status: 'AUTORIZADA', nivelExigido: 'GESTOR' }, 'GESTOR', 'APROVAR'), { ok: true, status: 'APROVADA' });
  assert.equal(proximoStatus({ status: 'AUTORIZADA', nivelExigido: 'SUPERVISOR' }, 'GESTOR', 'REJEITAR').ok, false, 'decisão final é imutável');
  assert.equal(proximoStatus({ status: 'REJEITADA', nivelExigido: 'GESTOR' }, 'GESTOR', 'APROVAR').ok, false);
});

test('extrato CSV e OFX: leitura, valores brasileiros e deduplicação', () => {
  const csv = 'Data;Descrição;Valor\n26/11/2026;PIX RECEBIDO;1.234,56\n26/11/2026;PIX RECEBIDO;1.234,56\n27/11/2026;TARIFA;-12,90\nlixo;;\n';
  const l = lerCsv(csv);
  assert.equal(l.length, 3);
  assert.equal(l[0].valor, 1234.56);
  assert.notEqual(l[0].hash, l[1].hash, 'duas linhas iguais no mesmo arquivo continuam sendo duas');
  assert.equal(lerCsv(csv)[1].hash, l[1].hash, 'reimportar gera o mesmo hash');
  assert.throws(() => lerCsv('a;b\n1;2'), /data/);
  const ofx = '<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261126120000[-3:BRT]<TRNAMT>150.00<FITID>ABC1<MEMO>TED RECEBIDA</STMTTRN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261127<TRNAMT>-9.5<FITID>ABC2<NAME>TARIFA</STMTTRN></BANKTRANLIST></OFX>';
  const o = lerOfx(ofx);
  assert.equal(o.length, 2);
  assert.equal(o[0].valor, 150);
  assert.equal(o[1].descricao, 'TARIFA');
  assert.equal(o[0].documento, 'ABC1');
  assert.equal(lerExtrato('x.txt', ofx).formato, 'OFX');
});

test('cartão: taxa, líquido e previsão pela adquirente', () => {
  const d = new Date('2026-11-26T12:00:00Z');
  const r = calcularCartao(100, 'CARTAO_CREDITO', d, { taxaDebito: 1.5, taxaCredito: 2.99, prazoDebitoDias: 1, prazoCreditoDias: 30 });
  assert.equal(r.taxa, 2.99);
  assert.equal(r.liquido, 97.01);
  assert.equal(r.previsao?.toISOString().slice(0, 10), '2026-12-26');
  assert.deepEqual(calcularCartao(100, 'CARTAO_DEBITO', d, null), { taxa: null, liquido: null, previsao: null });
});
