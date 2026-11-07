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
  badgeClass,
} from '@/components/ui/styles';
import {
  createDailyOperation,
  DailyOperationRequestError,
  loadDailyOperationById,
  loadDailyOperations,
} from '@/lib/daily-operations-client';
import {
  dailyOperationFieldErrors,
  dailyOperationErrorMessage,
  formatSignedClp,
  parseCashDifference,
  parseDailyAmount,
  voucherFileError,
  type DailyOperation,
  type DailyOperationFieldErrors,
  type DailyOperationFormFields,
} from '@/lib/daily-operations';
import { formatCalendarDate } from '@/lib/display-date';
import { formatClp, isTipDate } from '@/lib/tips';

type QueryState =
  | { status: 'loading' | 'idle'; key: string }
  | { status: 'error'; key: string; message: string }
  | { status: 'ready'; key: string; operation: DailyOperation | null };

export function DailyOperationPanel({
  store,
  initialDate,
}: {
  store: { id: string; name: string; isActive: boolean };
  initialDate: string;
}): ReactElement {
  const [date, setDate] = useState(initialDate);
  const [cardTip, setCardTip] = useState('');
  const [cashTip, setCashTip] = useState('');
  const [difference, setDifference] = useState('0');
  const [reason, setReason] = useState('');
  const [voucher, setVoucher] = useState<File | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState<QueryState>({
    status: 'loading',
    key: initialDate + ':0',
  });
  const [errors, setErrors] = useState<DailyOperationFieldErrors>({});
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [conflictId, setConflictId] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const voucherInput = useRef<HTMLInputElement>(null);
  const key = date + ':' + revision;
  const current: QueryState = !isTipDate(date)
    ? { status: 'idle', key }
    : query.key === key
      ? query
      : { status: 'loading', key };
  useEffect(() => {
    if (!isTipDate(date)) return;
    const controller = new AbortController();
    loadDailyOperations(store.id, date, controller.signal).then(
      (operations) => {
        if (!controller.signal.aborted)
          setQuery({
            status: 'ready',
            key,
            operation: operations[0] ?? null,
          });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setQuery({
            status: 'error',
            key,
            message:
              cause instanceof DailyOperationRequestError
                ? cause.message
                : dailyOperationErrorMessage(503),
          });
      },
    );
    return () => controller.abort();
  }, [date, key, store.id]);
  function clearFeedback(): void {
    setFailure('');
    setNotice('');
    setConflictId('');
  }
  function selectVoucher(file: File | null): void {
    setVoucher(file);
    setErrors((value) => ({
      ...value,
      voucher: file ? (voucherFileError(file) ?? undefined) : undefined,
    }));
    clearFeedback();
  }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (inFlight.current || !store.isActive || current.status !== 'ready')
      return;
    const fields: DailyOperationFormFields = {
      businessDate: date,
      cardTipAmount: cardTip,
      cashTipAmount: cashTip,
      cashDifference: difference,
      differenceReason: reason,
    };
    const validation = dailyOperationFieldErrors(fields, voucher !== null);
    if (voucher && !validation.voucher) {
      const fileError = voucherFileError(voucher);
      if (fileError) validation.voucher = fileError;
    }
    setErrors(validation);
    clearFeedback();
    const invalid = Object.keys(validation)[0];
    if (invalid) {
      const field =
        invalid === 'voucher'
          ? voucherInput.current
          : form.current?.elements.namedItem(invalid);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    const cardTipAmount = parseDailyAmount(cardTip);
    const cashTipAmount = parseDailyAmount(cashTip);
    const cashDifference = parseCashDifference(difference);
    if (
      cardTipAmount === null ||
      cashTipAmount === null ||
      cashDifference === null
    )
      return;
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await createDailyOperation(
        {
          storeId: store.id,
          businessDate: date,
          cardTipAmount,
          cashTipAmount,
          cashDifference,
          differenceReason: reason,
        },
        voucher,
      );
      setNotice(
        result.created
          ? 'Operación diaria registrada correctamente.'
          : 'Esta operación ya estaba registrada con los mismos valores. No se creó un duplicado.',
      );
      setCardTip('');
      setCashTip('');
      setDifference('0');
      setReason('');
      setVoucher(null);
      if (voucherInput.current) voucherInput.current.value = '';
      setRevision((value) => value + 1);
    } catch (cause) {
      if (
        cause instanceof DailyOperationRequestError &&
        cause.status === 409 &&
        cause.existingOperationId
      ) {
        setConflictId(cause.existingOperationId);
        try {
          const existing = await loadDailyOperationById(
            cause.existingOperationId,
            store.id,
            new AbortController().signal,
          );
          setQuery({ status: 'ready', key, operation: existing });
          setFailure(
            'Ya existe una operación registrada para esta fecha con otros valores. Mostramos la registrada.',
          );
        } catch {
          setFailure(cause.message);
        }
      } else {
        setFailure(
          cause instanceof DailyOperationRequestError
            ? cause.message
            : dailyOperationErrorMessage(503),
        );
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  const registered = current.status === 'ready' ? current.operation : null;
  const cardTipPreview = parseDailyAmount(cardTip);
  const differencePreview = parseCashDifference(difference);
  return (
    <div className="min-w-0 space-y-5">
      <section aria-labelledby="daily-form-title" className={filterPanelClass}>
        <h2 id="daily-form-title" className={panelTitleClass}>
          Registrar operación diaria
        </h2>
        <p className="mt-2 break-words text-sm text-ink2">
          Local asignado:{' '}
          <strong className="font-semibold text-ink">{store.name}</strong>
        </p>
        <p className="mt-2 text-xs leading-5 text-ink2">
          La cuenta conectada queda como responsable. Se guarda una operación
          por fecha: propinas con tarjeta y su voucher, propinas en efectivo y
          la diferencia de efectivo declarada.
        </p>
        {!store.isActive && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-warn-bg p-3 text-sm text-warn"
          >
            Tu local está inactivo. Puedes consultar el historial; solicita su
            revisión al administrador para registrar la operación diaria.
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
            <legend className="sr-only">Datos de la operación diaria</legend>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <label className={labelClass}>
                Fecha de operación{' '}
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
                    clearFeedback();
                  }}
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.businessDate)}
                  aria-describedby="daily-date-help daily-date-error"
                />
              </label>
              <label className={labelClass}>
                Propina con tarjeta (CLP){' '}
                <span className="font-normal">(obligatoria)</span>
                <input
                  name="cardTipAmount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  value={cardTip}
                  onChange={(event) => {
                    setCardTip(event.target.value);
                    setErrors((value) => ({
                      ...value,
                      cardTipAmount: undefined,
                    }));
                    clearFeedback();
                  }}
                  placeholder="Ej. 12500"
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.cardTipAmount)}
                  aria-describedby="daily-card-help daily-card-error"
                />
              </label>
              <label className={labelClass}>
                Foto del voucher{' '}
                <span className="font-normal">
                  (obligatoria si hay propina con tarjeta)
                </span>
                <input
                  ref={voucherInput}
                  name="voucher"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) =>
                    selectVoucher(event.target.files?.[0] ?? null)
                  }
                  className={`${inputClass} mt-2 file:mr-3 file:rounded-lg file:border-0 file:bg-tint2 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-salmon-ink hover:file:bg-tint3`}
                  aria-invalid={Boolean(errors.voucher)}
                  aria-describedby="daily-voucher-help daily-voucher-error"
                />
              </label>
              <label className={labelClass}>
                Propina en efectivo (CLP){' '}
                <span className="font-normal">(obligatoria)</span>
                <input
                  name="cashTipAmount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  value={cashTip}
                  onChange={(event) => {
                    setCashTip(event.target.value);
                    setErrors((value) => ({
                      ...value,
                      cashTipAmount: undefined,
                    }));
                    clearFeedback();
                  }}
                  placeholder="Ej. 8000"
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.cashTipAmount)}
                  aria-describedby="daily-cash-help daily-cash-error"
                />
              </label>
              <label className={labelClass}>
                Diferencia de efectivo (CLP){' '}
                <span className="font-normal">
                  (obligatoria, con signo; 0 si no hay)
                </span>
                <input
                  name="cashDifference"
                  type="text"
                  autoComplete="off"
                  required
                  value={difference}
                  onChange={(event) => {
                    setDifference(event.target.value);
                    setErrors((value) => ({
                      ...value,
                      cashDifference: undefined,
                    }));
                    clearFeedback();
                  }}
                  placeholder="Ej. -1500 o 2000"
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.cashDifference)}
                  aria-describedby="daily-difference-help daily-difference-error"
                />
              </label>
              <label className={labelClass}>
                Motivo de la diferencia{' '}
                <span className="font-normal">(obligatorio si no es cero)</span>
                <input
                  name="differenceReason"
                  type="text"
                  autoComplete="off"
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setErrors((value) => ({
                      ...value,
                      differenceReason: undefined,
                    }));
                    clearFeedback();
                  }}
                  placeholder="Ej. Vale de caja firmado por el encargado"
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.differenceReason)}
                  aria-describedby="daily-reason-help daily-reason-error"
                />
              </label>
            </div>
            <p id="daily-date-help" className="text-xs leading-5 text-ink2">
              Al cambiar la fecha se consulta su operación registrada. Las
              fechas corresponden al día de negocio en Chile.
            </p>
            <p
              id="daily-date-error"
              hidden={!errors.businessDate}
              className="text-sm text-crit"
            >
              {errors.businessDate}
            </p>
            <p id="daily-card-help" className="text-xs leading-5 text-ink2">
              Ingresa pesos completos, sin puntos ni decimales.
              {cardTipPreview !== null && cardTip.trim()
                ? ' Monto a registrar: ' + formatClp(cardTipPreview) + '.'
                : ''}
            </p>
            <p
              id="daily-card-error"
              hidden={!errors.cardTipAmount}
              className="text-sm text-crit"
            >
              {errors.cardTipAmount}
            </p>
            <p id="daily-voucher-help" className="text-xs leading-5 text-ink2">
              Fotografía privada del voucher de propinas con tarjeta. Formatos
              JPEG, PNG o WebP, máximo 5 MiB.
              {voucher
                ? ` Archivo seleccionado: ${voucher.name} (${Math.ceil(voucher.size / 1024)} KiB).`
                : ''}
            </p>
            <p
              id="daily-voucher-error"
              hidden={!errors.voucher}
              className="text-sm text-crit"
            >
              {errors.voucher}
            </p>
            <p id="daily-cash-help" className="text-xs leading-5 text-ink2">
              Ingresa pesos completos, sin puntos ni decimales. El monto puede
              ser cero.
            </p>
            <p
              id="daily-cash-error"
              hidden={!errors.cashTipAmount}
              className="text-sm text-crit"
            >
              {errors.cashTipAmount}
            </p>
            <p
              id="daily-difference-help"
              className="text-xs leading-5 text-ink2"
            >
              Declara el sobrante positivo (por ejemplo 2000) y el faltante
              negativo (por ejemplo -1500).
              {differencePreview !== null && difference.trim()
                ? ' Diferencia a registrar: ' +
                  formatSignedClp(differencePreview) +
                  '.'
                : ''}
            </p>
            <p
              id="daily-difference-error"
              hidden={!errors.cashDifference}
              className="text-sm text-crit"
            >
              {errors.cashDifference}
            </p>
            <p id="daily-reason-help" className="text-xs leading-5 text-ink2">
              Se exige solo cuando la diferencia de efectivo no es cero.
            </p>
            <p
              id="daily-reason-error"
              hidden={!errors.differenceReason}
              className="text-sm text-crit"
            >
              {errors.differenceReason}
            </p>
          </fieldset>
          {Object.values(errors).some(Boolean) && (
            <p role="alert" className="text-sm text-crit">
              Corrige los campos indicados antes de guardar.
            </p>
          )}
          {failure && (
            <p
              role="alert"
              className="rounded-lg border border-crit/20 bg-crit-bg px-3.5 py-3 text-sm text-crit"
            >
              {failure}
              {conflictId && (
                <>
                  {' '}
                  <span className="font-mono break-all">ID {conflictId}</span>
                </>
              )}
            </p>
          )}
          <button
            type="submit"
            disabled={saving || !store.isActive || current.status !== 'ready'}
            className={primaryButtonClass}
          >
            {saving ? 'Guardando…' : 'Guardar operación'}
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
        aria-labelledby="daily-registered-title"
        className={`${tablePanelClass} min-w-0`}
        aria-busy={current.status === 'loading'}
      >
        <div className={tableHeaderClass}>
          <div className="min-w-0">
            <h2 id="daily-registered-title" className={panelTitleClass}>
              Operación registrada
              {isTipDate(date) ? ' · ' + formatCalendarDate(date) : ''}
            </h2>
            <p className={tableDescriptionClass}>
              La operación diaria de tu local es la fuente de los montos de
              propina
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {registered && (
              <span className={`${badgeClass} bg-ok-bg text-ok`}>
                Registrada
              </span>
            )}
            <button
              type="button"
              disabled={
                saving || current.status === 'loading' || !isTipDate(date)
              }
              onClick={() => setRevision((value) => value + 1)}
              className={buttonClass}
            >
              Actualizar consulta
            </button>
          </div>
        </div>
        {current.status === 'loading' && (
          <p role="status" className="p-5 text-sm text-ink2">
            Consultando la operación del día…
          </p>
        )}
        {current.status === 'idle' && (
          <p role="status" className="p-5 text-sm text-ink2">
            Selecciona una fecha válida para consultar y registrar la operación
            diaria.
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
        {current.status === 'ready' && !registered && (
          <div className="px-5 py-10 text-center">
            <h3 className="text-sm font-semibold">
              No hay operación registrada para esta fecha
            </h3>
            <p className="mt-2 text-sm text-ink2">
              Completa el formulario para registrar la operación diaria del
              local.
            </p>
          </div>
        )}
        {current.status === 'ready' && registered && (
          <div className="space-y-4 p-5">
            <dl className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Propina con tarjeta</dt>
                <dd className="mt-2 break-words text-sm font-semibold tabular-nums">
                  {formatClp(registered.cardTipAmount)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Propina en efectivo</dt>
                <dd className="mt-2 break-words text-sm font-semibold tabular-nums">
                  {formatClp(registered.cashTipAmount)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Fondo de propinas</dt>
                <dd className="mt-2 break-words text-sm font-semibold tabular-nums">
                  {formatClp(registered.tipFundAmount)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Diferencia de efectivo</dt>
                <dd
                  className={`mt-2 break-words text-sm font-semibold tabular-nums ${
                    registered.cashDifference === 0
                      ? 'text-ink'
                      : registered.cashDifference > 0
                        ? 'text-info'
                        : 'text-warn'
                  }`}
                >
                  {formatSignedClp(registered.cashDifference)}
                </dd>
                {registered.differenceReason && (
                  <dd className="mt-1 break-words text-xs leading-5 text-ink2">
                    {registered.differenceReason}
                  </dd>
                )}
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Responsable</dt>
                <dd className="mt-2 break-words text-sm font-semibold">
                  {registered.responsible.name}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Registrada · Chile</dt>
                <dd className="mt-2 text-sm tabular-nums">
                  <time dateTime={registered.createdAt}>
                    {new Intl.DateTimeFormat('es-CL', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                      timeZone: 'America/Santiago',
                    }).format(new Date(registered.createdAt))}
                  </time>
                </dd>
              </div>
            </dl>
            {registered.voucher && (
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-tint p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold">
                    Voucher de propinas con tarjeta
                  </p>
                  <p className="mt-1 break-all text-xs text-muted">
                    {registered.voucher.fileName} ·{' '}
                    {Math.ceil(registered.voucher.sizeBytes / 1024)} KiB ·{' '}
                    <span className="font-mono">
                      {registered.voucher.sha256Hash.slice(0, 16)}…
                    </span>
                  </p>
                </div>
                <a
                  href={'/api/daily-operations/' + registered.id + '/voucher'}
                  className={`${buttonClass} shrink-0`}
                >
                  Descargar voucher
                </a>
              </div>
            )}
            <p className="border-t border-line pt-4 text-xs text-muted">
              ID de la operación:{' '}
              <span className="font-mono break-all">{registered.id}</span>
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
