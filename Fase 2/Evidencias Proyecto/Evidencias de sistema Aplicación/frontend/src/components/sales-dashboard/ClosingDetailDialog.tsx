'use client';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  badgeClass,
  buttonClass,
  dialogClass,
  panelTitleClass,
  tableCellClass,
  tableClass,
  tableHeadClass,
  tableHeadingClass,
} from '@/components/ui/styles';
import {
  formatChileDateTime,
  formatClpAmount,
  formatSignedClp,
  hasCompensatedLines,
  isClosingBalanced,
  paymentMethodLabel,
  voucherSourceLabel,
  type CashClosing,
} from '@/lib/cash-closings';
import { loadCashClosing } from '@/lib/sales-dashboard-client';
import { formatCalendarDate } from '@/lib/display-date';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; closing: CashClosing };

function differenceClass(amount: number): string {
  return amount === 0 ? 'text-ink2' : 'font-semibold text-crit';
}

// Detalle de solo lectura de un cierre con diferencias (GET /cash-closings/:id).
export function ClosingDetailDialog({
  closingId,
  storeName,
  onClose,
}: {
  closingId: string;
  storeName: string;
  onClose: () => void;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    const focus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (focus instanceof HTMLElement) focus.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    loadCashClosing(closingId, controller.signal).then(
      (closing) => {
        if (!controller.signal.aborted) setState({ status: 'ready', closing });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setState({
            status: 'error',
            message:
              cause instanceof Error
                ? cause.message
                : 'No se pudo consultar el cierre.',
          });
      },
    );
    return () => controller.abort();
  }, [closingId, retry]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="closing-detail-title"
      aria-busy={state.status === 'loading'}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={dialogClass + ' sm:max-w-2xl'}
    >
      <div className="space-y-5">
        <div>
          <button
            type="button"
            aria-label="Cerrar detalle"
            onClick={onClose}
            className={`${buttonClass} float-right ml-3`}
          >
            ×
          </button>
          <h2 id="closing-detail-title" className="text-lg font-bold">
            Detalle del cierre de caja
          </h2>
          <p className="mt-1 text-sm text-ink2">{storeName}</p>
        </div>
        {state.status === 'loading' && (
          <p role="status" className="text-sm text-ink2">
            Consultando el cierre…
          </p>
        )}
        {state.status === 'error' && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-crit">
              {state.message}
            </p>
            <button
              type="button"
              onClick={() => {
                setState({ status: 'loading' });
                setRetry((current) => current + 1);
              }}
              className={buttonClass}
            >
              Reintentar
            </button>
          </div>
        )}
        {state.status === 'ready' && <Detail closing={state.closing} />}
      </div>
    </dialog>
  );
}

function Detail({ closing }: { closing: CashClosing }): ReactElement {
  const balanced = isClosingBalanced(closing);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={`${badgeClass} ${balanced ? 'bg-ok-bg text-ok' : 'bg-crit-bg text-crit'}`}
        >
          {balanced ? 'Cuadrado' : 'No cuadrado'}
        </span>
        <span>
          {formatCalendarDate(closing.businessDate)} · Turno {closing.shift}
        </span>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink2">Responsable</dt>
          <dd className="font-semibold break-words">
            {closing.responsible.name}
          </dd>
        </div>
        <div>
          <dt className="text-ink2">Confirmado</dt>
          <dd className="font-semibold">
            {closing.closedAt
              ? formatChileDateTime(closing.closedAt)
              : 'Sin confirmar'}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-ink2">Motivo de la diferencia</dt>
          <dd className="break-words">
            {closing.differenceReason ?? 'No informado'}
          </dd>
        </div>
      </dl>
      {hasCompensatedLines(closing) && (
        <p
          role="note"
          className="rounded-xl border border-line2 bg-warn-bg p-3 text-sm text-warn"
        >
          Las diferencias entre medios de pago se compensan y el total queda en
          $0, pero hay líneas descuadradas: el cierre sigue sin cuadrar.
        </p>
      )}
      <section aria-labelledby="closing-lines-title">
        <h3 id="closing-lines-title" className={`${panelTitleClass} mb-2`}>
          Diferencias por medio de pago
        </h3>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className={tableClass}>
            <thead className={tableHeadClass}>
              <tr>
                <th scope="col" className={tableHeadingClass}>
                  Medio
                </th>
                <th scope="col" className={tableHeadingClass + ' text-right'}>
                  Esperado
                </th>
                <th scope="col" className={tableHeadingClass + ' text-right'}>
                  Contado
                </th>
                <th scope="col" className={tableHeadingClass + ' text-right'}>
                  Diferencia
                </th>
              </tr>
            </thead>
            <tbody>
              {closing.lines.map((line) => (
                <tr
                  key={line.id}
                  className="border-b border-line last:border-0"
                >
                  <th scope="row" className={tableCellClass + ' font-semibold'}>
                    {paymentMethodLabel(line.paymentMethod)}
                  </th>
                  <td className={tableCellClass + ' text-right'}>
                    {formatClpAmount(line.expectedAmount)}
                  </td>
                  <td className={tableCellClass + ' text-right'}>
                    {formatClpAmount(line.countedAmount)}
                  </td>
                  <td
                    className={
                      tableCellClass +
                      ' text-right ' +
                      differenceClass(line.difference)
                    }
                  >
                    {formatSignedClp(line.difference)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-tint">
                <th scope="row" className={tableCellClass}>
                  Total
                </th>
                <td className={tableCellClass + ' text-right'}>
                  {formatClpAmount(closing.totalExpectedAmount)}
                </td>
                <td className={tableCellClass + ' text-right'}>
                  {formatClpAmount(closing.totalCountedAmount)}
                </td>
                <td
                  className={
                    tableCellClass +
                    ' text-right ' +
                    differenceClass(closing.totalDifference)
                  }
                >
                  {formatSignedClp(closing.totalDifference)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink2">
          Lo esperado en efectivo incluye el fondo inicial de{' '}
          {formatClpAmount(closing.openingCash)}.
        </p>
      </section>
      <section aria-labelledby="closing-vouchers-title">
        <h3 id="closing-vouchers-title" className={`${panelTitleClass} mb-2`}>
          Conciliación de vouchers
        </h3>
        <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-line p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink2">Venta neta MrComanda</dt>
            <dd>{formatClpAmount(closing.mrcomandaNetSales)}</dd>
          </div>
          <div>
            <dt className="text-ink2">Cobro bruto Mercado Pago</dt>
            <dd>{formatClpAmount(closing.mercadoPagoGrossAmount)}</dd>
          </div>
          <div>
            <dt className="text-ink2">Propina incluida (PROPINAS)</dt>
            <dd>{formatClpAmount(closing.mercadoPagoTipAmount)}</dd>
          </div>
          <div>
            <dt className="text-ink2">Venta neta Mercado Pago</dt>
            <dd>{formatClpAmount(closing.mercadoPagoNetSales)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-ink2">Descuadre de vouchers</dt>
            <dd className={differenceClass(closing.reconciliationDifference)}>
              {formatSignedClp(closing.reconciliationDifference)}
            </dd>
          </div>
        </dl>
        {closing.vouchers.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-ink2">
            {closing.vouchers.map((voucher) => (
              <li key={voucher.id} className="break-words">
                {voucherSourceLabel(voucher.source)}:{' '}
                {formatClpAmount(voucher.amount)} ·{' '}
                {formatChileDateTime(voucher.periodStart)} a{' '}
                {formatChileDateTime(voucher.periodEnd)}
                {voucher.reference ? ' · Ref. ' + voucher.reference : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-sm text-ink2">
        Fondo de propinas vinculado:{' '}
        <strong className="text-ink">
          {formatClpAmount(closing.tipFundAmount)}
        </strong>
        . Se informa aparte y no se suma a las ventas.
      </p>
    </>
  );
}
