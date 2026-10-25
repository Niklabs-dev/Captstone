> Actualización SPRINT-3-T02: el catálogo estático descrito en esta documentación histórica fue reemplazado por GET /stores. Consultar docs/SPRINT-3-T02.md.

# SPRINT-1-T16 — Auditoría consultable con filtros

## Alcance

La tarea exportada de Notion pide una tabla de auditoría con filtros por local
y rango de fechas, visible solo para dueño/administrador (E1-H2, 4 horas).
El backend representa ese permiso con el rol ADMINISTRADOR.

Se implementa `/admin/auditoria` y acceso desde el dashboard administrador.
La página consulta datos reales de `GET /audit-logs` en NestJS.
Tabla paginada de 25 registros por defecto; filtros de días inclusivos de Chile,
límites opcionales, validación de fechas inexistentes y rangos invertidos.
Los filtros quedan en la URL, se conservan al paginar y se reinician al limpiar.
Los estados de carga, error y ausencia de resultados son explícitos.

La vista adapta logo, Inter/JetBrains Mono, colores, barra lateral y tarjetas
del mockup de Fase 1. El mockup presenta un log lateral junto a usuarios;
la tabla responde al criterio concreto de T16. No se copian eventos de ejemplo,
datos de usuarios ni afirmaciones de hashes encadenados: el backend no expone
esa cadena criptográfica. El identificador de la tabla es el ID del registro.

## Seguridad y contratos

- Server Components para filtros/tabla; SessionActions conserva su interactividad.
- JWT en cookies HttpOnly; no se pasan tokens como props de componentes cliente.
- Proxy de T11 y comprobaciones propias en página/API; trabajador al portal,
  contador/supervisor al dashboard. Las API devuelven 401/403, sin redirección HTML.
- Se verifica el estado activo y el rol actual del administrador con `GET /users`.
  Un JWT emitido antes de desactivar la cuenta no permite consultar T16.
- `GET /api/audit-logs` valida UUID, fechas, duplicados y paginación
  (limit 1–200, offset entero seguro no negativo).
- Respuestas sin caché; llamadas al backend con timeout y rechazo de redirects.
- Proyección explícita del contrato: no se envían detail, IP, user-agent
  ni propiedades adicionales del backend.
- No hay métodos de mutación ni controles para editar/eliminar registros.
- Las operaciones siguen sujetas a JWT/RBAC de NestJS. No se modifica
  lógica del backend, schema, migraciones ni triggers de inmutabilidad.

El backend mantiene su limitación general de access tokens previos a
desactivación en otros endpoints. T16 agrega la comprobación actual únicamente
a su módulo; no afirma resolver la revocación global de JWT.

## Catálogo y dependencias

No existe un endpoint de locales en el backend actual. El selector deriva
locales de todos los usuarios devueltos por la API y de la página de auditoría.
`AUDIT_STORES` permite completar locales sin usuarios y sin registros en la
página actual. Debe contener la lista de UUID/nombres reales del despliegue.
Configuración inválida produce error explícito y no consulta resultados.
Un UUID válido en la URL también permite consultar un local fuera del selector.

T09, T11 y T10 ya están integradas en main 89877cd. La rama de T16 incorpora ese main mediante merge, conservando su historial y el PR #20 separado, con base main.

## Validación

- 12 unitarias nuevas: filtros/fechas, UUID/paginación, contrato/proyección,
  horarios verano/invierno, catálogo, estado de administrador y errores.
- Regresión: 13 unitarias de autenticación y 5 de navegación.
- Integración HTTP de auditoría: cuatro roles, contratos inválidos, parámetros
  rechazados, XSS escapado, proyección, paginación, errores y cuenta inactiva.
- Regresión de integración HTTP de autenticación.
- Playwright: cinco escenarios por escritorio/móvil (10 ejecuciones),
  contra Next.js, NestJS y PostgreSQL reales, con navegador en UTC.
- Datos sintéticos solo en `capstone-sprint1-t16`. Dos locales y 36 eventos,
  conservados por inmutabilidad; cuentas ficticias desactivadas al finalizar.

Resultado aprobado: 30 unitarias, 2 integraciones HTTP y 10 escenarios de navegador (33,1 segundos en la ejecución final). Lint y formato de ambos proyectos, build local y build Docker aprobados. Las cuatro migraciones y seed se ejecutaron en el volumen exclusivo. Se revisó la captura de escritorio y se comprobó que la tabla no desborda la página móvil. Limpiar reinicia también campos editados sin aplicar filtros. Las 40 cuentas ficticias de las ejecuciones quedaron desactivadas y los 36 eventos permanecen solo en el volumen de pruebas.

La validación Docker utilizó el backend de main c5eaf43; audit/auth/users no difieren de T11. La entrega conserva únicamente el cambio de T16 sobre su dependencia, sin incluir los cambios de documentación/modelo de main.

## Seguimiento

En revisión (registro local). PR: https://github.com/Niklabs-dev/Captstone/pull/20. Revisor solicitado: Niklabs-dev. Commit de implementación: 2c6c2a3. La integración no tiene acceso al tablero compartido
de Notion; no se ha actualizado allí ningún estado.
No se marca Hecho ni se fusiona el PR sin confirmación de revisión.


## Compatibilidad con la revisión del 13 de octubre

Rama reubicada sobre T11 corregido, manteniendo el diff exclusivamente en T16. Commit de implementación vigente: 7b1017d (los hashes anteriores son históricos). Se aprobaron nuevamente build Docker, lint, formato, 12 unitarias de auditoría, integración HTTP de auditoría y regresión HTTP de autenticación. Se conservan las diez ejecuciones de navegador aprobadas en la entrega original; no se atribuyen a esta revisión. PR #20 sigue pendiente de revisión.

## Correcciones de revisión — 15 de octubre de 2026

Merge de origin/main (89877cd) en la rama existente, sin rebase ni force push.
Se resolvieron exactamente tres conflictos: docker-compose.yml conserva
USER_MANAGEMENT_STORES y AUDIT_STORES; package.json conserva test:users* y
test:audit*; .env.example conserva ambos bloques y elimina el comentario huérfano.
El script test:audit:integration compila con npm run build antes de probar.

Usuarios y auditoría redirigen sus errores 401 a /session-expired. Este handler
común revalida la cuenta y borra mf_access y mf_refresh solo ante 401; responde
303 con Location relativa al login. Una cuenta activa vuelve al dashboard sin
borrar cookies; permisos cambiados vuelven al dashboard con aviso; un error de
verificación conserva las cookies. La ruta anterior de usuarios queda como alias.
El proxy permite que la ruta común resuelva su propia sesión, incluso sin token.

Se reforzaron las pruebas para conservar ambas cookies antes de abrir cada página:
las consultas API se realizan con un contexto separado y no pueden ocultar el
fallo limpiando previamente el navegador. Se comprueba la eliminación de ambas
cookies y, en auditoría, que recargar el login no regrese al dashboard.

Validación: 44 unitarias (13 autenticación, 5 navegación, 14 usuarios, 12 auditoría),
3 integraciones HTTP y 12 escenarios de navegador pasan (10 auditoría y 2 de sesión
inactiva de usuarios, en escritorio/móvil). Build de producción Docker, lint y
formato de ambos proyectos pasan. TypeScript y formato de las pruebas verifican
la versión final. Navegador contra Next.js, NestJS y PostgreSQL reales del proyecto
exclusivo capstone-sprint1-t16; no se modifican datos de producción.

No se cambia backend, schema ni migraciones. Endpoint de locales y validación de
isActive en JwtStrategy quedan como tareas independientes, tal como la revisión
los identifica. PR #20 permanece en revisión; no se fusiona ni marca Hecho.