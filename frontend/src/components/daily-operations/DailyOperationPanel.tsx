'use client';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import {
  buttonClass,
  primaryButtonClass,
  inputClass,
  labelClass,
  filterPanelClass,
  panelTitleClass,
  tableCellClass,
  tableClass,
  tableHeadClass,
  tableHeadingClass,
  tablePanelClass,
  tableHeaderClass,
  tableDescriptionClass,
  badgeClass,
} from '@/components/ui/styles';
import {
  createDailyOperation,
  DailyOperationRequestError,
  loadDailyOperationById,
  loadDailyOperations,
  loadEligibleWorkers,
  patchDailyOperation,
} from '@/lib/daily-operations-client';
import {
  dailyFormFieldsFrom,
  dailyOperationCorrectionErrorMessage,
  dailyOperationFieldErrors,
  dailyOperationErrorMessage,
  dailyParticipantSelectionError,
  firstInvalidDailyField,
  formatSignedClp,
  parseCashDifference,
  parseDailyAmount,
  participantIdsToSend,
  previewEqualShares,
  residualDescription,
  voucherFileError,
  type DailyOperation,
  type DailyOperationFieldErrors,
  type DailyOperationFormFields,
  type DailyOperationParticipant,
} from '@/lib/daily-operations';
import { formatCalendarDate } from '@/lib/display-date';
import { formatClp, isTipDate } from '@/lib/tips';

type QueryState =
  | { status: 'loading' | 'idle'; key: string }
  | { status: 'error'; key: string; message: string }
  | { status: 'ready'; key: string; operation: DailyOperation | null };
// Catálogo de trabajadores elegibles del local (SPRINT-4R-T03), consultado una
// vez por local: solo depende de la asignación, no de la fecha consultada.
type WorkersState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; workers: DailyOperationParticipant[] };

// Montos del día por participante con la regla equitativa (SPRINT-4R-T05):
// la misma tabla sirve para la vista previa y para el detalle registrado.
function SharesTable({
  lines,
  caption,
}: {
  lines: { id: string; name: string; amount: number }[];
  caption: string;
}): ReactElement {
  return (
    <table className={`${tableClass} mt-3`}>
      <caption className="sr-only">{caption}</caption>
      <thead className={tableHeadClass}>
        <tr>
          <th scope="col" className={tableHeadingClass}>
            Trabajador
          </th>
          <th scope="col" className={`${tableHeadingClass} text-right`}>
            Monto del día
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id} className="border-b border-line">
            <th
              scope="row"
              className={`${tableCellClass} break-words font-medium`}
            >
              {line.name}
            </th>
            <td
              className={`${tableCellClass} whitespace-nowrap text-right font-medium tabular-nums`}
            >
              {formatClp(line.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DailyOperationPanel({
  store,
  initialDate,
}: {
  store: { id: string; name: string; isActive: boolean };
  initialDate: string;
}): ReactElement {
  const [date, setDate] = useState(initialDate);
  const [cardTip, setCardTip] = useState('');
  const [cashTip, setCashTip] = useState('');
  const [difference, setDifference] = useState('0');
  const [reason, setReason] = useState('');
  const [voucher, setVoucher] = useState<File | null>(null);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  // Operación que se está corrigiendo (SPRINT-4R-T05); null al registrar.
  const [editing, setEditing] = useState<DailyOperation | null>(null);
  // Participantes registrados que ya no son elegibles (desactivados o
  // reasignados): no se pueden volver a enviar y se avisan al corregir.
  const [removedParticipants, setRemovedParticipants] = useState<string[]>([]);
  const [workersRevision, setWorkersRevision] = useState(0);
  const [workers, setWorkers] = useState<WorkersState>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState<QueryState>({
    status: 'loading',
    key: initialDate + ':0',
  });
  const [errors, setErrors] = useState<DailyOperationFieldErrors>({});
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [conflictId, setConflictId] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const formTitle = useRef<HTMLHeadingElement>(null);
  const voucherInput = useRef<HTMLInputElement>(null);
  const participantsBox = useRef<HTMLFieldSetElement>(null);
  const key = date + ':' + revision;
  const current: QueryState = !isTipDate(date)
    ? { status: 'idle', key }
    : query.key === key
      ? query
      : { status: 'loading', key };
  useEffect(() => {
    if (!isTipDate(date)) return;
    const controller = new AbortController();
    loadDailyOperations(store.id, date, controller.signal).then(
      (operations) => {
        if (!controller.signal.aborted)
          setQuery({
            status: 'ready',
            key,
            operation: operations[0] ?? null,
          });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setQuery({
            status: 'error',
            key,
            message:
              cause instanceof DailyOperationRequestError
                ? cause.message
                : dailyOperationErrorMessage(503),
          });
      },
    );
    return () => controller.abort();
  }, [date, key, store.id]);
  useEffect(() => {
    const controller = new AbortController();
    loadEligibleWorkers(store.id, controller.signal).then(
      (list) => {
        if (!controller.signal.aborted)
          setWorkers({ status: 'ready', workers: list });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setWorkers({
            status: 'error',
            message:
              cause instanceof DailyOperationRequestError
                ? cause.message
                : dailyOperationErrorMessage(503),
          });
      },
    );
    return () => controller.abort();
  }, [store.id, workersRevision]);
  function toggleParticipant(id: string, selected: boolean): void {
    setParticipantIds((value) =>
      selected ? [...value, id] : value.filter((item) => item !== id),
    );
    setErrors((value) => ({ ...value, participants: undefined }));
    clearFeedback();
  }
  function toggleAllParticipants(): void {
    if (workers.status !== 'ready') return;
    const allIds = workers.workers.map((worker) => worker.id);
    setParticipantIds((value) =>
      allIds.every((id) => value.includes(id)) ? [] : allIds,
    );
    setErrors((value) => ({ ...value, participants: undefined }));
    clearFeedback();
  }
  function clearFeedback(): void {
    setFailure('');
    setNotice('');
    setConflictId('');
  }
  function resetForm(): void {
    setCardTip('');
    setCashTip('');
    setDifference('0');
    setReason('');
    setVoucher(null);
    setParticipantIds([]);
    setRemovedParticipants([]);
    setErrors({});
    if (voucherInput.current) voucherInput.current.value = '';
  }
  function selectVoucher(file: File | null): void {
    setVoucher(file);
    setErrors((value) => ({
      ...value,
      voucher: file ? (voucherFileError(file) ?? undefined) : undefined,
    }));
    clearFeedback();
  }
  // Precarga el formulario con la operación registrada para corregirla. Solo
  // se conservan los participantes que siguen siendo elegibles del local.
  function startEditing(operation: DailyOperation): void {
    if (workers.status !== 'ready') return;
    const eligible = new Set(workers.workers.map((worker) => worker.id));
    const fields = dailyFormFieldsFrom(operation);
    setCardTip(fields.cardTipAmount);
    setCashTip(fields.cashTipAmount);
    setDifference(fields.cashDifference);
    setReason(fields.differenceReason);
    setVoucher(null);
    if (voucherInput.current) voucherInput.current.value = '';
    setParticipantIds(
      operation.participants
        .filter((participant) => eligible.has(participant.id))
        .map((participant) => participant.id),
    );
    setRemovedParticipants(
      operation.participants
        .filter((participant) => !eligible.has(participant.id))
        .map((participant) => participant.name),
    );
    setErrors({});
    clearFeedback();
    setEditing(operation);
    formTitle.current?.scrollIntoView({ block: 'start' });
    formTitle.current?.focus();
  }
  function cancelEditing(): void {
    setEditing(null);
    resetForm();
    clearFeedback();
  }
  function focusField(field: string): void {
    if (field === 'participants') {
      // Primera casilla; sin trabajadores, el botón de reintento o el grupo.
      const box = participantsBox.current;
      const target =
        box?.querySelector<HTMLElement>('input[type="checkbox"]') ??
        box?.querySelector<HTMLElement>('button') ??
        box;
      target?.focus();
      return;
    }
    const element =
      field === 'voucher'
        ? voucherInput.current
        : form.current?.elements.namedItem(field);
    if (element instanceof HTMLElement) element.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (
      inFlight.current ||
      !store.isActive ||
      current.status !== 'ready' ||
      workers.status !== 'ready'
    )
      return;
    const fields: DailyOperationFormFields = {
      businessDate: date,
      cardTipAmount: cardTip,
      cashTipAmount: cashTip,
      cashDifference: difference,
      differenceReason: reason,
    };
    const cardTipAmount = parseDailyAmount(cardTip);
    const cashTipAmount = parseDailyAmount(cashTip);
    const cashDifference = parseCashDifference(difference);
    const validation = dailyOperationFieldErrors(
      fields,
      voucher !== null,
      Boolean(editing?.voucher),
    );
    if (voucher && !validation.voucher) {
      const fileError = voucherFileError(voucher);
      if (fileError) validation.voucher = fileError;
    }
    const participantsError = dailyParticipantSelectionError(
      cardTipAmount,
      cashTipAmount,
      participantIds.length,
    );
    if (participantsError) validation.participants = participantsError;
    setErrors(validation);
    clearFeedback();
    const invalid = firstInvalidDailyField(validation);
    if (invalid) {
      focusField(invalid);
      return;
    }
    if (
      cardTipAmount === null ||
      cashTipAmount === null ||
      cashDifference === null
    )
      return;
    const selection = participantIdsToSend(
      cardTipAmount + cashTipAmount,
      participantIds,
    );
    inFlight.current = true;
    setSaving(true);
    try {
      if (editing) {
        await patchDailyOperation(
          editing.id,
          {
            cardTipAmount,
            cashTipAmount,
            cashDifference,
            differenceReason: reason,
            participantIds: selection,
          },
          voucher,
        );
        setNotice('Operación diaria corregida correctamente.');
        setEditing(null);
      } else {
        const result = await createDailyOperation(
          {
            storeId: store.id,
            businessDate: date,
            cardTipAmount,
            cashTipAmount,
            cashDifference,
            differenceReason: reason,
            participantIds: selection,
          },
          voucher,
        );
        setNotice(
          result.created
            ? 'Operación diaria registrada correctamente.'
            : 'Esta operación ya estaba registrada con los mismos valores. No se creó un duplicado.',
        );
      }
      resetForm();
      setRevision((value) => value + 1);
    } catch (cause) {
      if (
        !editing &&
        cause instanceof DailyOperationRequestError &&
        cause.status === 409 &&
        cause.existingOperationId
      ) {
        setConflictId(cause.existingOperationId);
        try {
          const existing = await loadDailyOperationById(
            cause.existingOperationId,
            store.id,
            new AbortController().signal,
          );
          setQuery({ status: 'ready', key, operation: existing });
          setFailure(
            'Ya existe una operación registrada para esta fecha con otros valores. Mostramos la registrada.',
          );
        } catch {
          setFailure(cause.message);
        }
      } else if (editing && cause instanceof DailyOperationRequestError) {
        setFailure(
          cause.status === 409
            ? dailyOperationCorrectionErrorMessage(409)
            : cause.message,
        );
      } else {
        setFailure(
          cause instanceof DailyOperationRequestError
            ? cause.message
            : dailyOperationErrorMessage(503),
        );
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  const registered = current.status === 'ready' ? current.operation : null;
  // Con una operación ya registrada se sugiere corregirla; registrar otra
  // con distinto contenido sigue respondiendo 409 con la registrada.
  const showCorrectionHint = registered !== null && editing === null;
  const cardTipPreview = parseDailyAmount(cardTip);
  const cashTipPreview = parseDailyAmount(cashTip);
  const differencePreview = parseCashDifference(difference);
  const fundPreview =
    cardTipPreview !== null && cashTipPreview !== null
      ? cardTipPreview + cashTipPreview
      : null;
  const eligibleWorkers = workers.status === 'ready' ? workers.workers : [];
  const selectedWorkers = eligibleWorkers.filter((worker) =>
    participantIds.includes(worker.id),
  );
  const allSelected =
    eligibleWorkers.length > 0 &&
    selectedWorkers.length === eligibleWorkers.length;
  const sharePreview =
    fundPreview !== null
      ? previewEqualShares(fundPreview, selectedWorkers, date)
      : null;
  const registeredShares = registered
    ? previewEqualShares(
        registered.tipFundAmount,
        registered.participants,
        registered.businessDate,
      )
    : null;
  return (
    <div className="min-w-0 space-y-5">
      <section aria-labelledby="daily-form-title" className={filterPanelClass}>
        <h2
          id="daily-form-title"
          ref={formTitle}
          tabIndex={-1}
          className={`${panelTitleClass} scroll-mt-24 outline-none`}
        >
          {editing ? 'Corregir operación diaria' : 'Registrar operación diaria'}
        </h2>
        <p className="mt-2 break-words text-sm text-ink2">
          Local asignado:{' '}
          <strong className="font-semibold text-ink">{store.name}</strong>
        </p>
        <p className="mt-2 text-xs leading-5 text-ink2">
          La cuenta conectada queda como responsable. Se guarda una operación
          por fecha: propinas con tarjeta y su voucher, propinas en efectivo, la
          diferencia de efectivo declarada y los trabajadores participantes del
          reparto.
        </p>
        {editing && (
          <p
            role="status"
            className="mt-4 rounded-lg border border-line2 bg-tint2 p-3 text-sm text-ink2"
          >
            Estás corrigiendo la operación del{' '}
            {formatCalendarDate(editing.businessDate)}. Los cambios reemplazan
            los valores registrados.
          </p>
        )}
        {!store.isActive && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-warn-bg p-3 text-sm text-warn"
          >
            Tu local está inactivo. Puedes consultar el historial; solicita su
            revisión al administrador para registrar la operación diaria.
          </p>
        )}
        <form
          ref={form}
          onSubmit={submit}
          noValidate
          className="mt-5 space-y-4"
          aria-busy={saving}
        >
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            <legend className="sr-only">Datos de la operación diaria</legend>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <label className={labelClass}>
                Fecha de operación{' '}
                <span className="font-normal">(obligatoria)</span>
                <input
                  name="businessDate"
                  type="date"
                  min="0100-01-01"
                  max="9999-12-31"
                  required
                  disabled={editing !== null}
                  value={date}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDate(value);
                    setErrors(
                      isTipDate(value)
                        ? {}
                        : { businessDate: 'Selecciona una fecha válida.' },
                    );
                    clearFeedback();
                  }}
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.businessDate)}
                  aria-describedby="daily-date-help daily-date-error"
                />
              </label>
              <label className={labelClass}>
                Propina con tarjeta (CLP){' '}
                <span className="font-normal">(obligatoria)</span>
                <input
                  name="cardTipAmount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  value={cardTip}
                  onChange={(event) => {
                    setCardTip(event.target.value);
                    setErrors((value) => ({
                      ...value,
                      cardTipAmount: undefined,
                    }));
                    clearFeedback();
                  }}
                  placeholder="Ej. 12500"
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.cardTipAmount)}
                  aria-describedby="daily-card-help daily-card-error"
                />
              </label>
              <label className={labelClass}>
                Foto del voucher{' '}
                <span className="font-normal">
                  {editing?.voucher
                    ? '(opcional: reemplaza la registrada)'
                    : '(obligatoria si hay propina con tarjeta)'}
                </span>
                <input
                  ref={voucherInput}
                  name="voucher"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) =>
                    selectVoucher(event.target.files?.[0] ?? null)
                  }
                  className={`${inputClass} mt-2 file:mr-3 file:rounded-lg file:border-0 file:bg-tint2 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-salmon-ink hover:file:bg-tint3`}
                  aria-invalid={Boolean(errors.voucher)}
                  aria-describedby="daily-voucher-help daily-voucher-error"
                />
              </label>
              <label className={labelClass}>
                Propina en efectivo (CLP){' '}
                <span className="font-normal">(obligatoria)</span>
                <input
                  name="cashTipAmount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  value={cashTip}
                  onChange={(event) => {
                    setCashTip(event.target.value);
                    setErrors((value) => ({
                      ...value,
                      cashTipAmount: undefined,
                    }));
                    clearFeedback();
                  }}
                  placeholder="Ej. 8000"
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.cashTipAmount)}
                  aria-describedby="daily-cash-help daily-cash-error"
                />
              </label>
              <label className={labelClass}>
                Diferencia de efectivo (CLP){' '}
                <span className="font-normal">
                  (obligatoria, con signo; 0 si no hay)
                </span>
                <input
                  name="cashDifference"
                  type="text"
                  autoComplete="off"
                  required
                  value={difference}
                  onChange={(event) => {
                    setDifference(event.target.value);
                    setErrors((value) => ({
                      ...value,
                      cashDifference: undefined,
                    }));
                    clearFeedback();
                  }}
                  placeholder="Ej. -1500 o 2000"
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.cashDifference)}
                  aria-describedby="daily-difference-help daily-difference-error"
                />
              </label>
              <label className={labelClass}>
                Motivo de la diferencia{' '}
                <span className="font-normal">(obligatorio si no es cero)</span>
                <input
                  name="differenceReason"
                  type="text"
                  autoComplete="off"
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setErrors((value) => ({
                      ...value,
                      differenceReason: undefined,
                    }));
                    clearFeedback();
                  }}
                  placeholder="Ej. Vale de caja firmado por el encargado"
                  className={`${inputClass} mt-2`}
                  aria-invalid={Boolean(errors.differenceReason)}
                  aria-describedby="daily-reason-help daily-reason-error"
                />
              </label>
            </div>
            <fieldset
              ref={participantsBox}
              name="participants"
              tabIndex={-1}
              className="min-w-0 rounded-lg border border-line bg-tint p-4 outline-none"
              aria-describedby="daily-participants-help daily-participants-error"
            >
              <legend className="sr-only">
                Trabajadores participantes del reparto
              </legend>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <p className={labelClass}>
                  Trabajadores participantes{' '}
                  <span className="font-normal">
                    (obligatorio si hay propinas por repartir)
                  </span>
                </p>
                {workers.status === 'ready' && eligibleWorkers.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3">
                    <p
                      aria-live="polite"
                      className="text-sm tabular-nums text-ink2"
                    >
                      {selectedWorkers.length} de {eligibleWorkers.length}{' '}
                      seleccionados
                    </p>
                    <button
                      type="button"
                      onClick={toggleAllParticipants}
                      className={`${buttonClass} min-h-11`}
                    >
                      {allSelected ? 'Quitar selección' : 'Seleccionar todos'}
                    </button>
                  </div>
                )}
              </div>
              {workers.status === 'loading' && (
                <p role="status" className="mt-3 text-sm text-ink2">
                  Consultando trabajadores de tu local…
                </p>
              )}
              {workers.status === 'error' && (
                <div role="alert" className="mt-3 space-y-3 text-sm text-crit">
                  <p>{workers.message}</p>
                  <button
                    type="button"
                    onClick={() => setWorkersRevision((value) => value + 1)}
                    className={buttonClass}
                  >
                    Reintentar trabajadores
                  </button>
                </div>
              )}
              {workers.status === 'ready' && eligibleWorkers.length === 0 && (
                <p role="status" className="mt-3 text-sm text-ink2">
                  No hay trabajadores activos asignados a tu local. Pide al
                  administrador que asigne trabajadores para repartir las
                  propinas.
                </p>
              )}
              {removedParticipants.length > 0 && (
                <p
                  role="status"
                  className="mt-3 rounded-lg bg-warn-bg p-3 text-sm text-warn"
                >
                  Ya no son elegibles en tu local y se quitarán del reparto al
                  guardar: {removedParticipants.join(', ')}.
                </p>
              )}
              {workers.status === 'ready' && eligibleWorkers.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {eligibleWorkers.map((worker) => (
                    <li key={worker.id} className="min-w-0">
                      <label className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg border border-line2 bg-bg px-3 py-2 focus-within:ring-2 focus-within:ring-salmon-ink">
                        <input
                          type="checkbox"
                          name={'participant-' + worker.id}
                          checked={participantIds.includes(worker.id)}
                          onChange={(event) =>
                            toggleParticipant(worker.id, event.target.checked)
                          }
                          className="h-5 w-5 shrink-0 accent-salmon-ink"
                          aria-invalid={Boolean(errors.participants)}
                        />
                        <span className="min-w-0 break-words text-sm font-semibold text-ink">
                          {worker.name}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {fundPreview === 0 && selectedWorkers.length > 0 && (
                <p role="status" className="mt-3 text-sm text-ink2">
                  Sin propinas no hay reparto: la selección no se guardará.
                </p>
              )}
            </fieldset>
            <p
              id="daily-participants-help"
              className="text-xs leading-5 text-ink2"
            >
              Selecciona quiénes participan del reparto del fondo de propinas
              (tarjeta más efectivo). Con fondo mayor que 0 se exige al menos un
              trabajador.
            </p>
            <p
              id="daily-participants-error"
              hidden={!errors.participants}
              className="text-sm text-crit"
            >
              {errors.participants}
            </p>
            <section
              aria-labelledby="daily-preview-title"
              className="min-w-0 rounded-lg border border-line2 bg-bg p-4"
            >
              <h3 id="daily-preview-title" className="text-sm font-semibold">
                Vista previa del reparto del día
              </h3>
              {/* Solo un resumen breve: anunciar la tabla repetiría todo en cada tecla. */}
              <p aria-live="polite" className="sr-only">
                {sharePreview
                  ? `Fondo ${formatClp(sharePreview.tipFundAmount)} entre ${sharePreview.lines.length} participantes.`
                  : ''}
              </p>
              {fundPreview === null && (
                <p className="mt-2 text-sm text-ink2">
                  Ingresa ambas propinas para calcular el monto por trabajador.
                </p>
              )}
              {fundPreview === 0 && (
                <p className="mt-2 text-sm text-ink2">
                  No hay propinas por repartir en esta fecha.
                </p>
              )}
              {fundPreview !== null &&
                fundPreview > 0 &&
                sharePreview === null && (
                  <p className="mt-2 text-sm text-ink2">
                    Fondo de {formatClp(fundPreview)}. Selecciona participantes
                    para ver el monto por trabajador.
                  </p>
                )}
              {sharePreview && (
                <>
                  <dl className="mt-3 grid min-w-0 grid-cols-2 gap-3 text-sm">
                    <div className="min-w-0">
                      <dt className="text-xs text-ink2">Fondo de propinas</dt>
                      <dd className="mt-1 font-semibold tabular-nums">
                        {formatClp(sharePreview.tipFundAmount)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-ink2">Participantes</dt>
                      <dd className="mt-1 font-semibold tabular-nums">
                        {sharePreview.lines.length}
                      </dd>
                    </div>
                  </dl>
                  <SharesTable
                    lines={sharePreview.lines}
                    caption="Monto por trabajador antes de guardar"
                  />
                  <p className="mt-3 text-xs leading-5 text-ink2">
                    {residualDescription(sharePreview)}
                  </p>
                </>
              )}
            </section>
            <p id="daily-date-help" className="text-xs leading-5 text-ink2">
              {editing
                ? 'La fecha no cambia al corregir una operación.'
                : 'Al cambiar la fecha se consulta su operación registrada. Las fechas corresponden al día de negocio en Chile.'}
            </p>
            <p
              id="daily-date-error"
              hidden={!errors.businessDate}
              className="text-sm text-crit"
            >
              {errors.businessDate}
            </p>
            <p id="daily-card-help" className="text-xs leading-5 text-ink2">
              Ingresa pesos completos, sin puntos ni decimales.
              {cardTipPreview !== null && cardTip.trim()
                ? ' Monto a registrar: ' + formatClp(cardTipPreview) + '.'
                : ''}
            </p>
            <p
              id="daily-card-error"
              hidden={!errors.cardTipAmount}
              className="text-sm text-crit"
            >
              {errors.cardTipAmount}
            </p>
            <p id="daily-voucher-help" className="text-xs leading-5 text-ink2">
              Fotografía privada del voucher de propinas con tarjeta. Formatos
              JPEG, PNG o WebP, máximo 5 MiB.
              {editing?.voucher && !voucher
                ? ' Se conserva el voucher registrado mientras haya propina con tarjeta.'
                : ''}
              {voucher
                ? ` Archivo seleccionado: ${voucher.name} (${Math.ceil(voucher.size / 1024)} KiB).`
                : ''}
            </p>
            <p
              id="daily-voucher-error"
              hidden={!errors.voucher}
              className="text-sm text-crit"
            >
              {errors.voucher}
            </p>
            <p id="daily-cash-help" className="text-xs leading-5 text-ink2">
              Ingresa pesos completos, sin puntos ni decimales. El monto puede
              ser cero.
            </p>
            <p
              id="daily-cash-error"
              hidden={!errors.cashTipAmount}
              className="text-sm text-crit"
            >
              {errors.cashTipAmount}
            </p>
            <p
              id="daily-difference-help"
              className="text-xs leading-5 text-ink2"
            >
              Declara el sobrante positivo (por ejemplo 2000) y el faltante
              negativo (por ejemplo -1500).
              {differencePreview !== null && difference.trim()
                ? ' Diferencia a registrar: ' +
                  formatSignedClp(differencePreview) +
                  '.'
                : ''}
            </p>
            <p
              id="daily-difference-error"
              hidden={!errors.cashDifference}
              className="text-sm text-crit"
            >
              {errors.cashDifference}
            </p>
            <p id="daily-reason-help" className="text-xs leading-5 text-ink2">
              Se exige solo cuando la diferencia de efectivo no es cero.
            </p>
            <p
              id="daily-reason-error"
              hidden={!errors.differenceReason}
              className="text-sm text-crit"
            >
              {errors.differenceReason}
            </p>
          </fieldset>
          {Object.values(errors).some(Boolean) && (
            <p role="alert" className="text-sm text-crit">
              Corrige los campos indicados antes de guardar.
            </p>
          )}
          {showCorrectionHint && (
            <p role="status" className="text-sm text-ink2">
              Ya hay una operación registrada para esta fecha. Usa «Corregir
              operación» para modificarla; registrar otros valores responde con
              un conflicto.
            </p>
          )}
          {failure && (
            <p
              role="alert"
              className="rounded-lg border border-crit/20 bg-crit-bg px-3.5 py-3 text-sm text-crit"
            >
              {failure}
              {conflictId && (
                <>
                  {' '}
                  <span className="font-mono break-all">ID {conflictId}</span>
                </>
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={
                saving ||
                !store.isActive ||
                current.status !== 'ready' ||
                workers.status !== 'ready'
              }
              className={primaryButtonClass}
            >
              {saving
                ? 'Guardando…'
                : editing
                  ? 'Guardar corrección'
                  : 'Guardar operación'}
            </button>
            {editing && (
              <button
                type="button"
                disabled={saving}
                onClick={cancelEditing}
                className={buttonClass}
              >
                Cancelar corrección
              </button>
            )}
          </div>
        </form>
      </section>
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-line2 bg-tint2 p-4 text-sm text-ink2"
        >
          {notice}
        </p>
      )}
      <section
        aria-labelledby="daily-registered-title"
        className={`${tablePanelClass} min-w-0`}
        aria-busy={current.status === 'loading'}
      >
        <div className={tableHeaderClass}>
          <div className="min-w-0">
            <h2 id="daily-registered-title" className={panelTitleClass}>
              Operación registrada
              {isTipDate(date) ? ' · ' + formatCalendarDate(date) : ''}
            </h2>
            <p className={tableDescriptionClass}>
              La operación diaria de tu local es la fuente de los montos de
              propina
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {registered && (
              <span className={`${badgeClass} bg-ok-bg text-ok`}>
                Registrada
              </span>
            )}
            {registered && store.isActive && editing === null && (
              <button
                type="button"
                disabled={saving || workers.status !== 'ready'}
                onClick={() => startEditing(registered)}
                className={buttonClass}
              >
                Corregir operación
              </button>
            )}
            <button
              type="button"
              disabled={
                saving ||
                current.status === 'loading' ||
                !isTipDate(date) ||
                editing !== null
              }
              onClick={() => setRevision((value) => value + 1)}
              className={buttonClass}
            >
              Actualizar consulta
            </button>
          </div>
        </div>
        {current.status === 'loading' && (
          <p role="status" className="p-5 text-sm text-ink2">
            Consultando la operación del día…
          </p>
        )}
        {current.status === 'idle' && (
          <p role="status" className="p-5 text-sm text-ink2">
            Selecciona una fecha válida para consultar y registrar la operación
            diaria.
          </p>
        )}
        {current.status === 'error' && (
          <div role="alert" className="space-y-3 p-5 text-sm text-crit">
            <p>{current.message}</p>
            <button
              type="button"
              onClick={() => setRevision((value) => value + 1)}
              className={buttonClass}
            >
              Reintentar consulta
            </button>
          </div>
        )}
        {current.status === 'ready' && !registered && (
          <div className="px-5 py-10 text-center">
            <h3 className="text-sm font-semibold">
              No hay operación registrada para esta fecha
            </h3>
            <p className="mt-2 text-sm text-ink2">
              Completa el formulario para registrar la operación diaria del
              local.
            </p>
          </div>
        )}
        {current.status === 'ready' && registered && (
          <div className="space-y-4 p-5">
            <dl className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Propina con tarjeta</dt>
                <dd className="mt-2 break-words text-sm font-semibold tabular-nums">
                  {formatClp(registered.cardTipAmount)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Propina en efectivo</dt>
                <dd className="mt-2 break-words text-sm font-semibold tabular-nums">
                  {formatClp(registered.cashTipAmount)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Fondo de propinas</dt>
                <dd className="mt-2 break-words text-sm font-semibold tabular-nums">
                  {formatClp(registered.tipFundAmount)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Diferencia de efectivo</dt>
                <dd
                  className={`mt-2 break-words text-sm font-semibold tabular-nums ${
                    registered.cashDifference === 0
                      ? 'text-ink'
                      : registered.cashDifference > 0
                        ? 'text-info'
                        : 'text-warn'
                  }`}
                >
                  {formatSignedClp(registered.cashDifference)}
                </dd>
                {registered.differenceReason && (
                  <dd className="mt-1 break-words text-xs leading-5 text-ink2">
                    {registered.differenceReason}
                  </dd>
                )}
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Responsable</dt>
                <dd className="mt-2 break-words text-sm font-semibold">
                  {registered.responsible.name}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink2">Registrada · Chile</dt>
                <dd className="mt-2 text-sm tabular-nums">
                  <time dateTime={registered.createdAt}>
                    {new Intl.DateTimeFormat('es-CL', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                      timeZone: 'America/Santiago',
                    }).format(new Date(registered.createdAt))}
                  </time>
                </dd>
              </div>
            </dl>
            <div className="min-w-0 rounded-lg border border-line bg-tint p-4">
              <h3 className="text-sm font-semibold">
                Participantes del reparto
              </h3>
              {registeredShares ? (
                <>
                  <SharesTable
                    lines={registeredShares.lines}
                    caption="Monto del día por participante registrado"
                  />
                  <p className="mt-3 text-xs leading-5 text-ink2">
                    {residualDescription(registeredShares)}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-ink2">Sin reparto</p>
              )}
            </div>
            {registered.voucher && (
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-tint p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold">
                    Voucher de propinas con tarjeta
                  </p>
                  <p className="mt-1 break-all text-xs text-muted">
                    {registered.voucher.fileName} ·{' '}
                    {Math.ceil(registered.voucher.sizeBytes / 1024)} KiB ·{' '}
                    <span className="font-mono">
                      {registered.voucher.sha256Hash.slice(0, 16)}…
                    </span>
                  </p>
                </div>
                <a
                  href={'/api/daily-operations/' + registered.id + '/voucher'}
                  className={`${buttonClass} shrink-0`}
                >
                  Descargar voucher
                </a>
              </div>
            )}
            <p className="border-t border-line pt-4 text-xs text-muted">
              ID de la operación:{' '}
              <span className="font-mono break-all">{registered.id}</span>
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
