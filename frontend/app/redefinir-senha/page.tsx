'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';

function FormularioRedefinicao() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [log, setLog] = useState('');
  const [ok, setOk] = useState(false);
  const [carregando, setCarregando] = useState(false);

  async function redefinir(e: React.FormEvent) {
    e.preventDefault();
    if (novaSenha.length < 8) { setLog('A senha precisa ter pelo menos 8 caracteres.'); return; }
    if (novaSenha !== confirmar) { setLog('As senhas não coincidem.'); return; }
    setCarregando(true);
    setLog('');
    try {
      await api.post('/auth/redefinir-senha', { token, novaSenha });
      setOk(true);
    } catch (err: any) {
      setLog(err.response?.data?.error || 'Token inválido ou expirado. Solicite a recuperação novamente.');
    } finally {
      setCarregando(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-message error">
        Link inválido: nenhum token de recuperação foi encontrado na URL. Solicite a recuperação de senha novamente.
      </div>
    );
  }

  if (ok) {
    return (
      <>
        <div className="auth-message success">Senha redefinida com sucesso.</div>
        <a href="/" className="auth-link">Ir para o login</a>
      </>
    );
  }

  return (
    <form onSubmit={redefinir}>
      <div className="auth-field">
        <label>Nova senha (mín. 8 caracteres)</label>
        <input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} autoComplete="new-password" required minLength={8} />
      </div>
      <div className="auth-field">
        <label>Confirme a nova senha</label>
        <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" required minLength={8} />
      </div>
      <button type="submit" className="auth-primary" disabled={carregando}>
        {carregando ? 'SALVANDO...' : 'REDEFINIR SENHA'}
      </button>
      {log && <div className="auth-message error">{log}</div>}
    </form>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card card">
        <div className="auth-brand">
          <div className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h7l-1 8 11-14h-8l1-6z" /></svg>
          </div>
          <strong>NEXUS OS</strong>
        </div>
        <p className="auth-subtitle">Criar nova senha</p>
        <Suspense fallback={<p style={{ color: 'var(--nexus-muted)', fontSize: 13 }}>Carregando...</p>}>
          <FormularioRedefinicao />
        </Suspense>
      </div>
    </div>
  );
}
