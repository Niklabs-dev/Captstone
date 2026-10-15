import { introClass } from '@/components/ui/styles';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { getSession } from '@/lib/session';
import { canReadOwnPayslips } from '@/lib/my-payslips';
import { MyPayslipsPanel } from '@/components/my-payslips/MyPayslipsPanel';

export default async function MyPayslipsPage(): Promise<ReactElement> {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/login?reason=session');
    throw new Error(session.message);
  }
  if (!canReadOwnPayslips(session.data.role))
    redirect('/dashboard?reason=forbidden');
  return (
    <>
      <p className={introClass}>
        Consulta tus liquidaciones publicadas por período y descarga cada
        archivo con verificación de integridad.
      </p>
      <MyPayslipsPanel key={session.data.id} workerId={session.data.id} />
    </>
  );
}
