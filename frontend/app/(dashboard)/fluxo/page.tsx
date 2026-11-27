'use client';

/**
 * NEXUS OS — /fluxo: Fluxo de Caixa em 9 abas (layout aprovado em 26/11/2026).
 *
 * Tudo aqui lê o backend `/fluxo/*` (persistência real, permissão checada no
 * servidor e isolamento por empresa/filial). O bloco financeiro que existia
 * (lançamentos pagos + projeção) continua dentro da Visão geral.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, Building2, Clock3, CreditCard, FileText, History, LayoutDashboard,
  Receipt, Scale, ShieldCheck, Wallet,
} from 'lucide-react';
import api, { getToken } from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';
import { KpiCard, TabsPill, type TabItem } from '@/components/ui';
import { formatBRL } from '@/lib/format';
import {
  AbaAprovacoes, AbaBancaria, AbaCaixa, AbaCartoes, AbaConferencia, AbaFiscal, AbaHistorico,
  AbaTurnos, AbaVisaoGeral, Aviso, PERIODOS, type CaixaLinha, type PeriodoDias,
} from './abas';

type Aba = 'geral' | 'caixa' | 'conferencia' | 'fiscal' | 'historico' | 'bancaria' | 'cartoes' | 'aprovacoes' | 'turnos';

const ABAS: TabItem<Aba>[] = [
  { key: 'geral', label: 'Visão geral', icon: LayoutDashboard },
  { key: 'caixa', label: 'Caixa', icon: Wallet },
  { key: 'conferencia', label: 'Conferência', icon: Scale },
  { key: 'fiscal', label: 'Documentos fiscais', icon: FileText },
  { key: 'historico', label: 'Histórico', icon: History },
  { key: 'bancaria', label: 'Conciliação bancária', icon: Building2 },
  { key: 'cartoes', label: 'Cartões', icon: CreditCard },
  { key: 'aprovacoes', label: 'Aprovações', icon: ShieldCheck },
  { key: 'turnos', label: 'Turnos', icon: Clock3 },
];

type Visao = { kpis: { caixasAbertos: number; totalVendas: number; aguardandoAprovacao: number; divergencias: number }; caixas: CaixaLinha[] };

export default function FluxoCaixaPage() {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>('geral');
  const [dias, setDias] = useState<PeriodoDias>(30);
  const [visao, setVisao] = useState<Visao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [caixaId, setCaixaId] = useState<string>('');

  const params = useMemo(() => {
    const fim = new Date();
    return { inicio: new Date(fim.getTime() - dias * 86400000).toISOString(), fim: fim.toISOString() };
  }, [dias]);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const { data } = await api.get<Visao>('/fluxo/caixas', { params });
      setVisao(data);
    } catch (e) {
      setVisao(null);
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os caixas.');
    }
  }, [params]);

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return; }
    void carregar();
  }, [router, carregar]);

  // Quem é financeiro vê o bloco financeiro e as conciliações; o supervisor
  // de caixa vê só caixas, conferência, histórico, aprovações e turnos.
  // (O servidor barra do mesmo jeito; isto só evita abas que dariam 403.)
  const [financeiro, setFinanceiro] = useState<boolean | null>(null);
  useEffect(() => {
    if (!getToken()) return;
    api.get<{ financeiro: boolean }>('/fluxo/operadores').then((r) => setFinanceiro(r.data.financeiro)).catch(() => setFinanceiro(true));
  }, []);
  const abas = useMemo(() => ABAS.filter((a) => financeiro !== false || !['bancaria', 'cartoes'].includes(a.key)), [financeiro]);

  const abrirCaixa = useCallback((id: string, destino: Aba = 'caixa') => { setCaixaId(id); setAba(destino); }, []);
  const caixas = visao?.caixas ?? [];
  const k = visao?.kpis;

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8">
      <ModuleHeader
        kicker="Financeiro"
        title="Fluxo de caixa"
        subtitle="Caixas do PDV, conferência, documentos, conciliações, aprovações e turnos — tudo com dados reais da empresa."
        action={
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p.dias} type="button" onClick={() => setDias(p.dias)}
                className={`h-8 rounded-[10px] border px-3 text-[12.5px] transition ${dias === p.dias ? 'border-white bg-white font-medium text-black' : 'border-white/[0.08] bg-[#1A1A2E] text-white/50 hover:text-white'}`}>
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Caixas abertos" value={k ? String(k.caixasAbertos) : '—'} sub={k ? `${caixas.length} sessões no período` : undefined} icon={Wallet} iconTone="accent" />
        <KpiCard title="Vendas das sessões" value={k ? formatBRL(k.totalVendas) : '—'} sub="Somente vendas finalizadas" icon={Receipt} iconTone="emerald" />
        <KpiCard title="Aguardando aprovação" value={k ? String(k.aguardandoAprovacao) : '—'} sub="Solicitações abertas" icon={ShieldCheck} iconTone="amber" />
        <KpiCard title="Divergências" value={k ? String(k.divergencias) : '—'} sub="Caixas com diferença no fechamento" icon={AlertTriangle} iconTone="red" />
      </div>

      <TabsPill className="mt-6" items={abas} value={aba} onChange={setAba} />

      <section className="mt-5">
        {aba === 'geral' && <AbaVisaoGeral caixas={caixas} carregado={visao !== null} onAbrir={abrirCaixa} comFinanceiro={financeiro === true} />}
        {aba === 'caixa' && <AbaCaixa caixas={caixas} caixaId={caixaId} onCaixa={setCaixaId} />}
        {aba === 'conferencia' && <AbaConferencia caixas={caixas} caixaId={caixaId} onCaixa={setCaixaId} onMudou={carregar} />}
        {aba === 'fiscal' && <AbaFiscal />}
        {aba === 'historico' && <AbaHistorico caixas={caixas} caixaId={caixaId} onCaixa={setCaixaId} params={params} />}
        {aba === 'bancaria' && <AbaBancaria params={params} />}
        {aba === 'cartoes' && <AbaCartoes params={params} />}
        {aba === 'aprovacoes' && <AbaAprovacoes onMudou={carregar} />}
        {aba === 'turnos' && <AbaTurnos caixas={caixas} params={params} />}
      </section>
    </main>
  );
}
