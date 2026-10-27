'use client';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import {
  loadStores,
  saveStore,
  changeStoreState,
  StoreError,
} from '@/lib/stores-client';
import { type Store, type StoreInput } from '@/lib/stores';
import { StoreDialog, type StoreAction } from './StoreDialog';
import {
  buttonClass,
  primaryButtonClass,
  inputClass,
  labelClass,
  filterPanelClass,
  panelTitleClass,
  tablePanelClass,
  tableHeaderClass,
  tableDescriptionClass,
  tableClass,
  tableHeadClass,
  tableHeadingClass,
  tableCellClass,
  badgeClass,
} from '@/components/ui/styles';

export function StoresPanel(): ReactElement {
  const router = useRouter();
  const [items, setItems] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [action, setAction] = useState<StoreAction | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    loadStores(controller.signal).then(
      (stores) => {
        setItems(stores);
        setError('');
        setLoading(false);
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof StoreError
              ? cause.message
              : 'No se pudo cargar el catálogo.',
          );
          setLoading(false);
        }
      },
    );
    return () => controller.abort();
  }, [revision]);
  function fail(cause: unknown): string {
    if (cause instanceof StoreError) {
      if (cause.status === 401) router.replace('/session-expired');
      if (cause.status === 403) router.replace('/dashboard?reason=forbidden');
      return cause.message;
    }
    return 'No se pudo guardar el local. Actualiza antes de reintentar.';
  }
  async function mutate(input?: StoreInput): Promise<undefined> {
    if (!action || saving.current) return;
    saving.current = true;
    setBusy(true);
    setDialogError('');
    setNotice('');
    try {
      const result =
        action.kind === 'state'
          ? await changeStoreState(action.store)
          : input
            ? await saveStore(
                action.kind === 'edit' ? action.store : null,
                input,
              )
            : null;
      if (!result) return;
      setItems((previous) =>
        [...previous.filter((item) => item.id !== result.id), result].sort(
          (a, b) => a.name.localeCompare(b.name, 'es'),
        ),
      );
      setNotice(
        action.kind === 'create'
          ? 'Local creado. Ya está disponible en los catálogos.'
          : action.kind === 'edit'
            ? 'Local actualizado.'
            : result.isActive
              ? 'Local reactivado.'
              : 'Local desactivado. Su historial se conserva.',
      );
      setAction(null);
      window.dispatchEvent(new Event('stores-updated'));
      router.refresh();
    } catch (cause) {
      setDialogError(fail(cause));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const query = search.trim().toLocaleLowerCase('es');
  const visible = items.filter(
    (item) =>
      (!status || String(item.isActive) === status) &&
      `${item.name} ${item.city} ${item.address}`
        .toLocaleLowerCase('es')
        .includes(query),
  );
  function open(next: StoreAction): void {
    setDialogError('');
    setAction(next);
  }
  return (
    <div className="space-y-5" aria-busy={loading || busy}>
      <section aria-labelledby="stores-filters" className={filterPanelClass}>
        <h2 id="stores-filters" className={panelTitleClass}>
          Filtrar locales
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Buscar local
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={`${inputClass} mt-2`}
              placeholder="Nombre, ciudad o dirección"
            />
          </label>
          <label className={labelClass}>
            Estado
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className={`${inputClass} mt-2`}
            >
              <option value="">Todos los estados</option>
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            disabled={loading || busy}
            className={buttonClass}
            onClick={() => {
              setLoading(true);
              setRevision((value) => value + 1);
            }}
          >
            Actualizar catálogo
          </button>
          <button
            className={primaryButtonClass}
            disabled={loading || busy || Boolean(error)}
            onClick={() => open({ kind: 'create' })}
          >
            Crear local
          </button>
        </div>
      </section>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-crit/20 bg-crit-bg p-4 text-sm text-crit"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-ink2">
          {notice}
        </p>
      )}
      <section aria-labelledby="stores-title" className={tablePanelClass}>
        <div className={tableHeaderClass}>
          <div>
            <h2 id="stores-title" className={panelTitleClass}>
              Locales del sistema
            </h2>
            <p className={tableDescriptionClass}>
              Los locales inactivos conservan su historial y no admiten nuevas
              asignaciones.
            </p>
          </div>
        </div>
        {loading ? (
          <p role="status" className="p-5 text-sm text-ink2">
            Cargando locales…
          </p>
        ) : (
          <>
            <p className="border-b border-line px-4 py-3 text-xs text-ink2 lg:hidden">
              Desliza la tabla para ver todas las columnas y acciones.
            </p>
            <div
              role="region"
              aria-label="Tabla de locales desplazable"
              tabIndex={0}
              className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-salmon-ink"
            >
              <table className={`${tableClass} min-w-[640px]`}>
                <caption className="sr-only">
                  Nombre, ciudad, dirección, estado y acciones de cada local
                </caption>
                <thead className={tableHeadClass}>
                  <tr>
                    {['Local', 'Ciudad', 'Dirección', 'Estado', 'Acciones'].map(
                      (title) => (
                        <th
                          key={title}
                          scope="col"
                          className={tableHeadingClass}
                        >
                          {title}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((store) => (
                    <tr
                      key={store.id}
                      className="border-b border-line last:border-b-0 hover:bg-tint"
                    >
                      <td
                        className={`${tableCellClass} max-w-64 break-words font-semibold`}
                      >
                        {store.name}
                      </td>
                      <td className={`${tableCellClass} max-w-48 break-words`}>
                        {store.city}
                      </td>
                      <td className={`${tableCellClass} max-w-64 break-words`}>
                        {store.address}
                      </td>
                      <td className={tableCellClass}>
                        <span
                          className={`${badgeClass} ${store.isActive ? 'bg-ok-bg text-ok' : 'bg-crit-bg text-crit'}`}
                        >
                          {store.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className={tableCellClass}>
                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={busy}
                            className={buttonClass}
                            aria-label={'Editar ' + store.name}
                            onClick={() => open({ kind: 'edit', store })}
                          >
                            Editar
                          </button>
                          <button
                            disabled={busy}
                            className={buttonClass}
                            aria-label={
                              (store.isActive ? 'Desactivar ' : 'Reactivar ') +
                              store.name
                            }
                            onClick={() => open({ kind: 'state', store })}
                          >
                            {store.isActive ? 'Desactivar' : 'Reactivar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visible.length === 0 && (
              <p className="p-5 text-sm text-ink2">
                {error
                  ? 'El catálogo no está disponible. Actualiza para volver a intentar.'
                  : items.length
                    ? 'No hay locales que coincidan con los filtros.'
                    : 'Aún no hay locales. Crea el primero para comenzar.'}
              </p>
            )}
          </>
        )}
        <p className="border-t border-line px-5 py-4 text-xs text-ink2">
          {visible.length} de {items.length} locales
        </p>
      </section>
      {action && (
        <StoreDialog
          action={action}
          busy={busy}
          error={dialogError}
          onClose={() => {
            if (!saving.current) setAction(null);
          }}
          onSave={(input) => mutate(input)}
          onState={() => mutate()}
        />
      )}
    </div>
  );
}
