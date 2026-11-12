import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { ProductsPanel } from '@/components/products/ProductsPanel';
import { introClass } from '@/components/ui/styles';
import { getUsersSession } from '@/lib/users-session';

export const metadata: Metadata = { title: 'Productos | MoiFood' };

// SPRINT-5-T04: catálogo de productos de inventario, exclusivo del
// administrador.
export default async function ProductsPage(): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    throw new Error('No se pudo verificar tu sesión. Intenta nuevamente.');
  }
  return (
    <>
      <p className={introClass}>
        Administra los productos de la toma de inventario y su formato de caja y
        paquete. Se muestran en el orden de la plantilla.
      </p>
      <ProductsPanel />
    </>
  );
}
