import { introClass } from '@/components/ui/styles';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { getUsersSession } from '@/lib/users-session';
import { SalesDashboardPanel } from '@/components/sales-dashboard/SalesDashboardPanel';

export default async function SalesDashboardPage(): Promise<ReactElement> {
  // Solo el administrador activo; nunca serializa el token hacia componentes cliente.
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error(session.message);
  }
  return (
    <>
      <p className={introClass}>
        Revisa en un solo lugar las ventas del día, las alertas legales y las
        diferencias de caja pendientes de cada local.
      </p>
      <SalesDashboardPanel />
    </>
  );
}
