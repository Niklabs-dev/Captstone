'use client';
import { useEffect, useState, type ReactElement } from 'react';
import {
  dtDate,
  dtRemainingLabel,
  filterDtAlerts,
  type DtAlert,
  type DtAlertCollection,
} from '@/lib/dt-alerts';
import { loadDtAlerts } from '@/lib/dt-alerts-client';
import { RegistrationDialog } from './RegistrationDialog';
import { alertButton, alertInput, alertPrimary } from './styles';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DtAlertCollection };
export function DtAlertsPanel(): ReactElement {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [store, setStore] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<DtAlert | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    loadDtAlerts(controller.signal).then(
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
                : 'No se pudieron consultar las alertas.',
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
  function registered(alert: DtAlert): undefined {
    setSelected(null);
    setState((current) =>
      current.status === 'ready'
        ? {
            ...current,
            data: {
              ...current.data,
              items: current.data.items.filter((item) => item.id !== alert.id),
            },
          }
        : current,
    );
    setNotice(
      'Registro confirmado para ' +
        alert.worker.name +
        '. El contrato se retiró de las alertas pendientes.',
    );
    return undefined;
  }
  if (state.status === 'loading')
    return (
      <div
        role="status"
        className="rounded-[14px] border border-line bg-bg p-6 text-sm text-ink2"
      >
        Consultando alertas de registro en la DT…
      </div>
    );
  if (state.status === 'error')
    return (
      <section className="rounded-[14px] border border-line2 bg-bg p-6">
        <div role="alert">
          <h2 className="font-bold">No se pudieron consultar las alertas</h2>
          <p className="mt-2 text-sm leading-6 text-ink2">{state.message}</p>
        </div>
        <button
          type="button"
          onClick={reload}
          className={'mt-4 ' + alertButton}
        >
          Reintentar
        </button>
      </section>
    );
  const { items, calculatedAt } = state.data;
  const stores = [
    ...new Map(items.map((item) => [item.store.id, item.store])).values(),
  ];
  const visible = filterDtAlerts(items, search, store, status);
  const overdue = items.filter((item) => item.status === 'OVERDUE').length;
  return (
    <section aria-labelledby="alerts-title" className="min-w-0 space-y-5">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <h2 id="alerts-title" className="text-xl font-bold">
            Contratos pendientes de registro
          </h2>
          <p className="mt-2 text-sm text-ink2">
            Plazos informados por el servicio · Consulta del{' '}
            {new Intl.DateTimeFormat('es-CL', {
              dateStyle: 'short',
              timeStyle: 'short',
              timeZone: 'America/Santiago',
            }).format(new Date(calculatedAt))}
          </p>
        </div>
        <button type="button" onClick={reload} className={alertButton}>
          Actualizar alertas
        </button>
      </div>
      <div
        className="flex flex-wrap gap-x-6 gap-y-2 rounded-[14px] border border-line bg-bg p-5 text-sm"
        aria-label="Resumen de alertas"
      >
        <p>
          <strong className="text-salmon-ink">{overdue}</strong> vencidos
        </p>
        <p>
          <strong>{items.length - overdue}</strong> próximos a vencer
        </p>
        <p className="text-ink2">{items.length} pendientes en total</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_220px]">
        <label className="text-xs font-semibold text-ink2">
          Buscar trabajador o contrato
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nombre del trabajador o contrato"
            className={alertInput}
          />
        </label>
        <label className="text-xs font-semibold text-ink2">
          Local
          <select
            aria-label="Local"
            value={store}
            onChange={(event) => setStore(event.target.value)}
            className={alertInput}
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
          Estado
          <select
            aria-label="Estado"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={alertInput}
          >
            <option value="">Todos los pendientes</option>
            <option value="OVERDUE">Vencidos</option>
            <option value="UPCOMING">Próximos a vencer</option>
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
              : 'Sin contratos pendientes de registro'}
          </h3>
          <p className="mt-2 text-sm text-ink2">
            {items.length
              ? 'Prueba con otro nombre, local o estado.'
              : 'El servicio no informó contratos próximos a vencer o vencidos sin registro.'}
          </p>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStore('');
                setStatus('');
              }}
              className={'mt-4 ' + alertButton}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <ul
          className="overflow-hidden rounded-[14px] border border-line bg-bg"
          aria-label="Alertas de contratos"
        >
          {visible.map((alert) => (
            <li
              key={alert.id}
              className={
                'border-b border-line p-5 last:border-b-0 sm:p-6 ' +
                (alert.status === 'OVERDUE'
                  ? 'border-l-4 border-l-salmon-ink'
                  : 'border-l-4 border-l-line2')
              }
            >
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
                <div className="w-full min-w-0 flex-1 sm:w-auto">
                  <p className="text-xs font-bold uppercase tracking-wide text-salmon-ink">
                    {dtRemainingLabel(alert.daysRemaining)}
                  </p>
                  <h3 className="mt-2 break-words font-bold">
                    {alert.worker.name}
                  </h3>
                  <p className="mt-1 break-words text-sm text-ink2">
                    {alert.contractTitle}
                  </p>
                  <p className="mt-3 text-sm text-ink2">
                    {alert.store.name} · Fecha límite:{' '}
                    <time dateTime={alert.deadline}>
                      {dtDate(alert.deadline)}
                    </time>
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!alert.canRegister}
                  onClick={() => {
                    setNotice('');
                    setSelected(alert);
                  }}
                  className={alertPrimary}
                >
                  Marcar como registrado
                </button>
              </div>
              {!alert.canRegister && (
                <p className="mt-3 text-xs text-ink2">
                  Solo consulta: no tienes habilitada la confirmación de
                  registro para este contrato.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-5 text-ink2">
        El registro debe completarse en la Dirección del Trabajo. Este panel
        permite dejar constancia de que ya se realizó.
      </p>
      {selected && (
        <RegistrationDialog
          alert={selected}
          onClose={() => {
            setSelected(null);
            return undefined;
          }}
          onRegistered={registered}
        />
      )}
    </section>
  );
}
