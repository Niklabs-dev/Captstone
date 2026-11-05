'use client';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  badgeClass,
  buttonClass,
  filterPanelClass,
  inputClass,
  labelClass,
  panelTitleClass,
  primaryButtonClass,
} from '@/components/ui/styles';
import {
  ClosingDetail,
  ClosingDetailDialog,
} from '@/components/sales-dashboard/ClosingDetailDialog';
import {
  CLOSING_METHODS,
  MAX_NOTES_LENGTH,
  MAX_REASON_LENGTH,
  buildClosingInput,
  closingErrorMessage,
  closingFieldErrors,
  emptyClosingFields,
  periodsMismatch,
  previewVouchers,
  selectedTipTotal,
  type ClosingErrors,
  type ClosingFields,
  type ClosingInput,
  type ClosingTipOption,
} from '@/lib/cash-closing-form';
import {
  CashClosingRequestError,
  createCashClosing,
} from '@/lib/cash-closing-client';
import {
  formatClpAmount,
  formatSignedClp,
  isCalendarDate,
  paymentMethodLabel,
  type CashClosing,
} from '@/lib/cash-closings';
import { loadTips, TipRequestError } from '@/lib/tips-client';
import { formatCalendarDate } from '@/lib/display-date';

type TipState =
  | { status: 'idle' | 'loading'; key: string }
  | { status: 'error'; key: string; message: string }
  | { status: 'ready'; key: string; options: ClosingTipOption[] };

type Step =
  | { name: 'edit' }
  | { name: 'review'; input: ClosingInput }
  | { name: 'done'; closing: CashClosing; created: boolean };

type AmountField =
  | 'openingCash'
  | 'mrcomandaDebit'
  | 'mrcomandaCredit'
  | 'mercadoPagoDebit'
  | 'mercadoPagoCredit'
  | 'mercadoPagoTips';
type TimeField =
  'mrcomandaStart' | 'mrcomandaEnd' | 'mercadoPagoStart' | 'mercadoPagoEnd';

function FieldError({
  id,
  message,
}: {
  id: string;
  message?: string;
}): ReactElement {
  return (
    <p id={id} hidden={!message} className="mt-1 text-sm text-crit">
      {message}
    </p>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <fieldset
      aria-labelledby={id}
      className="min-w-0 space-y-4 border-t border-line pt-5 first:border-t-0 first:pt-0"
    >
      <legend id={id} className={`${panelTitleClass} float-left w-full`}>
        {title}
      </legend>
      <p className="clear-both text-xs leading-5 text-ink2">{description}</p>
      {children}
    </fieldset>
  );
}

function differenceTone(amount: number): string {
  return amount === 0 ? 'text-ink' : 'font-semibold text-crit';
}

export function CashClosingPanel({
  store,
  initialDate,
}: {
  store: { id: string; name: string; isActive: boolean };
  initialDate: string;
}): ReactElement {
  const [fields, setFields] = useState<ClosingFields>(() =>
    emptyClosingFields(initialDate),
  );
  const [errors, setErrors] = useState<ClosingErrors>({});
  const [step, setStep] = useState<Step>({ name: 'edit' });
  const [failure, setFailure] = useState<CashClosingRequestError | null>(null);
  const [saving, setSaving] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [tipRevision, setTipRevision] = useState(0);
  const [tips, setTips] = useState<TipState>({
    status: 'loading',
    key: initialDate + ':0',
  });
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const reviewTitle = useRef<HTMLHeadingElement>(null);
  const resultTitle = useRef<HTMLHeadingElement>(null);

  const tipKey = fields.businessDate + ':' + tipRevision;
  const tipState: TipState = !isCalendarDate(fields.businessDate)
    ? { status: 'idle', key: tipKey }
    : tips.key === tipKey
      ? tips
      : { status: 'loading', key: tipKey };
  const tipOptions = tipState.status === 'ready' ? tipState.options : [];

  // Al cambiar la fecha se cargan las propinas ya registradas del día, que son
  // el fondo existente a vincular (no se crea otro fondo ni se deduce).
  useEffect(() => {
    const date = fields.businessDate;
    if (!isCalendarDate(date)) return;
    const controller = new AbortController();
    loadTips(store.id, date, controller.signal).then(
      (entries) => {
        if (controller.signal.aborted) return;
        const options = entries.map((entry) => ({
          id: entry.id,
          paymentMethod: entry.paymentMethod,
          amount: entry.amount,
        }));
        setTips({ status: 'ready', key: tipKey, options });
        // Se preseleccionan todos los registros del día; el supervisor ajusta.
        setFields((current) =>
          current.businessDate === date
            ? { ...current, tipEntryIds: options.map((option) => option.id) }
            : current,
        );
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setTips({
            status: 'error',
            key: tipKey,
            message:
              cause instanceof TipRequestError
                ? cause.message
                : 'No se pudieron consultar las propinas del día.',
          });
      },
    );
    return () => controller.abort();
  }, [fields.businessDate, tipKey, store.id]);

  useEffect(() => {
    if (step.name === 'review') reviewTitle.current?.focus();
    if (step.name === 'done') resultTitle.current?.focus();
  }, [step.name]);

  function update(patch: Partial<ClosingFields>, names: string[]): void {
    setFields((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const name of names) delete next[name];
      return next;
    });
    setFailure(null);
  }

  function focusField(name: string): void {
    const field = form.current?.elements.namedItem(name);
    if (field instanceof HTMLElement) field.focus();
    else if (field instanceof RadioNodeList && field[0] instanceof HTMLElement)
      field[0].focus();
  }

  function review(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!store.isActive || tipState.status !== 'ready') return;
    const validation = closingFieldErrors(fields, tipOptions);
    setErrors(validation);
    setFailure(null);
    const invalid = Object.keys(validation)[0];
    if (invalid) {
      focusField(invalid);
      return;
    }
    const input = buildClosingInput(fields);
    if (input) setStep({ name: 'review', input });
  }

  async function confirm(input: ClosingInput): Promise<undefined> {
    // El ref bloquea dos confirmaciones en el mismo ciclo de React.
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    try {
      const result = await createCashClosing(store.id, input);
      setStep({ name: 'done', ...result });
    } catch (cause) {
      const error =
        cause instanceof CashClosingRequestError
          ? cause
          : new CashClosingRequestError(503);
      setFailure(error);
      setStep({ name: 'edit' });
      if (error.code === 'REASON_REQUIRED') {
        setErrors({
          differenceReason:
            'Hay diferencias entre lo esperado y lo contado: explica el motivo.',
        });
        // Espera a que el formulario vuelva a mostrarse antes de enfocar.
        requestAnimationFrame(() => focusField('differenceReason'));
      } else if (error.code === 'TIP_ENTRIES_INVALID')
        setTipRevision((value) => value + 1);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function restart(): void {
    setFields(emptyClosingFields(fields.businessDate));
    setErrors({});
    setFailure(null);
    setStep({ name: 'edit' });
    setTipRevision((value) => value + 1);
  }

  const preview = previewVouchers(fields);
  const mismatch = periodsMismatch(fields);
  const linkedTips = selectedTipTotal(tipOptions, fields.tipEntryIds);
  const reasonRequired = preview.reconciliationDifference !== 0;

  function amountInput(
    name: AmountField,
    label: string,
    help?: string,
  ): ReactElement {
    const errorId = `closing-${name}-error`;
    return (
      <label className={labelClass}>
        {label} <span className="font-normal">(CLP)</span>
        <input
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          required
          maxLength={13}
          placeholder="Ej. 125000"
          value={fields[name]}
          onChange={(event) =>
            update({ [name]: event.target.value } as Partial<ClosingFields>, [
              name,
              ...(name === 'mercadoPagoTips' ? ['tipEntryIds'] : []),
            ])
          }
          className={`${inputClass} mt-2`}
          aria-invalid={Boolean(errors[name])}
          aria-describedby={errorId}
        />
        {help && (
          <span className="mt-1 block font-normal text-ink2">{help}</span>
        )}
        <FieldError id={errorId} message={errors[name]} />
      </label>
    );
  }

  function timeInput(name: TimeField, label: string): ReactElement {
    const errorId = `closing-${name}-error`;
    return (
      <label className={labelClass}>
        {label}
        <input
          name={name}
          type="time"
          required
          value={fields[name]}
          onChange={(event) =>
            update({ [name]: event.target.value } as Partial<ClosingFields>, [
              name,
              'mercadoPagoStart',
              'mercadoPagoEnd',
              'mrcomandaEnd',
            ])
          }
          className={`${inputClass} mt-2`}
          aria-invalid={Boolean(errors[name])}
          aria-describedby={errorId}
        />
        <FieldError id={errorId} message={errors[name]} />
      </label>
    );
  }

  if (step.name === 'done') {
    return (
      <section
        aria-labelledby="closing-result-title"
        className={`${filterPanelClass} min-w-0 space-y-5`}
      >
        <div>
          <h2
            id="closing-result-title"
            ref={resultTitle}
            tabIndex={-1}
            className="text-lg font-bold focus-visible:outline-2 focus-visible:outline-salmon-ink"
          >
            {step.created
              ? 'Cierre de caja confirmado'
              : 'Este cierre ya estaba registrado'}
          </h2>
          <p role="status" className="mt-1 text-sm text-ink2">
            {step.created
              ? 'El cierre quedó registrado con su fecha-hora y responsable. Revisa las diferencias calculadas.'
              : 'Se reconoció un reintento idéntico: se muestra el cierre existente y no se creó un duplicado.'}
          </p>
        </div>
        <ClosingDetail closing={step.closing} />
        <button type="button" onClick={restart} className={buttonClass}>
          Registrar otro cierre
        </button>
      </section>
    );
  }

  return (
    <div className="min-w-0 space-y-5">
      {step.name === 'review' && (
        <section
          aria-labelledby="closing-review-title"
          className={`${filterPanelClass} min-w-0 space-y-4 border-salmon`}
          aria-busy={saving}
        >
          <h2
            id="closing-review-title"
            ref={reviewTitle}
            tabIndex={-1}
            className="text-lg font-bold focus-visible:outline-2 focus-visible:outline-salmon-ink"
          >
            Revisa y confirma el cierre
          </h2>
          <p className="text-sm text-ink2">
            {store.name} · {formatCalendarDate(step.input.businessDate)} · Turno{' '}
            {step.input.shift}. Una vez confirmado, el cierre no se puede
            modificar. Lo esperado por medio de pago se calcula con las ventas
            registradas del período al confirmar.
          </p>
          <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-line p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink2">Fondo inicial</dt>
              <dd className="font-semibold">
                {formatClpAmount(step.input.openingCash)}
              </dd>
            </div>
            {step.input.lines.map((line) => (
              <div key={line.paymentMethod}>
                <dt className="text-ink2">
                  Contado · {paymentMethodLabel(line.paymentMethod)}
                </dt>
                <dd className="font-semibold">
                  {formatClpAmount(line.countedAmount)}
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-ink2">Venta neta MrComanda</dt>
              <dd>{formatClpAmount(preview.mrcomandaNetSales)}</dd>
            </div>
            <div>
              <dt className="text-ink2">Cobro bruto Mercado Pago</dt>
              <dd>{formatClpAmount(preview.mercadoPagoGrossAmount)}</dd>
            </div>
            <div>
              <dt className="text-ink2">Propina a repartir (PROPINAS)</dt>
              <dd>{formatClpAmount(preview.mercadoPagoTipAmount)}</dd>
            </div>
            <div>
              <dt className="text-ink2">Descuadre de vouchers</dt>
              <dd className={differenceTone(preview.reconciliationDifference)}>
                {formatSignedClp(preview.reconciliationDifference)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-ink2">Motivo de la diferencia</dt>
              <dd className="break-words">
                {step.input.differenceReason ?? 'No informado'}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void confirm(step.input)}
              className={primaryButtonClass}
            >
              {saving ? 'Confirmando…' : 'Confirmar cierre'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setStep({ name: 'edit' })}
              className={buttonClass}
            >
              Volver a editar
            </button>
          </div>
        </section>
      )}

      <section
        aria-labelledby="closing-form-title"
        className={filterPanelClass}
        hidden={step.name === 'review'}
      >
        <h2 id="closing-form-title" className={panelTitleClass}>
          Registrar cierre de caja
        </h2>
        <p className="mt-2 break-words text-sm text-ink2">
          Local asignado:{' '}
          <strong className="font-semibold text-ink">{store.name}</strong>
        </p>
        <p className="mt-2 text-xs leading-5 text-ink2">
          La cuenta conectada queda como responsable. Se registra un cierre por
          local, fecha y turno; los montos se ingresan en pesos completos, sin
          puntos ni decimales.
        </p>
        {!store.isActive && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-warn-bg p-3 text-sm text-warn"
          >
            Tu local está inactivo. Solicita su revisión al administrador para
            registrar cierres de caja.
          </p>
        )}
        <form
          ref={form}
          onSubmit={review}
          noValidate
          className="mt-5 space-y-6"
        >
          <Section
            id="closing-shift-title"
            title="Turno"
            description="Las fechas corresponden al día de negocio en Chile. El fondo inicial solo se suma a lo esperado en efectivo."
          >
            <div className="grid min-w-0 gap-4 md:grid-cols-3">
              <label className={labelClass}>
                Fecha del cierre
                <input
                  name="businessDate"
                  type="date"
                  required
                  min="0100-01-01"
                  max="9999-12-31"
                  value={fields.businessDate}
                  onChange={(event) =>
                    update(
                      { businessDate: event.target.value, tipEntryIds: [] },
                      ['businessDate', 'tipEntryIds'],
                    )
                  }
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.businessDate)}
                  aria-describedby="closing-businessDate-error"
                />
                <FieldError
                  id="closing-businessDate-error"
                  message={errors.businessDate}
                />
              </label>
              <label className={labelClass}>
                Turno
                <input
                  name="shift"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  maxLength={5}
                  value={fields.shift}
                  onChange={(event) =>
                    update({ shift: event.target.value }, ['shift'])
                  }
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.shift)}
                  aria-describedby="closing-shift-error"
                />
                <FieldError id="closing-shift-error" message={errors.shift} />
              </label>
              {amountInput('openingCash', 'Fondo inicial')}
            </div>
          </Section>

          <Section
            id="closing-counted-title"
            title="Montos contados por medio de pago"
            description="Declara lo contado o registrado al cierre. Lo esperado se calcula con las ventas netas del período, sin propinas."
          >
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {CLOSING_METHODS.map((method) => {
                const name = 'counted.' + method;
                const errorId = `closing-counted-${method}-error`;
                return (
                  <label key={method} className={labelClass}>
                    {paymentMethodLabel(method)}{' '}
                    <span className="font-normal">(CLP)</span>
                    <input
                      name={name}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      required
                      maxLength={13}
                      placeholder="Ej. 0"
                      value={fields.counted[method]}
                      onChange={(event) =>
                        update(
                          {
                            counted: {
                              ...fields.counted,
                              [method]: event.target.value,
                            },
                          },
                          [name],
                        )
                      }
                      className={`${inputClass} mt-2`}
                      aria-invalid={Boolean(errors[name])}
                      aria-describedby={errorId}
                    />
                    <FieldError id={errorId} message={errors[name]} />
                  </label>
                );
              })}
            </div>
          </Section>

          <Section
            id="closing-mrcomanda-title"
            title="Voucher MrComanda · venta neta"
            description="Copia T. DÉBITO y T. CRÉDITO del cierre MrComanda. Son montos netos, sin propina."
          >
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {timeInput('mrcomandaStart', 'Inicio del corte')}
              {timeInput('mrcomandaEnd', 'Término del corte')}
              {amountInput('mrcomandaDebit', 'T. DÉBITO')}
              {amountInput('mrcomandaCredit', 'T. CRÉDITO')}
            </div>
          </Section>

          <Section
            id="closing-mercadopago-title"
            title="Voucher Mercado Pago · cobro bruto"
            description="Copia DÉBITO, CRÉDITO y PROPINAS del resumen de Mercado Pago. PROPINAS es el total oficial que se entregará para repartir; no se calcula restando vouchers."
          >
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {timeInput('mercadoPagoStart', 'Inicio del corte')}
              {timeInput('mercadoPagoEnd', 'Término del corte')}
              {amountInput('mercadoPagoDebit', 'DÉBITO')}
              {amountInput('mercadoPagoCredit', 'CRÉDITO')}
              {amountInput('mercadoPagoTips', 'PROPINAS')}
            </div>
            <p className="text-xs leading-5 text-ink2">
              Usa 00:00 como término para indicar la medianoche que cierra el
              día. Los cortes de ambos comprobantes deben coincidir.
            </p>
            {mismatch && (
              <p
                role="alert"
                className="rounded-lg bg-warn-bg p-3 text-sm text-warn"
              >
                Los cortes de MrComanda y Mercado Pago no coinciden. Revisa las
                horas impresas en ambos comprobantes antes de continuar.
              </p>
            )}
            <dl
              aria-label="Conciliación de vouchers"
              aria-live="polite"
              className="grid gap-x-6 gap-y-3 rounded-xl border border-line bg-tint p-4 text-sm sm:grid-cols-2 xl:grid-cols-4"
            >
              <div>
                <dt className="text-xs text-ink2">Venta neta MrComanda</dt>
                <dd className="mt-1 font-semibold tabular-nums">
                  {formatClpAmount(preview.mrcomandaNetSales)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink2">Cobro bruto Mercado Pago</dt>
                <dd className="mt-1 font-semibold tabular-nums">
                  {formatClpAmount(preview.mercadoPagoGrossAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink2">Propina (PROPINAS)</dt>
                <dd className="mt-1 font-semibold tabular-nums">
                  {formatClpAmount(preview.mercadoPagoTipAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink2">
                  Descuadre (neto MP − MrComanda)
                </dt>
                <dd
                  className={`mt-1 tabular-nums ${differenceTone(preview.reconciliationDifference)}`}
                >
                  {formatSignedClp(preview.reconciliationDifference)}
                  {' · '}
                  <span
                    className={`${badgeClass} ${preview.reconciliationDifference === 0 ? 'bg-ok-bg text-ok' : 'bg-crit-bg text-crit'}`}
                  >
                    {preview.reconciliationDifference === 0
                      ? 'Cuadrado'
                      : 'No cuadrado'}
                  </span>
                </dd>
              </div>
            </dl>
          </Section>

          <Section
            id="closing-tips-title"
            title="Propinas del día a vincular"
            description="Selecciona los registros de Propinas diarias que corresponden a PROPINAS. Se vinculan al cierre sin crear otro fondo ni sumarse a las ventas."
          >
            {tipState.status === 'loading' && (
              <p role="status" className="text-sm text-ink2">
                Cargando propinas del día…
              </p>
            )}
            {tipState.status === 'idle' && (
              <p role="status" className="text-sm text-ink2">
                Selecciona una fecha válida para consultar las propinas.
              </p>
            )}
            {tipState.status === 'error' && (
              <div role="alert" className="space-y-3 text-sm text-crit">
                <p>{tipState.message}</p>
                <button
                  type="button"
                  onClick={() => setTipRevision((value) => value + 1)}
                  className={buttonClass}
                >
                  Reintentar consulta
                </button>
              </div>
            )}
            {tipState.status === 'ready' &&
              (tipOptions.length ? (
                <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
                  {tipOptions.map((option) => (
                    <li key={option.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm hover:bg-tint">
                        <input
                          type="checkbox"
                          name="tipEntryIds"
                          value={option.id}
                          checked={fields.tipEntryIds.includes(option.id)}
                          onChange={(event) =>
                            update(
                              {
                                tipEntryIds: event.target.checked
                                  ? [...fields.tipEntryIds, option.id]
                                  : fields.tipEntryIds.filter(
                                      (id) => id !== option.id,
                                    ),
                              },
                              ['tipEntryIds'],
                            )
                          }
                          className="h-5 w-5 accent-salmon-ink"
                          aria-describedby="closing-tipEntryIds-error"
                        />
                        <span className="min-w-0 flex-1">
                          {paymentMethodLabel(option.paymentMethod)}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {formatClpAmount(option.amount)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink2">
                  No hay propinas registradas para esta fecha. Si PROPINAS es
                  mayor a cero, regístralas primero en Propinas diarias.
                </p>
              ))}
            {tipState.status === 'ready' && (
              <p className="text-sm text-ink2">
                Seleccionado:{' '}
                <strong
                  className={
                    linkedTips === preview.mercadoPagoTipAmount
                      ? 'text-ink'
                      : 'text-crit'
                  }
                >
                  {formatClpAmount(linkedTips)}
                </strong>{' '}
                de {formatClpAmount(preview.mercadoPagoTipAmount)} en PROPINAS.
              </p>
            )}
            <FieldError
              id="closing-tipEntryIds-error"
              message={errors.tipEntryIds}
            />
          </Section>

          <Section
            id="closing-reason-title"
            title="Motivo y observaciones"
            description="El motivo es obligatorio cuando cualquier medio de pago o la conciliación de vouchers tiene diferencia, aunque el total se compense."
          >
            <label className={labelClass}>
              Motivo de la diferencia{' '}
              <span className="font-normal">
                {reasonRequired ? '(obligatorio)' : '(si hay diferencias)'}
              </span>
              <textarea
                name="differenceReason"
                rows={3}
                maxLength={MAX_REASON_LENGTH}
                value={fields.differenceReason}
                onChange={(event) =>
                  update({ differenceReason: event.target.value }, [
                    'differenceReason',
                  ])
                }
                className={`${inputClass} mt-2 h-auto py-2`}
                aria-invalid={Boolean(errors.differenceReason)}
                aria-describedby="closing-differenceReason-error"
              />
              <FieldError
                id="closing-differenceReason-error"
                message={errors.differenceReason}
              />
            </label>
            <label className={labelClass}>
              Observaciones <span className="font-normal">(opcional)</span>
              <textarea
                name="notes"
                rows={2}
                maxLength={MAX_NOTES_LENGTH}
                value={fields.notes}
                onChange={(event) =>
                  update({ notes: event.target.value }, ['notes'])
                }
                className={`${inputClass} mt-2 h-auto py-2`}
                aria-invalid={Boolean(errors.notes)}
                aria-describedby="closing-notes-error"
              />
              <FieldError id="closing-notes-error" message={errors.notes} />
            </label>
          </Section>

          {Object.values(errors).some(Boolean) && (
            <p role="alert" className="text-sm text-crit">
              Corrige los campos indicados antes de continuar.
            </p>
          )}
          {failure && (
            <div
              role="alert"
              className="space-y-3 rounded-lg border border-crit/20 bg-crit-bg px-3.5 py-3 text-sm text-crit"
            >
              <p>{failure.message || closingErrorMessage(failure.status)}</p>
              {failure.existingClosingId && (
                <button
                  type="button"
                  onClick={() =>
                    setExistingId(failure.existingClosingId ?? null)
                  }
                  className={buttonClass}
                >
                  Ver cierre existente
                </button>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={!store.isActive || tipState.status !== 'ready'}
            className={primaryButtonClass}
          >
            Revisar cierre
          </button>
        </form>
      </section>
      {existingId && (
        <ClosingDetailDialog
          closingId={existingId}
          storeName={store.name}
          onClose={() => setExistingId(null)}
        />
      )}
    </div>
  );
}
