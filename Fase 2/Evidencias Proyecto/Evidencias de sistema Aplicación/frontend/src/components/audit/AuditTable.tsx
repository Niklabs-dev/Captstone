import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  auditActionLabel,
  auditModuleLabel,
  auditPageHref,
  formatAuditDate,
  type AuditFilters,
  type AuditPage,
} from '@/lib/audit';

export function AuditTable({
  page,
  filters,
}: {
  page: AuditPage;
  filters: AuditFilters;
}): ReactElement {
  const start = page.items.length ? page.offset + 1 : 0;
  const end = page.items.length ? page.offset + page.items.length : 0;
  const previous = Math.max(0, page.offset - page.limit);
  const hasNext = page.offset + page.limit < page.total;
  const linkStyle =
    'rounded-lg border border-line2 px-3 py-2 text-sm font-semibold text-salmon-ink hover:bg-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink';
  return (
    <section
      aria-labelledby="audit-table-title"
      className="overflow-hidden rounded-[14px] border border-line bg-bg"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="audit-table-title" className="text-sm font-bold">
            Registro de operaciones
          </h2>
          <p className="mt-1 text-xs text-muted">
            Quién hizo qué, cuándo y en qué local · más recientes primero
          </p>
        </div>
        <span className="rounded-full bg-tint2 px-2.5 py-1 font-mono text-[10px] font-semibold text-salmon-ink">
          Solo lectura
        </span>
      </div>
      <div
        role="region"
        aria-label="Tabla de auditoría desplazable"
        tabIndex={0}
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-salmon-ink"
      >
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <caption className="sr-only">
            Registro de auditoría. Fechas y horas de Chile.
          </caption>
          <thead className="border-b border-line bg-tint font-mono text-[9.5px] uppercase tracking-wider text-muted">
            <tr>
              {[
                'Fecha y hora · Chile',
                'Responsable',
                'Operación',
                'Local',
                'Módulo',
                'Registro',
              ].map((title) => (
                <th key={title} scope="col" className="px-4 py-3">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.items.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-line last:border-b-0 hover:bg-tint/60"
              >
                <td className="whitespace-nowrap px-4 py-4 font-mono text-[11px]">
                  <time dateTime={entry.createdAt}>
                    {formatAuditDate(entry.createdAt)}
                  </time>
                </td>
                <td className="max-w-[240px] break-words px-4 py-4">
                  <p className="font-semibold">
                    {entry.user
                      ? [entry.user.firstName, entry.user.lastName]
                          .filter(Boolean)
                          .join(' ') || entry.user.email
                      : 'Sin usuario identificado'}
                  </p>
                  {entry.user && (
                    <p className="mt-1 break-all text-[11px] text-muted">
                      {entry.user.email}
                    </p>
                  )}
                </td>
                <td className="max-w-[260px] break-words px-4 py-4">
                  <p className="font-medium">
                    {auditActionLabel(entry.action)}
                  </p>
                  {auditActionLabel(entry.action) !== entry.action && (
                    <p className="mt-1 break-all font-mono text-[10px] text-muted">
                      {entry.action}
                    </p>
                  )}
                </td>
                <td className="max-w-[180px] break-words px-4 py-4">
                  {entry.store?.name ?? 'Operación global'}
                </td>
                <td className="max-w-[140px] break-all px-4 py-4">
                  <span className="rounded-md bg-tint2 px-2 py-1 text-xs text-salmon-ink">
                    {auditModuleLabel(entry.entityType)}
                  </span>
                </td>
                <td className="px-4 py-4 font-mono text-[11px] text-muted">
                  #{entry.id}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {page.items.length === 0 && (
        <div className="px-5 py-10 text-center">
          <h3 className="font-semibold">No hay registros para esta consulta</h3>
          <p className="mt-2 text-sm text-ink2">
            Prueba otro local o rango de fechas.
          </p>
          {page.offset > 0 && (
            <Link
              href={auditPageHref(filters, 0)}
              prefetch={false}
              className="mt-4 inline-block text-sm font-semibold text-salmon-ink underline"
            >
              Volver a la primera página
            </Link>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
        <p className="text-xs text-ink2" aria-live="polite">
          {start}–{end} de {page.total} registros
        </p>
        <nav aria-label="Paginación de auditoría" className="flex gap-2">
          {page.offset > 0 ? (
            <Link
              prefetch={false}
              href={auditPageHref(filters, previous)}
              className={linkStyle}
            >
              Anterior
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
            >
              Anterior
            </span>
          )}
          {hasNext ? (
            <Link
              prefetch={false}
              href={auditPageHref(filters, page.offset + page.limit)}
              className={linkStyle}
            >
              Siguiente
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
            >
              Siguiente
            </span>
          )}
        </nav>
      </div>
    </section>
  );
}
