import {
  parsePayroll,
  parsePayrollCollection,
  payrollBusinessDate,
  validatePayrollSignedAt,
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
      const error: unknown = await response.json().catch(() => null);
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : null;
      const conflict =
        code === 'DUPLICATE_FILE'
          ? 'Este archivo ya está registrado. Selecciona otro archivo.'
          : code === 'PAYROLL_ALREADY_EXISTS' ||
              (path === '' && init.method === 'POST')
            ? 'Ya existe una liquidación para ese trabajador y período o el archivo ya está registrado. Revisa el listado y selecciona otro archivo si corresponde.'
            : 'La liquidación cambió desde tu consulta. Actualiza el listado antes de publicarla.';
      const messages: Record<number, string> = {
        401: 'Tu sesión venció. Vuelve a iniciar sesión.',
        403: 'No tienes permiso para realizar esta operación.',
        400: 'Revisa el trabajador, período y archivo. El período no puede ser posterior al mes actual (hora de Chile).',
        409: conflict,
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
  const period = form.get('period');
  if (typeof period === 'string' && period > payrollBusinessDate().slice(0, 7))
    throw new PayrollError(
      'El período no puede ser posterior al mes actual (hora de Chile).',
      400,
    );
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
    result.size !== file.size
  )
    invalidContract();
  return result;
}
export async function publishPayroll(
  previous: Payroll,
  signedAt: string = payrollBusinessDate(),
  fetcher: typeof fetch = fetch,
): Promise<Payroll> {
  if (previous.status !== 'PENDING_SIGNATURE' || !previous.canPublish)
    throw new PayrollError('Esta liquidación no permite publicación.', 403);
  const error = validatePayrollSignedAt(signedAt, previous);
  if (error) throw new PayrollError(error, 400);
  const result = parsePayroll(
    await request(
      '/' + encodeURIComponent(previous.id) + '/publish',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: previous.revision, signedAt }),
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
    result.createdAt !== previous.createdAt ||
    result.signedAt !== signedAt
  )
    invalidContract();
  return result;
}
