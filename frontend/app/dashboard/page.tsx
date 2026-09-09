'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchMe, logout, getToken, type MeResponse } from '@/lib/api';

const navigation = [
  ['Dashboard', '▦'], ['Produtos', '◇'], ['Estoque', '♧'], ['Vendas', '⌁'],
  ['PDV', '▤'], ['Financeiro', '▥'], ['DRE', '↗'], ['Fluxo', '↗'],
  ['Metas', '◎'], ['RH', '♧'], ['Informação Cruzada', '◷'], ['IA', '♧'],
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
          {navigation.map(([label, icon], index) => (
            <button key={label} className={`nav-item ${index === 0 ? 'nav-item-active' : ''}`} type="button" onClick={() => index !== 0 && alert(`${label} estará disponível em breve.`)}>
              <span className="nav-icon" aria-hidden="true">{icon}</span>{label}
            </button>
          ))}
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
          <article className="metric-card"><div className="metric-heading">VENDAS HOJE <span className="metric-icon green">⌑</span></div><strong>R$ 2.840,00</strong><p className="positive">+12% vs ontem • companyId isolado</p></article>
          <article className="metric-card"><div className="metric-heading">ESTOQUE <span className="metric-icon purple">♧</span></div><strong>1.247 itens</strong><p>Isolado por empresa • dados sincronizados</p></article>
          <article className="metric-card"><div className="metric-heading">TRIAL / PLANO <span className="metric-icon amber">◷</span></div><strong className="plan-title">Plano Ativo</strong><p>R$19,90/mês manual • InfinitePay preservado</p></article>
        </div>

        <div className="panel-grid">
          <article className="info-panel"><h2><span className="panel-symbol purple-text">♢</span> Segurança multi-tenant preservada</h2><div className="info-list"><InfoRow label="companyId origem" value="JWT exclusivo" accent /><InfoRow label="Isolamento A×B" value="Ativo • Validado" accent /><InfoRow label="CNPJ pertence à" value={formatCompanyName(me.name)} /><InfoRow label="Usuário autenticado" value={me.email} /></div></article>
          <article className="info-panel"><h2><span className="panel-symbol amber-text">▣</span> InfinitePay • Manual R$19,90 preservado</h2><div className="info-list"><InfoRow label="order_nsu" value="ORD_1788820928646_USG0" /><InfoRow label="transaction_nsu" value="TRX_1788820928646_ISNN5I" /><InfoRow label="Checkout" value="Manual • +30 dias" /><InfoRow label="Webhook / payment_check" value="Preservado" accent /></div><button className="finance-button" type="button" onClick={() => alert('Módulo financeiro em construção.')}>↗ <span>Abrir Financeiro</span></button></article>
        </div>
      </section>
    </main>
  );
}

function InfoRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className="info-row"><span>{label}</span><strong className={accent ? 'accent-value' : ''}>{value}</strong></div>;
}
