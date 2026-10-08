import Image from 'next/image';
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
import { SessionActions } from '@/components/SessionActions';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const session = await getAuditSession();
  if (!session.ok && session.status === 401) redirect('/login?reason=session');
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
    redirect('/login?reason=session');
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
    <div className="min-h-screen bg-tint text-ink lg:grid lg:grid-cols-[248px_1fr]">
      <a
        href="#audit-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-30 focus:bg-bg focus:p-3"
      >
        Ir al contenido
      </a>
      <aside className="border-b border-line bg-bg lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center gap-3 border-b border-line px-5 py-5">
          <Image
            src="/logo.png"
            alt=""
            width={46}
            height={46}
            className="rounded-xl border border-line"
            priority
          />
          <div>
            <p className="text-base font-extrabold tracking-tight">
              Moi<span className="text-salmon-deep">Food</span>
            </p>
            <p className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
              Gestión interna
            </p>
          </div>
        </div>
        <nav
          aria-label="Navegación de administración"
          className="space-y-1 px-2.5 py-4"
        >
          <p className="mb-2 px-2.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
            Núcleo transversal
          </p>
          <Link
            href="/dashboard"
            prefetch={false}
            className="block rounded-[9px] px-3 py-2.5 text-[13.5px] text-ink2 hover:bg-tint"
          >
            Inicio
          </Link>
          <Link
            href="/admin/auditoria"
            aria-current="page"
            prefetch={false}
            className="block rounded-[9px] bg-tint2 px-3 py-2.5 text-[13.5px] font-semibold text-salmon-ink"
          >
            Auditoría
          </Link>
        </nav>
        {session.ok && (
          <div className="hidden border-t border-line px-5 py-4 lg:mt-auto lg:block">
            <p className="break-all text-[13px] font-semibold">
              {session.data.user.email}
            </p>
            <p className="mt-1 font-mono text-[9.5px] uppercase tracking-wider text-salmon-ink">
              Administrador
            </p>
          </div>
        )}
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-16 items-center border-b border-line bg-bg px-5 lg:px-7">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              Núcleo transversal
            </p>
            <h1 className="text-[17px] font-bold">Auditoría del sistema</h1>
          </div>
        </header>
        <main id="audit-content" className="space-y-5 px-5 py-6 lg:px-7">
          <p className="text-sm text-ink2">
            Consulta las operaciones registradas. El registro es de solo lectura
            y no se puede editar ni eliminar.
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
          {session.ok && (
            <details className="rounded-[14px] border border-line bg-bg px-5 py-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Mi sesión
              </summary>
              <div className="mt-4">
                <SessionActions />
              </div>
            </details>
          )}
        </main>
      </div>
    </div>
  );
}
