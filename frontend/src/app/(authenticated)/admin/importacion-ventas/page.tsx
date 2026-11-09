import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { SalesImportPanel } from '@/components/sales-imports/SalesImportPanel';
import { introClass } from '@/components/ui/styles';
import { isProxyUuid } from '@/lib/backend-proxy';
import { fetchSalesImport } from '@/lib/sales-overview-backend';
import { getUsersSession } from '@/lib/users-session';

export const metadata: Metadata = { title: 'Importar ventas | MoiFood' };

// SPRINT-4R-T11: la carga diaria del Excel de MrComanda es del administrador.
// SPRINT-4R-T14: ?importacion=<id> abre el detalle enlazado desde el panel y
// los reportes de ventas.
export default async function SalesImportPage({
  searchParams,
}: {
  searchParams: Promise<{ importacion?: string | string[] }>;
}): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error('No se pudo verificar tu sesión. Intenta nuevamente.');
  }
  const requested = (await searchParams).importacion;
  const importId = Array.isArray(requested) ? requested[0] : requested;
  const detail = importId
    ? isProxyUuid(importId)
      ? await fetchSalesImport(session.token, importId)
      : null
    : undefined;
  if (detail && !detail.ok && detail.status === 401)
    redirect('/session-expired');
  return (
    <>
      <p className={introClass}>
        Importa el Excel diario de ventas de MrComanda. Las ventas solo se
        registran al confirmar la vista previa; los supervisores no las digitan.
      </p>
      <SalesImportPanel
        initialDetail={detail?.ok ? detail.data : null}
        initialError={
          detail === undefined || detail?.ok
            ? ''
            : 'La importación solicitada no está disponible. Revisa el historial de importaciones.'
        }
      />
    </>
  );
}
