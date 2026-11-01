'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';
import {
  Panel,
  SectionTitle,
  EmptyState,
} from '@/components/ui';
import { formatBRL, formatDate } from '@/lib/format';
import { t as traduzir, tMenu } from '@/lib/i18n';

/**
 * Assinatura — dados REAIS do endpoint existente (GET /assinatura).
 * O card "Meu Plano" reflete a assinatura da empresa logada; o comparativo
 * de planos permanece em preparação (sem preços inventados).
 */
interface Assinatura {
  id: string;
  status: string;
  valorMensal: string | number;
  trialInicio?: string | null;
  trialFim?: string | null;
  proximaCobranca?: string | null;
  checkoutUrl?: string | null;
}

const RECURSOS = [
  'Usuários ilimitados',
  'Produtos',
  'PDV',
  'Fiscal',
  'IA',
  'Relatórios',
];

export default function AssinaturaPage() {
  const [assinatura, setAssinatura] = useState<Assinatura | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [semAssinatura, setSemAssinatura] = useState(false);
  /**
   * Checkout: o endpoint POST /assinatura/checkout NÃO libera acesso — ele
   * devolve o endereço da cobrança para o usuário concluir o pagamento na
   * plataforma oficial. O estado abaixo guarda apenas esse endereço, e o botão
   * só abre a janela depois que o servidor devolveu a URL de verdade.
   */
  const [checkout, setCheckout] = useState<{ checkoutUrl: string; aviso: string } | null>(null);
  const [abrindoCheckout, setAbrindoCheckout] = useState(false);
  const [erroCheckout, setErroCheckout] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Assinatura>('/assinatura')
      .then(({ data }) => setAssinatura(data))
      .catch((err: any) => {
        const msg = String(err?.message || '');
        if (/não encontrada/i.test(msg)) setSemAssinatura(true);
        else setErro(msg || 'Não foi possível carregar a assinatura.');
      })
      .finally(() => setLoading(false));
  }, []);

  /**
   * Abre a cobrança. Não inventa URL: chama o backend e só navega se ele
   * devolver um `checkoutUrl`. Se a cobrança não estiver configurada no
   * servidor, o 503 é mostrado — nada de abrir uma página em branco.
   */
  async function abrirCheckout() {
    setErroCheckout(null);
    setAbrindoCheckout(true);
    try {
      const { data } = await api.post<{ checkoutUrl: string; aviso: string }>('/assinatura/checkout', {});
      if (data?.checkoutUrl) {
        setCheckout(data);
        // `window.open` DEPOIS do `await` cai fora da pilha do gesto do usuário:
        // o bloqueador de pop-ups do Chrome/Firefox recusa a abertura e a
        // aba simplesmente não abre — sem erro, sem aviso, botão "funcionando"
        // e nada acontecendo. A tentativa é mantida (o navegador permite em
        // alguns casos), mas o endereço também é renderizado como link
        // real logo abaixo, para que a cobrança seja sempre alcançável.
        window.open(data.checkoutUrl, '_blank', 'noopener,noreferrer');
      } else {
        setErroCheckout('O servidor não devolveu um endereço de cobrança.');
      }
    } catch (err: any) {
      setErroCheckout(
        err instanceof Error ? err.message : 'Não foi possível iniciar a cobrança.',
      );
    } finally {
      setAbrindoCheckout(false);
    }
  }

  if (loading) {
    return (
      <main className="p-6 md:p-8 space-y-5 max-w-[1400px] mx-auto">
        <ModuleHeader title="Assinatura" />
        <div className="h-64 bg-[#1A1A2E] border border-white/[0.06] rounded-[16px] animate-pulse" />
      </main>
    );
  }

  return (
    <main className="p-6 md:p-8 space-y-5 max-w-[1400px] mx-auto">
      <ModuleHeader
        kicker="Sistema"
        title="Assinatura"
        subtitle="Status real do plano da empresa, cobrança e recursos — sincronizado com o backend."
      />

      {erro && (
        <div className="rounded-[12px] bg-red-500/10 border border-red-500/20 text-red-300 text-[13px] px-4 py-3">
          {erro}
        </div>
      )}

      {semAssinatura && !erro && (
        <EmptyState
          title="Nenhuma assinatura encontrada para esta empresa"
          description="O registro de assinatura é criado automaticamente no cadastro da empresa. Se este aviso persistir, contate o suporte."
        />
      )}

      {assinatura && (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
          {/* Card do plano (gradiente do mestre) */}
          <div className="bg-gradient-to-br from-[#7C3AED] to-[#4F46E5] rounded-[20px] p-5 text-white relative overflow-hidden">
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-[1px]" />
            <div className="relative">
              <div className="text-[11px] uppercase tracking-[0.14em] opacity-70">
                Meu Plano
              </div>
              <div className="text-[26px] font-bold mt-1">NEXUS OS</div>
              <div className="mt-4 space-y-2 text-[13px]">
                <div className="flex justify-between items-center">
                  <span className="opacity-70">{traduzir('status', "Status")}</span>
                  <span className="px-2 py-0.5 rounded-full bg-white text-[#7C3AED] text-[11px] font-bold">
                    {assinatura.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">{traduzir('valor', "Valor")}</span>
                  <span className="font-semibold">
                    {formatBRL(Number(assinatura.valorMensal ?? 0))}
                  </span>
                </div>
                {assinatura.trialFim && (
                  <div className="flex justify-between">
                    <span className="opacity-70">Trial até</span>
                    <span>{formatDate(assinatura.trialFim)}</span>
                  </div>
                )}
                {assinatura.proximaCobranca && (
                  <div className="flex justify-between">
                    <span className="opacity-70">Próxima cobrança</span>
                    <span>{formatDate(assinatura.proximaCobranca)}</span>
                  </div>
                )}
              </div>
              <div className="mt-5">
                <div className="text-[11px] uppercase opacity-70 mb-2">
                  Recursos inclusos
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {RECURSOS.map((r) => (
                    <span
                      key={r}
                      className="px-2.5 py-1 rounded-full bg-white/15 border border-white/15 text-[11px]"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Detalhes reais da assinatura */}
          <Panel>
            <SectionTitle kicker="Assinatura">
              Detalhes da cobrança
            </SectionTitle>
            <div className="mt-4 space-y-2">
              {[
                { k: 'Status', v: assinatura.status },
                {
                  k: 'Valor mensal',
                  v: formatBRL(Number(assinatura.valorMensal ?? 0)),
                },
                {
                  k: 'Início do trial',
                  v: assinatura.trialInicio
                    ? formatDate(assinatura.trialInicio)
                    : '—',
                },
                {
                  k: 'Fim do trial',
                  v: assinatura.trialFim
                    ? formatDate(assinatura.trialFim)
                    : '—',
                },
                {
                  k: 'Próxima cobrança',
                  v: assinatura.proximaCobranca
                    ? formatDate(assinatura.proximaCobranca)
                    : '—',
                },
              ].map((row) => (
                <div
                  key={row.k}
                  className="flex justify-between rounded-[10px] bg-[#121221] border border-white/[0.05] px-3 py-2.5 text-[13px]"
                >
                  <span className="text-white/50">{row.k}</span>
                  <span className="text-white/80 font-medium">{row.v}</span>
                </div>
              ))}
            </div>
            {/* Cobrança — ação real: chama POST /assinatura/checkout, que
                devolve o endereço da cobrança configurado no servidor. Se não
                houver cobrança configurada, o backend responde 503 e a tela
                mostra a verdade, em vez de simular sucesso. */}
            <div className="mt-4 border-t border-white/[0.06] pt-4">
              <button
                type="button"
                onClick={abrirCheckout}
                disabled={abrindoCheckout}
                className="h-10 px-5 rounded-[10px] bg-[#7C3AED] hover:bg-[#6B4FE0] text-white text-[12.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                {abrindoCheckout ? 'Abrindo cobrança…' : 'Ir para a cobrança'}
              </button>
              {erroCheckout && (
                <p role="alert" className="mt-2 text-[12px] text-red-300">
                  {erroCheckout}
                </p>
              )}
              {checkout && !erroCheckout && (
                <p className="mt-2 text-[11px] text-white/40 leading-relaxed">
                  Endereço de cobrança liberado pelo servidor:{' '}
                  {/* Link real, e não só texto: se o bloqueador de pop-ups
                      recusou a aba nova (o `window.open` roda depois do `await`),
                      é por aqui que o gestor chega na cobrança de fato. */}
                  <a
                    href={checkout.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/70 underline underline-offset-2 break-all hover:text-white"
                  >
                    {checkout.checkoutUrl}
                  </a>
                  {checkout.aviso ? ` — ${checkout.aviso}` : ''}
                </p>
              )}
            </div>
            <p className="mt-4 text-[11px] text-white/25 leading-relaxed">
              A confirmação de pagamento é feita pela integração oficial de
              cobrança — o acesso nunca é liberado por clique manual.
            </p>
          </Panel>
        </div>
      )}

      <Panel>
        <SectionTitle>Planos • Start • Pro • Enterprise</SectionTitle>
        <EmptyState
          className="mt-4"
          title="Comparativo de planos em preparação"
          description="A comparação detalhada entre planos (recursos e limites) será publicada junto com a integração de cobrança."
        />
      </Panel>
    </main>
  );
}


