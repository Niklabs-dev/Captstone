import { isRecord } from './auth';
import {
  dailyTipsError,
  exportFileName,
  parsePaymentBatch,
  parsePaymentBatches,
  parseTipDayDetail,
  parseTipDays,
  parseTipSummary,
  rangeQuery,
  type PaymentBatch,
  type TipDayDetail,
  type TipDays,
  type TipSummary,
  type TipsOperation,
  type TipsRange,
} from './daily-tips';

// Cliente del BFF /api/daily-tips (SPRINT-4A-T07). Cada respuesta se vuelve
// a validar antes de pintarse; los errores llevan el mensaje saneado del BFF.
export class TipsRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TipsRequestError';
  }
}

async function send(
  path: string,
  operation: TipsOperation,
  init: RequestInit = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch('/api/daily-tips/' + path, {
      ...init,
      cache: 'no-store',
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError')
      throw cause;
    throw new TipsRequestError(503, dailyTipsError(503, operation));
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new TipsRequestError(
      response.status,
      isRecord(body) && typeof body.message === 'string'
        ? body.message
        : dailyTipsError(response.status, operation),
    );
  }
  return response;
}
async function read<T>(
  path: string,
  operation: TipsOperation,
  parse: (value: unknown) => T | null,
  init: RequestInit = {},
): Promise<T> {
  const response = await send(path, operation, init);
  const parsed = parse(await response.json().catch(() => null));
  if (parsed === null)
    throw new TipsRequestError(502, dailyTipsError(502, operation));
  return parsed;
}

export function loadTipDays(
  range: TipsRange,
  signal?: AbortSignal,
): Promise<TipDays> {
  return read('days?' + rangeQuery(range), 'load', parseTipDays, { signal });
}
export function loadTipSummary(
  range: TipsRange,
  signal?: AbortSignal,
): Promise<TipSummary> {
  return read('summary?' + rangeQuery(range), 'load', parseTipSummary, {
    signal,
  });
}
export function loadTipDay(
  storeId: string,
  businessDate: string,
): Promise<TipDayDetail> {
  return read(
    'day?' + new URLSearchParams({ storeId, businessDate }).toString(),
    'day',
    parseTipDayDetail,
  );
}
export function loadPaymentBatches(
  range: TipsRange,
  signal?: AbortSignal,
): Promise<PaymentBatch[]> {
  return read(
    'payment-batches?' + rangeQuery(range),
    'batches',
    parsePaymentBatches,
    { signal },
  );
}
export function payTipsPeriod(range: TipsRange): Promise<PaymentBatch> {
  return read('payment-batches', 'pay', parsePaymentBatch, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storeId: range.storeId,
      from: range.from,
      to: range.to,
    }),
  });
}
// Descarga el Excel del período y lo entrega al navegador como archivo.
export async function downloadTipsExport(range: TipsRange): Promise<string> {
  const response = await send('export?' + rangeQuery(range), 'export');
  const blob = await response.blob().catch(() => null);
  if (!blob || blob.size === 0)
    throw new TipsRequestError(502, dailyTipsError(502, 'export'));
  const name = exportFileName(
    response.headers.get('Content-Disposition'),
    range,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
