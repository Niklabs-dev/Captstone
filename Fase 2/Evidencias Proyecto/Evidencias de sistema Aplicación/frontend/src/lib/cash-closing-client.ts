import { isRecord, isUuidValue, parseCashClosing } from './cash-closings';
import type { CashClosing } from './cash-closings';
import { closingErrorMessage, type ClosingInput } from './cash-closing-form';

export class CashClosingRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: string,
    public readonly existingClosingId?: string,
  ) {
    super(closingErrorMessage(status, code));
    this.name = 'CashClosingRequestError';
  }
}

// Envía el cierre a la ruta del servidor. 201 = creado; 200 = reintento
// idéntico que devuelve el cierre existente sin duplicarlo (T10).
export async function createCashClosing(
  storeId: string,
  input: ClosingInput,
  fetcher: typeof fetch = fetch,
): Promise<{ closing: CashClosing; created: boolean }> {
  let response: Response;
  try {
    response = await fetcher('/api/cash-closings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      redirect: 'error',
      body: JSON.stringify(input),
    });
  } catch {
    throw new CashClosingRequestError(503);
  }
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);
    const code =
      isRecord(error) && typeof error.code === 'string'
        ? error.code
        : undefined;
    const existing =
      isRecord(error) && isUuidValue(error.existingClosingId)
        ? error.existingClosingId
        : undefined;
    throw new CashClosingRequestError(response.status, code, existing);
  }
  const closing = parseCashClosing(await response.json().catch(() => null));
  if (
    !closing ||
    (response.status !== 200 && response.status !== 201) ||
    closing.store.id !== storeId ||
    closing.businessDate !== input.businessDate ||
    closing.shift !== input.shift
  )
    throw new CashClosingRequestError(502);
  return { closing, created: response.status === 201 };
}
