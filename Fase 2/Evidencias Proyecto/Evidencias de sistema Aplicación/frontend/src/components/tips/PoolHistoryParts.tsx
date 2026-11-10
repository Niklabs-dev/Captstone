import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  ScrollTable,
  rowClass,
} from '@/components/sales-overview/SalesOverviewParts';
import {
  badgeClass,
  buttonClass,
  tableCellClass,
  tableHeadClass,
  tableHeadingClass,
} from '@/components/ui/styles';
import type { StatusTone } from '@/lib/daily-tips';
import { formatCalendarDate } from '@/lib/display-date';
import {
  POOL_STATUS,
  POOL_STATUS_TONE,
  type PoolStatus,
  type TipPool,
} from '@/lib/tip-pools';
import { formatClp } from '@/lib/tips';

// Piezas del histórico de repartos por período (SPRINT-4A-T08). Server
// Components de solo lectura: no hay acciones sobre los repartos.
const toneClasses: Record<StatusTone, string> = {
  ok: 'bg-ok-bg text-ok',
  info: 'bg-info-bg text-info',
  warn: 'bg-warn-bg text-warn',
  neutral: 'bg-tint2 text-ink2',
};
// Por debajo de 640 px algunas columnas pasan a la primera celda.
const wideCell = 'hidden sm:table-cell';

export function poolDetailHref(id: string): string {
  return `/propinas/historico/${id}`;
}

export function poolPeriodLabel(pool: TipPool): string {
  return `${formatCalendarDate(pool.periodStart)} al ${formatCalendarDate(pool.periodEnd)}`;
}

export function PoolStatusBadge({
  status,
}: {
  status: PoolStatus;
}): ReactElement {
  return (
    <span className={`${badgeClass} ${toneClasses[POOL_STATUS_TONE[status]]}`}>
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {POOL_STATUS[status]}
    </span>
  );
}

export function PoolHistoryTable({
  caption,
  pools,
}: {
  caption: string;
  pools: readonly TipPool[];
}): ReactElement {
  return (
    <ScrollTable caption={caption}>
      <thead className={tableHeadClass}>
        <tr>
          <th scope="col" className={tableHeadingClass}>
            Período
          </th>
          <th scope="col" className={`${tableHeadingClass} ${wideCell}`}>
            Local
          </th>
          <th scope="col" className={`${tableHeadingClass} ${wideCell}`}>
            Estado
          </th>
          <th scope="col" className={`${tableHeadingClass} text-right`}>
            Total
          </th>
          <th scope="col" className={`${tableHeadingClass} ${wideCell}`}>
            Pago
          </th>
          <th scope="col" className={tableHeadingClass}>
            <span className="sr-only">Detalle</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {pools.map((pool) => (
          <tr key={pool.id} className={rowClass}>
            <td className={tableCellClass}>
              <span className="font-mono whitespace-nowrap">
                {poolPeriodLabel(pool)}
              </span>
              <span className="mt-2 flex flex-col items-start gap-1 sm:hidden">
                <span className="text-[11px] text-ink2">{pool.store.name}</span>
                <PoolStatusBadge status={pool.status} />
              </span>
            </td>
            <td className={`${tableCellClass} ${wideCell}`}>
              {pool.store.name}
            </td>
            <td className={`${tableCellClass} ${wideCell}`}>
              <PoolStatusBadge status={pool.status} />
            </td>
            <td
              className={`${tableCellClass} text-right font-medium whitespace-nowrap tabular-nums`}
            >
              {formatClp(pool.totalAmount)}
            </td>
            <td
              className={`${tableCellClass} ${wideCell} whitespace-nowrap text-ink2`}
            >
              {pool.paymentDate ? (
                <span className="font-mono whitespace-nowrap">
                  {formatCalendarDate(pool.paymentDate)}
                </span>
              ) : (
                'Sin pago'
              )}
            </td>
            <td className={`${tableCellClass} text-right`}>
              <Link
                href={poolDetailHref(pool.id)}
                prefetch={false}
                aria-label={`Ver reparto de ${pool.store.name} del ${poolPeriodLabel(pool)}`}
                className={`${buttonClass} whitespace-nowrap`}
              >
                Ver detalle
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}
