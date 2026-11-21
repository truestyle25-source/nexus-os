'use client';

// Erros de renderização fora do painel (login, cadastro, recuperação de senha).
import TelaDeErro from '@/components/TelaDeErro';

export default function Erro(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <TelaDeErro {...props} />;
}
