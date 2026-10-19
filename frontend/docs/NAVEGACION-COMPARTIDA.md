# Corrección de revisión: navegación compartida

Dashboard, Usuarios y Auditoría tenían menús distintos: el dashboard no enlazaba
a Usuarios y las páginas administrativas no permitían recorrer los módulos de
la misma manera. La corrección incorpora `src/app/(authenticated)/layout.tsx`,
un layout general de Next.js para Dashboard, Usuarios, Auditoría y Portal del
Trabajador. Monta `ApplicationShell` una sola vez y conserva el menú, la cuenta y
las acciones de sesión al navegar. Las páginas aportan solamente su contenido.
Conserva los tokens visuales del mockup, con barra lateral
de 248 px en escritorio y enlaces visibles en móvil.

La navegación sale de `getNavigationItems`: el administrador recibe Inicio,
Usuarios y Auditoría, siempre en ese orden. Contador y supervisor reciben Inicio
en el dashboard; el trabajador recibe Inicio en su portal. No se agregan enlaces
a funciones pendientes de integración. `ApplicationNavigation` usa `usePathname`
para marcar el enlace activo con `aria-current="page"`; `ApplicationHeading`
actualiza el título sin remontar el layout. El componente incluye cuenta, rol, salto al contenido y
el mismo menú «Mi sesión» con renovación y logout.

Las páginas conservan sus comprobaciones de sesión, administrador activo y
permisos. Ocultar enlaces no sustituye la autorización. No cambia el backend ni
la política heredada de revocación de JWT. Las respuestas de error previas a
confirmar una sesión no muestran datos de cuenta ni opciones administrativas.

El layout obtiene la cookie HttpOnly mediante `getSession` y valida el token con
NestJS antes de construir las opciones. Solo correo y rol llegan a los
componentes de presentación: no se decodifica el JWT en el navegador ni se guarda
en localStorage. No se necesita Zustand: la sesión del servidor es la fuente de
verdad y los componentes de navegación reciben sus datos como props. Login y
los handlers de autenticación quedan fuera del grupo autenticado. Los nombres
entre paréntesis no cambian las URLs existentes.

El layout persistente no reemplaza la autorización de cada petición: se conservan
el proxy, los guards de páginas y las comprobaciones de las API. Cambiar de cuenta
desmonta el layout al salir al login; la nueva sesión construye sus propias
opciones. El estado de carga de auditoría también conserva el marco compartido.
Usuarios hereda las tipografías del layout raíz en vez de cargar otra variante.

## Verificación reproducible

Ejecutar lint, formato y build, y las unitarias de navegación/autenticación,
usuarios y auditoría:

```powershell
npm run lint
npm run format:check
npm run build
npm run test:portal
npm test
npm run test:users
npm run test:audit
```

La regresión de navegador requiere un entorno Docker exclusivo con API real,
un local ficticio existente y las credenciales de su administrador inicial.
Configurar las variables `TEST_NAVIGATION_*` documentadas en `.env.example` y
ejecutar:

```powershell
npx playwright test --config playwright.navigation.config.ts
```

Son nueve escenarios en escritorio y móvil: recorrido completo del administrador,
logout desde cada una de las tres vistas y permisos de trabajador, supervisor y
contador, renovación desde Usuarios y cambio administrador/trabajador en el mismo
navegador. Comprueba que el mismo nodo de navegación permanece montado durante
el recorrido, un único enlace activo, mismos enlaces/orden y ausencia de
desbordamiento de página y errores de ejecución, ambas cookies eliminadas al
salir y rechazo HTTP 403 en los módulos administrativos para los otros roles.

Los tests crean cuentas ficticias y las desactivan al terminar; sus eventos se
conservan únicamente en el volumen de pruebas para no alterar la auditoría.
No ejecutar contra producción ni una base de datos compartida con datos reales.
Las capturas y trazas se guardan por defecto en `output/playwright/navigation`,
fuera de Git y del contexto de construcción Docker. En esta ejecución OneDrive
bloqueó la limpieza de resultados anteriores: se ejecutaron navegación y portal
con el CLI de Playwright desde una carpeta temporal nueva, pasando las rutas
absolutas de configuración y `--output` a directorios nuevos. No se omitieron
escenarios ni se cambiaron permisos de archivos o volúmenes para eludir el bloqueo.

Esta corrección es independiente de las tareas del sprint 2 todavía en PR.
Al integrar esas pantallas deben situarse bajo el grupo `(authenticated)` y
declarar sus opciones/roles en la configuración compartida, sin montar otro menú
desde la página. No se certifica la DoD completa ni se modifica
el estado de las tareas en Notion sin acceso al tablero.

## Resultado de la verificación — 15 de octubre de 2026

- 47 unitarias aprobadas: 13 de autenticación, 8 de navegación, 14 de usuarios y
  12 de auditoría. Las tres nuevas cubren enlaces comunes, destinos por rol y
  selección de vista/título sin confundir prefijos de rutas.
- 28 escenarios de navegador aprobados: 18 de navegación, 6 de portal y 4 de
  administrador desactivado (2 de usuarios y 2 de auditoría), en escritorio y
  móvil, contra Next.js compilado, NestJS y PostgreSQL reales. Los 2 recorridos
  visuales se repitieron y aprobaron tras añadir espera explícita al contenido
  cargado, además de comprobar el marco del layout.
- Build de producción Docker, lint y formato del frontend aprobados; lint y
  formato del backend también aprobados sin modificarlo. Los CRLF del backend
  se normalizaron exclusivamente en una copia temporal para verificar Prettier.
- Capturas finales de Inicio, Usuarios y Auditoría inspeccionadas en ambos
  tamaños, con datos cargados; detector mecánico sobre los cinco componentes
  revisados del layout sin hallazgos.
- Todas las cuentas temporales creadas por las suites quedaron desactivadas.
  El local ficticio y los eventos permanecen en el volumen exclusivo de pruebas.

Vista local de la corrección: `http://127.0.0.1:3114/login`. La versión integrada
de main se conserva en el puerto 3000 para comparación. Esta verificación no
certifica endpoints documentales o de liquidaciones del sprint 2.
