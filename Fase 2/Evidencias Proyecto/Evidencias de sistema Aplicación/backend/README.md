<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
$ cp .env.example .env   # completar valores por ambiente (nunca commitear .env)
```

## Base de datos (Prisma + PostgreSQL)

El modelo de datos completo está documentado en
[`docs/modelo-datos.md`](docs/modelo-datos.md), incluidos los diagramas
(Mermaid y DBML para dbdiagram.io) y el cumplimiento de la Ley N°21.719 y el
Código del Trabajo.

```bash
# levantar PostgreSQL con docker compose (puerto 5433 del host)
$ docker compose up -d db

# aplicar migraciones
$ npm run prisma:migrate          # desarrollo (también crea migraciones nuevas)
$ npm run prisma:migrate:deploy   # producción/CI (solo aplica)

# datos base: roles (ADMINISTRADOR, SUPERVISOR, TRABAJADOR, CONTADOR),
# tipos de documento laboral, catálogo de medios de pago (CASH, DEBIT_CARD,
# CREDIT_CARD y TRANSFER) con sus alias MrComanda conocidos (EFECTIVO,
# T. DEBITO y T. CREDITO; SPRINT-4R-T08), tres locales iniciales y
# administrador inicial.
# Idempotente; no revierte los cambios administrativos de los locales ni del
# catálogo ni carga datos demo en producción (SEED_DEMO_DATA=false por defecto).
$ npm run prisma:seed

# opcional, solo desarrollo/pruebas: agrega usuarios, pacto, horas, entradas
# y un reparto por período histórico (solo lectura desde SPRINT-4A-T08),
# completamente sintéticos, del módulo de propinas.
$ SEED_DEMO_DATA=true npm run prisma:seed

# regenerar el cliente (corre solo en npm install vía postinstall)
$ npm run prisma:generate

# explorar datos en el navegador
$ npm run prisma:studio
```

### Credenciales iniciales (solo desarrollo)

Tras `npm run prisma:seed`, el administrador por defecto es
`admin@moi-food.cl` / `admin-cambiar-en-produccion` (valores de
`.env.example`, sobreescribibles con `ADMIN_EMAIL` y `ADMIN_PASSWORD`).
**Cambiar la contraseña en el primer inicio y nunca usarla en producción.**

## Autenticación (JWT)

Todos los endpoints exigen `Authorization: Bearer <accessToken>` salvo los
públicos (`GET /`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`).

| Endpoint | Acceso | Descripción |
| --- | --- | --- |
| `POST /auth/login` | Público | Valida email + contraseña (bcrypt) y emite access token (JWT, `JWT_EXPIRES_IN`) y refresh token (opaco, hash SHA-256 en BD, `JWT_REFRESH_EXPIRES_IN`) |
| `POST /auth/refresh` | Público | Rota el refresh token: revoca el usado y emite un par nuevo |
| `POST /auth/logout` | Público | Revoca el refresh token (idempotente) |
| `GET /auth/me` | Autenticado | Devuelve el usuario del token (id, email, rol, local) |

```bash
# ejemplo local
curl -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@moi-food.cl","password":"admin-cambiar-en-produccion"}'
```

## Autorización por rol y local

Además del `JwtAuthGuard`, hay dos guards globales que se ejecutan en este
orden y solo actúan sobre los endpoints decorados:

| Decorador | Guard | Efecto |
| --- | --- | --- |
| `@Roles(ROLE.ADMINISTRADOR, ...)` | `RolesGuard` | 403 si el rol del usuario no está en la lista. Se puede aplicar al controller completo; el del handler tiene prioridad. |
| `@StoreScoped({ field?, source? })` | `StoreAccessGuard` | Lee el ID del local de `params` (por defecto), `query` o `body` (campo `storeId` por defecto) y responde 403 si el usuario no tiene acceso a ese local; 400 si falta. |

Regla de acceso por local: `ADMINISTRADOR` y `CONTADOR` son globales y
acceden a todos los locales; `SUPERVISOR` y `TRABAJADOR` solo a su local
asignado. Los servicios pueden reutilizar la misma regla con
`canAccessStore(user, storeId)` (`src/auth/policies/store-access.policy.ts`).
Ambos decoradores documentan la respuesta 403 en Swagger automáticamente.

```ts
@Get(':storeId/cierres')
@Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR)
@StoreScoped()
listClosings(@Param('storeId') storeId: string) { ... }
```

## Administración de locales

Todos los endpoints exigen JWT. El listado está disponible para los roles autenticados; las mutaciones son exclusivas de `ADMINISTRADOR` (403 para el resto):

| Endpoint | Descripción |
| --- | --- |
| `GET /stores` | Lista locales ordenados por nombre, con filtro opcional `isActive=true\|false`. |
| `POST /stores` | Crea un local activo con `name`, `city`, `address` y, opcional, `subwayStoreId`. Recorta y colapsa espacios; responde 409 si el nombre ya existe, ignorando mayúsculas, tildes y espacios repetidos, o si el ID Subway ya es de otro local. |
| `PATCH /stores/:id` | Edita uno o más de esos campos y aplica las mismas validaciones; `null` responde 400, salvo `subwayStoreId: null`, que quita el ID Subway. |
| `PATCH /stores/:id/deactivate` | Desactiva el local sin borrar su historial. Responde 409 si tiene usuarios activos asignados; es idempotente si ya estaba inactivo. |
| `PATCH /stores/:id/reactivate` | Reactiva el local para permitir asignaciones y operaciones nuevas; es idempotente si ya estaba activo. |

**ID Subway (SPRINT-4A-T15/T16).** `subwayStoreId` es el número que Subway
asigna al local y que el Excel de MrComanda trae en su encabezado después del
número interno (`Local: 208 - 72597` → `72597`; el 208 no se guarda). Es
opcional, solo dígitos (1 a 10) y único (`stores.subway_store_id`, con CHECK);
la importación de ventas identifica el local por él. Su cambio se audita en
`STORE_UPDATED` con el valor anterior y el nuevo, y aplica a las próximas
importaciones. El seed asigna Santa María `72597`, Ugalde `74413` y Calera
`69132` solo a los locales base que no tengan uno.

Nombre y ciudad deben incluir al menos una letra; dirección, al menos una letra o número. Los caracteres invisibles se eliminan antes de validar. Las altas de usuarios y los cambios de estado del local se serializan con bloqueo de fila para evitar usuarios activos en locales inactivos. Las llamadas idempotentes sin cambio de estado no duplican auditoría.

Los locales inactivos no admiten asignación de usuarios ni cargas nuevas de documentos o liquidaciones. Las consultas históricas siguen disponibles. El seed solo crea los locales iniciales ausentes y no revierte los cambios realizados mediante esta API.

## Gestión de usuarios

Endpoints exclusivos del rol `ADMINISTRADOR` (403 para el resto):

| Endpoint | Descripción |
| --- | --- |
| `POST /users` | Crea un usuario con rol (`roleCode`), local (`storeId`) y contraseña inicial (entre 8 y 32 caracteres, sin superar 72 bytes; hash bcrypt con costo 12). `SUPERVISOR` y `TRABAJADOR` requieren local; `ADMINISTRADOR` y `CONTADOR` son globales y no lo admiten (400). RUT validado con dígito verificador. 409 si el correo o el RUT ya existen. |
| `GET /users` | Lista usuarios (sin hash de contraseña), con filtros opcionales `storeId`, `roleCode` e `isActive`. |
| `PATCH /users/:id/deactivate` | Desactiva la cuenta: bloquea login y renovación de sesión (revoca sus refresh tokens) sin borrar sus datos ni documentos. Idempotente; no permite desactivar la cuenta propia. |
| `PATCH /users/:id` | Edita datos personales, rol y local (no la contraseña). Valida la coherencia entre rol y local finales; si cambia el rol o el local, revoca sus refresh tokens. No permite cambiar el rol propio (400). 404 si no existe; 409 si el correo o el RUT ya existen o la cuenta está anonimizada. |
| `PATCH /users/:id/reactivate` | Reactiva una cuenta desactivada sin restaurar sus sesiones anteriores; exige rol activo y, en roles de local, un local activo (400). Idempotente: si ya está activa no tiene efecto ni se audita. 404 si no existe; 409 si está anonimizada. |
| `PATCH /users/:id/password` | Restablece la contraseña (`newPassword`: entre 8 y 32 caracteres, sin superar 72 bytes) con hash bcrypt de costo 12 y revoca sus refresh tokens. No permite restablecer la cuenta propia (400). 404 si no existe; 409 si está anonimizada. Una cuenta desactivada sigue desactivada. |

El access token ya emitido sigue vigente hasta su expiración (`JWT_EXPIRES_IN`).

## Consulta de auditoría

Endpoint exclusivo del rol `ADMINISTRADOR` (403 para el resto), de solo lectura:

| Endpoint | Descripción |
| --- | --- |
| `GET /audit-logs` | Lista las operaciones auditadas con usuario responsable, fecha/hora, local y tipo (`action`), de la más reciente a la más antigua. Filtros opcionales: `storeId` (UUID), `from` y `to` (`YYYY-MM-DD`, ambos inclusive). Paginación con `limit` (1–200, por defecto 50) y `offset`; la respuesta trae `items` y `total`. |

Las fechas `from`/`to` son días de negocio en la hora de Chile
(`America/Santiago`, con sus cambios de horario): `?from=2026-10-05&to=2026-10-05`
incluye una operación registrada a las 23:30 del 05-10 en Chile aunque en UTC
ya sea el 06-10. Sin `storeId` se incluyen también las operaciones globales
(sin local, ej. un login fallido); con `storeId`, solo las de ese local.

```bash
# operaciones del 01 al 05 de octubre en un local, de a 20
curl "http://localhost:3001/audit-logs?storeId=<uuid>&from=2026-10-01&to=2026-10-05&limit=20" \
  -H "Authorization: Bearer <access_token>"
```

### Operaciones auditadas

Los endpoints marcados con `@Audited()` quedan registrados automáticamente (`AuditInterceptor`):

| `action` | Operación |
| --- | --- |
| `USER_LOGIN` / `USER_LOGIN_FAILED` | Inicio de sesión exitoso o rechazado (401). |
| `USER_CREATED` / `USER_DEACTIVATED` | Creación y desactivación de usuarios. |
| `USER_UPDATED` / `USER_REACTIVATED` | Edición de usuarios (detalle limitado a `roleCode` y `storeId`, sin datos personales) y reactivación efectiva de cuentas. |
| `USER_PASSWORD_RESET` | Restablecimiento de contraseña por el administrador; el registro no incluye la contraseña ni su hash. |
| `STORE_CREATED` / `STORE_UPDATED` | Creación y edición de locales (detalle limitado a los campos recibidos). |
| `STORE_DEACTIVATED` / `STORE_REACTIVATED` | Desactivación y reactivación lógica de locales, con el local afectado asociado al evento. |
| `DOCUMENT_UPLOADED` / `DOCUMENT_VERSION_ADDED` | Carga de un documento laboral o de una nueva versión (detalle: trabajador, tipo, versión y SHA-256). |
| `DOCUMENT_DOWNLOADED` | Descarga de una versión (detalle: documento y resultado de integridad `VALID`/`ALTERED`). |
| `DOCUMENT_DELETED` / `DOCUMENT_DELETION_BLOCKED` | Eliminación vencido el plazo de conservación, o intento rechazado (409) antes de que venza. |
| `DOCUMENT_DT_REGISTERED` | Confirmación del registro de un documento en la DT. |
| `PAYSLIP_UPLOADED` | Carga de una liquidación por el contador (detalle: trabajador, período, SHA-256 y estado), con el local de la liquidación. |
| `PAYSLIP_PUBLISHED` | Publicación de una liquidación (detalle: trabajador, período, fecha de firma, fecha de publicación y SHA-256); el responsable es el usuario del evento. |
| `PAYSLIP_DOWNLOADED` | Descarga de una liquidación propia por el trabajador (detalle: versión y resultado de integridad `VALID`/`ALTERED`). |
| `TIP_ENTRY_CREATED` / `TIP_ENTRY_UPDATED` / `TIP_ENTRY_DELETED` | Creación, corrección y eliminación de propinas diarias (detalle: local, responsable, fecha, medio y monto). |
| `PAYMENT_METHOD_CREATED` / `PAYMENT_METHOD_UPDATED` | Alta y edición de medios de pago del catálogo (detalle limitado a los campos administrables; el código estable nunca cambia). |
| `PAYMENT_METHOD_DEACTIVATED` / `PAYMENT_METHOD_REACTIVATED` | Baja lógica y reactivación de medios de pago; desactivar no borra ni oculta el historial. |
| `MRCOMANDA_SALES_IMPORTED` | Ingreso de totales netos de ventas MrComanda por local y período (detalle: local, período, si creó ventas y neto total); el reintento idéntico no se audita de nuevo. |
| `CASH_CLOSING_CREATED` | Confirmación de un cierre de caja con sus totales de conciliación, fondo de propinas y motivo de diferencia. |
| `DAILY_OPERATION_CREATED` | Registro de la operación diaria de un local (detalle limitado a local, fecha de negocio, montos de propina, diferencia de efectivo y hash SHA-256 del voucher; sin datos personales). |
| `DAILY_OPERATION_VOUCHER_DOWNLOADED` | Descarga autorizada del voucher de una operación diaria (detalle limitado a la operación y el local). |

`TIP_ENTRY_*`, `CASH_CLOSING_CREATED` y `MRCOMANDA_SALES_IMPORTED` corresponden
al flujo anterior de captura: sus registros históricos siguen listándose en
auditoría, pero las escrituras ya no forman parte del flujo operativo vigente
(ver [Operación diaria](#operación-diaria-sprint-4r-t01-participantes-desde-sprint-4r-t03)).

El detalle se arma solo con campos declarados (listas blancas): nunca incluye contraseñas ni el contenido de los archivos.

### Accesos denegados (SPRINT-4R-T15)

Todo rechazo **403** de un usuario autenticado queda registrado como
`ACCESS_DENIED`, venga de un guard (rol o local) o de un servicio (recurso de
otro local). Lo registra el filtro global `AccessDeniedAuditFilter`, porque los
guards corren antes que el `AuditInterceptor`. El cliente recibe el mismo 403,
sin esperar a que termine el registro.

- `entityType`: primer segmento de la ruta (ej. `sales-dashboard`); `entityId`:
  el `:id` de la ruta solo si es un UUID.
- `detail`: `method`, `route` (plantilla, ej. `/daily-operations/:id`), `role`,
  `reason` (`ROLE`, `STORE` o `RESOURCE`) y `requestedStoreId` cuando la ruta o
  la consulta piden un local con UUID válido.
- El local del registro es el del usuario. Nunca se guardan el cuerpo, la
  consulta completa, el mensaje del error, correos, RUT ni montos.
- Los 401 (sin sesión) y 400 (validación) no se registran como acceso denegado.

Las rutas exclusivas del administrador se declaran en
`src/auth/constants/admin-only-routes.constants.ts`: el panel consolidado
(`sales-dashboard`), la importación de ventas (`sales-imports`, incluida la
descarga directa del Excel), el estado diario de ventas (`sales-days`), el
calendario de operación por local (`stores/:storeId`) y los alias de medios de
pago (`payment-method-aliases`). `test/admin-only-routes.spec.ts` falla si
algún endpoint de esas rutas admite otro rol o es público, y una ruta nueva de
este tipo se agrega a esa lista.

Los reportes de ventas (`sales-reports`, incluido `legacy`) son de solo
lectura y, desde SPRINT-4A-T23 (decisión del PO), los consulta también el
`CONTADOR` para contrastar el voucher y la diferencia de efectivo de la
operación diaria con las ventas por medio de pago. Se declaran en
`ADMIN_AND_ACCOUNTANT_READ_CONTROLLER_PATHS` del mismo archivo, y el test
verifica que solo expongan `GET` con `ADMINISTRADOR` y `CONTADOR`; la
importación de ventas y la corrección de la operación diaria siguen fuera de
su alcance.

### Inmutabilidad del registro

Una operación registrada no se puede modificar ni eliminar (criterio 2 de E1-H2):

- **API:** no existe ninguna ruta de escritura sobre `/audit-logs` (`PUT`, `PATCH` y `DELETE` responden 404).
- **Base de datos:** la migración `auditoria_inmutable` instala triggers que rechazan `UPDATE`, `DELETE` y `TRUNCATE` sobre `audit_logs` para cualquier rol (incluido el dueño de la tabla) y cualquier vía (Prisma, SQL directo o cascadas), con el error *"El registro de auditoría es inmutable"*.
- **Llaves foráneas:** `audit_logs.user_id` y `audit_logs.store_id` son `ON DELETE RESTRICT`: un usuario o local con historial no se puede borrar. Para el derecho de cancelación (Ley N°21.719) el usuario se anonimiza (`anonymized_at`), lo que conserva la fila y su trazabilidad.

Los triggers solo se omiten con `session_replication_role = replica`, que exige superusuario (mantenimiento de la base de datos). Los tests de integración que ejercitan la API por HTTP lo usan para purgar sus propios registros (`test/helpers/audit-cleanup.ts`), por lo que `TEST_DATABASE_URL` debe conectarse con un superusuario, como el `postgres` de docker compose.

## Seguridad de cargas de archivos y dependencias (SPRINT-4R-T18)

### Reglas comunes de las cargas

El sistema recibe archivos en cuatro puntos. Todos validan el archivo **por
su contenido** (nunca por el nombre ni por el tipo que declara el navegador),
lo guardan en el volumen privado `DOCUMENTS_STORAGE_PATH` con un nombre
físico aleatorio y calculan su SHA-256. Ninguno se sirve por una URL directa:
solo se descargan por su endpoint autorizado, que verifica el hash.

| Carga | Rol | Tipos | Tamaño máximo |
| --- | --- | --- | --- |
| `POST /documents` (documento laboral) | ADMINISTRADOR | PDF, PNG, JPEG | `DOCUMENTS_MAX_SIZE_MB` (25 por defecto) |
| `POST /payroll` (liquidación) | CONTADOR | PDF | `DOCUMENTS_MAX_SIZE_MB` |
| `POST/PATCH /daily-operations` (voucher) | SUPERVISOR (corrección: también ADMINISTRADOR) | JPEG, PNG, WebP | 5 MiB |
| `POST /sales-imports/preview` (Excel) | ADMINISTRADOR | .xlsx | 5 MB (y 25 MB descomprimido, máximo 100 archivos internos) |

Respuestas ante un archivo inválido, sin guardar nada en disco:

| Código | Cuándo |
| --- | --- |
| 400 | Sin archivo, archivo vacío o más de un archivo en la solicitud (Multer acepta uno solo por solicitud en las cuatro cargas). |
| 413 | Supera el tamaño máximo: Multer corta la subida antes de cargarla completa en memoria. |
| 415 | El contenido no es de un tipo permitido o no coincide con el tipo declarado (por ejemplo, un ejecutable o una imagen renombrados como `.pdf`). |
| 422 | Es del tipo correcto pero está **cortado o dañado**. |

El chequeo de archivos cortados (`src/storage/utils/file-structure.util.ts`)
revisa, además de los primeros bytes, la marca de cierre de cada formato: PDF
con `%%EOF` en los últimos 1.024 bytes, JPEG recorriendo sus segmentos por
su largo hasta el inicio de la imagen principal (SOS, `FF DA`) y exigiendo
después su marcador de fin `FF D9` (así la miniatura EXIF, que trae su propio
`FF D9`, no hace pasar una foto cortada; se toleran datos extra después del
fin, como en las fotos «en movimiento» de algunos celulares), PNG con el
bloque `IEND` y WebP del tamaño que declara su encabezado. El Excel se valida
con el lector de SPRINT-4R-T09, precedido por
`src/sales-imports/parser/xlsx-zip-guard.ts`: descomprime cada entrada del
ZIP con un tope real de 25 MB en total (una «bomba zip» de 302 KB que se
expandía a 300 MB usaba ~400 MB de memoria y ~1 minuto; ahora se rechaza con
413 en milisegundos), admite hasta 100 archivos internos y exige que las
entradas del directorio central cubran el archivo de corrido, sin entradas
escondidas. Es un chequeo
liviano: un archivo dañado por dentro con su cierre intacto pasa, y su
integridad posterior la protege el SHA-256. Ninguna respuesta de éxito o de
error expone la ruta física ni la carpeta del volumen.

La regresión `test/upload-hardening.integration.spec.ts` recorre las cuatro
cargas con los mismos casos (válido, 413, 415, 422, dos archivos, 401/403,
acceso directo a la carpeta y descarga de un archivo ausente).

### Dependencias

`npm audit --omit=dev` (lo que llega a la imagen de producción) quedó **sin
vulnerabilidades**. SPRINT-4R-T18 actualizó, eligiendo versiones con más de
diez días publicadas:

| Paquete | Antes | Después | Corrige |
| --- | --- | --- | --- |
| `@nestjs/core`, `common`, `platform-express`, `testing` | 12.0.4 | 12.3.0 | `multer` 2.4.0 → 2.5.0 (DoS en la carga de archivos) |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | 7.10.0 | 7.10.1 | `deepmerge-ts`, `@prisma/config` y `mysql2` |
| `body-parser`, `express`, `qs`, `fast-uri`, `source-map-js` | — | dentro de sus rangos | DoS y suplantación de esquemas en URLs |

Se descartó `@nestjs/platform-express` 12.4.0 (dos días publicada) porque la
12.3.0 ya trae el `multer` corregido.

**Residuales documentadas (solo desarrollo).** `npm audit` completo reporta
20 vulnerabilidades (3 altas, 15 moderadas, 2 bajas) **únicamente en
herramientas de desarrollo**, que no llegan al servidor: la etapa de
compilación del `Dockerfile` ejecuta `npm prune --omit=dev` antes de armar la
imagen final.

| Origen | Severidad | Paquete afectado |
| --- | --- | --- |
| `@nestjs/mau` (telemetría opcional del CLI) | alta | `tmp`, `undici` |
| `vitest` y `vite-tsconfig-paths` (pruebas) | alta / moderada | `vite`, `@vitest/mocker` |
| `eslint`, `typescript-eslint`, `@nestjs/cli` | moderada | `minimatch` |
| `inquirer` (CLI) | baja | `external-editor`, `tmp` |

Corregirlas exige subir versiones de las herramientas de pruebas y lint de
todo el equipo; queda como seguimiento de la auditoría de dependencias
(SPRINT-4R-T23).

## Conservación de documentos laborales

Los documentos laborales deben conservarse 5 años (art. 9 bis del Código del
Trabajo) hasta su `retainUntil` inclusive (criterio 3 de E1-H3):

- **API:** `DELETE /documents/:id` (solo `ADMINISTRADOR`) responde 409 mientras no venza el plazo y deja el documento intacto. Vencido, elimina el documento, todas sus versiones y sus archivos.
- **Base de datos:** la migración `bloqueo_eliminacion_documentos` instala triggers que rechazan eliminar un documento o una versión antes de que venza su plazo (el día se cuenta en hora de Chile), acortar `retain_until` y `TRUNCATE` sobre `documents`. Las versiones siguen sin poder modificarse nunca.

Igual que en la auditoría, los triggers solo se omiten con `session_replication_role = replica` (superusuario); los tests HTTP lo usan para purgar sus documentos de prueba.

## Alertas de registro en la Dirección del Trabajo

Contratos, anexos y finiquitos deben registrarse en la DT dentro de 15 días
corridos desde su celebración (o desde la carga si no se indicó la fecha). El
plazo se fija al cargar el documento (`dtRegistrationDueAt`). Endpoints
exclusivos del rol `ADMINISTRADOR` (403 para el resto):

| Endpoint | Descripción |
| --- | --- |
| `GET /dt-alerts` | Documentos pendientes de registro: `deadline`, `daysRemaining` (días corridos en hora de Chile; 0 el último día, negativo si venció) y `status` `UPCOMING`/`OVERDUE`. Primero los vencidos, luego los más próximos. Incluye `calculatedAt`. |
| `POST /dt-alerts/:alertId/registration` | Marca el documento como registrado (`dtRegisteredAt` y quién lo confirmó) y la alerta deja de listarse. Cuerpo `{ documentId, revision }`: si el documento ya se registró o cambió desde la consulta (`revision` distinta) responde 409. |

## Liquidaciones de sueldo

El contador carga la liquidación de cada trabajador por período (mes). Queda
**pendiente de firma** (`PENDING_SIGNATURE`) y el trabajador no la ve hasta que
se publique. El PDF se guarda en el gestor documental como documento
`LIQUIDACION`, con su versión, su hash SHA-256 y la conservación de 5 años.

| Endpoint | Roles | Descripción |
| --- | --- | --- |
| `GET /payroll` | `CONTADOR`, `ADMINISTRADOR` | `{ items, workers, policy }`: liquidaciones (trabajador, local, período `YYYY-MM`, archivo, SHA-256, estado, `revision` y `canPublish`), selector de trabajadores activos para la carga y reglas de carga (solo PDF, `maxBytes`; `canUpload` solo para el contador). Filtros opcionales `storeId`, `period` y `status`. |
| `POST /payroll` | `CONTADOR` | Multipart `workerId`, `period` (`YYYY-MM`) y `file` (PDF). 400 si el período es posterior al mes en curso o el trabajador no está activo; 409 si ya existe una liquidación suya para ese período o el archivo ya está registrado; 415 si no es PDF. |
| `POST /payroll/:id/publish` | `CONTADOR` | Cuerpo `{ revision, signedAt? }`. Pasa la liquidación de `PENDING_SIGNATURE` a `PUBLISHED` con fecha de firma (`signedAt`, entre el día de carga y hoy; por defecto hoy), fecha de publicación y responsable. Antes recalcula el SHA-256 del archivo. 409 si ya está publicada, si cambió desde la consulta (`revision`) o si el archivo no coincide con su hash. |

### Mis liquidaciones (portal del trabajador)

Cada trabajador (`TRABAJADOR` o `SUPERVISOR`) ve y descarga **solo sus
liquidaciones publicadas**: las pendientes de firma no se devuelven (criterio 2
de E2-H1). El trabajador sale siempre del token, nunca de un parámetro (Ley
N°21.719); una liquidación ajena, pendiente o inexistente responde 404 sin
revelar que existe. El contador y el administrador reciben 403.

| Endpoint | Descripción |
| --- | --- |
| `GET /payroll/mine` | `{ items }`: liquidaciones publicadas propias, del período más reciente al más antiguo (`id`, `versionId`, `workerId`, `period`, `status`, `fileName`, `mime`, `size`, `sha256`, `signedAt` y `publishedAt`). |
| `GET /payroll/mine/:id/integrity` | Recalcula el SHA-256 del archivo y responde `VALID`, `ALTERED` o `MISSING` con el hash esperado y el recalculado (criterio 3 de E2-H1). |
| `GET /payroll/mine/:id/download` | PDF con `X-Document-Integrity` (`VALID`/`ALTERED`, recalculado al descargar), `nosniff` y `Cache-Control: private, no-store`. 404 si el archivo no está en el almacenamiento. |

### Inmutabilidad de las liquidaciones publicadas

Una liquidación publicada **no se puede editar ni eliminar** (criterio 1 de
E2-H1): la API no tiene rutas para hacerlo y la migración
`liquidaciones_publicadas_inmutables` instala triggers que rechazan modificarla,
eliminarla mientras no venza la conservación de su documento, `TRUNCATE` sobre
`payslips`, y agregar versiones o modificar el documento de su archivo. Igual
que en la auditoría, solo se omiten con `session_replication_role = replica`
(superusuario).

## Operación diaria (SPRINT-4R-T01, participantes desde SPRINT-4R-T03)

Una sola operación por local y fecha de negocio reemplaza al flujo anterior de
cierre de caja por turno con conciliación, a la captura de ventas (manual o
MrComanda) y al registro de propinas por medio. El supervisor declara una vez al
día la propina recibida con tarjeta (con su voucher), la propina en efectivo, la
diferencia de efectivo observada y los participantes del reparto;
**las ventas no se capturan aquí** (llegan por la
[importación del Excel](#importación-diaria-de-ventas-sprint-4r-t10)) y ningún
total de propinas se calcula ni se infiere desde ellas. Al guardar, la API
reparte el fondo del día entre los participantes
([reparto equitativo](#reparto-equitativo-de-propinas-sprint-4r-t04)) en la
misma transacción. Guía de uso por rol:
[`docs/guia-propinas-y-ventas.md`](../docs/guia-propinas-y-ventas.md).

Solo existe una operación por `(storeId, businessDate)`. El alta es
**multipart** (`multipart/form-data`):

| Campo | Regla |
| --- | --- |
| `storeId` | UUID del local. El alta es exclusiva del `SUPERVISOR` de su local asignado; `ADMINISTRADOR` y `CONTADOR` solo consultan, en cualquier local según los GET. |
| `businessDate` | Fecha de negocio `YYYY-MM-DD` (hora de Chile). |
| `cardTipAmount` | Entero CLP `>= 0`: propina recibida con tarjeta del día. |
| `cashTipAmount` | Entero CLP `>= 0`: propina recibida en efectivo del día. |
| `cashDifference` | Entero CLP **con signo**: diferencia de efectivo declarada por el supervisor. Positivo = sobrante, negativo = faltante. |
| `differenceReason` | Obligatorio si `cashDifference != 0`; ausente o en blanco con diferencia distinta de cero responde 400. |
| `voucher` | Foto del voucher de propinas con tarjeta. Obligatorio si `cardTipAmount > 0`; JPEG/PNG/WebP, máximo 5 MiB. Se guarda en el volumen **privado** del backend con su SHA-256 y jamás se sirve como archivo público. |
| `participantIds` | Repetido: un campo por cada participante del reparto (`FormData.append` por ID). Cada valor debe ser el UUID de un `TRABAJADOR` o `SUPERVISOR` activo del local (SPRINT-4A-T01; el supervisor puede incluirse a sí mismo; catálogo `GET /daily-operations/eligible-workers`). Con fondo del día (`cardTipAmount + cashTipAmount`) mayor que 0 se exige al menos uno; con fondo 0 la selección debe venir vacía. Se rechazan con 400 y mensaje claro: lista vacía cuando corresponde, IDs repetidos, UUID inválidos y usuarios no elegibles (otro local, inactivo, `ADMINISTRADOR` o `CONTADOR`). |

Propinas y selección se guardan **en la misma transacción**: no existe una
operación con la mitad de la selección. La selección es una sola lista
compartida por la propina de tarjeta y la de efectivo del mismo local/día.

`tipFundAmount` no se recibe del cliente: se calcula como `cardTipAmount +
cashTipAmount` y es el fondo de propinas del día. La operación diaria es la
**fuente de ambos montos de propina**: no se crean registros `TipEntry`
paralelos ni se infieren propinas desde ventas o vouchers.

| Endpoint | Roles | Descripción |
| --- | --- | --- |
| `POST /daily-operations` | `SUPERVISOR` (solo su local) | Crea la operación del local y día con su selección de participantes. **201** al crear; un **reintento idéntico** (mismos campos, mismo archivo de voucher por su hash y misma selección comparada como conjunto, sin exigir orden) responde **200** con la operación existente y no duplica fila, selección ni auditoría; otro contenido para la misma clave responde **409** con `existingOperationId` consultable. |
| `GET /daily-operations/eligible-workers?storeId=<uuid>` | `SUPERVISOR` (su local), `ADMINISTRADOR` | Catálogo acotado de participantes elegibles: `TRABAJADOR` y `SUPERVISOR` activos del local ordenados alfabéticamente, solo `{id, name}` (jamás RUT, correo, teléfono ni credenciales). |
| `PATCH /daily-operations/:id` | `SUPERVISOR` (su local), `ADMINISTRADOR` | Corrección **multipart**: corrige solo lo enviado (montos, diferencia, motivo, `participantIds` repetido y/o voucher de reemplazo); local, fecha y responsable original no cambian. El voucher se conserva si la tarjeta sigue mayor que 0 y no hay reemplazo, y se retiran archivo y metadatos si la tarjeta queda en 0; con caja cuadrada el motivo queda vacío. La corrección bloquea la fila (`FOR UPDATE`) y recalcula sus reglas sobre el estado vigente: dos correcciones simultáneas se serializan y ninguna decide con datos obsoletos. Si cambia el fondo o la selección, el reparto (`tipAllocations`) se recalcula en la misma transacción solo si todas sus propinas están No pagadas; con alguna Pagada responde **409** sin cambiar nada (corregir solo motivo, diferencia o voucher no toca el reparto). Los triggers de la base también impiden corregir montos o selección de una operación que alimentó un reparto histórico `CONFIRMED`/`PAID` (409). |
| `GET /daily-operations?storeId=<uuid>&businessDate=<fecha>` | `SUPERVISOR` (su local), `ADMINISTRADOR`, `CONTADOR` | Arreglo de 0 o 1 operaciones para el local y día. |
| `GET /daily-operations/:id` | `SUPERVISOR` (su local), `ADMINISTRADOR`, `CONTADOR` | Detalle de la operación. |
| `GET /daily-operations/:id/voucher` | `SUPERVISOR` (su local), `ADMINISTRADOR`, `CONTADOR` | Descarga privada y autorizada del voucher; no existe una URL pública del archivo. |

Respuesta (`DailyOperationResponse`): `id`, `store` (`id`, `name`),
`businessDate`, `cardTipAmount`, `cashTipAmount`, `tipFundAmount`,
`cashDifference`, `differenceReason`, `voucher` (`null` u objeto con `id`,
`fileName`, `mimeType`, `sizeBytes`, `sha256Hash`, `createdAt`),
`responsible` (`id`, `name`; siempre desde el JWT — el body no acepta
`responsibleId`), `participants` (arreglo de `{id, name}` ordenado por nombre;
la selección compartida por tarjeta y efectivo), `tipAllocations` (la propina
de cada participante con su monto, estado `UNPAID`/`PAID` y lote de pago;
SPRINT-4A-T03) y `createdAt`/`updatedAt`. Los
montos son enteros en CLP: se rechazan negativos en las propinas, decimales y
campos obligatorios vacíos con 400 identificando el campo. El alta se audita
como `DAILY_OPERATION_CREATED` y la corrección como `DAILY_OPERATION_UPDATED`,
ambas con detalle limitado a local, fecha, montos, hash del voucher y la
selección enviada (lista blanca: sin correos, RUT ni contenido del archivo); el
actor de cada corrección queda registrado. El contrato completo está en Swagger
(`/api/docs`).

### Participantes del reparto y regla equitativa (SPRINT-4R-T02; API en SPRINT-4R-T03)

Desde SPRINT-4R-T02 la operación diaria conserva, a nivel de base de datos, la
selección de trabajadores que participan de su reparto
(`daily_operation_participants`): una única selección por operación, compartida
por la propina de tarjeta y la de efectivo del mismo local/día (la operación ya
acumula ambas en `tipFundAmount`), sin duplicados
(`UNIQUE(operation_id, worker_id)`) y validada al insertar o cambiar (el
participante debe ser del mismo local, con rol `TRABAJADOR` o, desde
SPRINT-4A-T01, `SUPERVISOR`, y activo): una baja lógica posterior no borra la
selección histórica. El pacto de reparto admite la
regla equitativa explícita `EQUAL_SHARES` junto a la proporcional histórica
`PROPORTIONAL_TO_HOURS`, que identifica los repartos guardados con
`tip_entries` y horas;
las líneas y constancias de un reparto equitativo guardan `hoursWorked`
`NULL` — la regla no usa horas y no se inventan — mientras los repartos
proporcionales e históricos conservan las suyas. Los repartos por período
(`tip_pools`, hoy históricos) se alimentaban de la operación por una fuente
propia (`tip_pool_daily_operation_sources`); los `CONFIRMED`/`PAID` siguen
inmutables y congelan las operaciones que los alimentaron. Desde SPRINT-4A-T02
la unidad vigente es la propina diaria por participante
(`daily_tip_allocations`), descrita en
[Propinas diarias y pago por período](#propinas-diarias-excel-y-pago-por-período-sprint-4a-t04-a-t06).

La API para consultar y corregir la
selección de participantes está descrita en
[Operación diaria](#operación-diaria-sprint-4r-t01-participantes-desde-sprint-4r-t03);
el cálculo diario equitativo se describe en
[Reparto equitativo](#reparto-equitativo-de-propinas-sprint-4r-t04). Detalle
del modelo en
[`docs/modelo-datos.md`](docs/modelo-datos.md#participantes-diarios-y-regla-equitativa-sprint-4r-t02).

## Reparto equitativo de propinas (SPRINT-4R-T04)

**Regla.** El fondo de cada operación diaria (propina de tarjeta + efectivo,
`tipFundAmount`) se divide **una sola vez** en partes iguales entre los
participantes de ese día; un no seleccionado no recibe nada y no se usan
horas. Desde SPRINT-4A-T03 la API aplica la regla al guardar o corregir la
operación diaria y guarda una propina No pagada por participante
(`daily_tip_allocations`), que se paga por período con
`POST /daily-tips/payment-batches` (SPRINT-4A-T06).

**Residuo CLP (determinista).** Cada participante recibe
`floor(fondo / n)` y los `fondo mod n` pesos sobrantes se entregan de a $1:
los participantes se ordenan por ID ascendente y el primer peso va a la
posición `(días desde 1970-01-01 hasta la fecha de negocio) mod n`, el
siguiente a la posición siguiente (circular). Así el peso extra rota entre los
participantes día a día en lugar de favorecer siempre al mismo, y la
asignación de un día depende solo de ese día. Las asignaciones siempre suman
el fondo exacto: $10.000 entre 3 asigna $3.334, $3.333 y $3.333. La regla vive
en `splitDailyFund` (`src/tips/calculation/equal-daily-distribution.calculator.ts`).

### Repartos por período: histórico de solo lectura (SPRINT-4A-T08)

Hasta SPRINT-4A-T08 el contador calculaba un borrador por local y período
(`tip_pools`), lo observaba, confirmaba y pagaba, y el pago emitía una
constancia por trabajador. Ese flujo se retiró: pagar un reparto por período
dejaba las propinas diarias del período No pagadas y permitía pagarlas dos
veces. Las tablas y sus filas (repartos, líneas, fuentes y constancias) se
conservan sin cambios.

| Endpoint | Roles | Descripción |
| --- | --- | --- |
| `GET /tip-pools` | `CONTADOR`, `ADMINISTRADOR` | Lista los repartos guardados del período más reciente al más antiguo. Filtros opcionales: `storeId` y el período exacto `periodStart` + `periodEnd` (van juntos). |
| `GET /tip-pools/:id` | `CONTADOR`, `ADMINISTRADOR` | Foto guardada del reparto, sin recalcular. |
| `GET /tip-pools/:id/receipts` | `CONTADOR`, `ADMINISTRADOR` | Constancias de un reparto `PAID` (409 si es `DRAFT` o `CONFIRMED`). |
| `GET /tip-pools/:id/receipts/:userId/download` | `CONTADOR`, `ADMINISTRADOR` | PDF de la constancia, generado desde su foto, sin caché y auditado. |
| `POST /tip-pools/preview`, `POST /tip-pools/:id/observations`, `/confirm` y `/pay` | — | **410 Gone** para cualquier rol autenticado, sin leer el cuerpo ni tocar la base (documentados como obsoletos en Swagger). |

Estados del histórico: `DRAFT` es un **borrador sin efecto** (nunca se
confirmó ni se pagó; no bloquea correcciones de sus operaciones ni el pago por
lote), `CONFIRMED` es un reparto confirmado sin pago registrado (los triggers
siguen congelando sus operaciones fuente) y `PAID` es un reparto pagado con
sus constancias. Los repartos proporcionales anteriores a SPRINT-4R-T04 se
leen con sus horas, pacto y fuentes `tip_entries`; los equitativos, con
`rule: "EQUAL_SHARES"`, `totalHours: null` y `dailySources`. Los triggers de
la base mantienen la inmutabilidad de `CONFIRMED`, `PAID` y las constancias.

## Propinas diarias, Excel y pago por período (SPRINT-4A-T04 a T06)

**Modelo (SPRINT-4A-T02/T03).** Al guardar o corregir la operación diaria, la
API guarda en la misma transacción una propina por participante
(`daily_tip_allocations`: operación, local, fecha, trabajador, monto CLP
entero y estado `UNPAID` No pagada / `PAID` Pagada). La base garantiza que las
propinas de una operación sumen exactamente su fondo y cubran a todos sus
participantes, que una propina `PAID` sea inmutable y que una operación con
propinas pagadas no cambie sus montos, fecha, local ni participantes. El pago
se registra como lote inmutable (`tip_payment_batches`: local, período, total,
cantidad, quién pagó y cuándo). Detalle en
[`docs/modelo-datos.md`](docs/modelo-datos.md#propinas-diarias-por-trabajador-y-lotes-de-pago-sprint-4a-t02).

Todos los endpoints exigen JWT; el rango `from`–`to` (YYYY-MM-DD, inclusive,
días de negocio en hora de Chile) es de hasta **62 días**. Fechas inválidas,
`from` posterior a `to` o un rango mayor responden 400; un local inexistente,
404.

| Endpoint | Roles | Descripción |
| --- | --- | --- |
| `GET /daily-tips/days?storeId&from&to` | `ADMINISTRADOR`, `CONTADOR`, `SUPERVISOR` (su local) | Un elemento por día con operación diaria: total repartido, pagado, pendiente, participantes y estado del día (`UNPAID`, `PARTIAL` o `PAID`), más los totales del rango. |
| `GET /daily-tips/day?storeId&date` | `ADMINISTRADOR`, `CONTADOR`, `SUPERVISOR` (su local) | Propina de cada participante del día con su estado y, si está pagada, el lote y la fecha de pago. Solo `id` y nombre de cada persona. |
| `GET /daily-tips/summary?storeId&from&to[&status]` | `ADMINISTRADOR`, `CONTADOR`, `SUPERVISOR` (su local) | Por trabajador: días con propina, total, pendiente y pagado, más el total general; `status=UNPAID` muestra solo lo que falta pagar. |
| `GET /daily-tips/export?storeId&from&to` | `ADMINISTRADOR`, `CONTADOR` | Descarga `propinas_<local>_<desde>_<hasta>.xlsx`: hoja «Resumen» (una fila por trabajador con nombre y RUT, una columna por día, totales por trabajador, por día y general) y hoja «Detalle» (fecha, trabajador, monto, estado y lote). Montos numéricos con formato CLP que cuadran con `/summary`; `Cache-Control: no-store`. Auditado como `DAILY_TIPS_EXPORTED` sin montos ni datos personales. |
| `POST /daily-tips/payment-batches` | `ADMINISTRADOR`, `CONTADOR` | Cuerpo `{ storeId, from, to }`. Crea el lote y marca en él todas las propinas No pagadas del local en el período, en una transacción que bloquea el local y sus operaciones (`FOR UPDATE`). **201** con total, cantidad de propinas y de trabajadores, quién y cuándo. Sin pendientes responde **409** sin crear el lote: un doble clic o dos solicitudes simultáneas no duplican el pago. No se puede revertir. Auditado como `DAILY_TIPS_PAID`. |
| `GET /daily-tips/payment-batches?storeId&from&to` | `ADMINISTRADOR`, `CONTADOR` | Lotes del local cuyo período se cruza con el rango, del pago más reciente al más antiguo. Incluye los lotes históricos creados por la migración para los repartos por período ya pagados. |

La alerta de las propinas No pagadas fuera de plazo está en
[Alerta legal de pago de propinas](#alerta-legal-de-pago-de-propinas-sprint-4a-t22).

**Migración de los datos anteriores** (`20261110040000_propinas_diarias_lotes_pago`):
cada operación existente con fondo y participantes recibió sus propinas con la
misma regla de reparto; las que alimentaban un reparto por período `PAID`
quedaron `PAID` en un lote histórico por reparto (`legacy_pool_id`), y el resto
(incluidas las de repartos `DRAFT` y `CONFIRMED`) quedó `UNPAID`. Ninguna fila
de `tip_pools` se borró ni modificó.

## Mis propinas: portal del trabajador (SPRINT-4A-T09)

| Endpoint | Roles | Descripción |
| --- | --- | --- |
| `GET /my-tips?from&to` | `TRABAJADOR`, `SUPERVISOR` | Propinas propias por día (fecha, local, monto, estado, lote y fecha de pago) y los totales pendiente y pagado. La identidad sale del JWT: `userId` y `storeId` responden 400. Sin `from` ni `to` se consulta el mes en curso (hora de Chile); máximo 62 días. `ADMINISTRADOR` y `CONTADOR` reciben 403. |

La propina aparece como No pagada apenas el supervisor guarda la operación del
día, y como Pagada (con la fecha del lote) después del pago por período. Las
constancias de los repartos antiguos siguen en `GET /my-tip-receipts`
([Constancias propias](#constancias-propias-de-propinas-sprint-3-t16)).

## Lectura del Excel diario de MrComanda (SPRINT-4R-T09)

Las ventas del día salen del «Informe de Ventas Diario» que exporta MrComanda
(.xlsx). `src/sales-imports/parser/` lo lee y valida sin persistir nada, y
`SalesImportResolverService` lo resuelve contra las equivalencias de
SPRINT-4R-T08. La API de previsualización y confirmación llega con
SPRINT-4R-T10.

**Qué lee y de dónde** (siempre por etiqueta, nunca por filas fijas):

| Dato | Origen en el reporte |
| --- | --- |
| Fecha de negocio | Fila «Período:» (un solo día). **No** el nombre del archivo ni la «Fecha» de emisión: el informe del 05/11 se emite el 06/11 y suele llamarse `ventas-06-11-2026.xlsx`. Si el título «Informe de Ventas Diario …» trae otra fecha, se rechaza. |
| Período (inicio y fin) | Fila «Horario:» en hora de Chile (`America/Santiago`); si termina antes de empezar, cruza la medianoche. |
| Local | `Local: …` en la fila de filtros del encabezado (ej. «208 - 72597»). De ese texto se extrae el **ID Subway** (72597; también acepta «72597» solo y variantes de espacios); el 208 es un número interno de MrComanda que se ignora (SPRINT-4A-T17). Un encabezado sin ID reconocible se lee igual y el local queda como no identificado. Un informe de todos los locales o de varios se rechaza. |
| Total y medios de pago | Sección «Medios de pago»: total en su misma fila, una línea por medio con importe y «Porcentaje» opcional, hasta la primera fila vacía o la siguiente sección. «Venta por depto.» se ignora. |

Cada línea conserva la etiqueta original (sin el relleno de espacios) y su
forma normalizada (`normalizeExternalLabel`, misma regla que la función SQL
`normalize_external_label`). Admite cualquier cantidad de medios.

**Rechazos** (`MrComandaReportError` con `code`, fila y mensaje en español que
dice qué revisar): archivo vacío, mayor a 5 MB o a 25 MB descomprimido, `.xls` antiguo, contenido que
no es .xlsx o dañado; sin informe o con varios informes; período ausente,
ilegible, de varios días o que contradice el título; horario ausente o
inválido; local ausente, combinado o ambiguo; total o montos que no son pesos
enteros, porcentajes fuera de 0–100, medios repetidos y suma de líneas
distinta del total del reporte. Las propinas y la diferencia de efectivo no
se leen: el reporte no las trae y vienen de la operación diaria.

**Resolución.** El local se identifica por su ID Subway
(`stores.subway_store_id`, SPRINT-4A-T15) y debe estar activo
(SPRINT-4A-T17). Un encabezado sin ID Subway reconocible
(`STORE_NOT_IDENTIFIED`), un ID Subway no asignado a ningún local
(`STORE_NOT_CONFIGURED`: «El ID Subway 72597 no está asignado a ningún
local»), un local inactivo (`STORE_INACTIVE`) o una etiqueta con valor sin
alias quedan como `issues` y `canConfirm = false`: nunca se crean
equivalencias por suposición; el administrador los elige a mano
([resolución manual](#resolución-manual-de-local-y-medios-sprint-4a-t18-a-t21)).
Una línea en 0 sin alias se omite sola (`skipped = true`, SPRINT-4A-T21) y no
impide confirmar. `store_external_codes` queda sin uso (ni la API ni los
triggers la leen); se conserva por compatibilidad y su retiro, si
corresponde, irá en una migración nueva. Con el reporte real de ejemplo, «N.de Créd.» viene en
$0 y se omite sola.

**Dependencia XLSX.** `read-excel-file` con versión exacta (9.3.12): solo lee
.xlsx, depende de pocos paquetes y no tenía vulnerabilidades en `npm audit`
al elegirla. Se descartaron `xlsx`/SheetJS (la versión de npm arrastra
prototype pollution y ReDoS sin corrección en el registro) y `exceljs` (~170
paquetes y una vulnerabilidad moderada en `uuid`). Los tests generan
planillas ficticias en memoria con `write-excel-file` (solo desarrollo, versión
exacta); el archivo real no se versiona y sirve de aceptación manual:

```bash
MRCOMANDA_SAMPLE_XLSX=/ruta/ventas-06-11-2026.xlsx npx vitest run test/mrcomanda-report-reader.spec.ts
# esperado: fecha 2026-11-05, local 208 - 72597 (ID Subway 72597), 4 líneas que suman $873.260
# con la base de pruebas, identifica el archivo como Santa María (72597):
MRCOMANDA_SAMPLE_XLSX=/ruta/ventas-06-11-2026.xlsx TEST_DATABASE_URL=... npx vitest run test/sales-import-resolver.integration.spec.ts
```

## Importación diaria de ventas (SPRINT-4R-T10)

El ADMINISTRADOR importa los totales diarios por medio de pago de cada local
desde el Excel de MrComanda. Es la única vía de ingreso de ventas: no hay otro
formulario manual y el archivo no aporta propinas ni descuadres (vienen de la
operación diaria). Todos los endpoints exigen JWT de **ADMINISTRADOR**
(lectura incluida; SPRINT-4R-T15 revisa después los permisos del bloque de
ventas).

| Método y ruta | Qué hace |
| --- | --- |
| `POST /sales-imports/preview` | Multipart con el campo `file` (.xlsx, máximo 5 MB; se valida por su contenido, no por el nombre ni el tipo declarado). Lee el reporte, resuelve local y medios y, si todo resuelve, guarda el archivo en el volumen privado (`DOCUMENTS_STORAGE_PATH/sales-imports/`, nombre aleatorio) y crea la importación `PENDING` con su siguiente versión. |
| `POST /sales-imports/:id/confirm` | Cuerpo `{ "expectedActiveImportId": "<uuid>" \| null }`. En una transacción la versión vigente del mismo local y fecha pasa a `SUPERSEDED` y esta a `ACTIVE`. |
| `POST /sales-imports/confirm-with-resolution` | Multipart con `file` (el mismo Excel) y `resolution` (JSON). Para una vista previa `UNRESOLVED`: crea la importación con lo elegido a mano y la deja vigente en una sola transacción (ver [resolución manual](#resolución-manual-de-local-y-medios-sprint-4a-t18-a-t21)). |
| `DELETE /sales-imports/:id` | Descarta una `PENDING` y su archivo. Las confirmadas o reemplazadas nunca se eliminan. |
| `GET /sales-imports` | Lista con filtros `storeId`, `from`, `to` (YYYY-MM-DD), `status` y `limit` (1–200). |
| `GET /sales-imports/:id` | Detalle con líneas por medio de pago y todas las versiones del mismo local y fecha. |
| `GET /sales-imports/:id/file` | Descarga autorizada del Excel original; `X-File-Integrity: VALID` o `ALTERED` según el SHA-256. |

**Resultados de la vista previa** (`outcome`):

| outcome | HTTP | Significado |
| --- | --- | --- |
| `CREATED` | 201 | Archivo nuevo guardado como `PENDING`; `canConfirm: true`. `activeImport` indica la versión vigente que se reemplazaría. |
| `EXISTING` | 200 | El mismo archivo (hash) ya estaba importado para ese local y fecha: se devuelve esa importación sin duplicarla ni volver a auditar. |
| `UNRESOLVED` | 200 | El Excel es válido, pero el local o algún medio con valor no se identificó (`issues`); no se guarda nada. Trae `resolutionOptions` (locales activos con su versión vigente y medios activos del catálogo) para resolverlo con `confirm-with-resolution`. |

Los problemas del archivo responden con `code`, `row` y un mensaje accionable,
sin guardar nada: 400 (sin archivo o vacío), 413 (más de 5 MB, o más de 25 MB descomprimido), 415 (`.xls` o
algo que no es .xlsx) y 422 (dañado o estructura inválida: período de varios
días, local combinado, total que no cuadra, etc.).

**Correcciones y versiones.** Un archivo distinto para el mismo local y fecha
crea la versión siguiente como `PENDING`; la vigente no cambia hasta
confirmar. Confirmar exige `expectedActiveImportId` (el `activeImport.id` de
la vista previa, o `null` si no había vigente): si otra confirmación cambió la
vigente entretanto responde **409** con la vigente actual, así una corrección
siempre es explícita. Confirmar de nuevo una ya vigente devuelve 200 sin
cambios, y una versión reemplazada no puede volver a quedar vigente (409). En
cuanto se confirma, la importación queda vigente para su día: una carga
tardía no requiere ningún paso manual adicional.

**Garantías.** Las cargas de un local se serializan (bloqueo del local) y las
restricciones únicas de SPRINT-4R-T08 resuelven cualquier carrera: dos cargas
simultáneas del mismo archivo dejan una sola importación y un solo archivo;
dos confirmaciones simultáneas nunca dejan dos vigentes. Cabecera y líneas se
crean en la misma transacción y, si falla, el archivo guardado se elimina.

**Auditoría** (listas blancas, nunca el contenido del archivo):
`SALES_IMPORT_PREVIEWED` (solo cargas nuevas), `SALES_IMPORT_CONFIRMED` (con
la versión reemplazada), `SALES_IMPORT_DISCARDED` y
`SALES_IMPORT_FILE_DOWNLOADED`, con actor, local, fecha de negocio, hash,
versión y total.

### Resolución manual de local y medios (SPRINT-4A-T18 a T21)

`POST /sales-imports/confirm-with-resolution` reenvía el archivo con la
elección del administrador en el campo `resolution` (JSON validado como
`SalesImportResolutionDto`):

```json
{
  "expectedActiveImportId": null,
  "store": { "storeId": "<uuid>", "remember": true },
  "lines": [
    { "lineNumber": 3, "action": "ASSIGN", "paymentMethodId": "<uuid>", "remember": true },
    { "lineNumber": 4, "action": "CREATE", "name": "Gift card", "remember": true }
  ]
}
```

- `store` solo va si el local no se identificó: un local **activo**. Con
  `remember`, el ID Subway del archivo se asigna al local solo si este no
  tiene uno (nunca se sobrescribe; auditado como `STORE_UPDATED`).
- `lines` trae exactamente una entrada por línea pendiente (sin alias y con
  valor): `ASSIGN` la asocia a un medio activo; `CREATE` da de alta un medio
  nuevo (activo, `EXTERNAL_OTHER`, sin propinas) con ese nombre y el alias de
  la etiqueta, en la misma transacción (`PAYMENT_METHOD_CREATED` y
  `PAYMENT_METHOD_ALIAS_CREATED`; en `CREATE`, `remember` debe ser `true`).
  Con `ASSIGN` y `remember` se crea el alias de la etiqueta. Las líneas en 0
  sin alias se omiten solas y no se envían; una línea con valor nunca se
  omite.
- Si la resolución no cubre exactamente lo pendiente o una elección no es
  válida responde **400** sin guardar nada; si la versión vigente cambió, si el
  archivo ya tiene otra versión o si el medio nuevo repite un nombre o código
  existente, **409**. Mismo archivo ya vigente: 200 sin cambios.
- El detalle (`GET /sales-imports/:id`) registra lo resuelto a mano
  (`resolvedBy`, la resolución de cada línea) y las líneas omitidas
  (`skippedLines`, `sales_import_skipped_lines`, solo con monto 0).

## Días de operación y ventas sin importar (SPRINT-4R-T12)

No todos los días exigen ventas: cada local tiene días semanales de operación
y excepciones de cierre con motivo. Con eso la API calcula el estado de ventas
de cada local y día de negocio (hora de Chile), **al consultar y sin guardar
alertas**: cada local y fecha aparece una sola vez y una importación tardía lo
resuelve sola. El aviso vive solo en el panel administrativo (sin correos,
push ni recordatorios). Es independiente de los horarios de los trabajadores.
Todos los endpoints exigen JWT de **ADMINISTRADOR**.

| Método y ruta | Qué hace |
| --- | --- |
| `GET /stores/:storeId/operating-calendar` | Calendario del local (`configured`, `weekdays`, `trackingStartDate`) y sus cierres. |
| `PUT /stores/:storeId/operating-calendar` | `{ "weekdays": [1,2,3,4,5,6], "trackingStartDate": "2026-11-01" }` (ISO: 1 = lunes … 7 = domingo; al menos uno). Crea o reemplaza el calendario de un local activo. |
| `POST /stores/:storeId/closures` | `{ "date": "2026-12-25", "reason": "Feriado" }`: cierre por excepción, uno por local y fecha (409 con `existingClosureId` si ya existe). |
| `DELETE /stores/:storeId/closures/:closureId` | Quita un cierre registrado por error; el día vuelve a evaluarse. |
| `GET /sales-days` | Estado por local y día. Filtros `from`, `to` (YYYY-MM-DD), `storeId` y `status`. Por defecto los últimos 30 días hasta hoy; máximo 366 días; `to` nunca pasa de hoy. Incluye `summary` por estado. |

**Cómo se calcula el estado**, en este orden:

| Estado | Cuándo |
| --- | --- |
| `IMPORTADO` | Hay una importación vigente (`ACTIVE`) para ese local y día, aunque el día estuviera cerrado. |
| `CERRADO` | El local no abre ese día de la semana o tiene un cierre por excepción. Nunca es alerta. |
| `PENDIENTE` | Es hoy, el local abre y aún no hay Excel: informativo. |
| `ATRASADO` | Día abierto ya pasado sin importación vigente: alerta. |

No se informan los días futuros, los anteriores a `trackingStartDate`, los
locales inactivos ni los locales **sin calendario** (salvo sus días ya
importados): así un local recién creado no genera avisos hasta que el
administrador lo configure. Una importación `PENDING` (sin confirmar) no
resuelve el día; se informa como `pendingImportId`.

**Auditoría:** `STORE_OPERATING_CALENDAR_UPDATED` (días y fecha de inicio
nuevos y anteriores), `STORE_CLOSURE_CREATED` y `STORE_CLOSURE_DELETED` (fecha
y motivo).

## Registro diario de propinas (flujo anterior — histórico, modo lectura)

> **Reemplazado por la [Operación diaria](#operación-diaria-sprint-4r-t01-participantes-desde-sprint-4r-t03)
> (SPRINT-4R-T01).** Las lecturas (`GET /tips`, `GET /tips/:id`) se conservan
> para consultar el histórico por local y día; las escrituras (`POST`, `PATCH`,
> `DELETE`) ya no forman parte del flujo operativo vigente.

El CRUD histórico de propinas diarias usaba `tip_entries` como única fuente de
los repartos. `sales.tipAmount` se reconciliaba con un registro mediante
`sales.tipEntryId` y no se sumaba como una segunda fuente. El responsable se
obtenía siempre del JWT; el body no aceptaba `responsibleId` ni datos personales
del trabajador. El medio de pago se resolvía contra el catálogo
(`payment_methods`, ver
[Catálogo de medios de pago](#catálogo-de-medios-de-pago-sprint-4-t32)): al
crear se exigía medio activo y habilitado para propinas (`availableForTips`),
mientras que la lectura y el reintento idéntico seguían funcionando aunque el
medio se desactivara después, mostrando siempre su código y nombre.

| Endpoint | Roles | Descripción |
| --- | --- | --- |
| `POST /tips` | `SUPERVISOR`, `ADMINISTRADOR` | Crea con `storeId`, `businessDate` (`YYYY-MM-DD`), `paymentMethod` y `amount`. 201 al crear; un reintento idéntico responde 200 con el mismo registro y no duplica fila ni auditoría. Una clave igual con otro monto o responsable responde 409. |
| `GET /tips?storeId=<uuid>&businessDate=<fecha>` | `SUPERVISOR`, `ADMINISTRADOR`, `CONTADOR` | Lista los registros del local y día, ordenados por medio de pago. |
| `GET /tips/:id` | `SUPERVISOR`, `ADMINISTRADOR`, `CONTADOR` | Obtiene un registro por UUID. |
| `PATCH /tips/:id` | `SUPERVISOR`, `ADMINISTRADOR` | Corrige `amount`, conservando local, fecha, medio y responsable. |
| `DELETE /tips/:id` | `SUPERVISOR`, `ADMINISTRADOR` | Elimina un registro no vinculado y responde 204. |

Solo existe un registro por `(storeId, businessDate, paymentMethod)`. Los montos
son enteros en CLP (se acepta cero y el máximo de `DECIMAL(12,2)`); los valores
negativos o con centavos, fechas inexistentes y campos obligatorios vacíos
responden 400 identificando el campo. `SUPERVISOR` solo opera en su local
asignado; `CONTADOR` es de solo lectura y los roles globales pueden operar en
cualquier local según la tabla. Editar o eliminar un registro ya vinculado a
ventas o repartos responde 409 para proteger la trazabilidad. `PATCH` y `DELETE`
también exigen un local activo y bloquean la fila durante la mutación para evitar
que una venta o reparto se vincule entre la validación y la escritura.

Las mutaciones generan `TIP_ENTRY_CREATED`, `TIP_ENTRY_UPDATED` y
`TIP_ENTRY_DELETED` en auditoría. El detalle se limita a local, responsable,
fecha, medio y monto, sin correo, nombre, RUT ni contraseña.

## Alerta legal de pago de propinas (SPRINT-4A-T22)

Avisa las propinas diarias por trabajador (`daily_tip_allocations`,
SPRINT-4A-T03) que siguen **No pagadas** después de los días legales de pago.

| Endpoint | Roles | Descripción |
| --- | --- | --- |
| `GET /tip-payment-alerts` | `CONTADOR`, `ADMINISTRADOR` | `{ legalPaymentDays, asOf, overdueThrough, items, totals, calculatedAt }`. Cada elemento de `items` agrupa por local y trabajador las propinas vencidas: `store`, `worker`, `allocationCount` (días), `amount`, `oldestBusinessDate`, `newestBusinessDate`, `deadline` (límite de la más antigua) y `daysOverdue` (días corridos de atraso). Primero las de mayor atraso. `totals` resume cantidad de alertas, días, monto, fechas y mayor atraso. |

**Plazo.** `TIP_LEGAL_PAYMENT_DAYS` días hábiles (lunes a viernes, sin los
feriados de `TIP_ALERT_HOLIDAYS`) contados desde el día siguiente a la fecha
de negocio de la propina, en hora de Chile (`America/Santiago`). Por defecto
son **7**: el «séptimo día hábil» de la alerta legal original (SPRINT-3-T14),
que el PO mantiene; como por convenio se puede pactar pagar en más días, la
variable lo amplía sin cambiar código. Debe ser un entero entre 1 y 260; vacía
o ausente usa 7 y un valor inválido impide iniciar el backend. Está en
`.env.example` y `docker-compose.yml` la propaga al contenedor
(`${TIP_LEGAL_PAYMENT_DAYS:-7}`).

**Borde.** La alerta exige *más* días que el plazo: el día límite (`deadline`)
todavía está en plazo y la propina alerta desde el día siguiente
(`daysOverdue` 1). Con el plazo por defecto, una propina del viernes 2 de
octubre de 2026 vence el martes 13 y alerta desde el miércoles 14; si el plazo
vence un viernes, alerta desde el sábado. `overdueThrough` es la última fecha
de negocio vencida hoy: la consulta filtra `status = UNPAID` y
`business_date <= overdueThrough`.

**Resolución.** Al pagar el período con `POST /daily-tips/payment-batches`
(SPRINT-4A-T06) las propinas pasan a `PAID` y la alerta desaparece. No se
almacena como fila: se calcula en cada consulta. El panel de ventas
(`GET /sales-dashboard`) muestra el mismo cálculo por local
(`alerts.tipPayment`) y en total (`totals.tipPaymentAlerts`), con
`tipLegalPaymentDays`.

**Alertas anteriores.** Hasta SPRINT-4A-T22 la alerta se calculaba sobre los
registros diarios por medio `tip_entries` con tarjeta y solo se resolvía al
pagar un reparto por período, flujo retirado en SPRINT-4A-T08: ya no podían
resolverse. Esos registros dejaron de generar alertas; sus datos y tablas se
conservan como histórico de solo lectura.

El calendario de feriados se configura con `TIP_ALERT_HOLIDAYS`, una lista separada por
comas de feriados chilenos `YYYY-MM-DD` (sin comillas), por ejemplo:

```dotenv
TIP_ALERT_HOLIDAYS=2026-01-01,2026-05-01,2026-09-18,2026-12-25
```

Debe contener **todos** los feriados aplicables y actualizarse cada año según
el calendario oficial; el ejemplo es solo ilustrativo. Las fechas duplicadas se
ignoran y una fecha inexistente o con otro formato impide iniciar el backend
con un error de configuración. Un valor vacío calcula sin feriados. La variable
está documentada en `.env.example` y se propaga al contenedor mediante
`docker-compose.yml`.

## Catálogo de medios de pago (SPRINT-4-T32)

> Su uso en cierres, ventas manuales y registro de propinas por medio quedó
> histórico con SPRINT-4R-T01; hoy el catálogo clasifica las líneas de la
> [importación del Excel de MrComanda](#importación-diaria-de-ventas-sprint-4r-t10)
> mediante sus [alias](#alias-de-medios-de-pago-de-los-informes-sprint-4a-t20).

Los medios de pago viven en la tabla relacional `payment_methods`, única
fuente para ventas, propinas, líneas de cierre y clasificación de vouchers.
Reemplaza al enum fijo anterior: el `code` es estable e inmutable (contrato
operativo con el frontend y los DTO) y el resto de los atributos se administra
sin borrar historial — desactivar un medio no elimina ni oculta sus
movimientos pasados. Cada medio tiene `behavior` (`CASH`, `RECONCILABLE_CARD`,
`EXTERNAL_OTHER`) que decide su rol en el cierre y la conciliación, y
`availableForTips` para habilitarlo en propinas. El seed siembra los cuatro
medios iniciales (CASH, DEBIT_CARD, CREDIT_CARD, TRANSFER) por código, sin
revertir la administración posterior.

Las mutaciones son exclusivas del rol `ADMINISTRADOR` (403 para el resto):

| Endpoint | Descripción |
| --- | --- |
| `GET /payment-methods` | Lista el catálogo ordenado por `sortOrder`/código. Filtros opcionales `isActive` y `availableForTips`; sin filtros incluye inactivos. |
| `POST /payment-methods` | Crea un medio con `code` (UPPER_SNAKE, único e inmutable), `name`, `sortOrder`, `behavior` y `availableForTips`. 409 si el código ya existe. |
| `PATCH /payment-methods/:id` | Edita `name`, `sortOrder`, `behavior` y `availableForTips`; el código no se modifica. 400 si no hay campos que actualizar. |
| `PATCH /payment-methods/:id/deactivate` | Baja lógica: no admite cargas nuevas pero conserva su historial visible. Idempotente. |
| `PATCH /payment-methods/:id/reactivate` | Reactiva el medio. Idempotente. |

No existe borrado físico: las ventas, propinas, líneas y vouchers históricos
siguen referenciando el medio con su código y nombre. Los cambios se
serializan con bloqueo de fila y se auditan (`PAYMENT_METHOD_CREATED`,
`PAYMENT_METHOD_UPDATED`, `PAYMENT_METHOD_DEACTIVATED`,
`PAYMENT_METHOD_REACTIVATED`) sin registrar el cuerpo completo de la
solicitud.

### Alias de medios de pago de los informes (SPRINT-4A-T20)

Cada alias une una etiqueta del Excel de MrComanda con un medio del catálogo
(`payment_method_aliases`); con él la importación reconoce la línea sola. El
seed crea `EFECTIVO`, `T. DEBITO` y `T. CREDITO`. Exclusivo de `ADMINISTRADOR`:

| Endpoint | Descripción |
| --- | --- |
| `GET /payment-method-aliases` | Lista los alias ordenados por el orden del medio y la etiqueta. |
| `POST /payment-method-aliases` | `{ "label": "N.de Créd.", "paymentMethodId": "<uuid>" }`. La etiqueta se normaliza (mayúsculas, sin tildes, espacios colapsados) y es única: 409 si ya está asociada; 400 si el medio está inactivo. |
| `DELETE /payment-method-aliases/:id` | Quita el alias: la próxima carga con esa etiqueta pedirá elegir el medio. |

Las importaciones ya confirmadas nunca cambian al crear o quitar un alias. Se
auditan como `PAYMENT_METHOD_ALIAS_CREATED` y `PAYMENT_METHOD_ALIAS_DELETED`.

## Ingreso de ventas MrComanda (flujo anterior — histórico)

> **Fuera del flujo operativo desde SPRINT-4R-T01:** las ventas dejaron de
> capturarse (por el supervisor o por importación MrComanda) y ningún cálculo
> actual las utiliza. La descripción siguiente queda como referencia del
> comportamiento histórico; los datos cargados siguen consultables en modo
> lectura.

`POST /sales/mrcomanda` (ahora legado) registraba atómicamente los totales
**netos** del punto de venta por local, período y medio de pago, como ventas
agregadas con fuente `MRCOMANDA` (`tipAmount` siempre 0: PROPINAS conservaba su
fuente propia en `tip_entries`). El período debía venir con zona horaria
explícita y quedar dentro de un único día de negocio en Chile.

- El lote se serializa por local (bloqueo de la fila del local) y cada medio
  es independiente: el solape de uno no bloquea a otro.
- Un reintento idéntico no duplica: devuelve las ventas ya registradas con
  `created: false` y no se audita de nuevo. Un período solapado con contenido
  distinto responde 409.
- Lo conciliado es inmutable: el solapamiento con ventas ya vinculadas a un
  cierre `CLOSED` se rechaza (409); un cierre cerrado de otro turno del mismo
  día no bloquea cargas de períodos no solapados.
- Solo se cargan medios activos; los códigos se normalizan a mayúsculas y la
  respuesta expone código, nombre y neto por medio, sin mezclar cobro POS ni
  propinas.
- **No mezclar con ventas manuales del mismo corte**: los totales MrComanda
  agregan el período por medio, así que registrar además ventas manuales
  (`source` MANUAL) con `soldAt` dentro del mismo corte haría que el cierre
  de caja las sume dos veces (una como total agregado y otra como venta
  manual). Elige una sola fuente por corte.
- El ingreso efectivo se audita como `MRCOMANDA_SALES_IMPORTED` con local,
  período, si creó ventas y neto total.

## Cierre de caja por turno (flujo anterior — histórico, modo lectura)

> **Reemplazado por la [Operación diaria](#operación-diaria-sprint-4r-t01-participantes-desde-sprint-4r-t03)
> (SPRINT-4R-T01).** La doble captura por turno con conciliación y la foto de
> voucher del cierre quedaron fuera del flujo operativo: la diferencia de
> efectivo se declara una sola vez al día en la operación diaria. Los cierres,
> sus líneas, vouchers y vínculos a propinas se conservan íntegros y
> consultables (`GET /cash-closings/:id`); no se borran tablas, columnas ni
> datos históricos.

El flujo histórico cerraba por local, día de negocio y turno
(`UNIQUE(storeId, businessDate, shift)`). El supervisor declaraba lo contado por
medio en `lines` y adjuntaba los vouchers de respaldo; el sistema calculaba lo
esperado según las ventas del período y cerraba en una transición única
`OPEN → CLOSED`.

| Endpoint | Roles | Descripción |
| --- | --- | --- |
| `POST /cash-closings` | `SUPERVISOR` del local | Confirma el cierre: calcula líneas y diferencias, vincula ventas y propinas, guarda vouchers y responde 201 con el detalle completo. Un reintento idéntico responde 200 con el existente y no duplica fila ni auditoría; un cierre distinto para la misma clave responde 409 con el ID consultable. |
| `GET /cash-closings/:id` | `ADMINISTRADOR`, `SUPERVISOR`, `CONTADOR` | Detalle inmutable del cierre: líneas con código y nombre del medio, vouchers, fondo de propinas vinculado y estado de cuadre. |

Reglas del cálculo (`src/cash-closings/calculation/cash-closing.calculator.ts`):

- **Líneas requeridas dinámicas**: todos los medios activos del catálogo más
  cualquier medio (aunque esté inactivo) con ventas del período, ordenadas por
  `sortOrder`/código. Se rechazan líneas duplicadas, omitidas o no permitidas
  y ventas agregadas parcialmente fuera del corte.
- **Fondo de caja único**: `openingCash` se suma una sola vez, a la primera
  línea con comportamiento `CASH` (por `sortOrder`/código), aunque el catálogo
  tenga más de un medio CASH; las demás líneas esperan solo sus ventas.
- **Conciliación con vouchers**: los vouchers MrComanda nuevos deben indicar
  su medio; solo los clasificados `RECONCILABLE_CARD` alimentan
  `mrcomandaNetSales` (`Mercado Pago bruto − PROPINAS − T. DÉBITO/T. CRÉDITO
  MrComanda`). Junaeb, transferencias, la línea Mercado Pago de MrComanda y
  los vouchers históricos sin clasificación quedan fuera de esa suma para no
  contarse dos veces. Los vouchers Mercado Pago siguen guardando bruto y
  propina por separado.
- **Propinas**: el vínculo `tipEntryIds` es exacto y referencial: deben ser
  del mismo local y día y sumar exactamente `mercadoPagoTipAmount`; la propina
  nunca se suma a lo esperado de ninguna línea ni a la venta neta.
- **Estado de cuadre**: `hasDifferences`, `isBalanced` y `balanceStatus`
  (`CUADRADO`/`NO_CUADRADO`). Una diferencia distinta de cero en **cualquier
  línea** o en `reconciliationDifference` implica `NO_CUADRADO`, aunque las
  diferencias se compensen en el total.
- Con cualquier diferencia, `differenceReason` es obligatorio para cerrar
  (además de un CHECK en la base). La concurrencia se controla con la clave
  única, el reintento idempotente y la vinculación transaccional de ventas
  (`cashClosingId`), que impide usar una venta en dos cierres.

Un cierre `CLOSED` es inmutable: triggers rechazan modificar o eliminar el
cierre, sus líneas, vouchers, vínculos a propinas y ventas asociadas (para
cualquier rol y vía de escritura), y el `TRUNCATE` de las tablas involucradas.

## Panel y reportes de ventas, propinas y diferencias (SPRINT-4R-T13, SPRINT-4A-T11/T23)

Leen tres fuentes independientes y nunca las mezclan: las **ventas** salen solo
de la versión vigente (`ACTIVE`) del Excel de MrComanda, y las **propinas** con
tarjeta y en efectivo y la **diferencia de efectivo** (con signo y motivo, sin
compensar sobrantes con faltantes) salen de la operación diaria. La propina
nunca se suma a las ventas y no se infiere un descuadre del Excel. Sin Excel
vigente o sin operación diaria el dato es `null` (ausencia de datos), no 0.

| Endpoint | Roles | Descripción |
| --- | --- | --- |
| `GET /sales-dashboard?date=YYYY-MM-DD` | `ADMINISTRADOR` | Un día de negocio (por defecto hoy en Chile) por local: ventas por medio de pago del catálogo, estado de la importación (mismo cálculo de `GET /sales-days`), propinas, diferencia de efectivo, si la operación diaria tiene voucher (`hasVoucher`, SPRINT-4A-T11) y alertas vigentes hoy (`alertsAsOf`) de registro en la DT y de propinas diarias vencidas (`alerts.tipPayment`, `totals.tipPaymentAlerts`, con `tipLegalPaymentDays`). |
| `GET /sales-reports?from&to[&storeId]` | `ADMINISTRADOR`, `CONTADOR` (solo lectura, SPRINT-4A-T23) | Rango de hasta 366 días, de un local o de todos, con columnas dinámicas por medio de pago, propinas, sobrantes y faltantes totalizados por separado y la lista de diferencias con signo y motivo; cada operación indica `hasVoucher`. |
| `GET /sales-reports/legacy?from&to[&storeId]` | `ADMINISTRADOR`, `CONTADOR` | Histórico de solo lectura previo a SPRINT-4R-T01: cierres por turno con conciliación Mercado Pago y ventas de la tabla `sales`. No se mezcla con el reporte vigente. |

El voucher de cada operación se descarga con `GET /daily-operations/:id/voucher`
(`ADMINISTRADOR`, `CONTADOR` y el `SUPERVISOR` de su local), auditado como
`DAILY_OPERATION_VOUCHER_DOWNLOADED`. Así el contador contrasta la diferencia
de efectivo con las ventas por medio de pago del mismo día sin poder importar
ventas ni corregir la operación.

## Documentación interactiva (Swagger / OpenAPI)

La API genera su documentación OpenAPI con `@nestjs/swagger`:

- **Swagger UI:** `http://localhost:3001/api/docs` — permite explorar y probar
  los endpoints; para los protegidos, pegar el access token en **Authorize**
  (candado) con el esquema Bearer.
- **Esquema OpenAPI en JSON:** `http://localhost:3001/api/docs-json`.

Cada grupo (tag) tiene su descripción en `src/swagger.ts`; los de flujos
anteriores (`tip-pools`, `tips`, `cash-closings`) se identifican como
históricos de solo lectura. Las acciones retiradas del reparto por período
(`POST /tip-pools/preview`, `/:id/observations`, `/:id/confirm` y `/:id/pay`)
figuran como **obsoletas** (`deprecated`) y documentan solo su respuesta
`410 Gone`. `test/swagger-tip-sales-flow.spec.ts` verifica que cada endpoint
del flujo de propinas y ventas tenga resumen, descripción y JWT, y que solo
esas cuatro acciones estén obsoletas.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

Los tests de integración corren contra PostgreSQL real y se omiten si no se
define `TEST_DATABASE_URL` (debe ser un superusuario; ver
[Inmutabilidad del registro](#inmutabilidad-del-registro)). La base debe tener
las migraciones aplicadas y el seed base (roles y catálogo de medios de pago),
igual que el entorno de desarrollo:

```bash
TEST_DATABASE_URL="postgresql://postgres:cambiar-en-produccion@localhost:5433/subway_gestion" npm run test
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project:

```bash
$ npm install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/overview) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

### Consulta de reparto por local y período (SPRINT-3-T15)

`GET /tip-pools?storeId=<uuid>&periodStart=YYYY-MM-DD&periodEnd=YYYY-MM-DD`
consulta la foto guardada sin recalcular; desde SPRINT-4A-T08 los filtros son
opcionales (ver
[Repartos por período](#repartos-por-período-histórico-de-solo-lectura-sprint-4a-t08)).
Solo contador y administrador. Fechas inválidas, una sola fecha o período
invertido responden 400, otros roles 403. No cambia montos, versiones ni
estados.

### Constancias propias de propinas (SPRINT-3-T16)

`GET /my-tip-receipts` lista solo constancias propias de repartos PAID.
`GET /my-tip-receipts/:id/download` descarga su PDF con SHA-256 en
`X-Content-SHA256`. Según SPRINT-4-T02, ambas rutas son exclusivas de
`TRABAJADOR` y `SUPERVISOR`; `ADMINISTRADOR` y `CONTADOR` reciben 403.
Estos últimos conservan listado y descarga de otras personas desde
`/tip-pools/:id/receipts`. Las rutas personales fijan el
usuario desde el JWT; no aceptan filtros de identidad. Ajena, inexistente
o sin reparto pagado responde 404. Descarga auditada y sin caché. El PDF
se genera desde el snapshot de T13, conservando el historial de local.

## Productos de inventario (SPRINT-5-T03)

`/products` administra el catálogo de inventario y la estructura de la plantilla. Crear, editar, mover, desactivar y reactivar productos, corregir el texto de una fila y liberarla son del ADMINISTRADOR. El SUPERVISOR consulta los productos activos y la plantilla (`GET /products`, `GET /products/sections` y `GET /products/template`). CONTADOR y TRABAJADOR reciben 403.

| Endpoint | Rol | Descripción |
| --- | --- | --- |
| `GET /products` | ADMINISTRADOR, SUPERVISOR | Productos en el orden de la plantilla. Filtros `section`, `isActive`, `missingFormat`, `missingSku` y `search` (nombre, nombre alternativo o SKU, sin mayúsculas ni tildes). |
| `GET /products/sections` | ADMINISTRADOR, SUPERVISOR | Secciones con sus filas libres (artículos pendientes y «<Vacío>»). |
| `GET /products/template` | ADMINISTRADOR, SUPERVISOR | Las 182 filas en orden, cada una con su producto. Una fila de artículo sin producto es un artículo pendiente de crear. |
| `GET /products/template/suggestion` | ADMINISTRADOR | Fila sugerida para un producto nuevo (`section`, `name`, `alternativeNames`). |
| `POST /products` | ADMINISTRADOR | Crea el producto en la fila elegida (`templateRowId`) o en la sugerida. |
| `PATCH /products/:id` | ADMINISTRADOR | Edita nombre, nombres alternativos, unidad, SKU o formato, sin cambiar su fila. |
| `PATCH /products/:id/move` | ADMINISTRADOR | Mueve el producto a otra fila de artículo sin producto, de cualquier sección. |
| `PATCH /products/:id/deactivate` y `/reactivate` | ADMINISTRADOR | Desactiva o reactiva sin borrar. Un producto sin fila (liberada) no se reactiva: 409 hasta moverlo a una fila libre. |
| `PATCH /products/template/rows/:id` | ADMINISTRADOR | Corrige el texto de una fila de artículo sin producto. |
| `PATCH /products/template/rows/:id/release` | ADMINISTRADOR | Libera la fila de un producto desactivado para asignarla a otro. |

- **Formato:** unidad (`UNIT`, `KG`, `L`), nombre del paquete (`bolsa`, `paquete`, `botella` o `pack`), contenido por caja, paquetes por caja y contenido por paquete. Los contenidos son texto decimal mayor que 0, con hasta 3 decimales en KG y L y enteros en UNIT. El contenido por caja y el del paquete son independientes: no se exige que caja = paquetes × paquete (Pepperoni: caja de 7,3 kg y paquetes de 0,93 kg), y los paquetes por caja son solo informativos. «Solo cantidad suelta» no admite caja ni paquete.
- **Nombres únicos** (409), sin distinguir mayúsculas ni tildes: el nombre y cada nombre alternativo no pueden ser el nombre ni un alternativo de otro producto. Un alternativo vacío, repetido o igual al propio nombre responde 400. El SKU es opcional, lo entrega el proveedor, y es único (409).
- **Ubicación en la plantilla:** al crear se usa la fila elegida o la sugerida: la fila de artículo sin producto que coincide con el nombre o un alternativo; si no, la primera «<Vacío>» libre de la sección. Si no queda ninguna, 409 con `errors.templateRowId`: hay que reutilizar la fila de un artículo que ya no se usa. **Nunca se insertan, borran ni reordenan filas**, porque el Excel descargado se copia y se pega en otro cuadre.
- **Filas de la plantilla:** el texto de una fila de artículo sin producto se puede corregir, y la fila de un producto desactivado se puede liberar (el producto queda en el catálogo sin fila y, para reactivarlo, primero se mueve a una fila libre). Mover un producto a una fila de otra sección le cambia la sección, porque la sección sale de la fila. Ninguno de esos cambios modifica la posición de la fila. Renombrar un producto conserva su fila (Lata Coca Cola pasa a Lata Pepsi).
- **Desactivar no borra:** el producto conserva su fila y sus tomas, y deja de aparecer para el supervisor y en tomas nuevas. Las líneas de tomas guardan su propia copia del nombre, el SKU y el formato.
- **Errores por campo:** las validaciones de negocio responden `{ statusCode, message, errors }`, con un mensaje en español por campo para mostrarlo junto a él. Un `null` en un campo obligatorio del PATCH responde 400.
- **Auditoría:** `PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRODUCT_MOVED`, `PRODUCT_DEACTIVATED`, `PRODUCT_REACTIVATED`, `INVENTORY_TEMPLATE_ROW_UPDATED` e `INVENTORY_TEMPLATE_ROW_RELEASED`, con `detail.before` y `detail.after`. Una solicitud que no cambia nada no se audita.

## Toma de inventario (SPRINT-5-T05 y T06)

`/inventory-counts` es la toma de inventario semanal de cada local (martes en la noche o miércoles en la mañana). El SUPERVISOR inicia la toma de su local y guarda por producto las cajas, los paquetes y la cantidad suelta; el backend calcula el total. El SUPERVISOR también finaliza la toma de su local (SPRINT-5-T06), que desde ese momento no admite cambios. El ADMINISTRADOR consulta las tomas de todos los locales en solo lectura. CONTADOR y TRABAJADOR reciben 403.

| Endpoint | Rol | Descripción |
| --- | --- | --- |
| `POST /inventory-counts` | SUPERVISOR | Inicia la toma de **su** local (el local sale de la sesión; un `storeId` en el cuerpo responde 400). `countDate` opcional (AAAA-MM-DD): de hoy o de hasta 7 días atrás en hora de Chile (`MAX_COUNT_DATE_AGE_DAYS`, la toma es semanal); fuera de ese rango, 400 con `errors.countDate`. Por defecto, el día en curso. Si ya hay una En curso en el local, 409 con `existingCountId` y `existingCountDate` para retomarla. |
| `GET /inventory-counts` | ADMINISTRADOR, SUPERVISOR | Tomas por `storeId`, `status` (`OPEN` «En curso» o `CONFIRMED` «Finalizado») y rango `from`/`to` de la fecha de la toma (inclusive), de la más reciente a la más antigua. El SUPERVISOR solo ve su local (otro `storeId`, 403). |
| `GET /inventory-counts/:id` | ADMINISTRADOR, SUPERVISOR | La toma con sus productos en el orden de la plantilla: formato, lo contado (`line`) y lo pendiente (`counted: false`, `line: null`), más `totalProducts`, `countedProducts` y `pendingProducts`. `search` filtra por nombre, nombre alternativo o SKU sin mayúsculas ni tildes (los totales no dependen de la búsqueda). |
| `PUT /inventory-counts/:id/lines/:productId` | SUPERVISOR | Guarda lo contado de un producto en una toma En curso de su local. Guardar de nuevo el mismo producto reemplaza su línea. |
| `POST /inventory-counts/:id/finalize` | SUPERVISOR | Finaliza una toma En curso de su local con al menos un producto contado (sin ninguno, 400 con `errors.countId`). Responde 200 con la toma (`status: CONFIRMED`, `finalizedAt`, `finalizedBy`) más `countedProducts`, `uncountedProducts` y `totalProducts`. Ver [Finalización](#finalización-de-la-toma-sprint-5-t06). |
| `GET /inventory-counts/:id/export` | ADMINISTRADOR | Descarga `inventario-<local>-<DD-MM-AAAA>.xlsx` de una toma **finalizada** de cualquier local, con el formato de la plantilla impresa (En curso, 409 con `errors.countId`). Ver [Descarga en Excel](#descarga-en-excel-de-la-toma-sprint-5-t08). |

- **Total:** `cajas × contenido por caja + paquetes × contenido por paquete + cantidad suelta`, con aritmética decimal exacta (`Prisma.Decimal`, nunca float), sobre el formato vigente del producto, que la línea copia (SKU, nombre, unidad, nombre del paquete, contenidos, paquetes por caja y «solo cantidad suelta»). Editar después el producto no cambia la línea. Carne Fajita (caja de 5 kg, bolsa de 2,5 kg): 1 caja + 2 bolsas + 0,300 kg = `10.300`; 1 caja + 3 bolsas + 2,450 kg = `14.950`. Sobre Eliminador de Sarro (caja de 48): 1 caja + 6 = `54`. Las cantidades se devuelven como texto decimal exacto: enteras en `UNIT` y con 3 decimales en `KG` y `L`.
- **Cantidades:** `boxes` y `packages` son enteros ≥ 0 (los paquetes no se limitan a los que trae una caja); `looseQuantity` es ≥ 0, con hasta 3 decimales y punto en `KG` y `L` y entera en `UNIT` (enviarla siempre como texto, `"0.300"`: un número JSON se lee por su texto, pero un cálculo en float del cliente como `0.1 + 0.2` se rechaza por tener más de 3 decimales). Un campo que no aplica se omite o va en `null`; hay que informar al menos uno (0 es un conteo válido). Se rechaza con 400 y errores por campo (`{ statusCode, message, errors }`): cajas en un producto sin contenido por caja, paquetes en uno sin contenido por paquete, cajas o paquetes en uno «solo cantidad suelta» (aunque sean 0), negativos, no numéricos, decimales en cajas o paquetes, más de 3 decimales o decimales en `UNIT`.
- **Quién y cuándo:** cada guardado asigna `saved_by_id` con el usuario de la sesión y la base pone `saved_at`. Los guardados de una toma se serializan con el mismo bloqueo `FOR NO KEY UPDATE` que toma el trigger de las líneas.
- **Productos de la toma:** una toma En curso muestra los productos activos (todos tienen fila en la plantilla) más los que ya tengan línea en ella aunque después se hayan desactivado, para no esconder lo contado; los que no tienen fila van al final, por nombre. Una toma finalizada muestra solo sus líneas. Un producto desactivado solo se puede guardar si ya tenía línea en esta toma (para corregirla); si no, 409 con `errors.productId`. Una toma finalizada no admite cambios: 409 con `errors.countId`. No hay endpoint para borrar una línea. Una toma finalizada muestra todas sus líneas, también las vacías que agregó la finalización (`counted: false`).
- **Fecha fija:** `count_date` se fija al iniciar y no cambia aunque la toma se finalice después de medianoche.
- **Conflictos (409):** todos responden `{ statusCode, message, errors }`. El de inicio agrega `existingCountId` y `existingCountDate`; si dos inicios simultáneos chocan en el índice único y la otra toma ya no existe, responde 409 con `errors.store` para reintentar (nunca 500).
- **Auditoría:** `INVENTORY_COUNT_STARTED` (local, responsable y `detail.countDate`) e `INVENTORY_COUNT_FINALIZED` (local, quién finalizó y `detail` con `countDate`, `countedProducts` y `uncountedProducts`). Guardar líneas no se audita: cada línea registra quién la guardó y cuándo. Los 403 quedan como `ACCESS_DENIED`.

### Finalización de la toma (SPRINT-5-T06)

`POST /inventory-counts/:id/finalize` cierra la toma. Solo la finaliza un SUPERVISOR del local de la toma (cualquiera del local, no solo quien la inició); otro local, el ADMINISTRADOR, CONTADOR o TRABAJADOR reciben 403.

- **Requisito:** al menos un producto contado; si no, 400 «La toma no tiene productos contados» con `errors.countId`.
- **Quién y cuándo:** `finalized_by_id` es el usuario de la sesión y `finalized_at` la fecha-hora de la finalización.
- **Productos sin contar:** quedan sin cantidades. La finalización agrega una línea vacía (cajas, paquetes, cantidad suelta y total en NULL) por cada producto **activo** que no tenga línea, con la copia de su SKU, nombre, unidad y formato; `saved_by_id` es quien finalizó. Los desactivados sin línea no se agregan. La respuesta informa `countedProducts` (con cantidades), `uncountedProducts` (sin cantidades) y `totalProducts` (líneas de la toma).
- **Copia de la plantilla:** `template_snapshot` guarda las filas de la plantilla en el orden de la hoja (`position`, `kind`, `printedText`, `section`, `productId` y `productName`). Con esa copia y la de cada línea, el Excel de la toma finalizada no cambia aunque después se edite el catálogo o la plantilla; cambiar el formato de un producto tampoco cambia los totales, que se calcularon (y se recalculan) con la copia del formato de la línea.
- **Bloqueo de cambios:** desde ese momento guardar una línea o finalizar de nuevo responde 409 «La toma de inventario está finalizada» (`errors.countId`). No hay endpoint para borrar líneas; la base rechaza cualquier INSERT, UPDATE o DELETE sobre las líneas y cualquier UPDATE o DELETE sobre la toma finalizada (triggers, SQLSTATE `42501`).
- **Toma nueva:** al finalizar, el local queda sin toma En curso y puede iniciar otra.
- **Concurrencia:** todo ocurre en una transacción que empieza con `SELECT … FROM inventory_counts WHERE id = $1 FOR UPDATE`, antes de insertar las líneas vacías: dos finalizaciones (o una finalización y un guardado) se serializan y la que llega tarde ve la toma finalizada y responde 409, sin líneas duplicadas. Luego toma el bloqueo compartido del catálogo (`pg_advisory_xact_lock_shared`, el mismo que usan en exclusivo los cambios de productos y de la plantilla), para copiar la plantilla y los productos activos sin que un cambio del catálogo se cruce. Si aun así la base rechaza la escritura —el trigger por una toma ya finalizada (SQLSTATE `42501`, que Prisma entrega como `P2039` con el código en `meta.driverAdapterError.cause.originalCode`), un deadlock (`40P01`) o un conflicto de transacción (`P2034`)— la API responde 409, nunca 500. La lectura de esos códigos está en `src/prisma/utils/database-error.util.ts`, compartida con la operación diaria.
- **Pruebas:** `test/inventory-counts-api.integration.spec.ts` (flujo por HTTP dentro de `withinRollback`) y `test/inventory-count-finalize-concurrency.integration.spec.ts` (dos finalizaciones en paralelo, y una finalización con un guardado, con transacciones reales).

### Descarga en Excel de la toma (SPRINT-5-T08)

`GET /inventory-counts/:id/export` descarga la toma finalizada como `inventario-<local>-<fecha de la toma>.xlsx` (local en slug sin tildes, espacios ni caracteres que rompan `Content-Disposition`; fecha DD-MM-AAAA), con `Cache-Control: private, no-store`. Es **exclusiva del ADMINISTRADOR** (de cualquier local); SUPERVISOR, CONTADOR y TRABAJADOR reciben 403. Una toma En curso responde 409 (`errors.countId`): su contenido todavía puede cambiar.

- **Una sola hoja, «Inventario»:** replica la plantilla impresa (`docs/plantilla-inventario.xlsx`): encabezado en la fila 1 y cada fila de `template_snapshot` en su misma posición (la fila N del Excel es la posición N), incluidas las `<Vacío>`, las sin texto y las de sección. El PO copia el Excel y lo pega en su cuadre, así que un desplazamiento de una sola fila lo rompe.

  | Columna | Encabezado | Contenido |
  | --- | --- | --- |
  | A | ARTÍCULO | Nombre del producto al contarse (copia de la línea), o el texto de la fila si no tiene producto |
  | B | BULTO (CAJA) | Cajas contadas |
  | C | BULTO RESTANTE (KG-LTRS) | Cajas × contenido por caja |
  | D | PAQUETE (…) | Paquetes contados |
  | E | UNIDAD RESTANTES (KG-LTRS) | Paquetes × contenido por paquete |
  | F | LINEA Y UNIDADES (PESOS) | Cantidad suelta |
  | G | RESTANTES (WISR CHILE) | Total contado (C + E + F) |

  Las cantidades son celdas numéricas calculadas con `Prisma.Decimal` sobre la copia del formato de cada línea. Igual que la plantilla en blanco, en las filas de artículo y `<Vacío>` sin contar B, D y F quedan vacías y C, E y G en 0; las filas sin texto y las de sección no llevan números. Los productos «solo cantidad suelta» (los «(Preparado)») dejan C y E vacías y van con A, B, C, D y E en gris, como en la plantilla. Ejemplos: Carne Fajita con 1 caja, 3 bolsas y 2,450 kg queda con B=1, C=5, D=3, E=7,5, F=2,45 y G=14,95; Sobre Eliminador de Sarro con 1 caja de 48 y 6 sueltos, con G=54. Los productos contados que ya no tenían fila en la plantilla al finalizar van al final, cerrados por la fila «PRODUCTOS SIN FILA EN LA PLANTILLA».
- **Estilo:** el de la plantilla (alto 50 en el encabezado y 17,25 en las filas, anchos de columna, encabezado negro con texto blanco en negrita, C y E en gris, G en naranja `FFC000` en el encabezado y amarillo `FFE285` en negrita en las filas), en Arial (la plantilla mezcla Open Sans y Arial), con bordes finos verticales y punteados entre filas de un grupo, kg y l con formato `0,000`, e impresión vertical ajustada a una hoja de ancho (`fitToWidth`, agregado al XML de la hoja porque `write-excel-file` no lo expone). Pendiente con el PO: las secciones van todas en negro (en la plantilla, la 45 y la 183 son gris oscuro) y los bordes entre grupos van finos como en la plantilla (la tarjeta dice «medios»). Única diferencia de contenido con la plantilla en blanco: la fila 20 (`<Vacío>` junto a los «(Preparado)») lleva C y E en 0 y sin gris, porque una fila sin producto no sabe si será «solo cantidad suelta».
- **Inmutable:** el archivo se arma solo con las copias de la finalización (`template_snapshot` y la copia del producto en cada línea): no cambia aunque después se edite el catálogo o la plantilla. Si la copia de la plantilla está dañada (forma inválida, posición repetida o mayor a 1000), responde 500 y lo registra en el log con el ID de la toma.
- **Librería:** `write-excel-file`, la misma del Excel de propinas (ver `src/tips/export/daily-tips-xlsx.writer.ts`); el contenido lo arman funciones puras en `src/inventory/export/inventory-count-workbook.ts`.
- **Auditoría:** `INVENTORY_COUNT_EXPORTED` (local, quién descargó y `detail` con `countDate`, `countedProducts` y `uncountedProducts`, sin cantidades).
- **Pruebas:** `src/inventory/export/inventory-count-workbook.spec.ts` (contenido de la hoja con una plantilla corta), `test/inventory-count-workbook-template.spec.ts` (con la plantilla real: 182 filas, Carne Fajita en la fila 4, secciones en 45, 88, 141, 162 y 183, casos Fajita y Sarro, y comparación de valores, rellenos, negritas, altos y anchos contra `docs/plantilla-inventario.xlsx`) y `test/inventory-count-export.integration.spec.ts` (descarga por HTTP contra PostgreSQL con la plantilla real, permisos e inmutabilidad).
