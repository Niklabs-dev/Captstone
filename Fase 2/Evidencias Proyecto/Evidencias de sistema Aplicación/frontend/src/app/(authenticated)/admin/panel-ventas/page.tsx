import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { SalesDashboardView } from '@/components/sales-overview/SalesDashboardView';
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
import {
  fetchRecentSalesDays,
  fetchSalesDashboard,
} from '@/lib/sales-overview-backend';
import { parseDashboardDate, type SearchValue } from '@/lib/sales-overview';
import { tipBusinessDate } from '@/lib/tips';
import { getUsersSession } from '@/lib/users-session';

export const metadata: Metadata = { title: 'Panel de ventas | MoiFood' };

// SPRINT-4R-T14: panel consolidado del día, exclusivo del administrador.
// Se calcula en el servidor; el token nunca llega al navegador.
export default async function SalesDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: SearchValue }>;
}): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error('No se pudo verificar tu sesión. Intenta nuevamente.');
  }
  const today = tipBusinessDate();
  const selected = parseDashboardDate((await searchParams).date, today);
  const [dashboard, salesDays] = selected.ok
    ? await Promise.all([
        fetchSalesDashboard(session.token, selected.date),
        fetchRecentSalesDays(session.token),
      ])
    : [null, null];
  if (dashboard && !dashboard.ok) {
    if (dashboard.status === 401) redirect('/session-expired');
    if (dashboard.status === 403) redirect('/dashboard?reason=forbidden');
  }
  const value = selected.ok ? selected.date : selected.value;
  return (
    <>
      <p className={introClass}>
        Revisa por local las ventas del Excel de MrComanda vigente, la operación
        diaria de cada supervisor y las alertas legales. Cada cifra conserva su
        fuente: las propinas nunca se suman a las ventas y un dato que falta se
        muestra como «Sin dato».
      </p>
      <section
        aria-labelledby="dashboard-filter-title"
        className={filterPanelClass}
      >
        <h2 id="dashboard-filter-title" className={panelTitleClass}>
          Día del panel
        </h2>
        <form
          key={value}
          action="/admin/panel-ventas"
          method="get"
          className="mt-4 grid items-end gap-4 sm:grid-cols-[minmax(0,16rem)_auto_auto] sm:justify-start"
        >
          <label htmlFor="dashboard-date" className={labelClass}>
            Fecha de negocio
            <input
              id="dashboard-date"
              name="date"
              type="date"
              max={today}
              defaultValue={value}
              className={`${inputClass} mt-2`}
            />
          </label>
          <button type="submit" className={primaryButtonClass}>
            Ver día
          </button>
          <Link
            href="/admin/panel-ventas"
            prefetch={false}
            className={buttonClass}
          >
            Volver a hoy
          </Link>
        </form>
      </section>
      {!selected.ok && (
        <p role="alert" className={alertClass}>
          {selected.message}
        </p>
      )}
      {dashboard && !dashboard.ok && (
        <p role="alert" className={alertClass}>
          No se pudo cargar el panel. {dashboard.message}
        </p>
      )}
      {dashboard?.ok && salesDays && (
        <SalesDashboardView dashboard={dashboard.data} salesDays={salesDays} />
      )}
    </>
  );
}
