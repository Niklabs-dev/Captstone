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
  primaryButtonClass,
  buttonClass,
  inputClass,
  labelClass,
  tableClass,
  tableHeadClass,
  tableHeadingClass,
  tableCellClass,
  dangerButtonClass,
  introClass,
  filterPanelClass,
  panelTitleClass,
  tablePanelClass,
  tableHeaderClass,
  tableDescriptionClass,
  badgeClass,
} from '@/components/ui/styles';
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
    <div className="space-y-5" aria-busy={busy}>
      <p className={introClass}>
        Administra las cuentas, sus roles y el acceso a los locales.
      </p>
      <section
        className={filterPanelClass}
        aria-labelledby="users-filter-title"
      >
        <h2 id="users-filter-title" className={panelTitleClass}>
          Filtrar usuarios
        </h2>
        <div className="mt-4 grid items-end gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <label className={`${labelClass} min-w-0 space-y-2`}>
            <span>Buscar usuario</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre o correo…"
              className={inputClass}
            />
          </label>
          <label className={`${labelClass} min-w-0 space-y-2`}>
            <span>Rol</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className={inputClass}
            >
              <option value="">Todos los roles</option>
              {USER_ROLES.map((code) => (
                <option key={code} value={code}>
                  {ROLE_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
          <label className={`${labelClass} min-w-0 space-y-2`}>
            <span>Estado</span>
            <select
              value={active}
              onChange={(event) => setActive(event.target.value)}
              className={inputClass}
            >
              <option value="">Todos</option>
              <option value="true">Activos</option>
              <option value="false">Desactivados</option>
            </select>
          </label>
          <label className={`${labelClass} min-w-0 space-y-2`}>
            <span>Local</span>
            <select
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
              className={inputClass}
            >
              <option value="">Todos los locales</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={reload} disabled={busy} className={buttonClass}>
            {busy && !creating && !target ? 'Cargando…' : 'Actualizar'}
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setCreating(true);
              setDialogError('');
            }}
            className={primaryButtonClass}
          >
            ＋ Crear usuario
          </button>
        </div>
      </section>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-crit/20 bg-crit-bg px-3.5 py-3 text-sm text-crit"
        >
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-ink2">
        {notice}
      </p>
      <section className={tablePanelClass} aria-labelledby="users-heading">
        <div className={tableHeaderClass}>
          <div>
            <h2 id="users-heading" className={panelTitleClass}>
              Usuarios del sistema
            </h2>
            <p className={tableDescriptionClass}>
              Control de acceso por rol · mínimo privilegio
            </p>
          </div>
        </div>
        <div
          role="region"
          aria-label="Tabla de usuarios desplazable"
          tabIndex={0}
          className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-salmon-ink"
        >
          <table className={`${tableClass} min-w-[640px]`}>
            <caption className="sr-only">
              Cuentas de usuario, roles, alcance y estado
            </caption>
            <thead className={tableHeadClass}>
              <tr>
                {['Usuario', 'Rol', 'Alcance', 'Estado', 'Acciones'].map(
                  (heading) => (
                    <th key={heading} scope="col" className={tableHeadingClass}>
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
                  className="border-b border-line last:border-0 hover:bg-tint"
                >
                  <td className={tableCellClass}>
                    <p className="font-semibold">
                      {user.firstName} {user.lastName}
                    </p>
                    <p className="mt-1 break-all text-[11px] text-muted">
                      {user.email}
                    </p>
                  </td>
                  <td className={tableCellClass}>
                    <span
                      className={`${badgeClass} ${user.role.code === 'ADMINISTRADOR' ? 'bg-tint2 text-salmon-ink' : user.role.code === 'CONTADOR' ? 'bg-info-bg text-info' : 'bg-tint text-ink2'}`}
                    >
                      {ROLE_LABELS[user.role.code]}
                    </span>
                  </td>
                  <td className={tableCellClass}>
                    {user.store?.name ?? 'Todos los locales'}
                  </td>
                  <td className={tableCellClass}>
                    <span
                      className={`${badgeClass} ${user.isActive ? 'bg-ok-bg text-ok' : 'bg-crit-bg text-crit'}`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-current"
                      />
                      {user.isActive ? 'Activo' : 'Desactivado'}
                    </span>
                  </td>
                  <td className={tableCellClass}>
                    {user.id === currentUserId ? (
                      <span className="text-xs text-ink2">Tu cuenta</span>
                    ) : user.isActive ? (
                      <button
                        className={buttonClass}
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
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && (
          <p className="py-8 text-center text-sm text-ink2">
            {error
              ? 'La lista no está disponible. Intenta actualizarla.'
              : users.length === 0
                ? 'Aún no hay usuarios registrados.'
                : 'No hay usuarios que coincidan con los filtros.'}
          </p>
        )}
        <p className="border-t border-line px-5 py-4 text-xs text-ink2">
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
          <p className="text-sm leading-6 text-ink2">
            <strong>
              {target.firstName} {target.lastName}
            </strong>{' '}
            no podrá iniciar ni renovar sesión. Sus datos y documentos se
            conservarán. La cuenta no podrá reactivarse desde esta pantalla.
          </p>
          <p className="mt-3 text-sm leading-6 text-ink2">
            Las sesiones ya abiertas pueden seguir vigentes hasta que venzan.
          </p>
          {dialogError && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-crit-bg p-3 text-sm text-crit"
            >
              {dialogError}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2.5">
            <button
              disabled={busy}
              onClick={() => setTarget(null)}
              className={buttonClass}
            >
              Cancelar
            </button>
            <button
              disabled={busy}
              onClick={deactivate}
              className={dangerButtonClass}
            >
              {busy ? 'Desactivando…' : 'Confirmar desactivación'}
            </button>
          </div>
        </UserDialog>
      )}
    </div>
  );
}
