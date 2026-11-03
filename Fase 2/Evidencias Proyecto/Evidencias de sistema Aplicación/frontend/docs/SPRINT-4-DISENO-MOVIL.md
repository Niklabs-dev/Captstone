# Sprint 4 — Diseño móvil

Modo: Operate. Construcción directamente en código, a partir de la referencia
del usuario y la confirmación de conservar el naranja de MoiFood.

## Dirección

Primera pantalla: cabecera compacta, bienvenida personal, una tarjeta de acceso
a la tarea frecuente del rol y accesos rápidos con iconos. Barra inferior
persistente con etiquetas; las opciones adicionales se abren en Más.
No se muestran saldos, métricas ni notificaciones sin datos reales.

La misma navegación acompaña documentos, liquidaciones y propinas. Administrador
conserva todos sus módulos en Más. El escritorio mantiene el menú lateral.

## Interacción principal

Cambiar de módulo desde el pulgar. Más abre un diálogo con la navegación completa;
Escape y el botón de cierre devuelven el foco al disparador. Las rutas y
permisos continúan procediendo de navigation.ts y de la sesión del servidor.

## Verificación

Revisar 360, 390, 768 y 1440 px con API real: enlaces por rol, página activa,
foco, cierre de menú, formularios, tablas, carga, vacío y errores. La barra
respeta safe-area y reserva espacio inferior para no cubrir el contenido.
Capturas antes/después y resultado de pruebas en output/, fuera de Git.

Referencia: captura aportada por el usuario, usada como guía de composición;
no se reutilizan sus marcas, datos bancarios ni imagen dentro de la aplicación.

La tarjeta de tarea completa es un enlace táctil. El inicio compacto permite
ver todos los accesos antes de la barra inferior. En Usuarios, la búsqueda
siempre está visible; Más filtros expande rol, estado y local, conserva los
valores al cerrar e indica cuántos filtros adicionales están aplicados.
