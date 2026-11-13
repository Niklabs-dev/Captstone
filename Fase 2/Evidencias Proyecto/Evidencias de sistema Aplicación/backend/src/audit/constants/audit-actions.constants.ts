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
  // Intento autenticado rechazado con 403 por rol, local o recurso
  // (SPRINT-4R-T15). Lo registra el filtro global AccessDeniedAuditFilter en
  // cualquier ruta, sin cuerpo, consulta ni datos personales.
  ACCESS_DENIED: 'ACCESS_DENIED',
  // Importación diaria de ventas MrComanda (SPRINT-4R-T10): carga de un
  // archivo nuevo (vista previa guardada como PENDING), confirmación (con la
  // versión que reemplaza), descarte y descarga del archivo. El detalle usa
  // listas blancas (local, fecha, hash, versión y total) y jamás incluye el
  // contenido del archivo; los reintentos idempotentes no se auditan de nuevo.
  SALES_IMPORT_PREVIEWED: 'SALES_IMPORT_PREVIEWED',
  SALES_IMPORT_CONFIRMED: 'SALES_IMPORT_CONFIRMED',
  SALES_IMPORT_DISCARDED: 'SALES_IMPORT_DISCARDED',
  SALES_IMPORT_FILE_DOWNLOADED: 'SALES_IMPORT_FILE_DOWNLOADED',
  // Alias de un medio de pago (etiqueta del informe de MrComanda): alta al
  // «recordar» un medio elegido a mano en la importación (SPRINT-4A-T18) o
  // desde /admin/medios-pago, y baja (SPRINT-4A-T20). El detalle registra
  // etiqueta, medio y origen.
  PAYMENT_METHOD_ALIAS_CREATED: 'PAYMENT_METHOD_ALIAS_CREATED',
  PAYMENT_METHOD_ALIAS_DELETED: 'PAYMENT_METHOD_ALIAS_DELETED',
  // Calendario de operación de los locales (SPRINT-4R-T12): cambio de días
  // semanales y fecha de inicio (con la configuración anterior), y alta o
  // retiro de una excepción de cierre (con su fecha y motivo).
  STORE_OPERATING_CALENDAR_UPDATED: 'STORE_OPERATING_CALENDAR_UPDATED',
  STORE_CLOSURE_CREATED: 'STORE_CLOSURE_CREATED',
  STORE_CLOSURE_DELETED: 'STORE_CLOSURE_DELETED',
  // Exportación a Excel de las propinas del período (SPRINT-4A-T05): el
  // detalle registra local, rango y cantidades, jamás montos ni datos
  // personales (Ley N°21.719).
  DAILY_TIPS_EXPORTED: 'DAILY_TIPS_EXPORTED',
  // Pago por período de las propinas diarias (SPRINT-4A-T06): un lote marca
  // las propinas No pagadas del local y período. El detalle registra local,
  // período, total y cantidades; el responsable y la fecha van en el evento.
  DAILY_TIPS_PAID: 'DAILY_TIPS_PAID',
  // Catálogo de productos de inventario (SPRINT-5-T03): el detalle guarda el
  // valor anterior y el nuevo (nombre, nombres alternativos, SKU, sección,
  // posición y formato).
  PRODUCT_CREATED: 'PRODUCT_CREATED',
  PRODUCT_UPDATED: 'PRODUCT_UPDATED',
  PRODUCT_MOVED: 'PRODUCT_MOVED',
  PRODUCT_DEACTIVATED: 'PRODUCT_DEACTIVATED',
  PRODUCT_REACTIVATED: 'PRODUCT_REACTIVATED',
  // Filas de la plantilla de inventario (SPRINT-5-T03): texto corregido de
  // una fila sin producto y fila liberada de un producto desactivado. El
  // detalle guarda la fila antes y después (posición, texto y producto).
  INVENTORY_TEMPLATE_ROW_UPDATED: 'INVENTORY_TEMPLATE_ROW_UPDATED',
  INVENTORY_TEMPLATE_ROW_RELEASED: 'INVENTORY_TEMPLATE_ROW_RELEASED',
  // Toma de inventario (SPRINT-5-T05): inicio de la toma del local del
  // supervisor. El detalle registra la fecha de la toma; el local y el
  // responsable van en el evento. Guardar líneas no se audita: cada línea
  // registra quién la guardó y cuándo (saved_by_id y saved_at).
  INVENTORY_COUNT_STARTED: 'INVENTORY_COUNT_STARTED',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];
