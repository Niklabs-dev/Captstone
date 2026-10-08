import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE } from '@/lib/auth';
import { verifyAccessToken } from '@/lib/auth-backend';
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
  if (!result.ok)
    return new NextResponse(result.message, {
      status: result.status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/portal/:path*'],
};
