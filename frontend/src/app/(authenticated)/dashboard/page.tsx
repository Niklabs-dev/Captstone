import { buttonClass } from '@/components/ui/styles';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { getSession } from '@/lib/session';
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
    <>
      <section className="max-w-3xl rounded-[14px] border border-line bg-bg p-6">
        <h2 className="mb-3 text-xl font-bold">Bienvenido al sistema</h2>
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
        {session.data.role === 'ADMINISTRADOR' && (
          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/usuarios"
              prefetch={false}
              className={buttonClass}
            >
              Gestionar usuarios
            </Link>
            <Link
              href="/admin/auditoria"
              prefetch={false}
              className={buttonClass}
            >
              Consultar auditoría
            </Link>
          </div>
        )}
        {session.data.role === 'ADMINISTRADOR' && (
          <Link
            href="/admin/alertas-dt"
            prefetch={false}
            className={`${buttonClass} mt-4`}
          >
            Abrir alertas DT
          </Link>
        )}
        {(session.data.role === 'ADMINISTRADOR' ||
          session.data.role === 'CONTADOR') && (
          <Link
            href="/liquidaciones"
            prefetch={false}
            className={`${buttonClass} mt-4`}
          >
            Abrir liquidaciones
          </Link>
        )}
      </section>
    </>
  );
}
