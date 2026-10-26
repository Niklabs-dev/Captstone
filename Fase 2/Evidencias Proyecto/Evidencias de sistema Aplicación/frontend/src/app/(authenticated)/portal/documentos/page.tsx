import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { canReadOwnDocuments } from '@/lib/my-documents';
import { MyDocumentsPanel } from '@/components/documents/MyDocumentsPanel';
import { introClass, buttonClass } from '@/components/ui/styles';

export default async function MyDocumentsPage(): Promise<ReactElement> {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/login?reason=session');
    throw new Error(session.message);
  }
  if (!canReadOwnDocuments(session.data.role))
    redirect('/dashboard?reason=forbidden');
  return (
    <>
      <p className={introClass}>
        Consulta tus contratos, anexos, pactos y finiquitos, su versión vigente
        y su historial. Puedes verificar y descargar tus archivos; esta sección
        es de solo lectura.
      </p>
      <Link
        href="/portal/liquidaciones"
        prefetch={false}
        className={buttonClass}
      >
        Consultar mis liquidaciones
      </Link>
      <MyDocumentsPanel key={session.data.id} workerId={session.data.id} />
    </>
  );
}
