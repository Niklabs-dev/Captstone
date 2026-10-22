import { introClass } from '@/components/ui/styles';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { getSession } from '@/lib/session';
import { canReadPayroll, canManagePayroll } from '@/lib/payroll';
import { PayrollPanel } from '@/components/payroll/PayrollPanel';

export default async function PayrollPage(): Promise<ReactElement> {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/login?reason=session');
    throw new Error(session.message);
  }
  if (!canReadPayroll(session.data.role))
    redirect('/dashboard?reason=forbidden');
  const canManage = canManagePayroll(session.data.role);
  return (
    <>
      <p className={introClass}>
        Consulta las liquidaciones por trabajador, local y período. El contador
        carga los archivos pendientes de firma y confirma su publicación.
      </p>
      <PayrollPanel canManage={canManage} />
    </>
  );
}
