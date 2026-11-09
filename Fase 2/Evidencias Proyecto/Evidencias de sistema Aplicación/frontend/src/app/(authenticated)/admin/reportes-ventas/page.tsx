import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { SalesReportView } from '@/components/sales-overview/SalesReportView';
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
import { fetchSalesReport } from '@/lib/sales-overview-backend';
import {
  MAX_REPORT_DAYS,
  parseReportFilters,
  type SearchValue,
} from '@/lib/sales-overview';
import { fetchStores } from '@/lib/stores-backend';
import { tipBusinessDate } from '@/lib/tips';
import { getUsersSession } from '@/lib/users-session';

export const metadata: Metadata = { title: 'Reportes de ventas | MoiFood' };

// SPRINT-4R-T14: reportes por rango y local, exclusivos del administrador.
export default async function SalesReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: SearchValue;
    to?: SearchValue;
    storeId?: SearchValue;
  }>;
}): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error('No se pudo verificar tu sesión. Intenta nuevamente.');
  }
  const today = tipBusinessDate();
  const parsed = parseReportFilters(await searchParams, today);
  const [stores, report] = await Promise.all([
    fetchStores(session.token),
    parsed.ok ? fetchSalesReport(session.token, parsed.filters) : null,
  ]);
  if (report && !report.ok) {
    if (report.status === 401) redirect('/session-expired');
    if (report.status === 403) redirect('/dashboard?reason=forbidden');
  }
  const { filters } = parsed;
  const storeList = stores.ok ? stores.data : [];
  const scope = filters.storeId
    ? (storeList.find((store) => store.id === filters.storeId)?.name ??
      'Local seleccionado')
    : 'Todos los locales';
  return (
    <>
      <p className={introClass}>
        Consulta las ventas importadas desde el Excel de MrComanda por medio de
        pago y, por separado, las propinas y diferencias de efectivo de la
        operación diaria, para un período de hasta {MAX_REPORT_DAYS} días.
      </p>
      <section
        aria-labelledby="report-filter-title"
        className={filterPanelClass}
      >
        <h2 id="report-filter-title" className={panelTitleClass}>
          Filtrar reporte
        </h2>
        <form
          key={`${filters.from}|${filters.to}|${filters.storeId}`}
          action="/admin/reportes-ventas"
          method="get"
          className="mt-4 grid items-end gap-4 md:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_auto_auto]"
        >
          <label htmlFor="report-from" className={labelClass}>
            Desde
            <input
              id="report-from"
              name="from"
              type="date"
              max={today}
              defaultValue={filters.from}
              className={`${inputClass} mt-2`}
            />
          </label>
          <label htmlFor="report-to" className={labelClass}>
            Hasta
            <input
              id="report-to"
              name="to"
              type="date"
              max={today}
              defaultValue={filters.to}
              className={`${inputClass} mt-2`}
            />
          </label>
          <label htmlFor="report-store" className={labelClass}>
            Local
            <select
              id="report-store"
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
          <button type="submit" className={primaryButtonClass}>
            Generar reporte
          </button>
          <Link
            href="/admin/reportes-ventas"
            prefetch={false}
            className={buttonClass}
          >
            Últimos 7 días
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
      {report && !report.ok && (
        <p role="alert" className={alertClass}>
          No se pudo generar el reporte. {report.message}
        </p>
      )}
      {report?.ok && <SalesReportView report={report.data} scope={scope} />}
    </>
  );
}
