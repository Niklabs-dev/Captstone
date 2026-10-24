import { proxyBackend } from './backend-proxy';
import { parseStores, storeErrorMessage, type Store } from './stores';
import type { BackendResult } from './auth-backend';

export async function fetchStores(
  token: string,
): Promise<BackendResult<Store[]>> {
  const response = await proxyBackend('/stores', token);
  if (!response.ok)
    return {
      ok: false,
      status: response.status,
      message: storeErrorMessage(response.status),
    };
  const stores = parseStores(await response.json().catch(() => null));
  return stores
    ? { ok: true, data: stores }
    : { ok: false, status: 502, message: storeErrorMessage(502) };
}
