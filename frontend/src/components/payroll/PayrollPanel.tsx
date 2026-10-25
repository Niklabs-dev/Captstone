'use client';
import type { StoreOption } from '@/lib/users';
import { useStoreOptions } from '@/lib/use-store-options';
import { formatCalendarDate, formatChileDate } from '@/lib/display-date';
import {
  tableHeaderClass,
  tableDescriptionClass,
  tableClass,
  tableHeadClass,
  tableHeadingClass,
  tableCellClass,
  badgeClass,
  filterPanelClass,
  labelClass,
  panelTitleClass,
  tablePanelClass,
  buttonClass,
  inputClass,
  primaryButtonClass,
} from '@/components/ui/styles';
import { useEffect, useState, type ReactElement } from 'react';
import {
  filterPayroll,
  payrollBusinessDate,
  payrollPeriodLabel,
  type Payroll,
  type PayrollCollection,
} from '@/lib/payroll';
import { loadPayroll } from '@/lib/payroll-client';
import { PayrollActionDialog, type PayrollAction } from './PayrollActionDialog';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PayrollCollection };
export function PayrollPanel({
  canManage,
}: {
  canManage: boolean;
}): ReactElement {
  const { stores: catalog, catalogError } = useStoreOptions();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [store, setStore] = useState('');
  const [period, setPeriod] = useState('');
  const [status, setStatus] = useState('');
  const [action, setAction] = useState<PayrollAction | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    loadPayroll(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setState({
            status: 'error',
            message:
              cause instanceof Error
                ? cause.message
                : 'No se pudieron consultar las liquidaciones.',
          });
      },
    );
    return () => controller.abort();
  }, [retry]);
  function reload(): void {
    setState({ status: 'loading' });
    setNotice('');
    setRetry((current) => current + 1);
  }
  function saved(record: Payroll, published: boolean): void {
    setAction(null);
    setState((current) =>
      current.status === 'ready'
        ? {
            ...current,
            data: {
              ...current.data,
              items: [
                record,
                ...current.data.items.filter((item) => item.id !== record.id),
              ],
            },
          }
        : current,
    );
    setNotice(
      published
        ? 'Liquidación publicada para ' +
            record.worker.name +
            '. Ya está disponible para su trabajador.'
        : 'Liquidación recibida en estado pendiente de firma. Aún no es visible para el trabajador.',
    );
  }
  if (state.status === 'loading')
    return (
      <p
        role="status"
        aria-busy="true"
        className="rounded-[14px] border border-line bg-bg p-6 text-sm text-ink2"
      >
        Consultando liquidaciones…
      </p>
    );
  if (state.status === 'error')
    return (
      <section
        aria-labelledby="module-load-error"
        className="rounded-[14px] border border-line bg-bg p-5"
      >
        <div role="alert">
          <h2 id="module-load-error" className={panelTitleClass}>
            No se pudieron consultar las liquidaciones
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink2">{state.message}</p>
        </div>
        <button
          type="button"
          onClick={reload}
          className={'mt-4 ' + buttonClass}
        >
          Reintentar
        </button>
      </section>
    );
  const { items, workers, policy } = state.data;
  const stores: StoreOption[] = [
    ...new Map(
      [
        ...workers.map((worker) => worker.store),
        ...items.map((item) => item.worker.store),
      ].map((store) => [store.id, store]),
    ).values(),
  ];
  const visible = filterPayroll(items, store, period, status);
  const canUpload =
    canManage && policy.canUpload && workers.some((worker) => worker.isActive);
  return (
    <section aria-labelledby="payroll-title" className="min-w-0 space-y-5">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <h2 id="payroll-title" className={panelTitleClass}>
            Liquidaciones por trabajador
          </h2>
          <p className="mt-2 text-sm text-ink2">
            Pendientes de firma:{' '}
            {items.filter((item) => item.status === 'PENDING_SIGNATURE').length}
            {' · '}Publicadas:{' '}
            {items.filter((item) => item.status === 'PUBLISHED').length}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={reload} className={buttonClass}>
            Actualizar listado
          </button>
          {canManage && (
            <button
              type="button"
              disabled={!canUpload}
              onClick={() => {
                setNotice('');
                setAction({ kind: 'upload', collection: state.data });
              }}
              className={primaryButtonClass}
            >
              Subir liquidación
            </button>
          )}
        </div>
      </div>
      {!canManage && (
        <p className="rounded-xl border border-line2 bg-tint2 p-4 text-sm text-ink2 text-ink2">
          Acceso de consulta. Solo el contador puede cargar y publicar
          liquidaciones.
        </p>
      )}
      {canManage && !canUpload && (
        <p className="text-sm text-ink2">
          La carga no está habilitada o no hay trabajadores activos disponibles.
        </p>
      )}
      <section
        aria-labelledby="module-filters-title"
        className={filterPanelClass}
      >
        <h2 id="module-filters-title" className={`${panelTitleClass} mb-4`}>
          Filtros
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className={labelClass}>
            Local
            <select
              aria-label="Local"
              value={store}
              onChange={(event) => setStore(event.target.value)}
              className={`${inputClass} mt-2`}
            >
              <option value="">Todos los locales</option>
              {(catalog.length || !catalogError ? catalog : stores).map(
                (item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.isActive === false ? ' (inactivo)' : ''}
                  </option>
                ),
              )}
            </select>
          </label>
          {catalogError && (
            <p role="alert" className="text-sm text-crit">
              {catalogError}
            </p>
          )}
          <label className={labelClass}>
            Período
            <input
              type="month"
              min="1900-01"
              max={payrollBusinessDate().slice(0, 7)}
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className={`${inputClass} mt-2`}
            />
          </label>
          <label className={labelClass}>
            Estado
            <select
              aria-label="Estado"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className={`${inputClass} mt-2`}
            >
              <option value="">Todos los estados</option>
              <option value="PENDING_SIGNATURE">Pendiente de firma</option>
              <option value="PUBLISHED">Publicada</option>
            </select>
          </label>
        </div>
      </section>
      {Boolean(state.data.invalidCount) && (
        <p role="alert" className="rounded-lg bg-warn-bg p-4 text-sm text-ink2">
          No se pudieron verificar {state.data.invalidCount} liquidaciones. Se
          muestran las válidas; informa al administrador.
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-line2 bg-tint2 p-4 text-sm text-ink2"
        >
          {notice}
        </p>
      )}
      {visible.length === 0 ? (
        <div className="rounded-[14px] border border-line bg-bg px-6 py-12 text-center">
          <h3 className={panelTitleClass}>
            {items.length
              ? 'Sin resultados para estos filtros'
              : 'Aún no hay liquidaciones'}
          </h3>
          <p className="mt-2 text-sm text-ink2">
            {items.length
              ? 'Prueba con otro local, período o estado.'
              : 'Las liquidaciones aparecerán aquí cuando se carguen.'}
          </p>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setStore('');
                setPeriod('');
                setStatus('');
              }}
              className={'mt-4 ' + buttonClass}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <section
          aria-labelledby="payroll-table-title"
          className={tablePanelClass}
        >
          <header className={tableHeaderClass}>
            <div>
              <h2 id="payroll-table-title" className={panelTitleClass}>
                Liquidaciones registradas
              </h2>
              <p className={tableDescriptionClass}>
                Estado, firma y publicación por trabajador y período.
              </p>
            </div>
          </header>
          <div
            role="region"
            aria-label="Tabla de liquidaciones"
            tabIndex={0}
            className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-salmon-ink"
          >
            <table className={tableClass}>
              <caption className="sr-only">Liquidaciones</caption>
              <thead className={tableHeadClass}>
                <tr>
                  {[
                    'Trabajador y archivo',
                    'Período',
                    'Estado',
                    'Fecha de firma',
                    'Acciones',
                  ].map((column) => (
                    <th key={column} scope="col" className={tableHeadingClass}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-line last:border-b-0 hover:bg-tint"
                  >
                    <td className={tableCellClass}>
                      <h3 className="font-semibold">{item.worker.name}</h3>
                      <p className="mt-2 text-xs text-ink2">
                        {item.worker.store.name}
                      </p>
                      <p className="mt-2 break-words text-sm text-ink2">
                        {item.fileName}
                      </p>
                      <details className="mt-3 text-xs text-ink2">
                        <summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-salmon-ink">
                          Ver metadatos
                        </summary>
                        <dl className="mt-3 space-y-2">
                          <div>
                            <dt>SHA-256 registrado</dt>
                            <dd className="max-w-64 break-all font-mono">
                              {item.sha256}
                            </dd>
                          </div>
                          <div>
                            <dt>Fecha de carga</dt>
                            <dd>
                              {new Intl.DateTimeFormat('es-CL', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'America/Santiago',
                              }).format(new Date(item.createdAt))}
                            </dd>
                          </div>
                          {item.publishedAt && (
                            <div>
                              <dt>Fecha de publicación</dt>
                              <dd>{formatChileDate(item.publishedAt)}</dd>
                            </div>
                          )}
                          {item.signedAt && (
                            <div>
                              <dt>Fecha de firma</dt>
                              <dd>{formatCalendarDate(item.signedAt)}</dd>
                            </div>
                          )}
                        </dl>
                      </details>
                    </td>
                    <td className={tableCellClass}>
                      {payrollPeriodLabel(item.period)}
                    </td>
                    <td className={tableCellClass}>
                      <span
                        className={`${badgeClass} ${item.status === 'PUBLISHED' ? 'bg-ok-bg text-ok' : 'bg-tint2 text-salmon-ink'}`}
                      >
                        {item.status === 'PUBLISHED'
                          ? 'Publicada'
                          : 'Pendiente de firma'}
                      </span>
                      <p className="mt-3 max-w-64 text-xs text-ink2">
                        {item.status === 'PUBLISHED'
                          ? 'Visible para su trabajador. No se puede editar ni eliminar.'
                          : 'No visible para el trabajador hasta su publicación.'}
                      </p>
                    </td>
                    <td className={tableCellClass}>
                      {item.signedAt
                        ? formatCalendarDate(item.signedAt)
                        : 'Pendiente de firma'}
                    </td>
                    <td className={tableCellClass}>
                      {canManage && item.status === 'PENDING_SIGNATURE' && (
                        <>
                          <button
                            type="button"
                            disabled={!item.canPublish}
                            onClick={() => {
                              setNotice('');
                              setAction({ kind: 'publish', record: item });
                            }}
                            className={primaryButtonClass}
                          >
                            Publicar
                          </button>
                          {!item.canPublish && (
                            <p className="mt-2 text-xs text-ink2">
                              La publicación de esta liquidación no está
                              habilitada por el servicio.
                            </p>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="border-t border-line px-5 py-4 text-xs text-ink2">
            {visible.length} liquidaciones
          </footer>
        </section>
      )}
      <p className="text-xs leading-5 text-ink2">
        La publicación se confirma individualmente para cada trabajador y
        período.
      </p>
      {action && (
        <PayrollActionDialog
          action={action}
          onClose={() => {
            setAction(null);
          }}
          onSaved={saved}
        />
      )}
    </section>
  );
}
