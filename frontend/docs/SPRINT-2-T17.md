# SPRINT-2-T17 — Mis liquidaciones

BFF conectado a GET /payroll/mine y GET /payroll/mine/:id/integrity|download, documentados en Swagger (/api/docs). Trabajadores y supervisores consultan únicamente las liquidaciones publicadas de su propia sesión. No se admiten parámetros de trabajador.

El stream de descarga conserva Content-Type, Content-Length, X-Document-Integrity y Cache-Control privado. El cliente comprueba estado de integridad, tamaño, MIME, cabecera PDF y SHA-256 antes de guardar. MISSING con actualHash=null muestra «El archivo no está disponible; informa al administrador».

Se muestra signedAt; se aceptan nombres de hasta 255 caracteres sin exigir extensión .pdf a metadatos validados por contenido en el servidor. Un registro con metadatos inválidos se omite con advertencia; una respuesta mezclada con otro trabajador o con pendientes se rechaza completa. Tarjetas del portal justificadas en DESIGN.md.

## Validación

Lint, formato, build, unitarios, navegador aislado y NestJS/PostgreSQL reales. Evidencia al finalizar. Docker pendiente por Windows 19044: el instalador requiere 19045 o superior. No se marca Hecho.

Evidencia 22-10-2026: lint, format:check y build aprobados; 14 unitarios del módulo y 9 de navegación; 14 escenarios aislados y 2 con NestJS/PostgreSQL reales. Verificados aislamiento, pendientes ocultas, supervisor, stream con cabeceras y archivo ausente real restaurado al terminar. Docker pendiente por Windows 19044.
