import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { MyTipReceiptsPanel } from '@/components/tips/MyTipReceiptsPanel';
export const metadata = { title: 'Mis propinas | MoiFood' };
export default async function Page() {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    throw Error(session.message);
  }
  // Cualquier rol consulta solo sus constancias; el backend filtra por propietario.
  return (
    <MyTipReceiptsPanel key={session.data.id} workerId={session.data.id} />
  );
}
