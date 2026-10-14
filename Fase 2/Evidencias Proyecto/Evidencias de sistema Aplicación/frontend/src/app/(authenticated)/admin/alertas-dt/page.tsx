import { introClass } from '@/components/ui/styles';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { getUsersSession } from '@/lib/users-session';
import { DtAlertsPanel } from '@/components/dt-alerts/DtAlertsPanel';

export default async function DtAlertsPage(): Promise<ReactElement> {
  // Revalida el administrador activo; nunca serializa el token hacia componentes cliente.
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error(session.message);
  }
  return (
    <>
      <p className={introClass}>
        Revisa los contratos próximos a vencer o vencidos sin registro en la
        Dirección del Trabajo, por trabajador y local.
      </p>
      <DtAlertsPanel />
    </>
  );
}
