'use client';
/** Promoções do clube escolhido (mockup 03): só as ativas, com o preço calculado pelo servidor. */
import { useEffect, useState } from 'react';
import { clubApi, type PromocaoVitrine } from '@/lib/club/api';
import { AppClube, SeletorClube, useMeusClubes, useSessaoClube } from '@/components/club/AppClube';
import { CartaoPromocao } from '@/components/club/CartaoPromocao';
import { Aviso } from '@/components/club/ui';

export default function PromocoesClube() {
  const { eu, erro } = useSessaoClube();
  const { clubes, selecionado, escolher } = useMeusClubes(!!eu);
  const [promos, setPromos] = useState<PromocaoVitrine[] | null>(null);
  const [filtro, setFiltro] = useState<'todas' | 'membros'>('todas');

  useEffect(() => {
    setPromos(null);
    if (!selecionado) return;
    clubApi.promocoes(selecionado).then(setPromos).catch(() => setPromos([]));
  }, [selecionado]);

  const lista = promos?.filter((p) => filtro === 'todas' || p.tipo === 'MEMBROS') ?? null;
  return (
    <AppClube eu={eu} titulo="Promoções" carregando={!eu && !erro}>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {clubes && clubes.length === 0 && <p className="text-[14px] text-[#8B8BA7]">Entre no clube de uma loja para ver as promoções dela.</p>}
      {clubes && clubes.length > 0 && (
        <>
          <SeletorClube clubes={clubes} selecionado={selecionado} escolher={escolher} />
          <div className="flex gap-2 mt-4">
            {(['todas', 'membros'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFiltro(f)} aria-pressed={filtro === f}
                className={`h-8 px-3 rounded-full text-[12px] font-semibold border ${filtro === f ? 'border-[#7C3AED] text-white bg-[#7C3AED]/25' : 'border-[#2A2A3E] text-[#8B8BA7]'}`}>
                {f === 'todas' ? 'Todas' : '★ Só para membros'}
              </button>
            ))}
          </div>
          <div className="mt-4">
            {lista == null && <p className="text-[13px] text-[#8B8BA7]">Carregando…</p>}
            {lista?.length === 0 && <p className="text-[13px] text-[#8B8BA7]">Nenhuma promoção ativa nesta loja agora.</p>}
            <div className="grid grid-cols-2 gap-3">
              {lista?.map((p) => <CartaoPromocao key={p.id} p={p} />)}
            </div>
            <p className="mt-5 text-[11.5px] text-[#6B6B88]">Preços e validade definidos pela loja. No caixa, vale o preço calculado na hora da compra.</p>
          </div>
        </>
      )}
    </AppClube>
  );
}
