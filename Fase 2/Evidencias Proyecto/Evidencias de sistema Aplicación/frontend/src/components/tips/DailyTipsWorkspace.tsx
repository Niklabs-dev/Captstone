'use client';
import { useRouter } from 'next/navigation';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  EmptyState,
  ScrollTable,
  SummaryTiles,
  TablePanel,
  rowClass,
} from '@/components/sales-overview/SalesOverviewParts';
import {
  alertClass,
  badgeClass,
  buttonClass,
  dialogActionsClass,
  dialogClass,
  primaryButtonClass,
  tableCellClass,
  tableHeadClass,
  tableHeadingClass,
} from '@/components/ui/styles';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import {
  allocationStatusPresentation,
  dailyTipsError,
  dayStatusPresentation,
  paymentPreview,
  paymentSuccessMessage,
  periodLabel,
  plural,
  type PaymentBatch,
  type PaymentPreview,
  type StatusTone,
  type TipDay,
  type TipDayDetail,
  type TipDays,
  type TipSummary,
  type TipsRange,
} from '@/lib/daily-tips';
import {
  downloadTipsExport,
  loadPaymentBatches,
  loadTipDay,
  loadTipDays,
  loadTipSummary,
  payTipsPeriod,
  TipsRequestError,
} from '@/lib/daily-tips-client';
import { formatClp } from '@/lib/tips';

// Vista de propinas del administrador y el contador (SPRINT-4A-T07): días
// del período con su detalle por trabajador, resumen por trabajador, Excel
// del período y pago por lote. Tras pagar se vuelve a consultar sin recargar.
const toneClasses: Record<StatusTone, string> = {
  ok: 'bg-ok-bg text-ok',
  info: 'bg-info-bg text-info',
  warn: 'bg-warn-bg text-warn',
  neutral: 'bg-tint2 text-ink2',
};
function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: StatusTone;
}): ReactElement {
  return (
    <span className={`${badgeClass} ${toneClasses[tone]}`}>
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {label}
    </span>
  );
}
const money = (value: number): ReactElement => (
  <span className="whitespace-nowrap tabular-nums">{formatClp(value)}</span>
);
// Por debajo de 640 px algunas columnas pasan a la primera celda.
const wideCell = 'hidden sm:table-cell';

type Report = { days: TipDays; summary: TipSummary };
type DetailState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; detail: TipDayDetail };
type Batches =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; items: PaymentBatch[] };

export function DailyTipsWorkspace({
  range: initialRange,
  storeName,
}: {
  range: TipsRange;
  storeName: string;
}): ReactElement {
  const router = useRouter();
  const { storeId, from, to } = initialRange;
  const range = useMemo(() => ({ storeId, from, to }), [storeId, from, to]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [batches, setBatches] = useState<Batches>({ state: 'loading' });
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const sequence = useRef(0);
  const expandedRef = useRef<readonly string[]>([]);

  const describe = useCallback(
    (cause: unknown, fallback: number): string => {
      if (cause instanceof TipsRequestError && cause.status === 401)
        router.replace('/session-expired');
      return cause instanceof Error ? cause.message : dailyTipsError(fallback);
    },
    [router],
  );
  const fetchDetail = useCallback(
    async (businessDate: string): Promise<undefined> => {
      setDetails((current) => ({
        ...current,
        [businessDate]: { state: 'loading' },
      }));
      try {
        const detail = await loadTipDay(storeId, businessDate);
        setDetails((current) => ({
          ...current,
          [businessDate]: { state: 'ready', detail },
        }));
      } catch (cause) {
        setDetails((current) => ({
          ...current,
          [businessDate]: { state: 'error', message: describe(cause, 502) },
        }));
      }
    },
    [describe, storeId],
  );
  // Consulta días, resumen e historial de pagos; ignora respuestas antiguas.
  const refresh = useCallback(async (): Promise<undefined> => {
    const current = ++sequence.current;
    const [reportResult, batchesResult] = await Promise.allSettled([
      Promise.all([loadTipDays(range), loadTipSummary(range)]),
      loadPaymentBatches(range),
    ]);
    if (current !== sequence.current) return;
    if (reportResult.status === 'fulfilled') {
      const [days, summary] = reportResult.value;
      setReport({ days, summary });
      setLoadError('');
    } else {
      setReport(null);
      setLoadError(describe(reportResult.reason, 502));
    }
    setBatches(
      batchesResult.status === 'fulfilled'
        ? { state: 'ready', items: batchesResult.value }
        : { state: 'error', message: describe(batchesResult.reason, 502) },
    );
    setLoading(false);
    // Los detalles abiertos se vuelven a consultar con el estado vigente.
    setDetails({});
    for (const date of expandedRef.current) void fetchDetail(date);
  }, [describe, fetchDetail, range]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function reload(): Promise<undefined> {
    setLoading(true);
    setBatches({ state: 'loading' });
    await refresh();
  }
  function toggle(businessDate: string): undefined {
    const open = expanded.includes(businessDate);
    const next = open
      ? expanded.filter((date) => date !== businessDate)
      : [...expanded, businessDate];
    expandedRef.current = next;
    setExpanded(next);
    if (!open && details[businessDate]?.state !== 'ready')
      void fetchDetail(businessDate);
  }
  async function download(): Promise<undefined> {
    if (downloading) return;
    setDownloading(true);
    setActionError('');
    setNotice('');
    try {
      const name = await downloadTipsExport(range);
      setNotice(`Se descargó el archivo ${name}.`);
    } catch (cause) {
      setActionError(describe(cause, 502));
    } finally {
      setDownloading(false);
    }
  }
  async function paid(
    batch: PaymentBatch | null,
    message: string,
  ): Promise<undefined> {
    setPreview(null);
    setNotice(batch ? paymentSuccessMessage(batch) : '');
    setActionError(batch ? '' : message);
    await refresh();
  }

  const pending = report ? paymentPreview(report.summary) : null;
  const busy = loading || downloading;
  return (
    <div aria-busy={loading} className="space-y-5">
      <section
        aria-labelledby="tips-period-title"
        className="rounded-[14px] border border-line bg-bg p-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 id="tips-period-title" className="text-sm font-bold">
              {storeName} · {periodLabel(range.from, range.to)}
            </h2>
            <p className="mt-1 text-xs text-muted">
              Propinas de la operación diaria, repartidas en partes iguales
              entre los participantes de cada día. Montos en pesos chilenos.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void download()}
              disabled={busy || !report || report.days.days.length === 0}
              className={buttonClass}
            >
              {downloading ? 'Descargando…' : 'Descargar Excel'}
            </button>
            <button
              type="button"
              onClick={() => {
                setActionError('');
                setNotice('');
                setPreview(pending);
              }}
              disabled={busy || !pending || preview !== null}
              className={primaryButtonClass}
            >
              Marcar como pagado
            </button>
          </div>
        </div>
        <div className="mt-4">
          {report ? (
            <SummaryTiles
              items={[
                {
                  label: 'Total del período',
                  value: money(report.summary.totals.totalAmount),
                  detail: plural(
                    report.days.totals.dayCount,
                    'día con operación',
                    'días con operación',
                  ),
                },
                {
                  label: 'Pendiente de pago',
                  value: money(report.summary.totals.unpaidAmount),
                  detail: pending
                    ? plural(
                        pending.workerCount,
                        'trabajador con pendiente',
                        'trabajadores con pendiente',
                      )
                    : 'Sin pendientes',
                },
                {
                  label: 'Pagado',
                  value: money(report.summary.totals.paidAmount),
                },
                {
                  label: 'Trabajadores',
                  value: report.summary.totals.workerCount,
                  detail: 'Con propinas en el período',
                },
              ]}
            />
          ) : loading ? (
            <p role="status" className="text-sm text-ink2">
              Cargando propinas del período…
            </p>
          ) : null}
        </div>
        {!loading && report && !pending && report.days.days.length > 0 && (
          <p className="mt-4 text-xs text-ink2">
            No hay propinas pendientes de pago en el período.
          </p>
        )}
      </section>

      {notice && (
        <p role="status" className="rounded-lg bg-ok-bg p-4 text-sm text-ok">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className={alertClass}>
          {actionError}
        </p>
      )}
      {loadError && (
        <div role="alert" className={`${alertClass} space-y-3`}>
          <p>No se pudieron cargar las propinas. {loadError}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className={buttonClass}
          >
            Reintentar
          </button>
        </div>
      )}

      {report && (
        <>
          <DaysTable
            days={report.days.days}
            expanded={expanded}
            details={details}
            onToggle={toggle}
            onRetry={(date) => void fetchDetail(date)}
          />
          <WorkersTable summary={report.summary} />
        </>
      )}
      {!loadError && (
        <BatchesTable batches={batches} onRetry={() => void reload()} />
      )}
      {preview && (
        <PaymentDialog
          preview={preview}
          range={range}
          storeName={storeName}
          onClose={() => setPreview(null)}
          onPaid={(batch) => void paid(batch, '')}
          onConflict={(message) => void paid(null, message)}
          describe={describe}
        />
      )}
    </div>
  );
}

function DaysTable({
  days,
  expanded,
  details,
  onToggle,
  onRetry,
}: {
  days: readonly TipDay[];
  expanded: readonly string[];
  details: Record<string, DetailState>;
  onToggle: (date: string) => undefined;
  onRetry: (date: string) => void;
}): ReactElement {
  return (
    <TablePanel
      id="tips-days-title"
      title="Propinas por día"
      description="Abre un día para ver cuánto recibe cada trabajador y si ya se pagó."
      aside={
        <span className={`${badgeClass} bg-tint2 text-salmon-ink`}>
          {plural(days.length, 'día', 'días')}
        </span>
      }
    >
      {days.length === 0 ? (
        <EmptyState>
          No hay operaciones diarias registradas en el período para este local.
        </EmptyState>
      ) : (
        <ScrollTable caption="Propinas por día del período">
          <thead className={tableHeadClass}>
            <tr>
              <th scope="col" className={tableHeadingClass}>
                Fecha
              </th>
              <th scope="col" className={`${tableHeadingClass} text-right`}>
                Total
              </th>
              <th
                scope="col"
                className={`${tableHeadingClass} ${wideCell} text-right`}
              >
                Participantes
              </th>
              <th scope="col" className={`${tableHeadingClass} ${wideCell}`}>
                Estado
              </th>
              <th scope="col" className={tableHeadingClass}>
                <span className="sr-only">Detalle</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const open = expanded.includes(day.businessDate);
              const status = dayStatusPresentation(day);
              const detailId = `tips-day-${day.businessDate}`;
              const date = formatCalendarDate(day.businessDate);
              return (
                <Fragment key={day.operationId}>
                  <tr className={rowClass}>
                    <td className={tableCellClass}>
                      <span className="font-mono whitespace-nowrap">
                        {date}
                      </span>
                      <span className="mt-2 flex flex-col items-start gap-1 sm:hidden">
                        <StatusBadge {...status} />
                        <span className="text-[11px] text-muted">
                          {plural(
                            day.participantCount,
                            'participante',
                            'participantes',
                          )}
                        </span>
                      </span>
                    </td>
                    <td className={`${tableCellClass} text-right font-medium`}>
                      {money(day.totalAmount)}
                    </td>
                    <td
                      className={`${tableCellClass} ${wideCell} text-right tabular-nums`}
                    >
                      {day.participantCount}
                    </td>
                    <td className={`${tableCellClass} ${wideCell}`}>
                      <StatusBadge {...status} />
                    </td>
                    <td className={`${tableCellClass} text-right`}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={detailId}
                        aria-label={`${open ? 'Ocultar' : 'Ver'} detalle del ${date}`}
                        onClick={() => onToggle(day.businessDate)}
                        className={`${buttonClass} whitespace-nowrap`}
                      >
                        {open ? (
                          'Ocultar'
                        ) : (
                          <>
                            <span className="sm:hidden">Detalle</span>
                            <span className="hidden sm:inline">
                              Ver detalle
                            </span>
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr id={detailId} className="border-b border-line bg-tint">
                      <td colSpan={5} className="px-4 py-4">
                        <DayDetail
                          date={date}
                          state={details[day.businessDate]}
                          onRetry={() => onRetry(day.businessDate)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </ScrollTable>
      )}
    </TablePanel>
  );
}

function DayDetail({
  date,
  state,
  onRetry,
}: {
  date: string;
  state: DetailState | undefined;
  onRetry: () => void;
}): ReactElement {
  if (!state || state.state === 'loading')
    return (
      <p role="status" aria-busy="true" className="text-sm text-ink2">
        Cargando detalle del {date}…
      </p>
    );
  if (state.state === 'error')
    return (
      <div role="alert" className={`${alertClass} space-y-3`}>
        <p>{state.message}</p>
        <button type="button" onClick={onRetry} className={buttonClass}>
          Reintentar
        </button>
      </div>
    );
  const { detail } = state;
  if (detail.allocations.length === 0)
    return (
      <p className="text-sm text-ink2">
        El {date} no tuvo propinas para repartir.
      </p>
    );
  return (
    <div className="min-w-0">
      <p className="text-xs text-ink2">
        Fondo del día {formatClp(detail.tipFundAmount)} entre{' '}
        {plural(detail.participantCount, 'participante', 'participantes')}.
      </p>
      <ul
        aria-label={`Propina por trabajador del ${date}`}
        className="mt-3 divide-y divide-line rounded-lg border border-line bg-bg"
      >
        {detail.allocations.map((allocation) => (
          <li
            key={allocation.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
          >
            <span className="min-w-0 font-medium break-words">
              {allocation.worker.name}
            </span>
            <span className="flex flex-wrap items-center gap-3">
              {money(allocation.amount)}
              <StatusBadge
                {...allocationStatusPresentation(allocation.status)}
              />
              {allocation.paidAt && (
                <span className="font-mono text-[11px] text-muted">
                  {formatChileDate(allocation.paidAt)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkersTable({ summary }: { summary: TipSummary }): ReactElement {
  return (
    <TablePanel
      id="tips-workers-title"
      title="Resumen por trabajador"
      description="Pendiente, pagado y total de cada trabajador en el período."
      aside={
        <span className={`${badgeClass} bg-tint2 text-salmon-ink`}>
          {plural(summary.totals.workerCount, 'trabajador', 'trabajadores')}
        </span>
      }
    >
      {summary.workers.length === 0 ? (
        <EmptyState>
          Nadie recibió propinas en el período seleccionado.
        </EmptyState>
      ) : (
        <ScrollTable caption="Resumen de propinas por trabajador">
          <thead className={tableHeadClass}>
            <tr>
              <th scope="col" className={tableHeadingClass}>
                Trabajador
              </th>
              <th
                scope="col"
                className={`${tableHeadingClass} ${wideCell} text-right`}
              >
                Días
              </th>
              <th scope="col" className={`${tableHeadingClass} text-right`}>
                Pendiente
              </th>
              <th
                scope="col"
                className={`${tableHeadingClass} ${wideCell} text-right`}
              >
                Pagado
              </th>
              <th scope="col" className={`${tableHeadingClass} text-right`}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.workers.map((item) => (
              <tr key={item.worker.id} className={rowClass}>
                <th
                  scope="row"
                  className={`${tableCellClass} font-medium break-words sm:min-w-36`}
                >
                  {item.worker.name}
                  <span className="mt-1 block text-[11px] font-normal text-muted sm:hidden">
                    Pagado {formatClp(item.paidAmount)} ·{' '}
                    {plural(item.dayCount, 'día', 'días')}
                  </span>
                </th>
                <td
                  className={`${tableCellClass} ${wideCell} text-right tabular-nums`}
                >
                  {item.dayCount}
                </td>
                <td className={`${tableCellClass} text-right`}>
                  {money(item.unpaidAmount)}
                </td>
                <td className={`${tableCellClass} ${wideCell} text-right`}>
                  {money(item.paidAmount)}
                </td>
                <td className={`${tableCellClass} text-right font-medium`}>
                  {money(item.totalAmount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line bg-tint font-semibold">
            <tr>
              <th scope="row" className={tableCellClass}>
                Total general
                <span className="mt-1 block text-[11px] font-normal text-muted sm:hidden">
                  Pagado {formatClp(summary.totals.paidAmount)}
                </span>
              </th>
              <td
                className={`${tableCellClass} ${wideCell} text-right tabular-nums`}
              >
                {summary.totals.dayCount}
              </td>
              <td className={`${tableCellClass} text-right`}>
                {money(summary.totals.unpaidAmount)}
              </td>
              <td className={`${tableCellClass} ${wideCell} text-right`}>
                {money(summary.totals.paidAmount)}
              </td>
              <td className={`${tableCellClass} text-right`}>
                {money(summary.totals.totalAmount)}
              </td>
            </tr>
          </tfoot>
        </ScrollTable>
      )}
    </TablePanel>
  );
}

function BatchesTable({
  batches,
  onRetry,
}: {
  batches: Batches;
  onRetry: () => void;
}): ReactElement {
  return (
    <TablePanel
      id="tips-batches-title"
      title="Pagos registrados"
      description="Lotes de pago del local que cubren días de este período."
    >
      {batches.state === 'loading' ? (
        <p role="status" className="p-5 text-sm text-ink2">
          Cargando pagos registrados…
        </p>
      ) : batches.state === 'error' ? (
        <div className="p-5">
          <div role="alert" className={`${alertClass} space-y-3`}>
            <p>No se pudo cargar el historial de pagos. {batches.message}</p>
            <button type="button" onClick={onRetry} className={buttonClass}>
              Reintentar
            </button>
          </div>
        </div>
      ) : batches.items.length === 0 ? (
        <EmptyState>Aún no hay pagos registrados en este período.</EmptyState>
      ) : (
        <ScrollTable caption="Pagos de propinas registrados">
          <thead className={tableHeadClass}>
            <tr>
              <th scope="col" className={tableHeadingClass}>
                Período
              </th>
              <th scope="col" className={`${tableHeadingClass} text-right`}>
                Total
              </th>
              <th
                scope="col"
                className={`${tableHeadingClass} ${wideCell} text-right`}
              >
                Trabajadores
              </th>
              <th scope="col" className={tableHeadingClass}>
                Registrado por
              </th>
            </tr>
          </thead>
          <tbody>
            {batches.items.map((batch) => (
              <tr key={batch.id} className={rowClass}>
                <td className={tableCellClass}>
                  <span className="font-mono whitespace-nowrap">
                    {formatCalendarDate(batch.periodStart)}
                  </span>{' '}
                  al{' '}
                  <span className="font-mono whitespace-nowrap">
                    {formatCalendarDate(batch.periodEnd)}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted sm:hidden">
                    {plural(batch.workerCount, 'trabajador', 'trabajadores')}
                  </span>
                </td>
                <td className={`${tableCellClass} text-right font-medium`}>
                  {money(batch.totalAmount)}
                </td>
                <td
                  className={`${tableCellClass} ${wideCell} text-right tabular-nums`}
                >
                  {batch.workerCount}
                </td>
                <td className={tableCellClass}>
                  <span className="block break-words">{batch.paidBy.name}</span>
                  <span className="mt-1 block font-mono text-[11px] text-muted">
                    {formatChileDate(batch.paidAt)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </TablePanel>
  );
}

function PaymentDialog({
  preview,
  range,
  storeName,
  onClose,
  onPaid,
  onConflict,
  describe,
}: {
  preview: PaymentPreview;
  range: TipsRange;
  storeName: string;
  onClose: () => void;
  onPaid: (batch: PaymentBatch) => void;
  onConflict: (message: string) => void;
  describe: (cause: unknown, fallback: number) => string;
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
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
  async function confirm(): Promise<undefined> {
    // El candado evita un segundo envío antes de que React vuelva a pintar.
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      onPaid(await payTipsPeriod(range));
    } catch (cause) {
      if (cause instanceof TipsRequestError && cause.status === 409)
        onConflict(cause.message);
      else setError(describe(cause, 502));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const title = 'Marcar propinas como pagadas';
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      aria-describedby="tips-payment-description"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className={dialogClass}
    >
      <div className="space-y-5">
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
          <h2 className="text-lg font-bold">{title}</h2>
          <p
            id="tips-payment-description"
            className="mt-2 text-sm leading-6 text-ink2"
          >
            Se registrará como pagado todo lo pendiente del período. Confírmalo
            solo después de entregar el dinero a los trabajadores; el pago no se
            puede deshacer.
          </p>
        </div>
        <dl className="space-y-2 rounded-lg border border-line bg-tint p-4 text-sm">
          <div>
            <dt className="text-xs text-ink2">Local</dt>
            <dd className="font-semibold break-words">{storeName}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink2">Período</dt>
            <dd className="font-mono">
              {periodLabel(preview.from, preview.to)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink2">Total a pagar</dt>
            <dd className="text-base font-bold">
              {money(preview.unpaidAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink2">Trabajadores</dt>
            <dd>{plural(preview.workerCount, 'trabajador', 'trabajadores')}</dd>
          </div>
        </dl>
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
            onClick={() => void confirm()}
            className={primaryButtonClass}
          >
            {busy ? 'Registrando pago…' : 'Confirmar pago'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
