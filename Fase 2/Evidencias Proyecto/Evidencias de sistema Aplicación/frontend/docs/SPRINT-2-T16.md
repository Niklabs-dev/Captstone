# SPRINT-2-T16 — Liquidaciones del contador

BFF conectado a GET /payroll, POST /payroll (multipart workerId, period, file) y POST /payroll/:id/publish (revision y signedAt). Swagger: /api/docs. El contador carga y publica; el administrador solo consulta.

Fecha de firma obligatoria en la interfaz, entre el día de carga y hoy en Chile; se conserva y muestra el valor devuelto por la API. El listado admite nombres de hasta 255 caracteres y omite registros malformados con una advertencia sin bloquear los válidos. Las respuestas de carga se vinculan por trabajador, período, hash y tamaño; el nombre saneado por el servidor no provoca una falsa carga fallida.

Tabla administrativa según DESIGN.md, con caption, encabezados scope=col, estilos compartidos, contenedor de scroll accesible y metadatos. Imports únicos sin alias y callbacks void.

## Validación

Lint, format:check, build, pruebas unitarias, Playwright aislado y contra NestJS/PostgreSQL reales. La evidencia ejecutada se registra al finalizar. Docker pendiente: el instalador oficial requiere Windows 19045 o superior; este PC tiene 19044. No se marca Hecho.

Evidencia 22-10-2026: lint, format:check, build y 14 pruebas unitarias aprobados; 14 escenarios de navegador aislados y 2 contra NestJS/PostgreSQL reales. Carga con tildes, fecha de firma, publicación persistente y administrador solo consulta comprobados. Docker pendiente por incompatibilidad de Windows.
