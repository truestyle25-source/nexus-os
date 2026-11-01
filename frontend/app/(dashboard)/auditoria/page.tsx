'use client';
// A auditoria já aparece em /admin (seção "Auditoria recente"). Mantida
// como redirecionamento para não quebrar quem tinha esse link salvo.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AuditoriaRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin'); }, [router]);
  return null;
}
