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

La tarea depende de T11 (PR #19), a su vez dependiente del login (PR #16).
Se entrega un PR separado sobre T11 para revisar únicamente esta tarea.
La gestión de usuarios de T10 permanece independiente.
Integrar primero las dependencias y luego cambiar la base a main.

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
