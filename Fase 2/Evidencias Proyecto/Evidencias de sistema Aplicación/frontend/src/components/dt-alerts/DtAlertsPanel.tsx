'use client';
import {
  filterPanelClass,
  labelClass,
  panelTitleClass,
  badgeClass,
  tablePanelClass,
  buttonClass,
  inputClass,
  primaryButtonClass,
} from '@/components/ui/styles';
import { useEffect, useState, type ReactElement } from 'react';
import {
  dtDate,
  dtDocumentTypeLabel,
  dtRemainingLabel,
  filterDtAlerts,
  type DtAlert,
  type DtAlertCollection,
} from '@/lib/dt-alerts';
import { loadDtAlerts } from '@/lib/dt-alerts-client';
import { RegistrationDialog } from './RegistrationDialog';

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
  function reload(): void {
    setState({ status: 'loading' });
    setNotice('');
    setRetry((current) => current + 1);
  }
  function registered(alert: DtAlert): void {
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
        '. El documento se retiró de las alertas pendientes.',
    );
  }
  if (state.status === 'loading')
    return (
      <div
        role="status"
        aria-busy="true"
        className="rounded-[14px] border border-line bg-bg p-6 text-sm text-ink2"
      >
        Consultando alertas de registro en la DT…
      </div>
    );
  if (state.status === 'error')
    return (
      <section
        aria-labelledby="module-load-error"
        className="rounded-[14px] border border-line bg-bg p-5"
      >
        <div role="alert">
          <h2 id="module-load-error" className={panelTitleClass}>
            No se pudieron consultar las alertas
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
          <h2 id="alerts-title" className={panelTitleClass}>
            Documentos pendientes de registro
          </h2>
          <p className="mt-2 text-sm text-ink2">
            Plazos informados por el servicio · Consulta del{' '}
            {new Intl.DateTimeFormat('es-CL', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'America/Santiago',
            }).format(new Date(calculatedAt))}
          </p>
        </div>
        <button type="button" onClick={reload} className={buttonClass}>
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
      <section
        aria-labelledby="module-filters-title"
        className={filterPanelClass}
      >
        <h2 id="module-filters-title" className={`${panelTitleClass} mb-4`}>
          Filtros
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_220px]">
          <label className={labelClass}>
            Buscar trabajador o documento
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre del trabajador o documento"
              className={`${inputClass} mt-2`}
            />
          </label>
          <label className={labelClass}>
            Local
            <select
              aria-label="Local"
              value={store}
              onChange={(event) => setStore(event.target.value)}
              className={`${inputClass} mt-2`}
            >
              <option value="">Todos los locales</option>
              {stores.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Estado
            <select
              aria-label="Estado"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className={`${inputClass} mt-2`}
            >
              <option value="">Todos los pendientes</option>
              <option value="OVERDUE">Vencidos</option>
              <option value="UPCOMING">Próximos a vencer</option>
            </select>
          </label>
        </div>
      </section>
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
              : 'Sin documentos pendientes de registro'}
          </h3>
          <p className="mt-2 text-sm text-ink2">
            {items.length
              ? 'Prueba con otro nombre, local o estado.'
              : 'El servicio no informó documentos próximos a vencer o vencidos sin registro.'}
          </p>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStore('');
                setStatus('');
              }}
              className={'mt-4 ' + buttonClass}
            >
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <ul className={tablePanelClass} aria-label="Alertas de documentos">
          {visible.map((alert) => (
            <li
              key={alert.id}
              className={
                'border-b border-line p-5 last:border-b-0 sm:p-6 ' +
                (alert.status === 'OVERDUE'
                  ? 'border-l-4 border-l-crit'
                  : 'border-l-4 border-l-warn')
              }
            >
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
                <div className="w-full min-w-0 flex-1 sm:w-auto">
                  <p
                    className={`${badgeClass} ${alert.status === 'OVERDUE' ? 'bg-crit-bg text-crit' : 'bg-warn-bg text-warn'}`}
                  >
                    {dtRemainingLabel(alert.daysRemaining)}
                  </p>
                  <h3 className="mt-2 break-words font-bold">
                    {alert.worker.name}
                  </h3>
                  <p className="mt-2 break-words text-sm text-ink2">
                    {dtDocumentTypeLabel(alert.documentType)} ·{' '}
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
                  className={primaryButtonClass}
                >
                  Marcar como registrado
                </button>
              </div>
              {!alert.canRegister && (
                <p className="mt-3 text-xs text-ink2">
                  Solo consulta: no tienes habilitada la confirmación de
                  registro para este documento.
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
          }}
          onRegistered={registered}
        />
      )}
    </section>
  );
}
