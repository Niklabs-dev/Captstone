'use client';

import type { ReactElement } from 'react';
import { inputClass, labelClass } from '@/components/ui/styles';
import { PAYMENT_METHOD_NAME_MAX } from '@/lib/payment-methods';
import {
  chosenStore,
  CREATE_METHOD,
  newMethodNameError,
  normalizeMethodName,
  pendingLines,
  storeRememberBlock,
  type LineChoice,
  type ResolutionChoices,
  type SalesImportPreview,
} from '@/lib/sales-imports';
import { formatClp } from '@/lib/tips';

// SPRINT-4A-T19: selectores para lo que la vista previa no identificó. El
// sistema no adivina: el administrador elige el local activo y el medio de
// cada línea pendiente. «Recordar para próximas cargas» viene marcado y se
// deshabilita cuando no se puede. SPRINT-4A-T21: las líneas en 0 sin alias
// se omiten solas (no aparecen aquí) y cada línea con valor puede crear su
// medio con la etiqueta como nombre editable; crear siempre recuerda.

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
          name: normalizeMethodName(line.originalLabel),
        };
        const creating = current.choice === CREATE_METHOD;
        const nameError = newMethodNameError(preview, choices, line.lineNumber);
        const nameId = `new-method-name-${line.lineNumber}`;
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
                <option value={CREATE_METHOD}>
                  Crear medio de pago «{line.originalLabel}»
                </option>
              </select>
            </label>
            {creating && (
              <div className="mt-3 min-w-0">
                <label className={labelClass}>
                  Nombre del medio nuevo
                  <input
                    type="text"
                    value={current.name}
                    maxLength={PAYMENT_METHOD_NAME_MAX}
                    disabled={disabled}
                    onChange={(event) =>
                      onLineChange(line.lineNumber, {
                        ...current,
                        name: event.target.value,
                      })
                    }
                    className={`${inputClass} mt-2`}
                    aria-invalid={nameError !== null}
                    aria-describedby={`${nameId}-help`}
                  />
                </label>
                <p
                  id={`${nameId}-help`}
                  className={`mt-2 text-xs ${nameError ? 'text-crit' : 'text-muted'}`}
                >
                  {nameError ??
                    'Se crea activo, fuera de la conciliación de vouchers y sin propinas; ajústalo después en Medios de pago.'}
                </p>
              </div>
            )}
            <label className={checkboxRowClass}>
              <input
                type="checkbox"
                checked={current.remember || creating}
                disabled={disabled || creating}
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
                {creating
                  ? ' (el medio nuevo siempre recuerda la etiqueta)'
                  : ''}
              </span>
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}
