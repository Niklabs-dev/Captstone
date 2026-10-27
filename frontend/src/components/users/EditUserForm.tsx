'use client';
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  isUserRole,
  needsStore,
  parseUpdateUser,
  ROLE_LABELS,
  USER_ROLES,
  type ManagedUser,
  type StoreOption,
  type UpdateUserInput,
} from '@/lib/users';
import {
  buttonClass,
  primaryButtonClass,
  inputClass,
  labelClass,
} from '@/components/ui/styles';
export function EditUserForm({
  user,
  stores,
  busy,
  error,
  ownAccount,
  onSubmit,
  onCancel,
}: {
  user: ManagedUser;
  stores: StoreOption[];
  busy: boolean;
  error: string;
  ownAccount: boolean;
  onSubmit: (input: UpdateUserInput) => Promise<undefined>;
  onCancel: () => void;
}): ReactElement {
  const [role, setRole] = useState(user.role.code);
  const [storeId, setStoreId] = useState(user.store?.id ?? '');
  const [validationError, setValidationError] = useState('');
  const activeStores = stores.filter((store) => store.isActive !== false);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const assignmentChanged =
      role !== user.role.code ||
      (needsStore(role) && storeId !== (user.store?.id ?? ''));
    const input = parseUpdateUser({
      firstName: form.get('firstName'),
      lastName: form.get('lastName'),
      email: form.get('email'),
      rut: form.get('rut'),
      phone: form.get('phone'),
      hiredAt: form.get('hiredAt'),
      ...(assignmentChanged
        ? { roleCode: role, storeId: needsStore(role) ? storeId : null }
        : {}),
    });
    if (!input.ok) {
      setValidationError(input.message);
      return;
    }
    if (
      assignmentChanged &&
      needsStore(role) &&
      !activeStores.some((store) => store.id === storeId)
    ) {
      setValidationError('Selecciona un local activo.');
      return;
    }
    setValidationError('');
    await onSubmit(input.data);
  }
  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
      {(error || validationError) && (
        <p
          role="alert"
          className="rounded-lg bg-crit-bg px-3.5 py-3 text-sm text-crit"
        >
          {error || validationError}
        </p>
      )}
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {(['firstName', 'lastName'] as const).map((field) => (
            <label key={field} className={`${labelClass} space-y-1.5`}>
              <span>{field === 'firstName' ? 'Nombre' : 'Apellido'}</span>
              <input
                name={field}
                required
                maxLength={80}
                defaultValue={user[field]}
                autoComplete={
                  field === 'firstName' ? 'given-name' : 'family-name'
                }
                className={inputClass}
              />
            </label>
          ))}
        </div>
        <label className={`${labelClass} space-y-1.5`}>
          <span>Correo electrónico</span>
          <input
            name="email"
            type="email"
            required
            maxLength={160}
            defaultValue={user.email}
            autoComplete="email"
            className={inputClass}
          />
        </label>
        <label className={`${labelClass} space-y-1.5`}>
          <span>RUT (opcional)</span>
          <input
            name="rut"
            defaultValue={user.rut ?? ''}
            maxLength={12}
            placeholder="12.345.678-5"
            className={inputClass}
          />
        </label>
        <label className={`${labelClass} space-y-1.5`}>
          <span>Teléfono (opcional)</span>
          <input
            name="phone"
            type="tel"
            defaultValue={user.phone ?? ''}
            maxLength={20}
            autoComplete="tel"
            className={inputClass}
          />
        </label>
        <label className={`${labelClass} space-y-1.5`}>
          <span>Fecha de contratación (opcional)</span>
          <input
            name="hiredAt"
            type="date"
            defaultValue={user.hiredAt ?? ''}
            className={inputClass}
          />
        </label>
        <label className={`${labelClass} space-y-1.5`}>
          <span>Rol</span>
          <select
            value={role}
            disabled={ownAccount}
            aria-describedby={ownAccount ? 'own-role-help' : undefined}
            onChange={(event) => {
              if (isUserRole(event.target.value)) {
                setRole(event.target.value);
                setStoreId('');
              }
            }}
            className={inputClass}
          >
            {USER_ROLES.map((code) => (
              <option key={code} value={code}>
                {ROLE_LABELS[code]}
              </option>
            ))}
          </select>
        </label>
        {ownAccount && (
          <p id="own-role-help" className="text-xs text-ink2">
            No puedes cambiar tu propio rol de administrador.
          </p>
        )}
        {needsStore(role) ? (
          <label className={`${labelClass} space-y-1.5`}>
            <span>Local asignado</span>
            <select
              required
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                Selecciona un local
              </option>
              {user.store &&
                !activeStores.some((store) => store.id === user.store?.id) && (
                  <option value={user.store.id} disabled>
                    {user.store.name} (inactivo)
                  </option>
                )}
              {activeStores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-xs text-ink2">
            Este rol tiene alcance global sobre los locales.
          </p>
        )}
        <p className="text-xs text-ink2">
          Los cambios de rol o local revocan las sesiones para que el usuario
          vuelva a iniciar sesión con sus nuevos permisos.
        </p>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2.5 pt-2">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className={buttonClass}
        >
          Cancelar
        </button>
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
