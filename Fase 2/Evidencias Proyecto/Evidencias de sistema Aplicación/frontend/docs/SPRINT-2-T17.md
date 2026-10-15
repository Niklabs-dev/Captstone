# SPRINT-2-T17 — Mis liquidaciones del trabajador

## Entrega independiente

Ruta `/portal/liquidaciones`, enlazada desde el portal. Solo TRABAJADOR puede
consultarla. Lista sus liquidaciones publicadas por período, con descarga PDF,
fecha de publicación y SHA-256 registrado. No permite cargar, publicar, editar
ni eliminar; la gestión del contador corresponde a T16.

Ficha 3f0dcd61-e2b1-8180-89bd-ce05ecd0190b, E2-H1, 4 horas.
Mantiene el logo, paleta, fuentes, navegación e identidad visual del portal y
del mockup. No modifica el borrador del usuario en la rama vistas-frontend.
La rama parte de main 89877cd y no incorpora otros PR de frontend pendientes.

## Integración pendiente

Depende de SPRINT-2-T15: listado/descarga propios, solo publicados, verificación
de integridad en servidor y propietario derivado del JWT. También depende del
modelo/publicación de T12/T14 y del almacenamiento T04. PR #23 aporta el servicio
de almacenamiento; no contiene todavía los endpoints de T15.

`/api/my-payroll` es un BFF reservado: verifica sesión y rol, rechaza parámetros
de trabajador y responde 503 hasta conectar la API. No hay datos ni simulación
en producción. Ante 401 de la verificación borra ambas cookies; los otros roles
reciben 403. Solo exporta GET; no admite mutaciones. La página verifica también
el rol y usa el identificador de la sesión para validar la respuesta, sin enviar
workerId en la consulta. No se serializan tokens ni se leen cookies desde JS.

El backend actual hereda la limitación conocida de JWT vigente tras desactivación
o cambio de rol. Esta entrega no resuelve la revocación global ni afirma haberla
probado. T15 debe verificar cuenta/rol y propiedad/estado de cada liquidación,
también en integridad y descarga, sin aceptar trabajador desde un parámetro.
La validación cliente es una defensa adicional; no sustituye el aislamiento del
backend ni la DoD de integración HTTP contra PostgreSQL.

## Contrato interno propuesto, pendiente de Swagger

- GET `/api/my-payroll`: `{ items: OwnPayslip[] }`, listado completo.
- GET `/api/my-payroll/:id/integrity`: payslipId, versionId, workerId, valid,
  expectedHash, actualHash y checkedAt (ISO con zona).
- GET `/api/my-payroll/:id/download`: binario application/pdf.
- OwnPayslip: id, versionId, workerId, period YYYY-MM, status PUBLISHED,
  fileName, mime application/pdf, size, sha256 y publishedAt.

Confirmar con T15 las rutas y campos reales, paginación, versiones inmutables,
MIME/límites, cabeceras, códigos de error y auditoría. El cap cliente de 25 MiB,
PDF y períodos 1900–2199 son provisionales y no definen reglas legales.
El listado se rechaza completo si contiene pendientes, otro propietario,
duplicados por registro/versión/período o metadatos inválidos; no se muestran
parcialmente los datos de una respuesta mezclada. Solo se proyectan metadatos
mínimos, sin cuentas bancarias, importes ni contenido arbitrario del servidor.

Antes de guardar se comprueba la integridad informada, vinculada al registro,
versión, propietario y hash esperados. Después se limita el stream al tamaño
registrado y se recalcula SHA-256 sobre los bytes recibidos. Si no coincide,
se bloquea la descarga y se informa que el archivo pudo ser alterado. Se valida
además MIME, tamaño y cabecera PDF; esto no equivale a analizar todo el PDF.
Los nombres de descarga se limpian y no se siguen redirecciones externas.
La verificación exitosa solo se anuncia después de comprobar el binario.

Un error de servicio no se presenta como cero liquidaciones. Hay reintento,
estado vacío real, filtros por período y descarga única mientras se verifica.
Las consultas se cancelan al salir y el panel se reinicia al cambiar de cuenta.

## Pruebas reproducibles

```powershell
npm ci
npm run test:my-payslips
npm run lint
npm run format:check
npm run build
docker build --target build -t capstone-s2-t17-build .
docker run -d --name capstone_s2_t17_preview -p 3113:3000 capstone-s2-t17-build sh -c 'node tests/my-payslips/backend.mjs & BACKEND_INTERNAL_URL=http://127.0.0.1:3148 npm run start -- --port 3000'
npm run test:my-payslips:e2e
```

Sin dependencias nuevas. TEST_MY_PAYSLIPS_URL configura la URL del navegador.
La autenticación de pruebas escucha solo dentro del contenedor. Playwright
intercepta liquidaciones únicamente en las pruebas funcionales; otro escenario
comprueba el BFF sin interceptarlas. No usa BD, cuentas ni documentos reales.
Capturas en output/playwright/my-payslips, ignoradas por git/Docker.

## Evidencia ejecutada — 15 de octubre de 2026

- 12 pruebas unitarias nuevas y 18 de autenticación/navegación: pasan.
- 12 escenarios Playwright escritorio/móvil: pasan. Tras ajustar la presentación de archivos pequeños, se repitieron y pasaron los dos escenarios afectados.
- Build de producción Docker, lint y formato de frontend/backend: pasan.
- Capturas revisadas en escritorio/móvil, sin desbordamiento horizontal; detector visual sin hallazgos.
- Playwright CLI: login de trabajador y panel con 503 esperado sin respuestas de liquidaciones interceptadas.

Estado: frontend preparado para revisión; integración NestJS/PostgreSQL pendiente.
No marcar Hecho hasta conectar T15, comprobar la DoD y recibir aprobación.
Notion sigue sin acceso al espacio compartido; seguimiento local.