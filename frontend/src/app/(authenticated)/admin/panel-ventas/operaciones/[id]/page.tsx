import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { DifferenceBadge } from '@/components/sales-overview/SalesOverviewParts';
import {
  alertClass,
  buttonClass,
  infoNoticeClass,
  introClass,
  panelTitleClass,
  tableDescriptionClass,
  tableHeaderClass,
  tablePanelClass,
} from '@/components/ui/styles';
import {
  dailyVoucherHref,
  type DailyOperation,
  type DailyOperationVoucher,
} from '@/lib/daily-operations';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import { isProxyUuid } from '@/lib/backend-proxy';
import { fetchDailyOperation } from '@/lib/sales-overview-backend';
import {
  cashDifferenceLabel,
  dashboardHref,
  formatAmount,
  formatSignedAmount,
  salesOverviewError,
  type CashDifferenceType,
} from '@/lib/sales-overview';
import { getUsersSession } from '@/lib/users-session';

export const metadata: Metadata = {
  title: 'Operación diaria | Panel de ventas | MoiFood',
};

function differenceType(amount: number): CashDifferenceType {
  if (amount > 0) return 'SOBRANTE';
  if (amount < 0) return 'FALTANTE';
  return 'SIN_DIFERENCIA';
}

// SPRINT-4A-T11: diferencia con signo; sobrantes y faltantes se resaltan con
// su badge y el texto del tipo (el color nunca es la única señal).
function DifferenceValue({ amount }: { amount: number }): ReactElement {
  const type = differenceType(amount);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="tabular-nums">{formatSignedAmount(amount)}</span>
      {type === 'SIN_DIFERENCIA' ? (
        <span className="font-normal text-ink2">
          · {cashDifferenceLabel(type)}
        </span>
      ) : (
        <DifferenceBadge type={type} />
      )}
    </span>
  );
}

// SPRINT-4A-T11: vista previa y descarga del voucher por el BFF autenticado
// (/api/daily-operations/:id/voucher). La imagen no pasa por el optimizador
// de Next.js (unoptimized): el navegador la pide con la cookie de sesión y
// el archivo nunca tiene una URL pública.
function VoucherPanel({
  operation,
  voucher,
}: {
  operation: DailyOperation;
  voucher: DailyOperationVoucher | null;
}): ReactElement {
  const label = `${operation.store.name} del ${formatCalendarDate(operation.businessDate)}`;
  return (
    <section
      aria-labelledby="operation-voucher-title"
      className={tablePanelClass}
    >
      <header className={tableHeaderClass}>
        <div className="min-w-0">
          <h2 id="operation-voucher-title" className={panelTitleClass}>
            Voucher de propinas con tarjeta
          </h2>
          <p className={tableDescriptionClass}>
            Foto privada adjuntada por el supervisor. Cada vista y descarga
            queda registrada en la auditoría.
          </p>
        </div>
      </header>
      {voucher ? (
        <div className="grid min-w-0 gap-5 p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <figure className="min-w-0">
            <div className="relative h-80 w-full overflow-hidden rounded-xl border border-line bg-tint sm:h-96">
              <Image
                src={dailyVoucherHref(operation.id)}
                alt={`Foto del voucher de propinas con tarjeta de ${label}`}
                fill
                unoptimized
                sizes="(min-width: 1024px) 40rem, 100vw"
                className="object-contain"
              />
            </div>
            <figcaption className="mt-2 text-xs text-muted">
              Vista previa. Descarga el archivo para verlo en tamaño original.
            </figcaption>
          </figure>
          <div className="min-w-0 space-y-4">
            <dl className="grid min-w-0 gap-4 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Archivo</dt>
                <dd className="mt-1 font-medium break-words">
                  {voucher.fileName}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Tamaño</dt>
                <dd className="mt-1 font-medium">
                  {Math.ceil(voucher.sizeBytes / 1024)} KiB
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Adjuntado</dt>
                <dd className="mt-1 font-mono text-[13px]">
                  {formatChileDate(voucher.createdAt)} (hora de Chile)
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Huella SHA-256</dt>
                <dd className="mt-1 font-mono text-[13px] break-all">
                  {voucher.sha256Hash}
                </dd>
              </div>
            </dl>
            <a
              href={dailyVoucherHref(operation.id)}
              download={voucher.fileName}
              className={`${buttonClass} w-full sm:w-auto`}
              aria-label={`Descargar voucher de ${label}`}
            >
              Descargar voucher
            </a>
          </div>
        </div>
      ) : (
        <div className="p-5">
          <p role="note" className={infoNoticeClass}>
            Sin voucher: la operación no tiene propina con tarjeta, por lo que
            no corresponde adjuntar la foto.
          </p>
        </div>
      )}
    </section>
  );
}

// SPRINT-4R-T14: detalle de solo lectura de la operación diaria enlazada
// desde el panel y los reportes. Su fuente es el registro del supervisor; no
// contiene ventas (esas provienen del Excel importado). SPRINT-4A-T11 agrega
// la revisión del voucher y resalta la diferencia de efectivo.
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
  const fields: { label: string; value: ReactNode }[] = [
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
      value: <DifferenceValue amount={operation.cashDifference} />,
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
      value: operation.voucher ? 'Adjunto (ver abajo)' : 'Sin voucher',
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
      <VoucherPanel operation={operation} voucher={operation.voucher} />
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
