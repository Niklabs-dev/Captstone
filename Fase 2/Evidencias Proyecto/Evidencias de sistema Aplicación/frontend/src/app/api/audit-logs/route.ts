import { NextResponse } from 'next/server';
import { parseAuditFilters } from '@/lib/audit';
import { fetchAuditPage } from '@/lib/audit-backend';
import { getAuditSession } from '@/lib/audit-session';
import { clearSessionCookies } from '@/lib/session';

export async function GET(request: Request): Promise<NextResponse> {
  const headers = { 'Cache-Control': 'private, no-store' };
  const session = await getAuditSession();
  if (!session.ok) {
    const response = NextResponse.json(
      { message: session.message },
      { status: session.status, headers },
    );
    return session.status === 401 ? clearSessionCookies(response) : response;
  }
  const filters = parseAuditFilters(new URL(request.url).searchParams);
  if (!filters.ok)
    return NextResponse.json(
      { message: filters.message },
      { status: 400, headers },
    );
  const result = await fetchAuditPage(session.data.token, filters.data);
  return result.ok
    ? NextResponse.json(result.data, { headers })
    : NextResponse.json(
        { message: result.message },
        { status: result.status, headers },
      );
}
