# Plan de pruebas — Sprint 1 (E1-H1 y E1-H2)

**SPRINT-1-T25 · Plan de pruebas de E1-H1 y E1-H2**
**Responsable:** Luis Hernández (Documentación y Pruebas)
**Se ejecuta en:** SPRINT-1-T17 (E1-H1) y SPRINT-1-T18 (E1-H2)
**Resultados en:** informe de resultados de pruebas (SPRINT-1-T26)

## 1. Objetivo

Verificar que el incremento del Sprint 1 cumple los criterios de aceptación de las historias E1-H1 y E1-H2 antes del Sprint Review.

## 2. Alcance

| Incluye | No incluye |
|---|---|
| Pruebas funcionales de la API mediante Swagger | Pruebas de carga y rendimiento |
| Pruebas de interfaz: login, gestión de usuarios y auditoría | Pruebas de seguridad avanzadas (pentesting) |
| Verificación de la inmutabilidad directamente en PostgreSQL | Módulos de sprints futuros |

Las pruebas automáticas (unitarias y de integración, Vitest) se ejecutan en cada PR según la Definition of Done. Este plan cubre las **pruebas de aceptación manuales**.

## 3. Ambiente de pruebas

| Elemento | Valor |
|---|---|
| Levantamiento | `docker compose up --build` desde `Fase 2/Evidencias Proyecto/Evidencias de sistema Aplicación` |
| Frontend | http://localhost:3000 |
| API | http://localhost:3001 |
| Swagger | http://localhost:3001/api/docs (botón **Authorize** para pegar el token) |
| Base de datos | PostgreSQL 16, BD `subway_gestion`, puerto 5433 del host |
| Consola SQL | `docker exec -it subway_db psql -U postgres -d subway_gestion` |
| Usuario administrador | `admin@moi-food.cl` / contraseña `ADMIN_PASSWORD` del `.env.example` |

### Datos de prueba

| Dato | Cómo se prepara |
|---|---|
| Local A y Local B activos | Requiere el seed de locales (pendiente, acordado el 05-10). Mientras no exista, se insertan por SQL en la tabla `stores` |
| Usuario TRABAJADOR del Local A | Se crea en CP-01 |
| Usuario SUPERVISOR del Local B | `POST /users` como administrador |
| Usuario CONTADOR (rol global, sin local) | `POST /users` como administrador |

## 4. Criterio de aprobación

- Un **caso** aprueba si el resultado obtenido coincide con el esperado.
- Un **criterio de aceptación** aprueba si todos sus casos aprueban.
- Cada caso deja **evidencia** en `evidencias/CP-XX.png`: captura de Swagger, de la interfaz o de la consola SQL.

## 5. Casos de prueba — E1-H1 Gestión de usuarios y roles

### Criterio 1: creación de usuario con rol

| ID | Caso | Pasos | Resultado esperado |
|---|---|---|---|
| CP-01 | Crear usuario de local | Como ADMINISTRADOR, `POST /users` con rol TRABAJADOR, Local A, RUT válido y contraseña inicial | `201`; el usuario aparece en `GET /users` con su rol y local, sin el hash de la contraseña |
| CP-02 | Correo duplicado | Repetir CP-01 con el mismo correo | `409 Conflict` |
| CP-03 | RUT inválido | `POST /users` con dígito verificador incorrecto | `400 Bad Request` |
| CP-04 | Rol global con local | `POST /users` con rol CONTADOR y un local asignado | `400 Bad Request`: los roles globales no llevan local |
| CP-05 | Rol de local sin local | `POST /users` con rol TRABAJADOR y sin local | `400 Bad Request` |
| CP-06 | Solo el administrador crea usuarios | Con token de TRABAJADOR, `POST /users` | `403 Forbidden` |
| CP-07 | Crear usuario desde la interfaz | En el frontend, como ADMINISTRADOR, crear un usuario con rol y local | El usuario aparece en el listado de la interfaz |

### Criterio 2: acceso limitado por rol con redirección

| ID | Caso | Pasos | Resultado esperado |
|---|---|---|---|
| CP-08 | Login correcto | `POST /auth/login` con credenciales del administrador | `200` con access token y refresh token |
| CP-09 | Login incorrecto | `POST /auth/login` con contraseña errónea | `401` con mensaje genérico, que no indica si falló el correo o la contraseña |
| CP-10 | Sin token | `GET /auth/me` sin encabezado Authorization | `401 Unauthorized` |
| CP-11 | Rol sin permiso | Con token de TRABAJADOR, `GET /users` | `403 Forbidden` |
| CP-12 | Restricción por local | Ejecutar los tests de la política `canAccessStore` y de `StoreAccessGuard` (`npm run test`) | Tests en verde: un usuario de local solo opera sobre su local; ADMINISTRADOR y CONTADOR son globales |
| CP-13 | Rotación de refresh token | `POST /auth/refresh` con un refresh token y luego reutilizar el mismo token | Primer uso `200` con tokens nuevos; reuso `401` |
| CP-14 | Redirección del administrador | Iniciar sesión en el frontend como ADMINISTRADOR | Llega al panel de administración |
| CP-15 | Redirección de otros roles | Iniciar sesión en el frontend como TRABAJADOR | Llega a la vista que corresponde a su rol |
| CP-16 | Ruta protegida | Sin sesión, abrir directamente una ruta interna del frontend | Redirige al login |

> **CP-12:** en el Sprint 1 ningún endpoint opera aún sobre datos de un local específico. La restricción por local se verifica con los tests automáticos de T07 y se probará por API cuando existan endpoints con `@StoreScoped()` (Sprint 2).

### Criterio 3: desactivación sin eliminar datos

| ID | Caso | Pasos | Resultado esperado |
|---|---|---|---|
| CP-17 | Desactivar usuario | Como ADMINISTRADOR, `PATCH /users/:id/deactivate` sobre el TRABAJADOR | `200`; en `GET /users?isActive=false` el usuario sigue existiendo con todos sus datos |
| CP-18 | Login bloqueado | El usuario desactivado intenta `POST /auth/login` | `401` |
| CP-19 | Sesión revocada | Usar el refresh token que el usuario tenía antes de la desactivación | `401` |
| CP-20 | Idempotencia | Desactivar de nuevo al mismo usuario | Sin error y sin cambios adicionales |
| CP-21 | No autodesactivarse | El ADMINISTRADOR intenta desactivar su propia cuenta | `400` con el mensaje "No puedes desactivar tu propia cuenta" |

## 6. Casos de prueba — E1-H2 Auditoría de operaciones críticas

Operaciones auditadas en el Sprint 1: `USER_LOGIN`, `USER_LOGIN_FAILED`, `USER_CREATED` y `USER_DEACTIVATED`.

### Criterio 1: consulta por local y fecha

| ID | Caso | Pasos | Resultado esperado |
|---|---|---|---|
| CP-22 | Auditoría de login | Hacer un login exitoso y uno fallido; `GET /audit-logs` | Un registro `USER_LOGIN` y uno `USER_LOGIN_FAILED`, con usuario, IP, user-agent y fecha |
| CP-23 | Auditoría de usuarios | Crear y desactivar un usuario; `GET /audit-logs` | Un registro `USER_CREATED` y uno `USER_DEACTIVATED`; el detalle **no** contiene contraseñas |
| CP-24 | Filtro por local | `GET /audit-logs?storeId=<id Local A>` | Solo registros del Local A |
| CP-25 | Filtro por fecha | `GET /audit-logs?from=2026-10-01&to=2026-10-31` | Solo registros dentro del rango |
| CP-26 | Formato de fecha inválido | `GET /audit-logs?from=01-10-2026` | `400` con el mensaje "from debe tener el formato YYYY-MM-DD" |
| CP-27 | Acceso restringido | Con token de TRABAJADOR, `GET /audit-logs` | `403 Forbidden`: solo el ADMINISTRADOR consulta la auditoría |
| CP-28 | Vista en el frontend | Abrir la vista de auditoría y aplicar los filtros por local y fecha | La tabla muestra los mismos registros que la API |

### Criterio 2: inmutabilidad del registro

| ID | Caso | Pasos | Resultado esperado |
|---|---|---|---|
| CP-29 | Sin modificación por API | Intentar `PUT`, `PATCH` y `DELETE` sobre `/audit-logs` | `404`: la API no expone esas operaciones |
| CP-30 | UPDATE directo en la BD | En psql: `UPDATE audit_logs SET action = 'X' WHERE id = <id>;` | Error: "El registro de auditoría es inmutable: no se permite UPDATE sobre audit_logs" |
| CP-31 | DELETE directo en la BD | En psql: `DELETE FROM audit_logs WHERE id = <id>;` | Error: "El registro de auditoría es inmutable: no se permite DELETE sobre audit_logs" |
| CP-32 | TRUNCATE en la BD | En psql: `TRUNCATE audit_logs;` | Error de inmutabilidad: la tabla no se vacía |
| CP-33 | Inserción permitida | Realizar un login después de CP-30 a CP-32 | El nuevo registro se guarda normalmente |

> Para CP-30 y CP-31 se obtiene un `id` real con `SELECT id FROM audit_logs LIMIT 1;`. La protección la implementan los triggers de la migración `20261005194938_auditoria_inmutable` (T15), que aplican a cualquier vía de acceso: Prisma, SQL directo o cascadas.

## 7. Trazabilidad con los criterios de aceptación

| Historia | Criterio | Casos |
|---|---|---|
| E1-H1 | 1. Creación de usuario con rol | CP-01 a CP-07 |
| E1-H1 | 2. Acceso limitado por rol con redirección | CP-08 a CP-16 |
| E1-H1 | 3. Desactivación sin eliminar datos | CP-17 a CP-21 |
| E1-H2 | 1. Consulta por local y fecha | CP-22 a CP-28 |
| E1-H2 | 2. Inmutabilidad del registro | CP-29 a CP-33 |

## 8. Dependencias para la ejecución

| Dependencia | Casos afectados | Estado al 07-10 |
|---|---|---|
| Seed de locales y endpoint `GET /stores` | CP-01, CP-05, CP-07, CP-24 | Acordado el 05-10; mientras tanto, locales insertados por SQL |
| Frontend de login y usuarios (PR #10, T09–T11) | CP-07, CP-14, CP-15, CP-16 | En revisión, con cambios solicitados |
| Vista de auditoría en frontend (T16) | CP-28 | Por hacer |
| Backend de auditoría (T13, T14, T15) | CP-22 a CP-27, CP-29 a CP-33 | Integrado en `main`; listo para probar |
