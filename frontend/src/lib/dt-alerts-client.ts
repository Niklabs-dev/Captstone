import {
  parseDtAlerts,
  parseDtRegistration,
  type DtAlert,
  type DtAlertCollection,
  type DtRegistration,
} from './dt-alerts';

export class DtAlertError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'DtAlertError';
  }
}
async function request(
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<unknown> {
  try {
    const response = await fetcher('/api/dt-alerts' + path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: 'Tu sesión venció. Vuelve a iniciar sesión.',
        403: 'No tienes permiso para gestionar estas alertas.',
        409: 'El documento cambió o ya fue registrado. Actualiza el panel antes de continuar.',
        503: 'El servicio de alertas DT aún no está disponible. Intenta más tarde.',
      };
      throw new DtAlertError(
        messages[response.status] ??
          'No se pudo completar la operación. Intenta nuevamente.',
        response.status,
      );
    }
    return await response.json().catch(() => invalidContract());
  } catch (error) {
    if (
      error instanceof DtAlertError ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw error;
    throw new DtAlertError(
      'No se pudo conectar con el servicio de alertas DT. Intenta nuevamente.',
      503,
    );
  }
}
function invalidContract(): never {
  throw new DtAlertError(
    'La respuesta del servicio no pudo verificarse. Actualiza el panel.',
    502,
  );
}
export async function loadDtAlerts(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<DtAlertCollection> {
  return (
    parseDtAlerts(await request('', { signal }, fetcher)) ?? invalidContract()
  );
}
export async function registerDtAlert(
  alert: DtAlert,
  fetcher: typeof fetch = fetch,
): Promise<DtRegistration> {
  const result = await request(
    '/' + encodeURIComponent(alert.id) + '/registration',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: alert.documentId,
        revision: alert.revision,
      }),
    },
    fetcher,
  );
  return parseDtRegistration(result, alert) ?? invalidContract();
}
