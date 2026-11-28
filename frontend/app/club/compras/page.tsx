'use client';
/** Compras nesta loja: só as vendas que o caixa ligou a esta pessoa, desta loja. */
import { useEffect, useState } from 'react';
import { clubApi, dataCurta, reais } from '@/lib/club/api';
import { AppClube, Caixa, SeletorClube, useMeusClubes, useSessaoClube } from '@/components/club/AppClube';
import { Aviso } from '@/components/club/ui';

export default function ComprasClube() {
  const { eu, erro } = useSessaoClube();
  const { clubes, selecionado, clube, escolher } = useMeusClubes(!!eu);
  const [compras, setCompras] = useState<Array<{ id: string; data: string; total: number; desconto: number; itens: number }> | null>(null);

  useEffect(() => {
    setCompras(null);
    if (!selecionado || clube?.status !== 'ATIVO') return;
    clubApi.compras(selecionado).then(setCompras).catch(() => setCompras([]));
  }, [selecionado, clube?.status]);

  const total = compras?.reduce((s, c) => s + c.total, 0) ?? 0;

  return (
    <AppClube eu={eu} titulo="Compras" carregando={!eu && !erro}>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {clubes && clubes.length === 0 && <p className="text-[14px] text-[#8B8BA7]">Entre no clube de uma loja para ver suas compras lá.</p>}
      {clubes && clubes.length > 0 && <SeletorClube clubes={clubes} selecionado={selecionado} escolher={escolher} />}
      {clube?.status === 'PENDENTE_VINCULO' && <div className="mt-4"><Aviso>A loja está confirmando o seu cadastro. As compras aparecem depois.</Aviso></div>}
      {clube?.status === 'ATIVO' && (
        <div className="mt-4">
          {compras == null && <p className="text-[13px] text-[#8B8BA7]">Carregando…</p>}
          {compras?.length === 0 && <p className="text-[13px] text-[#8B8BA7]">Nenhuma compra identificada nesta loja ainda.</p>}
          {!!compras?.length && (
            <>
              <p className="text-[13px] text-[#8B8BA7] mb-2">{compras.length} {compras.length === 1 ? 'compra' : 'compras'} · {reais(total)}</p>
              <Caixa>
                {compras.map((c, i) => (
                  <div key={c.id} className={`flex items-center justify-between px-4 py-3 text-[14px] ${i ? 'border-t border-[#2A2A3E]' : ''}`}>
                    <div>
                      <p className="text-[#C9C9E0]">{dataCurta(c.data)} · {c.itens} {c.itens === 1 ? 'item' : 'itens'}</p>
                      {c.desconto > 0 && <p className="text-[12px] text-emerald-300">Desconto de {reais(c.desconto)}</p>}
                    </div>
                    <span className="font-bold">{reais(c.total)}</span>
                  </div>
                ))}
              </Caixa>
            </>
          )}
        </div>
      )}
    </AppClube>
  );
}
