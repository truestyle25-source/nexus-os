'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { t as traduzir } from '@/lib/i18n';
import { estiloLabel } from './Modal';

/** Integrações PDV (seção 14) — funcionalidade original da página, mantida:
 * listar, criar (só tipos oficiais) e sincronizar (recusa honestamente). */
export default function IntegracoesPDV() {
  const [integracoes, setIntegracoes] = useState<any[]>([]);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('API_OFICIAL');
  const [url, setUrl] = useState('');
  const [salvando, setSalvando] = useState(false);
  const salvandoRef = useRef(false);
  const [erro, setErro] = useState<string | null>(null);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const { data } = await api.get('/pdv/integracoes');
      setIntegracoes(data ?? []);
      setErroCarregamento(null);
    } catch (err: any) {
      setIntegracoes([]);
      setErroCarregamento(err.response?.data?.error || 'Não foi possível carregar as integrações PDV.');
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function criar() {
    setErro(null); setOk(null);
    if (salvandoRef.current) return;
    if (!nome || nome.trim().length < 2) { setErro('Informe o nome da integração.'); return; }
    if (!url.trim()) { setErro('Informe a URL oficial da integração.'); return; }
    try {
      new URL(url.trim());
    } catch {
      setErro('Informe uma URL válida para a integração.');
      return;
    }
    salvandoRef.current = true;
    setSalvando(true);
    try {
      await api.post('/pdv/integracoes', { nome: nome.trim(), tipo, url: url.trim() || undefined });
      setNome(''); setUrl('');
      setOk('Integração registrada. Configure as credenciais com o fornecedor oficial antes de sincronizar.');
      await carregar();
    } catch (err: any) { setErro(err.response?.data?.error || 'Não foi possível criar a integração.'); }
    finally { salvandoRef.current = false; setSalvando(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <label style={estiloLabel}>{traduzir('nome', "Nome")}<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: PDV Principal" style={{ minWidth: 180 }} /></label>
        <label style={estiloLabel}>{traduzir('tipo', "Tipo")}<select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ minWidth: 190 }}>
            <option value="API_OFICIAL">API oficial do fabricante</option>
            <option value="SDK_OFICIAL">SDK oficial do fabricante</option>
            <option value="WEBHOOK_OFICIAL">Webhook oficial do fabricante</option>
            <option value="BANCO_AUTORIZADO">Banco autorizado oficial</option>
          </select>
        </label>
        <label style={estiloLabel}>URL oficial<input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." style={{ minWidth: 200 }} /></label>
        <button className="admin-primary" type="button" disabled={salvando} onClick={criar}>{salvando ? 'Salvando…' : '+ Nova integração PDV'}</button>
      </div>
      {erro && <p className="admin-message admin-error">{erro}</p>}
      {ok && <p className="admin-message admin-success">{ok}</p>}
      {erroCarregamento && <p className="admin-message admin-error">{erroCarregamento}</p>}
      {!erroCarregamento && integracoes.length === 0 ? <p className="empty-state">Nenhuma integração configurada ainda.</p> : null}
      {integracoes.length > 0 && (
        <div className="admin-table">
          {integracoes.map((i: any) => (
            <div key={i.id} className="admin-list-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <strong>{i.nome}</strong>
                <span>{i.tipo} · Status: {i.status} · última sync: {i.ultimaSincronizacao ? new Date(i.ultimaSincronizacao).toLocaleString('pt-BR') : 'nunca'}</span>
              </div>
              <button type="button" className="admin-secondary" style={{ flexShrink: 0, opacity: 0.5, cursor: 'not-allowed' }} disabled title="Disponível quando uma integração oficial com credenciais for implementada">Sincronização indisponível</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
