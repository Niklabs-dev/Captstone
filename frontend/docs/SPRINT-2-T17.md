# SPRINT-2-T17 — Mis liquidaciones

BFF conectado a GET /payroll/mine y GET /payroll/mine/:id/integrity|download, documentados en Swagger (/api/docs). Trabajadores y supervisores consultan únicamente las liquidaciones publicadas de su propia sesión. No se admiten parámetros de trabajador.

El stream de descarga conserva Content-Type, Content-Length, X-Document-Integrity y Cache-Control privado. El cliente comprueba estado de integridad, tamaño, MIME, cabecera PDF y SHA-256 antes de guardar. MISSING con actualHash=null muestra «El archivo no está disponible; informa al administrador».

Se muestra signedAt; se aceptan nombres de hasta 255 caracteres sin exigir extensión .pdf a metadatos validados por contenido en el servidor. Un registro con metadatos inválidos se omite con advertencia; una respuesta mezclada con otro trabajador o con pendientes se rechaza completa. Tarjetas del portal justificadas en DESIGN.md.

## Validación

Evidencia del 22-10-2026: lint, format:check y compilación de producción aprobados; 14 pruebas unitarias del módulo, 7 del proxy y 1 de fechas aprobadas. También pasaron 14 escenarios de navegador aislados en escritorio y móvil.

Docker Compose ejecutado en un runner Linux efímero de GitHub Actions: build de backend y frontend, PostgreSQL 16, migraciones y seed reales, más 2 escenarios Playwright contra la API real (1440×900 y 390×844). Evidencia: https://github.com/Niklabs-dev/Captstone/actions/runs/39830748323

El workflow conserva logs, informe JUnit, capturas y trazas en sus artifacts durante 7 días. Usa datos sintéticos, base y almacenamiento exclusivos, y elimina sus recursos al finalizar. El override docker-compose.test.yml comparte el almacenamiento de pruebas para verificar MISSING sin alterar datos reales. Docker Desktop no se instaló en este PC; la validación se completó en GitHub. No se marca Hecho sin la revisión del usuario.
