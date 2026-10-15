import {
  parseOwnPayslips,
  parsePayslipIntegrity,
  payslipHash,
  type OwnPayslip,
} from './my-payslips';

export class PayslipError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PayslipError';
  }
}
function invalidContract(): never {
  throw new PayslipError(
    'La respuesta del servicio no pudo verificarse. Actualiza tus liquidaciones.',
    502,
  );
}
async function request(
  path: string,
  signal: AbortSignal | undefined,
  fetcher: typeof fetch,
): Promise<Response> {
  try {
    const response = await fetcher('/api/my-payroll' + path, {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: 'Tu sesión venció. Vuelve a iniciar sesión.',
        403: 'No tienes permiso para consultar esta liquidación.',
        404: 'Esta liquidación ya no está disponible. Actualiza el listado.',
        409: 'La liquidación cambió. Actualiza el listado antes de descargarla.',
        503: 'El servicio de liquidaciones aún no está disponible. Intenta más tarde.',
      };
      throw new PayslipError(
        messages[response.status] ??
          'No se pudo completar la operación. Intenta nuevamente.',
        response.status,
      );
    }
    return response;
  } catch (error) {
    if (
      error instanceof PayslipError ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw error;
    throw new PayslipError(
      'No se pudo conectar con el servicio de liquidaciones. Intenta nuevamente.',
      503,
    );
  }
}
export async function loadOwnPayslips(
  workerId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<OwnPayslip[]> {
  // workerId se usa solo para validar la respuesta contra la sesión, nunca se envía como parámetro.
  const response = await request('', signal, fetcher);
  const value: unknown = await response.json().catch(() => invalidContract());
  return parseOwnPayslips(value, workerId) ?? invalidContract();
}
export async function downloadOwnPayslip(
  payslip: OwnPayslip,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Blob> {
  const path = '/' + encodeURIComponent(payslip.id);
  const integrityResponse = await request(path + '/integrity', signal, fetcher);
  const value: unknown = await integrityResponse
    .json()
    .catch(() => invalidContract());
  const integrity = parsePayslipIntegrity(value, payslip) ?? invalidContract();
  if (!integrity.valid) throw alteredFile();
  const response = await request(path + '/download', signal, fetcher);
  const mime = response.headers.get('content-type')?.split(';')[0].trim();
  const length = response.headers.get('content-length');
  if (
    mime !== payslip.mime ||
    (length !== null && Number(length) !== payslip.size) ||
    !response.body
  ) {
    await response.body?.cancel().catch(() => undefined);
    invalidContract();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > payslip.size) invalidContract();
      chunks.push(new Uint8Array(chunk.value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const blob = new Blob(chunks, { type: payslip.mime });
  const bytes = await blob.arrayBuffer();
  if (size !== payslip.size || (await payslipHash(bytes)) !== payslip.sha256)
    throw alteredFile();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    invalidContract();
  return blob;
}
function alteredFile(): PayslipError {
  return new PayslipError(
    'Archivo alterado: la integridad no coincide. Se bloqueó la descarga; informa al administrador.',
    409,
  );
}
