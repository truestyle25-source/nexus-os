'use client';
/** Cartão "de/por" de uma promoção da vitrine (mockups 02 e 03). Preços vindos do servidor. */
import { reais, type PromocaoVitrine } from '@/lib/club/api';

export function CartaoPromocao({ p, compacto }: { p: PromocaoVitrine; compacto?: boolean }) {
  const ate = new Date(p.fim).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return (
    <article className="rounded-[18px] bg-[#1A1A2E] border border-[#2A2A3E] p-3 flex flex-col">
      <div className={`rounded-[14px] bg-[#12121F] flex items-center justify-center overflow-hidden ${compacto ? 'h-24' : 'h-32'}`}>
        {p.produto.foto ? <img src={p.produto.foto} alt={p.produto.nome} className="w-full h-full object-contain" loading="lazy" /> : <span className="text-[28px]" aria-hidden="true">🛍️</span>}
      </div>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {p.tipo === 'MEMBROS' && <span className="text-[10px] font-bold uppercase tracking-wide text-[#C4B5FD] bg-[#7C3AED]/20 rounded-full px-2 py-0.5">★ Só membros</span>}
        <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/10 rounded-full px-2 py-0.5">-{p.desconto.toLocaleString('pt-BR')}%</span>
      </div>
      <p className="text-[14px] font-semibold mt-1.5 leading-tight">{p.titulo || p.produto.nome}</p>
      {p.titulo && <p className="text-[12px] text-[#8B8BA7]">{p.produto.nome}</p>}
      <p className="text-[12px] text-[#6B6B88] line-through mt-1">{reais(p.de)}</p>
      <p className="text-[18px] font-bold text-[#C4B5FD] leading-none">{reais(p.por)}</p>
      {!compacto && (
        <div className="mt-2 text-[11.5px] text-[#8B8BA7] space-y-0.5">
          <p>Válida até {ate}{p.limitePorCliente ? ` · até ${p.limitePorCliente} por compra` : ''}</p>
          {p.filiais && <p>Só em: {p.filiais.join(', ')}</p>}
          {p.descricao && <p className="text-[#C9C9E0]">{p.descricao}</p>}
        </div>
      )}
    </article>
  );
}
