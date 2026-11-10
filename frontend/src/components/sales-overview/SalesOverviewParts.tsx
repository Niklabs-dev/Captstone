import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import {
  badgeClass,
  buttonClass,
  scrollRegionClass,
  tableCellClass,
  tableClass,
  tableDescriptionClass,
  tableHeadClass,
  tableHeaderClass,
  tableHeadingClass,
  tablePanelClass,
  panelTitleClass,
} from '@/components/ui/styles';
import { formatCalendarDate } from '@/lib/display-date';
import {
  cashDifferenceLabel,
  formatAmount,
  formatSignedAmount,
  methodAmount,
  MISSING_VALUE,
  operationDetailHref,
  salesDayPresentation,
  voucherPresentation,
  type CashDifferenceLine,
  type DailyOperationFigures,
  type PaymentMethodAmount,
  type PaymentMethodColumn,
  type SalesDayStatus,
  type StatusTone,
} from '@/lib/sales-overview';

// Piezas compartidas del panel y los reportes de ventas (SPRINT-4R-T14).
// Server Components: no tienen interactividad.
export const rowClass = 'border-b border-line last:border-b-0 hover:bg-tint';
const toneClasses: Record<StatusTone, string> = {
  ok: 'bg-ok-bg text-ok',
  info: 'bg-info-bg text-info',
  crit: 'bg-crit-bg text-crit',
  neutral: 'bg-tint2 text-ink2',
};

export function StatusBadge({
  status,
}: {
  status: SalesDayStatus | null;
}): ReactElement {
  const { label, tone } = salesDayPresentation(status);
  return (
    <span className={`${badgeClass} ${toneClasses[tone]}`}>
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {label}
    </span>
  );
}
export function DifferenceBadge({
  type,
}: {
  type: CashDifferenceLine['type'];
}): ReactElement {
  return (
    <span
      className={`${badgeClass} ${type === 'FALTANTE' ? toneClasses.crit : toneClasses.ok}`}
    >
      {cashDifferenceLabel(type)}
    </span>
  );
}

// SPRINT-4A-T11: indica si la operación tiene foto del voucher; el archivo
// se revisa en el detalle de la operación.
export function VoucherBadge({
  figures,
}: {
  figures: DailyOperationFigures;
}): ReactElement {
  const { label, tone } = voucherPresentation(figures);
  return <span className={`${badgeClass} ${toneClasses[tone]}`}>{label}</span>;
}

// Un monto confirmado o «Sin dato» atenuado; nunca $0 por ausencia.
export function Amount({
  value,
  signed = false,
}: {
  value: number | null;
  signed?: boolean;
}): ReactElement {
  if (value === null)
    return <span className="text-muted">{MISSING_VALUE}</span>;
  return (
    <span className="tabular-nums">
      {signed ? formatSignedAmount(value) : formatAmount(value)}
    </span>
  );
}

export interface SummaryItem {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}
export function SummaryTiles({
  items,
}: {
  items: readonly SummaryItem[];
}): ReactElement {
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 rounded-[14px] border border-line bg-bg p-4"
        >
          <dt className="text-xs font-semibold text-ink2">{item.label}</dt>
          <dd className="mt-2 text-base font-bold break-words">{item.value}</dd>
          {item.detail && (
            <dd className="mt-1 text-xs break-words text-muted">
              {item.detail}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

export function TablePanel({
  id,
  title,
  description,
  aside,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section aria-labelledby={id} className={tablePanelClass}>
      <header className={tableHeaderClass}>
        <div className="min-w-0">
          <h2 id={id} className={panelTitleClass}>
            {title}
          </h2>
          {description && (
            <p className={tableDescriptionClass}>{description}</p>
          )}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
export function ScrollTable({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={scrollRegionClass}
    >
      <table className={tableClass}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
export function EmptyState({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <p role="status" className="p-5 text-sm text-ink2">
      {children}
    </p>
  );
}

export function methodHeading(column: PaymentMethodColumn): string {
  return column.paymentMethodName + (column.isActive ? '' : ' (inactivo)');
}

export interface MethodRow {
  key: string;
  label: string;
  // null: sin ventas importadas (sin dato).
  sales: { totalAmount: number; byPaymentMethod: PaymentMethodAmount[] } | null;
  detail?: ReactNode;
}
// Ventas importadas por medio de pago: columnas dinámicas del catálogo.
export function SalesByMethodTable({
  caption,
  firstHeading,
  columns,
  rows,
  total,
}: {
  caption: string;
  firstHeading: string;
  columns: readonly PaymentMethodColumn[];
  rows: readonly MethodRow[];
  total?: MethodRow;
}): ReactElement {
  return (
    <ScrollTable caption={caption}>
      <thead className={tableHeadClass}>
        <tr>
          <th scope="col" className={tableHeadingClass}>
            {firstHeading}
          </th>
          {columns.map((column) => (
            <th
              key={column.paymentMethod}
              scope="col"
              className={`${tableHeadingClass} text-right`}
            >
              {methodHeading(column)}
            </th>
          ))}
          <th scope="col" className={`${tableHeadingClass} text-right`}>
            Total ventas
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className={rowClass}>
            <th
              scope="row"
              className={`${tableCellClass} min-w-40 break-words font-medium`}
            >
              {row.label}
              {row.detail && (
                <span className="mt-1 block text-xs font-normal text-muted">
                  {row.detail}
                </span>
              )}
            </th>
            {columns.map((column) => (
              <td
                key={column.paymentMethod}
                className={`${tableCellClass} whitespace-nowrap text-right`}
              >
                <Amount value={methodAmount(row.sales, column.paymentMethod)} />
              </td>
            ))}
            <td
              className={`${tableCellClass} whitespace-nowrap text-right font-semibold`}
            >
              <Amount value={row.sales?.totalAmount ?? null} />
            </td>
          </tr>
        ))}
      </tbody>
      {total && (
        <tfoot className="border-t border-line">
          <tr>
            <th scope="row" className={`${tableCellClass} font-semibold`}>
              {total.label}
              {total.detail && (
                <span className="mt-1 block text-xs font-normal text-muted">
                  {total.detail}
                </span>
              )}
            </th>
            {columns.map((column) => (
              <td
                key={column.paymentMethod}
                className={`${tableCellClass} whitespace-nowrap text-right font-semibold`}
              >
                <Amount
                  value={methodAmount(total.sales, column.paymentMethod)}
                />
              </td>
            ))}
            <td
              className={`${tableCellClass} whitespace-nowrap text-right font-semibold`}
            >
              <Amount value={total.sales?.totalAmount ?? null} />
            </td>
          </tr>
        </tfoot>
      )}
    </ScrollTable>
  );
}

// Cada diferencia de efectivo distinta de cero, con signo y motivo, sin
// compensar sobrantes con faltantes.
export function CashDifferencesTable({
  lines,
  caption,
  emptyText,
}: {
  lines: readonly CashDifferenceLine[];
  caption: string;
  emptyText: string;
}): ReactElement {
  if (lines.length === 0) return <EmptyState>{emptyText}</EmptyState>;
  return (
    <ScrollTable caption={caption}>
      <thead className={tableHeadClass}>
        <tr>
          <th scope="col" className={tableHeadingClass}>
            Local
          </th>
          <th scope="col" className={tableHeadingClass}>
            Fecha
          </th>
          <th scope="col" className={tableHeadingClass}>
            Tipo
          </th>
          <th scope="col" className={`${tableHeadingClass} text-right`}>
            Diferencia
          </th>
          <th scope="col" className={tableHeadingClass}>
            Motivo
          </th>
          <th scope="col" className={tableHeadingClass}>
            Fuente
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.operationId} className={rowClass}>
            <th
              scope="row"
              className={`${tableCellClass} min-w-36 break-words font-medium`}
            >
              {line.store.name}
            </th>
            <td className={`${tableCellClass} whitespace-nowrap font-mono`}>
              {formatCalendarDate(line.businessDate)}
            </td>
            <td className={tableCellClass}>
              <DifferenceBadge type={line.type} />
            </td>
            <td
              className={`${tableCellClass} whitespace-nowrap text-right font-semibold`}
            >
              <Amount value={line.amount} signed />
            </td>
            <td className={`${tableCellClass} min-w-48 break-words`}>
              {line.reason ?? <span className="text-muted">Sin motivo</span>}
            </td>
            <td className={`${tableCellClass} whitespace-nowrap`}>
              <Link
                href={operationDetailHref(line.operationId)}
                prefetch={false}
                className={buttonClass}
                aria-label={`Ver operación diaria de ${line.store.name} del ${formatCalendarDate(line.businessDate)}`}
              >
                Ver operación diaria
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}
