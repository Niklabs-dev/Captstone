// Tipos del catálogo administrable de medios de pago (SPRINT-4-T32).
// El código es el identificador estable de los contratos operativos; el
// nombre se muestra en las interfaces y puede administrarse sin reescribir
// montos ni vínculos históricos.

// Comportamiento del medio ante el cierre de caja y la conciliación: el
// efectivo recibe el fondo de caja, las tarjetas conciliables alimentan la
// conciliación de vouchers y los externos quedan fuera de ella.
export const PAYMENT_METHOD_BEHAVIORS = [
  'CASH',
  'RECONCILABLE_CARD',
  'EXTERNAL_OTHER',
] as const;

export type PaymentMethodBehavior = (typeof PAYMENT_METHOD_BEHAVIORS)[number];

export interface PaymentMethodResponse {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  behavior: PaymentMethodBehavior;
  availableForTips: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentMethodStateChange {
  paymentMethod: PaymentMethodResponse;
  changed: boolean;
}
