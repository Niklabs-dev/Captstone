import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { getSession } from '@/lib/session';
import { SessionActions } from '@/components/SessionActions';
import { getPageRedirect } from '@/lib/navigation';
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}): Promise<ReactElement> {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/login?reason=session');
    throw new Error(session.message);
  }
  const destination = getPageRedirect(session.data.role, '/dashboard');
  if (destination) redirect(destination);
  const params = await searchParams;
  return (
    <main className="min-h-screen bg-tint px-5 py-10 text-ink">
      <section className="mx-auto max-w-xl rounded-2xl border border-line bg-bg p-7 ">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-salmon-ink">
          Moi-food · Gestión interna
        </p>
        <h1 className="my-3 text-2xl font-bold">Bienvenido al sistema</h1>
        {params.reason === 'forbidden' && (
          <p
            role="status"
            className="mb-5 rounded-xl border border-line2 bg-tint2 p-4 text-sm text-ink2"
          >
            Tu cuenta no tiene acceso a la página solicitada. Te redirigimos al
            inicio, donde puedes continuar con las funciones de tu rol.
          </p>
        )}
        <p className="mb-6 text-ink2">
          Sesión iniciada como {session.data.email}.
        </p>
        <SessionActions />
      </section>
    </main>
  );
}
