# SPRINT-3-T05 — Edición, reactivación y restablecimiento de usuarios

La vista `/admin/usuarios`, exclusiva de administrador, amplía la gestión existente:

- Editar cuentas activas o inactivas: nombre, apellido, correo, RUT, teléfono, fecha de contratación, rol y local. Actualiza la lista inmediatamente y mantiene los filtros.
- Campos opcionales vacíos se envían como `null`. RUT con dígito verificador, teléfono y fecha válida se comprueban antes del envío. El backend vuelve a validar todo.
- No se puede cambiar el propio rol. Los cambios de asignación solo admiten locales activos. Se pueden corregir datos personales sin volver a enviar una asignación sin cambios, incluso si el local anterior está inactivo.
- Reactivar con confirmación. Una asignación inválida se corrige desde Editar; no se recuperan sesiones revocadas.
- Restablecer la contraseña de otra cuenta con nueva clave y confirmación. Misma política de T04: 8 a 32 caracteres, hasta 72 bytes UTF-8. Nunca se consulta ni muestra la clave actual. La nueva clave no se conserva en estado React, mensajes, almacenamiento ni respuestas y se limpia al cerrar el diálogo.
- Aviso preciso: se revocan los refresh tokens; los access tokens emitidos pueden seguir vigentes hasta que expiren. Una cuenta desactivada no se reactiva al cambiar su clave.

## Contratos reales

Base: `main` con T03 (PR #41) y T04 (PR #43), commit `b54b83d`. Swagger del backend: `/api/docs`.

| BFF | Backend | Body |
| --- | --- | --- |
| `PATCH /api/users/:id` | `PATCH /users/:id` | Campos permitidos de edición, sin contraseña ni estado |
| `PATCH /api/users/:id/reactivate` | `PATCH /users/:id/reactivate` | Sin body |
| `PATCH /api/users/:id/password` | `PATCH /users/:id/password` | `{ newPassword }` sin confirmación |

Cada mutación valida origen, cookie de sesión y administrador activo antes de enviar el bearer desde servidor. Respuestas sin caché y proyección explícita de datos públicos del módulo; nunca se reenvían tokens o hashes. Se conservan mensajes seguros para 400/401/403/404/409 y fallos de red. Los diálogos nativos siguen `DESIGN.md`, bloquean envío/cierre durante la petición y restauran el foco.

## Validación

- Lint, formato, compilación y regresión unitaria del frontend.
- Regresión HTTP de los nuevos BFF: RBAC, origen, campos prohibidos, cuenta propia, edición, reactivación y respuestas sin secretos.
- `npm run test:users:real` utiliza `playwright.user-management.config.ts`, exclusivamente con `TEST_REAL_DISPOSABLE=true`.
- Dos escenarios por ancho (360, 390, 768 y 1440 px): edición persistente con datos de contacto, asignación y revocación, duplicado 409, desactivación/reactivación, confirmación de claves, rechazo de clave antigua, nuevo inicio de sesión y rechazo del refresh anterior. También prueba 400/403/404, origen ajeno y protección de cuenta propia.
- Workflow `.github/workflows/sprint-3-t05-docker.yml`: Docker Compose con PostgreSQL, migraciones y seed reales. Ejecuta además las regresiones de Sprint 2 y locales. Conserva capturas, trazas, JUnit y logs como evidencia, con datos sintéticos en un runner exclusivo.

La revisión y el merge corresponden al equipo. Registrar en Notion el enlace del PR, todos los commits y la evidencia de Actions antes del cierre; no marcar Hecho sin revisión confirmada.
