'use client';

import { useRouter } from 'next/navigation';
import { clearSessionCookie } from '@/lib/mock-auth';
import { Button } from './ui/Button';

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      onClick={() => {
        clearSessionCookie();
        router.push('/login');
      }}
    >
      Cerrar sesión
    </Button>
  );
}
