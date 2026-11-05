import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getTipsSession } from '@/lib/tips-session';
import { fetchStores } from '@/lib/stores-backend';
import { tipBusinessDate } from '@/lib/tips';
import { CashClosingPanel } from '@/components/cash-closings/CashClosingPanel';
import { introClass } from '@/components/ui/styles';

export const metadata: Metadata = { title: 'Cierre de caja | MoiFood' };

// Vista del supervisor para confirmar el cierre de caja de su local
// (SPRINT-4-T11). La sesión de supervisor con local es la misma de propinas.
export default async function CashClosingPage(): Promise<ReactElement> {
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
        Declara lo contado por medio de pago y los vouchers de MrComanda y
        Mercado Pago. El sistema calcula las diferencias y deja registro del
        responsable y la fecha-hora.
      </p>
      <CashClosingPanel
        store={{ id: store.id, name: store.name, isActive: store.isActive }}
        initialDate={tipBusinessDate()}
      />
    </>
  );
}
