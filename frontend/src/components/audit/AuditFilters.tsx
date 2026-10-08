import type { ReactElement } from 'react';
import { AUDIT_PAGE_SIZE, type AuditStore } from '@/lib/audit';

export function AuditFilters({
  stores,
  selected,
  limit,
  queryKey,
}: {
  stores: AuditStore[];
  selected: { storeId: string; from: string; to: string };
  limit: number;
  queryKey: string;
}): ReactElement {
  const inputStyle =
    'mt-2 w-full min-w-0 rounded-lg border border-line2 bg-bg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-salmon-deep';
  const missingStore =
    selected.storeId && !stores.some((store) => store.id === selected.storeId);
  return (
    <section
      aria-labelledby="audit-filter-title"
      className="rounded-[14px] border border-line bg-bg p-5"
    >
      <h2 id="audit-filter-title" className="text-sm font-bold">
        Filtrar operaciones
      </h2>
      {/* El formulario vacío limpia la URL y los campos, incluso antes de aplicar cambios. */}
      <form
        id="clear-audit-filters"
        action="/admin/auditoria"
        method="get"
        className="hidden"
      />
      <form
        key={queryKey}
        action="/admin/auditoria"
        method="get"
        className="mt-4 grid items-end gap-4 md:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_auto]"
      >
        <input type="hidden" name="limit" value={limit || AUDIT_PAGE_SIZE} />
        <input type="hidden" name="offset" value="0" />
        <label
          htmlFor="audit-store"
          className="min-w-0 text-xs font-semibold text-ink2"
        >
          Local
          <select
            id="audit-store"
            name="storeId"
            defaultValue={selected.storeId}
            className={inputStyle}
          >
            <option value="">Todos los locales y operaciones globales</option>
            {missingStore && (
              <option value={selected.storeId}>Local seleccionado</option>
            )}
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        <label
          htmlFor="audit-from"
          className="min-w-0 text-xs font-semibold text-ink2"
        >
          Desde
          <input
            id="audit-from"
            name="from"
            type="date"
            defaultValue={selected.from}
            className={inputStyle}
            aria-describedby="audit-date-help"
          />
        </label>
        <label
          htmlFor="audit-to"
          className="min-w-0 text-xs font-semibold text-ink2"
        >
          Hasta
          <input
            id="audit-to"
            name="to"
            type="date"
            defaultValue={selected.to}
            className={inputStyle}
            aria-describedby="audit-date-help"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-lg bg-salmon px-4 py-2 text-sm font-semibold text-white hover:bg-salmon-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon-ink"
          >
            Aplicar filtros
          </button>
          <button
            type="submit"
            form="clear-audit-filters"
            className="rounded-lg border border-line2 px-4 py-2 text-sm font-semibold text-salmon-ink hover:bg-tint"
          >
            Limpiar
          </button>
        </div>
      </form>
      <p id="audit-date-help" className="mt-3 text-xs text-muted">
        Fechas inclusivas según la hora de Chile. Puedes dejar uno o ambos
        extremos vacíos.
      </p>
      {stores.length === 0 && (
        <p className="mt-2 text-xs text-ink2">
          No hay locales disponibles para seleccionar. Puedes consultar todas
          las operaciones y filtrar por fecha.
        </p>
      )}
    </section>
  );
}
