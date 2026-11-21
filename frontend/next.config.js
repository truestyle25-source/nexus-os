/** @type {import('next').NextConfig} */

const emDesenvolvimento = process.env.NODE_ENV !== 'production';

/**
 * Origens da API que o navegador pode chamar (connect-src da CSP).
 * Vem da mesma NEXT_PUBLIC_API_URL usada por lib/api.ts, mais o padrão de
 * produção e o backend local. Ao trocar o domínio da API, basta a variável.
 */
function origensDaApi() {
  const origens = new Set(['https://nexus-os-7u4g.onrender.com']);
  for (const valor of [process.env.NEXT_PUBLIC_API_URL]) {
    try { if (valor) origens.add(new URL(valor).origin); } catch { /* valor inválido: ignora */ }
  }
  if (emDesenvolvimento) {
    origens.add('http://localhost:3333');
    origens.add('ws://localhost:3000'); // recarga automática do `next dev`
  }
  return [...origens];
}

/**
 * Content-Security-Policy.
 * - script-src 'unsafe-inline': o Next 14 injeta scripts inline de hidratação e o
 *   ThemeScript precisa rodar antes da primeira pintura (sem nonce por página).
 *   Mesmo assim, a CSP bloqueia scripts de OUTROS domínios, `eval` em produção,
 *   plugins, <base> forjado, envio de formulário para fora e o carregamento da
 *   tela dentro de outro site (frame-ancestors).
 * - connect-src: o token só pode ser enviado à API — um XSS não consegue mandá-lo
 *   para outro servidor via fetch/XHR.
 * - img-src https:: fotos de produto vêm de URLs cadastradas pelo cliente.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${emDesenvolvimento ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data:",
  `connect-src 'self' ${origensDaApi().join(' ')}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const cabecalhosDeSeguranca = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Microfone só para a própria aplicação (conversa por voz da IA do NEXUS).
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: cabecalhosDeSeguranca }];
  },
};

module.exports = nextConfig;
