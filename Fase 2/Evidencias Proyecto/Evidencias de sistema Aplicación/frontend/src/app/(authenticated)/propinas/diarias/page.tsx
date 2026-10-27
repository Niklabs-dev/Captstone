import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getTipsSession } from '@/lib/tips-session';
import { fetchStores } from '@/lib/stores-backend';
import { tipBusinessDate } from '@/lib/tips';
import { TipsPanel } from '@/components/tips/TipsPanel';
import { introClass } from '@/components/ui/styles';

export const metadata: Metadata = { title: 'Propinas diarias | MoiFood' };
export default async function DailyTipsPage(): Promise<ReactElement> {
  const session = await getTipsSession();
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
        Registra y consulta las propinas de tu local por fecha y medio de pago.
        Los montos se expresan en pesos chilenos.
      </p>
      <TipsPanel
        store={{ id: store.id, name: store.name, isActive: store.isActive }}
        initialDate={tipBusinessDate()}
      />
    </>
  );
}
