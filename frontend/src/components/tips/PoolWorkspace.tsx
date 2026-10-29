'use client';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  POOL_STATUS,
  poolError,
  type TipPool,
  type PaymentAlert,
  type PoolReceipt,
  type PoolAction,
  type PoolPeriod,
} from '@/lib/tip-pools';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import {
  inputClass,
  labelClass,
  buttonClass,
  primaryButtonClass,
  introClass,
  filterPanelClass,
  panelTitleClass,
  tablePanelClass,
  tableHeaderClass,
  tableClass,
  tableHeadClass,
  tableHeadingClass,
  tableCellClass,
  dialogClass,
  dialogActionsClass,
} from '@/components/ui/styles';
type Store = { id: string; name: string; isActive: boolean };
type Action = PoolAction | 'preview';
const clp = (n: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(n);
const date = formatCalendarDate;
const alertClass =
  'rounded-lg border border-crit/20 bg-crit-bg px-3.5 py-3 text-sm text-crit';
const regionClass =
  'overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink';
class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/tip-pools' + path, {
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
      cache: 'no-store',
    });
  } catch {
    throw new RequestError(503, poolError(503));
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);

    let message = poolError(response.status);
    if (
      response.status === 422 &&
      typeof data === 'object' &&
      data !== null &&
      'issues' in data &&
      Array.isArray(data.issues)
    )
      message +=
        ' ' +
        data.issues.filter((v: unknown) => typeof v === 'string').join(' ');
    throw new RequestError(response.status, message);
  }
  return response.json() as Promise<T>;
}
export function PoolWorkspace({
  stores,
  readOnly,
  today,
}: {
  stores: Store[];
  readOnly: boolean;
  today: string;
}) {
  const router = useRouter();
  const message = useCallback(
    (cause: unknown): string => {
      if (cause instanceof RequestError && cause.status === 401)
        router.replace('/session-expired');
      return cause instanceof Error ? cause.message : poolError(503);
    },
    [router],
  );
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [start, setStart] = useState(today.slice(0, 8) + '01');
  const [end, setEnd] = useState(today);
  const [pool, setPool] = useState<TipPool | null>(null);
  const [queried, setQueried] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [conflict, setConflict] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [alerts, setAlerts] = useState<PaymentAlert[]>([]);
  const [alertDate, setAlertDate] = useState('');
  const [alertError, setAlertError] = useState('');
  const [alertLoading, setAlertLoading] = useState(true);
  const [receipts, setReceipts] = useState<PoolReceipt[]>([]);
  const [receiptError, setReceiptError] = useState('');
  const [receiptLoading, setReceiptLoading] = useState(false);

  const period: PoolPeriod = { storeId, periodStart: start, periodEnd: end };
  const alertSequence = useRef(0);
  const refreshAlerts = useCallback(async (): Promise<undefined> => {
    const sequence = ++alertSequence.current;
    setAlertLoading(true);
    setAlertError('');
    try {
      const data = await request<{
        items: PaymentAlert[];
        calculatedAt: string;
      }>('/alerts');
      if (sequence !== alertSequence.current) return;
      setAlerts(data.items);
      setAlertDate(data.calculatedAt);
    } catch (e) {
      if (sequence === alertSequence.current) setAlertError(message(e));
    } finally {
      if (sequence === alertSequence.current) setAlertLoading(false);
    }
  }, [message]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshAlerts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshAlerts]);
  useEffect(() => {
    let active = true;
    async function read(): Promise<undefined> {
      await Promise.resolve();
      if (!active) return;
      setReceipts([]);
      setReceiptError('');
      if (pool?.status !== 'PAID') {
        setReceiptLoading(false);
        return;
      }
      setReceiptLoading(true);
      try {
        const result = await request<PoolReceipt[]>(
          '/' + pool.id + '/receipts',
        );
        if (active) setReceipts(result);
      } catch (cause) {
        if (active) setReceiptError(message(cause));
      } finally {
        if (active) setReceiptLoading(false);
      }
    }
    void read();
    return () => {
      active = false;
    };
  }, [pool, message]);
  function clear() {
    setPool(null);
    setQueried(false);
    setSuccess('');
    setError('');
    setConflict(false);
  }
  async function load(
    event?: FormEvent<HTMLFormElement>,
    id?: string,
  ): Promise<undefined> {
    event?.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    setPool(null);
    setQueried(false);
    try {
      const result = id
        ? await request<TipPool>('/' + id)
        : ((
            await request<TipPool[]>('?' + new URLSearchParams({ ...period }))
          )[0] ?? null);
      setPool(result);
      setQueried(true);
      setConflict(false);
      if (result) {
        setStoreId(result.store.id);
        setStart(result.periodStart);
        setEnd(result.periodEnd);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function execute(
    notes: string,
    paymentDate: string,
  ): Promise<undefined> {
    if (!action || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const input =
        action === 'preview'
          ? period
          : {
              expectedVersion: pool?.version,
              ...(action === 'observations' ? { notes } : {}),
              ...(action === 'pay' ? { paymentDate } : {}),
            };
      const result = await request<TipPool>(
        action === 'preview' ? '/preview' : '/' + pool?.id + '/' + action,
        input,
      );
      setPool(result);
      setQueried(true);
      setConflict(false);
      setAction(null);
      setSuccess(
        action === 'pay'
          ? 'Pago registrado. Las constancias están disponibles.'
          : action === 'confirm'
            ? 'Reparto confirmado. Los montos quedaron protegidos.'
            : action === 'observations'
              ? 'Observación guardada.'
              : 'Cálculo actualizado. Revisa el detalle antes de confirmar.',
      );
      if (action === 'pay') void refreshAlerts();
    } catch (e) {
      if (e instanceof RequestError && e.status === 409) {
        setConflict(true);
        setAction(null);
        setError(e.message);
      } else {
        message(e);
        throw e;
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function download(receipt: PoolReceipt): Promise<undefined> {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setReceiptError('');
    try {
      const res = await fetch(
        '/api/tip-pools/' +
          receipt.poolId +
          '/receipts/' +
          receipt.userId +
          '/download',
      );
      if (!res.ok) throw new RequestError(res.status, poolError(res.status));
      if (!res.headers.get('content-type')?.startsWith('application/pdf'))
        throw Error('La constancia no pudo verificarse. Vuelve a intentar.');
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'constancia-propinas-' + receipt.id + '.pdf';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setReceiptError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const sum = pool?.lines.reduce((n, l) => n + l.amount, 0) ?? 0;
  return (
    <>
      <p className={introClass}>
        {readOnly
          ? 'Consulta los repartos, las alertas y las constancias. Tu acceso es de solo lectura.'
          : 'Revisa el cálculo del período, registra observaciones y confirma la entrega de propinas.'}{' '}
        Los montos se expresan en pesos chilenos.
      </p>
      <section className={filterPanelClass} aria-labelledby="pool-search">
        <h2 id="pool-search" className={panelTitleClass}>
          Consultar reparto
        </h2>
        <form onSubmit={(e) => void load(e)} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="pool-store" className={labelClass}>
                Local
              </label>
              <select
                id="pool-store"
                className={inputClass + ' mt-2'}
                value={storeId}
                required
                disabled={busy}
                onChange={(e) => {
                  setStoreId(e.target.value);
                  clear();
                }}
              >
                <option value="">Selecciona un local</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.isActive ? '' : ' (inactivo)'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pool-from" className={labelClass}>
                Desde
              </label>
              <input
                id="pool-from"
                type="date"
                className={inputClass + ' mt-2'}
                value={start}
                max={end}
                required
                disabled={busy}
                onChange={(e) => {
                  setStart(e.target.value);
                  clear();
                }}
              />
            </div>
            <div>
              <label htmlFor="pool-to" className={labelClass}>
                Hasta
              </label>
              <input
                id="pool-to"
                type="date"
                className={inputClass + ' mt-2'}
                value={end}
                min={start}
                required
                disabled={busy}
                onChange={(e) => {
                  setEnd(e.target.value);
                  clear();
                }}
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            Fechas del período en hora de Chile. Consultar conserva el cálculo
            guardado.
          </p>
          <div className="flex flex-wrap gap-3">
            <button className={buttonClass} disabled={busy || !storeId}>
              {busy ? 'Procesando…' : 'Consultar reparto'}
            </button>
            {!readOnly && (
              <button
                type="button"
                className={primaryButtonClass}
                disabled={
                  busy ||
                  !storeId ||
                  !start ||
                  !end ||
                  start > end ||
                  pool?.status === 'CONFIRMED' ||
                  pool?.status === 'PAID' ||
                  conflict ||
                  !stores.find((s) => s.id === storeId)?.isActive
                }
                onClick={() => setAction('preview')}
              >
                {pool ? 'Recalcular borrador' : 'Calcular reparto'}
              </button>
            )}
          </div>
        </form>
      </section>
      {error && (
        <div className={alertClass} role="alert">
          {error}
          {conflict && (
            <button
              className={buttonClass + ' mt-3'}
              disabled={busy}
              onClick={() => void load(undefined, pool?.id)}
            >
              Actualizar reparto
            </button>
          )}
        </div>
      )}
      {success && (
        <p role="status" className="rounded-lg bg-ok-bg p-4 text-sm text-ok">
          {success}
        </p>
      )}
      {busy && !pool && <p role="status">Consultando reparto…</p>}
      {queried && !pool && !busy && (
        <p role="status" className={filterPanelClass}>
          No hay un reparto guardado para este local y período.
          {!readOnly &&
            ' Puedes calcularlo cuando existan pacto, horas y propinas registradas.'}
        </p>
      )}
      {pool && (
        <section
          aria-labelledby="pool-detail"
          className={tablePanelClass}
          aria-busy={busy}
        >
          <header className={tableHeaderClass}>
            <div>
              <h2 id="pool-detail" className={panelTitleClass}>
                {pool.store.name} · {POOL_STATUS[pool.status]}
              </h2>
              <p className="mt-1 text-xs text-muted">
                {date(pool.periodStart)} al {date(pool.periodEnd)} · Revisión{' '}
                {pool.version}
              </p>
            </div>
          </header>
          <div className="space-y-3 border-b border-line p-5 text-sm">
            <p>
              Fondo del período: <strong>{clp(pool.totalAmount)}</strong> ·
              Horas totales: {pool.totalHours}
            </p>
            <p>
              Pacto aplicado:{' '}
              <strong>
                {pool.agreement?.name ?? 'Sin pacto histórico disponible'}
              </strong>
              {pool.agreement && (
                <>
                  {' '}
                  ·{' '}
                  {pool.agreement.rule === 'PROPORTIONAL_TO_HOURS'
                    ? 'Proporcional a las horas trabajadas'
                    : pool.agreement.rule}{' '}
                  · Desde {date(pool.agreement.validFrom)}
                  {pool.agreement.validTo
                    ? ' hasta ' + date(pool.agreement.validTo)
                    : ' sin término'}
                </>
              )}
            </p>
            <p>
              Calculado por {pool.calculatedBy.name} el{' '}
              {formatChileDate(pool.calculatedAt)}.
            </p>
            {pool.confirmedBy && (
              <p>
                Confirmado por {pool.confirmedBy.name}
                {pool.confirmedAt
                  ? ' el ' + formatChileDate(pool.confirmedAt)
                  : ''}
                .
              </p>
            )}
            {pool.paidBy && (
              <p>
                Enterado por {pool.paidBy.name}
                {pool.paymentDate ? ' el ' + date(pool.paymentDate) : ''}.
              </p>
            )}
            {pool.notes && (
              <p className="wrap-anywhere">Observación vigente: {pool.notes}</p>
            )}
          </div>
          <div
            role="region"
            aria-label="Distribución por trabajador"
            tabIndex={0}
            className={regionClass}
          >
            <table className={tableClass}>
              <caption className="sr-only">
                Horas y montos asignados por trabajador
              </caption>
              <thead className={tableHeadClass}>
                <tr>
                  {['Trabajador', 'Horas', 'Monto en CLP'].map((t) => (
                    <th scope="col" key={t} className={tableHeadingClass}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pool.lines.map((l) => (
                  <tr key={l.userId} className="border-b border-line">
                    <td className={tableCellClass}>{l.workerName}</td>
                    <td className={tableCellClass}>{l.hoursWorked}</td>
                    <td className={tableCellClass}>{clp(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-4 p-5 text-sm">
            <p
              className={pool.reconciled ? 'text-ok' : 'text-crit'}
              role="status"
            >
              {pool.reconciled
                ? 'Conciliación correcta'
                : 'Reparto sin conciliar'}
              : líneas {clp(sum)} · fondo {clp(pool.totalAmount)} · diferencia{' '}
              {clp(pool.totalAmount - sum)}.
            </p>
            {!readOnly && pool.status !== 'PAID' && (
              <div className="flex flex-wrap gap-3">
                {pool.status === 'DRAFT' ? (
                  <>
                    <button
                      className={buttonClass}
                      disabled={busy || conflict}
                      onClick={() => setAction('observations')}
                    >
                      Dejar observación
                    </button>
                    <button
                      className={primaryButtonClass}
                      disabled={
                        busy || conflict || !pool.reconciled || !pool.agreement
                      }
                      onClick={() => setAction('confirm')}
                    >
                      Validar reparto
                    </button>
                  </>
                ) : (
                  <button
                    className={primaryButtonClass}
                    disabled={busy || conflict}
                    onClick={() => setAction('pay')}
                  >
                    Registrar entrega de propinas
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}
      {pool?.status === 'PAID' && (
        <section
          className={tablePanelClass}
          aria-labelledby="pool-receipts"
          aria-busy={receiptLoading}
        >
          <header className={tableHeaderClass}>
            <h2 id="pool-receipts" className={panelTitleClass}>
              Constancias de entrega
            </h2>
            <button
              className={buttonClass}
              disabled={busy || receiptLoading}
              onClick={() => setPool({ ...pool })}
            >
              Actualizar constancias
            </button>
          </header>
          {receiptLoading && (
            <p className="p-5" role="status">
              Cargando constancias…
            </p>
          )}
          {receiptError && (
            <p className={alertClass + ' m-5'} role="alert">
              {receiptError}
            </p>
          )}
          {!receiptLoading && !receiptError && receipts.length === 0 && (
            <p className="p-5" role="status">
              No hay constancias disponibles.
            </p>
          )}
          <ul className="divide-y divide-line">
            {receipts.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm"
              >
                <div>
                  <p className="font-semibold">
                    {r.workerName} · {clp(r.amount)}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Entregado el {date(r.paymentDate)} por {r.paidBy.name}
                  </p>
                </div>
                <button
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => void download(r)}
                  aria-label={'Descargar constancia de ' + r.workerName}
                >
                  Descargar constancia
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section
        className={tablePanelClass}
        aria-labelledby="pool-alerts"
        aria-busy={alertLoading}
      >
        <header className={tableHeaderClass}>
          <div>
            <h2 id="pool-alerts" className={panelTitleClass}>
              Propinas con tarjeta pendientes de entrega
            </h2>
            <p className="mt-1 text-xs text-muted">
              Plazo de siete días hábiles calculado con el calendario de
              feriados configurado.
              {alertDate
                ? ' Consulta del ' +
                  formatChileDate(alertDate) +
                  ', hora de Chile.'
                : ''}
            </p>
          </div>
          <button
            className={buttonClass}
            disabled={alertLoading || busy}
            onClick={() => void refreshAlerts()}
          >
            Actualizar alertas
          </button>
        </header>
        {alertLoading ? (
          <p className="p-5" role="status">
            Cargando alertas…
          </p>
        ) : alertError ? (
          <p className={alertClass + ' m-5'} role="alert">
            {alertError}
          </p>
        ) : alerts.length === 0 ? (
          <p className="p-5" role="status">
            No hay propinas con tarjeta pendientes de entrega.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {alerts.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm"
              >
                <div>
                  <p
                    className={
                      'font-semibold ' +
                      (a.status === 'OVERDUE' ? 'text-crit' : 'text-warn')
                    }
                  >
                    {a.status === 'OVERDUE' ? 'Vencida' : 'Próxima'} ·{' '}
                    {a.store.name} · {clp(a.amount)}
                  </p>
                  <p className="mt-1 text-xs text-ink2">
                    Registro {date(a.businessDate)} · Fecha límite{' '}
                    {date(a.deadline)} ·{' '}
                    {a.daysRemaining < 0
                      ? Math.abs(a.daysRemaining) + ' días hábiles de atraso'
                      : a.daysRemaining === 0
                        ? 'Vence hoy'
                        : a.daysRemaining + ' días hábiles restantes'}
                  </p>
                </div>
                {a.pool ? (
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => void load(undefined, a.pool!.id)}
                  >
                    Consultar reparto de la alerta
                  </button>
                ) : (
                  <p className="text-xs text-muted">Sin reparto calculado</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {action && (
        <PoolDialog
          key={action}
          action={action}
          pool={pool}
          period={period}
          busy={busy}
          today={today}
          onClose={() => {
            setAction(null);
            return undefined;
          }}
          onSubmit={execute}
        />
      )}
    </>
  );
}
function PoolDialog({
  action,
  pool,
  period,
  busy,
  today,
  onClose,
  onSubmit,
}: {
  action: Action;
  pool: TipPool | null;
  period: PoolPeriod;
  busy: boolean;
  today: string;
  onClose: () => undefined;
  onSubmit: (notes: string, paymentDate: string) => Promise<undefined>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [notes, setNotes] = useState(pool?.notes ?? '');
  const [paid, setPaid] = useState(today);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  useEffect(() => {
    const el = dialog.current;
    const opener = document.activeElement;
    el?.showModal();
    return () => {
      el?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  const title =
    action === 'preview'
      ? pool
        ? 'Recalcular borrador'
        : 'Calcular reparto'
      : action === 'observations'
        ? 'Guardar observación'
        : action === 'confirm'
          ? 'Validar reparto'
          : 'Registrar entrega de propinas';
  async function submit(e: FormEvent<HTMLFormElement>): Promise<undefined> {
    e.preventDefault();
    if (pending.current || busy || !confirmed) return;
    pending.current = true;
    setError('');
    try {
      await onSubmit(notes, paid);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : poolError(503));
    } finally {
      pending.current = false;
    }
  }
  return (
    <dialog
      ref={dialog}
      className={dialogClass}
      aria-labelledby="pool-dialog-title"
      onCancel={(e) => {
        if (busy || pending.current) e.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <button
          type="button"
          aria-label="Cerrar ventana"
          className={buttonClass + ' float-right'}
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
        <h2 id="pool-dialog-title" className="text-lg font-bold">
          {title}
        </h2>
        <p className="text-sm text-ink2">
          {action === 'preview'
            ? 'Se guardará un cálculo con las propinas y las horas del período. Si ya hay un borrador, se reemplazará su cálculo y se limpiará su observación.'
            : action === 'confirm'
              ? 'Los montos quedarán protegidos. Revisa la conciliación y el pacto antes de confirmar.'
              : action === 'pay'
                ? 'Esta acción registra que las propinas fueron entregadas y genera las constancias de los trabajadores.'
                : 'La observación queda guardada en el borrador para revisar sus antecedentes.'}
        </p>
        <p className="text-sm">
          Período: {date(period.periodStart)} al {date(period.periodEnd)}
          {pool ? ' · Fondo ' + clp(pool.totalAmount) : ''}
        </p>
        {action === 'observations' && (
          <div>
            <label htmlFor="pool-notes" className={labelClass}>
              Observación
            </label>
            <textarea
              id="pool-notes"
              className={inputClass + ' mt-2'}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              minLength={1}
              maxLength={255}
              required
              disabled={busy}
            />
          </div>
        )}
        {action === 'pay' && (
          <div>
            <label htmlFor="pool-payment-date" className={labelClass}>
              Fecha de entrega
            </label>
            <input
              id="pool-payment-date"
              type="date"
              className={inputClass + ' mt-2'}
              value={paid}
              min={pool?.periodEnd}
              max={today}
              required
              disabled={busy}
              onChange={(e) => setPaid(e.target.value)}
            />
          </div>
        )}
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            className="size-11 shrink-0 accent-salmon-ink"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={busy}
          />
          Confirmo que revisé los datos de esta acción.
        </label>
        {error && (
          <p className={alertClass} role="alert">
            {error}
          </p>
        )}
        <div className={dialogActionsClass}>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className={primaryButtonClass}
            disabled={
              busy || !confirmed || (action === 'observations' && !notes.trim())
            }
          >
            {busy ? 'Guardando…' : title}
          </button>
        </div>
      </form>
    </dialog>
  );
}
