import { cookies } from 'next/headers';
import Form from 'next/form';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import {
  MyDailyTipsError,
  MyDailyTipsList,
  MyDailyTipsTotals,
} from '@/components/tips/MyDailyTips';
import { MyTipReceiptsPanel } from '@/components/tips/MyTipReceiptsPanel';
import {
  buttonClass,
  filterPanelClass,
  infoNoticeClass,
  inputClass,
  introClass,
  labelClass,
  panelTitleClass,
  primaryButtonClass,
} from '@/components/ui/styles';
import { ACCESS_COOKIE } from '@/lib/auth';
import { canReadOwnTipReceipts } from '@/lib/my-tip-receipts';
import {
  formatMonth,
  monthOptions,
  myTipsPageHref,
  parseMonthFilter,
  shiftMonth,
} from '@/lib/my-tips';
import { fetchMyTips } from '@/lib/my-tips-backend';
import { getSession } from '@/lib/session';
import { tipBusinessDate } from '@/lib/tips';

export const metadata: Metadata = { title: 'Mis propinas | MoiFood' };

// Portal del trabajador (SPRINT-4A-T10): las propinas de cada día del mes
// con su estado (No pagada o Pagada) y los totales pendiente y pagado, desde
// GET /my-tips (SPRINT-4A-T09). TRABAJADOR y SUPERVISOR ven solo las suyas.
// Las constancias de los repartos por período anteriores siguen abajo.
export default async function MyTipsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}): Promise<ReactElement> {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    throw new Error(session.message);
  }
  if (!canReadOwnTipReceipts(session.data.role))
    redirect('/dashboard?reason=forbidden');
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect('/session-expired');

  const today = tipBusinessDate();
  const filter = parseMonthFilter((await searchParams).month, today);
  const { range } = filter;
  const tips = await fetchMyTips(token, range);
  if (!tips.ok && tips.status === 401) redirect('/session-expired');
  const currentMonth = today.slice(0, 7);

  return (
    <>
      <p className={introClass}>
        Revisa cuánto te tocó de propina cada día y si ya te la pagaron. Las
        propinas del día quedan No pagadas hasta que se registra su pago. Esta
        sección es de solo lectura.
      </p>
      <section
        aria-labelledby="my-tips-filter-title"
        className={filterPanelClass}
      >
        <h2 id="my-tips-filter-title" className={panelTitleClass}>
          Elegir mes
        </h2>
        <Form
          key={range.month}
          action="/portal/propinas"
          className="mt-4 grid items-end gap-4 sm:grid-cols-[minmax(0,16rem)_auto] sm:justify-start"
        >
          <label htmlFor="my-tips-month" className={labelClass}>
            Mes
            <select
              id="my-tips-month"
              name="month"
              defaultValue={range.month}
              className={`${inputClass} mt-2`}
            >
              {monthOptions(today, range.month).map((month) => (
                <option key={month} value={month}>
                  {formatMonth(month)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={primaryButtonClass}>
            Consultar mes
          </button>
        </Form>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href={myTipsPageHref(shiftMonth(range.month, -1))}
            prefetch={false}
            className={buttonClass}
          >
            Mes anterior
          </Link>
          {range.month !== currentMonth && (
            <Link
              href={myTipsPageHref(currentMonth)}
              prefetch={false}
              className={buttonClass}
            >
              Mes actual
            </Link>
          )}
        </div>
      </section>
      {!filter.ok && (
        <p role="status" className={infoNoticeClass}>
          {filter.message}
        </p>
      )}
      {tips.ok ? (
        <>
          <MyDailyTipsTotals tips={tips.data} />
          <MyDailyTipsList tips={tips.data} month={range.month} />
        </>
      ) : (
        <MyDailyTipsError message={tips.message} month={range.month} />
      )}
      <MyTipReceiptsPanel key={session.data.id} workerId={session.data.id} />
    </>
  );
}
