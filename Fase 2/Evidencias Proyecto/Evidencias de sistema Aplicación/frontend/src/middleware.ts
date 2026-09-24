import { NextRequest, NextResponse } from 'next/server';
import { parseSessionCookie, SESSION_COOKIE } from '@/lib/mock-auth';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const user = parseSessionCookie(req.cookies.get(SESSION_COOKIE)?.value);

  const isAdminRoute = pathname.startsWith('/admin');
  const isPortalRoute = pathname.startsWith('/portal');

  if ((isAdminRoute || isPortalRoute) && !user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Un trabajador nunca entra al panel administrador; el resto de roles no
  // tiene por qué entrar al Portal del Trabajador (Ley N°21.719 — aislamiento
  // de datos, mismo criterio de E4-H1/E4-H2 del backlog).
  if (isAdminRoute && user?.rol === 'trabajador') {
    const url = req.nextUrl.clone();
    url.pathname = '/portal';
    return NextResponse.redirect(url);
  }
  if (isPortalRoute && user && user.rol !== 'trabajador') {
    const url = req.nextUrl.clone();
    url.pathname = '/admin';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/portal/:path*'],
};
