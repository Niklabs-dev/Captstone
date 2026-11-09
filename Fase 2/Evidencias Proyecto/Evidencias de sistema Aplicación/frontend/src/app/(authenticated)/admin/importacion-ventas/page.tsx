import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { SalesImportPanel } from '@/components/sales-imports/SalesImportPanel';
import { introClass } from '@/components/ui/styles';
import { getUsersSession } from '@/lib/users-session';

export const metadata: Metadata = { title: 'Importar ventas | MoiFood' };

// SPRINT-4R-T11: la carga diaria del Excel de MrComanda es del administrador.
export default async function SalesImportPage(): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error('No se pudo verificar tu sesión. Intenta nuevamente.');
  }
  return (
    <>
      <p className={introClass}>
        Importa el Excel diario de ventas de MrComanda. Las ventas solo se
        registran al confirmar la vista previa; los supervisores no las digitan.
      </p>
      <SalesImportPanel />
    </>
  );
}
