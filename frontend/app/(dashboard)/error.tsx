'use client';

// Erros de renderização dentro do painel: a sidebar e a topbar do layout
// continuam na tela; só o conteúdo da aba é trocado pela mensagem de erro.
import TelaDeErro from '@/components/TelaDeErro';

export default function ErroDoPainel(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <TelaDeErro {...props} />;
}
