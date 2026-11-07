import type { AuthUser } from '../../auth/types/auth.types.js';
import type { CreateDailyOperationDto } from '../dto/create-daily-operation.dto.js';
import type { DailyOperationResponse } from '../types/daily-operations.types.js';

// Un reintento es idéntico cuando repite exactamente la operación que ya
// existe para el mismo local y fecha: mismos montos, misma diferencia, mismo
// motivo, mismo responsable y mismo voucher (comparado por el hash SHA-256
// del contenido; null cuando no hay propina de tarjeta y no se envió foto).
// Solo en ese caso la API responde 200 con la operación existente; cualquier
// otro contenido distinto responde 409 con el ID consultable (daily-operations.service).
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
    (operation.voucher?.sha256Hash ?? null) === voucherSha256
  );
}
