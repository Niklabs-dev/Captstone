'use client';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import {
  buttonClass,
  primaryButtonClass,
  inputClass,
  labelClass,
  filterPanelClass,
  panelTitleClass,
  tablePanelClass,
  tableHeaderClass,
  tableDescriptionClass,
  tableClass,
  tableHeadClass,
  tableHeadingClass,
  tableCellClass,
} from '@/components/ui/styles';
import { createTip, loadTips, TipRequestError } from '@/lib/tips-client';
import {
  formatClp,
  isTipDate,
  parseTipAmount,
  parseTipInput,
  sortTipEntriesByCatalog,
  tipFieldErrors,
  tipTotals,
  tipErrorMessage,
  type TipEntry,
  type TipErrors,
} from '@/lib/tips';
import {
  loadPaymentMethods,
  PaymentMethodError,
} from '@/lib/payment-methods-client';
import type { PaymentMethod } from '@/lib/payment-methods';
import { formatCalendarDate } from '@/lib/display-date';

type ListState =
  | { status: 'loading' | 'idle'; key: string }
  | { status: 'error'; key: string; message: string }
  | { status: 'ready'; key: string; entries: TipEntry[] };

type MethodsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; methods: PaymentMethod[] };

export function TipsPanel({
  store,
  initialDate,
}: {
  store: { id: string; name: string; isActive: boolean };
  initialDate: string;
}): ReactElement {
  const [date, setDate] = useState(initialDate);
  const [method, setMethod] = useState('');
  const [amount, setAmount] = useState('');
  const [revision, setRevision] = useState(0);
  const [methodsRevision, setMethodsRevision] = useState(0);
  const [methods, setMethods] = useState<MethodsState>({ status: 'loading' });
  const [list, setList] = useState<ListState>({
    status: 'loading',
    key: initialDate + ':0',
  });
  const [errors, setErrors] = useState<TipErrors>({});
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const key = date + ':' + revision;
  const current: ListState = !isTipDate(date)
    ? { status: 'idle', key }
    : list.key === key
      ? list
      : { status: 'loading', key };
  // Los medios elegibles salen del catálogo administrado: solo activos con propinas.
  useEffect(() => {
    const controller = new AbortController();
    loadPaymentMethods(
      { isActive: true, availableForTips: true },
      controller.signal,
    ).then(
      (catalog) => {
        if (!controller.signal.aborted)
          setMethods({ status: 'ready', methods: catalog });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setMethods({
            status: 'error',
            message:
              cause instanceof PaymentMethodError
                ? cause.message
                : 'No se pudieron cargar los medios de pago. Intenta nuevamente.',
          });
      },
    );
    return () => controller.abort();
  }, [methodsRevision]);
  useEffect(() => {
    if (!isTipDate(date)) return;
    const controller = new AbortController();
    loadTips(store.id, date, controller.signal).then(
      (entries) => {
        if (!controller.signal.aborted)
          setList({ status: 'ready', key, entries });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setList({
            status: 'error',
            key,
            message:
              cause instanceof TipRequestError
                ? cause.message
                : tipErrorMessage(503),
          });
      },
    );
    return () => controller.abort();
  }, [date, key, store.id]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (inFlight.current || !store.isActive || current.status !== 'ready')
      return;
    if (methods.status !== 'ready' || !methods.methods.length) return;
    const fields = { businessDate: date, paymentMethod: method, amount };
    const validation = tipFieldErrors(fields);
    // El medio elegido debe seguir activo y elegible en el catálogo cargado.
    if (
      !validation.paymentMethod &&
      !methods.methods.some((item) => item.code === method)
    )
      validation.paymentMethod =
        'El medio seleccionado ya no está disponible. Selecciona otro u actualiza la página.';
    setErrors(validation);
    setFailure('');
    setNotice('');
    const invalid = Object.keys(validation)[0];
    if (invalid) {
      const field = form.current?.elements.namedItem(invalid);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    const input = parseTipInput({ ...fields, amount: parseTipAmount(amount) });
    if (!input) return;
    // El ref bloquea también dos eventos submit en el mismo ciclo de React.
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await createTip(store.id, input);
      setAmount('');
      setNotice(
        result.created
          ? 'Propinas registradas correctamente.'
          : 'Este registro ya estaba guardado. No se creó un duplicado.',
      );
      setRevision((value) => value + 1);
    } catch (cause) {
      setFailure(
        cause instanceof TipRequestError ? cause.message : tipErrorMessage(503),
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  const entries = current.status === 'ready' ? current.entries : [];
  const totals = tipTotals(entries);
  const preview = parseTipAmount(amount);
  const catalog: readonly PaymentMethod[] =
    methods.status === 'ready' ? methods.methods : [];
  const orderedEntries = sortTipEntriesByCatalog(entries, catalog);
  // Totales dinámicos: primero los medios activos del catálogo y después los
  // códigos históricos que ya no tienen medio activo, con su nombre guardado.
  const totalRows = [
    ...catalog.map((item) => ({
      code: item.code,
      name: item.name,
      amount: totals.get(item.code) ?? 0,
    })),
    ...orderedEntries
      .filter(
        (entry) => !catalog.some((item) => item.code === entry.paymentMethod),
      )
      .map((entry) => ({
        code: entry.paymentMethod,
        name: entry.paymentMethodName,
        amount: totals.get(entry.paymentMethod) ?? 0,
      })),
  ];
  const dayTotal = entries.reduce((sum, entry) => sum + entry.amount, 0);
  return (
    <div className="min-w-0 space-y-5">
      <section aria-labelledby="tip-form-title" className={filterPanelClass}>
        <h2 id="tip-form-title" className={panelTitleClass}>
          Registrar propinas
        </h2>
        <p className="mt-2 break-words text-sm text-ink2">
          Local asignado:{' '}
          <strong className="font-semibold text-ink">{store.name}</strong>
        </p>
        <p className="mt-2 text-xs leading-5 text-ink2">
          La cuenta conectada queda como responsable. Se guarda un registro por
          fecha y medio de pago.
        </p>
        {!store.isActive && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-warn-bg p-3 text-sm text-warn"
          >
            Tu local está inactivo. Puedes consultar el historial; solicita su
            revisión al administrador para registrar propinas.
          </p>
        )}
        <form
          ref={form}
          onSubmit={submit}
          noValidate
          className="mt-5 space-y-4"
          aria-busy={saving}
        >
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            <legend className="sr-only">Datos de las propinas</legend>
            <div className="grid min-w-0 gap-4 md:grid-cols-3">
              <label className={labelClass}>
                Fecha del registro{' '}
                <span className="font-normal">(obligatoria)</span>
                <input
                  name="businessDate"
                  type="date"
                  min="0100-01-01"
                  max="9999-12-31"
                  required
                  value={date}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDate(value);
                    setErrors(
                      isTipDate(value)
                        ? {}
                        : { businessDate: 'Selecciona una fecha válida.' },
                    );
                    setNotice('');
                    setFailure('');
                  }}
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.businessDate)}
                  aria-describedby="tip-date-help tip-date-error"
                />
              </label>
              <label className={labelClass}>
                Medio de pago <span className="font-normal">(obligatorio)</span>
                <select
                  name="paymentMethod"
                  required
                  value={method}
                  onChange={(event) => {
                    setMethod(event.target.value);
                    setErrors((value) => ({
                      ...value,
                      paymentMethod: undefined,
                    }));
                  }}
                  disabled={methods.status !== 'ready' || !catalog.length}
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.paymentMethod)}
                  aria-describedby="tip-method-help tip-method-error"
                >
                  <option value="">
                    {methods.status === 'loading'
                      ? 'Cargando medios…'
                      : catalog.length
                        ? 'Selecciona un medio'
                        : 'Sin medios disponibles'}
                  </option>
                  {catalog.map((item) => (
                    <option key={item.id} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Monto en CLP <span className="font-normal">(obligatorio)</span>
                <input
                  name="amount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setErrors((value) => ({ ...value, amount: undefined }));
                  }}
                  placeholder="Ej. 12500"
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.amount)}
                  aria-describedby="tip-amount-help tip-amount-error"
                />
              </label>
            </div>
            <p id="tip-date-help" className="text-xs leading-5 text-ink2">
              Al cambiar la fecha se consultan sus registros. Las fechas
              corresponden al día de negocio en Chile.
            </p>
            <p
              id="tip-date-error"
              hidden={!errors.businessDate}
              className="text-sm text-crit"
            >
              {errors.businessDate}
            </p>
            <p id="tip-method-help" className="text-xs leading-5 text-ink2">
              Los medios disponibles los administra el administrador en Medios
              de pago.
            </p>
            <p
              id="tip-method-error"
              hidden={!errors.paymentMethod}
              className="text-sm text-crit"
            >
              {errors.paymentMethod}
            </p>
            <p id="tip-amount-help" className="text-xs leading-5 text-ink2">
              Ingresa pesos completos, sin puntos ni decimales. El monto puede
              ser cero.
              {preview !== null && amount.trim()
                ? ' Monto a registrar: ' + formatClp(preview) + '.'
                : ''}
            </p>
            <p
              id="tip-amount-error"
              hidden={!errors.amount}
              className="text-sm text-crit"
            >
              {errors.amount}
            </p>
          </fieldset>
          {Object.values(errors).some(Boolean) && (
            <p role="alert" className="text-sm text-crit">
              Corrige los campos indicados antes de guardar.
            </p>
          )}
          {methods.status === 'error' && (
            <div role="alert" className="space-y-3 text-sm text-crit">
              <p>{methods.message}</p>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setMethods({ status: 'loading' });
                  setMethodsRevision((value) => value + 1);
                }}
                className={buttonClass}
              >
                Reintentar carga de medios
              </button>
            </div>
          )}
          {methods.status === 'ready' && !catalog.length && (
            <p role="alert" className="text-sm text-warn">
              No hay medios de pago activos para propinas. El administrador
              puede habilitarlos en Medios de pago.
            </p>
          )}
          {failure && (
            <p
              role="alert"
              className="rounded-lg border border-crit/20 bg-crit-bg px-3.5 py-3 text-sm text-crit"
            >
              {failure}
            </p>
          )}
          <button
            type="submit"
            disabled={
              saving ||
              !store.isActive ||
              current.status !== 'ready' ||
              methods.status !== 'ready' ||
              !catalog.length
            }
            className={primaryButtonClass}
          >
            {saving ? 'Guardando…' : 'Guardar propinas'}
          </button>
        </form>
      </section>
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-line2 bg-tint2 p-4 text-sm text-ink2"
        >
          {notice}
        </p>
      )}
      <section
        aria-labelledby="tip-list-title"
        className={`${tablePanelClass} min-w-0`}
        aria-busy={current.status === 'loading'}
      >
        <div className={tableHeaderClass}>
          <div className="min-w-0">
            <h2 id="tip-list-title" className={panelTitleClass}>
              Registros del día
              {isTipDate(date) ? ' · ' + formatCalendarDate(date) : ''}
            </h2>
            <p className={tableDescriptionClass}>
              Propinas de tu local por medio de pago y responsable
            </p>
          </div>
          <button
            type="button"
            disabled={
              saving || current.status === 'loading' || !isTipDate(date)
            }
            onClick={() => setRevision((value) => value + 1)}
            className={buttonClass}
          >
            Actualizar registros
          </button>
        </div>
        {current.status === 'loading' && (
          <p role="status" className="p-5 text-sm text-ink2">
            Cargando registros de propinas…
          </p>
        )}
        {current.status === 'idle' && (
          <p role="status" className="p-5 text-sm text-ink2">
            Selecciona una fecha válida para consultar y registrar propinas.
          </p>
        )}
        {current.status === 'error' && (
          <div role="alert" className="space-y-3 p-5 text-sm text-crit">
            <p>{current.message}</p>
            <button
              type="button"
              onClick={() => setRevision((value) => value + 1)}
              className={buttonClass}
            >
              Reintentar consulta
            </button>
          </div>
        )}
        {current.status === 'ready' && (
          <>
            {totalRows.length > 0 && (
              <dl
                aria-label="Totales por medio de pago"
                className="grid grid-cols-2 gap-4 border-b border-line p-5 xl:grid-cols-4"
              >
                {totalRows.map((row) => (
                  <div key={row.code} className="min-w-0">
                    <dt className="text-xs text-ink2">{row.name}</dt>
                    <dd className="mt-2 break-words text-sm font-semibold tabular-nums">
                      {formatClp(row.amount)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {entries.length ? (
              <>
                <p className="px-5 py-3 text-xs text-ink2 lg:hidden">
                  Desliza la tabla para consultar todas las columnas.
                </p>
                <div
                  role="region"
                  aria-label="Registros de propinas desplazables"
                  tabIndex={0}
                  className="min-w-0 max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-salmon-ink"
                >
                  <table className={`${tableClass} min-w-[680px]`}>
                    <caption className="sr-only">
                      Registros de propinas del local para la fecha
                      seleccionada. Montos en pesos chilenos.
                    </caption>
                    <thead className={tableHeadClass}>
                      <tr>
                        {[
                          'Fecha',
                          'Medio de pago',
                          'Monto CLP',
                          'Responsable',
                          'Registrado · Chile',
                        ].map((title) => (
                          <th
                            key={title}
                            scope="col"
                            className={tableHeadingClass}
                          >
                            {title}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {orderedEntries.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-b border-line last:border-b-0 hover:bg-tint"
                        >
                          <td className={tableCellClass}>
                            {formatCalendarDate(entry.businessDate)}
                          </td>
                          <td className={tableCellClass}>
                            {entry.paymentMethodName}
                          </td>
                          <td
                            className={`${tableCellClass} whitespace-nowrap font-semibold tabular-nums`}
                          >
                            {formatClp(entry.amount)}
                          </td>
                          <td
                            className={`${tableCellClass} max-w-60 break-words`}
                          >
                            {entry.responsible.name}
                          </td>
                          <td className={tableCellClass}>
                            <time dateTime={entry.createdAt}>
                              {new Intl.DateTimeFormat('es-CL', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                                timeZone: 'America/Santiago',
                              }).format(new Date(entry.createdAt))}
                            </time>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="px-5 py-10 text-center">
                <h3 className="text-sm font-semibold">
                  No hay registros para esta fecha
                </h3>
                <p className="mt-2 text-sm text-ink2">
                  Completa el formulario para registrar las primeras propinas
                  del día.
                </p>
              </div>
            )}
            <p className="border-t border-line px-5 py-4 text-sm text-ink2">
              {entries.length} {entries.length === 1 ? 'registro' : 'registros'}{' '}
              · Total del día:{' '}
              <strong className="font-semibold text-ink">
                {formatClp(dayTotal)}
              </strong>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
