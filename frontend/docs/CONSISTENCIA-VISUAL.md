# Revisión de consistencia visual

Se conserva el mockup y la navegación compartida de MoiFood. Esta corrección
unifica los estilos internos de Login, Inicio, Usuarios, Auditoría y sesión.

## Cambios respecto de la revisión

- Se eliminan `admin/usuarios/users-theme.css`, su layout exclusivo y las clases
  `u-*`. Tailwind y las fuentes se cargan una sola vez desde el layout raíz.
- `globals.css` es la única paleta. Incorpora `ok`, `ok-bg`, `info` e `info-bg`.
  `@theme static` conserva todos los tokens, aunque una vista no los use todavía.
- `components/ui/styles.ts` define inputs, botones, etiquetas, tablas y marca.
  Usuarios, Auditoría, Login, SessionActions e Inicio reutilizan estas clases.
  Los controles tienen altura mínima de 44 px, foco visible y estados comunes.
- Las tablas comparten fondo de encabezado, tipografía y espaciado. En móvil
  se desplaza su contenedor, sin ampliar horizontalmente toda la página.
- Usuarios y Auditoría comparten el patrón de introducción, panel de filtros
  con título y cabecera de tabla. Los badges usan la misma tipografía, tamaño,
  forma y espaciado, con colores según su significado.
- «Mi sesión» abre un panel flotante anclado a la derecha. Abrirlo no modifica
  la altura de la cabecera ni desplaza el contenido.
- La marca «Gestión interna» conserva la misma tipografía en Login y el menú.
- El texto secundario y los estados usan colores con contraste legible. Los
  botones salmón llevan texto oscuro. Se conserva la paleta del proyecto.

## Carga, error y permisos

`app/(authenticated)/layout.tsx` mantiene `ApplicationShell` por encima de las
páginas y de `admin/auditoria/loading.tsx`. Envolver otra vez el loading crearía
dos menús. El usuario se obtiene y valida en servidor, desde la cookie HttpOnly.

Un fallo 503 al consultar Usuarios conserva el menú completo, la cuenta y
«Mi sesión». El cierre de sesión elimina ambas cookies. No existe un shell con
`user={null}` en ese estado. Los permisos del backend y los guardas de cada
página siguen siendo obligatorios; ocultar un enlace no concede acceso.

Si falla la propia validación de sesión con un 500, 503 o error de conexión,
el layout muestra `SessionUnavailable` en lugar de lanzar un error genérico.
Ofrece «Intentar nuevamente» mediante `router.refresh()` y permite cerrar la
sesión local incluso si NestJS no responde. Se conserva la marca y no se muestran
identidad, enlaces por rol ni contenido privado sin una validación correcta.
La respuesta 401 conserva su redirección al login.

El proxy de Next.js deja que estas vistas conocidas lleguen a sus guardas de
servidor cuando hay un fallo temporal de validación, en vez de devolver texto
plano. No habilita contenido ni modifica la autorización de las API. Las rutas
desconocidas conservan la respuesta de error. `app/(authenticated)/error.tsx`
contiene los errores de página y reutiliza `SessionRecovery` sin duplicar el
layout. En Next.js 16.3 usa `retry`, que vuelve a solicitar el contenido al
servidor; el error original y su mensaje interno no se exponen al usuario.

## Pruebas reproducibles

Calidad y unitarias desde `frontend/`:

```powershell
npm run lint
npm run format:check
npm run build
npm test
npm run test:portal
npm run test:users
npm run test:audit
```

La suite `tests/visual-consistency/visual-consistency.spec.ts` compara estilos
computados, foco de teclado, contraste y propagación de cambios en los tokens.
Comprueba además carga lenta de Auditoría y fallo 503 de Usuarios en escritorio
y móvil. Requiere las variables `TEST_UI_*` documentadas en `.env.example`.

Los fallos controlados usan el proxy separado
`tests/navigation/backend-proxy.mjs`, ejecutado con Node 24 en el puerto 3149.
Su `TEST_PROXY_UPSTREAM` apunta al NestJS real del entorno Docker exclusivo.
El frontend de pruebas se compila normalmente y su `BACKEND_INTERNAL_URL`
apunta al proxy. `POST /__test/state` admite únicamente `usersUnavailable` y
`auditDelayMs` y `backendUnavailable`; las pruebas restablecen los tres valores. Publicar el puerto de
control solo en `127.0.0.1`. La imagen standalone de producción no contiene el
archivo del proxy ni añade una ruta de fallos a Next.js o a NestJS.

Con el frontend y el proxy de pruebas preparados:

```powershell
$env:TEST_UI_FRONTEND_URL='http://127.0.0.1:3115'
$env:TEST_UI_PROXY_CONTROL_URL='http://127.0.0.1:3149/__test/state'
$env:TEST_UI_DISPOSABLE='true'
# Definir TEST_UI_ADMIN_EMAIL y TEST_UI_ADMIN_PASSWORD con el seed de pruebas.
npx playwright test --config playwright.visual-consistency.config.ts
```

Las suites existentes de Usuarios y Auditoría requieren sus fixtures:
`scripts/test-users.ps1` y `scripts/test-audit.ps1` preparan los entornos
exclusivos. Se comprueban el nombre «Local de prueba» y los 32 registros
ficticios del 5 de octubre de 2026; no usar otros locales para esos escenarios.
Las cuentas creadas se desactivan. La auditoría inmutable permanece únicamente
en el volumen de pruebas.

## Resultado de la verificación — 16 de octubre de 2026

- Lint, formato, TypeScript y build de producción Docker aprobados.
- 47 unitarias: autenticación 13, navegación 8, usuarios 14 y auditoría 12.
- 52 escenarios de navegador aprobados: consistencia 8, usuarios 10,
  auditoría 10, navegación 18 y portal 6, en escritorio y móvil, contra
  Next.js compilado, NestJS y PostgreSQL reales.
- Capturas inspeccionadas de Login, Inicio, Usuarios, formulario y Auditoría;
  carga y error conservan navegación, cuenta y sesión. Detector mecánico
  sobre los componentes y estilos modificados sin hallazgos.
- Ninguna cuenta ficticia quedó activa. Los fallos controlados del proxy
  quedaron desactivados y se comprobó su ausencia en la imagen de producción.

El primer intento usó locales distintos y no preparó los eventos de auditoría
que esperan las suites existentes. Tras cargar los fixtures oficiales, Usuarios
y Auditoría aprobaron sin modificar sus aserciones. La prueba de colores se
corrigió para aceptar también hexadecimal abreviado producido por el build.
El foco invisible de los inputs se corrigió en el estilo compartido.

## Segunda revisión — 18 de octubre de 2026

- Corregidos filtros, introducción, cabeceras y badges de Usuarios para compartir
  el patrón de Auditoría. Marca, controles y paleta proceden de fuentes comunes.
- El panel flotante de sesión conserva las medidas de cabecera y contenido en
  las tres vistas, en escritorio y móvil.
- Probados fallo de validación, reintento con backend recuperado, error durante
  navegación con layout montado y cierre de sesión con el backend aún caído.
- Corregido el nombre accesible de los diálogos: procede directamente del título,
  sin depender de un ID común. El recorrido móvil de desactivación vuelve a pasar.
- Build Docker, TypeScript, lint y formato aprobados; 47 unitarias aprobadas.
- 58 escenarios de navegador distintos aprobados: consistencia/recuperación 14,
  usuarios 10, auditoría 10, navegación 18 y portal 6. Se repitió Usuarios tras el
  ajuste accesible y un caso de renovación móvil que coincidió con la compilación;
  las aserciones y los límites de espera originales se conservaron.

## Seguimiento de la tarea

La asociación a una tarea real de Notion (ID, commit y enlace de PR) permanece
pendiente porque la conexión disponible no encuentra el tablero Capstone.
Se autorizó publicar esta revisión en el PR #26 y mantener la rama existente
con esa asociación pendiente. No se ha creado ni actualizado una tarea en
Notion. La validación técnica no sustituye la revisión del equipo ni autoriza
marcarla como Hecho.
