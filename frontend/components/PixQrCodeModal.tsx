'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
// Respeita Moeda / Idioma / Formato de hora da aba Configuracoes.
import { formatBRL } from '@/lib/format';

interface PixQr {
  payload: string;
  qrCodeBase64: string;
  copiaECola: string;
  txid: string;
  valor: number;
  expiraEm: string;
}

const brl = (v: number) => formatBRL(v);

export default function PixQrCodeModal({ valor, onClose, onPago }: {
  valor: number;
  onClose: () => void;
  onPago: (txid: string) => void | Promise<void>;
}) {
  const [qr, setQr] = useState<PixQr | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [restam, setRestam] = useState(5 * 60);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    api.post<PixQr>('/api/v1/pdv/pix/generate', { amount: valor })
      .then(({ data }) => setQr(data))
      .catch((e: any) => setErro(e?.response?.data?.error || e?.message || 'Não foi possível gerar o PIX.'))
      .finally(() => setLoading(false));
  }, [valor]);

  useEffect(() => {
    if (!qr) return;
    const t = setInterval(() => {
      setRestam((r) => {
        if (r <= 1) { clearInterval(t); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [qr]);

  const mm = String(Math.floor(restam / 60)).padStart(2, '0');
  const ss = String(restam % 60).padStart(2, '0');

  async function copiar() {
    if (!qr) return;
    try {
      await navigator.clipboard.writeText(qr.copiaECola);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro('Não foi possível copiar. Selecione o código manualmente.');
    }
  }

  async function confirmar() {
    if (!qr) return;
    setConfirmando(true);
    setErro(null);
    try {
      const { data } = await api.post(`/api/v1/pdv/pix/${qr.txid}/status`, {});
      if (data.status !== 'PAGO') {
        setErro(data.status === 'EXPIRADO'
          ? 'Esta cobrança PIX expirou. Gere uma nova cobrança.'
          : 'O provider ainda informa pagamento PENDENTE. O NEXUS não confirmou a venda.');
        return;
      }
      await onPago(qr.txid);
    } catch (e: any) {
      setErro(e?.response?.data?.error || e?.message || 'Não foi possível confirmar.');
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="admin-panel" style={{ maxWidth: 440, width: '100%', padding: 20, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 4 }}>PIX QR Code • {brl(valor)}</h2>
        <p style={{ fontSize: 12, opacity: 0.65, marginBottom: 12 }}>
          A cobrança e a confirmação exigem um provider PIX oficial configurado.
        </p>
        {loading && <p className="empty-state">Gerando QR…</p>}
        {erro && <p className="admin-message admin-error">{erro}</p>}
        {qr && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.qrCodeBase64} alt="QR Code PIX" style={{ width: 280, height: 280, margin: '0 auto', borderRadius: 12, background: '#fff', padding: 8 }} />
            <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)' }}>
              <p style={{ fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', opacity: 0.55, marginBottom: 6 }}>PIX copia e cola</p>
              <p style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', opacity: 0.8, maxHeight: 64, overflowY: 'auto' }}>{qr.copiaECola}</p>
              <button type="button" className="admin-secondary" style={{ marginTop: 8, padding: '6px 14px', fontSize: 12 }} onClick={copiar}>
                {copiado ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" className="admin-primary pdv-btn-grad" style={{ flex: 1, padding: '10px', borderRadius: 10 }} disabled={confirmando || restam <= 0} onClick={confirmar}>
                {confirmando ? 'Consultando…' : 'Consultar pagamento'}
              </button>
              <button type="button" className="admin-secondary" style={{ padding: '10px 16px', borderRadius: 10 }} onClick={onClose}>
                Cancelar
              </button>
            </div>
            {restam <= 0 && <p style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>QR expirado. Feche e gere um novo.</p>}
          </>
        )}
        {!loading && !qr && <button type="button" className="admin-secondary" style={{ marginTop: 12, padding: '8px 16px' }} onClick={onClose}>Fechar</button>}
      </div>
    </div>
  );
}
