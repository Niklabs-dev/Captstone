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

PR: [#19](https://github.com/Niklabs-dev/Captstone/pull/19).
Commit de implementación: `6104c04`.
Rama: `feat/sprint-1-t11-portal-trabajador`.
Revisor solicitado: `Niklabs-dev`.
La rama se creó desde main y se reubicó sobre T09 para que el diff del PR
contenga exclusivamente T11. El frontend no cambió al reubicarla.
Integrar primero #16 y luego cambiar la base de #19 a main.

## Seguimiento

En revisión (registro local). No se modificó Notion: la integración no tiene acceso a la página
compartida de Capstone. El registro local documenta el resultado y el hash.
Solo se marcará Hecho cuando el usuario confirme la revisión.

## Correcciones de revisión — 13 de octubre de 2026

La revisión de Niklabs aprobó funcionalmente T09/T10/T11 y pidió preparar la
integración en orden #16 → #19 → #18. T09 se actualizó sobre main `3945efd`;
T11 conserva solo sus commits sobre T09 mientras esta dependencia siga abierta.
Una vez integrado #16 se reubica T11 sobre main y se cambia la base del PR.
T10 resuelve sus conflictos sobre T11 para conservar login y navegación por rol.

El proxy protege páginas futuras por defecto y excluye únicamente las rutas
públicas explícitas, los recursos de Next y las API. Las API mantienen su
autorización y contratos JSON; no se sustituyen por redirecciones HTML.
El dashboard muestra un aviso accesible cuando recibe `reason=forbidden`.
Los scripts ya usan `&&` legible y la integración HTTP ejecuta su build.
Se retiró el BOM de la página inicial en T09 y su versión de T11.

La regresión HTTP comprueba un módulo aún inexistente, una ruta con extensión,
los recursos públicos y el aviso del dashboard para los roles autorizados.
La prueba de navegador también valida esas rutas y los avisos.
La nueva validación de producción se realiza en Docker porque OneDrive impide
eliminar archivos de `.next/build/chunks` durante el build local (EPERM).
No se modifican fuentes de backend ni se suprimen comprobaciones de seguridad.

La exportación del tablero del 13 de octubre confirma vacíos los campos
`ID commit` y `Comentario`. La conexión de Notion devuelve 404 incluso para
la ficha exacta de T11; se prepara evidencia local para copiar al tablero vivo.
Las sugerencias que la revisión pide convertir en tareas nuevas se registran
aparte, sin atribuirles IDs ni afirmar su creación remota.


Validación final de la revisión: lint, formato y build Docker aprobados; 18 unitarias e integración HTTP ampliada aprobadas; 6 escenarios de navegador aprobados en 56,4 segundos. Playwright CLI comprobó el trabajador en una ruta futura con extensión y al supervisor redirigido desde administración, con capturas a 390 px y 1280 px, sin desbordamiento ni mensajes de consola. Las dos cuentas del CLI quedaron desactivadas. Los resultados de Playwright se guardaron en una carpeta temporal porque OneDrive bloqueaba el borrado de test-results. Los hashes previos de este documento se conservan como referencias históricas; el registro externo de revisión identifica los heads publicados tras el rebase.
