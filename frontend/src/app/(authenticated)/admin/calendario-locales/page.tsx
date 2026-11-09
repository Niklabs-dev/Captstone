import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { OperatingCalendarPanel } from '@/components/sales-overview/OperatingCalendarPanel';
import { alertClass, introClass } from '@/components/ui/styles';
import { fetchStores } from '@/lib/stores-backend';
import { storeOptions } from '@/lib/stores';
import { tipBusinessDate } from '@/lib/tips';
import { getUsersSession } from '@/lib/users-session';

export const metadata: Metadata = { title: 'Calendario de locales | MoiFood' };

// SPRINT-4R-T14: días de apertura y cierres por excepción de cada local,
// exclusivo del administrador. No gestiona horarios de trabajadores.
export default async function OperatingCalendarPage(): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error('No se pudo verificar tu sesión. Intenta nuevamente.');
  }
  const stores = await fetchStores(session.token);
  return (
    <>
      <p className={introClass}>
        Define qué días abre cada local y desde cuándo se exigen sus ventas
        importadas, y registra los cierres puntuales con su motivo. Este
        calendario solo decide qué días deben tener ventas; no define horarios
        ni turnos de los trabajadores.
      </p>
      {stores.ok ? (
        <OperatingCalendarPanel
          stores={storeOptions(stores.data, true)}
          today={tipBusinessDate()}
        />
      ) : (
        <p role="alert" className={alertClass}>
          {stores.message}
        </p>
      )}
    </>
  );
}
