'use client';
import { useEffect, useState, type ReactElement } from 'react';
import {
  filterPayroll,
  payrollPeriodLabel,
  type Payroll,
  type PayrollCollection,
} from '@/lib/payroll';
import { loadPayroll } from '@/lib/payroll-client';
import { PayrollActionDialog, type PayrollAction } from './PayrollActionDialog';
import { payrollButton, payrollInput, payrollPrimary } from './styles';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PayrollCollection };
export function PayrollPanel({
  canManage,
}: {
  canManage: boolean;
}): ReactElement {
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
  function reload(): undefined {
    setState({ status: 'loading' });
    setNotice('');
    setRetry((current) => current + 1);
    return undefined;
  }
  function saved(record: Payroll, published: boolean): undefined {
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
    return undefined;
  }
  if (state.status === 'loading')
    return (
      <p
        role="status"
        className="rounded-[14px] border border-line bg-bg p-6 text-sm text-ink2"
      >
        Consultando liquidaciones…
      </p>
    );
  if (state.status === 'error')
    return (
      <section className="rounded-[14px] border border-line2 bg-bg p-6">
        <div role="alert">
          <h2 className="font-bold">
            No se pudieron consultar las liquidaciones
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink2">{state.message}</p>
        </div>
        <button
          type="button"
          onClick={reload}
          className={'mt-4 ' + payrollButton}
        >
          Reintentar
        </button>
      </section>
    );
  const { items, workers, policy } = state.data;
  const stores = [
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
          <h2 id="payroll-title" className="text-xl font-bold">
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
          <button type="button" onClick={reload} className={payrollButton}>
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
              className={payrollPrimary}
            >
              Subir liquidación
            </button>
          )}
        </div>
      </div>
      {!canManage && (
        <p className="rounded-lg border border-line bg-bg p-4 text-sm text-ink2">
          Acceso de consulta. Solo el contador puede cargar y publicar
          liquidaciones.
        </p>
      )}
      {canManage && !canUpload && (
        <p className="text-sm text-ink2">
          La carga no está habilitada o no hay trabajadores activos disponibles.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-xs font-semibold text-ink2">
          Local
          <select
            aria-label="Local"
            value={store}
            onChange={(event) => setStore(event.target.value)}
            className={payrollInput}
          >
            <option value="">Todos los locales</option>
            {stores.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink2">
          Período
          <input
            type="month"
            min="1900-01"
            max="2199-12"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className={payrollInput}
          />
        </label>
        <label className="text-xs font-semibold text-ink2">
          Estado
          <select
            aria-label="Estado"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={payrollInput}
          >
            <option value="">Todos los estados</option>
            <option value="PENDING_SIGNATURE">Pendiente de firma</option>
            <option value="PUBLISHED">Publicada</option>
          </select>
        </label>
      </div>
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-line bg-bg p-4 text-sm"
        >
          {notice}
        </p>
      )}
      {visible.length === 0 ? (
        <div className="rounded-[14px] border border-line bg-bg px-6 py-12 text-center">
          <h3 className="font-bold">
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
              className={'mt-4 ' + payrollButton}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <ul
          aria-label="Liquidaciones"
          className="overflow-hidden rounded-[14px] border border-line bg-bg"
        >
          {visible.map((item) => (
            <li
              key={item.id}
              className="border-b border-line p-5 last:border-b-0 sm:p-6"
            >
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
                <div className="w-full min-w-0 flex-1 sm:w-auto">
                  <h3 className="break-words font-bold">{item.worker.name}</h3>
                  <p className="mt-1 text-sm text-ink2">
                    {item.worker.store.name} · {payrollPeriodLabel(item.period)}
                  </p>
                  <p className="mt-2 break-words text-sm text-ink2">
                    {item.fileName}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-md border border-line2 bg-tint px-3 py-1.5 text-xs font-semibold text-ink">
                    {item.status === 'PUBLISHED'
                      ? 'Publicada'
                      : 'Pendiente de firma'}
                  </span>
                  {canManage && item.status === 'PENDING_SIGNATURE' && (
                    <button
                      type="button"
                      disabled={!item.canPublish}
                      onClick={() => {
                        setNotice('');
                        setAction({ kind: 'publish', record: item });
                      }}
                      className={payrollPrimary}
                    >
                      Publicar
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-3 text-xs text-ink2">
                {item.status === 'PUBLISHED'
                  ? 'Visible para su trabajador. No se puede editar ni eliminar.'
                  : 'No visible para el trabajador hasta su publicación.'}
              </p>
              {canManage &&
                item.status === 'PENDING_SIGNATURE' &&
                !item.canPublish && (
                  <p className="mt-2 text-xs text-ink2">
                    La publicación de esta liquidación no está habilitada por el
                    servicio.
                  </p>
                )}
              <details className="mt-4 text-xs text-ink2">
                <summary className="cursor-pointer font-semibold">
                  Ver metadatos
                </summary>
                <dl className="mt-3 space-y-2">
                  <div>
                    <dt>SHA-256 registrado</dt>
                    <dd className="mt-1 break-all font-mono">{item.sha256}</dd>
                  </div>
                  <div>
                    <dt>Fecha de carga</dt>
                    <dd>
                      {new Intl.DateTimeFormat('es-CL', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                        timeZone: 'America/Santiago',
                      }).format(new Date(item.createdAt))}
                    </dd>
                  </div>
                  {item.publishedAt && (
                    <div>
                      <dt>Fecha de publicación</dt>
                      <dd>
                        {new Intl.DateTimeFormat('es-CL', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                          timeZone: 'America/Santiago',
                        }).format(new Date(item.publishedAt))}
                      </dd>
                    </div>
                  )}
                </dl>
              </details>
            </li>
          ))}
        </ul>
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
            return undefined;
          }}
          onSaved={saved}
        />
      )}
    </section>
  );
}
