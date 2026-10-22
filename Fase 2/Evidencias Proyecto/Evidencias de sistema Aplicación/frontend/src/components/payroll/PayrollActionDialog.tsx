'use client';
import {
  labelClass,
  buttonClass,
  inputClass,
  primaryButtonClass,
} from '@/components/ui/styles';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import {
  payrollFileHash,
  payrollPeriodLabel,
  payrollBusinessDate,
  validatePayrollSignedAt,
  validatePayrollUpload,
  type Payroll,
  type PayrollCollection,
} from '@/lib/payroll';
import { publishPayroll, uploadPayroll } from '@/lib/payroll-client';

export type PayrollAction =
  | { kind: 'upload'; collection: PayrollCollection }
  | { kind: 'publish'; record: Payroll };
export function PayrollActionDialog({
  action,
  onClose,
  onSaved,
}: {
  action: PayrollAction;
  onClose: () => void;
  onSaved: (record: Payroll, published: boolean) => void;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
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
    if (busy) return;
    const form = new FormData(event.currentTarget);
    let file: File | null = null;
    if (action.kind === 'upload') {
      const candidate = form.get('file');
      file = candidate instanceof File ? candidate : null;
      const message = validatePayrollUpload(
        String(form.get('workerId')),
        String(form.get('period')),
        file,
        action.collection,
      );
      if (message) {
        setError(message);
        return;
      }
    } else {
      if (!confirmed) return;
      const message = validatePayrollSignedAt(
        String(form.get('signedAt')),
        action.record,
      );
      if (message) {
        setError(message);
        return;
      }
    }
    setError('');
    setBusy(true);
    try {
      if (action.kind === 'upload' && file) {
        const hash = await payrollFileHash(file);
        const result = await uploadPayroll(form, hash);
        const person = action.collection.workers.find(
          (worker) => worker.id === result.worker.id,
        );
        if (
          !person ||
          person.store.id !== result.worker.store.id ||
          action.collection.items.some((item) => item.id === result.id)
        )
          throw new Error(
            'La respuesta del servicio no pudo verificarse. Actualiza el listado.',
          );
        onSaved(result, false);
      } else if (action.kind === 'publish')
        onSaved(
          await publishPayroll(action.record, String(form.get('signedAt'))),
          true,
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo completar la operación.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="payroll-action-title"
      aria-label={
        action.kind === 'upload' ? 'Subir liquidación' : 'Confirmar publicación'
      }
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-line bg-bg p-6 text-ink shadow-xl backdrop:bg-ink/35"
    >
      <form onSubmit={submit} className="space-y-5">
        <button
          type="button"
          aria-label="Cerrar ventana"
          disabled={busy}
          onClick={onClose}
          className={`${buttonClass} float-right ml-3`}
        >
          ×
        </button>
        <h2 id="payroll-action-title" className="text-lg font-bold">
          {action.kind === 'upload'
            ? 'Subir liquidación'
            : 'Confirmar publicación'}
        </h2>
        {action.kind === 'upload' ? (
          <>
            <p className="text-sm leading-6 text-ink2">
              La liquidación quedará pendiente de firma y no será visible para
              el trabajador hasta que confirmes su publicación.
            </p>
            <label className={labelClass}>
              Trabajador
              <select
                name="workerId"
                aria-label="Trabajador"
                required
                defaultValue=""
                disabled={busy}
                className={`${inputClass} mt-2`}
              >
                <option value="" disabled>
                  Selecciona un trabajador activo
                </option>
                {action.collection.workers
                  .filter((worker) => worker.isActive)
                  .map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.name} · {worker.store.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={labelClass}>
              Período
              <input
                aria-describedby="payroll-period-help"
                name="period"
                type="month"
                min="1900-01"
                max={payrollBusinessDate().slice(0, 7)}
                required
                disabled={busy}
                className={`${inputClass} mt-2`}
              />
            </label>
            <p id="payroll-period-help" className="text-xs text-ink2">
              Selecciona el mes actual o uno anterior (hora de Chile).
            </p>
            <label className={labelClass}>
              Archivo PDF
              <input
                name="file"
                type="file"
                accept="application/pdf,.pdf"
                required
                disabled={busy}
                aria-describedby="payroll-file-help"
                className={`${inputClass} mt-2`}
              />
            </label>
            <p id="payroll-file-help" className="text-xs leading-5 text-ink2">
              PDF · Máximo{' '}
              {(action.collection.policy.maxBytes / 1024 / 1024).toLocaleString(
                'es-CL',
              )}{' '}
              MiB. Se calculará SHA-256 antes de la carga.
            </p>
          </>
        ) : (
          <>
            <dl className="space-y-3 rounded-lg border border-line bg-tint p-4 text-sm">
              <div>
                <dt className="text-xs text-ink2">Trabajador</dt>
                <dd className="break-words font-semibold">
                  {action.record.worker.name}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink2">Local</dt>
                <dd>{action.record.worker.store.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink2">Período</dt>
                <dd>{payrollPeriodLabel(action.record.period)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink2">Archivo</dt>
                <dd className="break-words">{action.record.fileName}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink2">SHA-256 registrado</dt>
                <dd className="mt-2 break-all font-mono text-xs">
                  {action.record.sha256}
                </dd>
              </div>
            </dl>
            <p className="text-sm leading-6 text-ink2">
              Al publicar, esta liquidación quedará visible para su trabajador.
              Una liquidación publicada no se puede editar ni eliminar.
            </p>
            <label className={labelClass}>
              Fecha de firma
              <input
                name="signedAt"
                type="date"
                required
                disabled={busy}
                defaultValue={payrollBusinessDate()}
                min={payrollBusinessDate(new Date(action.record.createdAt))}
                max={payrollBusinessDate()}
                className={`${inputClass} mt-2`}
              />
            </label>
            <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-2 h-5 w-5 shrink-0 accent-salmon-ink"
              />
              Confirmo que revisé el trabajador, período y archivo y que la
              liquidación está lista para publicar.
            </label>
          </>
        )}
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
            disabled={busy || (action.kind === 'publish' && !confirmed)}
            className={primaryButtonClass}
          >
            {busy
              ? 'Guardando…'
              : action.kind === 'upload'
                ? 'Guardar pendiente de firma'
                : 'Publicar liquidación'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
