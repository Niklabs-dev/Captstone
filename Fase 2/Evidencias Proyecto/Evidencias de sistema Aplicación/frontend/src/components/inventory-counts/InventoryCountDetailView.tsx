import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  badgeClass,
  buttonClass,
  filterPanelClass,
  infoNoticeClass,
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
  canDownloadCount,
  countLineCells,
  countProgress,
  countSections,
  formatChileDateTime,
  personName,
  type InventoryCountDetail,
  type InventoryCountItem,
} from '@/lib/inventory-counts';
import { DownloadCountButton } from './DownloadCountButton';
import { CountStatusBadge } from './InventoryCountList';

// SPRINT-5-T09: detalle de solo lectura de una toma, en el orden de la
// plantilla: por producto, cajas, paquetes, cantidad suelta y total. La
// descarga solo aparece en una toma finalizada.
const HEADINGS = [
  'Producto',
  'SKU',
  'Cajas',
  'Paquetes',
  'Cantidad suelta',
  'Total',
];

function pending(item: InventoryCountItem): ReactElement | null {
  return item.counted ? null : (
    <span className={`${badgeClass} bg-tint2 text-ink2`}>Sin contar</span>
  );
}

export function InventoryCountDetailView({
  count,
}: {
  count: InventoryCountDetail;
}): ReactElement {
  const finalized = canDownloadCount(count);
  const sections = countSections(count.items);
  return (
    <div className="min-w-0 space-y-5">
      <Link href="/admin/inventarios" prefetch={false} className={buttonClass}>
        Volver a las tomas
      </Link>
      <section
        aria-labelledby="count-detail-title"
        className={`${filterPanelClass} min-w-0 space-y-4`}
      >
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2
              id="count-detail-title"
              className="break-words text-base font-bold"
            >
              {count.store.name}
            </h2>
            <p className="mt-1 text-sm text-ink2">
              Toma del {formatCalendarDate(count.countDate)}
            </p>
            <p className="mt-2">
              <CountStatusBadge status={count.status} />
            </p>
          </div>
          {finalized && (
            <DownloadCountButton
              countId={count.id}
              countDate={count.countDate}
            />
          )}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-xs text-muted">Avance</dt>
            <dd className="tabular-nums">
              {countProgress(count.countedProducts, count.totalProducts)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">Iniciada por</dt>
            <dd className="break-words">
              {personName(count.startedBy)} ·{' '}
              <span className="tabular-nums">
                {formatChileDateTime(count.startedAt)}
              </span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">Finalizada por</dt>
            <dd className="break-words">
              {count.finalizedBy && count.finalizedAt ? (
                <>
                  {personName(count.finalizedBy)} ·{' '}
                  <span className="tabular-nums">
                    {formatChileDateTime(count.finalizedAt)}
                  </span>
                </>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">Pendientes</dt>
            <dd className="tabular-nums">{count.pendingProducts}</dd>
          </div>
        </dl>
        {!finalized && (
          <p className={infoNoticeClass}>
            La toma sigue en curso: el supervisor todavía puede guardar
            cantidades. El Excel se descarga cuando la finalice.
          </p>
        )}
      </section>

      {sections.length === 0 && (
        <p role="status" className={filterPanelClass}>
          Esta toma no tiene productos.
        </p>
      )}
      {sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={section.id}
          className={`${tablePanelClass} min-w-0`}
        >
          <header className={tableHeaderClass}>
            <div className="min-w-0">
              <h2 id={section.id} className={`${panelTitleClass} break-words`}>
                {section.section}
              </h2>
              <p className={tableDescriptionClass}>
                {countProgress(
                  section.items.filter((item) => item.counted).length,
                  section.items.length,
                )}
              </p>
            </div>
          </header>
          <ul
            aria-label={`Productos de ${section.section}`}
            className="divide-y divide-line lg:hidden"
          >
            {section.items.map((item) => {
              const cells = countLineCells(item);
              return (
                <li key={item.product.id}>
                  <article aria-label={cells.name} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words text-sm font-bold">
                          {cells.name}
                        </h3>
                        {cells.sku && (
                          <p className="mt-1 font-mono text-xs text-ink2">
                            SKU {cells.sku}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0">{pending(item)}</span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div className="min-w-0">
                        <dt className="text-muted">Cajas</dt>
                        <dd className="tabular-nums">{cells.boxes}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-muted">Paquetes</dt>
                        <dd className="tabular-nums">{cells.packages}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-muted">Cantidad suelta</dt>
                        <dd className="tabular-nums">{cells.loose}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-muted">Total</dt>
                        <dd className="font-semibold tabular-nums">
                          {cells.total}
                        </dd>
                      </div>
                    </dl>
                  </article>
                </li>
              );
            })}
          </ul>
          <div
            role="region"
            aria-label={`Tabla de ${section.section} desplazable`}
            tabIndex={0}
            className="hidden min-w-0 max-w-full overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-salmon-ink lg:block"
          >
            <table className={`${tableClass} min-w-[860px]`}>
              <caption className="sr-only">
                Producto, SKU, cajas, paquetes, cantidad suelta y total de{' '}
                {section.section}.
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
                {section.items.map((item) => {
                  const cells = countLineCells(item);
                  return (
                    <tr
                      key={item.product.id}
                      className="border-b border-line last:border-b-0 hover:bg-tint"
                    >
                      <td
                        className={`${tableCellClass} max-w-72 break-words font-semibold`}
                      >
                        {cells.name}
                        {!item.counted && (
                          <span className="mt-1 block">{pending(item)}</span>
                        )}
                      </td>
                      <td className={`${tableCellClass} font-mono text-xs`}>
                        {cells.sku ?? '—'}
                      </td>
                      <td className={`${tableCellClass} tabular-nums`}>
                        {cells.boxes}
                      </td>
                      <td className={`${tableCellClass} tabular-nums`}>
                        {cells.packages}
                      </td>
                      <td
                        className={`${tableCellClass} whitespace-nowrap tabular-nums`}
                      >
                        {cells.loose}
                      </td>
                      <td
                        className={`${tableCellClass} whitespace-nowrap font-semibold tabular-nums`}
                      >
                        {cells.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
