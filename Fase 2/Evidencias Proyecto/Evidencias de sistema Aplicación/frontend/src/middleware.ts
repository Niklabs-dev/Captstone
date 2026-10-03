import { NextRequest, NextResponse } from 'next/server';
import { USER_COOKIE, parseUserCookie, landingPathForRole } from '@/lib/session';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const user = parseUserCookie(req.cookies.get(USER_COOKIE)?.value);

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
  if (user && isAdminRoute && user.rol === 'TRABAJADOR') {
    const url = req.nextUrl.clone();
    url.pathname = landingPathForRole(user.rol);
    return NextResponse.redirect(url);
  }
  if (user && isPortalRoute && user.rol !== 'TRABAJADOR') {
    const url = req.nextUrl.clone();
    url.pathname = landingPathForRole(user.rol);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/portal/:path*'],
};
