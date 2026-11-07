import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getSupervisorSession } from '@/lib/supervisor-session';
import { fetchStores } from '@/lib/stores-backend';
import { tipBusinessDate } from '@/lib/tips';
import { DailyOperationPanel } from '@/components/daily-operations/DailyOperationPanel';
import { introClass } from '@/components/ui/styles';

export const metadata: Metadata = { title: 'Operación diaria | MoiFood' };
export default async function DailyOperationPage(): Promise<ReactElement> {
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
        Registra la operación diaria de tu local: propinas con tarjeta y su
        voucher, propinas en efectivo, la diferencia de efectivo declarada y los
        trabajadores participantes del reparto. Los montos se expresan en pesos
        chilenos.
      </p>
      <DailyOperationPanel
        store={{ id: store.id, name: store.name, isActive: store.isActive }}
        initialDate={tipBusinessDate()}
      />
    </>
  );
}
