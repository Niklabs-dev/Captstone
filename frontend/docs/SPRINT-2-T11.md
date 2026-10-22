# SPRINT-2-T11 — Alertas de registro en la DT

El BFF conecta con GET /dt-alerts y POST /dt-alerts/:alertId/registration del backend NestJS. Contratos, anexos y finiquitos se identifican por documentType. Swagger: /api/docs.

El token se lee de cookies HttpOnly y permanece en el servidor. Se revalidan administrador activo, origen de POST y rutas/UUID permitidos. Los errores internos se sustituyen por mensajes públicos; los conflictos conservan HTTP 409 y las respuestas llevan private, no-store.

Las tarjetas siguen el mockup de alertas para priorizar documento, plazo y confirmación; el patrón queda definido en DESIGN.md. Vencidos con crit/crit-bg; próximos con warn/warn-bg y texto de estado. Los imports de estilos se consolidan sin alias.

## Validación

Evidencia del 22-10-2026: lint, format:check y compilación de producción aprobados; 12 pruebas unitarias del módulo, 7 del proxy y 1 de fechas aprobadas. También pasaron 12 escenarios de navegador aislados en escritorio y móvil.

Docker Compose ejecutado en un runner Linux efímero de GitHub Actions: build de backend y frontend, PostgreSQL 16, migraciones y seed reales, más 2 escenarios Playwright contra la API real (1440×900 y 390×844). Evidencia: https://github.com/Niklabs-dev/Captstone/actions/runs/39830847740

El workflow conserva logs, informe JUnit, capturas y trazas en sus artifacts durante 7 días. Usa datos sintéticos, base y almacenamiento exclusivos, y elimina sus recursos al finalizar. El override docker-compose.test.yml comparte el almacenamiento de pruebas para verificar MISSING sin alterar datos reales. Docker Desktop no se instaló en este PC; la validación se completó en GitHub. No se marca Hecho sin la revisión del usuario.
