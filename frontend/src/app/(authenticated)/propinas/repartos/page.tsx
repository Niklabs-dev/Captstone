import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { fetchStores } from '@/lib/stores-backend';
import { tipBusinessDate } from '@/lib/tips';
import { PoolWorkspace } from '@/components/tips/PoolWorkspace';
export const metadata = { title: 'Reparto de propinas | MoiFood' };
export default async function Page() {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    throw Error(session.message);
  }
  if (!['CONTADOR', 'ADMINISTRADOR'].includes(session.data.role))
    redirect('/dashboard?reason=forbidden');
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect('/session-expired');
  const stores = await fetchStores(token);
  if (!stores.ok) {
    if (stores.status === 401) redirect('/session-expired');
    throw Error(stores.message);
  }
  return (
    <PoolWorkspace
      stores={stores.data.map((s) => ({
        id: s.id,
        name: s.name,
        isActive: s.isActive,
      }))}
      readOnly={session.data.role === 'ADMINISTRADOR'}
      today={tipBusinessDate()}
    />
  );
}
