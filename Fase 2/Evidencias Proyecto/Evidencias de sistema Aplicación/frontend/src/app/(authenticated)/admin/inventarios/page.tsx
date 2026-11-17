import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { InventoryCountList } from '@/components/inventory-counts/InventoryCountList';
import {
  alertClass,
  buttonClass,
  filterPanelClass,
  inputClass,
  introClass,
  labelClass,
  panelTitleClass,
  primaryButtonClass,
} from '@/components/ui/styles';
import { fetchInventoryCounts } from '@/lib/inventory-counts-backend';
import {
  COUNT_STATUS_LABELS,
  hasCountFilters,
  parseCountFilters,
  type SearchValue,
} from '@/lib/inventory-counts';
import { fetchStores } from '@/lib/stores-backend';
import { tipBusinessDate } from '@/lib/tips';
import { getUsersSession } from '@/lib/users-session';

export const metadata: Metadata = { title: 'Inventarios | MoiFood' };

// SPRINT-5-T09: tomas de inventario de todos los locales, exclusivas del
// administrador, filtrables por local, estado y rango de fechas de la toma.
// El supervisor las hace desde su vista; aquí solo se revisan y descargan.
export default async function InventoryCountsPage({
  searchParams,
}: {
  searchParams: Promise<{
    storeId?: SearchValue;
    status?: SearchValue;
    from?: SearchValue;
    to?: SearchValue;
  }>;
}): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error('No se pudo verificar tu sesión. Intenta nuevamente.');
  }
  const parsed = parseCountFilters(await searchParams);
  const [stores, counts] = await Promise.all([
    fetchStores(session.token),
    parsed.ok ? fetchInventoryCounts(session.token, parsed.filters) : null,
  ]);
  if (counts && !counts.ok) {
    if (counts.status === 401) redirect('/session-expired');
    if (counts.status === 403) redirect('/dashboard?reason=forbidden');
  }
  const { filters } = parsed;
  const storeList = stores.ok ? stores.data : [];
  const scope = filters.storeId
    ? (storeList.find((store) => store.id === filters.storeId)?.name ??
      'Local seleccionado')
    : 'Todos los locales';
  const today = tipBusinessDate();
  return (
    <>
      <p className={introClass}>
        Revisa las tomas de inventario de cada local y descarga en Excel las
        finalizadas. Las tomas en curso se muestran con su avance, sin descarga.
      </p>
      <section
        aria-labelledby="count-filter-title"
        className={filterPanelClass}
      >
        <h2 id="count-filter-title" className={panelTitleClass}>
          Filtrar tomas
        </h2>
        <form
          key={`${filters.storeId}|${filters.status}|${filters.from}|${filters.to}`}
          action="/admin/inventarios"
          method="get"
          className="mt-4 grid items-end gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]"
        >
          <label htmlFor="count-store" className={labelClass}>
            Local
            <select
              id="count-store"
              name="storeId"
              defaultValue={filters.storeId}
              className={`${inputClass} mt-2`}
            >
              <option value="">Todos los locales</option>
              {filters.storeId &&
                !storeList.some((store) => store.id === filters.storeId) && (
                  <option value={filters.storeId}>Local seleccionado</option>
                )}
              {storeList.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                  {store.isActive ? '' : ' (inactivo)'}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="count-status" className={labelClass}>
            Estado
            <select
              id="count-status"
              name="status"
              defaultValue={filters.status}
              className={`${inputClass} mt-2`}
            >
              <option value="">Todos los estados</option>
              <option value="OPEN">{COUNT_STATUS_LABELS.OPEN}</option>
              <option value="CONFIRMED">{COUNT_STATUS_LABELS.CONFIRMED}</option>
            </select>
          </label>
          <label htmlFor="count-from" className={labelClass}>
            Desde
            <input
              id="count-from"
              name="from"
              type="date"
              max={today}
              defaultValue={filters.from}
              className={`${inputClass} mt-2`}
            />
          </label>
          <label htmlFor="count-to" className={labelClass}>
            Hasta
            <input
              id="count-to"
              name="to"
              type="date"
              max={today}
              defaultValue={filters.to}
              className={`${inputClass} mt-2`}
            />
          </label>
          <button type="submit" className={primaryButtonClass}>
            Filtrar
          </button>
          <Link
            href="/admin/inventarios"
            prefetch={false}
            className={buttonClass}
          >
            Limpiar filtros
          </Link>
        </form>
        {!stores.ok && (
          <p role="alert" className={`${alertClass} mt-4`}>
            {stores.message}
          </p>
        )}
      </section>
      {!parsed.ok && (
        <p role="alert" className={alertClass}>
          {parsed.message}
        </p>
      )}
      {counts && !counts.ok && (
        <p role="alert" className={alertClass}>
          No se pudieron cargar las tomas de inventario. {counts.message}
        </p>
      )}
      {counts?.ok && counts.data.length === 0 && (
        <p role="status" className={filterPanelClass}>
          {hasCountFilters(filters)
            ? 'No hay tomas de inventario con estos filtros.'
            : 'Todavía no hay tomas de inventario. Aparecerán aquí cuando un supervisor inicie la de su local.'}
        </p>
      )}
      {counts?.ok && counts.data.length > 0 && (
        <InventoryCountList counts={counts.data} scope={scope} />
      )}
    </>
  );
}
