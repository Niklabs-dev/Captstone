import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { InventoryCountPanel } from '@/components/inventory-count/InventoryCountPanel';
import { introClass } from '@/components/ui/styles';
import { fetchStores } from '@/lib/stores-backend';
import { getSupervisorSession } from '@/lib/supervisor-session';
import { tipBusinessDate } from '@/lib/tips';

export const metadata: Metadata = { title: 'Inventario | MoiFood' };

// SPRINT-5-T07: toma de inventario semanal, exclusiva del supervisor y de su
// local. La fecha por defecto es hoy en hora de Chile; la toma conserva la
// fecha que fija la API al iniciarla.
export default async function InventoryCountPage(): Promise<ReactElement> {
  const session = await getSupervisorSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error(session.message);
  }
  const catalog = await fetchStores(session.token);
  if (!catalog.ok) {
    if (catalog.status === 401) redirect('/session-expired');
    throw new Error(catalog.message);
  }
  const store = catalog.data.find((item) => item.id === session.user.storeId);
  if (!store)
    throw new Error(
      'No se pudo verificar tu local asignado. Consulta con el administrador.',
    );
  return (
    <>
      <p className={introClass}>
        Cuenta las cajas, los paquetes y la cantidad suelta de cada producto de
        tu local. Cada producto se guarda por separado, así puedes retomar la
        toma desde cualquier dispositivo.
      </p>
      <InventoryCountPanel storeName={store.name} today={tipBusinessDate()} />
    </>
  );
}
