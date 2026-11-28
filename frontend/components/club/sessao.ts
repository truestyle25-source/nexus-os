'use client';
/**
 * Sessão do consumidor nas telas /club: sem crachá → volta para a aba "Sou cliente NEXUS"
 * do login; com termos novos para aceitar → leva para /club/termos (o servidor também bloqueia).
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clubApi, ErroClube, limparSessaoClube, tokenClube, type Eu } from '@/lib/club/api';

export function useSessaoClube(opcoes: { permitirTermosPendentes?: boolean } = {}) {
  const router = useRouter();
  const [eu, setEu] = useState<Eu | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    if (!tokenClube()) { router.replace('/login?aba=cliente'); return; }
    try {
      const dados = await clubApi.eu();
      if (dados.termosPendentes?.length && !opcoes.permitirTermosPendentes) { router.replace('/club/termos'); return; }
      setEu(dados);
    } catch (e) {
      const err = e as ErroClube;
      if (err.status === 401) { router.replace('/login?aba=cliente'); return; }
      if (err.codigo === 'TERMOS_PENDENTES') { router.replace('/club/termos'); return; }
      setErro(err.message);
    }
  }, [router, opcoes.permitirTermosPendentes]);

  useEffect(() => { void carregar(); }, [carregar]);

  const sair = useCallback(async () => {
    try { await clubApi.logout(); } catch { /* sessão já encerrada: só limpa */ }
    limparSessaoClube();
    router.replace('/login?aba=cliente');
  }, [router]);

  return { eu, setEu, erro, recarregar: carregar, sair };
}

/** Lê um parâmetro da URL sem exigir Suspense (as telas são todas do lado do navegador). */
export function parametroUrl(nome: string): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(nome) ?? '';
}
