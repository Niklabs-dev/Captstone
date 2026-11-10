import {
  parseStore,
  parseStoreErrorCode,
  parseStores,
  storeErrorMessage,
  type Store,
  type StoreErrorCode,
  type StoreInput,
  type StoreOperation,
} from './stores';
export class StoreError extends Error {
  constructor(
    public readonly status: number,
    operation: StoreOperation = 'save',
    public readonly code?: StoreErrorCode,
  ) {
    super(storeErrorMessage(status, operation, code));
    this.name = 'StoreError';
  }
}
async function request(
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<unknown> {
  const operation: StoreOperation =
    !init.method || init.method === 'GET'
      ? 'load'
      : path.endsWith('/deactivate')
        ? 'deactivate'
        : 'save';
  let response: Response;
  try {
    response = await fetcher('/api/stores' + path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new StoreError(503, operation);
  }
  if (!response.ok) {
    // Solo se lee el código seguro del BFF; el mensaje se arma localmente.
    const body: unknown = await response.json().catch(() => null);
    throw new StoreError(
      response.status,
      operation,
      typeof body === 'object' && body !== null && 'code' in body
        ? parseStoreErrorCode(body.code)
        : undefined,
    );
  }
  return response.json().catch(() => {
    throw new StoreError(502, operation);
  });
}
export async function loadStores(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Store[]> {
  const stores = parseStores(await request('', { signal }, fetcher));
  if (!stores) throw new StoreError(502, 'load');
  return stores;
}
export async function saveStore(
  previous: Store | null,
  input: StoreInput,
  fetcher: typeof fetch = fetch,
): Promise<Store> {
  const result = parseStore(
    await request(
      previous ? '/' + encodeURIComponent(previous.id) : '',
      {
        method: previous ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      fetcher,
    ),
  );
  if (
    !result ||
    (previous && result.id !== previous.id) ||
    (!previous && !result.isActive) ||
    result.name !== input.name ||
    result.city !== input.city ||
    result.address !== input.address ||
    (input.subwayStoreId !== undefined &&
      result.subwayStoreId !== input.subwayStoreId)
  )
    throw new StoreError(502);
  return result;
}
export async function changeStoreState(
  previous: Store,
  fetcher: typeof fetch = fetch,
): Promise<Store> {
  const result = parseStore(
    await request(
      '/' +
        encodeURIComponent(previous.id) +
        (previous.isActive ? '/deactivate' : '/reactivate'),
      { method: 'PATCH' },
      fetcher,
    ),
  );
  if (
    !result ||
    result.id !== previous.id ||
    result.isActive === previous.isActive
  )
    throw new StoreError(502);
  return result;
}
