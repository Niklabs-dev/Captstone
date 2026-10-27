'use client';
import { useState, type FormEvent, type ReactElement } from 'react';
import { parsePasswordReset } from '@/lib/users';
import {
  inputClass,
  dialogActionsClass,
  labelClass,
  buttonClass,
  primaryButtonClass,
} from '@/components/ui/styles';
export function ResetPasswordForm({
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  error: string;
  onSubmit: (input: { newPassword: string }) => Promise<undefined>;
  onCancel: () => void;
}): ReactElement {
  const [validationError, setValidationError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>): Promise<undefined> {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const input = parsePasswordReset({ newPassword: form.get('newPassword') });
    if (!input.ok) {
      setValidationError(input.message);
      return;
    }
    if (input.data.newPassword !== form.get('confirmation')) {
      setValidationError('Las contraseñas no coinciden. Vuelve a confirmarla.');
      return;
    }
    setValidationError('');
    // La clave solo se lee del formulario para enviarla; no se conserva en estado.
    await onSubmit(input.data);
  }
  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
      <p id="reset-help" className="text-sm leading-6 text-ink2">
        Se revocarán las sesiones para impedir su renovación. Los accesos ya
        emitidos pueden seguir vigentes hasta que venzan. Entrega la nueva clave
        al usuario por un medio seguro.
      </p>
      {(error || validationError) && (
        <p
          role="alert"
          className="rounded-lg bg-crit-bg px-3.5 py-3 text-sm text-crit"
        >
          {error || validationError}
        </p>
      )}
      <fieldset disabled={busy} className="space-y-4">
        <label className={`${labelClass} space-y-1.5`}>
          <span>Nueva contraseña</span>
          <input
            name="newPassword"
            type="password"
            required
            autoComplete="new-password"
            aria-describedby="reset-help reset-policy"
            className={inputClass}
          />
        </label>
        <p id="reset-policy" className="text-xs text-ink2">
          Entre 8 y 32 caracteres, sin superar 72 bytes. La clave actual no se
          muestra.
        </p>
        <label className={`${labelClass} space-y-1.5`}>
          <span>Confirmar nueva contraseña</span>
          <input
            name="confirmation"
            type="password"
            required
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
      </fieldset>
      <div className={dialogActionsClass}>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className={buttonClass}
        >
          Cancelar
        </button>
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Restableciendo…' : 'Restablecer contraseña'}
        </button>
      </div>
    </form>
  );
}
