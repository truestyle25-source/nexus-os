'use client';

import { useEffect, useState } from 'react';
import { fetchAlcadasCaixa, salvarAlcadasCaixa, type AlcadaCaixa } from '@/lib/api';

/** Painel "Alçadas do caixa": liga/desliga supervisor e alçadas de desconto. */
export function AlcadasCaixa({ usuarioId, nome, onFechar, onSalvo }: { usuarioId: string; nome: string; onFechar: () => void; onSalvo: (msg: string) => void }) {
  const [alcadas, setAlcadas] = useState<AlcadaCaixa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchAlcadasCaixa(usuarioId)
      .then((a) => { if (vivo) setAlcadas(a); })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : 'Não foi possível carregar as alçadas.'); });
    return () => { vivo = false; };
  }, [usuarioId]);

  async function salvar() {
    if (!alcadas) return;
    setSalvando(true);
    setErro(null);
    try {
      await salvarAlcadasCaixa(usuarioId, alcadas.map(({ modulo, acao, permitido }) => ({ modulo, acao, permitido })));
      onSalvo(`Alçadas do caixa de ${nome} salvas.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="admin-panel" style={{ margin: '8px 0 12px', padding: '14px 16px' }}>
      <p style={{ margin: '0 0 10px', fontSize: 13, opacity: 0.8 }}>O que <strong>{nome}</strong> pode autorizar no caixa:</p>
      {!alcadas && !erro && <p className="empty-state">Carregando…</p>}
      {alcadas?.map((a, i) => (
        <label key={`${a.modulo}:${a.acao}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={a.permitido}
            disabled={salvando}
            onChange={(e) => setAlcadas(alcadas.map((x, j) => (j === i ? { ...x, permitido: e.target.checked } : x)))}
            style={{ width: 18, height: 18, marginTop: 2 }}
          />
          <span><strong>{a.rotulo}</strong><br /><small style={{ opacity: 0.65 }}>{a.descricao}</small></span>
        </label>
      ))}
      {erro && <p role="alert" className="admin-message admin-error">{erro}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="admin-primary" disabled={!alcadas || salvando} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" className="admin-secondary" disabled={salvando} onClick={onFechar}>Cancelar</button>
        <small style={{ opacity: 0.55 }}>Fica registrado na auditoria. Ninguém altera as próprias alçadas.</small>
      </div>
    </div>
  );
}
