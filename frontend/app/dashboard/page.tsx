'use client';

import { useEffect, useState } from 'react';
<<<<<<< HEAD
import { api } from '../../lib/api';

type DashboardData = Record<string, any>;

const endpoints: Record<string, string> = {
  empresa: '/empresas',
  vendas: '/vendas/dashboard',
  estoque: '/estoque',
  financeiro: '/financeiro',
  rh: '/rh/indicadores',
  ia: '/ia/intelligence-center',
  dre: '/dre',
  roi: '/roi',
  metas: '/metas',
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData>({});
  const [erro, setErro] = useState('');

  useEffect(() => {
    Promise.all(
      Object.entries(endpoints).map(async ([key, url]) => {
        try {
          const response = await api.get(url);
          return [key, response.data] as const;
        } catch {
          return [key, null] as const;
        }
      }),
    )
      .then((rows) => {
        const next = Object.fromEntries(rows);
        setData(next);
        if (Object.values(next).every((value) => value === null)) {
          setErro('Não foi possível carregar os dados do dashboard.');
        }
      })
      .catch(() => setErro('Não foi possível carregar o dashboard.'));
  }, []);

  const vendas = data.vendas || {};
  const estoque = data.estoque?.indicadores || {};
  const financeiro = data.financeiro?.fluxo || {};
  const rh = data.rh || {};
  const ia = data.ia || {};
  const dre = data.dre?.dre || {};
  const roi = data.roi || {};
  const metas = Array.isArray(data.metas?.metas) ? data.metas.metas : [];
  const metasEmAndamento = metas.filter((meta: any) => meta.status === 'EM_ANDAMENTO').length;

  const cards: Array<[string, string | number]> = [
    ['Faturamento', `R$ ${Number(vendas.faturamento || 0).toFixed(2)}`],
    ['Vendas', Number(vendas.qtdVendas || 0)],
    ['Ticket médio', `R$ ${Number(vendas.ticketMedio || 0).toFixed(2)}`],
    ['Crescimento', `${Number(vendas.crescimento || 0).toFixed(2)}%`],
    ['Estoque', `R$ ${Number(estoque.valorTotal || 0).toFixed(2)}`],
    ['Receitas', `R$ ${Number(financeiro.receitas || 0).toFixed(2)}`],
    ['Despesas', `R$ ${Number(financeiro.despesas || 0).toFixed(2)}`],
    ['Resultado', `R$ ${Number(financeiro.resultado || 0).toFixed(2)}`],
    ['Funcionários', Number(rh.ativos || 0)],
    ['Alertas IA', Array.isArray(ia.problemas) ? ia.problemas.length : 0],
    ['Resultado DRE', `R$ ${Number(dre.lucroPrejuizo || 0).toFixed(2)}`],
    ['Margem líquida', `${Number(dre.margemLiquida || 0).toFixed(2)}%`],
    ['ROI', `${Number(roi.roi || 0).toFixed(2)}%`],
    ['Metas em andamento', metasEmAndamento],
  ];

  return (
    <main style={{ padding: 20 }}>
      <h1>NEXUS OS - DASHBOARD</h1>
      {erro && <p>{erro}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginTop: 20 }}>
        {cards.map(([label, value]) => (
          <section key={label} style={{ border: '1px solid #ddd', padding: 16, borderRadius: 8 }}>
            <strong>{label}</strong>
            <div style={{ fontSize: 22, marginTop: 8 }}>{value}</div>
          </section>
        ))}
      </div>

      <section style={{ marginTop: 20 }}>
        <h2>Intelligence Center</h2>
        <pre style={{ background: '#111', padding: 20, overflow: 'auto' }}>
          {JSON.stringify({
            oQueAconteceu: ia.oQueAconteceu,
            oQueMudou: ia.oQueMudou,
            problemas: ia.problemas,
            oportunidades: ia.oportunidades,
            recomendacoes: ia.recomendacoes,
          }, null, 2)}
        </pre>
      </section>

      <div style={{ marginTop: 20 }}>
        <a href="/usuarios">USUÁRIOS</a>
        {' | '}
        <a href="/auditoria" style={{ marginLeft: 10 }}>AUDITORIA</a>
      </div>
    </main>
  );
}
=======
import { useRouter } from 'next/navigation';
import { fetchMe, logout, getToken, type MeResponse } from '@/lib/api';

const navigation = [
  ['Dashboard', '▦'], ['Produtos', '◇'], ['Estoque', '♧'], ['Vendas', '⌁'],
  ['PDV', '▤'], ['Financeiro', '▥'], ['DRE', '↗'], ['Fluxo', '↗'],
  ['Metas', '◎'], ['RH', '♧'], ['Informação Cruzada', '◷'], ['IA', '♧'], ['Configurações', '⚙'],
];

function formatCompanyName(name: string) {
  return name.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    fetchMe()
      .then(setMe)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Sessão inválida');
        void logout();
        setTimeout(() => router.replace('/'), 1500);
      });
  }, [router]);

  function handleLogout() {
    void logout();
    router.replace('/');
  }

  if (error) return <main className="dashboard-state">{error} - redirecionando para o login...</main>;
  if (!me) return <main className="dashboard-state">Carregando...</main>;

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><svg width="21" height="21" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h7l-1 8 11-14h-8l1-6z" /></svg></div>
          <div><strong>NEXUS OS</strong><span>TRUE STYLE</span></div>
        </div>
        <nav className="main-nav" aria-label="Navegação principal">
          {navigation.map(([label, icon], index) => {
            const available = label === 'Dashboard' || label === 'Produtos' || label === 'Configurações';
            if (!available) return <div key={label} className="nav-item nav-item-disabled" aria-disabled="true"><span className="nav-icon" aria-hidden="true">{icon}</span>{label}</div>;
            return <button key={label} className={`nav-item ${index === 0 ? 'nav-item-active' : ''}`} type="button" onClick={() => label === 'Configurações' ? router.push('/admin') : label === 'Produtos' ? router.push('/products') : undefined}><span className="nav-icon" aria-hidden="true">{icon}</span>{label}</button>;
          })}
        </nav>
        <button className="logout-button" type="button" onClick={handleLogout}>↪ <span>Sair</span></button>
      </aside>

      <section className="dashboard-content">
        <header className="dashboard-header">
          <div>
            <h1>Dashboard</h1>
            <p>Empresa: {formatCompanyName(me.name)} <span>•</span> Usuário: {me.email} <span>•</span> companyId via JWT</p>
          </div>
          <div className="header-status"><span className="status-pill"><i /> Ativo</span><span className="payment-pill">3 pagamentos</span></div>
        </header>

        <div className="metric-grid">
          <article className="metric-card"><div className="metric-heading">VENDAS HOJE <span className="metric-icon green">⌑</span></div><strong>Sem dados</strong><p>Nenhuma venda registrada</p></article>
          <article className="metric-card"><div className="metric-heading">ESTOQUE <span className="metric-icon purple">♧</span></div><strong>Sem dados</strong><p>Módulo de estoque ainda não configurado</p></article>
          <article className="metric-card"><div className="metric-heading">TRIAL / PLANO <span className="metric-icon amber">◷</span></div><strong className="plan-title">Não configurado</strong><p>Nenhuma assinatura cadastrada</p></article>
        </div>

        <div className="panel-grid">
          <article className="info-panel"><h2><span className="panel-symbol purple-text">♢</span> Segurança multi-tenant preservada</h2><div className="info-list"><InfoRow label="companyId origem" value="JWT exclusivo" accent /><InfoRow label="Isolamento A×B" value="Ativo • Validado" accent /><InfoRow label="CNPJ pertence à" value={formatCompanyName(me.name)} /><InfoRow label="Usuário autenticado" value={me.email} /></div></article>
          <article className="info-panel"><h2><span className="panel-symbol amber-text">▣</span> Integração de pagamentos</h2><div className="info-list"><InfoRow label="Status" value="Não configurado" /><InfoRow label="Última sincronização" value="Sem dados" /><InfoRow label="Checkout" value="Aguardando configuração oficial" /><InfoRow label="Webhook / payment_check" value="Não configurado" accent /></div><p className="integration-note">Nenhum provedor oficial foi configurado.</p></article>
        </div>
      </section>
    </main>
  );
}

function InfoRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className="info-row"><span>{label}</span><strong className={accent ? 'accent-value' : ''}>{value}</strong></div>;
}
>>>>>>> 9a24c34c6d11c3f2872b796a0c1af740ba42af22
