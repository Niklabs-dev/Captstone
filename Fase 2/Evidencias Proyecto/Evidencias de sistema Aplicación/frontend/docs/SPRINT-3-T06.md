# SPRINT-3-T06 — Mis documentos

`/portal/documentos` permite a trabajadores y supervisores consultar sus contratos, anexos, pactos y finiquitos. Reutiliza `DocumentWorkspace`, los parsers y la verificación SHA-256 del gestor; el modo personal elimina las acciones de carga y nueva versión. No ofrece eliminación ni permite elegir otro trabajador.

Incluye filtro por tipo, versión vigente, historial completo, actualización, verificación y descarga. La descarga verifica primero el hash del servicio y vuelve a calcular SHA-256 de los bytes recibidos; si difieren, se bloquea. Un archivo ausente indica «El archivo no está disponible; informa al administrador». Se conserva el nombre de descarga definido por backend mediante `Content-Disposition`.

## API y aislamiento

El BFF `GET /api/my-documents/[[...path]]` usa la cookie de sesión y el bearer exclusivamente desde servidor. Solo admite trabajador y supervisor; no exporta mutaciones.

| BFF | API real de SPRINT-2-T06 |
| --- | --- |
| `/api/my-documents` | `GET /documents` sin workerId: backend deriva el propietario del JWT |
| `/:id/versions` | `GET /documents/:id/versions` |
| `/versions/:versionId/integrity` | `GET /documents/versions/:versionId/integrity` |
| `/versions/:versionId/download` | `GET /documents/versions/:versionId/download` |

Contrato documentado en Swagger `/api/docs`. Se rechazan todos los parámetros de consulta, incluido `workerId`. Backend valida propiedad en cada operación. El BFF también valida propietario y proyecta listado e historial sin campos internos; rechaza listados mezclados, permisos de carga y tipos ajenos al catálogo laboral, incluido LIQUIDACION. Las respuestas no usan caché y la descarga conserva stream, tipo, tamaño, nombre e integridad.

Mis liquidaciones conserva su BFF y su flujo de publicaciones; las pendientes de firma nunca aparecen en Mis documentos. Inicio del trabajador, inicio del supervisor y navegación enlazan ambas secciones. No se modifican permisos del gestor administrativo ni del módulo de liquidaciones.

## Pruebas

- `npm run test:my-documents`: roles, rutas sin identidad editable, proyección, propietarios, historial, SHA-256, nombre de descarga, MISSING y ALTERED; incluye regresión documental y navegación.
- Integración HTTP: `node --test .test-build/my-documents-http.integration.test.js` después de build y compilación con `tsconfig.test.json`. Verifica sesión, rol, parámetros prohibidos, métodos de mutación, carpetas ajenas, tipos de liquidación, stream y mensajes seguros.
- `npm run test:my-documents:real`: Docker, PostgreSQL, migraciones, seed y almacenamiento exclusivos con `TEST_REAL_DISPOSABLE=true`. Ocho escenarios: trabajador y supervisor a 360, 390, 768 y 1440 px.
- Recorrido real: carpeta vacía, cuatro tipos, nueva versión cargada por administrador, filtro, historial, SHA-256, nombre del backend, dos cuentas aisladas, consultas ajenas denegadas y liquidación pendiente real excluida incluso por sus IDs de documento y versión. Alteración y ausencia temporal del archivo sintético, con restauración en `finally`.
- Workflow `.github/workflows/sprint-3-t06-docker.yml`: ejecuta además las regresiones reales de Sprint 2 y locales, y conserva JUnit, capturas y logs. Los controles siguen DESIGN.md; las tablas desplazan solo su contenedor.

Revisión y merge a cargo del equipo. Registrar PR, todos los commits y evidencia en Notion antes del cierre; no marcar Hecho sin revisión confirmada.
