'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import {
  badgeClass,
  buttonClass,
  inputClass,
  labelClass,
  panelTitleClass,
} from '@/components/ui/styles';
import {
  formatChileDateTime,
  formatClpAmount,
  formatSignedClp,
  paymentMethodLabel,
} from '@/lib/cash-closings';
import { formatCalendarDate } from '@/lib/display-date';
import {
  alertTotal,
  chileToday,
  hasTipMismatch,
  isCompensatedDifference,
  isDashboardDate,
  storeBalance,
  storeBalanceLabel,
  type AlertCounts,
  type SalesDashboard,
  type StoreBalance,
  type StoreDashboard,
} from '@/lib/sales-dashboard';
import { loadSalesDashboard } from '@/lib/sales-dashboard-client';
import { ClosingDetailDialog } from './ClosingDetailDialog';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: SalesDashboard };

const balanceStyles: Record<StoreBalance, string> = {
  NO_CLOSINGS: 'bg-tint2 text-ink2',
  BALANCED: 'bg-ok-bg text-ok',
  UNBALANCED: 'bg-crit-bg text-crit',
};

const tileClass = 'min-w-0 rounded-[14px] border border-line bg-bg p-4';

export function SalesDashboardPanel(): ReactElement {
  const [today] = useState(() => chileToday());
  const [date, setDate] = useState(today);
  const [query, setQuery] = useState(today);
  const [dateError, setDateError] = useState('');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<{
    closingId: string;
    storeName: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadSalesDashboard(query, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setState({
            status: 'error',
            message:
              cause instanceof Error
                ? cause.message
                : 'No se pudo consultar el panel consolidado.',
          });
      },
    );
    return () => controller.abort();
  }, [query, retry]);

  function reload(): void {
    setState({ status: 'loading' });
    setRetry((current) => current + 1);
  }
  function apply(value: string): void {
    setDate(value);
    if (!isDashboardDate(value)) {
      setDateError('Ingresa una fecha válida.');
      return;
    }
    if (value > today) {
      setDateError('No se pueden consultar días futuros.');
      return;
    }
    setDateError('');
    if (value !== query) {
      setState({ status: 'loading' });
      setQuery(value);
    }
  }

  return (
    <section aria-labelledby="dashboard-title" className="min-w-0 space-y-5">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <h2 id="dashboard-title" className={panelTitleClass}>
            Resumen del día {formatCalendarDate(query)}
          </h2>
          <p className="mt-2 text-sm text-ink2">
            Ventas netas sin propina, en hora de Chile.
            {state.status === 'ready' &&
              ' Consulta del ' +
                formatChileDateTime(state.data.calculatedAt) +
                '.'}
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-end">
          <label className={labelClass + ' sm:w-48'}>
            Día de negocio
            <input
              type="date"
              value={date}
              max={today}
              aria-invalid={dateError ? true : undefined}
              aria-describedby={dateError ? 'dashboard-date-error' : undefined}
              onChange={(event) => apply(event.target.value)}
              className={`${inputClass} mt-2`}
            />
          </label>
          <button
            type="button"
            onClick={reload}
            disabled={state.status === 'loading'}
            className={buttonClass}
          >
            Actualizar
          </button>
        </div>
      </div>
      {dateError && (
        <p id="dashboard-date-error" role="alert" className="text-sm text-crit">
          {dateError}
        </p>
      )}
      {state.status === 'loading' && (
        <div
          role="status"
          aria-busy="true"
          className="rounded-[14px] border border-line bg-bg p-6 text-sm text-ink2"
        >
          Consultando ventas, alertas y diferencias de los locales…
        </div>
      )}
      {state.status === 'error' && (
        <section
          aria-labelledby="dashboard-error-title"
          className="rounded-[14px] border border-line bg-bg p-5"
        >
          <div role="alert">
            <h3 id="dashboard-error-title" className={panelTitleClass}>
              No se pudo cargar el panel
            </h3>
            <p className="mt-2 text-sm leading-6 text-ink2">{state.message}</p>
          </div>
          <button
            type="button"
            onClick={reload}
            className={'mt-4 ' + buttonClass}
          >
            Reintentar
          </button>
        </section>
      )}
      {state.status === 'ready' && (
        <Content
          data={state.data}
          onDetail={(closingId, storeName) =>
            setDetail({ closingId, storeName })
          }
        />
      )}
      {detail && (
        <ClosingDetailDialog
          closingId={detail.closingId}
          storeName={detail.storeName}
          onClose={() => setDetail(null)}
        />
      )}
    </section>
  );
}

function Content({
  data,
  onDetail,
}: {
  data: SalesDashboard;
  onDetail: (closingId: string, storeName: string) => void;
}): ReactElement {
  const { totals, stores } = data;
  if (!stores.length)
    return (
      <div className="rounded-[14px] border border-line bg-bg px-6 py-12 text-center">
        <h3 className={panelTitleClass}>No hay locales registrados</h3>
        <p className="mt-2 text-sm text-ink2">
          Crea un local en «Locales» para ver su resumen diario.
        </p>
      </div>
    );
  return (
    <>
      <ul
        aria-label="Totales de todos los locales"
        className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4"
      >
        <li className={tileClass}>
          <p className="text-xs font-semibold text-ink2">Venta neta del día</p>
          <p className="mt-1 text-xl font-bold">
            {formatClpAmount(totals.netAmount)}
          </p>
          <p className="mt-1 text-xs text-ink2">
            {totals.salesCount} ventas ·{' '}
            {formatClpAmount(totals.unclosedNetAmount)} sin cierre
          </p>
        </li>
        <li className={tileClass}>
          <p className="text-xs font-semibold text-ink2">Propina con tarjeta</p>
          <p className="mt-1 text-xl font-bold">
            {formatClpAmount(totals.cardTipsRegisteredAmount)}
          </p>
          <p className="mt-1 text-xs text-ink2">
            Registrada · vouchers:{' '}
            {formatClpAmount(totals.cardTipsClosingsAmount)}. No se suma a las
            ventas.
          </p>
        </li>
        <li className={tileClass}>
          <p className="text-xs font-semibold text-ink2">
            Cierres con diferencias
          </p>
          <p
            className={
              'mt-1 text-xl font-bold ' +
              (totals.pendingDifferencesCount ? 'text-crit' : '')
            }
          >
            {totals.pendingDifferencesCount}
          </p>
          <p className="mt-1 text-xs text-ink2">
            de {totals.closingsCount} cierres del día
          </p>
        </li>
        <li className={tileClass}>
          <p className="text-xs font-semibold text-ink2">Alertas vigentes</p>
          <p
            className={
              'mt-1 text-xl font-bold ' +
              (totals.dtRegistrationAlerts.overdue ||
              totals.tipPaymentAlerts.overdue
                ? 'text-crit'
                : '')
            }
          >
            {alertTotal(totals.dtRegistrationAlerts) +
              alertTotal(totals.tipPaymentAlerts)}
          </p>
          <p className="mt-1 text-xs text-ink2">
            DT: {alertTotal(totals.dtRegistrationAlerts)} · Propinas:{' '}
            {alertTotal(totals.tipPaymentAlerts)}
          </p>
        </li>
      </ul>
      <ul aria-label="Resumen por local" className="grid gap-4 xl:grid-cols-2">
        {stores.map((store) => (
          <StoreCard key={store.store.id} item={store} onDetail={onDetail} />
        ))}
      </ul>
      <p className="text-xs leading-5 text-ink2">
        Las ventas son netas: la propina con tarjeta y los descuadres de
        vouchers se informan aparte para no contarlos dos veces. Un cierre
        figura «No cuadrado» si cualquier medio de pago o la conciliación de
        vouchers tiene diferencia, aunque el total se compense.
      </p>
    </>
  );
}

function AlertLine({
  label,
  counts,
  href,
}: {
  label: string;
  counts: AlertCounts;
  href: '/admin/alertas-dt' | '/propinas/repartos';
}): ReactElement {
  const total = alertTotal(counts);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span>
        {label}:{' '}
        {total === 0 ? (
          <span className="text-ink2">sin alertas</span>
        ) : (
          <>
            <strong className={counts.overdue ? 'text-crit' : ''}>
              {counts.overdue} vencidas
            </strong>
            {', '}
            {counts.upcoming} por vencer
          </>
        )}
      </span>
      {total > 0 && (
        <Link
          href={href}
          prefetch={false}
          className="font-semibold text-salmon-ink underline-offset-2 hover:underline"
        >
          Revisar<span className="sr-only"> {label.toLowerCase()}</span>
        </Link>
      )}
    </li>
  );
}

function StoreCard({
  item,
  onDetail,
}: {
  item: StoreDashboard;
  onDetail: (closingId: string, storeName: string) => void;
}): ReactElement {
  const { store, sales, closings, cardTips, pendingDifferences, alerts } = item;
  const balance = storeBalance(item);
  const titleId = 'store-' + store.id;
  return (
    <li
      aria-labelledby={titleId}
      className="min-w-0 space-y-4 rounded-[14px] border border-line bg-bg p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="font-bold break-words">
            {store.name}
          </h3>
          <p className="text-sm text-ink2">
            {store.city}
            {store.isActive ? '' : ' · Inactivo'}
          </p>
        </div>
        <span className={`${badgeClass} ${balanceStyles[balance]}`}>
          {storeBalanceLabel(balance)}
        </span>
      </div>

      <div>
        <p className="text-xs font-semibold text-ink2">Venta neta del día</p>
        <p className="text-lg font-bold">{formatClpAmount(sales.netAmount)}</p>
        <p className="text-xs text-ink2">
          {sales.salesCount} ventas · {formatClpAmount(sales.closedNetAmount)}{' '}
          conciliada · {formatClpAmount(sales.unclosedNetAmount)} sin cierre
        </p>
      </div>

      {sales.byPaymentMethod.length > 0 && (
        <dl
          aria-label={'Ventas por medio de pago en ' + store.name}
          className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm min-[420px]:grid-cols-2"
        >
          {sales.byPaymentMethod.map((method) => (
            <div
              key={method.paymentMethod}
              className="flex min-w-0 justify-between gap-2"
            >
              <dt className="truncate text-ink2">
                {paymentMethodLabel(method.paymentMethod)}
              </dt>
              <dd className="font-semibold whitespace-nowrap">
                {formatClpAmount(method.netAmount)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="rounded-xl bg-tint p-3 text-sm">
        <p>
          <strong>{closings.count}</strong>{' '}
          {closings.count === 1 ? 'cierre' : 'cierres'}
          {closings.shifts.length
            ? ' (turno' +
              (closings.shifts.length > 1 ? 's ' : ' ') +
              closings.shifts.join(', ') +
              ')'
            : ''}
        </p>
        {closings.count > 0 && (
          <p className="mt-1 text-ink2">
            Diferencia de caja: {formatSignedClp(closings.cashDifference)} ·
            Descuadre de vouchers: {formatSignedClp(closings.voucherDifference)}
          </p>
        )}
        <p className="mt-1 text-ink2">
          Propina con tarjeta: {formatClpAmount(cardTips.registeredAmount)}{' '}
          registrada · {formatClpAmount(cardTips.closingsAmount)} en vouchers
        </p>
        {hasTipMismatch(item) && (
          <p className="mt-1 font-semibold text-warn">
            La propina registrada no coincide con la de los vouchers.
          </p>
        )}
      </div>

      {pendingDifferences.length > 0 && (
        <section aria-label={'Diferencias pendientes en ' + store.name}>
          <h4 className={panelTitleClass}>Diferencias pendientes</h4>
          <ul className="mt-2 space-y-2">
            {pendingDifferences.map((pending) => (
              <li
                key={pending.closingId}
                className="rounded-xl border border-l-4 border-line border-l-crit p-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      Turno {pending.shift} · No cuadrado
                    </p>
                    <p className="text-ink2">
                      Caja {formatSignedClp(pending.cashDifference)} · Vouchers{' '}
                      {formatSignedClp(pending.voucherDifference)}
                    </p>
                    {isCompensatedDifference(pending) && (
                      <p className="text-warn">
                        Hay medios descuadrados que se compensan entre sí.
                      </p>
                    )}
                    {pending.differenceReason && (
                      <p className="mt-1 break-words text-ink2">
                        Motivo: {pending.differenceReason}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDetail(pending.closingId, store.name)}
                    className={buttonClass}
                  >
                    Ver detalle
                    <span className="sr-only">
                      {' '}
                      del turno {pending.shift} de {store.name}
                    </span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="space-y-1 text-sm" aria-label={'Alertas de ' + store.name}>
        <AlertLine
          label="Registro en la DT"
          counts={alerts.dtRegistration}
          href="/admin/alertas-dt"
        />
        <AlertLine
          label="Entrega de propinas"
          counts={alerts.tipPayment}
          href="/propinas/repartos"
        />
      </ul>
    </li>
  );
}
