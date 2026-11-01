'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { getToken } from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';

export default function Intelligence() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return; }
    api.get('/ia/intelligence-center')
      .then(({ data }) => setData(data))
      .catch((err) => setError(err.response?.data?.error || 'Não foi possível carregar o Intelligence Center.'))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <main className="admin-page"><ModuleHeader title="Informação cruzada" /><p className="empty-state">Carregando...</p></main>;

  return (
    <main className="admin-page">
      <ModuleHeader title="Informação cruzada" subtitle="O que aconteceu, o que mudou, problemas e oportunidades — cruzando vendas, estoque, financeiro e metas da empresa." />
      {error && <p className="admin-message admin-error">{error}</p>}

      {data && (
        <>
          <section className="admin-panel admin-wide">
            <h2>O que aconteceu</h2>
            <pre className="admin-pre">{JSON.stringify(data.oQueAconteceu, null, 2)}</pre>
          </section>

          <section className="admin-panel admin-wide" style={{ marginTop: 16 }}>
            <h2>Problemas ({data.problemas?.length ?? 0})</h2>
            {(!data.problemas || data.problemas.length === 0) ? <p className="empty-state">Nenhum problema identificado.</p> : (
              <div className="admin-table">
                {data.problemas.map((p: any, i: number) => (
                  <div key={i} className="admin-list-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                    <strong>{p.tipo}</strong>
                    <span>{p.problema}</span>
                    <span>Causa: {p.possivelCausa}</span>
                    <span>Impacto: {p.impacto}</span>
                    <span>Recomendação: {p.recomendacao}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="admin-panel admin-wide" style={{ marginTop: 16 }}>
            <h2>Oportunidades ({data.oportunidades?.length ?? 0})</h2>
            {(!data.oportunidades || data.oportunidades.length === 0) ? <p className="empty-state">Nenhuma oportunidade identificada.</p> : (
              <div className="admin-table">
                {data.oportunidades.map((o: any, i: number) => (
                  <div key={i} className="admin-list-row"><strong>{o.tipo}</strong><span>{o.descricao}</span></div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
