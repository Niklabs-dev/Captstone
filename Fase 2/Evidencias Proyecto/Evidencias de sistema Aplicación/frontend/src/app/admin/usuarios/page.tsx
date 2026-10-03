import { fetchUsers } from '@/lib/users-api';
import { UsuariosClient } from './UsuariosClient';

export default async function UsuariosPage() {
  const { users, error } = await fetchUsers();
  return <UsuariosClient initialUsers={users} initialError={error ?? null} />;
}
