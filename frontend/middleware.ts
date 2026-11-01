import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware de rota do NEXUS OS.
 *
 * O token JWT fica no localStorage (inacessível ao servidor), então o
 * middleware usa um cookie leve `nexus_auth` apenas como FLAG de presença
 * de sessão — a segurança real continua sendo o Bearer token validado no
 * backend em cada chamada de API. O cookie é gravado em `lib/api.ts`
 * (saveToken) e removido em `clearToken`.
 *
 * Regras:
 *  - Sem flag + rota protegida  -> redireciona para /login
 *  - Com flag + /login          -> redireciona para / (dashboard)
 *  - Rotas públicas passam livre: login, esqueci-senha, redefinir-senha, /auth/*
 */

const ROTAS_PUBLICAS = ['/login', '/esqueci-senha', '/redefinir-senha', '/auth'];

function ehPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some(
    (rota) => pathname === rota || pathname.startsWith(rota + '/'),
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const autenticado = request.cookies.has('nexus_auth');

  if (!autenticado && !ehPublica(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (autenticado && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Ignora _next (chunks/imagens), favicon e arquivos estáticos.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)$).*)',
  ],
};
