# SPRINT-2-T10 — Documentos por trabajador

El BFF conecta con GET /documents?workerId, POST /documents multipart, GET /documents/:id/versions y GET /documents/versions/:id/integrity|download. Contrato de T05/T06 en Swagger (/api/docs). El formulario envía documentTypeCode; no expone bearer ni rutas de almacenamiento al navegador.

Sesión del administrador activo, origen de POST, rutas y UUID se validan antes de llamar al backend. Los errores son públicos y las respuestas privadas sin caché. La descarga reenvía stream y cabeceras; el cliente verifica MIME, tamaño y SHA-256 y bloquea MISSING o archivos alterados.

retainUntil se interpreta como YYYY-MM-DD sin desplazar el día por UTC. Las versiones aceptan nombres de hasta 255 caracteres. La tabla, filtros, inputs y diálogos usan el diseño común; callbacks void e imports únicos sin alias.

## Validación

Evidencia del 22-10-2026: lint, format:check y compilación de producción aprobados; 15 pruebas unitarias del módulo, 7 del proxy y 1 de fechas aprobadas. También pasaron 12 escenarios de navegador aislados en escritorio y móvil.

Docker Compose ejecutado en un runner Linux efímero de GitHub Actions: build de backend y frontend, PostgreSQL 16, migraciones y seed reales, más 2 escenarios Playwright contra la API real (1440×900 y 390×844). Evidencia: https://github.com/Niklabs-dev/Captstone/actions/runs/39830829218

El workflow conserva logs, informe JUnit, capturas y trazas en sus artifacts durante 7 días. Usa datos sintéticos, base y almacenamiento exclusivos, y elimina sus recursos al finalizar. El override docker-compose.test.yml comparte el almacenamiento de pruebas para verificar MISSING sin alterar datos reales. Docker Desktop no se instaló en este PC; la validación se completó en GitHub. No se marca Hecho sin la revisión del usuario.

## Seguimiento fuera del alcance: fecha de celebración

Crear una tarea independiente para solicitar y enviar issuedAt al cargar contratos, anexos y finiquitos. Si no se envía, el backend usa la fecha de carga como inicio del plazo de registro de 15 días de T11. Criterios propuestos: fecha de celebración explícita, validación alineada con Swagger y prueba de que la alerta usa issuedAt, incluso cuando difiere del día de carga. Esta propuesta queda pendiente de registrar en Notion; no modifica el contrato de T10.
