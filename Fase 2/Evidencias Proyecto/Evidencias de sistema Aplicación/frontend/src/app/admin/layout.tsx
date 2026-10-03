import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { AdminShell } from '@/components/AdminShell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  // El middleware ya protege /admin/*, esto es una segunda barrera por si
  // alguna vez se renderiza este layout sin pasar por el middleware.
  if (!user) redirect('/login');

  return <AdminShell user={user}>{children}</AdminShell>;
}
