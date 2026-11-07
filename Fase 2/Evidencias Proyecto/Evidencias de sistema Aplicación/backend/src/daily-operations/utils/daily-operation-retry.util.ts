import type { AuthUser } from '../../auth/types/auth.types.js';
import type { CreateDailyOperationDto } from '../dto/create-daily-operation.dto.js';
import type { DailyOperationResponse } from '../types/daily-operations.types.js';

// Dos listas de participantes coinciden como conjunto: contienen los mismos
// IDs sin importar el orden ni repeticiones (las repeticiones se rechazan
// antes en la validación, pero aquí no aportan a la comparación).
function sameParticipantSet(
  existing: ReadonlyArray<{ id: string }>,
  requested: readonly string[],
): boolean {
  const toSet = (ids: readonly string[]): Set<string> => new Set(ids);
  const existingIds = existing.map((participant) => participant.id);
  const a = toSet(existingIds);
  const b = toSet(requested);
  return a.size === b.size && existingIds.every((id) => b.has(id));
}

// Un reintento es idéntico cuando repite exactamente la operación que ya
// existe para el mismo local y fecha: mismos montos, misma diferencia, mismo
// motivo, mismo responsable, mismo voucher (comparado por el hash SHA-256
// del contenido; null cuando no hay propina de tarjeta y no se envió foto) y
// misma selección de participantes comparada como conjunto (SPRINT-4R-T03):
// el orden en que el cliente repite el campo participantIds no importa. Solo
// en ese caso la API responde 200 con la operación existente; cualquier otro
// contenido distinto responde 409 con el ID consultable (daily-operations.service).
export function isIdenticalDailyOperationRetry(
  operation: DailyOperationResponse,
  dto: CreateDailyOperationDto,
  voucherSha256: string | null,
  currentUser: AuthUser,
): boolean {
  return (
    operation.store.id === dto.storeId &&
    operation.businessDate === dto.businessDate &&
    operation.responsible.id === currentUser.id &&
    operation.cardTipAmount === dto.cardTipAmount &&
    operation.cashTipAmount === dto.cashTipAmount &&
    operation.cashDifference === dto.cashDifference &&
    operation.differenceReason === (dto.differenceReason ?? null) &&
    (operation.voucher?.sha256Hash ?? null) === voucherSha256 &&
    sameParticipantSet(operation.participants, dto.participantIds ?? [])
  );
}
