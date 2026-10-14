# SPRINT-2-T10 — Documentos por trabajador

## Entrega independiente del frontend

Pantalla `/admin/documentos` para administradores: selección de trabajador/local,
filtros por tipo, carga y nuevas versiones, historial con SHA-256, descarga e
integridad. Sigue la sección Gestor Documental del mockup del proyecto.
El selector usa usuarios reales del backend existente; incluye trabajadores y
supervisores activos e inactivos. Los tokens permanecen en cookies HttpOnly.

## Límite de integración

El contrato en `src/lib/documents.ts` es una propuesta interna del frontend,
no Swagger aprobado. `documents-client.ts` concentra las operaciones contra
el BFF `/api/documents`. Este BFF revalida al administrador y el origen de POST,
y devuelve 503 hasta conectar la API real; no almacena archivos ni fabrica datos.
La simulación vive exclusivamente en pruebas Playwright, mediante interceptación
HTTP. `tests/documents/backend.mjs` simula autenticación y usuarios para pruebas.
No existe un interruptor de simulación en producción.

Dependencias pendientes: SPRINT-2-T04 (almacenamiento/hash/validaciones), T05
(carga/versionado), T06 (consulta/descarga/integridad/permisos), T07 (conservación)
y T09 (auditoría). Confirmar Swagger, límites, tipos, errores y permisos antes
de reemplazar el BFF provisional y ejecutar integración con NestJS/PostgreSQL.
No se da por terminada la T10 ni se afirma que la API documental esté operativa.

## Contrato interno propuesto

- GET `/api/documents?workerId=UUID`: items y policy de carga.
- POST `/api/documents`: multipart workerId, title, type, file y documentId
  opcional para una nueva versión. Devuelve el documento actualizado.
- GET `/api/documents/:id/versions`: documentId, workerId y versiones.
- GET `/api/documents/versions/:id/integrity`: versionId, valid,
  expectedHash, actualHash y checkedAt.
- GET `/api/documents/versions/:id/download`: binario con MIME y tamaño coherentes.

Tipos provisionales: CONTRATO, ANEXO, PACTO y FINIQUITO. La política responde
maxBytes, allowedMimes y canUpload; el cliente impone además un tope de memoria
provisional de 25 MiB. Este tope no define la política legal ni del backend.
Los formatos permitidos son un subconjunto explícito de PDF, PNG y JPEG.
El servidor debe validar contenido, autorización, almacenamiento y concurrencia.
La retención proviene exclusivamente de deletionBlocked, deletionBlockReason y
retainUntil; el frontend no calcula años legales ni ofrece eliminación.

Cada respuesta se valida en ejecución y se vincula al trabajador/documento/versión.
No se acepta un hash de otra versión. Antes de guardar una descarga se verifica
la integridad informada, se limita el tamaño del stream y se calcula nuevamente
SHA-256 sobre los bytes recibidos. Esto no sustituye la validación del servidor.

## Pruebas reproducibles

`npm ci`, `npm run test:documents`, `npm run lint`, `npm run format:check` y
`npm run build`. No hay dependencias nuevas.

Para navegador aislado, desde frontend:

```powershell
docker build --target build -t capstone-s2-t10-build .
docker run -d --name capstone_s2_t10_preview -p 3110:3000 capstone-s2-t10-build sh -c 'node tests/documents/backend.mjs & BACKEND_INTERNAL_URL=http://127.0.0.1:3145 npm run start -- --port 3000'
npm run test:documents:e2e
```

El puerto 3145 solo escucha dentro del contenedor. No se usa la base de datos
real ni cuentas reales. TEST_DOCUMENTS_URL permite cambiar la URL del navegador.
Los escenarios cubren escritorio/móvil, carga inválida/válida, nuevas versiones,
historial, filtros, integridad alterada, permiso de carga, recuperación de errores,
selección concurrente y guardas HTTP de sesión/rol/origen sin interceptación documental.
Las capturas quedan en output/playwright/documents (fuera de git).

## Evidencia ejecutada (14 de octubre de 2026)

- 11 pruebas unitarias documentales y 18 de regresión de autenticación/navegación: pasan.
- 10 escenarios Playwright (cinco por escritorio/móvil): pasan.
- Compilación de producción en Docker: pasa.
- Lint y formato de frontend y backend: pasan. Backend sin cambios funcionales.
- Revisión de capturas de escritorio/móvil y detector visual: sin hallazgos automáticos.
- Playwright CLI: login y apertura del gestor con el servicio documental no disponible.

Estado: frontend preparado para revisión; integración real pendiente. Seguimiento local
porque la conexión de Notion no accede a la página compartida.