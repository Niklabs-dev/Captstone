// Controladores cuyas rutas son exclusivas del ADMINISTRADOR (SPRINT-4R-T15):
// panel consolidado, y luego importación de ventas (SPRINT-4R-T10),
// calendario de operación (SPRINT-4R-T12) y reportes (SPRINT-4R-T13). Cada
// tarea agrega aquí la ruta base de su controlador; test/admin-only-routes
// verifica que todos sus endpoints declaren @Roles(ADMINISTRADOR) y ningún
// otro rol, para que ocultar un botón en el frontend nunca sea la única
// defensa.
export const ADMIN_ONLY_CONTROLLER_PATHS: readonly string[] = [
  'sales-dashboard',
];
