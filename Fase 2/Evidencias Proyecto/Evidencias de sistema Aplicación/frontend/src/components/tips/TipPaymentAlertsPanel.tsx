import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  EmptyState,
  TablePanel,
} from '@/components/sales-overview/SalesOverviewParts';
import { alertClass, badgeClass, buttonClass } from '@/components/ui/styles';
import type { BackendResult } from '@/lib/auth-backend';
import { periodLabel, plural } from '@/lib/daily-tips';
import { formatCalendarDate } from '@/lib/display-date';
import {
  alertPeriodIsClipped,
  groupAlertsByStore,
  legalTermText,
  overdueText,
  tipAlertHref,
  type TipPaymentAlerts,
} from '@/lib/tip-payment-alerts';
import { formatClp } from '@/lib/tips';

// Alerta legal de pago de propinas (SPRINT-4A-T22) en /propinas: propinas
// diarias No pagadas que superaron los días legales de pago, por local y
// trabajador, con monto y atraso. Cada local enlaza a /propinas con su
// período vencido para revisarlo y pagarlo; al pagar, la página se vuelve a
// consultar y la alerta desaparece. Server Component: solo lectura.
export function TipPaymentAlertsPanel({
  result,
}: {
  result: BackendResult<TipPaymentAlerts>;
}): ReactElement {
  if (!result.ok)
    return (
      <TablePanel id="tip-alerts-title" title="Propinas vencidas sin pagar">
        <p role="alert" className={`${alertClass} m-5`}>
          {result.message}
        </p>
      </TablePanel>
    );
  const alerts = result.data;
  const stores = groupAlertsByStore(alerts.items);
  return (
    <TablePanel
      id="tip-alerts-title"
      title="Propinas vencidas sin pagar"
      description={
        `Plazo legal de pago: ${legalTermText(alerts.legalPaymentDays)} desde el día siguiente a la fecha de la propina, sin fines de semana ni feriados. ` +
        `Hoy (${formatCalendarDate(alerts.asOf)}, hora de Chile) están vencidas las propinas no pagadas hasta el ${formatCalendarDate(alerts.overdueThrough)}.`
      }
      aside={
        alerts.totals.alertCount > 0 ? (
          <span className={`${badgeClass} bg-crit-bg text-crit`}>
            {formatClp(alerts.totals.amount)} vencidos
          </span>
        ) : (
          <span className={`${badgeClass} bg-ok-bg text-ok`}>Al día</span>
        )
      }
    >
      {stores.length === 0 ? (
        <EmptyState>
          No hay propinas sin pagar fuera del plazo legal de pago.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {stores.map(({ store, summary, items }) => {
            const oldest = summary.oldestBusinessDate ?? alerts.overdueThrough;
            const newest = summary.newestBusinessDate ?? alerts.overdueThrough;
            return (
              <li key={store.id}>
                <article
                  aria-label={`Propinas vencidas de ${store.name}`}
                  className="space-y-3 p-4 text-sm sm:px-5"
                >
                  <header className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold break-words">
                        {store.name}
                      </h3>
                      <p className="mt-1 font-semibold text-crit">
                        {formatClp(summary.amount)} sin pagar ·{' '}
                        {plural(summary.allocationCount, 'propina', 'propinas')}{' '}
                        · hasta {overdueText(summary.maxDaysOverdue)}
                      </p>
                      <p className="mt-1 text-xs text-ink2">
                        Propinas del {periodLabel(oldest, newest)}
                        {alertPeriodIsClipped(oldest, newest) &&
                          '. El enlace abre los primeros días del período; al pagarlos, la alerta muestra los siguientes'}
                        .
                      </p>
                    </div>
                    <Link
                      href={tipAlertHref(store.id, summary)}
                      prefetch={false}
                      aria-label={`Ver propinas vencidas de ${store.name}`}
                      className={buttonClass}
                    >
                      Ver propinas vencidas
                    </Link>
                  </header>
                  <ul className="space-y-2">
                    {items.map((item) => (
                      <li
                        key={item.worker.id}
                        className="flex flex-wrap justify-between gap-x-3 gap-y-1 rounded-lg bg-tint px-3 py-2 text-[13px]"
                      >
                        <span className="min-w-0 font-medium break-words">
                          {item.worker.name}
                        </span>
                        <span className="text-ink2">
                          {formatClp(item.amount)} ·{' '}
                          {plural(item.allocationCount, 'día', 'días')} · desde
                          el{' '}
                          <span className="font-mono">
                            {formatCalendarDate(item.oldestBusinessDate)}
                          </span>{' '}
                          ·{' '}
                          <span className="text-crit">
                            {overdueText(item.daysOverdue)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </TablePanel>
  );
}
