import { callBackend, type BackendResult } from './auth-backend';
import {
  parsePool,
  parsePools,
  parseReceipts,
  poolError,
  type PoolReceipt,
  type TipPool,
} from './tip-pools';

// Lecturas del histórico de repartos desde Server Components (SPRINT-4A-T08).
// El token nunca sale del servidor, solo se usan rutas construidas aquí y
// cada respuesta se proyecta al contrato antes de pintarse.
async function read<T>(
  path: string,
  token: string,
  parse: (value: unknown) => T | null,
): Promise<BackendResult<T>> {
  const upstream = await callBackend(path, {
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!upstream) return { ok: false, status: 503, message: poolError(503) };
  if (!upstream.ok) {
    await upstream.body?.cancel();
    const status = [400, 401, 403, 404, 409, 429].includes(upstream.status)
      ? upstream.status
      : 502;
    return { ok: false, status, message: poolError(status) };
  }
  const parsed = parse(await upstream.json().catch(() => null));
  return parsed
    ? { ok: true, data: parsed }
    : { ok: false, status: 502, message: poolError(502) };
}

export function fetchPoolHistory(
  token: string,
): Promise<BackendResult<TipPool[]>> {
  return read('/tip-pools', token, parsePools);
}

export function fetchPool(
  token: string,
  id: string,
): Promise<BackendResult<TipPool>> {
  return read('/tip-pools/' + id, token, (value) => {
    const pool = parsePool(value);
    return pool?.id === id ? pool : null;
  });
}

export function fetchPoolReceipts(
  token: string,
  id: string,
): Promise<BackendResult<PoolReceipt[]>> {
  return read('/tip-pools/' + id + '/receipts', token, (value) =>
    parseReceipts(value, id),
  );
}
