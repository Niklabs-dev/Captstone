import Link from 'next/link';
import type { ReactElement } from 'react';
import { SummaryTiles } from '@/components/sales-overview/SalesOverviewParts';
import {
  alertClass,
  badgeClass,
  buttonClass,
  panelTitleClass,
  tableDescriptionClass,
  tableHeaderClass,
  tablePanelClass,
} from '@/components/ui/styles';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import {
  formatMonth,
  myTipStatusLabel,
  myTipsPageHref,
  weekdayOf,
  type MyTipDay,
  type MyTips,
} from '@/lib/my-tips';
import { formatClp } from '@/lib/tips';

// «Mis propinas» por día (SPRINT-4A-T10): totales pendiente y pagado del
// mes y una tarjeta por día con local, monto y estado. Solo lectura y sin
// JavaScript en el navegador: la página la arma en el servidor.

function StatusBadge({ day }: { day: MyTipDay }): ReactElement {
  const paid = day.status === 'PAID';
  return (
    <span
      className={`${badgeClass} ${paid ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn'}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {myTipStatusLabel(day.status)}
    </span>
  );
}

export function MyDailyTipsTotals({ tips }: { tips: MyTips }): ReactElement {
  const pendingDays = tips.days.filter((day) => day.status === 'UNPAID');
  return (
    <section aria-labelledby="my-tips-totals-title" className="space-y-3">
      <h2 id="my-tips-totals-title" className={panelTitleClass}>
        Totales del mes
      </h2>
      <SummaryTiles
        items={[
          {
            label: 'Pendiente de pago',
            value: formatClp(tips.totals.unpaidAmount),
            detail:
              pendingDays.length === 0
                ? 'Sin propinas pendientes'
                : `${pendingDays.length} ${pendingDays.length === 1 ? 'día' : 'días'} por pagar`,
          },
          {
            label: 'Pagado',
            value: formatClp(tips.totals.paidAmount),
          },
          {
            label: 'Total del mes',
            value: formatClp(tips.totals.totalAmount),
            detail: `${tips.totals.dayCount} ${tips.totals.dayCount === 1 ? 'día con propina' : 'días con propina'}`,
          },
        ]}
      />
    </section>
  );
}

export function MyDailyTipsList({
  tips,
  month,
}: {
  tips: MyTips;
  month: string;
}): ReactElement {
  return (
    <section aria-labelledby="my-tips-days-title" className={tablePanelClass}>
      <header className={tableHeaderClass}>
        <div>
          <h2 id="my-tips-days-title" className={panelTitleClass}>
            Propinas por día · {formatMonth(month)}
          </h2>
          <p className={tableDescriptionClass}>
            Montos en pesos chilenos. Cada propina aparece apenas tu supervisor
            guarda la operación del día y pasa a Pagada cuando se registra su
            pago.
          </p>
        </div>
      </header>
      {tips.days.length === 0 ? (
        <div className="space-y-2 p-5">
          <h3 className="text-sm font-semibold">
            No tienes propinas en {formatMonth(month).toLowerCase()}
          </h3>
          <p className="text-sm text-ink2">
            Aparecerán aquí cuando tu supervisor registre la operación de un día
            en que hayas participado. Puedes elegir otro mes en el filtro.
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {tips.days.map((day) => (
              <li key={day.id}>
                <article
                  aria-label={`Propina del ${formatCalendarDate(day.businessDate)}: ${formatClp(day.amount)}, ${myTipStatusLabel(day.status)}`}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                >
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">
                      <span className="capitalize">
                        {weekdayOf(day.businessDate)}
                      </span>{' '}
                      <time dateTime={day.businessDate} className="font-mono">
                        {formatCalendarDate(day.businessDate)}
                      </time>
                    </h3>
                    <p className="mt-1 text-xs text-ink2 wrap-anywhere">
                      {day.store.name}
                    </p>
                    {day.paidAt && (
                      <p className="mt-1 text-xs text-muted">
                        Pagada el{' '}
                        <time dateTime={day.paidAt} className="font-mono">
                          {formatChileDate(day.paidAt)}
                        </time>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <p className="text-base font-bold tabular-nums">
                      {formatClp(day.amount)}
                    </p>
                    <StatusBadge day={day} />
                  </div>
                </article>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-5 py-3 text-xs text-muted">
            {tips.days.length} {tips.days.length === 1 ? 'propina' : 'propinas'}{' '}
            en el mes
          </p>
        </>
      )}
    </section>
  );
}

export function MyDailyTipsError({
  message,
  month,
}: {
  message: string;
  month: string;
}): ReactElement {
  return (
    <div className="space-y-3">
      <p role="alert" className={alertClass}>
        {message}
      </p>
      <Link
        href={myTipsPageHref(month)}
        prefetch={false}
        className={buttonClass}
      >
        Volver a consultar el mes
      </Link>
    </div>
  );
}
