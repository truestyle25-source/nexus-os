'use client';
/**
 * Moldura do app do cliente (Fase 5, mockups 02 e 04): cabeçalho, troca de clube e menu
 * embaixo (Início, Compras, Minha conta). Celular primeiro; no computador vira uma coluna central.
 * Cada clube é uma loja separada: a troca só muda qual loja a tela mostra.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { clubApi, clubeAtual, escolherClube, type ClubeResumo, type Eu, type StatusMembro } from '@/lib/club/api';
import { useSessaoClube } from './sessao';
import { corFundo } from './ui';

export type MeuClube = ClubeResumo & { status: StatusMembro; entrouEm: string };

export function useMeusClubes(ativo: boolean) {
  const [clubes, setClubes] = useState<MeuClube[] | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(async () => {
    try {
      const lista = await clubApi.clubes();
      setClubes(lista);
      const salvo = clubeAtual();
      const escolhido = lista.find((c) => c.id === salvo)?.id ?? lista[0]?.id ?? null;
      setSelecionado(escolhido);
      if (escolhido) escolherClube(escolhido);
    } catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { if (ativo) void carregar(); }, [ativo, carregar]);
  const escolher = (id: string) => { setSelecionado(id); escolherClube(id); };
  return { clubes, selecionado, clube: clubes?.find((c) => c.id === selecionado) ?? null, escolher, recarregar: carregar, erro };
}

const ABAS = [
  { href: '/club/inicio', rotulo: 'Início', icone: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z' },
  { href: '/club/compras', rotulo: 'Compras', icone: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4' },
  { href: '/club/conta', rotulo: 'Minha conta', icone: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0' },
];

export function AppClube({ titulo, children, eu, carregando }: { titulo?: ReactNode; children: ReactNode; eu: Eu | null; carregando?: boolean }) {
  const caminho = usePathname();
  return (
    <div className={`min-h-screen w-full ${corFundo} text-white`}>
      <div className="mx-auto w-full max-w-[560px] min-h-screen flex flex-col">
        <header className="flex items-center gap-3 px-4 pt-5 pb-3">
          <div className="w-9 h-9 rounded-[10px] bg-[#7C3AED] flex items-center justify-center shadow-[0_0_18px_rgba(124,92,255,0.45)]" aria-hidden="true">
            <span className="text-white text-[18px]">★</span>
          </div>
          <span className="font-bold text-[17px] tracking-tight">{titulo ?? 'NEXUS CLUB'}</span>
          {eu && <span className="ml-auto text-[12px] text-[#8B8BA7] truncate max-w-[45%]">{eu.email}</span>}
        </header>
        <main className="flex-1 px-4 pb-28">{carregando ? <p className="text-[#8B8BA7] text-[14px] mt-6">Carregando…</p> : children}</main>
        <nav className="fixed bottom-0 left-0 right-0 border-t border-[#2A2A3E] bg-[#12121F]/95 backdrop-blur" aria-label="Menu do NEXUS CLUB">
          <div className="mx-auto max-w-[560px] grid grid-cols-3">
            {ABAS.map((a) => {
              const ativo = caminho === a.href;
              return (
                <Link key={a.href} href={a.href} aria-current={ativo ? 'page' : undefined} className={`flex flex-col items-center gap-1 py-3 text-[12px] font-semibold ${ativo ? 'text-[#A78BFA]' : 'text-[#8B8BA7] hover:text-white'}`}>
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={a.icone} /></svg>
                  {a.rotulo}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

/** Botões de troca de clube (e o atalho "+ Encontrar loja"). */
export function SeletorClube({ clubes, selecionado, escolher }: { clubes: MeuClube[]; selecionado: string | null; escolher: (id: string) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Meus clubes">
      {clubes.map((c) => (
        <button key={c.id} type="button" role="tab" aria-selected={c.id === selecionado} onClick={() => escolher(c.id)}
          className={`shrink-0 h-9 px-4 rounded-full text-[13px] font-semibold border transition-all ${c.id === selecionado ? 'bg-[#7C3AED] border-[#7C3AED] text-white' : 'bg-[#12121F] border-[#2A2A3E] text-[#C9C9E0] hover:border-[#7C3AED]'}`}>
          {c.nome}
        </button>
      ))}
      <Link href="/club/lojas" className="shrink-0 h-9 px-4 rounded-full text-[13px] font-semibold border border-dashed border-[#2A2A3E] text-[#A78BFA] flex items-center hover:border-[#7C3AED]">+ Encontrar loja</Link>
    </div>
  );
}

export function Secao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[12px] font-bold tracking-[0.12em] uppercase text-[#8B8BA7]">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

export function Caixa({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[18px] bg-[#1A1A2E] border border-[#2A2A3E] ${className}`}>{children}</div>;
}

export { useSessaoClube };
