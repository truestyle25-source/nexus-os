'use client';
import { useState } from 'react';
import api from '@/lib/api';

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [log, setLog] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setLog('');
    try {
      await api.post('/auth/recuperar-senha', { email });
      setEnviado(true);
    } catch (err: any) {
      setLog(err.response?.data?.error || 'Erro ao solicitar recuperação de senha.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card card">
        <div className="auth-brand">
          <div className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h7l-1 8 11-14h-8l1-6z" /></svg>
          </div>
          <strong>NEXUS OS</strong>
        </div>
        <p className="auth-subtitle">Recuperar senha</p>

        {enviado ? (
          <div className="auth-message success">
            Se o e-mail informado existir em nossa base, você receberá em instantes uma mensagem com um link para
            criar uma nova senha (válido por 1 hora).
          </div>
        ) : (
          <form onSubmit={enviar}>
            <div className="auth-field">
              <label>E-mail de acesso</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <button type="submit" className="auth-primary" disabled={carregando || !email}>
              {carregando ? 'ENVIANDO...' : 'ENVIAR INSTRUÇÕES'}
            </button>
            {log && <div className="auth-message error">{log}</div>}
          </form>
        )}
        <a href="/" className="auth-link">Voltar para o login</a>
      </div>
    </div>
  );
}
