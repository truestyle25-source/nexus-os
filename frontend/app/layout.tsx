import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body style={{fontFamily:'Inter, sans-serif', background:'#0a0a0a', color:'#fff', margin:0}}>{children}</body></html>
}
