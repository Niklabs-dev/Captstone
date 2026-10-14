import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { getUsersSession } from '@/lib/users-session';
import { listManagedUsers } from '@/lib/users-backend';
import { DocumentsPanel } from '@/components/documents/DocumentsPanel';
import { SessionActions } from '@/components/SessionActions';

export default async function DocumentsPage(): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    // Reutiliza la transición que revalida y limpia cookies de administrador inactivo.
    if (session.status === 401) redirect('/admin/usuarios/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-xl font-bold">Gestor documental</h1>
        <p role="alert" className="mt-4 text-sm text-ink2">
          {session.message}
        </p>
        <Link href="/admin/documentos" className="mt-4 inline-block underline">
          Reintentar
        </Link>
      </main>
    );
  }
  const result = await listManagedUsers(session.token);
  if (!result.ok && result.status === 401)
    redirect('/admin/usuarios/session-expired');
  if (!result.ok && result.status === 403)
    redirect('/dashboard?reason=forbidden');
  const workers = result.ok
    ? result.data
        .filter(
          (user) =>
            user.role.code === 'TRABAJADOR' || user.role.code === 'SUPERVISOR',
        )
        .sort((a, b) =>
          (a.firstName + ' ' + a.lastName).localeCompare(
            b.firstName + ' ' + b.lastName,
            'es',
          ),
        )
    : [];
  return (
    <div className="min-h-screen bg-tint text-ink lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#documents-content"
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
            href="/admin/documentos"
            aria-current="page"
            className="block rounded-lg bg-tint2 px-3 py-2.5 text-sm font-semibold text-salmon-ink"
          >
            Documentos
          </Link>
        </nav>
        <div className="hidden border-t border-line p-5 text-xs lg:mt-auto lg:block">
          <p className="break-all font-semibold">{session.user.email}</p>
          <p className="mt-2 text-ink2">Administrador</p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-16 items-center border-b border-line bg-bg px-5 lg:px-7">
          <h1 className="text-[17px] font-bold">Gestor documental</h1>
        </header>
        <main id="documents-content" className="space-y-6 p-5 lg:p-7">
          <div>
            <h2 className="text-xl font-bold">Carpetas por trabajador</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink2">
              Consulta documentos laborales, revisa sus versiones y comprueba la
              integridad de cada archivo antes de descargarlo.
            </p>
          </div>
          {result.ok ? (
            <DocumentsPanel workers={workers} />
          ) : (
            <div
              role="alert"
              className="rounded-xl border border-line2 bg-bg p-5"
            >
              <h2 className="font-semibold">
                No se pudieron cargar los trabajadores
              </h2>
              <p className="mt-2 text-sm text-ink2">{result.message}</p>
              <Link
                href="/admin/documentos"
                className="mt-3 inline-block text-sm underline"
              >
                Reintentar
              </Link>
            </div>
          )}
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
