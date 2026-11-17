'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import {
  alertClass,
  buttonClass,
  dialogActionsClass,
  dialogClass,
  infoNoticeClass,
  primaryButtonClass,
} from '@/components/ui/styles';
import { formatCalendarDate } from '@/lib/display-date';
import type { CountItem } from '@/lib/inventory-count-contract';

// Confirmación de «Finalizar inventario» (SPRINT-5-T07): muestra cuántos
// productos se contaron y cuáles quedan sin contar antes de bloquear la toma.
export function FinalizeCountDialog({
  countDate,
  storeName,
  items,
  unsaved,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  countDate: string;
  storeName: string;
  items: readonly CountItem[];
  unsaved: number;
  busy: boolean;
  error: string;
  onClose: () => undefined;
  onConfirm: () => Promise<undefined>;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const counted = items.filter((item) => item.counted).length;
  const pending = items.filter((item) => !item.counted);

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

  return (
    <dialog
      ref={ref}
      aria-label="Finalizar inventario"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className={dialogClass}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold">Finalizar inventario</h2>
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
      <div className="mt-4 space-y-4 text-sm">
        <p>
          Toma del{' '}
          <span className="font-mono">{formatCalendarDate(countDate)}</span> de{' '}
          {storeName}. Al finalizar queda en solo lectura y ya no se pueden
          cambiar sus cantidades.
        </p>
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-line p-3">
            <dt className="text-xs font-semibold text-ink2">Contados</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums">{counted}</dd>
          </div>
          <div className="rounded-xl border border-line p-3">
            <dt className="text-xs font-semibold text-ink2">Sin contar</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums">
              {pending.length}
            </dd>
          </div>
        </dl>
        {pending.length > 0 && (
          <details className="rounded-xl border border-line p-3">
            <summary className="min-h-11 cursor-pointer content-center font-semibold text-salmon-ink">
              Ver los productos sin contar
            </summary>
            <p className="mt-2 text-xs text-ink2">
              Quedan en la toma sin cantidades.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink2">
              {pending.map((item) => (
                <li key={item.product.id} className="break-words">
                  {item.product.name}
                </li>
              ))}
            </ul>
          </details>
        )}
        {unsaved > 0 && (
          <p className={infoNoticeClass}>
            {unsaved === 1
              ? 'Hay 1 producto con cambios sin guardar: si finalizas ahora, esos cambios no se incluyen.'
              : `Hay ${unsaved} productos con cambios sin guardar: si finalizas ahora, esos cambios no se incluyen.`}
          </p>
        )}
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
            onClick={() => void onConfirm()}
            className={primaryButtonClass}
          >
            {busy ? 'Finalizando…' : 'Confirmar y finalizar'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
