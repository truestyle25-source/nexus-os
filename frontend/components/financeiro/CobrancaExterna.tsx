'use client';
// Cobrança externa de uma conta a receber (Fase C2): gera boleto/PIX no Asaas ou link de
// pagamento no Mercado Pago, mostra o link e o status, e (Asaas) consulta o pagamento.
// A baixa automática é feita pelo servidor depois de CONSULTAR o pagamento no provedor —
// esta tela nunca marca nada como pago sozinha.
import { useEffect, useState } from 'react';
import { Copy, ExternalLink, RefreshCw, Send } from 'lucide-react';
import api from '@/lib/api';
import { mensagemDeErroApi } from '@/lib/erros-api';
import { formatDateTime } from '@/lib/format';

export interface LancamentoCobranca {
  id: string; tipoUp?: string; tipo?: string; statusUp?: string; status?: string; valor: number | string; descricao: string;
  cobrancaProvedor?: string | null; cobrancaId?: string | null; cobrancaUrl?: string | null; cobrancaStatus?: string | null; pagoEm?: string | null;
}

const lbl = { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 4 };
const campo = { width: '100%', height: 36, background: 'var(--nexus-panel-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', color: '#fff', fontSize: 12 };
const botao = { height: 34, borderRadius: 8, padding: '0 12px', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' } as const;
const primario = { ...botao, background: 'var(--primary)', color: '#fff', border: 'none' };
const secundario = { ...botao, background: 'var(--card2)', color: '#fff', border: '1px solid var(--nexus-border)' };
const NOME: Record<string, string> = { ASAAS: 'Asaas', MERCADO_PAGO: 'Mercado Pago' };

export default function CobrancaExterna({ lancamento, onAtualizado }: { lancamento: LancamentoCobranca; onAtualizado: (l: LancamentoCobranca) => void }) {
  const tipo = lancamento.tipoUp ?? lancamento.tipo;
  const status = lancamento.statusUp ?? lancamento.status;
  const [conectados, setConectados] = useState<string[] | null>(null);
  const [provedor, setProvedor] = useState('');
  const [forma, setForma] = useState<'UNDEFINED' | 'BOLETO' | 'PIX'>('UNDEFINED');
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [email, setEmail] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    api.get<{ estados: { provedor: string; status: string }[] }>('/integracoes/central/painel')
      .then(({ data }) => {
        const ok = data.estados.filter((e) => ['asaas', 'mercadopago'].includes(e.provedor) && e.status === 'CONECTADO').map((e) => e.provedor);
        setConectados(ok); setProvedor((p) => p || ok[0] || '');
      })
      .catch(() => setConectados([]));
  }, []);

  if (tipo !== 'RECEITA') return null;

  async function gerar() {
    setMsg(null); setOcupado(true);
    try {
      const { data } = await api.post<LancamentoCobranca>(`/financeiro/${lancamento.id}/cobranca`, {
        provedor, ...(provedor === 'asaas' ? { forma, pagador: { nome, documento, ...(email.trim() ? { email: email.trim() } : {}) } } : {}),
      });
      onAtualizado({ ...lancamento, ...data });
      setMsg({ ok: true, t: 'Cobrança gerada. Envie o link ao cliente; a baixa acontece quando o provedor confirmar o pagamento.' });
    } catch (e) { setMsg({ ok: false, t: mensagemDeErroApi(e, 'Não foi possível gerar a cobrança.') }); } finally { setOcupado(false); }
  }

  async function atualizar() {
    setMsg(null); setOcupado(true);
    try {
      const { data } = await api.post<{ resultado: string; lancamento: LancamentoCobranca }>(`/financeiro/${lancamento.id}/cobranca/atualizar`, {});
      onAtualizado({ ...lancamento, ...data.lancamento });
      const t: Record<string, string> = { BAIXADO: 'Pagamento confirmado no Asaas: conta baixada.', JA_BAIXADO: 'Pagamento já estava baixado.', NAO_PAGO: 'Ainda não pago no Asaas.', VALOR_DIVERGENTE: 'Valor pago diferente do lançamento: baixa não feita.', FALHA_CONSULTA: 'Não foi possível consultar o Asaas.' };
      setMsg({ ok: ['BAIXADO', 'JA_BAIXADO', 'NAO_PAGO'].includes(data.resultado), t: t[data.resultado] ?? data.resultado });
    } catch (e) { setMsg({ ok: false, t: mensagemDeErroApi(e, 'Não foi possível consultar.') }); } finally { setOcupado(false); }
  }

  const caixa = { marginTop: 16, background: 'var(--card2)', border: '1px solid var(--nexus-border)', borderRadius: 10, padding: 12 };
  return (
    <div style={caixa} data-testid="cobranca-externa">
      <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Cobrança</div>
      {lancamento.cobrancaId ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#fff' }}>{NOME[lancamento.cobrancaProvedor ?? ''] ?? lancamento.cobrancaProvedor} · status no provedor: <strong>{lancamento.cobrancaStatus ?? '—'}</strong>{lancamento.pagoEm ? ` · pago em ${formatDateTime(lancamento.pagoEm)}` : ''}</div>
          {lancamento.cobrancaUrl && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input readOnly value={lancamento.cobrancaUrl} style={{ ...campo, flex: '1 1 220px', fontFamily: 'monospace', fontSize: 11 }} aria-label="Link de pagamento" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" style={secundario} onClick={() => { void navigator.clipboard?.writeText(lancamento.cobrancaUrl!).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); }); }}><Copy size={13} />{copiado ? 'Copiado' : 'Copiar link'}</button>
              <a href={lancamento.cobrancaUrl} target="_blank" rel="noreferrer noopener" style={{ ...secundario, textDecoration: 'none' }}><ExternalLink size={13} />Abrir</a>
            </div>
          )}
          {lancamento.cobrancaProvedor === 'ASAAS' && status !== 'PAGO' && <button type="button" style={{ ...secundario, justifySelf: 'start' }} onClick={atualizar} disabled={ocupado}><RefreshCw size={13} />{ocupado ? 'Consultando…' : 'Atualizar status no Asaas'}</button>}
          {lancamento.cobrancaProvedor === 'MERCADO_PAGO' && status !== 'PAGO' && <div style={{ fontSize: 11, color: 'var(--muted)' }}>A baixa chega pelo aviso automático do Mercado Pago, depois que o pagamento é aprovado.</div>}
        </div>
      ) : status === 'PAGO' || status === 'CANCELADO' ? (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Lançamento {status === 'PAGO' ? 'pago' : 'cancelado'}: sem cobrança a gerar.</div>
      ) : conectados === null ? (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Carregando…</div>
      ) : conectados.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Conecte o Asaas ou o Mercado Pago na Central de Integrações para gerar boleto, PIX ou link de pagamento.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            <label><div style={lbl}>Provedor</div>
              <select style={campo} value={provedor} onChange={(e) => setProvedor(e.target.value)} aria-label="Provedor da cobrança">
                {conectados.map((p) => <option key={p} value={p}>{p === 'asaas' ? 'Asaas (boleto/PIX)' : 'Mercado Pago (link)'}</option>)}
              </select>
            </label>
            {provedor === 'asaas' && (
              <label><div style={lbl}>Forma</div>
                <select style={campo} value={forma} onChange={(e) => setForma(e.target.value as typeof forma)} aria-label="Forma de pagamento">
                  <option value="UNDEFINED">Cliente escolhe</option><option value="BOLETO">Boleto</option><option value="PIX">PIX</option>
                </select>
              </label>
            )}
          </div>
          {provedor === 'asaas' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
              <label><div style={lbl}>Nome do pagador</div><input style={campo} value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome do pagador" /></label>
              <label><div style={lbl}>CPF/CNPJ</div><input style={campo} value={documento} onChange={(e) => setDocumento(e.target.value)} inputMode="numeric" aria-label="CPF ou CNPJ do pagador" /></label>
              <label><div style={lbl}>E-mail (opcional)</div><input style={campo} value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" aria-label="E-mail do pagador" /></label>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Isso cria a cobrança de verdade no {provedor === 'asaas' ? 'Asaas' : 'Mercado Pago'}, no valor deste lançamento.</div>
          <button type="button" style={{ ...primario, justifySelf: 'start', opacity: ocupado ? 0.6 : 1 }} onClick={gerar} disabled={ocupado || !provedor || (provedor === 'asaas' && (!nome.trim() || documento.replace(/\D/g, '').length < 11))}><Send size={13} />{ocupado ? 'Gerando…' : 'Gerar cobrança'}</button>
        </div>
      )}
      {msg && <div role={msg.ok ? 'status' : 'alert'} style={{ marginTop: 8, fontSize: 11, color: msg.ok ? 'var(--success)' : 'var(--danger, #f59e0b)' }}>{msg.t}</div>}
    </div>
  );
}
