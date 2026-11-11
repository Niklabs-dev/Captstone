// Alertas de propinas diarias No pagadas fuera del plazo legal de pago
// (SPRINT-4A-T22, GET /tip-payment-alerts). Una alerta agrupa las propinas
// vencidas de un trabajador en un local. Fechas YYYY-MM-DD en hora de Chile y
// montos en CLP entero; las personas solo con id y nombre.

export interface TipPaymentAlertRef {
  id: string;
  name: string;
}

export interface TipPaymentAlert {
  store: TipPaymentAlertRef;
  worker: TipPaymentAlertRef;
  // Propinas diarias No pagadas y vencidas (una por día trabajado).
  allocationCount: number;
  amount: number;
  oldestBusinessDate: string;
  newestBusinessDate: string;
  // Fecha límite de la propina más antigua.
  deadline: string;
  // Días corridos desde esa fecha límite hasta hoy (al menos 1).
  daysOverdue: number;
}

// Resumen de un conjunto de alertas: el total de la respuesta y, en el panel
// de ventas, el de cada local. Sin alertas, las fechas son null y el resto 0.
export interface TipPaymentAlertSummary {
  alertCount: number;
  allocationCount: number;
  amount: number;
  oldestBusinessDate: string | null;
  newestBusinessDate: string | null;
  maxDaysOverdue: number;
}

export interface TipPaymentAlertCollection {
  // Días hábiles de plazo vigentes (TIP_LEGAL_PAYMENT_DAYS).
  legalPaymentDays: number;
  // Día de negocio actual en Chile al que corresponde el cálculo.
  asOf: string;
  // Última fecha de negocio cuyas propinas No pagadas ya están vencidas.
  overdueThrough: string;
  items: TipPaymentAlert[];
  totals: TipPaymentAlertSummary;
  calculatedAt: Date;
}
