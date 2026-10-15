import { redirect } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';
import { ApplicationShell } from '@/components/ApplicationShell';
import { getSession } from '@/lib/session';

// La cookie HttpOnly se valida en el servidor; el navegador nunca recibe el JWT.
export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/login?reason=session');
    throw new Error(session.message);
  }
  return (
    <ApplicationShell
      key={`${session.data.id}:${session.data.role}`}
      user={{ email: session.data.email, role: session.data.role }}
    >
      {children}
    </ApplicationShell>
  );
}
