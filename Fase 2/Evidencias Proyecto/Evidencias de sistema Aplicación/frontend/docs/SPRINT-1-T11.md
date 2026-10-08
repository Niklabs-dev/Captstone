# SPRINT-1-T11 — Redirección por rol hacia el Portal del Trabajador

## Criterio de aceptación

Si un usuario con rol trabajador intenta ingresar a un módulo restringido,
se le redirige al Portal del Trabajador (E1-H1, criterio 2).
La exportación de Notion estima 2 horas y asigna la tarea a Lucas Flores.
El usuario confirmó que las tareas estaban pendientes aunque la exportación
indicaba «En revisión».

## Implementación

- Política tipada y centralizada para los cuatro roles.
- Trabajador: destino `/portal` tras login, renovación e inicio con sesión.
- Otros roles: destino `/dashboard`; no acceden al portal del trabajador.
- Restricciones de páginas en servidor mediante proxy, con verificación
  de JWT en NestJS. Dashboard y portal también verifican en Server Components.
- Las páginas administrativas admiten solo ADMINISTRADOR.
- Redirección de trabajador desde dashboard, admin, documentos, propinas,
  ventas, caja, inventario, usuarios y auditoría, incluidas subrutas.
- La redirección elimina parámetros del módulo solicitado y muestra un aviso
  contextual. No permite destinos externos ni conserva parámetros `next`.
- Portal adaptable a escritorio y móvil, con logo, Inter/JetBrains Mono,
  colores y tarjetas del mockup de Fase 1; enlace para saltar al contenido.
- Cuenta real de la sesión, renovación y cierre. No hay indicadores,
  documentos, liquidaciones, propinas o datos personales inventados.

El mockup disponible es del administrador; no incluye una pantalla específica
del portal. Se adapta su lenguaje visual sin copiar datos de ejemplo.
El contenido funcional de documentos y liquidaciones pertenece a Sprint 2.

## Dependencia y límites

La autenticación de SPRINT-1-T09 está en el PR #16 y es dependencia de T11.
No se integra ningún PR en main sin revisión.
La gestión de usuarios de T10 permanece separada.
Las API no se redirigen a HTML: conservan su autorización en NestJS.

El backend valida el estado activo al iniciar o renovar sesión. Un JWT emitido
antes de desactivar una cuenta puede seguir vigente hasta su vencimiento.
Esta limitación existente no se modifica en T11; requiere una tarea de backend.
La comprobación adicional de administrador activo de T10 pertenece a su módulo.

## Pruebas

- 5 pruebas unitarias nuevas: destinos, módulos/subrutas, separación de roles,
  ausencia de ciclos y rechazo de destinos externos.
- 13 pruebas unitarias de autenticación de T09 como regresión.
- Integración HTTP con Next.js compilado y backend simulado: cuatro roles,
  login/renovación, inicio/login, portal, accesos restringidos, cookies falsas,
  ausencia de tokens en HTML y backend no disponible.
- Playwright: tres escenarios en escritorio y móvil (seis ejecuciones),
  contra Next.js, NestJS y PostgreSQL en Docker.
- Entorno aislado `capstone-sprint1-t11`; cuentas creadas por API y
  desactivadas al finalizar. Capturas locales en `test-results/portal/`.

Resultados aprobados:

- 18 unitarias (13 de autenticación y 5 de navegación).
- Integración HTTP completa aprobada, con los cuatro roles.
- 6 ejecuciones Playwright aprobadas (57,4 segundos), en escritorio y móvil.
- Build local del frontend y builds Docker del frontend y backend.
- Lint y formato de ambos proyectos. El formato del backend se comprobó
  sobre una copia temporal con LF, como almacena Git; el checkout de Windows
  contiene CRLF. No se cambiaron fuentes del backend.
- Cuatro migraciones y seed aplicados en el volumen limpio.
- Capturas revisadas y comprobación de ausencia de desbordamiento horizontal,
  errores de JavaScript y acceso al token desde document.cookie.

El entorno real usa el backend de main `c5eaf43`, con el modelo documental
ya integrado. Los módulos auth/users no cambian respecto de T09.
Playwright desactivó sus seis cuentas ficticias al finalizar.
Agregar Playwright no modificó ninguna versión de dependencias existentes.

PR y hash: se registran al publicar la entrega.

## Seguimiento

Preparada para revisión. No se modificó Notion: la integración no tiene acceso a la página
compartida de Capstone. El registro local documenta el resultado y el hash.
Solo se marcará Hecho cuando el usuario confirme la revisión.
