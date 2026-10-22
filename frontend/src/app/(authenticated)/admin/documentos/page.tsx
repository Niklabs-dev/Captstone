import { introClass, buttonClass } from '@/components/ui/styles';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { getUsersSession } from '@/lib/users-session';
import { listManagedUsers } from '@/lib/users-backend';
import { DocumentsPanel } from '@/components/documents/DocumentsPanel';

export default async function DocumentsPage(): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    // Reutiliza la transición que revalida y limpia cookies de administrador inactivo.
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error(session.message);
  }
  const result = await listManagedUsers(session.token);
  if (!result.ok && result.status === 401) redirect('/session-expired');
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
    <>
      <div>
        <p className={introClass}>
          Consulta documentos laborales, revisa sus versiones y comprueba la
          integridad de cada archivo antes de descargarlo.
        </p>
      </div>
      {result.ok ? (
        <DocumentsPanel workers={workers} />
      ) : (
        <div role="alert" className="rounded-xl border border-line2 bg-bg p-5">
          <h2 className="font-semibold">
            No se pudieron cargar los trabajadores
          </h2>
          <p className="mt-2 text-sm text-ink2">{result.message}</p>
          <Link href="/admin/documentos" className={`${buttonClass} mt-3`}>
            Reintentar
          </Link>
        </div>
      )}
    </>
  );
}
