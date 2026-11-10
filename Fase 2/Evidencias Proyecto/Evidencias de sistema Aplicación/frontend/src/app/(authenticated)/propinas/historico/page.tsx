import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import {
  EmptyState,
  TablePanel,
} from '@/components/sales-overview/SalesOverviewParts';
import {
  PoolHistoryTable,
  poolDetailHref,
} from '@/components/tips/PoolHistoryParts';
import {
  alertClass,
  badgeClass,
  buttonClass,
  inlineLinkClass,
  introClass,
} from '@/components/ui/styles';
import { ACCESS_COOKIE } from '@/lib/auth';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import { getSession } from '@/lib/session';
import { groupPoolHistory, type PaymentAlert } from '@/lib/tip-pools';
import {
  fetchLegacyPaymentAlerts,
  fetchPoolHistory,
} from '@/lib/tip-pools-backend';
import { formatClp } from '@/lib/tips';

export const metadata: Metadata = {
  title: 'Repartos anteriores | Propinas | MoiFood',
};

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

function alertDeadline(alert: PaymentAlert): string {
  if (alert.daysRemaining < 0)
    return count(
      Math.abs(alert.daysRemaining),
      'día hábil de atraso',
      'días hábiles de atraso',
    );
  if (alert.daysRemaining === 0) return 'Vence hoy';
  return count(
    alert.daysRemaining,
    'día hábil restante',
    'días hábiles restantes',
  );
}

// SPRINT-4A-T08: histórico de solo lectura de los repartos por período para
// ADMINISTRADOR y CONTADOR. El reparto vigente es la propina diaria por
// trabajador de /propinas; aquí no hay acciones, solo consulta de los
// repartos guardados (los borradores sin efecto van aparte y plegados) y la
// alerta legal de los registros históricos con tarjeta que quedaron sin
// pagar.
export default async function PoolHistoryPage(): Promise<ReactElement> {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    throw new Error(session.message);
  }
  if (!['ADMINISTRADOR', 'CONTADOR'].includes(session.data.role))
    redirect('/dashboard?reason=forbidden');
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect('/session-expired');
  const [history, alerts] = await Promise.all([
    fetchPoolHistory(token),
    fetchLegacyPaymentAlerts(token),
  ]);
  if (
    (!history.ok && history.status === 401) ||
    (!alerts.ok && alerts.status === 401)
  )
    redirect('/session-expired');
  const groups = history.ok ? groupPoolHistory(history.data) : null;
  return (
    <>
      <p className={introClass}>
        Repartos por período guardados antes de que la propina se repartiera
        automáticamente cada día. Son de solo lectura: no se calculan, confirman
        ni pagan. Las propinas se consultan y pagan en{' '}
        <Link href="/propinas" prefetch={false} className={inlineLinkClass}>
          Propinas
        </Link>
        .
      </p>
      {!groups ? (
        <p role="alert" className={alertClass}>
          {!history.ok && history.message}
        </p>
      ) : (
        <>
          <TablePanel
            id="pool-history-title"
            title="Repartos confirmados y pagados"
            description="Abre un reparto pagado para descargar las constancias de cada trabajador."
            aside={
              <span className={`${badgeClass} bg-tint2 text-salmon-ink`}>
                {count(groups.closed.length, 'reparto', 'repartos')}
              </span>
            }
          >
            {groups.closed.length === 0 ? (
              <EmptyState>
                No hay repartos confirmados ni pagados guardados.
              </EmptyState>
            ) : (
              <PoolHistoryTable
                caption="Repartos confirmados y pagados"
                pools={groups.closed}
              />
            )}
          </TablePanel>
          {groups.drafts.length > 0 && (
            <TablePanel
              id="pool-drafts-title"
              title="Borradores sin efecto"
              description="Cálculos que nunca se confirmaron ni pagaron. No reparten ni bloquean nada; las propinas de esos días están en Propinas."
              aside={
                <span className={`${badgeClass} bg-tint2 text-ink2`}>
                  {count(groups.drafts.length, 'borrador', 'borradores')}
                </span>
              }
            >
              <details className="group">
                <summary
                  className={`${buttonClass} mx-4 my-4 cursor-pointer sm:mx-5`}
                >
                  <span className="group-open:hidden">Mostrar borradores</span>
                  <span className="hidden group-open:inline">
                    Ocultar borradores
                  </span>
                </summary>
                <PoolHistoryTable
                  caption="Borradores sin efecto"
                  pools={groups.drafts}
                />
              </details>
            </TablePanel>
          )}
        </>
      )}
      <TablePanel
        id="pool-alerts-title"
        title="Propinas con tarjeta del registro anterior pendientes"
        description={
          'Registros diarios por medio de pago, anteriores a la operación diaria, cuyo reparto no se pagó. Plazo de siete días hábiles con el calendario de feriados configurado.' +
          (alerts.ok
            ? ` Consulta del ${formatChileDate(alerts.data.calculatedAt)}, hora de Chile.`
            : '')
        }
        aside={
          alerts.ok ? (
            <span className={`${badgeClass} bg-tint2 text-salmon-ink`}>
              {count(alerts.data.items.length, 'alerta', 'alertas')}
            </span>
          ) : undefined
        }
      >
        {!alerts.ok ? (
          <p role="alert" className={`${alertClass} m-5`}>
            {alerts.message}
          </p>
        ) : alerts.data.items.length === 0 ? (
          <EmptyState>
            No hay propinas con tarjeta del registro anterior pendientes.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {alerts.data.items.map((alert) => (
              <li
                key={alert.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm sm:px-5"
              >
                <div className="min-w-0">
                  <p
                    className={`font-semibold ${alert.status === 'OVERDUE' ? 'text-crit' : 'text-warn'}`}
                  >
                    {alert.status === 'OVERDUE' ? 'Vencida' : 'Próxima'} ·{' '}
                    {alert.store.name} · {formatClp(alert.amount)}
                  </p>
                  <p className="mt-1 text-xs text-ink2">
                    Registro {formatCalendarDate(alert.businessDate)} · Fecha
                    límite {formatCalendarDate(alert.deadline)} ·{' '}
                    {alertDeadline(alert)}
                  </p>
                </div>
                {alert.pool ? (
                  <Link
                    href={poolDetailHref(alert.pool.id)}
                    prefetch={false}
                    aria-label={`Ver reparto del ${formatCalendarDate(alert.pool.periodStart)} al ${formatCalendarDate(alert.pool.periodEnd)}`}
                    className={buttonClass}
                  >
                    Ver reparto
                  </Link>
                ) : (
                  <p className="text-xs text-muted">Sin reparto calculado</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </TablePanel>
    </>
  );
}
