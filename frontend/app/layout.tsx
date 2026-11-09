import type { Metadata } from 'next';
import './globals.css';
import ThemeScript from '@/components/ThemeScript';
import ThemeSync from '@/components/ThemeSync';

export const metadata: Metadata = {
  title: {
    default: 'NEXUS OS',
    template: '%s | NEXUS OS',
  },
  description:
    'NEXUS OS é uma plataforma SaaS multi-tenant para gestão completa de empresas.',
  applicationName: 'NEXUS OS',
  keywords: [
    'NEXUS OS',
    'gestão empresarial',
    'ERP',
    'SaaS',
    'estoque',
    'vendas',
    'Estoque',
    'financeiro',
    'RH',
  ],
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `suppressHydrationWarning` é obrigatório: o ThemeScript altera
    // data-theme / color-scheme no <html> antes da hidratação, e o React
    // veria uma diferença entre servidor e cliente.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Antes de qualquer pixel: aplica tema/densidade/accent salvos. */}
        <ThemeScript />
      </head>
      <body>
        {/* Depois da hidratação: mantém em dia quando a aba Configurações
            salva uma escolha nova, ou quando outra aba do navegador salva. */}
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
