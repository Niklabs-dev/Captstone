'use client';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import {
  STORE_FIELDS,
  STORE_LABELS,
  SUBWAY_STORE_ID_HELP,
  parseStoreInput,
  storeFieldError,
  subwayStoreIdError,
  type Store,
  type StoreInput,
  type StoreField,
} from '@/lib/stores';
import {
  buttonClass,
  dialogClass,
  dialogActionsClass,
  primaryButtonClass,
  dangerButtonClass,
  inputClass,
  labelClass,
} from '@/components/ui/styles';
export type StoreAction =
  { kind: 'create' } | { kind: 'edit' | 'state'; store: Store };
export function StoreDialog({
  action,
  busy,
  error,
  errorField,
  onClose,
  onSave,
  onState,
}: {
  action: StoreAction;
  busy: boolean;
  error: string;
  // Campo al que apunta el error del backend (p. ej. ID Subway duplicado).
  errorField?: StoreField;
  onClose: () => void;
  onSave: (input: StoreInput) => Promise<undefined>;
  onState: () => Promise<undefined>;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const [errors, setErrors] = useState<Partial<Record<StoreField, string>>>({});
  const title =
    action.kind === 'create'
      ? 'Crear local'
      : action.kind === 'edit'
        ? 'Editar local'
        : action.store.isActive
          ? 'Desactivar local'
          : 'Reactivar local';
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
    if (Object.keys(errors).length || (error && errorField))
      ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors, error, errorField]);
  const subwayInvalid = Boolean(
    errors.subwayStoreId || (error && errorField === 'subwayStoreId'),
  );
  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const values = {
      name: form.get('name'),
      city: form.get('city'),
      address: form.get('address'),
      // Siempre se envía: vacío lo deja (o lo vuelve) sin configurar.
      subwayStoreId: form.get('subwayStoreId') ?? '',
    };
    const input = parseStoreInput(values);
    if (!input) {
      const next: Partial<Record<StoreField, string>> = {};
      for (const field of STORE_FIELDS) {
        const message = storeFieldError(field, values[field]);
        if (message) next[field] = message;
      }
      const subwayMessage = subwayStoreIdError(values.subwayStoreId);
      if (subwayMessage) next.subwayStoreId = subwayMessage;
      setErrors(next);
      ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setErrors({});
    await onSave(input);
  }
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
          id="store-dialog-error"
          role="alert"
          className="mb-4 rounded-lg bg-crit-bg p-3 text-sm text-crit"
        >
          {error}
        </p>
      )}
      {action.kind === 'state' ? (
        <>
          <p className="break-words text-sm text-ink2">
            {action.store.isActive
              ? 'El local dejará de estar disponible para nuevas asignaciones. Primero debes desactivar sus usuarios activos desde Usuarios. Los usuarios, documentos y registros históricos se conservarán.'
              : 'El local volverá a estar disponible para nuevas asignaciones.'}
          </p>
          <p className="mt-3 break-words text-sm font-semibold">
            {action.store.name}
          </p>
          <div className={`mt-6 ${dialogActionsClass}`}>
            <button disabled={busy} onClick={onClose} className={buttonClass}>
              Cancelar
            </button>
            <button
              disabled={busy}
              onClick={onState}
              className={
                action.store.isActive ? dangerButtonClass : primaryButtonClass
              }
            >
              {busy
                ? 'Guardando…'
                : action.store.isActive
                  ? 'Confirmar desactivación'
                  : 'Confirmar reactivación'}
            </button>
          </div>
        </>
      ) : (
        <form noValidate onSubmit={submit} className="space-y-4">
          {STORE_FIELDS.map((field) => (
            <div key={field}>
              <label htmlFor={'store-' + field} className={labelClass}>
                {STORE_LABELS[field]}
              </label>
              <input
                id={'store-' + field}
                name={field}
                required
                maxLength={field === 'address' ? 200 : 100}
                disabled={busy}
                defaultValue={action.kind === 'edit' ? action.store[field] : ''}
                aria-invalid={Boolean(
                  errors[field] || (error && errorField === field),
                )}
                aria-describedby={
                  errors[field]
                    ? 'store-error-' + field
                    : error && errorField === field
                      ? 'store-dialog-error'
                      : undefined
                }
                className={`${inputClass} mt-2`}
              />
              {errors[field] && (
                <p
                  id={'store-error-' + field}
                  className="mt-2 text-xs text-crit"
                >
                  {errors[field]}
                </p>
              )}
            </div>
          ))}
          <div>
            <label htmlFor="store-subwayStoreId" className={labelClass}>
              {STORE_LABELS.subwayStoreId}{' '}
              <span className="font-normal text-muted">(opcional)</span>
            </label>
            <input
              id="store-subwayStoreId"
              name="subwayStoreId"
              inputMode="numeric"
              autoComplete="off"
              maxLength={20}
              placeholder="Ej. 72597"
              disabled={busy}
              defaultValue={
                action.kind === 'edit' ? (action.store.subwayStoreId ?? '') : ''
              }
              aria-invalid={subwayInvalid}
              aria-describedby={[
                'store-help-subwayStoreId',
                errors.subwayStoreId
                  ? 'store-error-subwayStoreId'
                  : subwayInvalid
                    ? 'store-dialog-error'
                    : '',
              ]
                .filter(Boolean)
                .join(' ')}
              className={`${inputClass} mt-2 font-mono`}
            />
            <p id="store-help-subwayStoreId" className="mt-2 text-xs text-ink2">
              {SUBWAY_STORE_ID_HELP}
            </p>
            {errors.subwayStoreId && (
              <p
                id="store-error-subwayStoreId"
                className="mt-2 text-xs text-crit"
              >
                {errors.subwayStoreId}
              </p>
            )}
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
              {busy ? 'Guardando…' : 'Guardar local'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
