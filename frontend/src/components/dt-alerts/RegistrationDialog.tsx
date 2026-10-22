'use client';
import { buttonClass, primaryButtonClass } from '@/components/ui/styles';
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type FormEvent,
} from 'react';
import { dtDate, type DtAlert } from '@/lib/dt-alerts';
import { registerDtAlert } from '@/lib/dt-alerts-client';

export function RegistrationDialog({
  alert,
  onClose,
  onRegistered,
}: {
  alert: DtAlert;
  onClose: () => void;
  onRegistered: (alert: DtAlert) => void;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    const focus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (focus instanceof HTMLElement) focus.focus();
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      await registerDtAlert(alert);
      onRegistered(alert);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo guardar el registro.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="registration-title"
      aria-label={'Marcar como registrado en la DT'}
      aria-describedby="registration-description"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-line bg-bg p-6 text-ink shadow-xl backdrop:bg-ink/35"
    >
      <form onSubmit={submit} className="space-y-5">
        <div>
          <button
            type="button"
            aria-label="Cerrar ventana"
            disabled={busy}
            onClick={onClose}
            className={`${buttonClass} float-right ml-3`}
          >
            ×
          </button>
          <h2 id="registration-title" className="text-lg font-bold">
            Marcar como registrado en la DT
          </h2>
          <p
            id="registration-description"
            className="mt-2 text-sm leading-6 text-ink2"
          >
            Confirma esta acción únicamente después de completar el registro del
            documento en la Dirección del Trabajo.
          </p>
        </div>
        <dl className="space-y-2 rounded-lg border border-line bg-tint p-4 text-sm">
          <div>
            <dt className="text-xs text-ink2">Trabajador</dt>
            <dd className="break-words font-semibold">{alert.worker.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink2">Documento</dt>
            <dd className="break-words">{alert.contractTitle}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink2">Local</dt>
            <dd>{alert.store.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink2">Fecha límite informada</dt>
            <dd>{dtDate(alert.deadline)}</dd>
          </div>
        </dl>
        <label className="flex items-start gap-3 text-sm leading-6">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-2 h-5 w-5 shrink-0 accent-salmon-ink"
          />
          Confirmo que este documento ya fue registrado en la DT.
        </label>
        <p className="text-xs leading-5 text-ink2">
          Esta acción guarda la confirmación en el sistema; no envía el
          documento a la DT.
        </p>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-line2 bg-crit-bg p-3 text-sm"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
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
            disabled={busy || !confirmed}
            className={primaryButtonClass}
          >
            {busy ? 'Guardando…' : 'Confirmar registro'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
