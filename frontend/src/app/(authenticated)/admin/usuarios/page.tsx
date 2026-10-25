import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { UsersPanel } from '@/components/users/UsersPanel';
import { getUsersSession } from '@/lib/users-session';
import { listManagedUsers } from '@/lib/users-backend';
import { fetchStores } from '@/lib/stores-backend';
import { storeOptions } from '@/lib/stores';
import { buttonClass } from '@/components/ui/styles';
export const metadata: Metadata = { title: 'Usuarios | MoiFood' };
export default async function UsersPage(): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    return (
      <>
        <p role="alert" className="mt-4 text-crit">
          {session.message}
        </p>
        <Link href="/admin/usuarios" className={`${buttonClass} mt-4`}>
          Intentar nuevamente
        </Link>
      </>
    );
  }
  const result = await listManagedUsers(session.token);
  if (!result.ok && result.status === 401) redirect('/session-expired');
  if (!result.ok && result.status === 403)
    redirect('/dashboard?reason=forbidden');
  const users = result.ok ? result.data : [];
  const catalog = await fetchStores(session.token);
  if (!catalog.ok && catalog.status === 401) redirect('/session-expired');
  if (!catalog.ok && catalog.status === 403)
    redirect('/dashboard?reason=forbidden');
  const stores = catalog.ok ? storeOptions(catalog.data) : [];
  const error = !result.ok
    ? result.message
    : !catalog.ok
      ? catalog.message
      : '';
  return (
    <>
      <UsersPanel
        initialUsers={users}
        initialError={error}
        currentUserId={session.user.id}
        stores={stores}
      />
    </>
  );
}
