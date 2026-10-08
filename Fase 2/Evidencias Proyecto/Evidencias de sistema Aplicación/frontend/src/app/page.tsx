import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getHomePath } from '@/lib/navigation';

export default async function Home(): Promise<never> {
  const session = await getSession();
  redirect(session.ok ? getHomePath(session.data.role) : '/login');
}
