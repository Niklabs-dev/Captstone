import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { getSession } from '@/lib/session';
import { SessionActions } from '@/components/SessionActions';
export default async function DashboardPage(): Promise<ReactElement> {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/login?reason=session');
    throw new Error(session.message);
  }
  return (
    <main className="min-h-screen bg-slate-100 px-5 py-10 text-slate-900">
      <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">
          Moi-food · Gestión interna
        </p>
        <h1 className="my-3 text-2xl font-bold">Bienvenido al sistema</h1>
        <p className="mb-6 text-slate-600">
          Sesión iniciada como {session.data.email}.
        </p>
        <SessionActions />
      </section>
    </main>
  );
}
