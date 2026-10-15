import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { AuditFilters } from '@/components/audit/AuditFilters';
import { AuditTable } from '@/components/audit/AuditTable';
import {
  AUDIT_PAGE_SIZE,
  auditPageHref,
  mergeAuditStores,
  parseAuditFilters,
  parseConfiguredAuditStores,
} from '@/lib/audit';
import { fetchAuditPage } from '@/lib/audit-backend';
import { getAuditSession } from '@/lib/audit-session';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const session = await getAuditSession();
  if (!session.ok && session.status === 401) redirect('/session-expired');
  if (!session.ok && session.status === 403)
    redirect('/dashboard?reason=forbidden');
  const search = await searchParams;
  const params = new URLSearchParams();
  for (const key of ['storeId', 'from', 'to', 'limit', 'offset']) {
    const value = search[key];
    if (typeof value === 'string') params.append(key, value);
    else if (Array.isArray(value))
      for (const part of value) params.append(key, part);
  }
  const filters = parseAuditFilters(params);
  const configured = parseConfiguredAuditStores(process.env.AUDIT_STORES);
  const result =
    session.ok && filters.ok && configured
      ? await fetchAuditPage(session.data.token, filters.data)
      : null;
  if (result && !result.ok && result.status === 401)
    redirect('/session-expired');
  if (result && !result.ok && result.status === 403)
    redirect('/dashboard?reason=forbidden');
  const stores = mergeAuditStores(
    session.ok ? session.data.stores : [],
    configured ?? [],
    result?.ok
      ? result.data.items.flatMap((entry) => (entry.store ? [entry.store] : []))
      : [],
  );
  const message = !session.ok
    ? session.message
    : !filters.ok
      ? filters.message
      : configured === null
        ? 'No se pudo cargar la lista de locales. Intenta nuevamente.'
        : result && !result.ok
          ? result.message
          : null;
  return (
    <>
      <p className="text-sm text-ink2">
        Consulta las operaciones registradas. El registro es de solo lectura y
        no se puede editar ni eliminar.
      </p>
      {session.ok && (
        <AuditFilters
          queryKey={params.toString()}
          stores={stores}
          selected={{
            storeId: params.get('storeId') ?? '',
            from: params.get('from') ?? '',
            to: params.get('to') ?? '',
          }}
          limit={filters.ok ? filters.data.limit : AUDIT_PAGE_SIZE}
        />
      )}
      {message && (
        <section className="rounded-[14px] border border-line2 bg-bg p-5">
          <p role="alert" className="text-sm text-crit">
            {message}
          </p>
          {(session.ok ? filters.ok : true) && (
            <Link
              href={
                filters.ok
                  ? auditPageHref(filters.data, filters.data.offset)
                  : '/admin/auditoria'
              }
              prefetch={false}
              className="mt-3 inline-block text-sm font-semibold text-salmon-ink underline"
            >
              Reintentar
            </Link>
          )}
        </section>
      )}
      {result?.ok && filters.ok && (
        <AuditTable page={result.data} filters={filters.data} />
      )}
    </>
  );
}
