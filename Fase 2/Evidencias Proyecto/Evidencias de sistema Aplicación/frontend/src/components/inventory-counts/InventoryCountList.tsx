import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  badgeClass,
  buttonClass,
  panelTitleClass,
  tableCellClass,
  tableClass,
  tableDescriptionClass,
  tableHeadClass,
  tableHeaderClass,
  tableHeadingClass,
  tablePanelClass,
} from '@/components/ui/styles';
import { formatCalendarDate } from '@/lib/display-date';
import {
  COUNT_STATUS_LABELS,
  countResponsible,
  formatChileDateTime,
  type InventoryCountStatus,
  type InventoryCountSummary,
} from '@/lib/inventory-counts';

// SPRINT-5-T09: listado de tomas de inventario, en tabla desde lg y en
// tarjetas en pantallas angostas.
export function CountStatusBadge({
  status,
}: {
  status: InventoryCountStatus;
}): ReactElement {
  return (
    <span
      className={`${badgeClass} ${status === 'CONFIRMED' ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn'}`}
    >
      {COUNT_STATUS_LABELS[status]}
    </span>
  );
}

const HEADINGS = [
  'Local',
  'Fecha de la toma',
  'Estado',
  'Contados',
  'Responsable',
  'Finalización',
  'Acciones',
];

function finalization(count: InventoryCountSummary): string {
  return count.finalizedAt ? formatChileDateTime(count.finalizedAt) : '—';
}
function countTitle(count: InventoryCountSummary): string {
  return `${count.store.name}, ${formatCalendarDate(count.countDate)}`;
}
function detailLink(count: InventoryCountSummary): ReactElement {
  return (
    <Link
      href={`/admin/inventarios/${count.id}`}
      prefetch={false}
      aria-label={`Ver toma de ${countTitle(count)}`}
      className={buttonClass}
    >
      Ver detalle
    </Link>
  );
}

export function InventoryCountList({
  counts,
  scope,
}: {
  counts: InventoryCountSummary[];
  scope: string;
}): ReactElement {
  return (
    <section
      aria-labelledby="counts-title"
      className={`${tablePanelClass} min-w-0`}
    >
      <header className={tableHeaderClass}>
        <div className="min-w-0">
          <h2 id="counts-title" className={panelTitleClass}>
            Tomas de inventario
          </h2>
          <p className={tableDescriptionClass}>
            {scope} · {counts.length} {counts.length === 1 ? 'toma' : 'tomas'},
            de la más reciente a la más antigua
          </p>
        </div>
      </header>
      <ul
        aria-label="Tomas de inventario"
        className="divide-y divide-line lg:hidden"
      >
        {counts.map((count) => (
          <li key={count.id}>
            <article aria-label={countTitle(count)} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-bold">
                    {count.store.name}
                  </h3>
                  <p className="mt-1 text-xs text-ink2">
                    Toma del {formatCalendarDate(count.countDate)}
                  </p>
                </div>
                <span className="shrink-0">
                  <CountStatusBadge status={count.status} />
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div className="min-w-0">
                  <dt className="text-muted">Contados</dt>
                  <dd className="tabular-nums">{count.countedProducts}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted">Responsable</dt>
                  <dd className="break-words">{countResponsible(count)}</dd>
                </div>
                <div className="col-span-2 min-w-0">
                  <dt className="text-muted">Finalización</dt>
                  <dd className="tabular-nums">{finalization(count)}</dd>
                </div>
              </dl>
              {detailLink(count)}
            </article>
          </li>
        ))}
      </ul>
      <div
        role="region"
        aria-label="Tabla de tomas desplazable"
        tabIndex={0}
        className="hidden min-w-0 max-w-full overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-salmon-ink lg:block"
      >
        <table className={`${tableClass} min-w-[900px]`}>
          <caption className="sr-only">
            Local, fecha, estado, productos contados, responsable y finalización
            de cada toma.
          </caption>
          <thead className={tableHeadClass}>
            <tr>
              {HEADINGS.map((heading) => (
                <th key={heading} scope="col" className={tableHeadingClass}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {counts.map((count) => (
              <tr
                key={count.id}
                className="border-b border-line last:border-b-0 hover:bg-tint"
              >
                <td
                  className={`${tableCellClass} max-w-64 break-words font-semibold`}
                >
                  {count.store.name}
                </td>
                <td className={`${tableCellClass} tabular-nums`}>
                  {formatCalendarDate(count.countDate)}
                </td>
                <td className={tableCellClass}>
                  <CountStatusBadge status={count.status} />
                </td>
                <td className={`${tableCellClass} tabular-nums`}>
                  {count.countedProducts}
                </td>
                <td className={`${tableCellClass} max-w-56 break-words`}>
                  {countResponsible(count)}
                </td>
                <td
                  className={`${tableCellClass} whitespace-nowrap tabular-nums`}
                >
                  {finalization(count)}
                </td>
                <td className={tableCellClass}>{detailLink(count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
