import { isRecord } from './auth';
import {
  DAILY_STORE_INACTIVE_MESSAGE,
  dailyOperationErrorMessage,
  parseDailyOperation,
  parseDailyOperations,
  type DailyOperation,
} from './daily-operations';

export class DailyOperationRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly existingOperationId?: string,
    code?: unknown,
  ) {
    super(
      status === 400 && code === 'STORE_INACTIVE'
        ? DAILY_STORE_INACTIVE_MESSAGE
        : dailyOperationErrorMessage(status),
    );
  }
}
export interface DailyOperationInput {
  storeId: string;
  businessDate: string;
  cardTipAmount: number;
  cashTipAmount: number;
  cashDifference: number;
  differenceReason: string;
}
function parseErrorPayload(value: unknown): {
  code?: unknown;
  existingOperationId?: string;
} {
  if (!isRecord(value)) return {};
  const code = typeof value.code === 'string' ? value.code : undefined;
  const existing = value.existingOperationId;
  return {
    ...(code !== undefined ? { code } : {}),
    ...(typeof existing === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      existing,
    )
      ? { existingOperationId: existing }
      : {}),
  };
}
export async function loadDailyOperations(
  storeId: string,
  date: string,
  signal: AbortSignal,
): Promise<DailyOperation[]> {
  const response = await fetch(
    '/api/daily-operations?' +
      new URLSearchParams({ storeId, businessDate: date }),
    { cache: 'no-store', signal },
  );
  if (!response.ok) throw new DailyOperationRequestError(response.status);
  const operations = parseDailyOperations(
    await response.json().catch(() => null),
    storeId,
    date,
  );
  if (!operations) throw new DailyOperationRequestError(502);
  return operations;
}
export async function loadDailyOperationById(
  id: string,
  storeId: string,
  signal: AbortSignal,
): Promise<DailyOperation> {
  const response = await fetch('/api/daily-operations/' + id, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok)
    throw new DailyOperationRequestError(
      response.status,
      undefined,
      parseErrorPayload(await response.json().catch(() => null)).code,
    );
  const operation = parseDailyOperation(
    await response.json().catch(() => null),
    storeId,
  );
  if (!operation) throw new DailyOperationRequestError(502);
  return operation;
}
export async function createDailyOperation(
  input: DailyOperationInput,
  voucher: File | null,
): Promise<{ operation: DailyOperation; created: boolean }> {
  const payload = new FormData();
  payload.set('storeId', input.storeId);
  payload.set('businessDate', input.businessDate);
  payload.set('cardTipAmount', String(input.cardTipAmount));
  payload.set('cashTipAmount', String(input.cashTipAmount));
  payload.set('cashDifference', String(input.cashDifference));
  if (input.differenceReason.trim())
    payload.set('differenceReason', input.differenceReason.trim());
  if (voucher) payload.set('voucher', voucher);
  let response: Response;
  try {
    // El navegador fija el Content-Type multipart con boundary.
    response = await fetch('/api/daily-operations', {
      method: 'POST',
      body: payload,
    });
  } catch {
    throw new DailyOperationRequestError(503);
  }
  if (!response.ok) {
    const error = parseErrorPayload(await response.json().catch(() => null));
    throw new DailyOperationRequestError(
      response.status,
      error.existingOperationId,
      error.code,
    );
  }
  const operation = parseDailyOperation(
    await response.json().catch(() => null),
    input.storeId,
    input.businessDate,
  );
  if (!operation || ![200, 201].includes(response.status))
    throw new DailyOperationRequestError(502);
  return { operation, created: response.status === 201 };
}
