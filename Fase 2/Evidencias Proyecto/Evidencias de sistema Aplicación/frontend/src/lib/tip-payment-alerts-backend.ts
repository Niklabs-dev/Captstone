import { callBackend, type BackendResult } from './auth-backend';
import {
  parseTipPaymentAlerts,
  tipAlertsError,
  type TipPaymentAlerts,
} from './tip-payment-alerts';

// Lectura de la alerta legal de pago de propinas (SPRINT-4A-T22) desde
// Server Components. El token nunca sale del servidor, la respuesta se
// proyecta al contrato antes de pintarse y los mensajes del backend no se
// muestran: cada estado tiene su texto propio.
export async function fetchTipPaymentAlerts(
  token: string,
): Promise<BackendResult<TipPaymentAlerts>> {
  const upstream = await callBackend('/tip-payment-alerts', {
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!upstream)
    return { ok: false, status: 503, message: tipAlertsError(503) };
  if (!upstream.ok) {
    await upstream.body?.cancel();
    const status = [401, 403, 429].includes(upstream.status)
      ? upstream.status
      : 502;
    return { ok: false, status, message: tipAlertsError(status) };
  }
  const parsed = parseTipPaymentAlerts(await upstream.json().catch(() => null));
  return parsed
    ? { ok: true, data: parsed }
    : { ok: false, status: 502, message: tipAlertsError(502) };
}
