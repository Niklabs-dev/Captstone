import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { InventoryCountDetailView } from '@/components/inventory-counts/InventoryCountDetailView';
import { alertClass, buttonClass } from '@/components/ui/styles';
import { isProxyUuid } from '@/lib/backend-proxy';
import { fetchInventoryCount } from '@/lib/inventory-counts-backend';
import { inventoryCountError } from '@/lib/inventory-counts';
import { getUsersSession } from '@/lib/users-session';

export const metadata: Metadata = {
  title: 'Toma de inventario | Inventarios | MoiFood',
};

// SPRINT-5-T09: detalle de solo lectura de una toma, exclusivo del
// administrador. No ofrece ninguna edición: lo contado lo guarda el
// supervisor del local.
export default async function InventoryCountPage({
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
    ? await fetchInventoryCount(session.token, id)
    : {
        ok: false as const,
        status: 404,
        message: inventoryCountError(404, 'detail'),
      };
  if (!result.ok) {
    if (result.status === 401) redirect('/session-expired');
    if (result.status === 403) redirect('/dashboard?reason=forbidden');
    return (
      <>
        <p role="alert" className={alertClass}>
          La toma de inventario no está disponible. {result.message}
        </p>
        <Link
          href="/admin/inventarios"
          prefetch={false}
          className={buttonClass}
        >
          Volver a las tomas
        </Link>
      </>
    );
  }
  return <InventoryCountDetailView count={result.data} />;
}
