import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getUsersSession } from '@/lib/users-session';
import { PaymentMethodsPanel } from '@/components/payment-methods/PaymentMethodsPanel';
import { introClass } from '@/components/ui/styles';

export const metadata: Metadata = { title: 'Medios de pago | MoiFood' };
export default async function PaymentMethodsPage(): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error('No se pudo verificar tu sesión. Intenta nuevamente.');
  }
  return (
    <>
      <p className={introClass}>
        Administra los medios de pago que usan ventas, propinas y cierres de
        caja. Los medios desactivados conservan su historial y no admiten
        registros nuevos.
      </p>
      <PaymentMethodsPanel />
    </>
  );
}
