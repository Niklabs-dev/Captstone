import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { DailyOperationDetail } from '@/components/sales-overview/DailyOperationDetail';
import { alertClass, buttonClass } from '@/components/ui/styles';
import { isProxyUuid } from '@/lib/backend-proxy';
import { fetchOperationDetail } from '@/lib/sales-overview-backend';
import { reportDayHref, salesOverviewError } from '@/lib/sales-overview';
import { getSalesReportsSession } from '@/lib/sales-reports-session';

export const metadata: Metadata = {
  title: 'Operación diaria | Reportes de ventas | MoiFood',
};

// SPRINT-4A-T23: detalle de solo lectura de la operación diaria enlazado
// desde los reportes de ventas. Lo abren ADMINISTRADOR y CONTADOR para
// revisar el voucher, la propina declarada y la diferencia de efectivo junto
// a las ventas del día por medio de pago. No ofrece ninguna edición.
export default async function ReportDailyOperationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const session = await getSalesReportsSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error('No se pudo verificar tu sesión. Intenta nuevamente.');
  }
  const { id } = await params;
  const result = isProxyUuid(id)
    ? await fetchOperationDetail(session.token, id)
    : { ok: false as const, status: 404, message: salesOverviewError(404) };
  if (!result.ok) {
    if (result.status === 401) redirect('/session-expired');
    return (
      <>
        <p role="alert" className={alertClass}>
          La operación diaria no está disponible. {result.message}
        </p>
        <Link
          href="/admin/reportes-ventas"
          prefetch={false}
          className={buttonClass}
        >
          Volver a los reportes
        </Link>
      </>
    );
  }
  const { operation, daySales } = result.data;
  return (
    <DailyOperationDetail
      operation={operation}
      daySales={daySales}
      links={[
        {
          href: reportDayHref(operation.store.id, operation.businessDate),
          label: 'Volver al reporte del día',
        },
      ]}
    />
  );
}
