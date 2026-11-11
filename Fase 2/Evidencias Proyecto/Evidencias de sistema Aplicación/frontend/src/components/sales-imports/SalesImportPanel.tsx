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
  badgeClass,
  buttonClass,
  filterPanelClass,
  inputClass,
  labelClass,
  panelTitleClass,
  primaryButtonClass,
  scrollRegionClass as regionClass,
  tableCellClass,
  tableClass,
  tableDescriptionClass,
  tableHeadClass,
  tableHeaderClass,
  tableHeadingClass,
  tablePanelClass,
} from '@/components/ui/styles';
import { formatSignedClp } from '@/lib/daily-operations';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import {
  buildResolution,
  chosenStore,
  effectiveActiveImport,
  fileDateDiffers,
  fileNameDate,
  initialChoices,
  isResolvable,
  latestSalesImports,
  NEW_METHOD_NAME_TAKEN,
  previewTableLines,
  resolvedPreviewLines,
  salesFileError,
  salesImportDifferences,
  salesImportError,
  SALES_FILE_ACCEPT,
  SALES_IMPORT_STATUS,
  type SalesImportDetail,
  type SalesImportDifference,
  type SalesImportLine,
  type LineChoice,
  type ResolutionChoices,
  type SalesImportPreview,
  type SalesImportSummary,
} from '@/lib/sales-imports';
import {
  confirmResolvedSalesImport,
  confirmSalesImport,
  discardSalesImport,
  downloadSalesImportFile,
  loadSalesImport,
  loadSalesImports,
  previewSalesImport,
  SalesImportRequestError,
} from '@/lib/sales-imports-client';
import { formatClp } from '@/lib/tips';
import { SalesImportResolution } from './SalesImportResolution';

const noticeClass =
  'rounded-lg border border-line2 bg-tint2 px-3.5 py-3 text-sm text-ink2';
const warningClass = 'rounded-lg bg-warn-bg px-3.5 py-3 text-sm text-warn';

type HistoryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: SalesImportSummary[] };

function errorText(cause: unknown): string {
  return cause instanceof SalesImportRequestError
    ? cause.message
    : salesImportError(503);
}
function statusBadge(status: SalesImportSummary['status']): string {
  if (status === 'ACTIVE') return `${badgeClass} bg-ok-bg text-ok`;
  if (status === 'PENDING') return `${badgeClass} bg-warn-bg text-warn`;
  return `${badgeClass} bg-tint2 text-ink2`;
}

function LinesTable({
  lines,
  totalAmount,
  caption,
  skipped = [],
  created = [],
  resolvable = false,
}: {
  lines: SalesImportLine[];
  totalAmount: number;
  caption: string;
  // Líneas omitidas (monto 0): se listan aparte y no suman. AUTOMATIC si se
  // omitieron solas por no tener alias (SPRINT-4A-T21).
  skipped?: readonly {
    lineNumber: number;
    originalLabel: string;
    resolution: 'AUTOMATIC' | 'MANUAL';
  }[];
  // Líneas que crean un medio nuevo al confirmar (SPRINT-4A-T21).
  created?: readonly number[];
  // En una vista previa que se resuelve a mano, lo pendiente es «Por elegir».
  resolvable?: boolean;
}): ReactElement {
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={regionClass}
    >
      <table className={tableClass}>
        <caption className="sr-only">{caption}</caption>
        <thead className={tableHeadClass}>
          <tr>
            <th scope="col" className={tableHeadingClass}>
              Medio de pago
            </th>
            <th scope="col" className={`${tableHeadingClass} text-right`}>
              Monto
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.lineNumber} className="border-b border-line">
              <th
                scope="row"
                className={`${tableCellClass} break-words font-medium`}
              >
                {line.paymentMethod?.name ?? line.originalLabel}
                {!line.paymentMethod && (
                  <span
                    className={`mt-1 block text-xs font-normal ${resolvable ? 'text-warn' : 'text-crit'}`}
                  >
                    {resolvable
                      ? 'Por elegir el medio de pago'
                      : 'Sin equivalencia configurada'}
                  </span>
                )}
                {line.paymentMethod && line.resolution === 'MANUAL' && (
                  <span className="mt-1 block text-xs font-normal text-ink2">
                    «{line.originalLabel}» ·{' '}
                    {created.includes(line.lineNumber)
                      ? 'medio nuevo, se crea al confirmar'
                      : 'elegido a mano'}
                  </span>
                )}
              </th>
              <td
                className={`${tableCellClass} whitespace-nowrap text-right tabular-nums`}
              >
                {formatClp(line.amount)}
              </td>
            </tr>
          ))}
          {skipped.map((line) => (
            <tr key={line.lineNumber} className="border-b border-line">
              <th
                scope="row"
                className={`${tableCellClass} break-words font-medium text-ink2`}
              >
                {line.originalLabel}
                <span className="mt-1 block text-xs font-normal">
                  {line.resolution === 'AUTOMATIC'
                    ? 'Omitida sola (monto 0, sin medio reconocido)'
                    : 'Omitida a mano (monto 0)'}
                </span>
              </th>
              <td
                className={`${tableCellClass} whitespace-nowrap text-right tabular-nums text-ink2`}
              >
                {formatClp(0)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={`${tableCellClass} font-semibold`}>
              Total
            </th>
            <td
              className={`${tableCellClass} whitespace-nowrap text-right font-semibold tabular-nums`}
            >
              {formatClp(totalAmount)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DetailCard({
  detail,
  downloading,
  onDownload,
}: {
  detail: SalesImportDetail;
  downloading: boolean;
  onDownload: () => undefined;
}): ReactElement {
  return (
    <div className="space-y-4 p-5">
      <dl className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-ink2">Local</dt>
          <dd className="mt-1 break-words font-medium">
            {detail.store.name}
            {detail.storeResolution === 'MANUAL' && (
              <span className="block text-xs font-normal text-ink2">
                Elegido a mano
              </span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink2">Fecha de negocio</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {formatCalendarDate(detail.businessDate)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink2">Versión</dt>
          <dd className="mt-1 font-medium tabular-nums">{detail.version}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink2">Archivo</dt>
          <dd className="mt-1 break-all font-medium">{detail.fileName}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink2">Cargado por</dt>
          <dd className="mt-1 break-words font-medium">
            {detail.uploadedBy.name}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-ink2">Fecha de carga · Chile</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {formatChileDate(detail.createdAt)}
          </dd>
        </div>
        {detail.resolvedBy && (
          <div className="min-w-0">
            <dt className="text-xs text-ink2">Resuelto a mano por</dt>
            <dd className="mt-1 break-words font-medium">
              {detail.resolvedBy.name}
            </dd>
          </div>
        )}
      </dl>
      <LinesTable
        lines={detail.lines}
        skipped={detail.skippedLines}
        totalAmount={detail.totalAmount}
        caption={`Medios de pago de la versión ${detail.version}`}
      />
      {detail.versions.length > 1 && (
        <div className="text-sm">
          <h4 className="font-semibold">Versiones de esta fecha</h4>
          <ul className="mt-2 space-y-1 text-ink2">
            {detail.versions.map((version) => (
              <li key={version.id}>
                Versión {version.version} ·{' '}
                {SALES_IMPORT_STATUS[version.status]} ·{' '}
                {formatChileDate(version.createdAt)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        disabled={downloading}
        onClick={onDownload}
        className={buttonClass}
      >
        {downloading ? 'Descargando…' : 'Descargar Excel original'}
      </button>
    </div>
  );
}

function DifferencesTable({
  rows,
}: {
  rows: SalesImportDifference[];
}): ReactElement {
  const caption = 'Diferencias contra la versión vigente';
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={regionClass}
    >
      <table className={tableClass}>
        <caption className="sr-only">{caption}</caption>
        <thead className={tableHeadClass}>
          <tr>
            {['Medio de pago', 'Vigente', 'Nueva', 'Diferencia'].map(
              (title) => (
                <th key={title} scope="col" className={tableHeadingClass}>
                  {title}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line">
              <th
                scope="row"
                className={`${tableCellClass} break-words font-medium`}
              >
                {row.name}
              </th>
              <td className={`${tableCellClass} tabular-nums`}>
                {formatClp(row.previous)}
              </td>
              <td className={`${tableCellClass} tabular-nums`}>
                {formatClp(row.next)}
              </td>
              <td className={`${tableCellClass} font-medium tabular-nums`}>
                {formatSignedClp(row.delta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// SPRINT-4R-T14: el panel y los reportes de ventas abren aquí el detalle de
// una importación (?importacion=<id>); la página lo consulta en el servidor.
export function SalesImportPanel({
  initialDetail = null,
  initialError = '',
}: {
  initialDetail?: SalesImportDetail | null;
  initialError?: string;
}): ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [preview, setPreview] = useState<SalesImportPreview | null>(null);
  const [activeDetail, setActiveDetail] = useState<SalesImportDetail | null>(
    null,
  );
  const [differencesError, setDifferencesError] = useState('');
  const [replaceAccepted, setReplaceAccepted] = useState(false);
  const [uploadedName, setUploadedName] = useState('');
  const [busy, setBusy] = useState<'' | 'preview' | 'confirm' | 'discard'>('');
  const [failure, setFailure] = useState(initialError);
  const [stalePreview, setStalePreview] = useState(false);
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<SalesImportDetail | null>(initialDetail);
  const [history, setHistory] = useState<HistoryState>({ status: 'loading' });
  const [historyRevision, setHistoryRevision] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [downloading, setDownloading] = useState(false);
  // SPRINT-4A-T19: lo elegido a mano en una vista previa UNRESOLVED.
  const [choices, setChoices] = useState<ResolutionChoices | null>(null);
  const inFlight = useRef(false);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadSalesImports(controller.signal).then(
      (items) => {
        if (!controller.signal.aborted)
          setHistory({ status: 'ready', items: latestSalesImports(items) });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setHistory({ status: 'error', message: errorText(cause) });
      },
    );
    return () => controller.abort();
  }, [historyRevision]);

  function refreshHistory(): void {
    setHistory({ status: 'loading' });
    setHistoryRevision((value) => value + 1);
  }
  function clearOutcome(): void {
    setPreview(null);
    setChoices(null);
    setActiveDetail(null);
    setDifferencesError('');
    setReplaceAccepted(false);
    setFailure('');
    setStalePreview(false);
  }
  function chooseFile(next: File | null): void {
    setFile(next);
    setFileError(next ? (salesFileError(next) ?? '') : '');
    setNotice('');
    setResult(null);
    clearOutcome();
  }
  function resetFile(): void {
    setFile(null);
    setUploadedName('');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (inFlight.current) return;
    if (!file) {
      setFileError('Selecciona el Excel de MrComanda.');
      fileInput.current?.focus();
      return;
    }
    const invalid = salesFileError(file);
    if (invalid) {
      setFileError(invalid);
      fileInput.current?.focus();
      return;
    }
    clearOutcome();
    setNotice('');
    setResult(null);
    inFlight.current = true;
    setBusy('preview');
    try {
      const next = await previewSalesImport(file);
      setPreview(next);
      setChoices(isResolvable(next) ? initialChoices(next) : null);
      setUploadedName(file.name);
      if (next.activeImport && (next.canConfirm || isResolvable(next))) {
        try {
          setActiveDetail(await loadSalesImport(next.activeImport.id));
        } catch (cause) {
          setDifferencesError(errorText(cause));
        }
      }
      refreshHistory();
      window.setTimeout(() => previewTitle.current?.focus(), 0);
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }

  async function confirm(): Promise<undefined> {
    if (inFlight.current || !preview?.import) return;
    inFlight.current = true;
    setFailure('');
    setBusy('confirm');
    try {
      const saved = await confirmSalesImport(
        preview.import.id,
        preview.activeImport?.id ?? null,
      );
      setResult(saved);
      setNotice(
        preview.activeImport
          ? `Corrección confirmada. La versión ${saved.version} quedó vigente.`
          : 'Importación confirmada. Las ventas del día quedaron vigentes.',
      );
      clearOutcome();
      resetFile();
      refreshHistory();
    } catch (cause) {
      setFailure(errorText(cause));
      if (cause instanceof SalesImportRequestError && cause.status === 409)
        setStalePreview(true);
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }

  // La vigente del local elegido a mano se carga para mostrar diferencias.
  async function loadActiveFor(id: string | null): Promise<undefined> {
    setActiveDetail(null);
    setDifferencesError('');
    setReplaceAccepted(false);
    if (!id) return;
    try {
      setActiveDetail(await loadSalesImport(id));
    } catch (cause) {
      setDifferencesError(errorText(cause));
    }
  }
  function chooseStore(storeId: string): undefined {
    if (!preview || !choices) return;
    const next = { ...choices, storeId };
    setChoices(next);
    void loadActiveFor(effectiveActiveImport(preview, next)?.id ?? null);
  }
  function chooseLine(lineNumber: number, next: LineChoice): undefined {
    setChoices((current) =>
      current
        ? { ...current, lines: { ...current.lines, [lineNumber]: next } }
        : current,
    );
  }

  async function confirmResolved(): Promise<undefined> {
    if (inFlight.current || !preview || !choices || !file) return;
    const resolution = buildResolution(preview, choices);
    if (!resolution) return;
    inFlight.current = true;
    setFailure('');
    setBusy('confirm');
    try {
      const saved = await confirmResolvedSalesImport(file, resolution);
      setResult(saved);
      setNotice(
        resolution.expectedActiveImportId
          ? `Corrección confirmada. La versión ${saved.version} quedó vigente.`
          : 'Importación confirmada. Las ventas del día quedaron vigentes.',
      );
      clearOutcome();
      resetFile();
      refreshHistory();
    } catch (cause) {
      setFailure(errorText(cause));
      // Un nombre repetido del medio nuevo se corrige sin volver a subir.
      if (
        cause instanceof SalesImportRequestError &&
        cause.status === 409 &&
        cause.message !== NEW_METHOD_NAME_TAKEN
      )
        setStalePreview(true);
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }
  function cancelResolution(): undefined {
    setNotice('Vista previa cancelada. No se registraron ventas.');
    clearOutcome();
    resetFile();
    return undefined;
  }

  async function discard(): Promise<undefined> {
    if (inFlight.current || !preview?.import) return;
    inFlight.current = true;
    setFailure('');
    setBusy('discard');
    try {
      await discardSalesImport(preview.import.id);
      setNotice('Vista previa descartada. No se registraron ventas.');
      clearOutcome();
      resetFile();
      refreshHistory();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }

  // Una vista previa abandonada (recarga de página) se limpia desde el historial.
  async function discardPending(id: string): Promise<undefined> {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailure('');
    setBusy('discard');
    try {
      await discardSalesImport(id);
      setNotice('Vista previa descartada. No se registraron ventas.');
      setResult((current) => (current?.id === id ? null : current));
      refreshHistory();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  }

  async function download(detail: SalesImportDetail): Promise<undefined> {
    setDownloading(true);
    setFailure('');
    try {
      const { blob, altered } = await downloadSalesImportFile(detail.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = detail.fileName;
      link.click();
      URL.revokeObjectURL(url);
      if (altered)
        setFailure(
          'El Excel descargado no coincide con el registrado: el archivo fue modificado. No lo uses como respaldo y avisa al responsable del sistema.',
        );
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setDownloading(false);
    }
  }

  async function openDetail(id: string): Promise<undefined> {
    setSelectedId(id);
    setFailure('');
    try {
      setResult(await loadSalesImport(id));
      setNotice('');
      // El detalle se pinta sobre el historial: el foco lo lleva a la vista.
      window.setTimeout(() => detailTitle.current?.focus(), 0);
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setSelectedId('');
    }
  }

  const resolvable = preview !== null && isResolvable(preview);
  const resolved =
    preview && choices && resolvable
      ? resolvedPreviewLines(preview, choices)
      : preview
        ? { ...previewTableLines(preview), created: [] }
        : null;
  const resolution =
    preview && choices && resolvable ? buildResolution(preview, choices) : null;
  const replacing =
    preview && choices && resolvable
      ? effectiveActiveImport(preview, choices)
      : (preview?.activeImport ?? null);
  const isCorrection = Boolean(
    (preview?.canConfirm || resolvable) && replacing,
  );
  // Sin las diferencias a la vista no se puede aceptar el reemplazo.
  const replaceReady =
    !isCorrection || (activeDetail !== null && replaceAccepted);
  const canConfirm =
    Boolean(preview?.canConfirm) && !stalePreview && replaceReady;
  const canConfirmResolved =
    resolution !== null && !stalePreview && replaceReady;
  const manualStore = preview && choices ? chosenStore(preview, choices) : null;
  const differences =
    preview && activeDetail
      ? salesImportDifferences(
          activeDetail.lines,
          resolved ? resolved.lines : preview.lines,
        )
      : [];
  const alreadyActive =
    preview?.outcome === 'EXISTING' && preview.import?.status === 'ACTIVE';
  const superseded =
    preview?.outcome === 'EXISTING' && preview.import?.status === 'SUPERSEDED';
  const nameDate = uploadedName ? fileNameDate(uploadedName) : null;
  // Con una vista previa por decidir no se elige otro archivo: quedaría
  // pendiente sin que nadie la confirme ni la descarte.
  const decisionPending = Boolean(preview?.canConfirm);

  return (
    <div className="min-w-0 space-y-5">
      <section
        aria-labelledby="sales-upload-title"
        className={filterPanelClass}
      >
        <h2 id="sales-upload-title" className={panelTitleClass}>
          Subir Excel de MrComanda
        </h2>
        <p className="mt-2 text-xs leading-5 text-ink2">
          Sube el Informe de Ventas Diario en .xlsx, máximo 5 MB. Antes de
          guardar verás el local, la fecha, los medios de pago y el total.
        </p>
        <form
          onSubmit={submit}
          noValidate
          className="mt-4 space-y-4"
          aria-busy={busy === 'preview'}
        >
          <label className={labelClass}>
            Archivo Excel
            <input
              ref={fileInput}
              name="file"
              type="file"
              accept={SALES_FILE_ACCEPT}
              disabled={busy !== '' || decisionPending}
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              className={`${inputClass} mt-2 file:mr-3 file:rounded-lg file:border-0 file:bg-tint2 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-salmon-ink hover:file:bg-tint3`}
              aria-invalid={Boolean(fileError)}
              aria-describedby="sales-file-error"
            />
          </label>
          <p
            id="sales-file-error"
            hidden={!fileError}
            role="alert"
            className="text-sm text-crit"
          >
            {fileError}
          </p>
          {decisionPending && (
            <p className="text-sm text-ink2">
              Confirma o descarta la vista previa para subir otro archivo.
            </p>
          )}
          <button
            type="submit"
            disabled={busy !== '' || decisionPending}
            className={primaryButtonClass}
          >
            {busy === 'preview' ? 'Analizando archivo…' : 'Ver vista previa'}
          </button>
          {busy === 'preview' && (
            <p role="status" className="text-sm text-ink2">
              Analizando el archivo. Todavía no se registran ventas.
            </p>
          )}
        </form>
      </section>

      {failure && (
        <p role="alert" className={alertClass}>
          {failure}
        </p>
      )}
      {notice && (
        <p role="status" className={noticeClass}>
          {notice}
        </p>
      )}

      {preview && (
        <section
          aria-labelledby="sales-preview-title"
          className={`${tablePanelClass} min-w-0`}
        >
          <header className={tableHeaderClass}>
            <div className="min-w-0">
              <h2
                id="sales-preview-title"
                ref={previewTitle}
                tabIndex={-1}
                className={`${panelTitleClass} outline-none`}
              >
                Vista previa de la importación
              </h2>
              <p className={tableDescriptionClass}>
                {preview.canConfirm
                  ? 'Revisa los datos antes de confirmar'
                  : resolvable
                    ? 'Elige los datos que no se identificaron para confirmar'
                    : 'Esta carga no se puede confirmar'}
              </p>
            </div>
          </header>
          <div className="space-y-4 p-5">
            {resolvable && (
              <div className={warningClass}>
                <p className="font-semibold">
                  Hay datos que el sistema no identificó. Elígelos para
                  confirmar; todavía no se guardó nada.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {preview.issues.map((issue) => (
                    <li key={issue.code + issue.message}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview.outcome === 'UNRESOLVED' && !resolvable && (
              <div role="alert" className={alertClass}>
                <p className="font-semibold">
                  No se puede confirmar y no se guardó nada.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {preview.issues.map((issue) => (
                    <li key={issue.code + issue.message}>{issue.message}</li>
                  ))}
                </ul>
                <p className="mt-2">
                  Configura la equivalencia y vuelve a subir el archivo.
                </p>
              </div>
            )}
            {alreadyActive && (
              <p role="status" className={noticeClass}>
                Este archivo ya estaba importado y es la versión vigente. No se
                creó un duplicado.
              </p>
            )}
            {superseded && (
              <p role="status" className={noticeClass}>
                Este archivo ya se importó y fue reemplazado por una versión
                posterior. No se puede volver a confirmar.
              </p>
            )}
            {preview.outcome === 'EXISTING' && preview.canConfirm && (
              <p role="status" className={noticeClass}>
                Este archivo ya estaba cargado y sigue pendiente. Puedes
                confirmarlo o descartarlo; no se creó un duplicado.
              </p>
            )}
            {nameDate &&
              fileDateDiffers(uploadedName, preview.businessDate) && (
                <p role="status" className={warningClass}>
                  El nombre del archivo indica {formatCalendarDate(nameDate)},
                  pero el contenido corresponde al{' '}
                  {formatCalendarDate(preview.businessDate)}. Se usará la fecha
                  del contenido.
                </p>
              )}
            <dl className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Local</dt>
                <dd className="mt-1 break-words font-medium">
                  {preview.store?.name ??
                    (manualStore
                      ? `${manualStore.name} (elegido a mano)`
                      : resolvable
                        ? `Por elegir (${preview.externalStoreCode})`
                        : `Sin configurar (${preview.externalStoreCode})`)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Fecha de negocio</dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {formatCalendarDate(preview.businessDate)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Emisión del reporte</dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {preview.issuedAt
                    ? formatChileDate(preview.issuedAt)
                    : 'No informada'}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Total</dt>
                <dd className="mt-1 font-semibold tabular-nums">
                  {formatClp(preview.totalAmount)}
                </dd>
              </div>
            </dl>
            {resolvable && choices && (
              <SalesImportResolution
                preview={preview}
                choices={choices}
                disabled={busy !== '' || stalePreview}
                onStoreChange={chooseStore}
                onRememberStoreChange={(rememberStore) => {
                  setChoices({ ...choices, rememberStore });
                  return undefined;
                }}
                onLineChange={chooseLine}
              />
            )}
            <LinesTable
              lines={resolved ? resolved.lines : preview.lines}
              skipped={resolved?.skipped}
              created={resolved?.created}
              resolvable={resolvable}
              totalAmount={preview.totalAmount}
              caption="Medios de pago del archivo"
            />
            {isCorrection && (
              <div className="space-y-3 rounded-lg border border-line bg-tint p-4 text-sm">
                <h3 className="font-semibold">
                  Corrección de la versión vigente
                  {replacing ? ` (versión ${replacing.version})` : ''}
                </h3>
                {differencesError && (
                  <p role="alert" className={alertClass}>
                    No se pudieron cargar las diferencias: {differencesError}{' '}
                    Vuelve a subir el archivo para confirmar.
                  </p>
                )}
                {activeDetail &&
                  (differences.length > 0 ? (
                    <DifferencesTable rows={differences} />
                  ) : (
                    <p className="text-ink2">
                      Los montos por medio de pago no cambian.
                    </p>
                  ))}
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={replaceAccepted}
                    disabled={!activeDetail || busy !== ''}
                    onChange={(event) =>
                      setReplaceAccepted(event.target.checked)
                    }
                    className="h-5 w-5 shrink-0 accent-salmon-ink"
                  />
                  <span>
                    Revisé las diferencias y quiero reemplazar la versión
                    vigente
                  </span>
                </label>
              </div>
            )}
            {resolvable && (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={!canConfirmResolved || busy !== ''}
                  onClick={() => void confirmResolved()}
                  className={primaryButtonClass}
                >
                  {busy === 'confirm'
                    ? 'Confirmando…'
                    : isCorrection
                      ? 'Confirmar corrección'
                      : 'Confirmar importación'}
                </button>
                <button
                  type="button"
                  disabled={busy !== ''}
                  onClick={cancelResolution}
                  className={buttonClass}
                >
                  Cancelar
                </button>
                {!resolution && (
                  <p className="basis-full text-sm text-ink2">
                    Confirmar se habilita cuando elijas todos los datos
                    pendientes.
                  </p>
                )}
              </div>
            )}
            {preview.canConfirm && (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={!canConfirm || busy !== ''}
                  onClick={() => void confirm()}
                  className={primaryButtonClass}
                >
                  {busy === 'confirm'
                    ? 'Confirmando…'
                    : isCorrection
                      ? 'Confirmar corrección'
                      : 'Confirmar importación'}
                </button>
                <button
                  type="button"
                  disabled={busy !== ''}
                  onClick={() => void discard()}
                  className={buttonClass}
                >
                  Descartar
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {(result ?? (alreadyActive ? preview?.import : null)) && (
        <section
          aria-labelledby="sales-detail-title"
          className={`${tablePanelClass} min-w-0`}
        >
          <header className={tableHeaderClass}>
            <h2
              id="sales-detail-title"
              ref={detailTitle}
              tabIndex={-1}
              className={`${panelTitleClass} outline-none`}
            >
              Detalle de la importación · Versión{' '}
              {(result ?? preview?.import)?.version}
            </h2>
            <span
              className={statusBadge(
                (result ?? preview?.import)?.status ?? 'PENDING',
              )}
            >
              {
                SALES_IMPORT_STATUS[
                  (result ?? preview?.import)?.status ?? 'PENDING'
                ]
              }
            </span>
          </header>
          <DetailCard
            detail={(result ?? preview?.import) as SalesImportDetail}
            downloading={downloading}
            onDownload={() => {
              void download((result ?? preview?.import) as SalesImportDetail);
              return undefined;
            }}
          />
        </section>
      )}

      <section
        aria-labelledby="sales-history-title"
        className={`${tablePanelClass} min-w-0`}
        aria-busy={history.status === 'loading'}
      >
        <header className={tableHeaderClass}>
          <div className="min-w-0">
            <h2 id="sales-history-title" className={panelTitleClass}>
              Importaciones recientes
            </h2>
            <p className={tableDescriptionClass}>
              Las 20 cargas más recientes de todos los locales
            </p>
          </div>
        </header>
        {history.status === 'loading' && (
          <p role="status" className="p-5 text-sm text-ink2">
            Consultando importaciones…
          </p>
        )}
        {history.status === 'error' && (
          <div role="alert" className="space-y-3 p-5 text-sm text-crit">
            <p>{history.message}</p>
            <button
              type="button"
              onClick={refreshHistory}
              className={buttonClass}
            >
              Reintentar
            </button>
          </div>
        )}
        {history.status === 'ready' && history.items.length === 0 && (
          <p role="status" className="p-5 text-sm text-ink2">
            Todavía no hay importaciones de ventas.
          </p>
        )}
        {history.status === 'ready' && history.items.length > 0 && (
          <ul className="divide-y divide-line">
            {history.items.map((item) => (
              <li
                key={item.id}
                className="flex min-w-0 flex-col gap-3 p-5 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="break-words font-medium">
                    {item.store.name} · {formatCalendarDate(item.businessDate)}{' '}
                    · Versión {item.version}
                  </p>
                  <p className="mt-1 break-all text-xs text-muted">
                    {item.fileName} · {formatClp(item.totalAmount)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <span className={statusBadge(item.status)}>
                    {SALES_IMPORT_STATUS[item.status]}
                  </span>
                  <button
                    type="button"
                    disabled={selectedId === item.id}
                    onClick={() => void openDetail(item.id)}
                    className={buttonClass}
                    aria-label={`Ver detalle de ${item.fileName}, versión ${item.version}`}
                  >
                    Ver detalle
                  </button>
                  {item.status === 'PENDING' &&
                    item.id !== preview?.import?.id && (
                      <button
                        type="button"
                        disabled={busy !== ''}
                        onClick={() => void discardPending(item.id)}
                        className={buttonClass}
                        aria-label={`Descartar vista previa pendiente de ${item.fileName}`}
                      >
                        Descartar
                      </button>
                    )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
