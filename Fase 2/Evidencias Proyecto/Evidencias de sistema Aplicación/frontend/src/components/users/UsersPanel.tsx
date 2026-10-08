'use client';
import { useMemo, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import {
  filterUsers,
  isObject,
  parseManagedUser,
  parseUserList,
  ROLE_LABELS,
  USER_ROLES,
  type CreateUserInput,
  type ManagedUser,
  type StoreOption,
} from '@/lib/users';
import { CreateUserForm } from './CreateUserForm';
import { UserDialog } from './UserDialog';
import {
  primaryUserButtonClass,
  userButtonClass,
  userInputClass,
} from './styles';
export function UsersPanel({
  initialUsers,
  initialError,
  currentUserId,
  stores,
}: {
  initialUsers: ManagedUser[];
  initialError: string;
  currentUserId: string;
  stores: StoreOption[];
}): ReactElement {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('');
  const [storeId, setStoreId] = useState('');
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<ManagedUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [dialogError, setDialogError] = useState('');
  const [notice, setNotice] = useState('');
  const visible = useMemo(
    () => filterUsers(users, search, role, active, storeId),
    [users, search, role, active, storeId],
  );
  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const response = await fetch(path, { ...init, cache: 'no-store' }).catch(
      () => {
        throw new Error(
          'No se pudo conectar. Actualiza la lista antes de repetir la operación.',
        );
      },
    );
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) router.replace('/login?reason=session');
      if (response.status === 403)
        router.replace('/dashboard?reason=forbidden');
      throw new Error(
        isObject(data) && typeof data.message === 'string'
          ? data.message
          : 'No se pudo completar la operación.',
      );
    }
    return data;
  }
  async function reload(): Promise<undefined> {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = parseUserList(await request('/api/users'));
      if (!result) throw new Error('No se pudo leer la lista de usuarios.');
      setUsers(result);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'No se pudo conectar.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function create(input: CreateUserInput): Promise<undefined> {
    if (busy) return;
    setBusy(true);
    setDialogError('');
    setNotice('');
    try {
      const result = parseManagedUser(
        await request('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!result)
        throw new Error('Actualiza la lista antes de repetir la operación.');
      setUsers((previous) => [
        result,
        ...previous.filter((user) => user.id !== result.id),
      ]);
      setCreating(false);
      setNotice('Usuario creado correctamente.');
    } catch (failure) {
      setDialogError(
        failure instanceof Error ? failure.message : 'No se pudo conectar.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function deactivate(): Promise<undefined> {
    if (busy || !target) return;
    setBusy(true);
    setDialogError('');
    setNotice('');
    try {
      const result = parseManagedUser(
        await request(`/api/users/${target.id}/deactivate`, {
          method: 'PATCH',
        }),
      );
      if (!result)
        throw new Error('Actualiza la lista antes de repetir la operación.');
      setUsers((previous) =>
        previous.map((user) => (user.id === result.id ? result : user)),
      );
      setTarget(null);
      setNotice('Usuario desactivado. No podrá iniciar ni renovar sesión.');
    } catch (failure) {
      setDialogError(
        failure instanceof Error ? failure.message : 'No se pudo conectar.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4" aria-busy={busy}>
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="min-w-48 flex-1 space-y-1.5 text-xs text-u-ink2">
          <span>Buscar usuario</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nombre o correo…"
            className={userInputClass}
          />
        </label>
        <label className="space-y-1.5 text-xs text-u-ink2">
          <span>Rol</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className={userInputClass}
          >
            <option value="">Todos los roles</option>
            {USER_ROLES.map((code) => (
              <option key={code} value={code}>
                {ROLE_LABELS[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-xs text-u-ink2">
          <span>Estado</span>
          <select
            value={active}
            onChange={(event) => setActive(event.target.value)}
            className={userInputClass}
          >
            <option value="">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Desactivados</option>
          </select>
        </label>
        <label className="space-y-1.5 text-xs text-u-ink2">
          <span>Local</span>
          <select
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className={userInputClass}
          >
            <option value="">Todos los locales</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={reload} disabled={busy} className={userButtonClass}>
          {busy && !creating && !target ? 'Cargando…' : 'Actualizar'}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setCreating(true);
            setDialogError('');
          }}
          className={primaryUserButtonClass}
        >
          ＋ Crear usuario
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-u-crit/20 bg-u-crit-bg px-3.5 py-3 text-sm text-u-crit"
        >
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-u-ink2">
        {notice}
      </p>
      <section
        className="rounded-[14px] border border-u-line bg-u-bg px-4 py-[18px] sm:px-5"
        aria-labelledby="users-heading"
      >
        <div className="mb-3.5">
          <h2 id="users-heading" className="text-sm font-bold">
            Usuarios del sistema
          </h2>
          <p className="mt-1 font-u-mono text-[9.5px] uppercase tracking-[0.14em] text-u-muted">
            Control de acceso por rol · mínimo privilegio
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <caption className="sr-only">
              Cuentas de usuario, roles, alcance y estado
            </caption>
            <thead>
              <tr>
                {['Usuario', 'Rol', 'Alcance', 'Estado', 'Acciones'].map(
                  (heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="whitespace-nowrap border-b border-u-line2 px-3 py-[9px] font-u-mono text-[9.5px] font-semibold uppercase tracking-[0.13em] text-u-muted"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-u-line last:border-0 hover:bg-u-tint"
                >
                  <td className="px-3 py-[11px]">
                    <p className="font-semibold">
                      {user.firstName} {user.lastName}
                    </p>
                    <p className="mt-0.5 font-u-mono text-[10.5px] text-u-muted">
                      {user.email}
                    </p>
                  </td>
                  <td className="px-3 py-[11px]">
                    <span
                      className={`inline-flex rounded-full px-[9px] py-1 font-u-mono text-[10px] font-semibold uppercase tracking-[0.08em] ${user.role.code === 'ADMINISTRADOR' ? 'bg-u-tint2 text-u-salmon-ink' : user.role.code === 'CONTADOR' ? 'bg-u-info-bg text-u-info' : 'bg-u-tint text-u-ink2'}`}
                    >
                      {ROLE_LABELS[user.role.code]}
                    </span>
                  </td>
                  <td className="px-3 py-[11px]">
                    {user.store?.name ?? 'Todos los locales'}
                  </td>
                  <td className="px-3 py-[11px]">
                    <span
                      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] py-1 font-u-mono text-[10px] font-semibold uppercase tracking-[0.08em] ${user.isActive ? 'bg-u-ok-bg text-u-ok' : 'bg-u-crit-bg text-u-crit'}`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-current"
                      />
                      {user.isActive ? 'Activo' : 'Desactivado'}
                    </span>
                  </td>
                  <td className="px-3 py-[11px]">
                    {user.id === currentUserId ? (
                      <span className="text-xs text-u-ink2">Tu cuenta</span>
                    ) : user.isActive ? (
                      <button
                        className={userButtonClass}
                        disabled={busy}
                        aria-label={`Desactivar a ${user.firstName} ${user.lastName}`}
                        onClick={() => {
                          setTarget(user);
                          setDialogError('');
                        }}
                      >
                        Desactivar
                      </button>
                    ) : (
                      <span className="text-u-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && (
          <p className="py-8 text-center text-sm text-u-ink2">
            {error
              ? 'La lista no está disponible. Intenta actualizarla.'
              : users.length === 0
                ? 'Aún no hay usuarios registrados.'
                : 'No hay usuarios que coincidan con los filtros.'}
          </p>
        )}
        <p className="mt-4 text-xs text-u-ink2">
          {visible.length} de {users.length} usuarios
        </p>
      </section>
      {creating && (
        <UserDialog
          title="Crear usuario"
          busy={busy}
          onDismiss={() => {
            if (!busy) setCreating(false);
          }}
        >
          <CreateUserForm
            stores={stores}
            busy={busy}
            error={dialogError}
            onSubmit={create}
            onCancel={() => {
              if (!busy) setCreating(false);
            }}
          />
        </UserDialog>
      )}
      {target && (
        <UserDialog
          title="Desactivar usuario"
          busy={busy}
          onDismiss={() => {
            if (!busy) setTarget(null);
          }}
        >
          <p className="text-sm leading-6 text-u-ink2">
            <strong>
              {target.firstName} {target.lastName}
            </strong>{' '}
            no podrá iniciar ni renovar sesión. Sus datos y documentos se
            conservarán. La cuenta no podrá reactivarse desde esta pantalla.
          </p>
          <p className="mt-3 text-sm leading-6 text-u-ink2">
            Las sesiones ya abiertas pueden seguir vigentes hasta que venzan.
          </p>
          {dialogError && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-u-crit-bg p-3 text-sm text-u-crit"
            >
              {dialogError}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2.5">
            <button
              disabled={busy}
              onClick={() => setTarget(null)}
              className={userButtonClass}
            >
              Cancelar
            </button>
            <button
              disabled={busy}
              onClick={deactivate}
              className={`${userButtonClass} border-u-crit bg-u-crit text-white hover:bg-u-crit/90`}
            >
              {busy ? 'Desactivando…' : 'Confirmar desactivación'}
            </button>
          </div>
        </UserDialog>
      )}
    </div>
  );
}
