import { callBackend, type BackendResult } from './auth-backend';
import {
  countQuery,
  inventoryCountError,
  parseCountDetail,
  parseCountSummaries,
  type CountFilters,
  type CountOperation,
  type InventoryCountDetail,
  type InventoryCountSummary,
} from './inventory-counts';

// Lecturas de las tomas de inventario desde Server Components (SPRINT-5-T09).
// El token nunca sale del servidor, solo se usan rutas construidas aquí y
// cada respuesta se proyecta al contrato antes de pintarse.
async function read<T>(
  path: string,
  token: string,
  parse: (value: unknown) => T | null,
  operation: CountOperation,
): Promise<BackendResult<T>> {
  const upstream = await callBackend(path, {
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!upstream)
    return { ok: false, status: 503, message: inventoryCountError(503) };
  if (!upstream.ok) {
    await upstream.body?.cancel();
    const status = [400, 401, 403, 404, 429].includes(upstream.status)
      ? upstream.status
      : 502;
    return {
      ok: false,
      status,
      message: inventoryCountError(status, operation),
    };
  }
  const parsed = parse(await upstream.json().catch(() => null));
  return parsed
    ? { ok: true, data: parsed }
    : {
        ok: false,
        status: 502,
        message: inventoryCountError(502, operation),
      };
}

export function fetchInventoryCounts(
  token: string,
  filters: CountFilters,
): Promise<BackendResult<InventoryCountSummary[]>> {
  const query = countQuery(filters);
  return read(
    '/inventory-counts' + (query ? '?' + query : ''),
    token,
    parseCountSummaries,
    'list',
  );
}

// El id llega validado como UUID por la página.
export function fetchInventoryCount(
  token: string,
  id: string,
): Promise<BackendResult<InventoryCountDetail>> {
  return read('/inventory-counts/' + id, token, parseCountDetail, 'detail');
}
