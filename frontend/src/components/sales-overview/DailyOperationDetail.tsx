import Image from 'next/image';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import {
  alertClass,
  buttonClass,
  infoNoticeClass,
  introClass,
  panelTitleClass,
  tableCellClass,
  tableDescriptionClass,
  tableHeadClass,
  tableHeaderClass,
  tableHeadingClass,
  tablePanelClass,
} from '@/components/ui/styles';
import type { BackendResult } from '@/lib/auth-backend';
import {
  dailyVoucherHref,
  type DailyOperation,
  type DailyOperationVoucher,
} from '@/lib/daily-operations';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import {
  cashDifferenceLabel,
  formatAmount,
  formatSignedAmount,
  type CashDifferenceType,
  type OperationDaySales,
} from '@/lib/sales-overview';
import {
  Amount,
  DifferenceBadge,
  methodHeading,
  rowClass,
  ScrollTable,
  StatusBadge,
} from './SalesOverviewParts';

// Detalle de solo lectura de la operación diaria (SPRINT-4R-T14), con la
// revisión del voucher y la diferencia resaltada (SPRINT-4A-T11). SPRINT-4A-T23
// lo comparte entre el panel (administrador) y los reportes (administrador y
// contador) y agrega, junto a la diferencia, las ventas del mismo local y día
// por medio de pago de la importación vigente. No tiene acciones de edición:
// la corrección sigue siendo del supervisor por su propia vista.

function differenceType(amount: number): CashDifferenceType {
  if (amount > 0) return 'SOBRANTE';
  if (amount < 0) return 'FALTANTE';
  return 'SIN_DIFERENCIA';
}

// Diferencia con signo; sobrantes y faltantes se resaltan con su badge y el
// texto del tipo (el color nunca es la única señal).
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

function Fields({
  fields,
  className,
}: {
  fields: readonly { label: string; value: ReactNode }[];
  className: string;
}): ReactElement {
  return (
    <dl className={`grid min-w-0 gap-4 text-sm ${className}`}>
      {fields.map((field) => (
        <div key={field.label} className="min-w-0">
          <dt className="text-xs text-ink2">{field.label}</dt>
          <dd className="mt-1 font-medium break-words">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Aviso cuando el día no tiene Excel vigente: nunca se muestran ceros.
function MissingSalesNotice({
  daySales,
}: {
  daySales: OperationDaySales;
}): ReactElement {
  const status = daySales.importStatus;
  return (
    <div className="space-y-3">
      <p role="note" className={infoNoticeClass}>
        No hay una importación vigente del Excel de MrComanda para este local y
        día, por lo que no se pueden contrastar las ventas por medio de pago.
        {status?.pendingImportId
          ? ' Hay una carga sin confirmar: el administrador debe revisarla y confirmarla.'
          : ' El administrador debe importar el informe de ventas del día.'}
      </p>
      {status && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink2">
          Estado de la importación: <StatusBadge status={status.status} />
          {status.closure && (
            <span className="break-words">
              Motivo del cierre: {status.closure.reason}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function DaySalesTable({
  daySales,
  label,
}: {
  daySales: OperationDaySales & {
    sales: NonNullable<OperationDaySales['sales']>;
  };
  label: string;
}): ReactElement {
  return (
    <div className="min-w-0 space-y-2">
      <ScrollTable caption={`Ventas por medio de pago de ${label}`}>
        <thead className={tableHeadClass}>
          <tr>
            <th scope="col" className={tableHeadingClass}>
              Medio de pago
            </th>
            <th scope="col" className={`${tableHeadingClass} text-right`}>
              Ventas (Excel)
            </th>
          </tr>
        </thead>
        <tbody>
          {daySales.methods.map((method) => (
            <tr key={method.paymentMethod} className={rowClass}>
              <th
                scope="row"
                className={`${tableCellClass} break-words font-medium`}
              >
                {methodHeading(method)}
              </th>
              <td className={`${tableCellClass} whitespace-nowrap text-right`}>
                <Amount value={method.amount} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-line">
          <tr>
            <th scope="row" className={`${tableCellClass} font-semibold`}>
              Total ventas
            </th>
            <td
              className={`${tableCellClass} whitespace-nowrap text-right font-semibold`}
            >
              <Amount value={daySales.sales.totalAmount} />
            </td>
          </tr>
        </tfoot>
      </ScrollTable>
      <p className="text-xs text-muted">
        Importación vigente, versión {daySales.sales.version}. Las propinas no
        se incluyen en estas ventas.
      </p>
    </div>
  );
}

// SPRINT-4A-T23: la diferencia declarada junto a las ventas del día por
// medio de pago, para comprobar si un pago en efectivo se registró como
// débito o crédito (o al revés) antes de revisar el voucher.
function DifferenceContrastPanel({
  operation,
  daySales,
  label,
}: {
  operation: DailyOperation;
  daySales: BackendResult<OperationDaySales>;
  label: string;
}): ReactElement {
  return (
    <section
      aria-labelledby="operation-contrast-title"
      className={tablePanelClass}
    >
      <header className={tableHeaderClass}>
        <div className="min-w-0">
          <h2 id="operation-contrast-title" className={panelTitleClass}>
            Diferencia de efectivo y ventas del día
          </h2>
          <p className={tableDescriptionClass}>
            Contrasta lo declarado por el supervisor con las ventas por medio de
            pago del Excel vigente y con el voucher: un pago en efectivo
            registrado como tarjeta (o al revés) suele aparecer como una
            diferencia de efectivo del mismo monto.
          </p>
        </div>
      </header>
      <div className="grid min-w-0 gap-5 p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Fields
          className="content-start grid-cols-1 sm:grid-cols-2 lg:grid-cols-1"
          fields={[
            {
              label: 'Diferencia de efectivo',
              value: <DifferenceValue amount={operation.cashDifference} />,
            },
            {
              label: 'Motivo de la diferencia',
              value:
                operation.differenceReason ?? 'Sin motivo (no hubo diferencia)',
            },
            {
              label: 'Propina con tarjeta (voucher)',
              value: formatAmount(operation.cardTipAmount),
            },
            {
              label: 'Propina en efectivo',
              value: formatAmount(operation.cashTipAmount),
            },
          ]}
        />
        <div className="min-w-0">
          {!daySales.ok ? (
            <p role="alert" className={alertClass}>
              No se pudieron cargar las ventas del día. {daySales.message}
            </p>
          ) : daySales.data.sales ? (
            <DaySalesTable
              daySales={{ ...daySales.data, sales: daySales.data.sales }}
              label={label}
            />
          ) : (
            <MissingSalesNotice daySales={daySales.data} />
          )}
        </div>
      </div>
    </section>
  );
}

// Vista previa y descarga del voucher por el BFF autenticado
// (/api/daily-operations/:id/voucher). La imagen no pasa por el optimizador
// de Next.js (unoptimized): el navegador la pide con la cookie de sesión y
// el archivo nunca tiene una URL pública.
function VoucherPanel({
  operation,
  voucher,
  label,
}: {
  operation: DailyOperation;
  voucher: DailyOperationVoucher | null;
  label: string;
}): ReactElement {
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
            <Fields
              className="grid-cols-1"
              fields={[
                { label: 'Archivo', value: voucher.fileName },
                {
                  label: 'Tamaño',
                  value: `${Math.ceil(voucher.sizeBytes / 1024)} KiB`,
                },
                {
                  label: 'Adjuntado',
                  value: (
                    <span className="font-mono text-[13px] font-normal">
                      {formatChileDate(voucher.createdAt)} (hora de Chile)
                    </span>
                  ),
                },
                {
                  label: 'Huella SHA-256',
                  value: (
                    <span className="font-mono text-[13px] font-normal break-all">
                      {voucher.sha256Hash}
                    </span>
                  ),
                },
              ]}
            />
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

export interface DetailLink {
  href: string;
  label: string;
}

export function DailyOperationDetail({
  operation,
  daySales,
  links,
}: {
  operation: DailyOperation;
  daySales: BackendResult<OperationDaySales>;
  links: readonly DetailLink[];
}): ReactElement {
  const label = `${operation.store.name} del ${formatCalendarDate(operation.businessDate)}`;
  return (
    <>
      <p className={introClass}>
        Vista de solo lectura con los datos declarados por el supervisor en la
        operación diaria y, para contrastarlos, las ventas del Excel de
        MrComanda vigente del mismo local y día.
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
        <Fields
          className="grid-cols-1 p-5 sm:grid-cols-2 xl:grid-cols-3"
          fields={[
            { label: 'Local', value: operation.store.name },
            {
              label: 'Fecha de negocio',
              value: formatCalendarDate(operation.businessDate),
            },
            {
              label: 'Fondo de propinas',
              value: formatAmount(operation.tipFundAmount),
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
          ]}
        />
      </section>
      <DifferenceContrastPanel
        operation={operation}
        daySales={daySales}
        label={label}
      />
      <VoucherPanel
        operation={operation}
        voucher={operation.voucher}
        label={label}
      />
      <div className="flex flex-wrap gap-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            prefetch={false}
            className={buttonClass}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </>
  );
}
