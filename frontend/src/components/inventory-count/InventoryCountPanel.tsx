'use client';

import {
  useCallback,
  useEffect,
  useMemo,
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
  infoNoticeClass,
  inputClass,
  labelClass,
  panelTitleClass,
  primaryButtonClass,
  tableDescriptionClass,
  tableHeaderClass,
  tablePanelClass,
} from '@/components/ui/styles';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import {
  COUNT_STATUS_LABELS,
  MAX_SEARCH_LENGTH,
  countDateError,
  countDateRange,
  countProgress,
  draftFromLine,
  filterCountItems,
  formatChileTime,
  groupCountItems,
  inventoryCountErrorMessage,
  isDraftDirty,
  lineInputFromDraft,
  personName,
  replaceCountItem,
  type CountAction,
  type CountDraft,
  type CountItem,
  type CountItemFilter,
  type InventoryCountDetail,
  type InventoryCountFinalization,
  type InventoryCountSummary,
} from '@/lib/inventory-count';
import {
  InventoryCountRequestError,
  finalizeCount,
  listCounts,
  loadCount,
  saveCountLine,
  startCount,
} from '@/lib/inventory-count-client';
import { CountItemCard, type SaveState } from './CountItemCard';
import { FinalizeCountDialog } from './FinalizeCountDialog';

type View =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'start'; latest: InventoryCountSummary | null }
  | { status: 'count'; count: InventoryCountDetail };

// null: la toma en curso del local, o iniciar una si no hay.
type Target = { countId: string | null; revision: number };

function errorMessage(cause: unknown, action: CountAction): string {
  return cause instanceof InventoryCountRequestError
    ? cause.message
    : inventoryCountErrorMessage(503, action);
}

// Toma de inventario del supervisor (SPRINT-5-T07): retoma la toma en curso
// de su local o inicia una, guarda cada producto por separado y la finaliza.
export function InventoryCountPanel({
  storeName,
  today,
}: {
  storeName: string;
  today: string;
}): ReactElement {
  const [view, setView] = useState<View>({ status: 'loading' });
  const [target, setTarget] = useState<Target>({ countId: null, revision: 0 });
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function resolve(): Promise<View> {
      if (target.countId)
        return {
          status: 'count',
          count: await loadCount(target.countId, signal),
        };
      const [open, confirmed] = await Promise.all([
        listCounts('OPEN', signal),
        listCounts('CONFIRMED', signal),
      ]);
      if (open[0])
        return { status: 'count', count: await loadCount(open[0].id, signal) };
      return { status: 'start', latest: confirmed[0] ?? null };
    }
    resolve().then(
      (next) => {
        if (!signal.aborted) setView(next);
      },
      (cause: unknown) => {
        if (!signal.aborted)
          setView({ status: 'error', message: errorMessage(cause, 'load') });
      },
    );
    return () => controller.abort();
  }, [target]);

  const go = useCallback((countId: string | null, message = ''): undefined => {
    setNotice(message);
    setView({ status: 'loading' });
    setTarget((current) => ({ countId, revision: current.revision + 1 }));
  }, []);

  return (
    <div className="min-w-0 space-y-5" aria-busy={view.status === 'loading'}>
      {notice && (
        <p role="status" className={infoNoticeClass}>
          {notice}
        </p>
      )}
      {view.status === 'loading' && (
        <p role="status" className={filterPanelClass}>
          Cargando la toma de inventario…
        </p>
      )}
      {view.status === 'error' && (
        <div role="alert" className={`${alertClass} space-y-3`}>
          <p>{view.message}</p>
          <button
            type="button"
            onClick={() => go(target.countId)}
            className={buttonClass}
          >
            Reintentar
          </button>
        </div>
      )}
      {view.status === 'start' && (
        <StartCount
          storeName={storeName}
          today={today}
          latest={view.latest}
          onOpen={go}
        />
      )}
      {view.status === 'count' && (
        <CountWorkspace
          key={view.count.id + view.count.status}
          count={view.count}
          onOpen={go}
        />
      )}
    </div>
  );
}

function StartCount({
  storeName,
  today,
  latest,
  onOpen,
}: {
  storeName: string;
  today: string;
  latest: InventoryCountSummary | null;
  onOpen: (countId: string | null, message?: string) => undefined;
}): ReactElement {
  const [countDate, setCountDate] = useState(today);
  const [dateError, setDateError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const range = countDateRange(today);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (busy) return;
    const invalid = countDateError(countDate, today);
    setDateError(invalid ?? '');
    setError('');
    if (invalid) return;
    setBusy(true);
    try {
      const count = await startCount(countDate);
      onOpen(
        count.id,
        `Toma del ${formatCalendarDate(count.countDate)} iniciada. Guarda cada producto al contarlo.`,
      );
    } catch (cause) {
      if (cause instanceof InventoryCountRequestError && cause.conflict) {
        onOpen(
          cause.conflict.existingCountId,
          `Ya había una toma en curso del ${formatCalendarDate(cause.conflict.existingCountDate)}: la retomas donde quedó.`,
        );
        return;
      }
      if (
        cause instanceof InventoryCountRequestError &&
        cause.fieldErrors?.countDate
      )
        setDateError(cause.fieldErrors.countDate);
      setError(errorMessage(cause, 'start'));
      setBusy(false);
    }
  }

  return (
    <>
      <section aria-labelledby="count-start-title" className={filterPanelClass}>
        <h2 id="count-start-title" className={panelTitleClass}>
          Iniciar toma de inventario
        </h2>
        <p className="mt-1 text-sm text-ink2">
          Local {storeName}. La toma conserva esta fecha aunque la finalices
          después de medianoche.
        </p>
        <form
          onSubmit={submit}
          noValidate
          className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end"
        >
          <div className="min-w-0 sm:w-56">
            <label htmlFor="count-date" className={labelClass}>
              Fecha de la toma
            </label>
            <input
              id="count-date"
              type="date"
              className={`${inputClass} mt-2`}
              value={countDate}
              min={range.min}
              max={range.max}
              disabled={busy}
              onChange={(event) => {
                setCountDate(event.target.value);
                setDateError('');
              }}
              aria-invalid={Boolean(dateError)}
              aria-describedby={
                dateError
                  ? 'count-date-help count-date-error'
                  : 'count-date-help'
              }
            />
            <p id="count-date-help" className="mt-1 text-xs text-ink2">
              Hoy o hasta 7 días atrás.
            </p>
            {dateError && (
              <p id="count-date-error" className="mt-1 text-xs text-crit">
                {dateError}
              </p>
            )}
          </div>
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {busy ? 'Iniciando…' : 'Iniciar toma'}
          </button>
        </form>
        {error && (
          <p role="alert" className={`${alertClass} mt-4`}>
            {error}
          </p>
        )}
      </section>
      {latest ? (
        <section
          aria-labelledby="count-latest-title"
          className={filterPanelClass}
        >
          <h2 id="count-latest-title" className={panelTitleClass}>
            Última toma finalizada
          </h2>
          <p className="mt-1 text-sm text-ink2">
            Toma del{' '}
            <span className="font-mono">
              {formatCalendarDate(latest.countDate)}
            </span>{' '}
            · {latest.countedProducts}{' '}
            {latest.countedProducts === 1
              ? 'producto contado'
              : 'productos contados'}
          </p>
          <button
            type="button"
            onClick={() => onOpen(latest.id)}
            className={`${buttonClass} mt-4`}
          >
            Ver toma del {formatCalendarDate(latest.countDate)}
          </button>
        </section>
      ) : (
        <p className={infoNoticeClass}>
          Tu local todavía no tiene tomas finalizadas.
        </p>
      )}
    </>
  );
}

function CountWorkspace({
  count,
  onOpen,
}: {
  count: InventoryCountDetail;
  onOpen: (countId: string | null, message?: string) => undefined;
}): ReactElement {
  const readOnly = count.status === 'CONFIRMED';
  const [items, setItems] = useState<CountItem[]>(count.items);
  const [drafts, setDrafts] = useState<Record<string, CountDraft>>({});
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CountItemFilter>('all');
  const [finalizing, setFinalizing] = useState(false);
  const [finalBusy, setFinalBusy] = useState(false);
  const [finalError, setFinalError] = useState('');
  // Últimos valores para las funciones estables que reciben las tarjetas.
  const itemsRef = useRef(items);
  const draftsRef = useRef(drafts);
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    itemsRef.current = items;
    draftsRef.current = drafts;
  }, [items, drafts]);

  const unsaved = useMemo(
    () =>
      items.filter((item) => {
        const draft = drafts[item.product.id];
        return (
          draft !== undefined && isDraftDirty(item.product, draft, item.line)
        );
      }).length,
    [items, drafts],
  );
  // Aviso del navegador antes de salir con productos sin guardar.
  useEffect(() => {
    if (unsaved === 0) return;
    const warn = (event: BeforeUnloadEvent): undefined => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const onChange = useCallback(
    (
      productId: string,
      draft: CountDraft,
      field: keyof CountDraft,
    ): undefined => {
      setDrafts((current) => ({ ...current, [productId]: draft }));
      setSaves((current) => {
        const state = current[productId];
        if (state?.status !== 'error' || !state.fieldErrors[field])
          return current;
        const fieldErrors = { ...state.fieldErrors };
        delete fieldErrors[field];
        return { ...current, [productId]: { ...state, fieldErrors } };
      });
    },
    [],
  );

  const onSave = useCallback(
    async (productId: string): Promise<undefined> => {
      const item = itemsRef.current.find(
        (entry) => entry.product.id === productId,
      );
      if (!item || inFlight.current.has(productId)) return;
      const draft = draftsRef.current[productId] ?? draftFromLine(item.line);
      const result = lineInputFromDraft(item.product, draft);
      if ('errors' in result) {
        setSaves((current) => ({
          ...current,
          [productId]: {
            status: 'error',
            message: 'Revisa los campos indicados antes de guardar.',
            fieldErrors: result.errors,
          },
        }));
        return;
      }
      inFlight.current.add(productId);
      setSaves((current) => ({
        ...current,
        [productId]: { status: 'saving' },
      }));
      try {
        const saved = await saveCountLine(count.id, productId, result.input);
        setItems((current) => replaceCountItem(current, saved));
        // Si siguió escribiendo mientras se guardaba, se conserva lo nuevo.
        setDrafts((current) => {
          if (current[productId] !== draft) return current;
          const next = { ...current };
          delete next[productId];
          return next;
        });
        setSaves((current) => {
          const next = { ...current };
          delete next[productId];
          return next;
        });
      } catch (cause) {
        if (
          cause instanceof InventoryCountRequestError &&
          cause.status === 409 &&
          cause.fieldErrors?.countId
        ) {
          onOpen(
            count.id,
            'La toma ya fue finalizada y no admite cambios: se muestra en solo lectura.',
          );
          return;
        }
        const productError =
          cause instanceof InventoryCountRequestError
            ? cause.fieldErrors?.productId
            : undefined;
        setSaves((current) => ({
          ...current,
          [productId]: {
            status: 'error',
            message: productError ?? errorMessage(cause, 'save'),
            fieldErrors:
              cause instanceof InventoryCountRequestError
                ? (cause.fieldErrors ?? {})
                : {},
          },
        }));
      } finally {
        inFlight.current.delete(productId);
      }
    },
    [count.id, onOpen],
  );

  async function confirmFinalize(): Promise<undefined> {
    if (finalBusy) return;
    setFinalBusy(true);
    setFinalError('');
    try {
      const result: InventoryCountFinalization = await finalizeCount(count.id);
      onOpen(
        count.id,
        `Inventario finalizado: ${result.countedProducts} ${result.countedProducts === 1 ? 'producto contado' : 'productos contados'} y ${result.uncountedProducts} sin contar. La toma quedó en solo lectura.`,
      );
    } catch (cause) {
      if (cause instanceof InventoryCountRequestError && cause.status === 409) {
        onOpen(count.id, cause.message);
        return;
      }
      setFinalError(errorMessage(cause, 'finalize'));
      setFinalBusy(false);
    }
  }

  const progress = countProgress(items);
  const visible = filterCountItems(items, search, filter);
  const sections = groupCountItems(visible);
  const totals = new Map(
    groupCountItems(items).map((section) => [section.name, section]),
  );

  return (
    <>
      <section aria-labelledby="count-title" className={filterPanelClass}>
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="count-title" className={panelTitleClass}>
                Toma del{' '}
                <span className="font-mono">
                  {formatCalendarDate(count.countDate)}
                </span>
              </h2>
              <span
                className={`${badgeClass} ${readOnly ? 'bg-ok-bg text-ok' : 'bg-tint2 text-salmon-ink'}`}
              >
                {COUNT_STATUS_LABELS[count.status]}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink2">
              {count.store.name} · iniciada por {personName(count.startedBy)}
            </p>
            {readOnly && count.finalizedAt && count.finalizedBy && (
              <p className="mt-1 text-sm text-ink2">
                Finalizada el{' '}
                <span className="font-mono">
                  {formatChileDate(count.finalizedAt)}{' '}
                  {formatChileTime(count.finalizedAt)}
                </span>{' '}
                por {personName(count.finalizedBy)}
              </p>
            )}
          </div>
          {readOnly ? (
            <button
              type="button"
              onClick={() => onOpen(null)}
              className={buttonClass}
            >
              Iniciar una toma nueva
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setFinalError('');
                setFinalizing(true);
              }}
              className={primaryButtonClass}
            >
              Finalizar inventario
            </button>
          )}
        </div>
        <div className="mt-4">
          <p className="text-sm font-semibold" aria-live="polite">
            Contados {progress.counted} de {progress.total}
          </p>
          <div
            role="progressbar"
            aria-label="Avance de la toma"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.counted}
            aria-valuetext={`${progress.counted} de ${progress.total} productos contados`}
            className="mt-2 h-2 overflow-hidden rounded-full bg-tint2"
          >
            <div
              className="h-full rounded-full bg-salmon transition-[width]"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          {!readOnly && unsaved > 0 && (
            <p className="mt-2 text-xs text-warn">
              {unsaved === 1
                ? '1 producto con cambios sin guardar.'
                : `${unsaved} productos con cambios sin guardar.`}
            </p>
          )}
        </div>
        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="min-w-0">
            <label htmlFor="count-search" className={labelClass}>
              Buscar producto
            </label>
            <input
              id="count-search"
              type="search"
              className={`${inputClass} mt-2`}
              value={search}
              maxLength={MAX_SEARCH_LENGTH}
              placeholder="Nombre, nombre alternativo o SKU"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="count-filter" className={labelClass}>
              Mostrar
            </label>
            <select
              id="count-filter"
              className={`${inputClass} mt-2`}
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as CountItemFilter)
              }
            >
              <option value="all">Todos</option>
              <option value="pending">Sin contar</option>
              <option value="counted">Contados</option>
            </select>
          </div>
        </div>
      </section>

      {items.length === 0 ? (
        <p role="status" className={filterPanelClass}>
          {readOnly
            ? 'Esta toma no tiene productos.'
            : 'No hay productos activos en la plantilla de inventario. Pide al administrador que los cree en Productos.'}
        </p>
      ) : (
        sections.length === 0 && (
          <p role="status" className={filterPanelClass}>
            Ningún producto coincide con la búsqueda.
          </p>
        )
      )}

      {sections.map((section) => {
        const all = totals.get(section.name);
        return (
          <section
            key={section.id}
            aria-labelledby={section.id}
            className={tablePanelClass}
          >
            <header className={tableHeaderClass}>
              <div className="min-w-0">
                <h2
                  id={section.id}
                  className={`${panelTitleClass} break-words`}
                >
                  {section.name}
                </h2>
                <p className={tableDescriptionClass}>
                  Contados {all?.counted ?? section.counted} de{' '}
                  {all?.items.length ?? section.items.length}
                </p>
              </div>
            </header>
            <ul
              aria-label={`Productos de ${section.name}`}
              className="divide-y divide-line"
            >
              {section.items.map((item) => (
                <CountItemCard
                  key={item.product.id}
                  item={item}
                  draft={drafts[item.product.id]}
                  saveState={saves[item.product.id]}
                  readOnly={readOnly}
                  onChange={onChange}
                  onSave={onSave}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {finalizing && (
        <FinalizeCountDialog
          countDate={count.countDate}
          storeName={count.store.name}
          items={items}
          unsaved={unsaved}
          busy={finalBusy}
          error={finalError}
          onClose={() => {
            setFinalizing(false);
            return undefined;
          }}
          onConfirm={confirmFinalize}
        />
      )}
    </>
  );
}
