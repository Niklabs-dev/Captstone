import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { SessionActions } from '@/components/SessionActions';
import { getPageRedirect } from '@/lib/navigation';
import { getSession } from '@/lib/session';

export default async function WorkerPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
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
    <div className="min-h-screen bg-tint text-ink lg:grid lg:grid-cols-[248px_1fr]">
      <a
        href="#portal-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-30 focus:rounded-lg focus:bg-bg focus:p-3"
      >
        Ir al contenido
      </a>
      <aside className="border-b border-line bg-bg lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center gap-3 border-b border-line px-5 py-5">
          <Image
            src="/logo.png"
            alt=""
            width={46}
            height={46}
            className="rounded-xl border border-line"
            priority
          />
          <div>
            <p className="text-base font-extrabold tracking-tight">
              Moi<span className="text-salmon-deep">Food</span>
            </p>
            <p className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
              Portal del trabajador
            </p>
          </div>
        </div>
        <nav aria-label="Navegación del portal" className="px-2.5 py-4">
          <p className="mb-2 px-2.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
            Mi espacio
          </p>
          <Link
            href="/portal"
            aria-current="page"
            className="block rounded-[9px] bg-tint2 px-3 py-2.5 text-[13.5px] font-semibold text-salmon-ink"
          >
            Inicio
          </Link>
        </nav>
        <div className="hidden border-t border-line px-5 py-4 lg:mt-auto lg:block">
          <p className="break-all text-[13px] font-semibold">
            {session.data.email}
          </p>
          <p className="mt-1 font-mono text-[9.5px] uppercase tracking-wider text-salmon-ink">
            Trabajador
          </p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-16 items-center border-b border-line bg-bg px-5 lg:px-7">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              Mi espacio / Inicio
            </p>
            <h1 className="text-[17px] font-bold">Portal del Trabajador</h1>
          </div>
        </header>
        <main
          id="portal-content"
          className="mx-auto max-w-5xl space-y-5 px-5 py-6 lg:px-7"
        >
          {params.reason === 'forbidden' && (
            <p
              role="status"
              className="rounded-xl border border-line2 bg-tint2 p-4 text-sm text-ink2"
            >
              Tu cuenta tiene acceso al Portal del Trabajador. Te redirigimos
              aquí porque el módulo solicitado requiere otro rol.
            </p>
          )}
          <section
            aria-labelledby="welcome-title"
            className="rounded-[14px] border border-line bg-bg p-6"
          >
            <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-salmon-ink">
              Bienvenido a MoiFood
            </p>
            <h2 id="welcome-title" className="mt-2 text-xl font-bold">
              Tu espacio personal
            </h2>
            <p className="mt-2 text-sm text-ink2">
              Desde este portal podrás consultar tu información laboral.
            </p>
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-xs font-semibold text-ink2">
                Cuenta conectada
              </p>
              <p className="mt-1 break-all text-sm">{session.data.email}</p>
            </div>
          </section>
          <section
            aria-labelledby="information-title"
            className="rounded-[14px] border border-line bg-bg p-6"
          >
            <h2 id="information-title" className="text-base font-bold">
              Mi información laboral
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink2">
              La consulta de documentos, liquidaciones y constancias de propinas
              estará disponible cuando se habiliten esas funciones.
            </p>
          </section>
          <section
            aria-labelledby="session-title"
            className="rounded-[14px] border border-line bg-bg p-6"
          >
            <h2 id="session-title" className="mb-4 text-base font-bold">
              Mi sesión
            </h2>
            <SessionActions />
          </section>
        </main>
      </div>
    </div>
  );
}
