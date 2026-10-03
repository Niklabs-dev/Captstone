'use client';

import { useRouter } from 'next/navigation';
import { Button } from './ui/Button';

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return <Button onClick={handleLogout}>Cerrar sesión</Button>;
}
