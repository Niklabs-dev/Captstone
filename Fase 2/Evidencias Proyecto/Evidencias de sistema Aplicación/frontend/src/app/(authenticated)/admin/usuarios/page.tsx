import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { UsersPanel } from '@/components/users/UsersPanel';
import { getUsersSession } from '@/lib/users-session';
import { listManagedUsers } from '@/lib/users-backend';
import { collectStores, type StoreOption } from '@/lib/users';
export const metadata: Metadata = { title: 'Usuarios | MoiFood' };
export default async function UsersPage(): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    return (
      <>
        <p role="alert" className="mt-4 text-u-crit">
          {session.message}
        </p>
        <Link href="/admin/usuarios" className="mt-4 inline-block underline">
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
  let stores: StoreOption[] = [];
  let error = result.ok ? '' : result.message;
  try {
    stores = collectStores(
      users,
      JSON.parse(process.env.USER_MANAGEMENT_STORES ?? '[]') as unknown,
    );
  } catch {
    error =
      'No se pudo cargar el catálogo de locales. Intenta nuevamente más tarde.';
  }
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
