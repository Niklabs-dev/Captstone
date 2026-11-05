'use client';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import {
  PAYMENT_METHOD_BEHAVIORS,
  PAYMENT_METHOD_BEHAVIOR_LABELS,
  PAYMENT_METHOD_FIELD_LABELS,
  PAYMENT_METHOD_SORT_MAX,
  isPaymentMethodBehavior,
  normalizePaymentMethodCode,
  parsePaymentMethodCreateInput,
  parsePaymentMethodSortOrder,
  parsePaymentMethodUpdateInput,
  paymentMethodCodeError,
  paymentMethodNameError,
  paymentMethodSortOrderError,
  type PaymentMethod,
  type PaymentMethodCreateInput,
  type PaymentMethodField,
  type PaymentMethodUpdateInput,
} from '@/lib/payment-methods';
import {
  buttonClass,
  dialogClass,
  dialogActionsClass,
  primaryButtonClass,
  dangerButtonClass,
  inputClass,
  labelClass,
} from '@/components/ui/styles';

export type PaymentMethodAction =
  { kind: 'create' } | { kind: 'edit' | 'state'; method: PaymentMethod };

type FieldErrors = Partial<Record<PaymentMethodField, string>>;

function booleanFieldError(value: unknown): string | null {
  return value === 'true' || value === 'false'
    ? null
    : 'Selecciona una opción.';
}
function behaviorFieldError(value: unknown): string | null {
  return isPaymentMethodBehavior(value)
    ? null
    : 'Selecciona un comportamiento.';
}
export function PaymentMethodDialog({
  action,
  busy,
  error,
  onClose,
  onSave,
  onState,
}: {
  action: PaymentMethodAction;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (
    input: PaymentMethodCreateInput | PaymentMethodUpdateInput,
  ) => Promise<undefined>;
  onState: () => Promise<undefined>;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const title =
    action.kind === 'create'
      ? 'Crear medio de pago'
      : action.kind === 'edit'
        ? 'Editar medio de pago'
        : action.method.isActive
          ? 'Desactivar medio de pago'
          : 'Reactivar medio de pago';
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  useEffect(() => {
    if (Object.keys(errors).length)
      ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const next: FieldErrors = {};
    const failures: [PaymentMethodField, string | null][] = [
      ['name', paymentMethodNameError(form.get('name'))],
      ['sortOrder', paymentMethodSortOrderError(form.get('sortOrder'))],
      ['behavior', behaviorFieldError(form.get('behavior'))],
      ['availableForTips', booleanFieldError(form.get('availableForTips'))],
    ];
    if (action.kind === 'create')
      failures.push(['code', paymentMethodCodeError(form.get('code'))]);
    for (const [field, message] of failures) if (message) next[field] = message;
    if (Object.keys(next).length) {
      setErrors(next);
      ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setErrors({});
    const raw = {
      ...(action.kind === 'create'
        ? { code: normalizePaymentMethodCode(String(form.get('code'))) }
        : {}),
      name: String(form.get('name')).trim(),
      sortOrder: parsePaymentMethodSortOrder(form.get('sortOrder')),
      behavior: form.get('behavior'),
      availableForTips: form.get('availableForTips') === 'true',
    };
    const input =
      action.kind === 'create'
        ? parsePaymentMethodCreateInput(raw)
        : parsePaymentMethodUpdateInput(raw);
    if (!input) return;
    await onSave(input);
  }
  const editing = action.kind === 'edit' ? action.method : null;
  return (
    <dialog
      ref={ref}
      aria-label={title}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className={dialogClass}
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          aria-label="Cerrar ventana"
          className={buttonClass}
        >
          ×
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-crit-bg p-3 text-sm text-crit"
        >
          {error}
        </p>
      )}
      {action.kind === 'state' ? (
        <>
          <p className="break-words text-sm text-ink2">
            {action.method.isActive
              ? 'El medio dejará de admitir registros nuevos en ventas, propinas y cierres de caja. Su historial se conserva y seguirá visible en los reportes.'
              : 'El medio volverá a estar disponible para registros nuevos en ventas, propinas y cierres de caja.'}
          </p>
          <p className="mt-3 break-words text-sm font-semibold">
            {action.method.name}{' '}
            <span className="font-mono text-xs text-muted">
              {action.method.code}
            </span>
          </p>
          <div className={`mt-6 ${dialogActionsClass}`}>
            <button disabled={busy} onClick={onClose} className={buttonClass}>
              Cancelar
            </button>
            <button
              disabled={busy}
              onClick={onState}
              className={
                action.method.isActive ? dangerButtonClass : primaryButtonClass
              }
            >
              {busy
                ? 'Guardando…'
                : action.method.isActive
                  ? 'Confirmar desactivación'
                  : 'Confirmar reactivación'}
            </button>
          </div>
        </>
      ) : (
        <form noValidate onSubmit={submit} className="space-y-4">
          {action.kind === 'create' && (
            <div>
              <label htmlFor="payment-method-code" className={labelClass}>
                {PAYMENT_METHOD_FIELD_LABELS.code}
              </label>
              <input
                id="payment-method-code"
                name="code"
                required
                maxLength={40}
                autoComplete="off"
                placeholder="Ej. JUNEB"
                disabled={busy}
                aria-invalid={Boolean(errors.code)}
                aria-describedby={
                  errors.code ? 'payment-method-error-code' : undefined
                }
                className={`${inputClass} mt-2`}
              />
              <p className="mt-2 text-xs leading-5 text-ink2">
                Código estable que identifica el medio en ventas, propinas y
                cierres. No se puede cambiar después de crearlo.
              </p>
              {errors.code && (
                <p
                  id="payment-method-error-code"
                  className="mt-2 text-xs text-crit"
                >
                  {errors.code}
                </p>
              )}
            </div>
          )}
          {editing && (
            <p className="break-words text-sm text-ink2">
              Código:{' '}
              <span className="font-mono text-xs text-muted">
                {editing.code}
              </span>{' '}
              (no editable)
            </p>
          )}
          <div>
            <label htmlFor="payment-method-name" className={labelClass}>
              {PAYMENT_METHOD_FIELD_LABELS.name}
            </label>
            <input
              id="payment-method-name"
              name="name"
              required
              maxLength={100}
              disabled={busy}
              defaultValue={editing ? editing.name : ''}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={
                errors.name ? 'payment-method-error-name' : undefined
              }
              className={`${inputClass} mt-2`}
            />
            {errors.name && (
              <p
                id="payment-method-error-name"
                className="mt-2 text-xs text-crit"
              >
                {errors.name}
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="payment-method-sort" className={labelClass}>
                {PAYMENT_METHOD_FIELD_LABELS.sortOrder}
              </label>
              <input
                id="payment-method-sort"
                name="sortOrder"
                type="number"
                min={0}
                max={PAYMENT_METHOD_SORT_MAX}
                step={1}
                inputMode="numeric"
                required
                disabled={busy}
                defaultValue={editing ? editing.sortOrder : 0}
                aria-invalid={Boolean(errors.sortOrder)}
                aria-describedby={
                  errors.sortOrder
                    ? 'payment-method-error-sortOrder'
                    : undefined
                }
                className={`${inputClass} mt-2`}
              />
              {errors.sortOrder && (
                <p
                  id="payment-method-error-sortOrder"
                  className="mt-2 text-xs text-crit"
                >
                  {errors.sortOrder}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="payment-method-behavior" className={labelClass}>
                {PAYMENT_METHOD_FIELD_LABELS.behavior}
              </label>
              <select
                id="payment-method-behavior"
                name="behavior"
                required
                disabled={busy}
                defaultValue={editing ? editing.behavior : ''}
                aria-invalid={Boolean(errors.behavior)}
                aria-describedby={
                  errors.behavior ? 'payment-method-error-behavior' : undefined
                }
                className={`${inputClass} mt-2`}
              >
                <option value="">Selecciona un comportamiento</option>
                {PAYMENT_METHOD_BEHAVIORS.map((behavior) => (
                  <option key={behavior} value={behavior}>
                    {PAYMENT_METHOD_BEHAVIOR_LABELS[behavior]}
                  </option>
                ))}
              </select>
              {errors.behavior && (
                <p
                  id="payment-method-error-behavior"
                  className="mt-2 text-xs text-crit"
                >
                  {errors.behavior}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="payment-method-tips" className={labelClass}>
                {PAYMENT_METHOD_FIELD_LABELS.availableForTips}
              </label>
              <select
                id="payment-method-tips"
                name="availableForTips"
                required
                disabled={busy}
                defaultValue={editing ? String(editing.availableForTips) : ''}
                aria-invalid={Boolean(errors.availableForTips)}
                aria-describedby={
                  errors.availableForTips
                    ? 'payment-method-error-availableForTips'
                    : undefined
                }
                className={`${inputClass} mt-2`}
              >
                <option value="">Selecciona una opción</option>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
              {errors.availableForTips && (
                <p
                  id="payment-method-error-availableForTips"
                  className="mt-2 text-xs text-crit"
                >
                  {errors.availableForTips}
                </p>
              )}
            </div>
          </div>
          <div className={dialogActionsClass}>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className={buttonClass}
            >
              Cancelar
            </button>
            <button disabled={busy} className={primaryButtonClass}>
              {busy
                ? 'Guardando…'
                : action.kind === 'create'
                  ? 'Guardar medio'
                  : 'Guardar cambios'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
