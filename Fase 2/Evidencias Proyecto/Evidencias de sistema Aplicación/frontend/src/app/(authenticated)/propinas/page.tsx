import { cookies } from 'next/headers';
import Form from 'next/form';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { DailyTipsWorkspace } from '@/components/tips/DailyTipsWorkspace';
import {
  alertClass,
  buttonClass,
  filterPanelClass,
  infoNoticeClass,
  inlineLinkClass,
  inputClass,
  introClass,
  labelClass,
  panelTitleClass,
  primaryButtonClass,
} from '@/components/ui/styles';
import { ACCESS_COOKIE } from '@/lib/auth';
import {
  addDays,
  MAX_DAILY_TIPS_RANGE_DAYS,
  parseTipsFilters,
  tipsPageHref,
  weekOf,
  type SearchValue,
} from '@/lib/daily-tips';
import { getSession } from '@/lib/session';
import { fetchStores } from '@/lib/stores-backend';
import { tipBusinessDate } from '@/lib/tips';

export const metadata: Metadata = { title: 'Propinas | MoiFood' };

// SPRINT-4A-T07: propinas diarias por local y período para ADMINISTRADOR y
// CONTADOR, con Excel del período y pago por lote. Los repartos por período
// antiguos quedan como histórico de solo lectura en /propinas/historico
// (SPRINT-4A-T08).
export default async function TipsPage({
  searchParams,
}: {
  searchParams: Promise<{
    storeId?: SearchValue;
    from?: SearchValue;
    to?: SearchValue;
  }>;
}): Promise<ReactElement> {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    throw new Error(session.message);
  }
  if (!['ADMINISTRADOR', 'CONTADOR'].includes(session.data.role))
    redirect('/dashboard?reason=forbidden');
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect('/session-expired');
  const stores = await fetchStores(token);
  if (!stores.ok) {
    if (stores.status === 401) redirect('/session-expired');
    throw new Error(stores.message);
  }
  const today = tipBusinessDate();
  const parsed = parseTipsFilters(await searchParams, today, stores.data);
  const { filters } = parsed;
  const store = stores.data.find((item) => item.id === filters.storeId);
  const currentWeek = weekOf(today);
  const previousWeek = weekOf(addDays(currentWeek.from, -1));
  const storeId = store?.id ?? '';
  return (
    <>
      <p className={introClass}>
        Consulta las propinas de cada local por día y por trabajador, descarga
        el Excel del período y registra su pago. El período por defecto es la
        semana actual, de lunes a domingo en hora de Chile, y puede abarcar
        hasta {MAX_DAILY_TIPS_RANGE_DAYS} días. Los repartos por período
        anteriores y sus constancias se consultan en{' '}
        <Link
          href="/propinas/historico"
          prefetch={false}
          className={inlineLinkClass}
        >
          Repartos anteriores
        </Link>
        .
      </p>
      <section aria-labelledby="tips-filter-title" className={filterPanelClass}>
        <h2 id="tips-filter-title" className={panelTitleClass}>
          Filtrar propinas
        </h2>
        <Form
          key={`${filters.storeId}|${filters.from}|${filters.to}`}
          action="/propinas"
          className="mt-4 grid items-end gap-4 md:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_auto]"
        >
          <label htmlFor="tips-store" className={labelClass}>
            Local
            <select
              id="tips-store"
              name="storeId"
              defaultValue={filters.storeId}
              className={`${inputClass} mt-2`}
            >
              {filters.storeId && !store && (
                <option value={filters.storeId}>Local seleccionado</option>
              )}
              {stores.data.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.isActive ? '' : ' (inactivo)'}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="tips-from" className={labelClass}>
            Desde
            <input
              id="tips-from"
              name="from"
              type="date"
              required
              defaultValue={filters.from}
              className={`${inputClass} mt-2`}
            />
          </label>
          <label htmlFor="tips-to" className={labelClass}>
            Hasta
            <input
              id="tips-to"
              name="to"
              type="date"
              required
              defaultValue={filters.to}
              className={`${inputClass} mt-2`}
            />
          </label>
          <button type="submit" className={primaryButtonClass}>
            Consultar propinas
          </button>
        </Form>
        {storeId && (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href={tipsPageHref({ storeId, ...currentWeek })}
              prefetch={false}
              className={buttonClass}
            >
              Semana actual
            </Link>
            <Link
              href={tipsPageHref({ storeId, ...previousWeek })}
              prefetch={false}
              className={buttonClass}
            >
              Semana anterior
            </Link>
          </div>
        )}
      </section>
      {stores.data.length === 0 ? (
        <p role="status" className={infoNoticeClass}>
          No hay locales registrados. Crea un local para consultar sus propinas.
        </p>
      ) : !parsed.ok ? (
        <p role="alert" className={alertClass}>
          {parsed.message}
        </p>
      ) : !store ? (
        <p role="alert" className={alertClass}>
          El local seleccionado no existe. Elige otro local.
        </p>
      ) : (
        <DailyTipsWorkspace
          key={`${filters.storeId}|${filters.from}|${filters.to}`}
          range={filters}
          storeName={store.name}
        />
      )}
    </>
  );
}
