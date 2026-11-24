'use client';
// Retorno do usuário sobre cada resposta da NEXUS AI (correta / incorreta), registrado para revisão.
import { useState } from 'react';
import { Check, ThumbsDown, ThumbsUp } from 'lucide-react';
import { nexusAi } from '@/lib/nexus-ai';

type Valor = 'CORRETA' | 'INCORRETA';
const pilula = (ativo: boolean) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', borderRadius: 999, fontSize: 11, cursor: 'pointer',
  border: `1px solid ${ativo ? 'var(--nx-accent)' : 'var(--nx-border)'}`, background: ativo ? 'var(--nx-surface-2)' : 'transparent', color: ativo ? 'var(--nx-ink)' : 'var(--nx-ink-3)',
} as const);

export function AvaliarResposta({ execucaoId, inicial }: { execucaoId: string; inicial: Valor | null }) {
  const [valor, setValor] = useState<Valor | null>(inicial);
  const [comentando, setComentando] = useState(false);
  const [comentario, setComentario] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState(false);

  async function enviar(v: Valor, texto?: string) {
    setErro(false);
    try { await nexusAi.avaliar(execucaoId, v, texto); setValor(v); setEnviado(Boolean(texto) || v === 'CORRETA'); }
    catch { setErro(true); }
  }

  return (
    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--nx-ink-3)' }}>
      <span>A resposta está correta?</span>
      <button type="button" aria-pressed={valor === 'CORRETA'} style={pilula(valor === 'CORRETA')} onClick={() => { setComentando(false); void enviar('CORRETA'); }}><ThumbsUp size={12} />Correta</button>
      <button type="button" aria-pressed={valor === 'INCORRETA'} style={pilula(valor === 'INCORRETA')} onClick={() => { setComentando(true); void enviar('INCORRETA'); }}><ThumbsDown size={12} />Incorreta</button>
      {comentando && valor === 'INCORRETA' && !enviado && (
        <form style={{ display: 'flex', gap: 6, flexBasis: '100%', minWidth: 0 }} onSubmit={(e) => { e.preventDefault(); void enviar('INCORRETA', comentario.trim()); setComentando(false); }}>
          <input value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={500} placeholder="O que estava errado? (opcional)" aria-label="O que estava errado"
            style={{ flex: 1, minWidth: 0, height: 28, borderRadius: 8, border: '1px solid var(--nx-border)', background: 'var(--nx-surface-2)', color: 'var(--nx-ink)', padding: '0 8px', fontSize: 12 }} />
          <button type="submit" style={pilula(true)}>Enviar</button>
        </form>
      )}
      {enviado && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={12} />Obrigado, registrado para revisão.</span>}
      {erro && <span role="alert" style={{ color: 'var(--nx-danger,#dc2626)' }}>Não foi possível registrar.</span>}
    </div>
  );
}
