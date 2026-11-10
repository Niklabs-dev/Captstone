import { NextResponse } from 'next/server';
import { hasTrustedOrigin, isRecord } from '@/lib/auth';
import { callBackend } from '@/lib/auth-backend';
import { isProxyUuid, readProxyForm } from '@/lib/backend-proxy';
import {
  getSupervisorSession,
  getVoucherReaderSession,
} from '@/lib/supervisor-session';
import { isTipDate } from '@/lib/tips';
import {
  DAILY_STORE_INACTIVE_MESSAGE,
  MAX_DIFFERENCE_REASON_LENGTH,
  MAX_VOUCHER_BYTES,
  dailyOperationErrorMessage,
  isCashDifference,
  isDailyAmount,
  isVoucherMimeType,
  parseDailyOperation,
  parseDailyOperations,
  parseEligibleWorkers,
} from '@/lib/daily-operations';

// SPRINT-4R-T01/T03: BFF de la operación diaria del supervisor. Reenvía al
// módulo /daily-operations del backend con JWT y valida el contrato
// multipart, incluida la selección de trabajadores participantes
// (participantIds repetido, sin datos personales en las respuestas).
type Context = { params: Promise<{ path?: string[] }> };

function respond(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
function failure(status: number): NextResponse {
  const safeStatus = [
    400, 401, 403, 404, 409, 413, 415, 429, 502, 503,
  ].includes(status)
    ? status
    : 502;
  return respond(
    { message: dailyOperationErrorMessage(safeStatus) },
    safeStatus,
  );
}
function isUnsignedAmountText(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return false;
  return isDailyAmount(Number(value.trim()));
}
function isSignedDifferenceText(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value.trim()))
    return false;
  return isCashDifference(Number(value.trim()));
}
// SPRINT-4R-T03: la selección llega como campos "participantIds" repetidos;
// se exigen UUID válidos sin duplicados (el orden no tiene significado).
function readParticipantIds(form: FormData): string[] | null {
  const values = form.getAll('participantIds');
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || !isProxyUuid(value)) return null;
    if (ids.includes(value)) return null;
    ids.push(value);
  }
  return ids;
}
// Para la corrección PATCH el campo ausente significa "no tocar la selección"
// (undefined); presente con UUID inválidos o duplicados se rechaza (null).
function readOptionalParticipantIds(
  form: FormData,
): string[] | null | undefined {
  if (!form.has('participantIds')) return undefined;
  return readParticipantIds(form);
}
function sameParticipantIds(
  sent: readonly string[],
  responded: readonly { id: string }[],
): boolean {
  if (sent.length !== responded.length) return false;
  const respondedIds = responded.map((participant) => participant.id);
  return sent.every((id) => respondedIds.includes(id));
}
function invalidVoucherFile(voucher: FormDataEntryValue | null): boolean {
  return voucher !== null && (!(voucher instanceof File) || voucher.size === 0);
}
// Descarga privada del voucher (SPRINT-4R-T01, abierta al administrador en
// SPRINT-4A-T11): reenvía el binario y el estado de integridad. El alcance por
// local del supervisor lo aplica el backend (403 para otro local).
async function downloadVoucher(
  request: Request,
  operationId: string,
): Promise<Response> {
  const session = await getVoucherReaderSession();
  if (!session.ok) return failure(session.status);
  if (new URL(request.url).search) return failure(400);
  const upstream = await callBackend(
    `/daily-operations/${operationId}/voucher`,
    {
      headers: { Authorization: 'Bearer ' + session.token },
      redirect: 'error',
    },
  );
  if (!upstream) return failure(503);
  if (upstream.status !== 200) {
    await upstream.body?.cancel();
    return failure(upstream.ok ? 502 : upstream.status);
  }
  const forwarded = new Headers({ 'X-Content-Type-Options': 'nosniff' });
  for (const name of [
    'Content-Type',
    'Content-Length',
    'Content-Disposition',
    'X-Voucher-Integrity',
  ]) {
    const value = upstream.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  forwarded.set('Cache-Control', 'private, no-store');
  return new Response(upstream.body, { status: 200, headers: forwarded });
}
export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const { path = [] } = await context.params;
  if (path.length === 2 && isProxyUuid(path[0]) && path[1] === 'voucher')
    return downloadVoucher(request, path[0]);
  const session = await getSupervisorSession();
  if (!session.ok) return failure(session.status);
  const query = new URL(request.url).searchParams;
  if (!path.length) {
    const storeId = query.get('storeId');
    const date = query.get('businessDate');
    if (
      query.size !== 2 ||
      query.getAll('storeId').length !== 1 ||
      query.getAll('businessDate').length !== 1 ||
      !storeId ||
      !isProxyUuid(storeId) ||
      storeId !== session.user.storeId ||
      !isTipDate(date)
    )
      return failure(400);
    const params = new URLSearchParams({
      storeId: session.user.storeId,
      businessDate: date,
    });
    const upstream = await callBackend('/daily-operations?' + params, {
      headers: { Authorization: 'Bearer ' + session.token },
      redirect: 'error',
    });
    if (!upstream) return failure(503);
    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      return failure(upstream.ok ? 502 : upstream.status);
    }
    const operations = parseDailyOperations(
      await upstream.json().catch(() => null),
      session.user.storeId,
      date,
    );
    return operations ? respond(operations) : failure(502);
  }
  // Catálogo acotado de trabajadores elegibles del propio local
  // (SPRINT-4R-T03): solo se acepta el local de la sesión.
  if (path.length === 1 && path[0] === 'eligible-workers') {
    const storeId = query.get('storeId');
    if (
      query.size !== 1 ||
      query.getAll('storeId').length !== 1 ||
      !storeId ||
      !isProxyUuid(storeId) ||
      storeId !== session.user.storeId
    )
      return failure(400);
    const upstream = await callBackend(
      '/daily-operations/eligible-workers?' +
        new URLSearchParams({ storeId: session.user.storeId }),
      {
        headers: { Authorization: 'Bearer ' + session.token },
        redirect: 'error',
      },
    );
    if (!upstream) return failure(503);
    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      return failure(upstream.ok ? 502 : upstream.status);
    }
    const workers = parseEligibleWorkers(
      await upstream.json().catch(() => null),
    );
    return workers ? respond(workers) : failure(502);
  }
  if ([...query.keys()].length) return failure(400);
  if (path.length === 1 && isProxyUuid(path[0])) {
    const upstream = await callBackend('/daily-operations/' + path[0], {
      headers: { Authorization: 'Bearer ' + session.token },
      redirect: 'error',
    });
    if (!upstream) return failure(503);
    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      return failure(upstream.ok ? 502 : upstream.status);
    }
    const operation = parseDailyOperation(
      await upstream.json().catch(() => null),
      session.user.storeId,
    );
    return operation ? respond(operation) : failure(502);
  }
  return failure(404);
}
export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasTrustedOrigin(request))
    return respond({ message: 'Origen no permitido.' }, 403);
  const session = await getSupervisorSession();
  if (!session.ok) return failure(session.status);
  const { path = [] } = await context.params;
  if (path.length) return failure(404);
  if (new URL(request.url).search) return failure(400);
  const form = await readProxyForm(request, MAX_VOUCHER_BYTES);
  if (!form) return failure(400);
  // Esquema estricto: solo los campos del contrato; nunca identidad o
  // responsable editables desde el formulario.
  const allowedFields = [
    'storeId',
    'businessDate',
    'cardTipAmount',
    'cashTipAmount',
    'cashDifference',
    'differenceReason',
    'voucher',
    'participantIds',
  ];
  for (const key of form.keys())
    if (!allowedFields.includes(key)) return failure(400);
  const storeId = form.get('storeId');
  const businessDate = form.get('businessDate');
  const cardTipAmount = form.get('cardTipAmount');
  const cashTipAmount = form.get('cashTipAmount');
  const cashDifference = form.get('cashDifference');
  const reason = form.get('differenceReason');
  const voucher = form.get('voucher');
  const participantIds = readParticipantIds(form);
  // El tipo y tamaño del voucher se validan antes que el resto del esquema,
  // como en el contrato T01 (415/413 independientes de otros campos).
  if (voucher instanceof File && !isVoucherMimeType(voucher.type))
    return failure(415);
  if (voucher instanceof File && voucher.size > MAX_VOUCHER_BYTES)
    return failure(413);
  if (
    typeof storeId !== 'string' ||
    !isProxyUuid(storeId) ||
    storeId !== session.user.storeId ||
    !isTipDate(businessDate) ||
    !isUnsignedAmountText(cardTipAmount) ||
    !isUnsignedAmountText(cashTipAmount) ||
    !isSignedDifferenceText(cashDifference) ||
    (reason !== null &&
      (typeof reason !== 'string' ||
        reason.length > MAX_DIFFERENCE_REASON_LENGTH)) ||
    (Number(cashDifference.trim()) !== 0 &&
      (reason === null || !reason.trim())) ||
    invalidVoucherFile(voucher) ||
    (Number(cardTipAmount.trim()) > 0 && voucher === null) ||
    (Number(cardTipAmount.trim()) === 0 && voucher !== null) ||
    participantIds === null ||
    // Con fondo de propinas se exige al menos un participante (SPRINT-4R-T03).
    (Number(cardTipAmount.trim()) + Number(cashTipAmount.trim()) > 0 &&
      participantIds.length === 0)
  )
    return failure(400);
  // Se reconstruye el multipart con únicamente los campos del contrato; el
  // local siempre es el de la sesión y nunca uno arbitrario del formulario.
  const payload = new FormData();
  payload.set('storeId', session.user.storeId);
  payload.set('businessDate', businessDate);
  payload.set('cardTipAmount', cardTipAmount.trim());
  payload.set('cashTipAmount', cashTipAmount.trim());
  payload.set('cashDifference', cashDifference.trim());
  if (reason !== null && reason.trim())
    payload.set('differenceReason', reason.trim());
  for (const participantId of participantIds)
    payload.append('participantIds', participantId);
  if (voucher instanceof File) payload.set('voucher', voucher);
  const upstream = await callBackend('/daily-operations', {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + session.token },
    body: payload,
  });
  if (!upstream) return failure(503);
  if (upstream.status === 400) {
    const error: unknown = await upstream.json().catch(() => null);
    // Solo este mensaje conocido del contrato se traduce a un motivo público.
    if (
      isRecord(error) &&
      error.message === 'El local indicado no existe o está inactivo'
    )
      return respond(
        { code: 'STORE_INACTIVE', message: DAILY_STORE_INACTIVE_MESSAGE },
        400,
      );
    return failure(400);
  }
  if (upstream.status === 409) {
    const error: unknown = await upstream.json().catch(() => null);
    const existing = isRecord(error) ? error.existingOperationId : undefined;
    return respond(
      {
        message: dailyOperationErrorMessage(409),
        ...(typeof existing === 'string' && isProxyUuid(existing)
          ? { existingOperationId: existing }
          : {}),
      },
      409,
    );
  }
  if (![200, 201].includes(upstream.status)) {
    await upstream.body?.cancel();
    return failure(upstream.ok ? 502 : upstream.status);
  }
  const operation = parseDailyOperation(
    await upstream.json().catch(() => null),
    session.user.storeId,
    businessDate,
  );
  const reasonText = reason !== null && reason.trim() ? reason.trim() : null;
  // El servicio miente si la operación devuelta no refleja lo enviado,
  // incluida la selección de participantes como conjunto (sin orden).
  if (
    !operation ||
    operation.businessDate !== businessDate ||
    operation.cardTipAmount !== Number(cardTipAmount.trim()) ||
    operation.cashTipAmount !== Number(cashTipAmount.trim()) ||
    operation.cashDifference !== Number(cashDifference.trim()) ||
    (operation.differenceReason ?? null) !== reasonText ||
    operation.responsible.id !== session.user.id ||
    !sameParticipantIds(participantIds, operation.participants)
  )
    return failure(502);
  return respond(operation, upstream.status);
}
// SPRINT-4R-T03: corrección parcial de la operación y/o de la selección de
// participantes. Solo campos del contrato; los ausentes no se modifican y el
// voucher se conserva salvo reemplazo explícito.
export async function PATCH(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasTrustedOrigin(request))
    return respond({ message: 'Origen no permitido.' }, 403);
  const session = await getSupervisorSession();
  if (!session.ok) return failure(session.status);
  const { path = [] } = await context.params;
  if (!(path.length === 1 && isProxyUuid(path[0]))) return failure(404);
  if (new URL(request.url).search) return failure(400);
  const form = await readProxyForm(request, MAX_VOUCHER_BYTES);
  if (!form) return failure(400);
  const allowedFields = [
    'cardTipAmount',
    'cashTipAmount',
    'cashDifference',
    'differenceReason',
    'voucher',
    'participantIds',
  ];
  for (const key of form.keys())
    if (!allowedFields.includes(key)) return failure(400);
  const cardTipAmount = form.get('cardTipAmount');
  const cashTipAmount = form.get('cashTipAmount');
  const cashDifference = form.get('cashDifference');
  const reason = form.get('differenceReason');
  const voucher = form.get('voucher');
  const participantIds = readOptionalParticipantIds(form);
  const hasChanges =
    cardTipAmount !== null ||
    cashTipAmount !== null ||
    cashDifference !== null ||
    reason !== null ||
    voucher !== null ||
    participantIds !== undefined;
  if (voucher instanceof File && !isVoucherMimeType(voucher.type))
    return failure(415);
  if (voucher instanceof File && voucher.size > MAX_VOUCHER_BYTES)
    return failure(413);
  if (
    !hasChanges ||
    (cardTipAmount !== null && !isUnsignedAmountText(cardTipAmount)) ||
    (cashTipAmount !== null && !isUnsignedAmountText(cashTipAmount)) ||
    (cashDifference !== null && !isSignedDifferenceText(cashDifference)) ||
    (reason !== null &&
      (typeof reason !== 'string' ||
        reason.length > MAX_DIFFERENCE_REASON_LENGTH)) ||
    // Con diferencia distinta de cero el motivo lo exige el servicio: conoce
    // el motivo ya registrado, mientras que este BFF solo ve lo enviado.
    invalidVoucherFile(voucher) ||
    // El voucher de reemplazo solo se admite con propina con tarjeta resultante.
    (voucher !== null &&
      cardTipAmount !== null &&
      Number(cardTipAmount.trim()) === 0) ||
    participantIds === null
  )
    return failure(400);
  if (
    cardTipAmount !== null &&
    cashTipAmount !== null &&
    Number(cardTipAmount.trim()) + Number(cashTipAmount.trim()) > 0 &&
    participantIds !== undefined &&
    participantIds.length === 0
  )
    return failure(400);
  const payload = new FormData();
  if (cardTipAmount !== null)
    payload.set('cardTipAmount', cardTipAmount.trim());
  if (cashTipAmount !== null)
    payload.set('cashTipAmount', cashTipAmount.trim());
  if (cashDifference !== null)
    payload.set('cashDifference', cashDifference.trim());
  if (reason !== null && reason.trim())
    payload.set('differenceReason', reason.trim());
  if (participantIds !== undefined)
    for (const participantId of participantIds)
      payload.append('participantIds', participantId);
  if (voucher instanceof File) payload.set('voucher', voucher);
  const upstream = await callBackend('/daily-operations/' + path[0], {
    method: 'PATCH',
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + session.token },
    body: payload,
  });
  if (!upstream) return failure(503);
  if (upstream.status === 409) {
    const error: unknown = await upstream.json().catch(() => null);
    const existing = isRecord(error) ? error.existingOperationId : undefined;
    return respond(
      {
        message: dailyOperationErrorMessage(409),
        ...(typeof existing === 'string' && isProxyUuid(existing)
          ? { existingOperationId: existing }
          : {}),
      },
      409,
    );
  }
  if (upstream.status !== 200) {
    await upstream.body?.cancel();
    return failure(upstream.ok ? 502 : upstream.status);
  }
  const operation = parseDailyOperation(
    await upstream.json().catch(() => null),
    session.user.storeId,
  );
  // Los campos enviados deben quedar reflejados en la respuesta; los no
  // enviados se conservan y no se verifican contra el estado previo.
  if (
    !operation ||
    (cardTipAmount !== null &&
      operation.cardTipAmount !== Number(cardTipAmount.trim())) ||
    (cashTipAmount !== null &&
      operation.cashTipAmount !== Number(cashTipAmount.trim())) ||
    (cashDifference !== null &&
      operation.cashDifference !== Number(cashDifference.trim())) ||
    (reason !== null &&
      (operation.differenceReason ?? null) !==
        (reason.trim() ? reason.trim() : null)) ||
    (participantIds !== undefined &&
      !sameParticipantIds(participantIds, operation.participants))
  )
    return failure(502);
  return respond(operation, upstream.status);
}
