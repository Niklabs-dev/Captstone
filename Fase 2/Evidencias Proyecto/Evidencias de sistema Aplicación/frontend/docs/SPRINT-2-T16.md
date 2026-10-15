# SPRINT-2-T16 — Gestión de liquidaciones para el contador

## Entrega independiente

Ruta `/liquidaciones`: el contador carga un PDF por trabajador activo y período,
consulta estados y confirma publicación individual. El administrador solo consulta.
Filtros por local, período y estado; metadatos con SHA-256 registrado, fechas y
archivo. No hay edición, eliminación, publicación masiva ni descarga en esta tarea.
La descarga del trabajador corresponde a T17.

Ficha 3f0dcd61-e2b1-8186-9f01-c0527576336d, Sprint 2, E2-H1, 5 horas.
Identidad visual heredada del Gestor Documental del mockup: logo, paleta crema y
salmón, tipografía, navegación lateral y documentos por trabajador/estado.
La tarea no incluye la carga masiva ilustrada en el mockup.

## Backend pendiente y seguridad

Depende de SPRINT-2-T12 (modelo), T13 (carga/consulta/trabajadores) y T14
(publicación, inmutabilidad y auditoría). El backend actual no expone esas rutas.
El BFF `/api/payroll` revalida la sesión mediante `/auth/me`: GET admite CONTADOR
y ADMINISTRADOR, POST solo CONTADOR y con origen confiable. Responde 503 hasta
conectar la API; no almacena archivos, no publica registros y no tiene simulación
en producción. Los tokens permanecen en cookies HttpOnly y no llegan a props.
SUPERVISOR y TRABAJADOR no acceden al gestor; el portal del trabajador es otra ruta.

El frontend no invoca `/users` desde el contador: ese endpoint actual es exclusivo
del administrador. La API de liquidaciones debe proporcionar un selector de
trabajadores autorizado y mínimo (id, nombre, local, activo) con T13.

La verificación actual de JWT hereda la limitación conocida del backend respecto
a desactivación/roles cambiados durante la vigencia del token. Esta entrega no
resuelve esa limitación ni afirma probar revocación real. La API final debe
revalidar cuenta/rol/local contra sus datos en cada operación y aplicar las reglas
transaccionales de duplicados e inmutabilidad.

## Contrato interno propuesto, pendiente de Swagger

- GET `/api/payroll`: items, workers y policy de carga.
- POST `/api/payroll`: multipart workerId, period (YYYY-MM) y file PDF.
  Devuelve liquidación PENDING_SIGNATURE y publishedAt=null.
- POST `/api/payroll/:id/publish`: revision opaca del registro consultado.
  Devuelve el mismo registro PUBLISHED, publishedAt informado y canPublish=false.

Payroll: id, worker {id,name,store:{id,name},isActive}, period, fileName, size,
sha256, createdAt, publishedAt, status, revision y canPublish. Solo se proyectan
estos campos; no RUT, importes, cuentas bancarias ni contenido documental.
workers es el selector de carga; los registros históricos conservan su local.
Policy: maxBytes, allowedMimes=[application/pdf] y canUpload. El límite adicional
de memoria cliente de 25 MiB, PDF y años 1900–2199 son restricciones provisionales
que se deben confirmar con el contrato real, no reglas legales del backend.
El contrato supone un listado completo: acordar paginación y alcance por rol/local.

La carga valida trabajador activo, período, duplicados del listado, extensión,
MIME, tamaño y cabecera PDF; calcula SHA-256 real antes del envío. Esto no valida
la estructura completa ni la seguridad del PDF: la API debe hacerlo. La respuesta
debe coincidir en trabajador/local, período, nombre/tamaño/hash y estado pendiente.
No se publica automáticamente después de subir.

La publicación abre un diálogo con trabajador, local, período, archivo y hash.
Exige confirmación explícita y bloquea doble envío/cierre durante el guardado.
Solo cambia el estado después de una respuesta vinculada al mismo contenido.
Ante 409, error o respuesta incoherente conserva el pendiente y permite cancelar,
actualizar y revisar. Una publicada no ofrece acciones de edición/eliminación.
La confirmación no implementa firma electrónica ni afirma que el documento esté
firmado; recoge la decisión del contador según el flujo definido por T14.

## Pruebas reproducibles

```powershell
npm ci
npm run test:payroll
npm run lint
npm run format:check
npm run build
docker build --target build -t capstone-s2-t16-build .
docker run -d --name capstone_s2_t16_preview -p 3112:3000 capstone-s2-t16-build sh -c 'node tests/payroll/backend.mjs & BACKEND_INTERNAL_URL=http://127.0.0.1:3147 npm run start -- --port 3000'
npm run test:payroll:e2e
```

Sin dependencias nuevas. TEST_PAYROLL_URL configura la URL del navegador.
La autenticación de pruebas escucha exclusivamente dentro del contenedor.
Playwright intercepta liquidaciones solo para las pruebas funcionales; las
peticiones HTTP de permisos usan el BFF real con la autenticación de prueba.
No hay base de datos, cuentas, documentos ni publicaciones reales en estas pruebas.
Capturas: output/playwright/payroll, ignoradas por git y Docker.

## Evidencia ejecutada — 14 de octubre de 2026

- 12 pruebas unitarias de liquidaciones y 18 de autenticación/navegación: pasan.
- 12 escenarios Playwright de escritorio/móvil: pasan. Cuatro escenarios afectados por el ajuste final de texto se repitieron y pasan.
- Build de producción Docker, lint y formato de frontend/backend: pasan.
- Capturas de escritorio/móvil revisadas; sin desbordamiento horizontal.
- Detector visual: sin hallazgos. Playwright CLI: login y panel con 503 esperado, sin simulación de liquidaciones.

Estado: frontend preparado para revisión; integración NestJS/PostgreSQL pendiente.
No marcar Hecho hasta conectar APIs, comprobar la DoD y recibir aprobación.
Notion sigue sin acceso al espacio compartido; seguimiento local.
## Actualización según DESIGN.md

- Rama actualizada con main, conservando el historial de la tarea.
- Vista y carga dentro de `(authenticated)`, con un solo menú, cabecera y panel de sesión.
- Navegación y título registrados en `src/lib/navigation.ts`, con permisos por rol.
- Controles y tipografía reutilizan `components/ui/styles.ts`; acciones primarias con texto ink sobre salmon.
- La integración con API real se valida por separado de las pruebas con servicios simulados.

Validación de esta actualización: lint, format:check y build aprobados; 60 pruebas unitarias/regresión y 14 escenarios Playwright aprobados en 1440×900 y 390×844. Captura móvil revisada. Gestión del contador y consulta del administrador verificadas con servicios simulados; integración real con T13/T14 pendiente.
