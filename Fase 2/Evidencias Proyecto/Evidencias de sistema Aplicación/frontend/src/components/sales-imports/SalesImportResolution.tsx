'use client';

import type { ReactElement } from 'react';
import { inputClass, labelClass } from '@/components/ui/styles';
import {
  chosenStore,
  pendingLines,
  SKIP_LINE,
  storeRememberBlock,
  type LineChoice,
  type ResolutionChoices,
  type SalesImportPreview,
} from '@/lib/sales-imports';
import { formatClp } from '@/lib/tips';

// SPRINT-4A-T19: selectores para lo que la vista previa no identificó. El
// sistema no adivina: el administrador elige el local activo y el medio de
// cada línea sin alias (u «Omitir» si su monto es 0). «Recordar para
// próximas cargas» viene marcado y se deshabilita cuando no se puede.

const checkboxRowClass =
  'mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink2';
const checkboxClass = 'h-5 w-5 shrink-0 accent-salmon-ink';

export function SalesImportResolution({
  preview,
  choices,
  disabled,
  onStoreChange,
  onRememberStoreChange,
  onLineChange,
}: {
  preview: SalesImportPreview;
  choices: ResolutionChoices;
  disabled: boolean;
  onStoreChange: (storeId: string) => undefined;
  onRememberStoreChange: (remember: boolean) => undefined;
  onLineChange: (lineNumber: number, next: LineChoice) => undefined;
}): ReactElement {
  const options = preview.resolutionOptions;
  const store = chosenStore(preview, choices);
  const storeBlock = storeRememberBlock(preview, store);
  const lines = pendingLines(preview);
  return (
    <fieldset className="min-w-0 space-y-4 rounded-lg border border-line bg-tint p-4">
      <legend className="px-1 text-sm font-semibold">
        Elige los datos que no se identificaron
      </legend>
      {preview.store === null && (
        <div className="min-w-0">
          <label className={labelClass}>
            Local del archivo
            {preview.subwayStoreId
              ? ` (ID Subway ${preview.subwayStoreId})`
              : ` («${preview.externalStoreCode}»)`}
            <select
              value={choices.storeId}
              disabled={disabled}
              onChange={(event) => onStoreChange(event.target.value)}
              className={`${inputClass} mt-2`}
            >
              <option value="">Selecciona un local activo</option>
              {options?.stores.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.subwayStoreId
                    ? ` · ID Subway ${option.subwayStoreId}`
                    : ''}
                </option>
              ))}
            </select>
          </label>
          {options?.stores.length === 0 && (
            <p className="mt-2 text-sm text-crit">
              No hay locales activos. Activa un local en la administración de
              locales y vuelve a subir el archivo.
            </p>
          )}
          <label className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={choices.rememberStore && storeBlock === null}
              disabled={disabled || storeBlock !== null}
              onChange={(event) => onRememberStoreChange(event.target.checked)}
              className={checkboxClass}
              aria-describedby={storeBlock ? 'store-remember-help' : undefined}
            />
            <span>
              Recordar para próximas cargas
              {preview.subwayStoreId && storeBlock === null
                ? ` (asigna el ID Subway ${preview.subwayStoreId} al local)`
                : ''}
            </span>
          </label>
          {storeBlock && (
            <p id="store-remember-help" className="text-xs text-muted">
              {storeBlock}
            </p>
          )}
        </div>
      )}
      {lines.map((line) => {
        const current = choices.lines[line.lineNumber] ?? {
          choice: '',
          remember: true,
        };
        const skipped = current.choice === SKIP_LINE;
        return (
          <div key={line.lineNumber} className="min-w-0">
            <label className={labelClass}>
              Medio de pago para «{line.originalLabel}» (
              {formatClp(line.amount)})
              <select
                value={current.choice}
                disabled={disabled}
                onChange={(event) =>
                  onLineChange(line.lineNumber, {
                    ...current,
                    choice: event.target.value,
                  })
                }
                className={`${inputClass} mt-2`}
              >
                <option value="">Selecciona un medio de pago</option>
                {options?.paymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
                {line.amount === 0 && (
                  <option value={SKIP_LINE}>Omitir (monto 0)</option>
                )}
              </select>
            </label>
            <label className={checkboxRowClass}>
              <input
                type="checkbox"
                checked={current.remember && !skipped}
                disabled={disabled || skipped}
                onChange={(event) =>
                  onLineChange(line.lineNumber, {
                    ...current,
                    remember: event.target.checked,
                  })
                }
                className={checkboxClass}
              />
              <span>
                Recordar para próximas cargas
                {skipped ? ' (una línea omitida no se recuerda)' : ''}
              </span>
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}
