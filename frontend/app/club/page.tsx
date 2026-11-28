'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { tokenClube } from '@/lib/club/api';

/** /club → área do cliente (logado) ou aba "Sou cliente NEXUS" do login. */
export default function ClubeRaiz() {
  const router = useRouter();
  useEffect(() => { router.replace(tokenClube() ? '/club/inicio' : '/login?aba=cliente'); }, [router]);
  return null;
}
