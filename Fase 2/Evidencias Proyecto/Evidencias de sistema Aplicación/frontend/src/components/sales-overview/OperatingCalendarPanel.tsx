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
  dangerButtonClass,
  dialogActionsClass,
  dialogClass,
  filterPanelClass,
  inputClass,
  labelClass,
  panelTitleClass,
  primaryButtonClass,
  scrollRegionClass,
  tableCellClass,
  tableClass,
  tableDescriptionClass,
  tableHeadClass,
  tableHeaderClass,
  tableHeadingClass,
  tablePanelClass,
} from '@/components/ui/styles';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import {
  addStoreClosure,
  CalendarRequestError,
  loadOperatingCalendar,
  removeStoreClosure,
  saveOperatingCalendar,
} from '@/lib/operating-calendar-client';
import {
  calendarError,
  calendarFormError,
  closureFormError,
  MAX_CLOSURE_REASON_LENGTH,
  WEEKDAYS,
  weekdaysSummary,
  type OperatingCalendar,
  type StoreClosure,
} from '@/lib/sales-overview';
import type { StoreOption } from '@/lib/users';

// Calendario de operación de cada local (SPRINT-4R-T14): días en que abre,
// desde cuándo se exigen ventas importadas y cierres por excepción. No es
// una gestión de horarios ni turnos de trabajadores.
type CalendarState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; calendar: OperatingCalendar };

const noticeClass =
  'rounded-lg border border-line2 bg-tint2 px-3.5 py-3 text-sm text-ink2';

function errorText(cause: unknown): string {
  return cause instanceof CalendarRequestError
    ? cause.message
    : calendarError(503);
}
function byDateDesc(a: StoreClosure, b: StoreClosure): number {
  return b.date.localeCompare(a.date);
}

function RemoveClosureDialog({
  closure,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  closure: StoreClosure;
  busy: boolean;
  error: string;
  onConfirm: () => undefined;
  onClose: () => undefined;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const title = 'Quitar cierre';
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
      aria-label={title}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className={dialogClass}
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          aria-label="Cerrar ventana"
          className={buttonClass}
        >
          ×
        </button>
      </div>
      {error && (
        <p role="alert" className={`${alertClass} mb-4`}>
          {error}
        </p>
      )}
      <p className="text-sm break-words text-ink2">
        El {formatCalendarDate(closure.date)} volverá a evaluarse con el
        calendario semanal: si el local abre ese día y no tiene ventas
        importadas, aparecerá como atrasado. La auditoría conserva el cierre
        retirado.
      </p>
      <p className="mt-3 text-sm font-semibold break-words">{closure.reason}</p>
      <div className={`mt-6 ${dialogActionsClass}`}>
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
          onClick={onConfirm}
          className={dangerButtonClass}
        >
          {busy ? 'Quitando…' : 'Quitar cierre'}
        </button>
      </div>
    </dialog>
  );
}

export function OperatingCalendarPanel({
  stores,
  today,
}: {
  stores: StoreOption[];
  today: string;
}): ReactElement {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [state, setState] = useState<CalendarState>(
    stores.length ? { status: 'loading' } : { status: 'empty' },
  );
  const [revision, setRevision] = useState(0);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [trackingStartDate, setTrackingStartDate] = useState(today);
  const [closureDate, setClosureDate] = useState('');
  const [closureReason, setClosureReason] = useState('');
  const [busy, setBusy] = useState<'' | 'calendar' | 'closure' | 'remove'>('');
  const [calendarFailure, setCalendarFailure] = useState('');
  const [closureFailure, setClosureFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState<StoreClosure | null>(null);
  const [removeFailure, setRemoveFailure] = useState('');

  useEffect(() => {
    if (!storeId) return;
    const controller = new AbortController();
    loadOperatingCalendar(storeId, controller.signal).then(
      (calendar) => {
        if (controller.signal.aborted) return;
        setState({ status: 'ready', calendar });
        setWeekdays(calendar.weekdays);
        setTrackingStartDate(calendar.trackingStartDate ?? today);
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setState({ status: 'error', message: errorText(cause) });
      },
    );
    return () => controller.abort();
  }, [storeId, revision, today]);

  function reset(): void {
    setState({ status: 'loading' });
    setNotice('');
    setCalendarFailure('');
    setClosureFailure('');
  }
  // Volver a elegir el mismo local también recarga: así el estado de carga
  // nunca queda sin una consulta que lo resuelva.
  function chooseStore(next: string): void {
    reset();
    setStoreId(next);
    setRevision((value) => value + 1);
  }
  function reload(): void {
    reset();
    setRevision((value) => value + 1);
  }
  function toggleWeekday(day: number, checked: boolean): void {
    setWeekdays((current) =>
      checked
        ? [...current.filter((value) => value !== day), day].sort(
            (a, b) => a - b,
          )
        : current.filter((value) => value !== day),
    );
  }
  function updateClosures(
    update: (closures: StoreClosure[]) => StoreClosure[],
  ): void {
    setState((current) =>
      current.status === 'ready'
        ? {
            status: 'ready',
            calendar: {
              ...current.calendar,
              closures: update(current.calendar.closures).sort(byDateDesc),
            },
          }
        : current,
    );
  }

  async function saveCalendar(
    event: FormEvent<HTMLFormElement>,
  ): Promise<undefined> {
    event.preventDefault();
    if (busy) return;
    setNotice('');
    const invalid = calendarFormError(weekdays, trackingStartDate);
    if (invalid) {
      setCalendarFailure(invalid);
      return;
    }
    setCalendarFailure('');
    setBusy('calendar');
    try {
      const calendar = await saveOperatingCalendar(storeId, {
        weekdays,
        trackingStartDate,
      });
      setState({ status: 'ready', calendar });
      setWeekdays(calendar.weekdays);
      setNotice('Calendario semanal guardado.');
    } catch (cause) {
      setCalendarFailure(errorText(cause));
    } finally {
      setBusy('');
    }
  }
  async function addClosure(
    event: FormEvent<HTMLFormElement>,
  ): Promise<undefined> {
    event.preventDefault();
    if (busy) return;
    setNotice('');
    const invalid = closureFormError(closureDate, closureReason);
    if (invalid) {
      setClosureFailure(invalid);
      return;
    }
    setClosureFailure('');
    setBusy('closure');
    try {
      const closure = await addStoreClosure(storeId, {
        date: closureDate,
        reason: closureReason.trim(),
      });
      updateClosures((closures) => [...closures, closure]);
      setClosureDate('');
      setClosureReason('');
      setNotice(
        `Cierre registrado para el ${formatCalendarDate(closure.date)}.`,
      );
    } catch (cause) {
      setClosureFailure(errorText(cause));
    } finally {
      setBusy('');
    }
  }
  async function confirmRemove(): Promise<undefined> {
    if (!removing || busy) return;
    setBusy('remove');
    setRemoveFailure('');
    try {
      const removed = await removeStoreClosure(storeId, removing.id);
      updateClosures((closures) =>
        closures.filter((item) => item.id !== removed.id),
      );
      setRemoving(null);
      setNotice(`Cierre del ${formatCalendarDate(removed.date)} quitado.`);
    } catch (cause) {
      setRemoveFailure(errorText(cause));
    } finally {
      setBusy('');
    }
  }

  if (state.status === 'empty')
    return (
      <p role="status" className={noticeClass}>
        No hay locales activos. Crea o reactiva un local desde Locales para
        configurar su calendario.
      </p>
    );

  const calendar = state.status === 'ready' ? state.calendar : null;
  const storeName = stores.find((store) => store.id === storeId)?.name ?? '';
  return (
    <div className="min-w-0 space-y-5">
      <section
        aria-labelledby="calendar-store-title"
        className={filterPanelClass}
      >
        <h2 id="calendar-store-title" className={panelTitleClass}>
          Local
        </h2>
        <label
          htmlFor="calendar-store"
          className={`${labelClass} mt-4 max-w-md`}
        >
          Local a revisar
          <select
            id="calendar-store"
            value={storeId}
            disabled={busy !== ''}
            onChange={(event) => chooseStore(event.target.value)}
            className={`${inputClass} mt-2`}
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {notice && (
        <p role="status" className={noticeClass}>
          {notice}
        </p>
      )}
      {state.status === 'loading' && (
        <p role="status" aria-busy="true" className="text-sm text-ink2">
          Cargando calendario…
        </p>
      )}
      {state.status === 'error' && (
        <div role="alert" className={`${alertClass} space-y-3`}>
          <p>{state.message}</p>
          <button type="button" onClick={reload} className={buttonClass}>
            Reintentar
          </button>
        </div>
      )}

      {calendar && (
        <>
          <section
            aria-labelledby="calendar-weekly-title"
            className={filterPanelClass}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="calendar-weekly-title" className={panelTitleClass}>
                Configuración semanal · {storeName}
              </h2>
              <span
                className={`${badgeClass} ${calendar.configured ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn'}`}
              >
                {calendar.configured ? 'Configurado' : 'Sin configurar'}
              </span>
            </div>
            <dl className="mt-4 grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Abre</dt>
                <dd className="mt-1 font-medium break-words">
                  {calendar.configured
                    ? weekdaysSummary(calendar.weekdays)
                    : 'Sin días configurados'}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Exige ventas desde</dt>
                <dd className="mt-1 font-medium">
                  {calendar.trackingStartDate
                    ? formatCalendarDate(calendar.trackingStartDate)
                    : 'Sin fecha: no genera alertas'}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Última modificación</dt>
                <dd className="mt-1 font-medium break-words">
                  {calendar.updatedAt && calendar.updatedBy
                    ? `${formatChileDate(calendar.updatedAt)} · ${calendar.updatedBy.name}`
                    : 'Nunca'}
                </dd>
              </div>
            </dl>
            <form
              noValidate
              onSubmit={(event) => void saveCalendar(event)}
              className="mt-5 space-y-4 border-t border-line pt-5"
            >
              <fieldset className="min-w-0">
                <legend className={labelClass}>Días en que abre</legend>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                  {WEEKDAYS.map((day) => (
                    <label
                      key={day.value}
                      className="flex min-h-11 items-center gap-2 rounded-lg border border-line2 px-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={weekdays.includes(day.value)}
                        disabled={busy !== ''}
                        onChange={(event) =>
                          toggleWeekday(day.value, event.target.checked)
                        }
                        className="h-4 w-4 accent-salmon-ink"
                      />
                      {day.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label
                htmlFor="calendar-start"
                className={`${labelClass} max-w-xs`}
              >
                Exigir ventas importadas desde
                <input
                  id="calendar-start"
                  type="date"
                  value={trackingStartDate}
                  disabled={busy !== ''}
                  onChange={(event) => setTrackingStartDate(event.target.value)}
                  className={`${inputClass} mt-2`}
                />
              </label>
              <p className="text-xs text-ink2">
                Los días que el local no abre quedan cerrados y nunca se
                muestran como ventas faltantes. Los anteriores a la fecha de
                inicio no se informan.
              </p>
              {calendarFailure && (
                <p role="alert" className={alertClass}>
                  {calendarFailure}
                </p>
              )}
              <button
                type="submit"
                disabled={busy !== ''}
                className={primaryButtonClass}
              >
                {busy === 'calendar' ? 'Guardando…' : 'Guardar calendario'}
              </button>
            </form>
          </section>

          <section
            aria-labelledby="calendar-closures-title"
            className={tablePanelClass}
          >
            <header className={tableHeaderClass}>
              <div className="min-w-0">
                <h2 id="calendar-closures-title" className={panelTitleClass}>
                  Cierres por excepción
                </h2>
                <p className={tableDescriptionClass}>
                  Días puntuales en que el local no abre (feriados,
                  mantenciones). Ese día no se exigen ventas, salvo que igual se
                  importen.
                </p>
              </div>
              <span className={`${badgeClass} bg-tint2 text-salmon-ink`}>
                {calendar.closures.length} cierres
              </span>
            </header>
            <form
              noValidate
              onSubmit={(event) => void addClosure(event)}
              className="grid items-end gap-4 border-b border-line p-5 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]"
            >
              <label htmlFor="closure-date" className={labelClass}>
                Fecha del cierre
                <input
                  id="closure-date"
                  type="date"
                  value={closureDate}
                  disabled={busy !== ''}
                  onChange={(event) => setClosureDate(event.target.value)}
                  className={`${inputClass} mt-2`}
                />
              </label>
              <label htmlFor="closure-reason" className={labelClass}>
                Motivo del cierre
                <input
                  id="closure-reason"
                  type="text"
                  value={closureReason}
                  maxLength={MAX_CLOSURE_REASON_LENGTH}
                  disabled={busy !== ''}
                  onChange={(event) => setClosureReason(event.target.value)}
                  className={`${inputClass} mt-2`}
                />
              </label>
              <button
                type="submit"
                disabled={busy !== ''}
                className={primaryButtonClass}
              >
                {busy === 'closure' ? 'Registrando…' : 'Registrar cierre'}
              </button>
              {closureFailure && (
                <p role="alert" className={`${alertClass} md:col-span-3`}>
                  {closureFailure}
                </p>
              )}
            </form>
            {calendar.closures.length === 0 ? (
              <p role="status" className="p-5 text-sm text-ink2">
                Este local no tiene cierres por excepción registrados.
              </p>
            ) : (
              <div
                role="region"
                aria-label={`Cierres por excepción de ${storeName}`}
                tabIndex={0}
                className={scrollRegionClass}
              >
                <table className={tableClass}>
                  <caption className="sr-only">
                    Cierres por excepción de {storeName}
                  </caption>
                  <thead className={tableHeadClass}>
                    <tr>
                      <th scope="col" className={tableHeadingClass}>
                        Fecha
                      </th>
                      <th scope="col" className={tableHeadingClass}>
                        Motivo
                      </th>
                      <th scope="col" className={tableHeadingClass}>
                        Registrado por
                      </th>
                      <th scope="col" className={tableHeadingClass}>
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {calendar.closures.map((closure) => (
                      <tr
                        key={closure.id}
                        className="border-b border-line last:border-b-0 hover:bg-tint"
                      >
                        <td
                          className={`${tableCellClass} whitespace-nowrap font-mono`}
                        >
                          {formatCalendarDate(closure.date)}
                        </td>
                        <th
                          scope="row"
                          className={`${tableCellClass} min-w-48 break-words font-medium`}
                        >
                          {closure.reason}
                        </th>
                        <td
                          className={`${tableCellClass} min-w-36 break-words`}
                        >
                          {closure.createdBy.name}
                          <span className="block text-xs text-muted">
                            {formatChileDate(closure.createdAt)}
                          </span>
                        </td>
                        <td className={tableCellClass}>
                          <button
                            type="button"
                            disabled={busy !== ''}
                            onClick={() => {
                              setRemoveFailure('');
                              setRemoving(closure);
                            }}
                            className={buttonClass}
                            aria-label={`Quitar cierre del ${formatCalendarDate(closure.date)}`}
                          >
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {removing && (
        <RemoveClosureDialog
          closure={removing}
          busy={busy === 'remove'}
          error={removeFailure}
          onConfirm={() => {
            void confirmRemove();
            return undefined;
          }}
          onClose={() => {
            setRemoving(null);
            return undefined;
          }}
        />
      )}
    </div>
  );
}
