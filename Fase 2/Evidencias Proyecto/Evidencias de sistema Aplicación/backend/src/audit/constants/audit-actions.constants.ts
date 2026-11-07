// Acciones de auditoría que registra el AuditInterceptor (SPRINT-1-T13).
// Convención: UPPER_SNAKE en pasado, igual que las acciones usadas en los
// tests del schema (DOCUMENT_UPLOADED, TIP_POOL_RECALCULATED).
export const AUDIT_ACTION = {
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  USER_CREATED: 'USER_CREATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  // Edición y reactivación de usuarios (SPRINT-3-T03).
  USER_UPDATED: 'USER_UPDATED',
  USER_REACTIVATED: 'USER_REACTIVATED',
  // Restablecimiento de contraseña (SPRINT-3-T04).
  USER_PASSWORD_RESET: 'USER_PASSWORD_RESET',
  // Administración de locales (SPRINT-3-T01).
  STORE_CREATED: 'STORE_CREATED',
  STORE_UPDATED: 'STORE_UPDATED',
  STORE_DEACTIVATED: 'STORE_DEACTIVATED',
  STORE_REACTIVATED: 'STORE_REACTIVATED',
  // Gestor documental (SPRINT-2-T09).
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_VERSION_ADDED: 'DOCUMENT_VERSION_ADDED',
  DOCUMENT_DOWNLOADED: 'DOCUMENT_DOWNLOADED',
  DOCUMENT_DELETED: 'DOCUMENT_DELETED',
  DOCUMENT_DELETION_BLOCKED: 'DOCUMENT_DELETION_BLOCKED',
  DOCUMENT_DT_REGISTERED: 'DOCUMENT_DT_REGISTERED',
  // Liquidaciones de sueldo (SPRINT-2-T13, T14 y T15).
  PAYSLIP_UPLOADED: 'PAYSLIP_UPLOADED',
  PAYSLIP_PUBLISHED: 'PAYSLIP_PUBLISHED',
  PAYSLIP_DOWNLOADED: 'PAYSLIP_DOWNLOADED',
  // Registro diario de propinas (SPRINT-3-T10).
  TIP_ENTRY_CREATED: 'TIP_ENTRY_CREATED',
  TIP_ENTRY_UPDATED: 'TIP_ENTRY_UPDATED',
  TIP_ENTRY_DELETED: 'TIP_ENTRY_DELETED',
  // Cálculo del reparto de propinas (SPRINT-3-T12): primer cálculo del
  // período y recálculo de su borrador.
  TIP_POOL_CALCULATED: 'TIP_POOL_CALCULATED',
  TIP_POOL_RECALCULATED: 'TIP_POOL_RECALCULATED',
  // Confirmación y pago de repartos (SPRINT-3-T13).
  TIP_POOL_OBSERVED: 'TIP_POOL_OBSERVED',
  TIP_POOL_CONFIRMED: 'TIP_POOL_CONFIRMED',
  TIP_POOL_PAID: 'TIP_POOL_PAID',
  TIP_POOL_RECEIPT_DOWNLOADED: 'TIP_POOL_RECEIPT_DOWNLOADED',
  // Cierre de caja y conciliación por turno (SPRINT-4-T09).
  CASH_CLOSING_CREATED: 'CASH_CLOSING_CREATED',
  // Catálogo administrable de medios de pago (SPRINT-4-T32): alta, edición,
  // baja lógica y reactivación; el código es estable y no se audita el
  // cuerpo completo de las solicitudes.
  PAYMENT_METHOD_CREATED: 'PAYMENT_METHOD_CREATED',
  PAYMENT_METHOD_UPDATED: 'PAYMENT_METHOD_UPDATED',
  PAYMENT_METHOD_DEACTIVATED: 'PAYMENT_METHOD_DEACTIVATED',
  PAYMENT_METHOD_REACTIVATED: 'PAYMENT_METHOD_REACTIVATED',
  // Ingreso de totales netos de ventas MrComanda por local y período
  // (SPRINT-4-T32); el reintento idéntico no se audita de nuevo.
  MRCOMANDA_SALES_IMPORTED: 'MRCOMANDA_SALES_IMPORTED',
  // Alta y corrección de la operación diaria por local y fecha (SPRINT-4R-T01
  // y SPRINT-4R-T03): captura de ambos montos de propina, diferencia de
  // efectivo, voucher fotográfico y selección de participantes; el reintento
  // idéntico no se audita de nuevo. El detalle usa listas blancas y jamás
  // incluye contenido del archivo ni datos personales de los trabajadores.
  DAILY_OPERATION_CREATED: 'DAILY_OPERATION_CREATED',
  DAILY_OPERATION_UPDATED: 'DAILY_OPERATION_UPDATED',
  DAILY_OPERATION_VOUCHER_DOWNLOADED: 'DAILY_OPERATION_VOUCHER_DOWNLOADED',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];
