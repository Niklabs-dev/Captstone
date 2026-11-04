# SPRINT-4-T02 — Constancias personales de propinas

La aclaración del PO posterior a PR 57 limita «Mis propinas» a
`TRABAJADOR` y `SUPERVISOR`. La navegación compartida aplica esta regla al
lateral, la barra móvil, «Más» y los accesos del inicio. La página
`/portal/propinas` comprueba el rol en servidor y redirige al resto al inicio
con el mensaje de acceso denegado.

`GET /api/my-tip-receipts` y su descarga verifican el rol antes de consultar
al backend. El controlador y el servicio de `/my-tip-receipts` también
deniegan con 403 a `ADMINISTRADOR` y `CONTADOR`, incluso si tienen constancias
históricas propias. La gestión `/tip-pools/:id/receipts` mantiene el acceso
de ambos roles al listado y a la descarga de otras personas.

La identidad procede de la sesión JWT. Listado y descarga conservan los
filtros conjuntos por propietario y reparto `PAID`; una constancia ajena,
inexistente o no pagada responde 404 para los roles personales autorizados.
El historial de local, el PDF determinista y su verificación SHA-256 se
mantienen. Se reutilizan los estados de carga, vacío, error y reintento de
la vista existente.

## Verificación

- Unitarias de permisos personales, navegación móvil/escritorio y servicio;
  los roles denegados no llegan a consultar Prisma ni a generar el PDF.
- Swagger documenta los roles permitidos y el 403 de ambas rutas personales.
- `backend/test/my-tip-receipts.integration.spec.ts` ejecuta HTTP con NestJS
  y PostgreSQL reales usando `TEST_DATABASE_URL`. Cada escenario revierte
  su transacción y comprueba propietario, `PAID`, roles, historial, gestión
  y auditoría. La suite sin esa variable no acredita integración real.
- `npm run test:my-tip-receipts:real -- --headed` verifica los cuatro roles
  en 1440, 768, 390 y 360 px, con API y PostgreSQL reales. Incluye navegación,
  acceso directo por URL, API de Next.js, backend, descarga, gestión y estados
  de error. Requiere `TEST_REAL_DISPOSABLE=true`, URLs exclusivas de pruebas
  y `COMPOSE_PROJECT_NAME` del PostgreSQL sintético.
- El workflow `sprint-4-diseno-movil.yml` repite calidad de ambos proyectos,
  integración HTTP y las nueve suites de navegador con evidencias adjuntas.

La entrega se registra como **En revisión**, con commit y comentario en la
tarjeta SPRINT-4-T02. El paso a Hecho requiere la confirmación de revisión.
