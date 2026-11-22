/**
 * Fase C2 — cobranças externas a partir de uma conta a receber (Financeiro).
 *
 * Asaas (https://docs.asaas.com):
 *   - cliente: GET /v3/customers?cpfCnpj= (reaproveita) ou POST /v3/customers {name, cpfCnpj, email};
 *   - cobrança: POST /v3/payments {customer, billingType BOLETO|PIX|UNDEFINED, value, dueDate
 *     YYYY-MM-DD, description, externalReference = id do lançamento} → invoiceUrl;
 *   - consulta: GET /v3/payments/{id}; pago = RECEIVED | CONFIRMED | RECEIVED_IN_CASH.
 *   - webhook: evento PAYMENT_RECEIVED/PAYMENT_CONFIRMED com cabeçalho asaas-access-token.
 * Mercado Pago (https://www.mercadopago.com.br/developers/pt/reference):
 *   - link: POST /checkout/preferences {items, external_reference, notification_url} → init_point;
 *   - consulta: GET /v1/payments/{id}; pago = status "approved".
 *
 * REGRA DE SEGURANÇA DA BAIXA: o conteúdo do aviso (webhook) NUNCA é usado como prova de
 * pagamento. O aviso só informa o id; o servidor consulta o pagamento na API do provedor com
 * as credenciais DA PRÓPRIA EMPRESA e só dá baixa se: o pagamento está pago, a referência
 * externa é um lançamento desta empresa e o valor confere. Por isso a baixa é segura mesmo
 * sem a assinatura do Mercado Pago (cujo formato exato não consta na documentação lida).
 * A baixa é condicional (só PENDENTE → PAGO): avisos repetidos não fazem nada.
 */
import { prisma } from '../../../lib/prisma.js';
import { ErroDeNegocio, NaoEncontrado } from '../../../lib/erros.js';
import { credenciaisInternas, credenciaisPorRegistro, registrarEvento } from './central.service.js';
import { ASAAS_BASE } from './adaptadores.js';

const UA = 'NexusOS/1.0';
const TIMEOUT = 15_000;
export const PROVEDORES_COBRANCA = { asaas: 'ASAAS', mercadopago: 'MERCADO_PAGO' } as const;
type IdProvedor = keyof typeof PROVEDORES_COBRANCA;

const soDigitos = (v: string) => String(v ?? '').replace(/\D/g, '');
const centavos = (v: unknown) => Math.round(Number(v) * 100);
const hojeISO = () => new Date().toISOString().slice(0, 10);

async function chamar(url: string, init: { method?: string; headers: Record<string, string>; body?: unknown }) {
  try {
    const r = await fetch(url, { method: init.method ?? 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }, ...(init.body ? { body: JSON.stringify(init.body) } : {}) });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json: json as any };
  } catch {
    return { ok: false, status: 0, json: {} as any };
  }
}

function erroProvedor(nome: string, r: { status: number; json: any }): ErroDeNegocio {
  if (r.status === 0) return new ErroDeNegocio(`${nome}: sem comunicação (timeout ou rede).`, 502);
  if (r.status === 401 || r.status === 403 || (r.status === 400 && r.json?.message === 'invalid_token')) return new ErroDeNegocio(`${nome}: credencial inválida. Reconecte na Central de Integrações.`, 502);
  const detalhe = r.json?.errors?.[0]?.description ?? r.json?.message ?? `HTTP ${r.status}`;
  return new ErroDeNegocio(`${nome} recusou: ${String(detalhe).slice(0, 200)}`, 502);
}

async function lancamentoDaEmpresa(empresaId: string, financeiroId: string) {
  const f = await prisma.financeiro.findFirst({ where: { id: financeiroId, empresaId } });
  if (!f) throw NaoEncontrado('Lançamento não encontrado.');
  return f;
}

export interface PedidoCobranca {
  provedor: IdProvedor;
  forma?: 'BOLETO' | 'PIX' | 'UNDEFINED';
  pagador?: { nome: string; documento: string; email?: string };
}

/** Cria a cobrança no provedor e guarda o link no lançamento. */
export async function gerarCobranca(empresaId: string, usuarioId: string, financeiroId: string, pedido: PedidoCobranca, baseUrlPublica: string) {
  const f = await lancamentoDaEmpresa(empresaId, financeiroId);
  if (f.tipo !== 'RECEITA') throw new ErroDeNegocio('Só contas a receber podem gerar cobrança.', 400);
  if (f.status === 'PAGO' || f.status === 'CANCELADO') throw new ErroDeNegocio('Este lançamento já está pago ou cancelado.', 409);
  if (f.cobrancaId && f.cobrancaStatus !== 'CANCELADA') throw new ErroDeNegocio('Já existe uma cobrança para este lançamento.', 409);
  const valor = Number(f.valor);
  if (!(valor > 0)) throw new ErroDeNegocio('Valor inválido para cobrança.', 400);
  const cred = await credenciaisInternas(empresaId, pedido.provedor);
  if (!cred || cred.status !== 'CONECTADO') throw new ErroDeNegocio(`${pedido.provedor === 'asaas' ? 'Asaas' : 'Mercado Pago'} não está conectado na Central de Integrações.`, 409);
  const descricao = f.descricao.slice(0, 250);
  const inicio = Date.now();
  let dados: { cobrancaId: string; cobrancaUrl: string; cobrancaStatus: string };

  if (pedido.provedor === 'asaas') {
    const p = pedido.pagador;
    const doc = soDigitos(p?.documento ?? '');
    if (!p?.nome?.trim() || !(doc.length === 11 || doc.length === 14)) throw new ErroDeNegocio('Informe o nome e o CPF/CNPJ do pagador.', 400);
    const base = ASAAS_BASE[cred.config.ambiente];
    const h = { access_token: cred.segredos.apiKey };
    const busca = await chamar(`${base}/customers?cpfCnpj=${doc}`, { headers: h });
    if (!busca.ok) throw erroProvedor('Asaas', busca);
    let clienteId: string | undefined = busca.json?.data?.[0]?.id;
    if (!clienteId) {
      const novo = await chamar(`${base}/customers`, { method: 'POST', headers: h, body: { name: p.nome.trim().slice(0, 120), cpfCnpj: doc, ...(p.email ? { email: p.email } : {}), externalReference: `nexus:${empresaId}` } });
      if (!novo.ok || !novo.json?.id) throw erroProvedor('Asaas', novo);
      clienteId = novo.json.id;
    }
    // O Asaas não aceita vencimento no passado: lançamento vencido vira cobrança para hoje.
    const venc = f.vencimento && f.vencimento.toISOString().slice(0, 10) > hojeISO() ? f.vencimento.toISOString().slice(0, 10) : hojeISO();
    const r = await chamar(`${base}/payments`, { method: 'POST', headers: h, body: { customer: clienteId, billingType: pedido.forma ?? 'UNDEFINED', value: valor, dueDate: venc, description: descricao, externalReference: f.id } });
    if (!r.ok || !r.json?.id) { await registrarEvento({ empresaId, provedor: 'asaas', operacao: 'SINCRONIZAR', ok: false, codigoErro: `HTTP_${r.status}`, mensagem: 'Falha ao gerar cobrança.', duracaoMs: Date.now() - inicio, usuarioId }); throw erroProvedor('Asaas', r); }
    dados = { cobrancaId: String(r.json.id), cobrancaUrl: String(r.json.invoiceUrl ?? r.json.bankSlipUrl ?? ''), cobrancaStatus: String(r.json.status ?? 'PENDING') };
  } else {
    const r = await chamar('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST', headers: { Authorization: `Bearer ${cred.segredos.accessToken}` },
      body: { items: [{ title: descricao, quantity: 1, unit_price: valor, currency_id: 'BRL' }], external_reference: f.id, notification_url: `${baseUrlPublica}/integracoes/mercadopago/webhook/${cred.id}` },
    });
    if (!r.ok || !r.json?.id) { await registrarEvento({ empresaId, provedor: 'mercadopago', operacao: 'SINCRONIZAR', ok: false, codigoErro: `HTTP_${r.status}`, mensagem: 'Falha ao gerar link de pagamento.', duracaoMs: Date.now() - inicio, usuarioId }); throw erroProvedor('Mercado Pago', r); }
    dados = { cobrancaId: String(r.json.id), cobrancaUrl: String(r.json.init_point ?? ''), cobrancaStatus: 'AGUARDANDO' };
  }

  // Grava só se ninguém gerou outra cobrança ao mesmo tempo.
  const gravou = await prisma.financeiro.updateMany({ where: { id: f.id, empresaId, OR: [{ cobrancaId: null }, { cobrancaStatus: 'CANCELADA' }] }, data: { cobrancaProvedor: PROVEDORES_COBRANCA[pedido.provedor], ...dados } });
  if (!gravou.count) throw new ErroDeNegocio('Outra cobrança foi gerada para este lançamento ao mesmo tempo.', 409);
  await registrarEvento({ empresaId, provedor: pedido.provedor, operacao: 'SINCRONIZAR', ok: true, mensagem: `Cobrança gerada para "${descricao.slice(0, 80)}".`, duracaoMs: Date.now() - inicio, usuarioId });
  return prisma.financeiro.findUniqueOrThrow({ where: { id: f.id } });
}

/**
 * Baixa condicional. Só PENDENTE/VENCIDO → PAGO, só se o valor confere e o lançamento é
 * desta empresa. Exportada para teste (não faz rede).
 */
export async function aplicarPagamento(empresaId: string, financeiroId: string, pg: { provedor: 'ASAAS' | 'MERCADO_PAGO'; pago: boolean; valor: number; idPagamento: string; statusProvedor: string; pagoEm?: Date | null }) {
  const f = await prisma.financeiro.findFirst({ where: { id: financeiroId, empresaId, tipo: 'RECEITA' } });
  if (!f) return { resultado: 'LANCAMENTO_NAO_ENCONTRADO' as const };
  await prisma.financeiro.updateMany({ where: { id: f.id, empresaId }, data: { cobrancaStatus: pg.statusProvedor.slice(0, 40) } });
  if (!pg.pago) return { resultado: 'NAO_PAGO' as const };
  if (centavos(pg.valor) !== centavos(f.valor)) return { resultado: 'VALOR_DIVERGENTE' as const };
  const r = await prisma.financeiro.updateMany({
    where: { id: f.id, empresaId, status: { in: ['PENDENTE', 'VENCIDO'] } },
    data: { status: 'PAGO', pagoEm: pg.pagoEm ?? new Date(), pagamentoExternoId: pg.idPagamento.slice(0, 100), cobrancaProvedor: pg.provedor },
  });
  return { resultado: r.count ? 'BAIXADO' as const : 'JA_BAIXADO' as const };
}

/** Consulta o pagamento no provedor (com a credencial da empresa) e aplica a baixa. */
export async function conferirPagamento(empresaId: string, provedor: IdProvedor, idPagamento: string, usuarioId: string | null = null) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(idPagamento)) return { resultado: 'ID_INVALIDO' as const };
  const cred = await credenciaisInternas(empresaId, provedor);
  if (!cred) return { resultado: 'NAO_CONFIGURADO' as const };
  const inicio = Date.now();
  let res: Awaited<ReturnType<typeof aplicarPagamento>> | { resultado: 'FALHA_CONSULTA' | 'SEM_REFERENCIA' };
  if (provedor === 'asaas') {
    const r = await chamar(`${ASAAS_BASE[cred.config.ambiente]}/payments/${idPagamento}`, { headers: { access_token: cred.segredos.apiKey } });
    if (!r.ok) res = { resultado: 'FALHA_CONSULTA' };
    else if (!r.json?.externalReference) res = { resultado: 'SEM_REFERENCIA' };
    else res = await aplicarPagamento(empresaId, String(r.json.externalReference), { provedor: 'ASAAS', pago: ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(r.json.status), valor: Number(r.json.value), idPagamento: String(r.json.id), statusProvedor: String(r.json.status), pagoEm: r.json.paymentDate ? new Date(r.json.paymentDate) : null });
  } else {
    const r = await chamar(`https://api.mercadopago.com/v1/payments/${idPagamento}`, { headers: { Authorization: `Bearer ${cred.segredos.accessToken}` } });
    if (!r.ok) res = { resultado: 'FALHA_CONSULTA' };
    else if (!r.json?.external_reference) res = { resultado: 'SEM_REFERENCIA' };
    else res = await aplicarPagamento(empresaId, String(r.json.external_reference), { provedor: 'MERCADO_PAGO', pago: r.json.status === 'approved', valor: Number(r.json.transaction_amount), idPagamento: String(r.json.id), statusProvedor: String(r.json.status), pagoEm: r.json.date_approved ? new Date(r.json.date_approved) : null });
  }
  await registrarEvento({ empresaId, provedor, operacao: 'SINCRONIZAR', ok: ['BAIXADO', 'JA_BAIXADO', 'NAO_PAGO'].includes(res.resultado), codigoErro: ['BAIXADO', 'JA_BAIXADO', 'NAO_PAGO'].includes(res.resultado) ? null : res.resultado, mensagem: `Pagamento conferido no provedor: ${res.resultado}.`, duracaoMs: Date.now() - inicio, usuarioId });
  return res;
}

/** Botão "Atualizar status" (Asaas): consulta a cobrança vinculada ao lançamento. */
export async function atualizarCobranca(empresaId: string, usuarioId: string, financeiroId: string) {
  const f = await lancamentoDaEmpresa(empresaId, financeiroId);
  if (f.cobrancaProvedor !== 'ASAAS' || !f.cobrancaId) throw new ErroDeNegocio('Consulta manual disponível para cobranças do Asaas. No Mercado Pago a baixa chega pelo aviso automático.', 409);
  const r = await conferirPagamento(empresaId, 'asaas', f.cobrancaId, usuarioId);
  return { resultado: r.resultado, lancamento: await prisma.financeiro.findUniqueOrThrow({ where: { id: f.id } }) };
}

export { credenciaisPorRegistro };
