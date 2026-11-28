'use client';
/**
 * Peças visuais do NEXUS CLUB (área do consumidor), no mesmo estilo da tela de login do NEXUS OS:
 * fundo escuro, cartão arredondado, campos com borda que acende em roxo. Celular primeiro.
 */
import Link from 'next/link';
import type { InputHTMLAttributes, ReactNode } from 'react';

export const corFundo = 'bg-[#0B0B18]';

export function Logo({ subtitulo = 'NEXUS CLUB' }: { subtitulo?: string }) {
  return (
    <header className="relative z-10 w-full flex flex-col items-center gap-2 mb-6">
      <Link href="/login" className="flex items-center gap-3" aria-label="NEXUS OS">
        <div className="w-9 h-9 rounded-[10px] bg-[#7C3AED] flex items-center justify-center shadow-[0_0_20px_rgba(124,92,255,0.5)]">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white fill-white" aria-hidden="true"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" /></svg>
        </div>
        <span className="text-white font-bold text-[22px] tracking-tight">NEXUS OS</span>
      </Link>
      <p className="text-[#A78BFA] text-[12px] font-semibold tracking-[0.18em] uppercase">{subtitulo}</p>
    </header>
  );
}

/** Página do clube: fundo, brilho, logo e um cartão central. */
export function PaginaClube({ children, largura = 480 }: { children: ReactNode; largura?: number }) {
  return (
    <div className={`min-h-screen w-full ${corFundo} flex flex-col items-center px-4 py-8 md:py-12 relative overflow-hidden`}>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[1000px] h-[600px] rounded-full opacity-[0.2] blur-[90px]" style={{ background: 'radial-gradient(rgb(124, 92, 255) 0%, rgb(74, 46, 158) 25%, transparent 70%)' }} />
      </div>
      <Logo />
      <main className="relative z-10 w-full" style={{ maxWidth: largura }}>{children}</main>
    </div>
  );
}

export function Cartao({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`w-full rounded-[28px] bg-[#1A1A2E] border border-[#2A2A3E] shadow-[0_20px_60px_rgba(0,0,0,0.6)] px-6 md:px-8 py-7 ${className}`}>{children}</div>;
}

export function Titulo({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-white font-bold text-[24px] md:text-[26px] leading-tight tracking-tight">{children}</h1>
      {sub && <p className="text-[#8B8BA7] text-[14px] mt-2">{sub}</p>}
    </div>
  );
}

export function Campo({ rotulo, ajuda, erro, ...input }: { rotulo: string; ajuda?: ReactNode; erro?: string | null } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block mb-4">
      <span className="block text-[11px] font-semibold tracking-[0.14em] text-[#8B8BA7] mb-2 uppercase">{rotulo}</span>
      <input
        {...input}
        className={`w-full h-[48px] rounded-[16px] bg-[#12121F] border px-4 text-white text-[14px] placeholder:text-[#4A4A6A] outline-none transition-all focus:border-[#7C3AED] focus:shadow-[0_0_0_3px_rgba(124,92,255,0.15)] ${erro ? 'border-red-500/60' : 'border-[#2A2A3E]'} disabled:opacity-60`}
      />
      {erro ? <span className="block text-[12px] text-red-400 mt-1.5">{erro}</span> : ajuda ? <span className="block text-[12px] text-[#6B6B88] mt-1.5">{ajuda}</span> : null}
    </label>
  );
}

export function BotaoPrimario({ children, carregando, ...b }: { children: ReactNode; carregando?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...b}
      disabled={b.disabled || carregando}
      className="w-full h-[50px] rounded-[16px] bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold text-[15px] shadow-[0_8px_24px_rgba(124,58,237,0.35)] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {carregando ? 'Aguarde…' : children}
    </button>
  );
}

export function BotaoSecundario({ children, ...b }: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...b} className={`h-[44px] px-4 rounded-[14px] border border-[#2A2A3E] bg-[#12121F] text-[#C9C9E0] text-[14px] font-semibold hover:border-[#7C3AED] transition-all disabled:opacity-60 ${b.className ?? ''}`}>
      {children}
    </button>
  );
}

export function Aviso({ children, tom = 'info' }: { children: ReactNode; tom?: 'info' | 'erro' | 'ok' }) {
  const cores = {
    info: 'bg-[#7C3AED]/10 border-[#7C3AED]/30 text-[#C4B5FD]',
    erro: 'bg-red-500/10 border-red-500/30 text-red-300',
    ok: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  }[tom];
  return <div role={tom === 'erro' ? 'alert' : 'status'} className={`mb-5 border text-[13px] leading-relaxed p-3 rounded-xl ${cores}`}>{children}</div>;
}

export function LinkClube({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="text-[#A78BFA] hover:text-white font-semibold">{children}</Link>;
}

/**
 * Mostra o texto de um termo (markdown simples: títulos, listas e citação) sem interpretar HTML.
 * Só formatação visual: o texto aceito é exatamente o que o servidor guardou.
 */
export function TextoTermo({ texto, altura = 260 }: { texto: string; altura?: number }) {
  const linhas = texto.split('\n');
  return (
    <div className="rounded-[16px] bg-[#12121F] border border-[#2A2A3E] p-4 overflow-y-auto text-[13px] leading-relaxed text-[#C9C9E0]" style={{ maxHeight: altura }} tabIndex={0}>
      {linhas.map((l, i) => {
        const limpa = l.replace(/\*\*(.+?)\*\*/g, '$1');
        if (/^#\s/.test(l)) return <p key={i} className="text-white font-bold text-[15px] mt-2 mb-1">{limpa.replace(/^#\s/, '')}</p>;
        if (/^##\s/.test(l)) return <p key={i} className="text-white font-semibold mt-3 mb-1">{limpa.replace(/^##\s/, '')}</p>;
        if (/^>\s?/.test(l)) return <p key={i} className="border-l-2 border-amber-400 pl-3 text-amber-200 font-semibold my-2">{limpa.replace(/^>\s?/, '')}</p>;
        if (/^-\s/.test(l)) return <p key={i} className="pl-4 -indent-3">• {limpa.replace(/^-\s/, '')}</p>;
        if (!l.trim()) return <div key={i} className="h-2" />;
        return <p key={i}>{limpa}</p>;
      })}
    </div>
  );
}
