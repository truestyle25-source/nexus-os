import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NEXUS CLUB',
  description: 'Promoções e benefícios das lojas onde você é cliente.',
  // Área de conta do consumidor: não precisa aparecer em buscadores.
  robots: { index: false, follow: false },
};

export default function LayoutClube({ children }: { children: React.ReactNode }) {
  return children;
}
