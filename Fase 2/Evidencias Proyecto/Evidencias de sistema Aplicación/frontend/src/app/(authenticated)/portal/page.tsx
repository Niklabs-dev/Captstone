import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { getSession } from '@/lib/session';
import { getPageRedirect } from '@/lib/navigation';
import { OperationsHome } from '@/components/OperationsHome';

export default async function WorkerPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}): Promise<ReactElement> {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/login?reason=session');
    throw new Error(session.message);
  }
  const destination = getPageRedirect(session.data.role, '/portal');
  if (destination) redirect(destination);
  const params = await searchParams;
  return (
    <OperationsHome
      role={session.data.role}
      email={session.data.email}
      forbidden={params.reason === 'forbidden'}
    />
  );
}
