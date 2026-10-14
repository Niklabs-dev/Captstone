'use client';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import {
  DOCUMENT_TYPES,
  DOCUMENT_LABELS,
  documentHash,
  validateDocumentUpload,
  type UploadPolicy,
  type WorkerDocument,
} from '@/lib/documents';
import { uploadDocument } from '@/lib/documents-client';
import { documentButton, documentInput, documentPrimary } from './styles';

export function DocumentUpload({
  workerId,
  workerName,
  previous,
  policy,
  onClose,
  onUploaded,
  onBusy,
}: {
  workerId: string;
  workerName: string;
  previous: WorkerDocument | null;
  policy: UploadPolicy;
  onClose: () => undefined;
  onUploaded: (document: WorkerDocument) => undefined;
  onBusy: (busy: boolean) => undefined;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
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
  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const candidate = data.get('file');
    const file = candidate instanceof File ? candidate : null;
    const title = previous?.title ?? String(data.get('title') ?? '');
    const type = previous?.type ?? String(data.get('type') ?? '');
    const message = validateDocumentUpload(
      { workerId, title, type, file },
      policy,
    );
    if (message || !file) {
      setError(message ?? 'Selecciona un archivo.');
      return;
    }
    setError('');
    setBusy(true);
    onBusy(true);
    try {
      const payload = new FormData();
      payload.set('workerId', workerId);
      payload.set('title', title.trim());
      payload.set('type', type);
      payload.set('file', file);
      if (previous) payload.set('documentId', previous.id);
      const hash = await documentHash(await file.arrayBuffer());
      const document = await uploadDocument(payload, workerId, hash, previous);
      form.current?.reset();
      onUploaded(document);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo cargar el documento.',
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
    return undefined;
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="document-upload-title"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-[14px] border border-line bg-bg p-6 text-ink shadow-lg backdrop:bg-ink/40"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 id="document-upload-title" className="text-lg font-bold">
            {previous ? 'Cargar nueva versión' : 'Subir documento'}
          </h2>
          <p className="mt-1 text-sm text-ink2">{workerName}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className={documentButton}
        >
          Cerrar
        </button>
      </div>
      {previous && (
        <p className="mb-5 rounded-lg bg-tint p-3 text-sm text-ink2">
          {previous.title} · Versión actual {previous.latestVersion.number}. La
          carga debe crear una versión nueva; el historial anterior se conserva.
        </p>
      )}
      <form ref={form} onSubmit={submit} className="space-y-4">
        {!previous && (
          <>
            <label className="block text-sm font-semibold">
              Nombre del documento
              <input
                name="title"
                maxLength={160}
                required
                className={'mt-1 ' + documentInput}
                disabled={busy}
                placeholder="Ej. Contrato de trabajo"
              />
            </label>
            <label className="block text-sm font-semibold">
              Tipo de documento
              <select
                aria-label="Tipo de documento"
                name="type"
                defaultValue=""
                required
                disabled={busy}
                className={'mt-1 ' + documentInput}
              >
                <option value="" disabled>
                  Selecciona un tipo
                </option>
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {DOCUMENT_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="block text-sm font-semibold">
          Archivo
          <input
            name="file"
            type="file"
            required
            disabled={busy}
            accept={policy.allowedMimes.join(',')}
            aria-describedby="document-file-help"
            className="mt-2 block w-full rounded-lg border border-line2 p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-tint2 file:px-3 file:py-2 file:font-semibold file:text-salmon-ink"
          />
        </label>
        <p id="document-file-help" className="text-xs leading-5 text-ink2">
          Formatos:{' '}
          {policy.allowedMimes
            .map((mime) => mime.split('/')[1].toUpperCase())
            .join(', ')}
          . Máximo{' '}
          {new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(
            policy.maxBytes / 1024 / 1024,
          )}{' '}
          MB.
        </p>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-line2 bg-crit-bg p-3 text-sm text-ink"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={documentButton}
          >
            Cancelar
          </button>
          <button type="submit" disabled={busy} className={documentPrimary}>
            {busy
              ? 'Cargando archivo…'
              : previous
                ? 'Guardar nueva versión'
                : 'Guardar documento'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
