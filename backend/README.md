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

El modelo de datos completo (6 módulos, 23 tablas) está documentado en
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
# tipos de documento laboral, tres locales iniciales y administrador inicial.
# Idempotente; no revierte los cambios administrativos de los locales ni carga
# datos demo en producción (SEED_DEMO_DATA=false por defecto).
$ npm run prisma:seed

# opcional, solo desarrollo/pruebas: agrega usuarios, pacto, horas, entradas
# y un reparto completamente sintéticos del módulo de propinas.
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
| `POST /stores` | Crea un local activo con `name`, `city` y `address`. Recorta y colapsa espacios; responde 409 si el nombre ya existe, ignorando mayúsculas, tildes y espacios repetidos. |
| `PATCH /stores/:id` | Edita uno o más de esos campos y aplica las mismas validaciones; `null` responde 400. |
| `PATCH /stores/:id/deactivate` | Desactiva el local sin borrar su historial. Responde 409 si tiene usuarios activos asignados; es idempotente si ya estaba inactivo. |
| `PATCH /stores/:id/reactivate` | Reactiva el local para permitir asignaciones y operaciones nuevas; es idempotente si ya estaba activo. |

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

El detalle se arma solo con campos declarados (listas blancas): nunca incluye contraseñas ni el contenido de los archivos.

### Inmutabilidad del registro

Una operación registrada no se puede modificar ni eliminar (criterio 2 de E1-H2):

- **API:** no existe ninguna ruta de escritura sobre `/audit-logs` (`PUT`, `PATCH` y `DELETE` responden 404).
- **Base de datos:** la migración `auditoria_inmutable` instala triggers que rechazan `UPDATE`, `DELETE` y `TRUNCATE` sobre `audit_logs` para cualquier rol (incluido el dueño de la tabla) y cualquier vía (Prisma, SQL directo o cascadas), con el error *"El registro de auditoría es inmutable"*.
- **Llaves foráneas:** `audit_logs.user_id` y `audit_logs.store_id` son `ON DELETE RESTRICT`: un usuario o local con historial no se puede borrar. Para el derecho de cancelación (Ley N°21.719) el usuario se anonimiza (`anonymized_at`), lo que conserva la fila y su trazabilidad.

Los triggers solo se omiten con `session_replication_role = replica`, que exige superusuario (mantenimiento de la base de datos). Los tests de integración que ejercitan la API por HTTP lo usan para purgar sus propios registros (`test/helpers/audit-cleanup.ts`), por lo que `TEST_DATABASE_URL` debe conectarse con un superusuario, como el `postgres` de docker compose.

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

## Registro diario de propinas

El CRUD de propinas diarias usa `tip_entries` como única fuente de los repartos.
`sales.tipAmount` se reconcilia con un registro mediante `sales.tipEntryId` y no
se suma como una segunda fuente. El responsable se obtiene siempre del JWT;
el body no acepta `responsibleId` ni datos personales del trabajador.

| Endpoint | Roles | Descripción |
| --- | --- | --- |
| `POST /tips` | `SUPERVISOR`, `ADMINISTRADOR` | Crea con `storeId`, `businessDate` (`YYYY-MM-DD`), `paymentMethod` y `amount`. 201 al crear; un reintento idéntico responde 200 con el mismo registro y no duplica fila ni auditoría. Una clave igual con otro monto o responsable responde 409. |
| `GET /tips?storeId=<uuid>&businessDate=<fecha>` | `SUPERVISOR`, `ADMINISTRADOR`, `CONTADOR` | Lista los registros del local y día, ordenados por medio de pago. |
| `GET /tips/:id` | `SUPERVISOR`, `ADMINISTRADOR`, `CONTADOR` | Obtiene un registro por UUID. |
| `PATCH /tips/:id` | `SUPERVISOR`, `ADMINISTRADOR` | Corrige `amount`, conservando local, fecha, medio y responsable. |
| `DELETE /tips/:id` | `SUPERVISOR`, `ADMINISTRADOR` | Elimina un registro no vinculado y responde 204. |

Solo existe un registro por `(storeId, businessDate, paymentMethod)`. Los montos
aceptan cero, hasta dos decimales y el máximo de `DECIMAL(12,2)`; los negativos,
fechas inexistentes y campos obligatorios vacíos responden 400 identificando el
campo. `SUPERVISOR` solo opera en su local asignado; `CONTADOR` es de solo
lectura y los roles globales pueden operar en cualquier local según la tabla.
Editar o eliminar un registro ya vinculado a ventas o repartos responde 409 para
proteger la trazabilidad.

Las mutaciones generan `TIP_ENTRY_CREATED`, `TIP_ENTRY_UPDATED` y
`TIP_ENTRY_DELETED` en auditoría. El detalle se limita a local, responsable,
fecha, medio y monto, sin correo, nombre, RUT ni contraseña.

## Documentación interactiva (Swagger / OpenAPI)

La API genera su documentación OpenAPI con `@nestjs/swagger`:

- **Swagger UI:** `http://localhost:3001/api/docs` — permite explorar y probar
  los endpoints; para los protegidos, pegar el access token en **Authorize**
  (candado) con el esquema Bearer.
- **Esquema OpenAPI en JSON:** `http://localhost:3001/api/docs-json`.

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
[Inmutabilidad del registro](#inmutabilidad-del-registro)):

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
