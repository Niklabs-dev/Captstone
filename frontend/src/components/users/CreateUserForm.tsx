'use client';
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  isUserRole,
  needsStore,
  parseCreateUser,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  ROLE_LABELS,
  USER_ROLES,
  type CreateUserInput,
  type StoreOption,
  type UserRole,
} from '@/lib/users';
import {
  primaryButtonClass,
  buttonClass,
  inputClass,
  labelClass,
} from '@/components/ui/styles';
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
  const activeStores = stores.filter((store) => store.isActive !== false);
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
    if (
      needsStore(role) &&
      !activeStores.some((store) => store.id === parsed.data.storeId)
    ) {
      setValidationError('Selecciona un local activo.');
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
            autoComplete="email"
            className={inputClass}
          />
        </label>
        <label className={`${labelClass} space-y-1.5`}>
          <span>Contraseña inicial</span>
          <input
            name="password"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            aria-describedby="password-help"
            className={inputClass}
          />
        </label>
        <p id="password-help" className="text-xs text-ink2">
          Entre 8 y 32 caracteres. Entrégala al usuario por un medio seguro.
        </p>
        <label className={`${labelClass} space-y-1.5`}>
          <span>Rol</span>
          <select
            name="roleCode"
            value={role}
            className={inputClass}
            onChange={(event) => {
              if (isUserRole(event.target.value)) setRole(event.target.value);
            }}
          >
            {USER_ROLES.map((code) => (
              <option
                key={code}
                value={code}
                disabled={needsStore(code) && activeStores.length === 0}
              >
                {ROLE_LABELS[code]}
              </option>
            ))}
          </select>
        </label>
        {needsStore(role) ? (
          <label className={`${labelClass} space-y-1.5`}>
            <span>Local asignado</span>
            <select
              name="storeId"
              required
              defaultValue=""
              className={inputClass}
            >
              <option value="" disabled>
                Selecciona un local
              </option>
              {activeStores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="rounded-lg bg-tint px-3 py-2.5 text-xs text-ink2">
            Este rol tiene alcance global sobre los locales.
          </p>
        )}
        {stores.length === 0 && (
          <p className="text-xs text-ink2">
            No hay locales disponibles para asignar supervisores o trabajadores.
          </p>
        )}
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
          {busy ? 'Creando…' : 'Guardar usuario'}
        </button>
      </div>
    </form>
  );
}
