'use client';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import {
  alertClass,
  buttonClass,
  dangerButtonClass,
  dialogActionsClass,
  dialogClass,
  inputClass,
  labelClass,
  primaryButtonClass,
} from '@/components/ui/styles';
import {
  EMPTY_ROW_TEXT,
  TEMPLATE_TEXT_MAX,
  templateRowTextFromForm,
  type Product,
  type TemplateRowSummary,
} from '@/lib/products';

export type TemplateRowAction =
  | { kind: 'text'; row: TemplateRowSummary }
  | { kind: 'release'; product: Product };

// Acciones sobre las filas de la plantilla (SPRINT-5-T15): corregir el texto
// de una fila de artículo sin producto y liberar, con confirmación, la fila de
// un producto desactivado. Los errores de la API van junto al campo o en la
// confirmación y lo escrito se conserva.
export function TemplateRowDialog({
  action,
  busy,
  error,
  fieldError,
  onClose,
  onSaveText,
  onRelease,
}: {
  action: TemplateRowAction;
  busy: boolean;
  error: string;
  fieldError: string;
  onClose: () => undefined;
  onSaveText: (printedText: string) => Promise<undefined>;
  onRelease: () => Promise<undefined>;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(
    action.kind === 'text' ? (action.row.printedText ?? '') : '',
  );
  const [clientError, setClientError] = useState('');
  const textError = clientError || fieldError;
  const title =
    action.kind === 'text' ? 'Corregir texto de la fila' : 'Liberar fila';

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
    if (fieldError) inputRef.current?.focus();
  }, [fieldError]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (busy || action.kind !== 'text') return;
    const result = templateRowTextFromForm(text, action.row.printedText);
    if ('error' in result) {
      setClientError(result.error);
      inputRef.current?.focus();
      return;
    }
    setClientError('');
    await onSaveText(result.printedText);
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
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className={buttonClass}
          aria-label="Cerrar ventana"
        >
          ×
        </button>
      </div>

      {action.kind === 'release' ? (
        <div className="mt-4 space-y-4 text-sm">
          <p>
            La fila {action.product.templatePosition ?? '—'} de «
            {action.product.section ?? 'su sección'}» quedará libre para otro
            producto.
          </p>
          <p>
            «{action.product.name}» seguirá en el catálogo, en «Sin fila en la
            plantilla», y sus tomas finalizadas no cambian. Para volver a
            activarlo tendrás que moverlo a una fila libre.
          </p>
          {error && (
            <p role="alert" className={alertClass}>
              {error}
            </p>
          )}
          <div className={dialogActionsClass}>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className={buttonClass}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRelease()}
              className={dangerButtonClass}
            >
              {busy ? 'Liberando…' : 'Liberar fila'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <p className="text-sm text-ink2">
            Fila {action.row.position} de «{action.row.section}». La posición de
            la fila no cambia.
          </p>
          <div className="min-w-0">
            <label htmlFor="template-row-text" className={labelClass}>
              Texto de la fila (columna ARTÍCULO)
            </label>
            <input
              ref={inputRef}
              id="template-row-text"
              className={`${inputClass} mt-2`}
              value={text}
              maxLength={TEMPLATE_TEXT_MAX}
              onChange={(event) => {
                setText(event.target.value);
                setClientError('');
              }}
              aria-invalid={Boolean(textError)}
              aria-describedby={[
                'template-row-text-help',
                textError ? 'template-row-text-error' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            />
            <p id="template-row-text-help" className="mt-1 text-xs text-ink2">
              Escribe {EMPTY_ROW_TEXT} para dejarla como fila libre.
            </p>
            {textError && (
              <p
                id="template-row-text-error"
                className="mt-1 text-xs text-crit"
              >
                {textError}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className={alertClass}>
              {error}
            </p>
          )}
          <div className={dialogActionsClass}>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className={buttonClass}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className={primaryButtonClass}
            >
              {busy ? 'Guardando…' : 'Guardar texto'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
