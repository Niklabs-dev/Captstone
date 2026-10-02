import { SetMetadata } from '@nestjs/common';
import type { AuditedOptions } from '../types/audit.types.js';

export const AUDITED_KEY = 'audit:audited';

// Declara que el endpoint es una operación crítica: el AuditInterceptor
// global la registrará automáticamente en audit_logs (SPRINT-1-T13).
export const Audited = (options: AuditedOptions) =>
  SetMetadata(AUDITED_KEY, options);
