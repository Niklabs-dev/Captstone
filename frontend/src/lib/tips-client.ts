import {
  parseTipEntry,
  parseTipEntries,
  tipErrorMessage,
  type TipInput,
  type TipEntry,
} from './tips';

export class TipRequestError extends Error {
  constructor(public readonly status: number) {
    super(tipErrorMessage(status));
  }
}
export async function loadTips(
  storeId: string,
  date: string,
  signal: AbortSignal,
): Promise<TipEntry[]> {
  const response = await fetch(
    '/api/tips?' + new URLSearchParams({ businessDate: date }),
    { cache: 'no-store', signal },
  );
  if (!response.ok) throw new TipRequestError(response.status);
  const entries = parseTipEntries(
    await response.json().catch(() => null),
    storeId,
    date,
  );
  if (!entries) throw new TipRequestError(502);
  return entries;
}
export async function createTip(
  storeId: string,
  input: TipInput,
): Promise<{ entry: TipEntry; created: boolean }> {
  let response: Response;
  try {
    response = await fetch('/api/tips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new TipRequestError(503);
  }
  if (!response.ok) throw new TipRequestError(response.status);
  const entry = parseTipEntry(
    await response.json().catch(() => null),
    storeId,
    input.businessDate,
  );
  if (
    !entry ||
    ![200, 201].includes(response.status) ||
    entry.paymentMethod !== input.paymentMethod ||
    entry.amount !== input.amount
  )
    throw new TipRequestError(502);
  return { entry, created: response.status === 201 };
}
