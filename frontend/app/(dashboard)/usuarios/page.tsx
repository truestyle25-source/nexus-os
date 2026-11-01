'use client';
// Esta tela foi substituída por /admin (criação de usuário + lista +
// auditoria, tudo num só lugar). Mantida como redirecionamento para não
// quebrar quem tinha esse link salvo.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function UsuariosRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin'); }, [router]);
  return null;
}
