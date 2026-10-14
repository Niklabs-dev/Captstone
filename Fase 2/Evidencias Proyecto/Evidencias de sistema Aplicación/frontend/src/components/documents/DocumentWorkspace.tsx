'use client';
import { useEffect, useState, type ReactElement } from 'react';
import {
  DOCUMENT_TYPES,
  DOCUMENT_LABELS,
  documentDate,
  documentDownloadName,
  type DocumentCollection,
  type DocumentVersion,
  type VersionHistory,
  type WorkerDocument,
} from '@/lib/documents';
import {
  checkDocumentIntegrity,
  downloadDocument,
  loadDocuments,
  loadDocumentVersions,
} from '@/lib/documents-client';
import { DocumentUpload } from './DocumentUpload';
import { documentButton, documentInput, documentPrimary } from './styles';

type FolderState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DocumentCollection };
export function DocumentWorkspace({
  workerId,
  workerName,
  onBusy,
}: {
  workerId: string;
  workerName: string;
  onBusy: (busy: boolean) => undefined;
}): ReactElement {
  const [folder, setFolder] = useState<FolderState>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState('');
  const [upload, setUpload] = useState<{
    previous: WorkerDocument | null;
  } | null>(null);
  const [selected, setSelected] = useState<WorkerDocument | null>(null);
  const [history, setHistory] = useState<VersionHistory | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  const [operation, setOperation] = useState('');
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const controller = new AbortController();
    loadDocuments(workerId, controller.signal).then(
      (data) => setFolder({ status: 'ready', data }),
      (error: unknown) => {
        if (!controller.signal.aborted)
          setFolder({
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'No se pudo consultar la carpeta.',
          });
      },
    );
    return () => controller.abort();
  }, [workerId, retry]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    loadDocumentVersions(selected, controller.signal).then(
      (data) => {
        setHistory(data);
        setHistoryBusy(false);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setHistoryError(
            error instanceof Error
              ? error.message
              : 'No se pudo consultar el historial.',
          );
          setHistoryBusy(false);
        }
      },
    );
    return () => controller.abort();
  }, [selected]);
  async function handleVersion(
    version: DocumentVersion,
    download: boolean,
  ): Promise<undefined> {
    if (operation) return;
    setOperation(version.id);
    setNotice('');
    setFailure('');
    onBusy(true);
    try {
      if (download) {
        const blob = await downloadDocument(version);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = documentDownloadName(version.fileName);
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setVerified((current) => ({ ...current, [version.id]: true }));
        setNotice(
          'Descarga preparada. El SHA-256 del archivo recibido coincide.',
        );
      } else {
        const result = await checkDocumentIntegrity(version);
        setVerified((current) => ({ ...current, [version.id]: result.valid }));
        if (!result.valid)
          throw new Error(
            'La integridad no coincide: el archivo pudo ser alterado. No lo descargues.',
          );
        setNotice('Integridad verificada por el servicio para esta versión.');
      }
    } catch (error) {
      setVerified((current) => ({ ...current, [version.id]: false }));
      setFailure(
        error instanceof Error
          ? error.message
          : 'No se pudo completar la operación.',
      );
    } finally {
      setOperation('');
      onBusy(false);
    }
    return undefined;
  }
  function selectDocument(document: WorkerDocument): undefined {
    setSelected({ ...document });
    setHistory(null);
    setHistoryError('');
    setHistoryBusy(true);
    return undefined;
  }
  function uploaded(document: WorkerDocument): undefined {
    setFolder((current) =>
      current.status === 'ready'
        ? {
            status: 'ready',
            data: {
              ...current.data,
              items: [
                document,
                ...current.data.items.filter((item) => item.id !== document.id),
              ],
            },
          }
        : current,
    );
    setUpload(null);
    setNotice(
      'Documento recibido. Puedes consultar su historial de versiones.',
    );
    if (selected?.id === document.id) selectDocument(document);
    return undefined;
  }
  const documents =
    folder.status === 'ready'
      ? folder.data.items.filter((item) => !filter || item.type === filter)
      : [];
  function versionActions(version: DocumentVersion): ReactElement {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(operation)}
          className={documentButton}
          onClick={() => handleVersion(version, false)}
        >
          {operation === version.id ? 'Procesando…' : 'Verificar integridad'}
        </button>
        <button
          type="button"
          disabled={Boolean(operation)}
          className={documentButton}
          onClick={() => handleVersion(version, true)}
        >
          Descargar
        </button>
      </div>
    );
  }
  return (
    <section
      aria-labelledby="worker-documents-title"
      className="min-w-0 rounded-[14px] border border-line bg-bg"
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-5">
        <div>
          <h2 id="worker-documents-title" className="text-base font-bold">
            {workerName}
          </h2>
          <p className="mt-1 text-sm text-ink2">
            Documentos laborales · Historial por versión
          </p>
        </div>
        <button
          type="button"
          className={documentPrimary}
          disabled={
            folder.status !== 'ready' ||
            !folder.data.policy.canUpload ||
            Boolean(operation)
          }
          onClick={() => setUpload({ previous: null })}
        >
          Subir documento
        </button>
      </header>
      <div className="space-y-4 p-5">
        {folder.status === 'loading' && (
          <p role="status" className="py-12 text-center text-sm text-ink2">
            Consultando documentos del trabajador…
          </p>
        )}
        {folder.status === 'error' && (
          <div
            role="alert"
            className="rounded-xl border border-line2 bg-tint p-5"
          >
            <h3 className="font-semibold">No se pudo consultar la carpeta</h3>
            <p className="mt-2 text-sm leading-6 text-ink2">{folder.message}</p>
            <button
              type="button"
              className={'mt-4 ' + documentButton}
              onClick={() => {
                setFolder({ status: 'loading' });
                setRetry((value) => value + 1);
              }}
            >
              Reintentar
            </button>
          </div>
        )}
        {folder.status === 'ready' && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <label className="block text-xs font-semibold text-ink2">
                Tipo de documento
                <select
                  aria-label="Tipo de documento"
                  className={'mt-1 min-w-44 ' + documentInput}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="">Todos los tipos</option>
                  {DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {DOCUMENT_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm text-ink2">
                {documents.length}{' '}
                {documents.length === 1 ? 'documento' : 'documentos'}
              </p>
            </div>
            {!folder.data.policy.canUpload && (
              <p role="status" className="text-sm text-ink2">
                Esta carpeta solo permite consulta.
              </p>
            )}
            {notice && (
              <p
                role="status"
                className="rounded-lg bg-tint p-3 text-sm text-ink2"
              >
                {notice}
              </p>
            )}
            {failure && (
              <p
                role="alert"
                className="rounded-lg border border-line2 bg-crit-bg p-3 text-sm text-ink"
              >
                {failure}
              </p>
            )}
            {documents.length === 0 ? (
              <div className="py-12 text-center">
                <h3 className="font-semibold">
                  {filter
                    ? 'Sin documentos de este tipo'
                    : 'Esta carpeta aún no tiene documentos'}
                </h3>
                <p className="mt-2 text-sm text-ink2">
                  {filter
                    ? 'Prueba con todos los tipos.'
                    : 'Puedes cargar el primer documento cuando la carga esté habilitada.'}
                </p>
              </div>
            ) : (
              <div
                role="region"
                aria-label="Documentos del trabajador"
                tabIndex={0}
                className="overflow-x-auto rounded-lg border border-line"
              >
                <table className="w-full min-w-[680px] text-left text-[13px]">
                  <thead className="bg-tint font-mono text-[10px] uppercase tracking-wide text-ink2">
                    <tr>
                      <th className="p-3">Documento</th>
                      <th className="p-3">SHA-256</th>
                      <th className="p-3">Conservación</th>
                      <th className="p-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => (
                      <tr
                        key={document.id}
                        className="border-t border-line align-top"
                      >
                        <td className="max-w-56 p-3">
                          <p className="break-words font-semibold">
                            {document.title}
                          </p>
                          <p className="mt-1 text-xs text-ink2">
                            {DOCUMENT_LABELS[document.type]} · v
                            {document.latestVersion.number}
                          </p>
                          <p className="mt-1 text-xs text-ink2">
                            {documentDate(document.latestVersion.createdAt)}
                          </p>
                        </td>
                        <td className="p-3">
                          <code
                            title={document.latestVersion.sha256}
                            className="text-[11px]"
                          >
                            {document.latestVersion.sha256.slice(0, 12)}…
                          </code>
                          <p className="mt-2 text-xs text-ink2">
                            {verified[document.latestVersion.id] === true
                              ? 'Verificado ahora'
                              : 'Pendiente de verificación'}
                          </p>
                        </td>
                        <td className="max-w-52 p-3">
                          <span className="rounded-md bg-tint2 px-2 py-1 text-xs text-salmon-ink">
                            {document.deletionBlocked
                              ? 'Eliminación bloqueada'
                              : 'Consultar condiciones'}
                          </span>
                          {document.retainUntil && (
                            <p className="mt-2 text-xs text-ink2">
                              Hasta {documentDate(document.retainUntil)}
                            </p>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              className={documentButton}
                              disabled={Boolean(operation)}
                              onClick={() => selectDocument(document)}
                            >
                              Ver historial
                            </button>
                            <button
                              className={documentButton}
                              disabled={
                                !folder.data.policy.canUpload ||
                                Boolean(operation)
                              }
                              onClick={() => setUpload({ previous: document })}
                            >
                              Nueva versión
                            </button>
                          </div>
                          <div className="mt-2">
                            {versionActions(document.latestVersion)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs leading-5 text-ink2">
              Cada versión tiene su propio hash. Verifica la integridad antes de
              utilizar un archivo.
            </p>
          </>
        )}
      </div>
      {selected && (
        <section
          aria-labelledby="version-history-title"
          className="border-t border-line p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="version-history-title" className="font-bold">
                Historial de versiones
              </h3>
              <p className="mt-1 break-words text-sm text-ink2">
                {selected.title}
              </p>
            </div>
            <button
              className={documentButton}
              disabled={Boolean(operation)}
              onClick={() => {
                setSelected(null);
                setHistory(null);
              }}
            >
              Cerrar historial
            </button>
          </div>
          {selected.deletionBlocked && (
            <p
              role="note"
              className="mt-4 rounded-lg border border-line2 bg-tint p-4 text-sm leading-6 text-ink2"
            >
              <strong className="block text-ink">
                Eliminación bloqueada por conservación
              </strong>
              {selected.deletionReason}
            </p>
          )}
          {historyBusy && (
            <p role="status" className="py-6 text-sm text-ink2">
              Consultando historial…
            </p>
          )}
          {historyError && (
            <p role="alert" className="mt-4 text-sm text-ink">
              {historyError}
              <button
                className={'ml-3 ' + documentButton}
                onClick={() => selectDocument({ ...selected })}
              >
                Reintentar historial
              </button>
            </p>
          )}
          {history && (
            <ol className="mt-4 divide-y divide-line">
              {history.versions.map((version) => (
                <li key={version.id} className="space-y-3 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      Versión {version.number}
                      {version.id === selected.latestVersion.id
                        ? ' · Actual'
                        : ' · Anterior'}
                    </p>
                    <p className="text-xs text-ink2">
                      {documentDate(version.createdAt)} · {version.uploadedBy}
                    </p>
                  </div>
                  <p className="break-all text-xs text-ink2">
                    {version.fileName}
                  </p>
                  <code className="block break-all rounded-lg bg-tint p-3 text-[11px] text-ink2">
                    {version.sha256}
                  </code>
                  {versionActions(version)}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      {upload && folder.status === 'ready' && (
        <DocumentUpload
          workerId={workerId}
          workerName={workerName}
          previous={upload.previous}
          policy={folder.data.policy}
          onBusy={onBusy}
          onUploaded={uploaded}
          onClose={() => {
            setUpload(null);
            return undefined;
          }}
        />
      )}
    </section>
  );
}
