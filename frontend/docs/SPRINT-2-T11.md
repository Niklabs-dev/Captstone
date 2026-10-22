# SPRINT-2-T11 — Alertas de registro en la DT

El BFF conecta con GET /dt-alerts y POST /dt-alerts/:alertId/registration del backend NestJS. Contratos, anexos y finiquitos se identifican por documentType. Swagger: /api/docs.

El token se lee de cookies HttpOnly y permanece en el servidor. Se revalidan administrador activo, origen de POST y rutas/UUID permitidos. Los errores internos se sustituyen por mensajes públicos; los conflictos conservan HTTP 409 y las respuestas llevan private, no-store.

Las tarjetas siguen el mockup de alertas para priorizar documento, plazo y confirmación; el patrón queda definido en DESIGN.md. Vencidos con crit/crit-bg; próximos con warn/warn-bg y texto de estado. Los imports de estilos se consolidan sin alias.

## Validación

- npm run lint
- npm run format:check
- npm run build
- npm run test:dt-alerts
- npm run test:dt-alerts:e2e

La prueba contra backend real verifica listado, tipos, confirmación persistente y conflicto por revisión desactualizada. La evidencia ejecutada se registra al finalizar. Docker Desktop no puede instalarse en este equipo hasta actualizar Windows 10 de la compilación 19044 a 19045 o superior.

Evidencia 22-10-2026: lint, format:check y build aprobados; 11 pruebas del módulo y 4 del proxy; 12 escenarios de navegador aislados y 2 contra NestJS/PostgreSQL 16 reales. Migraciones y seed aplicados desde cero. Pendiente exclusivamente la ejecución mediante Docker tras actualizar Windows. No se marca Hecho.
