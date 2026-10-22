# SPRINT-2-T10 — Documentos por trabajador

El BFF conecta con GET /documents?workerId, POST /documents multipart, GET /documents/:id/versions y GET /documents/versions/:id/integrity|download. Contrato de T05/T06 en Swagger (/api/docs). El formulario envía documentTypeCode; no expone bearer ni rutas de almacenamiento al navegador.

Sesión del administrador activo, origen de POST, rutas y UUID se validan antes de llamar al backend. Los errores son públicos y las respuestas privadas sin caché. La descarga reenvía stream y cabeceras; el cliente verifica MIME, tamaño y SHA-256 y bloquea MISSING o archivos alterados.

retainUntil se interpreta como YYYY-MM-DD sin desplazar el día por UTC. Las versiones aceptan nombres de hasta 255 caracteres. La tabla, filtros, inputs y diálogos usan el diseño común; callbacks void e imports únicos sin alias.

## Validación

Lint, formato, build, unitarios, navegador aislado y NestJS/PostgreSQL reales. Evidencia al finalizar. Docker pendiente por Windows 19044 (el instalador requiere 19045 o superior). No se marca Hecho.

Evidencia 22-10-2026: lint, format:check y build aprobados; 13 pruebas documentales, 5 del proxy y regresiones existentes; 12 escenarios aislados y 2 contra NestJS/PostgreSQL 16 reales. Verificados creación, nueva versión, historial inmutable, SHA-256, descarga y conservación. Docker pendiente por Windows 19044.

## Seguimiento fuera del alcance: fecha de celebración

Crear una tarea independiente para solicitar y enviar issuedAt al cargar contratos, anexos y finiquitos. Si no se envía, el backend usa la fecha de carga como inicio del plazo de registro de 15 días de T11. Criterios propuestos: fecha de celebración explícita, validación alineada con Swagger y prueba de que la alerta usa issuedAt, incluso cuando difiere del día de carga. Esta propuesta queda pendiente de registrar en Notion; no modifica el contrato de T10.
