import { ROLE, type RoleCode } from '../../auth/constants/roles.constants.js';
import type { TipAllocationStatusCode } from '../../tips/types/daily-tips.types.js';

// Tipos y constantes de la operación diaria (SPRINT-4R-T01). Los montos se
// validan y entregan como enteros de JavaScript (CLP no usa centavos); la
// base los guarda en BIGINT porque el tope supera el entero de 32 bits.

/// Roles que pueden participar del reparto de propinas del día
/// (SPRINT-4A-T01): el supervisor también es trabajador del local y recibe su
/// parte. Debe coincidir con el trigger
/// daily_operation_participants_validate_worker (migración
/// 20261110030000_participantes_incluyen_supervisor). ADMINISTRADOR y
/// CONTADOR son roles globales y nunca participan.
export const TIP_PARTICIPANT_ROLES: readonly RoleCode[] = [
  ROLE.TRABAJADOR,
  ROLE.SUPERVISOR,
];

export const MAX_DAILY_OPERATION_AMOUNT = 9_999_999_999;

/// Tamaño máximo del voucher fotográfico (contrato de la API SPRINT-4R-T01).
export const MAX_VOUCHER_SIZE_MB = 5;
export const VOUCHER_BYTES_PER_MB = 1024 * 1024;
export const MAX_VOUCHER_BYTES = MAX_VOUCHER_SIZE_MB * VOUCHER_BYTES_PER_MB;

export interface DailyOperationPersonResponse {
  id: string;
  name: string;
}

// Trabajador (TRABAJADOR o SUPERVISOR) elegible para el reparto del día, tal
// como lo expone el catálogo acotado (GET /daily-operations/eligible-workers):
// solo id y nombre, nunca
// RUT, correo, teléfono ni credenciales (Ley N°21.719).
export type EligibleWorkerResponse = DailyOperationPersonResponse;

/// Metadatos del voucher fotográfico tal como se entregan por la API. El
/// archivo en sí solo se descarga por GET /daily-operations/:id/voucher.
export interface DailyOperationVoucherResponse {
  id: string;
  fileName: string;
  mimeType: VoucherMimeType;
  sizeBytes: number;
  sha256Hash: string;
  createdAt: Date;
}

/// Propina del día de un trabajador (SPRINT-4A-T03): la asignación que el
/// sistema guarda al registrar o corregir la operación, con su estado de pago.
export interface DailyTipAllocationResponse {
  id: string;
  worker: DailyOperationPersonResponse;
  amount: number;
  status: TipAllocationStatusCode;
}

export interface DailyOperationResponse {
  id: string;
  store: { id: string; name: string };
  businessDate: string;
  cardTipAmount: number;
  cashTipAmount: number;
  tipFundAmount: number;
  cashDifference: number;
  differenceReason: string | null;
  voucher: DailyOperationVoucherResponse | null;
  responsible: DailyOperationPersonResponse;
  // Selección compartida por la propina de tarjeta y la de efectivo del
  // mismo local/día (SPRINT-4R-T03); solo id y nombre de cada trabajador.
  participants: DailyOperationPersonResponse[];
  // Reparto automático del fondo entre los participantes (SPRINT-4A-T03):
  // una asignación por participante que suma el fondo; vacío con fondo 0.
  tipAllocations: DailyTipAllocationResponse[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DailyOperationCreateResult {
  operation: DailyOperationResponse;
  created: boolean;
}

/// Tipos reales detectables por firma de bytes (magic bytes) del voucher.
export const VOUCHER_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type VoucherMimeType = (typeof VOUCHER_MIME_TYPES)[number];
