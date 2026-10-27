import {
  buttonClass,
  tableClass,
  tableHeadClass,
  tableHeadingClass,
  tableCellClass,
  panelTitleClass,
  tablePanelClass,
  tableHeaderClass,
  tableDescriptionClass,
  badgeClass,
} from '@/components/ui/styles';
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
  return (
    <section aria-labelledby="audit-table-title" className={tablePanelClass}>
      <div className={tableHeaderClass}>
        <div>
          <h2 id="audit-table-title" className={panelTitleClass}>
            Registro de operaciones
          </h2>
          <p className={tableDescriptionClass}>
            Quién hizo qué, cuándo y en qué local · más recientes primero
          </p>
        </div>
        <span className={`${badgeClass} bg-tint2 text-salmon-ink`}>
          Solo lectura
        </span>
      </div>
      <p className="border-b border-line px-4 py-3 text-xs text-ink2 lg:hidden">
        Desliza la tabla para ver todas las columnas y acciones.
      </p>
      <div
        role="region"
        aria-label="Tabla de auditoría desplazable"
        tabIndex={0}
        className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-salmon-ink"
      >
        <table className={`${tableClass} min-w-[760px]`}>
          <caption className="sr-only">
            Registro de auditoría. Fechas y horas de Chile.
          </caption>
          <thead className={tableHeadClass}>
            <tr>
              {[
                'Fecha y hora · Chile',
                'Responsable',
                'Operación',
                'Local',
                'Módulo',
                'Registro',
              ].map((title) => (
                <th key={title} scope="col" className={tableHeadingClass}>
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.items.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-line last:border-b-0 hover:bg-tint"
              >
                <td
                  className={`${tableCellClass} whitespace-nowrap  font-mono text-[11px]`}
                >
                  <time dateTime={entry.createdAt}>
                    {formatAuditDate(entry.createdAt)}
                  </time>
                </td>
                <td className={`${tableCellClass} max-w-[240px] break-words`}>
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
                <td className={`${tableCellClass} max-w-[260px] break-words`}>
                  <p className="font-medium">
                    {auditActionLabel(entry.action)}
                  </p>
                  {auditActionLabel(entry.action) !== entry.action && (
                    <p className="mt-1 break-all font-mono text-[10px] text-muted">
                      {entry.action}
                    </p>
                  )}
                </td>
                <td className={`${tableCellClass} max-w-[180px] break-words`}>
                  {entry.store?.name ?? 'Operación global'}
                </td>
                <td className={`${tableCellClass} max-w-[140px] break-all`}>
                  <span className={`${badgeClass} bg-tint2 text-salmon-ink`}>
                    {auditModuleLabel(entry.entityType)}
                  </span>
                </td>
                <td
                  className={`${tableCellClass} font-mono text-[11px] text-muted`}
                >
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
              className={buttonClass}
            >
              Anterior
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className={`${buttonClass} pointer-events-none opacity-50`}
            >
              Anterior
            </span>
          )}
          {hasNext ? (
            <Link
              prefetch={false}
              href={auditPageHref(filters, page.offset + page.limit)}
              className={buttonClass}
            >
              Siguiente
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className={`${buttonClass} pointer-events-none opacity-50`}
            >
              Siguiente
            </span>
          )}
        </nav>
      </div>
    </section>
  );
}
