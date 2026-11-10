// Alias de los medios de pago en los informes externos (SPRINT-4A-T20): la
// etiqueta del informe de MrComanda («T. DEBITO», «N.de Créd.») que resuelve
// un medio del catálogo al importar ventas.

export interface PaymentMethodAliasMethodRef {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface PaymentMethodAliasResponse {
  id: string;
  system: 'MRCOMANDA';
  label: string;
  normalizedLabel: string;
  paymentMethod: PaymentMethodAliasMethodRef;
  createdAt: Date;
}
