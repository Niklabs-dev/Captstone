import {
  inventoryCountErrorMessage,
  parseCountDetail,
  parseCountFieldErrors,
  parseCountFinalization,
  parseCountItem,
  parseCountSummaries,
  parseCountSummary,
  parseStartConflict,
  type CountAction,
  type CountFieldErrors,
  type CountItem,
  type CountLineInput,
  type InventoryCountDetail,
  type InventoryCountFinalization,
  type InventoryCountStatus,
  type InventoryCountSummary,
  type StartConflict,
} from './inventory-count';

// Cliente del BFF de tomas de inventario (SPRINT-5-T07).
export class InventoryCountRequestError extends Error {
  constructor(
    public readonly status: number,
    action: CountAction,
    public readonly fieldErrors: CountFieldErrors | null = null,
    public readonly conflict: StartConflict | null = null,
  ) {
    super(inventoryCountErrorMessage(status, action));
    this.name = 'InventoryCountRequestError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  action: CountAction,
  parse: (value: unknown) => T | null,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/inventory-counts' + path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError')
      throw cause;
    throw new InventoryCountRequestError(503, action);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new InventoryCountRequestError(
      response.status,
      action,
      parseCountFieldErrors(body),
      response.status === 409 ? parseStartConflict(body) : null,
    );
  const parsed = parse(body);
  if (parsed === null) throw new InventoryCountRequestError(502, action);
  return parsed;
}
const json = (method: 'POST' | 'PUT', body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function listCounts(
  status: InventoryCountStatus,
  signal?: AbortSignal,
): Promise<InventoryCountSummary[]> {
  return request(
    '?' + new URLSearchParams({ status }).toString(),
    { signal },
    'load',
    parseCountSummaries,
  );
}
export function loadCount(
  id: string,
  signal?: AbortSignal,
): Promise<InventoryCountDetail> {
  return request('/' + id, { signal }, 'load', parseCountDetail);
}
export function startCount(countDate: string): Promise<InventoryCountSummary> {
  return request('', json('POST', { countDate }), 'start', parseCountSummary);
}
export function saveCountLine(
  countId: string,
  productId: string,
  input: CountLineInput,
): Promise<CountItem> {
  return request(
    `/${countId}/lines/${productId}`,
    json('PUT', input),
    'save',
    parseCountItem,
  );
}
export function finalizeCount(
  countId: string,
): Promise<InventoryCountFinalization> {
  return request(
    `/${countId}/finalize`,
    { method: 'POST' },
    'finalize',
    parseCountFinalization,
  );
}
