import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { getPageRedirect } from '@/lib/navigation';
import { getSession } from '@/lib/session';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/styles';

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
    <>
      <div className="max-w-5xl space-y-5">
        {params.reason === 'forbidden' && (
          <p
            role="status"
            className="rounded-xl border border-line2 bg-tint2 p-4 text-sm text-ink2"
          >
            Tu cuenta tiene acceso al Portal del Trabajador. Te redirigimos aquí
            porque el módulo solicitado requiere otro rol.
          </p>
        )}
        <section
          aria-labelledby="welcome-title"
          className="rounded-[14px] border border-line bg-bg p-6"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-salmon-ink">
            Bienvenido a MoiFood
          </p>
          <h2 id="welcome-title" className="mt-2 text-xl font-bold">
            Tu espacio personal
          </h2>
          <p className="mt-2 text-sm text-ink2">
            Desde este portal podrás consultar tu información laboral.
          </p>
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-xs font-semibold text-ink2">Cuenta conectada</p>
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
            Consulta tus documentos laborales y tus liquidaciones publicadas.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/portal/documentos"
              prefetch={false}
              className={buttonClass}
            >
              Mis documentos
            </Link>
            <Link
              href="/portal/liquidaciones"
              prefetch={false}
              className={buttonClass}
            >
              Mis liquidaciones
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
