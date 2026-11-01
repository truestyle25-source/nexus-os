'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { getToken } from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';
import { t as traduzir, tMenu } from '@/lib/i18n';

export default function Pesquisa() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!getToken()) router.replace('/'); }, [router]);

  async function pesquisar(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true); setError(null);
    try {
      const { data } = await api.get(`/pesquisa-global?q=${encodeURIComponent(q)}`);
      setRes(data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível pesquisar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-page">
      <ModuleHeader title="Pesquisa global" subtitle="Busca em produtos, clientes, funcionários, fornecedores, vendas e documentos — respeitando suas permissões." />
      {error && <p className="admin-message admin-error">{error}</p>}

      <section className="admin-panel admin-wide">
        <form onSubmit={pesquisar} className="admin-inline">
          <label style={{ flex: 1, minWidth: 240 }}>{traduzir('buscar', "Buscar")}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, SKU, e-mail, CPF..." /></label>
          <button className="admin-primary" type="submit" disabled={loading}>{loading ? 'Buscando...' : 'Pesquisar'}</button>
        </form>
        {res && <pre className="admin-pre" style={{ marginTop: 16 }}>{JSON.stringify(res, null, 2)}</pre>}
      </section>
    </main>
  );
}
