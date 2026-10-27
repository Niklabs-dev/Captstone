# Frontend Moi-food

Aplicación Next.js 16 con App Router, TypeScript estricto y Tailwind CSS.

Dashboard, Usuarios, Auditoría y Portal del Trabajador usan un layout general
autenticado, con navegación y sesión persistentes y opciones según el rol validado
en el servidor. Ver [navegación compartida](docs/NAVEGACION-COMPARTIDA.md)
para permisos, alcance y pruebas de regresión.

Los controles, tablas y marca usan la paleta global y estilos comunes. Ver
[revisión de consistencia visual](docs/CONSISTENCIA-VISUAL.md) para los ajustes
y las pruebas de carga, error, foco de teclado y contraste.

## Desarrollo

1. Ejecutar `npm ci`.
2. Crear `.env.local` tomando `.env.example` como referencia.
3. Iniciar el backend NestJS en el puerto 3001.
4. Ejecutar `npm run dev` y abrir http://localhost:3000/login.

`BACKEND_INTERNAL_URL` se utiliza exclusivamente en el servidor. En local es
`http://localhost:3001`; Docker Compose configura `http://backend:3001`.
No se envían tokens ni la URL interna al JavaScript del navegador.

## Autenticación — SPRINT-1-T09

- El formulario envía el correo y la contraseña a `POST /api/auth/login`.
- Next.js llama a `POST /auth/login` en NestJS y valida la respuesta.
- Access token y refresh token se guardan en cookies `HttpOnly`, `SameSite=Lax`,
  con `Secure` en producción. Producción debe servirse mediante HTTPS.
- El access token vence según `expiresIn` del backend. La cookie de renovación
  usa `AUTH_REFRESH_COOKIE_MAX_AGE` (604800 segundos por defecto), que debe
  alinearse con `JWT_REFRESH_EXPIRES_IN`.
- Todas las páginas privadas pasan por `src/proxy.ts`, incluidos módulos futuros.
  Se verifica el JWT con `GET /auth/me`; una cookie inventada no da acceso.
  El destino protegido también valida la sesión antes de mostrar datos.
- Una sesión inválida redirige al login. Un fallo del backend deniega el acceso
  con un mensaje temporal, sin confundirlo con credenciales incorrectas.
- `POST /api/auth/refresh` rota el refresh token mediante NestJS. La renovación
  es explícita desde «Renovar sesión» o «Renovar sesión anterior» en el login.
- `POST /api/auth/logout` revoca el refresh token y elimina las cookies locales.
  Si el backend no responde, las cookies locales se eliminan igualmente y
  la respuesta informa `revoked: false`.
- Las operaciones de autenticación verifican el encabezado `Origin`.
  El proxy inverso debe conservar el host y protocolo públicos de la solicitud.
- SPRINT-1-T11 dirige al trabajador a `/portal` y a los otros roles a `/dashboard`.

El usuario inicial lo configura el seed del backend. No se incorporan cuentas
ni contraseñas de demostración al frontend.

## Portal y redirecciones — SPRINT-1-T11

El trabajador que intenta entrar al dashboard, administración, documentos,
propinas, ventas, caja, inventario, usuarios o auditoría vuelve a
`/portal?reason=forbidden`. Sus subrutas tienen la misma protección.
El inicio del portal es exclusivo del trabajador. Los supervisores también pueden acceder a /portal/liquidaciones para consultar únicamente sus documentos publicados.
Las páginas `/admin/*` están reservadas al administrador.
La política se centraliza en `src/lib/navigation.ts`; login, renovación,
inicio, login con sesión abierta y proxy usan el rol verificado por NestJS.
No se toman decisiones a partir de cookies de rol o datos enviados por el cliente.

El proxy protege páginas por defecto. Solo excluye inicio y login (que resuelven
su sesión en servidor), las API (autorización propia y respuestas JSON), recursos
internos de Next y los archivos públicos enumerados en el matcher. Un nombre
con extensión, como `/modulo-nuevo/informe.csv`, sigue protegido. Al añadir un
archivo público se registra explícitamente su ruta; no se excluye cualquier
URL que contenga un punto. El dashboard también explica las redirecciones
con `reason=forbidden`.

El portal adapta la paleta, tipografía, logo, barra lateral y tarjetas del
mockup administrador. Muestra únicamente la cuenta conectada y las acciones
de sesión. Documentos, liquidaciones y propinas se habilitarán en sus tareas.
Las API conservan sus permisos propios en NestJS: redirigir una página no
sustituye la autorización del backend.

Pruebas del portal:

```powershell
npm run test:portal
# Incluye automáticamente npm run build:
npm run test:integration
# Instalar Chromium una sola vez:
npx playwright install chromium
# Credenciales del seed del entorno exclusivo de prueba:
$env:TEST_PORTAL_ADMIN_EMAIL = '<correo del seed>'
$env:TEST_PORTAL_ADMIN_PASSWORD = '<contraseña del seed>'
./scripts/test-portal.ps1
```

El script usa el proyecto Docker `capstone-sprint1-t11`, con frontend 3104,
backend 3105 y PostgreSQL 5435. Crea un local ficticio y las pruebas crean
cuentas temporales; al terminar desactivan las cuentas y conservan la auditoría
en ese volumen exclusivo. `-SkipBuild` permite usar imágenes ya construidas.
No ejecutar estas pruebas contra producción.

Detalle de alcance, dependencia y validación: [SPRINT-1-T11](docs/SPRINT-1-T11.md).

## Auditoría — SPRINT-1-T16

El administrador puede abrir «Consultar auditoría» desde el dashboard o
visitar `/admin/auditoria`. La tabla muestra responsable, operación,
fecha/hora de Chile, local, módulo e identificador del registro.
Los filtros por local y fechas se conservan en la URL y al paginar.
Desde/hasta son días inclusivos de Chile; se pueden dejar vacíos.
La vista es de solo lectura. No se ofrecen acciones de edición ni eliminación.

La página es un Server Component. El formulario usa navegación GET y los
resultados se obtienen de NestJS en el servidor; no se entregan JWT al cliente.
La API interna `GET /api/audit-logs` exige administrador activo, valida
filtros/paginación y devuelve una proyección sin detalles arbitrarios, IP ni
user-agent. Los otros métodos no se implementan.
La autorización definitiva de `GET /audit-logs` permanece en NestJS.

Los catálogos de locales se consultan desde `GET /stores`, incluidos los inactivos para el historial. No requieren variables de entorno ni un nuevo despliegue al crear o editar un local.

```powershell
npm run test:audit
# Después de npm run build:
npm run test:audit:integration
# Chromium instalado mediante npx playwright install chromium:
$env:TEST_AUDIT_ADMIN_EMAIL = '<correo del seed>'
$env:TEST_AUDIT_ADMIN_PASSWORD = '<contraseña del seed>'
./scripts/test-audit.ps1
```

Las pruebas de navegador usan el proyecto Docker exclusivo
`capstone-sprint1-t16`: frontend 3106, backend 3107 y PostgreSQL 5436.
El script inserta dos locales y 36 registros ficticios para comprobar límites
de días chilenos, aislamiento del filtro y paginación. Son idempotentes y
permanecen en ese volumen porque la auditoría es inmutable.
Las cuentas temporales creadas por API se desactivan al finalizar.
El navegador se configura en UTC para comprobar que se mantienen las horas
chilenas. No usar este script contra producción.

Detalle de alcance y validación: [SPRINT-1-T16](docs/SPRINT-1-T16.md).

## Verificación

```bash
npm run test
npm run lint
npm run format:check
npm run build
npm run test:integration
```

Las pruebas cubren validación de credenciales, respuestas malformadas, cookies,
protección de origen, JWT inválido, renovación y caídas del backend.

`test:integration` ejecuta primero `npm run build` y prueba el frontend compilado en
el puerto 3119 contra un backend HTTP simulado. No sustituye la validación con
NestJS y PostgreSQL reales.

`npm run test:live` verifica el login, la rotación del refresh token, el cierre
de sesión y el rechazo de tokens falsificados contra el entorno real.
Requiere `TEST_FRONTEND_URL`, `TEST_AUTH_EMAIL` y `TEST_AUTH_PASSWORD` en el
entorno de la terminal; utilizar una cuenta del seed del entorno de pruebas.
Las credenciales no se escriben en Git. Si faltan esas variables, esta prueba
se omite explícitamente.

Para verificar el flujo con los servicios reales, ejecutar `docker compose up --build`
desde la carpeta de la aplicación y comprobar:

1. Abrir `/dashboard` sin cookies: debe redirigir al login.
2. Ingresar credenciales incorrectas: debe mostrar un mensaje genérico.
3. Ingresar credenciales válidas del seed: debe abrir `/dashboard`.
4. Revisar cookies: los tokens tienen `HttpOnly` y no aparecen en el cuerpo JSON.
5. Renovar sesión: el backend rota el refresh token.
6. Cerrar sesión y volver a `/dashboard`: debe solicitar login.
7. Sustituir la cookie de acceso por un valor inventado: debe denegar el acceso.
8. Detener el backend: el frontend debe mostrar un error y permitir reintentar.

La aprobación del PR, el merge y la aceptación en Sprint Review quedan pendientes
de revisión del equipo antes de marcar la tarea como Hecho.

## SPRINT-1-T10: administración de usuarios

Vista: `/admin/usuarios`. Crear, listar, buscar, filtrar por rol, local y estado,
y desactivar cuentas con confirmación. Solo el administrador puede acceder.
La sesión `mf_access` se verifica mediante NestJS; ni el JWT ni las contraseñas
guardadas se exponen en las respuestas al navegador. Las mutaciones requieren
el origen del frontend y el backend conserva la auditoría de las operaciones.

T10 se entrega sobre T11 (PR #19), que depende del login T09 (PR #16). El diff del PR contiene solo usuarios. Se integran #16, #19 y después #18; tras integrar T11 se cambia la base de #18 a main.

Configuración del servidor: `BACKEND_INTERNAL_URL` (ver `.env.example`). La API de locales proporciona el catálogo. En las nuevas asignaciones solo se ofrecen locales activos; los inactivos permanecen en filtros históricos.

```powershell
npm ci
npm run lint
npm run format:check
npm run test:users
npm run build
npm run test:users:integration
npx playwright install chromium
```

Las pruebas de navegador usan un proyecto Docker exclusivo y datos ficticios.
Configura `TEST_USERS_ADMIN_EMAIL` y `TEST_USERS_ADMIN_PASSWORD` con las credenciales
del seed de desarrollo y ejecuta desde `frontend/`:

```powershell
./scripts/test-users.ps1
```

El script usa puertos 3102 (frontend), 3103 (backend) y 5434 (PostgreSQL), crea
un local ficticio y ejecuta Playwright en escritorio y móvil. Las cuentas de
prueba quedan desactivadas; el volumen y la auditoría se conservan exclusivamente
en `capstone-sprint1-t10` para inspección. No ejecutar contra datos de producción.
Las capturas y trazas se guardan en `test-results/`, fuera de Git.

La sesión de usuarios se limpia mediante /admin/usuarios/session-expired cuando la cuenta ya no está activa. Este Route Handler de navegación revalida la cuenta antes de borrar cookies y conserva el host público usando Location relativa. Las API de usuarios siguen respondiendo JSON. test:users:integration ejecuta su build automáticamente.

## Gestor documental (SPRINT-2-T10)

Carga, versiones y descarga conectadas a T05/T06 mediante el BFF. Contrato en Swagger (/api/docs); ver [SPRINT-2-T10](docs/SPRINT-2-T10.md).

## Alertas de registro DT (SPRINT-2-T11)

Panel y pruebas: [docs/SPRINT-2-T11.md](docs/SPRINT-2-T11.md). Conecta con la API de SPRINT-2-T08 documentada en Swagger (`/api/docs`).

## Gestión de liquidaciones (SPRINT-2-T16)

Panel, permisos y pruebas: [docs/SPRINT-2-T16.md](docs/SPRINT-2-T16.md). API de T13/T14 conectada mediante BFF; contrato en Swagger (/api/docs).

## Mis liquidaciones (SPRINT-2-T17)

Panel, contrato y pruebas: [docs/SPRINT-2-T17.md](docs/SPRINT-2-T17.md). API de T15 conectada mediante BFF; contrato en Swagger (/api/docs).

## Mis documentos (SPRINT-3-T06)

`/portal/documentos` permite a trabajadores y supervisores consultar sus contratos, anexos, pactos y finiquitos con filtro, versión vigente, historial, verificación SHA-256 y descarga. Solo lectura, identidad desde sesión y sin workerId editable. Mis liquidaciones mantiene su flujo separado y no se exponen liquidaciones pendientes de firma. Contratos y pruebas: [SPRINT-3-T06](docs/SPRINT-3-T06.md). `npm run test:my-documents` ejecuta la regresión y `npm run test:my-documents:real` el recorrido con API real y base exclusiva de pruebas.

## Locales (SPRINT-3-T02)

`/admin/locales` permite crear, editar, desactivar y reactivar locales como administrador. `GET /api/stores` expone el catálogo autenticado y las mutaciones del BFF conservan el token en servidor y validan origen, rol y datos. Usuarios, Auditoría, Documentos, Alertas DT y Liquidaciones consumen la API sin caché; los locales nuevos aparecen sin configurar variables ni redeplegar. Documentos incluye locales sin trabajadores e identifica los inactivos; Auditoría conserva esa identificación desde el HTML inicial.

Calidad: `npm run test:stores`, `npm run lint`, `npm run format:check`, `npm run build`. Integración: `TEST_REAL_DISPOSABLE=true npx playwright test --config playwright.stores.config.ts` solo con backend/base/almacenamiento de pruebas y fixtures preparados mediante `scripts/prepare-real-api.mjs`. GitHub Actions ejecuta Docker y conserva evidencia; consultar `docs/SPRINT-3-T02.md`.

## Edición, reactivación y restablecimiento de usuarios (SPRINT-3-T05)

`/admin/usuarios` permite editar cuentas activas e inactivas, reactivarlas con confirmación y restablecer la contraseña de otra cuenta con nueva clave y confirmación. Conectado a las API reales de T03/T04, sin mostrar credenciales actuales ni devolver hashes o tokens. Las asignaciones nuevas solo admiten locales activos y se protege el rol de la propia cuenta administradora. Contratos, política de contraseñas, revocación de sesiones y pruebas: [SPRINT-3-T05](docs/SPRINT-3-T05.md). `npm run test:users:real` ejecuta el recorrido con base exclusiva; el workflow de T05 conserva la evidencia de Docker y navegador en cuatro anchos.
