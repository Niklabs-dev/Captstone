import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { DailyOperationDetail } from '@/components/sales-overview/DailyOperationDetail';
import { alertClass, buttonClass } from '@/components/ui/styles';
import { isProxyUuid } from '@/lib/backend-proxy';
import { fetchOperationDetail } from '@/lib/sales-overview-backend';
import {
  dashboardHref,
  reportDayHref,
  salesOverviewError,
} from '@/lib/sales-overview';
import { getUsersSession } from '@/lib/users-session';

export const metadata: Metadata = {
  title: 'Operación diaria | Panel de ventas | MoiFood',
};

// SPRINT-4R-T14: detalle de solo lectura de la operación diaria enlazado
// desde el panel del día (exclusivo del administrador). SPRINT-4A-T11 agrega
// el voucher y SPRINT-4A-T23 las ventas del día por medio de pago; el mismo
// detalle se abre desde los reportes en /admin/reportes-ventas/operaciones.
export default async function DailyOperationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const session = await getUsersSession();
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
          href="/admin/panel-ventas"
          prefetch={false}
          className={buttonClass}
        >
          Volver al panel
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
          href: dashboardHref(operation.businessDate),
          label: 'Volver al panel del día',
        },
        {
          href: reportDayHref(operation.store.id, operation.businessDate),
          label: 'Ver reporte del día',
        },
      ]}
    />
  );
}
