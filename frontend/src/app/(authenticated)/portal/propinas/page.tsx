import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { canReadOwnTipReceipts } from '@/lib/my-tip-receipts';
import { MyTipReceiptsPanel } from '@/components/tips/MyTipReceiptsPanel';
export const metadata = { title: 'Mis propinas | MoiFood' };
export default async function Page() {
  const session = await getSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/session-expired');
    throw Error(session.message);
  }
  if (!canReadOwnTipReceipts(session.data.role))
    redirect('/dashboard?reason=forbidden');
  return (
    <MyTipReceiptsPanel key={session.data.id} workerId={session.data.id} />
  );
}
