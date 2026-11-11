// Controladores cuyas rutas son exclusivas del ADMINISTRADOR (SPRINT-4R-T15):
// panel consolidado, importación de ventas (SPRINT-4R-T10), calendario de
// operación y estado diario de ventas (SPRINT-4R-T12) y alias de medios de
// pago (SPRINT-4A-T20). Una ruta nueva
// de este tipo se agrega aquí con la ruta base de su controlador;
// test/admin-only-routes verifica que todos sus endpoints declaren
// @Roles(ADMINISTRADOR) y ningún otro rol, para que ocultar un botón en el
// frontend nunca sea la única defensa.
export const ADMIN_ONLY_CONTROLLER_PATHS: readonly string[] = [
  'sales-dashboard',
  'sales-imports',
  'sales-days',
  'payment-method-aliases',
  'stores/:storeId',
];

// Controladores de solo lectura que comparten ADMINISTRADOR y CONTADOR
// (SPRINT-4A-T23): los reportes de ventas (SPRINT-4R-T13), con los que el
// contador contrasta el voucher y la diferencia de efectivo con las ventas
// por medio de pago. test/admin-only-routes verifica que solo expongan GET y
// exijan exactamente esos dos roles: nunca SUPERVISOR ni TRABAJADOR.
export const ADMIN_AND_ACCOUNTANT_READ_CONTROLLER_PATHS: readonly string[] = [
  'sales-reports',
];
