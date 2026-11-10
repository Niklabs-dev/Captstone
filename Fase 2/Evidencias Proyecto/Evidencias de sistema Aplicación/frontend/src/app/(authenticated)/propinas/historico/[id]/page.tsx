import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import {
  EmptyState,
  ScrollTable,
  TablePanel,
  rowClass,
} from '@/components/sales-overview/SalesOverviewParts';
import {
  PoolStatusBadge,
  poolPeriodLabel,
} from '@/components/tips/PoolHistoryParts';
import {
  alertClass,
  badgeClass,
  buttonClass,
  infoNoticeClass,
  tableCellClass,
  tableHeadClass,
  tableHeadingClass,
} from '@/components/ui/styles';
import { ACCESS_COOKIE } from '@/lib/auth';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import { getSession } from '@/lib/session';
import {
  POOL_STATUS_NOTE,
  poolError,
  poolReceiptHref,
  poolRuleLabel,
  type PoolPerson,
  type PoolReceipt,
  type TipPool,
} from '@/lib/tip-pools';
import { fetchPool, fetchPoolReceipts } from '@/lib/tip-pools-backend';
import { formatClp } from '@/lib/tips';
import type { BackendResult } from '@/lib/auth-backend';
import { isUuid } from '@/lib/users';

export const metadata: Metadata = {
  title: 'Reparto anterior | Propinas | MoiFood',
};

function BackLink(): ReactElement {
  return (
    <Link href="/propinas/historico" prefetch={false} className={buttonClass}>
      Volver a repartos anteriores
    </Link>
  );
}

function trace(person: PoolPerson | null, at: string | null): string {
  return person && at
    ? `${person.name} el ${formatChileDate(at)}`
    : 'No corresponde';
}

function PoolSummary({ pool }: { pool: TipPool }): ReactElement {
  const fields: { label: string; value: ReactNode }[] = [
    { label: 'Local', value: pool.store.name },
    { label: 'Período', value: poolPeriodLabel(pool) },
    { label: 'Estado', value: <PoolStatusBadge status={pool.status} /> },
    { label: 'Fondo total', value: formatClp(pool.totalAmount) },
    { label: 'Regla aplicada', value: poolRuleLabel(pool.rule) },
    {
      label: 'Calculado por',
      value: trace(pool.calculatedBy, pool.calculatedAt),
    },
    {
      label: 'Confirmado por',
      value: trace(pool.confirmedBy, pool.confirmedAt),
    },
    {
      label: 'Pagado por',
      value:
        pool.paidBy && pool.paymentDate
          ? `${pool.paidBy.name}, pago del ${formatCalendarDate(pool.paymentDate)}`
          : 'Sin pago',
    },
  ];
  if (pool.rule === 'PROPORTIONAL_TO_HOURS')
    fields.push(
      { label: 'Horas totales', value: pool.totalHours },
      {
        label: 'Pacto aplicado',
        value: pool.agreement?.name ?? 'Sin pacto histórico disponible',
      },
    );
  if (pool.notes) fields.push({ label: 'Observación', value: pool.notes });
  return (
    <TablePanel id="pool-summary-title" title="Resumen del reparto">
      <div className="space-y-4 p-4 sm:p-5">
        <p role="note" className={infoNoticeClass}>
          {POOL_STATUS_NOTE[pool.status]}
        </p>
        <dl className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {fields.map((field) => (
            <div key={field.label} className="min-w-0">
              <dt className="text-xs text-ink2">{field.label}</dt>
              <dd className="mt-1 font-medium break-words">{field.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </TablePanel>
  );
}

function PoolLines({ pool }: { pool: TipPool }): ReactElement {
  const hours = pool.rule === 'PROPORTIONAL_TO_HOURS';
  return (
    <TablePanel
      id="pool-lines-title"
      title="Montos por trabajador"
      description="Foto guardada del reparto; no se recalcula."
      aside={
        <span className={`${badgeClass} bg-tint2 text-salmon-ink`}>
          {pool.lines.length}{' '}
          {pool.lines.length === 1 ? 'trabajador' : 'trabajadores'}
        </span>
      }
    >
      {pool.lines.length === 0 ? (
        <EmptyState>El reparto no tiene trabajadores.</EmptyState>
      ) : (
        <ScrollTable caption="Montos por trabajador del reparto">
          <thead className={tableHeadClass}>
            <tr>
              <th scope="col" className={tableHeadingClass}>
                Trabajador
              </th>
              {hours && (
                <th scope="col" className={`${tableHeadingClass} text-right`}>
                  Horas
                </th>
              )}
              <th scope="col" className={`${tableHeadingClass} text-right`}>
                Monto
              </th>
            </tr>
          </thead>
          <tbody>
            {pool.lines.map((line) => (
              <tr key={line.userId} className={rowClass}>
                <td className={tableCellClass}>{line.workerName}</td>
                {hours && (
                  <td className={`${tableCellClass} text-right tabular-nums`}>
                    {line.hoursWorked}
                  </td>
                )}
                <td
                  className={`${tableCellClass} text-right font-medium whitespace-nowrap tabular-nums`}
                >
                  {formatClp(line.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </TablePanel>
  );
}

function PoolReceipts({
  receipts,
}: {
  receipts: BackendResult<PoolReceipt[]>;
}): ReactElement {
  return (
    <TablePanel
      id="pool-receipts-title"
      title="Constancias de pago"
      description="PDF generado desde la foto guardada al pagar. Cada descarga queda registrada en la auditoría."
    >
      {!receipts.ok ? (
        <p role="alert" className={`${alertClass} m-5`}>
          {receipts.message}
        </p>
      ) : receipts.data.length === 0 ? (
        <EmptyState>El reparto no tiene constancias.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {receipts.data.map((receipt) => (
            <li
              key={receipt.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm sm:px-5"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {receipt.workerName} · {formatClp(receipt.amount)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Pagado el {formatCalendarDate(receipt.paymentDate)} por{' '}
                  {receipt.paidBy.name}
                </p>
              </div>
              <a
                href={poolReceiptHref(receipt.poolId, receipt.userId)}
                download
                aria-label={`Descargar constancia de ${receipt.workerName}`}
                className={buttonClass}
              >
                Descargar constancia
              </a>
            </li>
          ))}
        </ul>
      )}
    </TablePanel>
  );
}

// SPRINT-4A-T08: detalle de solo lectura de un reparto por período
// histórico, con las constancias PDF de los pagados. Sin acciones: el
// reparto ya no se calcula, confirma ni paga.
export default async function PoolHistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    throw new Error(session.message);
  }
  if (!['ADMINISTRADOR', 'CONTADOR'].includes(session.data.role))
    redirect('/dashboard?reason=forbidden');
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect('/session-expired');
  const { id } = await params;
  const result = isUuid(id)
    ? await fetchPool(token, id)
    : { ok: false as const, status: 404, message: poolError(404) };
  if (!result.ok) {
    if (result.status === 401) redirect('/session-expired');
    return (
      <>
        <p role="alert" className={alertClass}>
          El reparto no está disponible. {result.message}
        </p>
        <BackLink />
      </>
    );
  }
  const pool = result.data;
  const receipts =
    pool.status === 'PAID' ? await fetchPoolReceipts(token, pool.id) : null;
  if (receipts && !receipts.ok && receipts.status === 401)
    redirect('/session-expired');
  return (
    <>
      <div>
        <BackLink />
      </div>
      <PoolSummary pool={pool} />
      <PoolLines pool={pool} />
      {receipts && <PoolReceipts receipts={receipts} />}
    </>
  );
}
