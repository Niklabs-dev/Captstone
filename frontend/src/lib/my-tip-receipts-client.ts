import {
  MAX_RECEIPT_BYTES,
  ownReceiptError,
  parseOwnReceipts,
  verifyReceiptBytes,
  type OwnTipReceipt,
} from './my-tip-receipts';
export class OwnReceiptError extends Error {
  constructor(public readonly status: number) {
    super(ownReceiptError(status));
  }
}
async function fetchOwn(path: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch('/api/my-tip-receipts' + path, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new OwnReceiptError(response.status);
  return response;
}
export async function loadOwnReceipts(
  workerId: string,
  signal: AbortSignal,
): Promise<OwnTipReceipt[]> {
  const response = await fetchOwn('', signal);
  const data = parseOwnReceipts(
    await response.json().catch(() => null),
    workerId,
  );
  if (!data) throw new OwnReceiptError(502);
  return data;
}
export async function downloadOwnReceipt(
  receipt: OwnTipReceipt,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await fetchOwn('/' + receipt.id + '/download', signal);
  const length = Number(response.headers.get('content-length'));
  if (
    !response.headers.get('content-type')?.startsWith('application/pdf') ||
    length > MAX_RECEIPT_BYTES
  )
    throw new OwnReceiptError(502);
  const bytes = await response.arrayBuffer();
  if (
    !(await verifyReceiptBytes(
      bytes,
      response.headers.get('x-content-sha256') ?? '',
    ))
  )
    throw new OwnReceiptError(502);
  return new Blob([bytes], { type: 'application/pdf' });
}
