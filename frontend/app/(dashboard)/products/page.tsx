'use client';
// Esta tela foi movida para /produtos (unificação da nomenclatura em
// pt-BR). Mantida como redirecionamento para não quebrar quem tinha este
// link salvo. Todo o conteúdo/funcionalidade está em /produtos.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ProductsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/produtos');
  }, [router]);
  return null;
}
