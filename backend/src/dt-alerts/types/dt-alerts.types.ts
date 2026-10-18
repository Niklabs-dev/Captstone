// Tipos de las alertas de registro en la Dirección del Trabajo (SPRINT-2-T08).
// Siguen el contrato que consume el panel del frontend (SPRINT-2-T11,
// frontend/src/lib/dt-alerts.ts).

// UPCOMING: el plazo de 15 días aún no vence (incluye el día del
// vencimiento); OVERDUE: venció sin registrarse.
export const DT_ALERT_STATUSES = ['UPCOMING', 'OVERDUE'] as const;
export type DtAlertStatus = (typeof DT_ALERT_STATUSES)[number];

export interface DtAlertWorker {
  id: string;
  // Nombre y apellido.
  name: string;
}

export interface DtAlertStore {
  id: string;
  name: string;
}

// Documento laboral pendiente de registrar en la DT. La alerta no se guarda:
// se deriva del documento, por eso id y documentId coinciden.
export interface DtAlert {
  id: string;
  documentId: string;
  // Tipo del documento (CONTRATO, ANEXO o FINIQUITO).
  documentType: string;
  contractTitle: string;
  worker: DtAlertWorker;
  store: DtAlertStore;
  // Último día del plazo, YYYY-MM-DD.
  deadline: string;
  // Días corridos hasta el vencimiento en hora de Chile; negativo si venció.
  daysRemaining: number;
  status: DtAlertStatus;
  // Identificador opaco de la versión del documento: el registro solo se
  // acepta si no cambió desde que se consultó la alerta.
  revision: string;
  canRegister: boolean;
}

export interface DtAlertCollection {
  items: DtAlert[];
  // Instante en que se calcularon los días restantes.
  calculatedAt: Date;
}

// Confirmación de que el documento quedó marcado como registrado en la DT.
export interface DtRegistrationResponse {
  alertId: string;
  documentId: string;
  // Local del documento.
  storeId: string;
  status: 'REGISTERED';
  registeredAt: Date;
}
