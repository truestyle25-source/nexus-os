'use client';

import { useEffect, useState } from 'react';
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
