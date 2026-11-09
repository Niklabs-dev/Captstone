import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import {
  alertClass,
  buttonClass,
  introClass,
  panelTitleClass,
  tableHeaderClass,
  tablePanelClass,
} from '@/components/ui/styles';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import { isProxyUuid } from '@/lib/backend-proxy';
import { fetchDailyOperation } from '@/lib/sales-overview-backend';
import {
  cashDifferenceLabel,
  dashboardHref,
  formatAmount,
  formatSignedAmount,
  salesOverviewError,
} from '@/lib/sales-overview';
import { getUsersSession } from '@/lib/users-session';

export const metadata: Metadata = {
  title: 'Operación diaria | Panel de ventas | MoiFood',
};

// SPRINT-4R-T14: detalle de solo lectura de la operación diaria enlazada
// desde el panel y los reportes. Su fuente es el registro del supervisor; no
// contiene ventas (esas provienen del Excel importado).
export default async function DailyOperationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error('No se pudo verificar tu sesión. Intenta nuevamente.');
  }
  const { id } = await params;
  const result = isProxyUuid(id)
    ? await fetchDailyOperation(session.token, id)
    : { ok: false as const, status: 404, message: salesOverviewError(404) };
  if (!result.ok) {
    if (result.status === 401) redirect('/session-expired');
    return (
      <>
        <p role="alert" className={alertClass}>
          La operación diaria no está disponible. {result.message}
        </p>
        <Link
          href="/admin/panel-ventas"
          prefetch={false}
          className={buttonClass}
        >
          Volver al panel
        </Link>
      </>
    );
  }
  const operation = result.data;
  const difference = operation.cashDifference;
  const type =
    difference > 0
      ? 'SOBRANTE'
      : difference < 0
        ? 'FALTANTE'
        : 'SIN_DIFERENCIA';
  const fields: { label: string; value: string }[] = [
    { label: 'Local', value: operation.store.name },
    {
      label: 'Fecha de negocio',
      value: formatCalendarDate(operation.businessDate),
    },
    {
      label: 'Propina con tarjeta',
      value: formatAmount(operation.cardTipAmount),
    },
    {
      label: 'Propina en efectivo',
      value: formatAmount(operation.cashTipAmount),
    },
    {
      label: 'Fondo de propinas',
      value: formatAmount(operation.tipFundAmount),
    },
    {
      label: 'Diferencia de efectivo',
      value: `${formatSignedAmount(difference)} · ${cashDifferenceLabel(type)}`,
    },
    {
      label: 'Motivo de la diferencia',
      value: operation.differenceReason ?? 'Sin motivo (no hubo diferencia)',
    },
    { label: 'Registrada por', value: operation.responsible.name },
    {
      label: 'Última actualización',
      value: formatChileDate(operation.updatedAt) + ' (hora de Chile)',
    },
    {
      label: 'Voucher',
      value: operation.voucher
        ? `${operation.voucher.fileName} (adjunto)`
        : 'Sin voucher',
    },
    {
      label: 'Participantes del reparto',
      value: operation.participants.length
        ? operation.participants.map((person) => person.name).join(', ')
        : 'Sin participantes',
    },
  ];
  return (
    <>
      <p className={introClass}>
        Datos declarados por el supervisor en la operación diaria. No incluye
        ventas: las ventas del día provienen del Excel de MrComanda importado.
      </p>
      <section
        aria-labelledby="operation-detail-title"
        className={tablePanelClass}
      >
        <header className={tableHeaderClass}>
          <h2 id="operation-detail-title" className={panelTitleClass}>
            Operación diaria · {operation.store.name} ·{' '}
            {formatCalendarDate(operation.businessDate)}
          </h2>
        </header>
        <dl className="grid min-w-0 grid-cols-1 gap-4 p-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {fields.map((field) => (
            <div key={field.label} className="min-w-0">
              <dt className="text-xs text-ink2">{field.label}</dt>
              <dd className="mt-1 font-medium break-words">{field.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="flex flex-wrap gap-3">
        <Link
          href={dashboardHref(operation.businessDate)}
          prefetch={false}
          className={buttonClass}
        >
          Volver al panel del día
        </Link>
      </div>
    </>
  );
}
