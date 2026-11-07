'use client';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import {
  loadPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  changePaymentMethodState,
  PaymentMethodError,
} from '@/lib/payment-methods-client';
import {
  PAYMENT_METHOD_BEHAVIOR_LABELS,
  sortPaymentMethods,
  type PaymentMethod,
  type PaymentMethodCreateInput,
  type PaymentMethodUpdateInput,
} from '@/lib/payment-methods';
import {
  PaymentMethodDialog,
  type PaymentMethodAction,
} from './PaymentMethodDialog';
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

export function PaymentMethodsPanel(): ReactElement {
  const router = useRouter();
  const [items, setItems] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [action, setAction] = useState<PaymentMethodAction | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    loadPaymentMethods({}, controller.signal).then(
      (methods) => {
        setItems(methods);
        setError('');
        setLoading(false);
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof PaymentMethodError
              ? cause.message
              : 'No se pudo cargar el catálogo de medios de pago.',
          );
          setLoading(false);
        }
      },
    );
    return () => controller.abort();
  }, [revision]);
  function fail(cause: unknown): string {
    if (cause instanceof PaymentMethodError) {
      if (cause.status === 401) router.replace('/session-expired');
      if (cause.status === 403) router.replace('/dashboard?reason=forbidden');
      return cause.message;
    }
    return 'No se pudo guardar el medio de pago. Actualiza antes de reintentar.';
  }
  async function mutate(
    input?: PaymentMethodCreateInput | PaymentMethodUpdateInput,
  ): Promise<undefined> {
    if (!action || saving.current) return;
    saving.current = true;
    setBusy(true);
    setDialogError('');
    setNotice('');
    try {
      const result =
        action.kind === 'state'
          ? await changePaymentMethodState(action.method)
          : input
            ? action.kind === 'edit'
              ? await updatePaymentMethod(action.method, input)
              : await createPaymentMethod(input as PaymentMethodCreateInput)
            : null;
      if (!result) return;
      setItems((previous) =>
        sortPaymentMethods([
          ...previous.filter((item) => item.id !== result.id),
          result,
        ]),
      );
      setNotice(
        action.kind === 'create'
          ? 'Medio de pago creado. Ya está disponible en los formularios del sistema.'
          : action.kind === 'edit'
            ? 'Medio de pago actualizado.'
            : result.isActive
              ? 'Medio de pago reactivado.'
              : 'Medio de pago desactivado. Su historial se conserva.',
      );
      setAction(null);
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
      `${item.name} ${item.code}`.toLocaleLowerCase('es').includes(query),
  );
  function open(next: PaymentMethodAction): void {
    setDialogError('');
    setAction(next);
  }
  function renderActions(method: PaymentMethod): ReactElement {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          className={buttonClass}
          aria-label={'Editar ' + method.name}
          onClick={() => open({ kind: 'edit', method })}
        >
          Editar
        </button>
        <button
          disabled={busy}
          className={buttonClass}
          aria-label={
            (method.isActive ? 'Desactivar ' : 'Reactivar ') + method.name
          }
          onClick={() => open({ kind: 'state', method })}
        >
          {method.isActive ? 'Desactivar' : 'Reactivar'}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-5" aria-busy={loading || busy}>
      <section
        aria-labelledby="payment-methods-filters"
        className={filterPanelClass}
      >
        <h2 id="payment-methods-filters" className={panelTitleClass}>
          Filtrar medios de pago
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Buscar medio
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={`${inputClass} mt-2`}
              placeholder="Nombre o código"
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
            Crear medio de pago
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
      <section
        aria-labelledby="payment-methods-title"
        className={tablePanelClass}
      >
        <div className={tableHeaderClass}>
          <div>
            <h2 id="payment-methods-title" className={panelTitleClass}>
              Medios de pago del sistema
            </h2>
            <p className={tableDescriptionClass}>
              Orden, comportamiento en cierre y disponibilidad para propinas.
              Los inactivos conservan su historial.
            </p>
          </div>
        </div>
        {loading ? (
          <p role="status" className="p-5 text-sm text-ink2">
            Cargando medios de pago…
          </p>
        ) : (
          <>
            <ul
              aria-label="Tarjetas de medios de pago"
              className="divide-y divide-line lg:hidden"
            >
              {visible.map((method) => (
                <li key={method.id}>
                  <article aria-label={method.name} className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-base font-bold">{method.name}</h3>
                        <p className="mt-1 text-sm text-ink2 wrap-anywhere">
                          <span className="font-mono text-xs text-muted">
                            {method.code}
                          </span>
                          {' · '}
                          {PAYMENT_METHOD_BEHAVIOR_LABELS[method.behavior]}
                          {' · '}Orden {method.sortOrder}
                        </p>
                        <p className="mt-1 text-xs text-ink2">
                          Propinas: {method.availableForTips ? 'Sí' : 'No'}
                        </p>
                      </div>
                      <span
                        className={
                          badgeClass +
                          ' shrink-0 ' +
                          (method.isActive
                            ? 'bg-ok-bg text-ok'
                            : 'bg-crit-bg text-crit')
                        }
                      >
                        {method.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                    {renderActions(method)}
                  </article>
                </li>
              ))}
            </ul>
            <div
              role="region"
              aria-label="Tabla de medios de pago desplazable"
              tabIndex={0}
              className="hidden min-w-0 max-w-full overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-salmon-ink lg:block"
            >
              <table className={`${tableClass} min-w-[760px]`}>
                <caption className="sr-only">
                  Nombre, código, orden, comportamiento, disponibilidad para
                  propinas, estado y acciones de cada medio de pago.
                </caption>
                <thead className={tableHeadClass}>
                  <tr>
                    {[
                      'Medio de pago',
                      'Código',
                      'Orden',
                      'Comportamiento',
                      'Propinas',
                      'Estado',
                      'Acciones',
                    ].map((title) => (
                      <th key={title} scope="col" className={tableHeadingClass}>
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((method) => (
                    <tr
                      key={method.id}
                      className="border-b border-line last:border-b-0 hover:bg-tint"
                    >
                      <td
                        className={`${tableCellClass} max-w-56 break-words font-semibold`}
                      >
                        {method.name}
                      </td>
                      <td className={`${tableCellClass} font-mono text-xs`}>
                        {method.code}
                      </td>
                      <td className={`${tableCellClass} tabular-nums`}>
                        {method.sortOrder}
                      </td>
                      <td className={`${tableCellClass} max-w-48 break-words`}>
                        {PAYMENT_METHOD_BEHAVIOR_LABELS[method.behavior]}
                      </td>
                      <td className={tableCellClass}>
                        {method.availableForTips ? 'Sí' : 'No'}
                      </td>
                      <td className={tableCellClass}>
                        <span
                          className={`${badgeClass} ${method.isActive ? 'bg-ok-bg text-ok' : 'bg-crit-bg text-crit'}`}
                        >
                          {method.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className={tableCellClass}>
                        {renderActions(method)}
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
                    ? 'No hay medios de pago que coincidan con los filtros.'
                    : 'Aún no hay medios de pago registrados. Crea el primero para comenzar.'}
              </p>
            )}
          </>
        )}
        <p className="border-t border-line px-5 py-4 text-xs text-ink2">
          {visible.length} de {items.length} medios de pago
        </p>
      </section>
      {action && (
        <PaymentMethodDialog
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
