'use client';
/**
 * Início do cliente (mockup 02): troca de clube, cartão "seu clube nesta loja" e últimas compras.
 * Só dados reais: benefício configurado pela loja e vendas ligadas a esta pessoa nesta loja.
 * Promoções entram na Fase 7.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clubApi, dataCurta, reais } from '@/lib/club/api';
import { AppClube, Caixa, Secao, SeletorClube, useMeusClubes, useSessaoClube } from '@/components/club/AppClube';
import { Aviso } from '@/components/club/ui';

type Compra = { id: string; data: string; total: number; itens: number };

export default function InicioClube() {
  const { eu, erro } = useSessaoClube();
  const { clubes, selecionado, clube, escolher, erro: erroClubes } = useMeusClubes(!!eu);
  const [compras, setCompras] = useState<Compra[] | null>(null);

  useEffect(() => {
    setCompras(null);
    if (!selecionado || clube?.status !== 'ATIVO') return;
    clubApi.compras(selecionado).then(setCompras).catch(() => setCompras([]));
  }, [selecionado, clube?.status]);

  return (
    <AppClube eu={eu} carregando={!eu && !erro}>
      {(erro || erroClubes) && <Aviso tom="erro">{erro || erroClubes}</Aviso>}
      {eu && (
        <>
          <h1 className="text-[22px] font-bold mt-1">Olá, {eu.nome.split(' ')[0]} 👋</h1>
          <p className="text-[13px] text-[#8B8BA7] mb-4">
            {clubes == null ? 'Carregando seus clubes…' : clubes.length ? `Você participa de ${clubes.length} ${clubes.length === 1 ? 'clube' : 'clubes'}` : 'Você ainda não participa de nenhum clube.'}
          </p>

          {clubes && clubes.length === 0 && (
            <Caixa className="p-5 text-center">
              <p className="text-[15px] font-semibold mb-1">Encontre as lojas onde você compra</p>
              <p className="text-[13px] text-[#8B8BA7] mb-4">Entre no clube de cada loja para ver benefícios e suas compras.</p>
              <Link href="/club/lojas" className="inline-flex h-11 px-5 items-center rounded-[14px] bg-[#7C3AED] font-semibold text-[14px]">Encontrar loja</Link>
            </Caixa>
          )}

          {clubes && clubes.length > 0 && (
            <>
              <SeletorClube clubes={clubes} selecionado={selecionado} escolher={escolher} />
              {clube && (
                <div className="mt-4 rounded-[22px] p-5 bg-gradient-to-br from-[#7C3AED] to-[#A78BFA] shadow-[0_12px_30px_rgba(124,58,237,0.35)]">
                  <p className="text-[11px] font-bold tracking-[0.14em] uppercase text-white/80">Seu clube nesta loja</p>
                  <p className="text-[22px] font-bold mt-1">{clube.nome}</p>
                  <p className="text-[13px] text-white/85">Cliente desde {new Date(clube.entrouEm).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</p>
                  {clube.beneficioPercentual ? (
                    <p className="mt-3 rounded-[12px] bg-white/15 px-3 py-2 text-[13px] font-semibold">
                      Benefício do clube: {clube.beneficioPercentual.toLocaleString('pt-BR')}% de desconto{clube.limiteBeneficio ? ` (até ${reais(clube.limiteBeneficio)} por compra)` : ''}
                    </p>
                  ) : null}
                </div>
              )}
              {clube?.status === 'PENDENTE_VINCULO' && (
                <div className="mt-4"><Aviso>A loja está confirmando o seu cadastro. Enquanto isso, as compras e as autorizações ficam aguardando.</Aviso></div>
              )}

              {clube?.status === 'ATIVO' && (
                <Secao titulo="Últimas compras" acao={<Link href="/club/compras" className="text-[13px] font-semibold text-[#A78BFA]">Ver todas</Link>}>
                  <Caixa>
                    {compras == null && <p className="p-4 text-[13px] text-[#8B8BA7]">Carregando…</p>}
                    {compras?.length === 0 && <p className="p-4 text-[13px] text-[#8B8BA7]">Nenhuma compra identificada nesta loja ainda. Elas aparecem aqui quando o caixa identifica você.</p>}
                    {compras?.slice(0, 3).map((c, i) => (
                      <div key={c.id} className={`flex items-center justify-between px-4 py-3 text-[14px] ${i ? 'border-t border-[#2A2A3E]' : ''}`}>
                        <span className="text-[#C9C9E0]">{dataCurta(c.data)} · {c.itens} {c.itens === 1 ? 'item' : 'itens'}</span>
                        <span className="font-bold">{reais(c.total)}</span>
                      </div>
                    ))}
                  </Caixa>
                </Secao>
              )}
            </>
          )}
        </>
      )}
    </AppClube>
  );
}
