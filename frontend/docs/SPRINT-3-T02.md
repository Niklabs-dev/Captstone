# SPRINT-3-T02 — Locales y catálogo dinámico

Vista `/admin/locales` para administradores activos, con creación, edición, desactivación y reactivación lógica. Tabla, filtros, estados, diálogos nativos y controles compartidos según DESIGN.md. No elimina locales ni su historial.

## Integración

El BFF `/api/stores` utiliza la cookie de sesión solo en servidor. GET requiere sesión; POST y PATCH requieren administrador activo y validación de origen. Valida UUID, rutas, filtros y datos; descarta campos extra y no expone mensajes internos. Contratos de SPRINT-3-T01 documentados en Swagger `/api/docs`:

- GET `/stores` y filtro opcional `isActive=true|false`.
- POST `/stores`: `name`, `city`, `address`.
- PATCH `/stores/:id`: los campos editables, enviados completos por el formulario.
- PATCH `/stores/:id/deactivate` y `/stores/:id/reactivate`.

Usuarios y Auditoría dejan de leer USER_MANAGEMENT_STORES y AUDIT_STORES. Se eliminan esas variables del compose y ejemplos. Alertas DT y Liquidaciones también usan el catálogo de la API; los metadatos de documentos y sus trabajadores ya provienen de la API documental/usuarios. No existen aún vistas de propinas en main: consumirán `/api/stores` cuando se implementen sus tareas propias.

La creación/edición invalida las vistas relacionadas. Los selectores se revalidan al entrar, volver a la pestaña y recibir cambios de locales. La apertura del alta de usuario consulta el catálogo vigente: solo locales activos para asignar; los inactivos permanecen identificados en filtros históricos. Los fallos del catálogo se muestran y no habilitan asignaciones usando configuración obsoleta.

## Verificación

- `npm run test:stores`: contrato, validación, normalización, locales inactivos, adaptadores, privacidad de errores y navegación.
- `npm run lint`, `npm run format:check`, `npm run build` y regresiones unitarias de los módulos existentes.
- `npx playwright test --config playwright.stores.config.ts` con TEST_REAL_DISPOSABLE=true: API y PostgreSQL reales, CRUD persistente, duplicados, catálogos, conservación de usuarios asignados, RBAC, origen, filtros y rutas. Viewports 360, 390, 768 y 1440 px.
- Workflow `.github/workflows/sprint-3-t02-docker.yml`: construye el compose real con migraciones/seed, prepara datos sintéticos exclusivos, ejecuta las regresiones anteriores del Sprint 2 y las pruebas de locales. Conserva logs, JUnit, capturas y trazas por 7 días y elimina sus recursos efímeros al finalizar.

La validación Docker se ejecuta en GitHub Actions por las limitaciones del equipo local. El estado de la ejecución y el PR determinan la evidencia final; este documento no declara aprobadas pruebas pendientes. No se marca Hecho sin revisión del usuario. Notion no está conectado: registrar allí estado, responsable, PR y todos los commits cuando se disponga de acceso.
