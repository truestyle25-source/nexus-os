'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchMe, clearToken, getToken, type MeResponse } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    fetchMe()
      .then(setMe)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Sessão inválida');
        clearToken();
        setTimeout(() => router.replace('/'), 1500);
      });
  }, [router]);

  function handleLogout() {
    clearToken();
    router.replace('/');
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center text-gray-300">
        <p>{error} — redirecionando para o login...</p>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="min-h-screen flex items-center justify-center text-gray-400">
        <p>Carregando...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl logo-glow flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h7l-1 8 11-14h-8l1-6z"/></svg>
          </div>
          <span className="text-white font-bold text-xl">NEXUS OS</span>
        </div>
        <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white border border-white/10 rounded-full px-4 py-2">
          Sair
        </button>
      </div>

      <div className="card rounded-2xl p-6">
        <p className="text-gray-400 text-sm mb-1">Bem-vindo(a),</p>
        <h1 className="text-white text-2xl font-bold mb-4">{me.name}</h1>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">E-mail</p>
            <p className="text-gray-200">{me.email}</p>
          </div>
          <div>
            <p className="text-gray-500">Papel</p>
            <p className="text-gray-200 capitalize">{me.role.name}</p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-white/10">
          <p className="text-gray-500 text-xs mb-2">Permissões ({me.role.permissions.length})</p>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {me.role.permissions.map((p) => (
              <span key={p} className="text-[11px] text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded-full px-2.5 py-1">
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="card rounded-2xl p-6 mt-4">
        <p className="text-white font-semibold mb-1">✅ Fase 1 — Fundação concluída</p>
        <p className="text-gray-400 text-sm">
          Autenticação, usuários, permissões granulares e auditoria estão funcionando.
          Os módulos de Produtos, Estoque, Vendas, PDV e demais (Fase 2 em diante) aparecerão aqui
          conforme forem construídos sobre esta base.
        </p>
      </div>
    </main>
  );
}
