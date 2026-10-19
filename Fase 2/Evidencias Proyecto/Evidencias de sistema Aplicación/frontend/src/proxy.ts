import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE } from '@/lib/auth';
import { verifyAccessToken } from '@/lib/auth-backend';
import { getNavigationView, getPageRedirect } from '@/lib/navigation';
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const result = token ? await verifyAccessToken(token) : null;
  if (!result || (!result.ok && result.status === 401)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('reason', 'session');
    return NextResponse.redirect(url);
  }
  if (!result.ok) {
    // Las vistas conocidas mantienen sus guardas en servidor y muestran recuperación.
    // No se concede acceso: layout, páginas y API siguen validando la sesión.
    if (getNavigationView(request.nextUrl.pathname).href) {
      const response = NextResponse.next();
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return new NextResponse(result.message, {
      status: result.status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
  const destination = getPageRedirect(
    result.data.role,
    request.nextUrl.pathname,
  );
  if (destination) {
    const url = new URL(destination, request.url);
    const response = NextResponse.redirect(url);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = {
  matcher: [
    // Las API validan su sesión y permisos y responden JSON, nunca redirecciones HTML.
    // Inicio y login resuelven su destino en sus propios Server Components.
    '/((?!$|login(?:/|$)|session-expired(?:/|$)|api(?:/|$)|_next(?:/|$)|favicon\\.ico$|logo\\.png$|robots\\.txt$|sitemap\\.xml$).*)',
  ],
};
