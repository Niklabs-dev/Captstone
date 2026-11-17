'use client';

import { memo, type FormEvent, type ReactElement } from 'react';
import {
  alertClass,
  badgeClass,
  buttonClass,
  inputClass,
  labelClass,
  primaryButtonClass,
} from '@/components/ui/styles';
import {
  countFields,
  countFormatLabel,
  draftFromLine,
  formatChileTime,
  formatCountQuantity,
  isDraftDirty,
  lineSummary,
  liveCountTotal,
  type CountDraft,
  type CountFieldErrors,
  type CountItem,
} from '@/lib/inventory-count';

export type SaveState =
  | { status: 'saving' }
  | { status: 'error'; message: string; fieldErrors: CountFieldErrors };

type DraftField = keyof CountDraft;

// Un producto de la toma (SPRINT-5-T07): su formato, solo los campos que le
// aplican, el total en vivo y su propio guardado. En una toma finalizada
// muestra lo guardado en solo lectura.
function CountItemCardBase({
  item,
  draft,
  saveState,
  readOnly,
  onChange,
  onSave,
}: {
  item: CountItem;
  draft: CountDraft | undefined;
  saveState: SaveState | undefined;
  readOnly: boolean;
  onChange: (
    productId: string,
    draft: CountDraft,
    field: DraftField,
  ) => undefined;
  onSave: (productId: string) => Promise<undefined>;
}): ReactElement {
  const { product, line } = item;
  const name = readOnly && line ? line.productName : product.name;
  // En solo lectura vale la copia del formato con que se guardó la línea.
  const format = readOnly && line ? line : product;
  const sku = readOnly && line ? line.productSku : product.sku;
  const fields = countFields(format);
  const values = draft ?? draftFromLine(line);
  const dirty = !readOnly && isDraftDirty(product, values, line);
  const saving = saveState?.status === 'saving';
  const error = saveState?.status === 'error' ? saveState : null;
  // Sin errores por campo, el fallo fue de la red o del servicio: se reintenta.
  const retry = error !== null && Object.keys(error.fieldErrors).length === 0;
  const live = readOnly ? null : liveCountTotal(product, values);
  const total =
    live ?? (!dirty && line?.countedQuantity ? line.countedQuantity : null);
  const id = `count-${product.id}`;

  function change(field: DraftField, value: string): undefined {
    onChange(product.id, { ...values, [field]: value }, field);
  }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (!saving) await onSave(product.id);
  }

  const status = item.counted ? (
    <span className={`${badgeClass} bg-ok-bg text-ok`}>Contado</span>
  ) : (
    <span className={`${badgeClass} bg-tint2 text-ink2`}>Sin contar</span>
  );

  function field(
    key: DraftField,
    label: string,
    inputMode: 'decimal' | 'numeric',
  ): ReactElement {
    const fieldError = error?.fieldErrors[key];
    return (
      <div className="flex min-w-0 flex-col justify-end">
        <label htmlFor={`${id}-${key}`} className={labelClass}>
          {label}
        </label>
        <input
          id={`${id}-${key}`}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          enterKeyHint="done"
          className={`${inputClass} mt-2 tabular-nums`}
          value={values[key]}
          disabled={saving}
          onChange={(event) => change(key, event.target.value)}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? `${id}-${key}-error` : undefined}
        />
        {fieldError && (
          <p id={`${id}-${key}-error`} className="mt-1 text-xs text-crit">
            {fieldError}
          </p>
        )}
      </div>
    );
  }

  return (
    <li>
      <article
        aria-label={name}
        aria-busy={saving}
        className="grid gap-3 p-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-6"
      >
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 break-words text-sm font-bold">{name}</h3>
            <span className="shrink-0">{status}</span>
          </div>
          <p className="mt-1 break-words text-xs text-ink2">
            {countFormatLabel(format)}
            {sku ? ` · SKU ${sku}` : ''}
          </p>
          {!readOnly && product.alternativeNames.length > 0 && (
            <p className="mt-1 break-words text-xs text-muted">
              También: {product.alternativeNames.join(', ')}
            </p>
          )}
        </div>

        {readOnly ? (
          <div className="min-w-0 text-sm lg:text-right">
            {line && line.countedQuantity !== null ? (
              <>
                <p className="text-ink2">{lineSummary(line)}</p>
                <p className="mt-1">
                  Total{' '}
                  <strong className="tabular-nums">
                    {formatCountQuantity(line.countedQuantity, line.unit)}
                  </strong>
                </p>
              </>
            ) : (
              <p className="text-ink2">Sin cantidades</p>
            )}
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="min-w-0 space-y-3">
            <div className="grid grid-cols-3 items-end gap-2 sm:gap-3">
              {fields.boxes && field('boxes', 'Cajas', 'numeric')}
              {fields.packages &&
                field('packages', fields.packagesLabel, 'numeric')}
              {field('looseQuantity', fields.looseLabel, fields.looseInputMode)}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm" aria-live="polite">
                Total{' '}
                <strong className="tabular-nums">
                  {total === null
                    ? '—'
                    : formatCountQuantity(total, product.unit)}
                </strong>
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {saving ? (
                  <span role="status" className="text-xs text-ink2">
                    Guardando…
                  </span>
                ) : dirty ? (
                  <span className={`${badgeClass} bg-warn-bg text-warn`}>
                    Sin guardar
                  </span>
                ) : (
                  line &&
                  item.counted && (
                    <span className="text-xs text-ink2">
                      Guardado {formatChileTime(line.savedAt)}
                    </span>
                  )
                )}
                <button
                  type="submit"
                  disabled={saving || (!dirty && item.counted)}
                  aria-label={`${retry ? 'Reintentar guardar' : 'Guardar'} ${name}`}
                  className={dirty || error ? primaryButtonClass : buttonClass}
                >
                  {saving ? 'Guardando…' : retry ? 'Reintentar' : 'Guardar'}
                </button>
              </div>
            </div>
            {error && (
              <p role="alert" className={alertClass}>
                {error.message}
              </p>
            )}
          </form>
        )}
      </article>
    </li>
  );
}

export const CountItemCard = memo(CountItemCardBase);
