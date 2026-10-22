# SPRINT-2-T16 — Liquidaciones del contador

BFF conectado a GET /payroll, POST /payroll (multipart workerId, period, file) y POST /payroll/:id/publish (revision y signedAt). Swagger: /api/docs. El contador carga y publica; el administrador solo consulta.

Fecha de firma obligatoria en la interfaz, entre el día de carga y hoy en Chile; se conserva y muestra el valor devuelto por la API. El listado admite nombres de hasta 255 caracteres y omite registros malformados con una advertencia sin bloquear los válidos. Las respuestas de carga se vinculan por trabajador, período, hash y tamaño; el nombre saneado por el servidor no provoca una falsa carga fallida.

Tabla administrativa según DESIGN.md, con caption, encabezados scope=col, estilos compartidos, contenedor de scroll accesible y metadatos. Imports únicos sin alias y callbacks void.

## Validación

Evidencia del 22-10-2026: lint, format:check y compilación de producción aprobados; 16 pruebas unitarias del módulo, 7 del proxy y 1 de fechas aprobadas. También pasaron 14 escenarios de navegador aislados en escritorio y móvil.

Docker Compose ejecutado en un runner Linux efímero de GitHub Actions: build de backend y frontend, PostgreSQL 16, migraciones y seed reales, más 2 escenarios Playwright contra la API real (1440×900 y 390×844). Evidencia: https://github.com/Niklabs-dev/Captstone/actions/runs/39830865186

El workflow conserva logs, informe JUnit, capturas y trazas en sus artifacts durante 7 días. Usa datos sintéticos, base y almacenamiento exclusivos, y elimina sus recursos al finalizar. El override docker-compose.test.yml comparte el almacenamiento de pruebas para verificar MISSING sin alterar datos reales. Docker Desktop no se instaló en este PC; la validación se completó en GitHub. No se marca Hecho sin la revisión del usuario.
