import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { getUsersSession } from '@/lib/users-session';
import { SessionActions } from '@/components/SessionActions';
import { DtAlertsPanel } from '@/components/dt-alerts/DtAlertsPanel';

export default async function DtAlertsPage(): Promise<ReactElement> {
  // Revalida el administrador activo; nunca serializa el token hacia componentes cliente.
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/admin/usuarios/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-xl font-bold">Alertas de registro en la DT</h1>
        <p role="alert" className="mt-4 text-sm text-ink2">
          {session.message}
        </p>
        <Link href="/admin/alertas-dt" className="mt-4 inline-block underline">
          Reintentar
        </Link>
      </main>
    );
  }
  return (
    <div className="min-h-screen bg-tint text-ink lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#dt-alerts-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-30 focus:bg-bg focus:p-3"
      >
        Ir al contenido
      </a>
      <aside className="border-b border-line bg-bg lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center gap-3 border-b border-line p-5">
          <Image
            src="/logo.png"
            alt=""
            width={46}
            height={46}
            priority
            className="rounded-xl border border-line"
          />
          <div>
            <p className="text-base font-extrabold">
              Moi<span className="text-salmon-deep">Food</span>
            </p>
            <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink2">
              Gestión interna
            </p>
          </div>
        </div>
        <nav
          aria-label="Administración"
          className="flex flex-wrap gap-1 p-3 lg:block lg:space-y-1"
        >
          <Link
            href="/dashboard"
            className="block rounded-lg px-3 py-2.5 text-sm hover:bg-tint"
          >
            Inicio
          </Link>
          <Link
            href="/admin/usuarios"
            className="block rounded-lg px-3 py-2.5 text-sm hover:bg-tint"
          >
            Usuarios
          </Link>
          <Link
            href="/admin/alertas-dt"
            aria-current="page"
            className="block rounded-lg bg-tint2 px-3 py-2.5 text-sm font-semibold text-salmon-ink"
          >
            Alertas DT
          </Link>
        </nav>
        <div className="hidden border-t border-line p-5 text-xs lg:mt-auto lg:block">
          <p className="break-all font-semibold">{session.user.email}</p>
          <p className="mt-2 text-ink2">Administrador</p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-16 items-center border-b border-line bg-bg px-5 lg:px-7">
          <h1 className="text-[17px] font-bold">
            Alertas de registro en la DT
          </h1>
        </header>
        <main id="dt-alerts-content" className="space-y-6 p-5 lg:p-7">
          <p className="max-w-3xl text-sm leading-6 text-ink2">
            Revisa los contratos próximos a vencer o vencidos sin registro en la
            Dirección del Trabajo, por trabajador y local.
          </p>
          <DtAlertsPanel />
          <details className="rounded-[14px] border border-line bg-bg p-5">
            <summary className="cursor-pointer text-sm font-semibold">
              Mi sesión
            </summary>
            <div className="mt-4">
              <SessionActions />
            </div>
          </details>
        </main>
      </div>
    </div>
  );
}
