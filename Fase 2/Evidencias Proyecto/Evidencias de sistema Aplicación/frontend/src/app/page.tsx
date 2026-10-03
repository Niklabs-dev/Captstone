import { redirect } from 'next/navigation';
import { getSessionUser, landingPathForRole } from '@/lib/session';

export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? landingPathForRole(user.rol) : '/login');
}
