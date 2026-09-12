<<<<<<< HEAD
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body style={{fontFamily:'Inter, sans-serif', background:'#0a0a0a', color:'#fff', margin:0}}>{children}</body></html>
=======
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NEXUS OS',
  description: 'SaaS multi-tenant • Gestão completa da sua empresa',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
>>>>>>> 9a24c34c6d11c3f2872b796a0c1af740ba42af22
}
