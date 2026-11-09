'use client';

import { useState } from 'react';
import api from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';
import {
  TabsPill,
  Panel,
  SectionTitle,
  EmptyState,
} from '@/components/ui';
import IaCriadoraRelatorios from '@/components/relatorios/IaCriadoraRelatorios';
import FormularioDisc from '@/components/relatorios/FormularioDisc';

/**
 * Central de Relatórios — estrutura do Layout Mestre + gerador por IA
 * (Seção 33): a barra IA NEXUS cria relatórios reais via POST
 * /relatorios/ia/criar, renderiza o card com gráfico/insights/tabela e
 * permite exportar em CSV/Excel.
 *
 * A aba DISC é a única que não é um relatório de leitura: é a FONTE dos dados
 * de "PERFIL DISC" do Radar Organizacional. O questionário vem pronto do
 * backend (`GET /radar/disc/questionario`) e o cálculo dos percentuais roda no
 * servidor — o front apenas envia respostas e mostra o que voltou. As demais
 * abas permanecem vazias até a integração com as fontes por módulo.
 */
const TABS = [
  'Vendas',
  'Financeiro',
  'Estoque',
  'RH',
  'DRE',
  'Rentabilidade',
  'DISC',
] as const;

type Tab = (typeof TABS)[number];

export default function RelatoriosPage() {
  const [tab, setTab] = useState<Tab>('Vendas');
  const [exportando, setExportando] = useState<'csv' | 'excel' | null>(null);
  const [erroExport, setErroExport] = useState<string | null>(null);

  const fonteSuportada = tab === 'Vendas' || tab === 'Financeiro' || tab === 'Estoque';

  async function exportarFonte(formato: 'csv' | 'excel') {
    if (!fonteSuportada) return;
    setExportando(formato);
    setErroExport(null);
    try {
      const { data } = await api.post<{ base64: string; nome: string }>('/relatorios/export', {
        formato,
        fonte: tab.toLowerCase(),
      });
      const bytes = Uint8Array.from(atob(data.base64.trim()), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setErroExport(e instanceof Error ? e.message : 'Falha ao exportar o relatório.');
    } finally {
      setExportando(null);
    }
  }

  return (
    <main className="p-6 md:p-8 space-y-5 max-w-[1400px] mx-auto">
      <ModuleHeader
        kicker="Gestão"
        title="Relatórios"
        subtitle="Central de relatórios por área. A IA NEXUS monta relatórios a partir dos dados reais da empresa, com exportação para Excel e CSV."
      />

      <TabsPill
        variant="loose"
        items={TABS.map((t) => ({ key: t, label: t }))}
        value={tab}
        onChange={setTab}
      />

      <IaCriadoraRelatorios tab={tab} />

      {tab === 'DISC' ? (
        <Panel>
          <SectionTitle kicker="Central de Relatórios • Avaliação DISC">
            Avaliação de perfil comportamental
          </SectionTitle>
          <p className="mt-2 text-[12px] text-white/50">
            Questionário pronto, aplicado ao funcionário escolhido. O resultado fica
            disponível na seção <strong className="text-white/70">PERFIL DISC</strong> do Radar
            Organizacional e substitui a avaliação anterior, que continua no histórico.
          </p>
          <FormularioDisc />
        </Panel>
      ) : (
      <Panel>
        <SectionTitle
          kicker={`Central de Relatórios • ${tab}`}
          right={
            <div className="flex gap-2 items-center">
              {fonteSuportada ? (
                <>
                  <button
                    type="button"
                    onClick={() => void exportarFonte('csv')}
                    disabled={exportando !== null}
                    aria-label={`Exportar relatório de ${tab} em CSV`}
                    className="h-8 px-3 rounded-[10px] bg-white/[0.08] border border-white/15 text-[12px] text-white hover:bg-white/[0.12] transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {exportando === 'csv' ? 'Exportando…' : 'CSV'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void exportarFonte('excel')}
                    disabled={exportando !== null}
                    aria-label={`Exportar relatório de ${tab} em Excel`}
                    className="h-8 px-3 rounded-[10px] bg-[linear-gradient(135deg,#7c3aed,#4f46e5)] border border-[#7C3AED]/60 text-[12px] text-white hover:brightness-110 transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {exportando === 'excel' ? 'Exportando…' : 'Excel'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    title="Gere relatórios desta área usando a IA NEXUS acima"
                    className="h-8 px-3 rounded-[10px] bg-white/[0.06] border border-white/10 text-[12px] text-white/30 cursor-not-allowed flex items-center gap-1.5"
                  >
                    CSV <span className="text-[10px] text-white/20">via IA</span>
                  </button>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    title="Gere relatórios desta área usando a IA NEXUS acima"
                    className="h-8 px-3 rounded-[10px] bg-[#7C3AED]/40 border border-[#7C3AED]/30 text-[12px] text-white/40 cursor-not-allowed flex items-center gap-1.5"
                  >
                    Excel <span className="text-[10px] text-white/20">via IA</span>
                  </button>
                </>
              )}
            </div>
          }
        >
          Relatórios de {tab}
        </SectionTitle>

        {erroExport && (
          <p className="mt-2 text-[12px] text-[#ef4444]" role="alert">{erroExport}</p>
        )}

        <EmptyState
          className="mt-4"
          title={`Relatórios de ${tab.toLowerCase()} ${fonteSuportada ? 'disponíveis para exportação direta ou via IA' : 'disponíveis via IA'}`}
          description={`Use os botões de exportação acima para baixar os dados de ${tab.toLowerCase()} em Excel/CSV, ou digite uma pergunta na IA NEXUS para gerar uma análise personalizada com gráficos e insights.`}
        />
      </Panel>
      )}

      <p className="text-[11px] text-white/25">
        Sem números fictícios — tudo é calculado sobre os dados reais da
        empresa. O período é considerado o histórico completo, e cada relatório
        gerado pode ser exportado em CSV ou Excel.
      </p>
    </main>
  );
}

