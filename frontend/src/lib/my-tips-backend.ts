import type { BackendResult } from './auth-backend';
import { proxyBackend } from './backend-proxy';
import {
  myTipsBackendPath,
  myTipsError,
  parseMyTips,
  type MonthRange,
  type MyTips,
} from './my-tips';

// Consulta de «Mis propinas» desde el servidor (SPRINT-4A-T10): ruta fija
// hacia GET /my-tips con el rango del mes; la identidad la pone el JWT. El
// mensaje del backend nunca llega a la vista: solo el estado, traducido.
export async function fetchMyTips(
  token: string,
  range: MonthRange,
): Promise<BackendResult<MyTips>> {
  const response = await proxyBackend(myTipsBackendPath(range), token);
  if (!response.ok) {
    await response.body?.cancel();
    return {
      ok: false,
      status: response.status,
      message: myTipsError(response.status),
    };
  }
  const data = parseMyTips(await response.json().catch(() => null));
  // La respuesta debe corresponder exactamente al mes consultado.
  return data && data.from === range.from && data.to === range.to
    ? { ok: true, data }
    : { ok: false, status: 502, message: myTipsError(502) };
}
