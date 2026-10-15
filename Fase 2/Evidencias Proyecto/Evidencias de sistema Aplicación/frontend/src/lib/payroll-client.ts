import {
  parsePayroll,
  parsePayrollCollection,
  type Payroll,
  type PayrollCollection,
} from './payroll';
export class PayrollError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PayrollError';
  }
}
function invalidContract(): never {
  throw new PayrollError(
    'La respuesta del servicio no pudo verificarse. Actualiza el listado.',
    502,
  );
}
async function request(
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<unknown> {
  try {
    const response = await fetcher('/api/payroll' + path, {
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
        403: 'No tienes permiso para realizar esta operación.',
        409: 'La liquidación cambió o ya existe para ese período. Actualiza el listado antes de continuar.',
        413: 'El archivo supera el tamaño permitido.',
        422: 'Revisa el trabajador, período y archivo seleccionado.',
        503: 'El servicio de liquidaciones aún no está disponible. Intenta más tarde.',
      };
      throw new PayrollError(
        messages[response.status] ??
          'No se pudo completar la operación. Intenta nuevamente.',
        response.status,
      );
    }
    return await response.json().catch(() => invalidContract());
  } catch (error) {
    if (
      error instanceof PayrollError ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw error;
    throw new PayrollError(
      'No se pudo conectar con el servicio de liquidaciones. Intenta nuevamente.',
      503,
    );
  }
}
export async function loadPayroll(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PayrollCollection> {
  return (
    parsePayrollCollection(await request('', { signal }, fetcher)) ??
    invalidContract()
  );
}
export async function uploadPayroll(
  form: FormData,
  expectedHash: string,
  fetcher: typeof fetch = fetch,
): Promise<Payroll> {
  const result = parsePayroll(
    await request('', { method: 'POST', body: form }, fetcher),
  );
  const file = form.get('file');
  if (
    !result ||
    result.status !== 'PENDING_SIGNATURE' ||
    result.worker.id !== form.get('workerId') ||
    result.period !== form.get('period') ||
    result.sha256 !== expectedHash ||
    !file ||
    typeof file === 'string' ||
    result.size !== file.size ||
    result.fileName !== file.name
  )
    invalidContract();
  return result;
}
export async function publishPayroll(
  previous: Payroll,
  fetcher: typeof fetch = fetch,
): Promise<Payroll> {
  if (previous.status !== 'PENDING_SIGNATURE' || !previous.canPublish)
    throw new PayrollError('Esta liquidación no permite publicación.', 403);
  const result = parsePayroll(
    await request(
      '/' + encodeURIComponent(previous.id) + '/publish',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: previous.revision }),
      },
      fetcher,
    ),
  );
  if (
    !result ||
    result.status !== 'PUBLISHED' ||
    result.id !== previous.id ||
    result.worker.id !== previous.worker.id ||
    result.worker.store.id !== previous.worker.store.id ||
    result.period !== previous.period ||
    result.sha256 !== previous.sha256 ||
    result.size !== previous.size ||
    result.fileName !== previous.fileName ||
    result.createdAt !== previous.createdAt
  )
    invalidContract();
  return result;
}
