// Tipos y constantes de la operación diaria (SPRINT-4R-T01). Los montos se
// validan y entregan como enteros de JavaScript (CLP no usa centavos); la
// base los guarda en BIGINT porque el tope supera el entero de 32 bits.

export const MAX_DAILY_OPERATION_AMOUNT = 9_999_999_999;

/// Tamaño máximo del voucher fotográfico (contrato de la API SPRINT-4R-T01).
export const MAX_VOUCHER_SIZE_MB = 5;
export const VOUCHER_BYTES_PER_MB = 1024 * 1024;
export const MAX_VOUCHER_BYTES = MAX_VOUCHER_SIZE_MB * VOUCHER_BYTES_PER_MB;

export interface DailyOperationPersonResponse {
  id: string;
  name: string;
}

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
