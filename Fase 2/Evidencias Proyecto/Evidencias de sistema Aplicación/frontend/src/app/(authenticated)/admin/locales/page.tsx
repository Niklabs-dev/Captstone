import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getUsersSession } from '@/lib/users-session';
import { StoresPanel } from '@/components/stores/StoresPanel';
import { introClass } from '@/components/ui/styles';
export const metadata: Metadata = { title: 'Locales | MoiFood' };
export default async function StoresPage(): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error('No se pudo verificar tu sesión. Intenta nuevamente.');
  }
  return (
    <>
      <p className={introClass}>
        Administra los locales y su disponibilidad. Los cambios se reflejan en
        los catálogos del sistema.
      </p>
      <StoresPanel />
    </>
  );
}
