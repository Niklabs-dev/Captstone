'use client';
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  isUserRole,
  needsStore,
  parseCreateUser,
  ROLE_LABELS,
  USER_ROLES,
  type CreateUserInput,
  type StoreOption,
  type UserRole,
} from '@/lib/users';
import {
  primaryUserButtonClass,
  userButtonClass,
  userInputClass,
} from './styles';
export function CreateUserForm({
  stores,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  stores: StoreOption[];
  busy: boolean;
  error: string;
  onSubmit: (input: CreateUserInput) => Promise<undefined>;
  onCancel: () => undefined;
}): ReactElement {
  const [role, setRole] = useState<UserRole>('CONTADOR');
  const [validationError, setValidationError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const parsed = parseCreateUser({
      firstName: data.get('firstName'),
      lastName: data.get('lastName'),
      email: data.get('email'),
      password: data.get('password'),
      roleCode: role,
      ...(needsStore(role) ? { storeId: data.get('storeId') } : {}),
    });
    if (!parsed.ok) {
      setValidationError(parsed.message);
      return;
    }
    setValidationError('');
    await onSubmit(parsed.data);
  }
  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
      {(error || validationError) && (
        <p
          role="alert"
          className="rounded-lg bg-u-crit-bg px-3.5 py-3 text-sm text-u-crit"
        >
          {error || validationError}
        </p>
      )}
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {(['firstName', 'lastName'] as const).map((field) => (
            <label
              key={field}
              className="block space-y-1.5 text-[12.5px] font-semibold text-u-ink2"
            >
              <span>{field === 'firstName' ? 'Nombre' : 'Apellido'}</span>
              <input
                name={field}
                required
                maxLength={80}
                autoComplete={
                  field === 'firstName' ? 'given-name' : 'family-name'
                }
                className={userInputClass}
              />
            </label>
          ))}
        </div>
        <label className="block space-y-1.5 text-[12.5px] font-semibold text-u-ink2">
          <span>Correo electrónico</span>
          <input
            name="email"
            type="email"
            required
            maxLength={160}
            autoComplete="email"
            className={userInputClass}
          />
        </label>
        <label className="block space-y-1.5 text-[12.5px] font-semibold text-u-ink2">
          <span>Contraseña inicial</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            aria-describedby="password-help"
            className={userInputClass}
          />
        </label>
        <p id="password-help" className="text-xs text-u-ink2">
          Entre 8 y 72 caracteres. Entrégala al usuario por un medio seguro.
        </p>
        <label className="block space-y-1.5 text-[12.5px] font-semibold text-u-ink2">
          <span>Rol</span>
          <select
            name="roleCode"
            value={role}
            className={userInputClass}
            onChange={(event) => {
              if (isUserRole(event.target.value)) setRole(event.target.value);
            }}
          >
            {USER_ROLES.map((code) => (
              <option
                key={code}
                value={code}
                disabled={needsStore(code) && stores.length === 0}
              >
                {ROLE_LABELS[code]}
              </option>
            ))}
          </select>
        </label>
        {needsStore(role) ? (
          <label className="block space-y-1.5 text-[12.5px] font-semibold text-u-ink2">
            <span>Local asignado</span>
            <select
              name="storeId"
              required
              defaultValue=""
              className={userInputClass}
            >
              <option value="" disabled>
                Selecciona un local
              </option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="rounded-lg bg-u-tint px-3 py-2.5 text-xs text-u-ink2">
            Este rol tiene alcance global sobre los locales.
          </p>
        )}
        {stores.length === 0 && (
          <p className="text-xs text-u-ink2">
            No hay locales disponibles para asignar supervisores o trabajadores.
          </p>
        )}
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2.5 pt-2">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className={userButtonClass}
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={busy}
          className={primaryUserButtonClass}
        >
          {busy ? 'Creando…' : 'Guardar usuario'}
        </button>
      </div>
    </form>
  );
}
