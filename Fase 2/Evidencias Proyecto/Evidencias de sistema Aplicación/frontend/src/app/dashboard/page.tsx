import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { getSession } from '@/lib/session';
import { SessionActions } from '@/components/SessionActions';
import { getPageRedirect } from '@/lib/navigation';
export default async function DashboardPage(): Promise<ReactElement> {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/login?reason=session');
    throw new Error(session.message);
  }
  const destination = getPageRedirect(session.data.role, '/dashboard');
  if (destination) redirect(destination);
  return (
    <main className="min-h-screen bg-tint px-5 py-10 text-ink">
      <section className="mx-auto max-w-xl rounded-2xl border border-line bg-bg p-7 ">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-salmon-ink">
          Moi-food · Gestión interna
        </p>
        <h1 className="my-3 text-2xl font-bold">Bienvenido al sistema</h1>
        <p className="mb-6 text-ink2">
          Sesión iniciada como {session.data.email}.
        </p>
        {session.data.role === 'ADMINISTRADOR' && (
          <Link
            href="/admin/auditoria"
            prefetch={false}
            className="mb-6 inline-block rounded-lg border border-line2 px-4 py-2 text-sm font-semibold text-salmon-ink hover:bg-tint"
          >
            Consultar auditoría
          </Link>
        )}
        <SessionActions />
      </section>
    </main>
  );
}
