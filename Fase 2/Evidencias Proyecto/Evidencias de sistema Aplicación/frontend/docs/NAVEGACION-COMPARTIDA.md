# Corrección de revisión: navegación compartida

Dashboard, Usuarios y Auditoría tenían menús distintos: el dashboard no enlazaba
a Usuarios y las páginas administrativas no permitían recorrer los módulos de
la misma manera. La corrección usa `ApplicationShell` en esas tres vistas y en el
Portal del Trabajador. Conserva los tokens visuales del mockup, con barra lateral
de 248 px en escritorio y enlaces visibles en móvil.

La navegación sale de `getNavigationItems`: el administrador recibe Inicio,
Usuarios y Auditoría, siempre en ese orden. Contador y supervisor reciben Inicio
en el dashboard; el trabajador recibe Inicio en su portal. No se agregan enlaces
a funciones pendientes de integración. Cada página marca su enlace activo con
`aria-current="page"`. El componente incluye cuenta, rol, salto al contenido y
el mismo menú «Mi sesión» con renovación y logout.

Las páginas conservan sus comprobaciones de sesión, administrador activo y
permisos. Ocultar enlaces no sustituye la autorización. No cambia el backend ni
la política heredada de revocación de JWT. Las respuestas de error previas a
confirmar una sesión no muestran datos de cuenta ni opciones administrativas.

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

Son ocho escenarios en escritorio y móvil: recorrido completo del administrador,
logout desde cada una de las tres vistas y permisos de trabajador, supervisor y
contador, y renovación desde Usuarios. Comprueba un único enlace activo, mismos enlaces/orden, ausencia de
desbordamiento de página y errores de ejecución, ambas cookies eliminadas al
salir y rechazo HTTP 403 en los módulos administrativos para los otros roles.

Los tests crean cuentas ficticias y las desactivan al terminar; sus eventos se
conservan únicamente en el volumen de pruebas para no alterar la auditoría.
No ejecutar contra producción ni una base de datos compartida con datos reales.
Las capturas y trazas se guardan en `output/playwright/navigation`, fuera de Git
y del contexto de construcción Docker.

Esta corrección es independiente de las tareas del sprint 2 todavía en PR.
Al integrar esas pantallas deben adoptar el mismo componente compartido, en vez
de volver a copiar la navegación. No se certifica la DoD completa ni se modifica
el estado de las tareas en Notion sin acceso al tablero.

## Resultado de la verificación — 15 de octubre de 2026

- 46 unitarias aprobadas: 13 de autenticación, 7 de navegación, 14 de usuarios y
  12 de auditoría. Las dos nuevas cubren enlaces comunes y destinos por rol.
- 16 escenarios de navegación y 6 de regresión del portal aprobados en escritorio
  y móvil, contra Next.js compilado, NestJS y PostgreSQL reales.
- Build de producción Docker, lint y formato del frontend aprobados; lint y
  formato del backend también aprobados sin modificarlo. Los CRLF del backend
  se normalizaron exclusivamente en una copia temporal para verificar Prettier.
- Capturas de Inicio, Usuarios y Auditoría inspeccionadas en ambos tamaños;
  detector mecánico sobre las cinco vistas/componentes modificados sin hallazgos.
- Todas las cuentas temporales creadas por las suites quedaron desactivadas.
  El local ficticio y los eventos permanecen en el volumen exclusivo de pruebas.

Vista local de la corrección: `http://127.0.0.1:3114/login`. La versión integrada
de main se conserva en el puerto 3000 para comparación. Esta verificación no
certifica endpoints documentales o de liquidaciones del sprint 2.
