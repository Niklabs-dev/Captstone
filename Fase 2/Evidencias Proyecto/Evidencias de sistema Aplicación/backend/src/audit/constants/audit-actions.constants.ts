// Acciones de auditoría que registra el AuditInterceptor (SPRINT-1-T13).
// Convención: UPPER_SNAKE en pasado, igual que las acciones usadas en los
// tests del schema (DOCUMENT_UPLOADED, TIP_POOL_RECALCULATED).
export const AUDIT_ACTION = {
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  USER_CREATED: 'USER_CREATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];
