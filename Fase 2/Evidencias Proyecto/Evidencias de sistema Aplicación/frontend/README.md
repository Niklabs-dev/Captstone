# Frontend Moi-food

Constancias personales exclusivas de trabajador y supervisor (SPRINT-4-T02):
[permisos, integración y pruebas](docs/SPRINT-4-T02.md).

Reparto, validación y entrega de propinas para contador (SPRINT-3-T15):
[guía y pruebas](docs/SPRINT-3-T15.md).

Responsive de las vistas autenticadas (SPRINT-3-T07): menú móvil desplegable,
diálogos adaptados y tablas accesibles. Alcance y verificación:
[SPRINT-3-T07](docs/SPRINT-3-T07.md).

Operación diaria del local (SPRINT-4R-T01): una sola declaración por
local y fecha — propina tarjeta con voucher, propina efectivo y diferencia de
efectivo con signo. Contrato en el
[README del backend](../backend/README.md#operación-diaria-sprint-4r-t01);
reemplaza al registro diario de propinas, a la captura de ventas y al cierre
por turno con conciliación (hoy históricos, en modo lectura).

Registro diario de propinas para supervisor (SPRINT-3-T11, **histórico**):
[`/propinas/diarias`, contrato y pruebas](docs/SPRINT-3-T11.md). El flujo fue
reemplazado por la operación diaria (SPRINT-4R-T01).

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

Constancias propias de propinas enteradas (SPRINT-3-T16):
[guía de consulta y descarga](docs/SPRINT-3-T16.md).

## Medios de pago (SPRINT-4-T32)

`/admin/medios-pago` permite crear, editar, desactivar y reactivar los medios de pago del sistema como administrador: nombre, orden de lista, comportamiento en el cierre (`CASH`, `RECONCILABLE_CARD`, `EXTERNAL_OTHER`) y disponibilidad para propinas. El código se normaliza a mayúsculas y guiones bajos y no se puede cambiar después de crearlo; los medios desactivados conservan su historial visible. `GET /api/payment-methods` exige sesión y solo administración lista inactivos; las mutaciones del BFF validan origen, rol, cuerpo acotado y respuesta. El registro diario de propinas que cargaba los medios activos elegibles del
catálogo quedó histórico con SPRINT-4R-T01; el catálogo se conserva para el
historial y la futura importación de ventas desde Excel, y el histórico muestra
el nombre guardado aunque el medio se desactive. Pruebas: `npm run test:payment-methods` (unitarias), `npm run test:payment-methods:integration` (BFF con backend simulado) y `npm run test:payment-methods:e2e` (recorrido real con base exclusiva, igual que los demás módulos).

Diseño móvil del Sprint 4: [dirección y verificación](docs/SPRINT-4-DISENO-MOVIL.md). Prueba de navegador: npm run test:mobile-design -- --headed.

## Pruebas contra la API real y permisos del almacenamiento (SPRINT-4R-T19)

Las suites `real-*` alteran y retiran archivos del almacenamiento para probar
«archivo alterado» y «archivo ausente». `docker-compose.test.yml` monta
`frontend/output/real-api/storage` en el backend, que corre con **el mismo
usuario y grupo** de quien ejecuta las pruebas. Así los archivos quedan a su
nombre con permisos privados (carpetas `0700`, archivos `0600`) y Playwright
puede modificarlos sin `EACCES`, sin `chmod 0777` y sin correr como root.

Linux y macOS, desde la carpeta de la aplicación:

```bash
export CI_UID="$(id -u)" CI_GID="$(id -g)"
node frontend/scripts/prepare-real-storage.mjs   # crea la carpeta 0700 a tu nombre y valida CI_UID/CI_GID
COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.test.yml docker compose up --build -d
cd frontend && node scripts/prepare-real-api.mjs
TEST_REAL_DISPOSABLE=true npx playwright test --config playwright.my-documents.config.ts
```

En Windows con Docker Desktop los dueños de archivo no se aplican a los *bind
mounts*: basta con definir `CI_UID` y `CI_GID` con cualquier valor (por
ejemplo `1000`) y ejecutar el mismo script de preparación.

- `docker-compose.test.yml` exige `CI_UID` y `CI_GID`: sin ellas Compose se
  detiene con un mensaje claro en vez de fallar después con `EACCES`.
- `prepare-real-storage.mjs` falla con instrucciones si la carpeta pertenece a
  otro usuario (por ejemplo, porque la creó Docker como root) o si
  `CI_UID`/`CI_GID` no coinciden con el usuario actual.
- `frontend/output/` está en `.gitignore`: el almacenamiento, los reportes y
  las capturas de las pruebas nunca se commitean.
- El workflow `sprint-4r-t19-playwright-permisos.yml` ejecuta `real-api` y
  `real-my-documents` en Ubuntu y verifica que todos los archivos creados sean
  del runner, sin permisos de grupo u otros y sin `EACCES` en los logs.
  Evidencia en `docs/SPRINT-4R-T19.md`.

## Operación diaria (SPRINT-4R-T01)

Una sola pantalla de cierre por local y fecha reemplaza al registro diario de
propinas (`/propinas/diarias`, hoy histórico), a la captura de ventas y al
cierre de caja por turno con conciliación. El supervisor declara una vez al
día, para su local (el local sale de la sesión validada, nunca de un parámetro
editable):

- **Propina tarjeta** (entero CLP `>= 0`) con **foto del voucher** (JPEG/PNG/
  WebP, máximo 5 MiB); el archivo es obligatorio cuando la propina tarjeta es
  mayor que cero y se almacena en el volumen privado del backend — se sube y
  se descarga solo por el endpoint autorizado, sin URLs públicas.
- **Propina efectivo** (entero CLP `>= 0`). El fondo del día
  (`tipFundAmount`) lo calcula el backend como tarjeta + efectivo.
- **Diferencia de efectivo con signo**: positivo = sobrante, negativo =
  faltante; si no es cero el **motivo es obligatorio**.

Contrato HTTP en el
[README del backend](../backend/README.md#operación-diaria-sprint-4r-t01):
`POST /daily-operations` (multipart) responde 201 al crear, 200 al reintento
idéntico (sin duplicar) y 409 con `existingOperationId` cuando ya existe otra
operación con distinto contenido para el mismo local y fecha;
`GET /daily-operations?storeId&businessDate` devuelve 0 o 1 operaciones;
`GET /daily-operations/:id` su detalle y `GET /daily-operations/:id/voucher`
la descarga privada. La consulta histórica de propinas por medio, ventas y
cierres por turno sigue disponible en modo lectura.

Pruebas: `npm run test:daily-operations` (unitarias), `npm run test:daily-operations:integration` (BFF con backend simulado) y `TEST_REAL_DISPOSABLE=true npm run test:daily-operations:real` (recorrido real con base exclusiva, con las variables `TEST_REAL_*` de `.env.example`).

### Participantes, vista previa y corrección (SPRINT-4R-T05)

- **Selección de participantes:** contador «N de M seleccionados» y botón
  «Seleccionar todos / Quitar selección» (controles de al menos 44 px). Con
  fondo 0 la selección se conserva en pantalla pero no se envía, porque el
  backend exige la selección vacía.
- **Vista previa antes de guardar:** fondo, cantidad de participantes, monto del
  día por trabajador y tratamiento del residuo en CLP. Replica la regla del
  backend (SPRINT-4R-T04): `floor(fondo / n)` para cada uno y los pesos
  sobrantes de a $1, rotando según la fecha (`previewEqualShares` en
  `src/lib/daily-operations.ts`, probada con los mismos casos que el backend).
- **Foco al primer error** según el orden visual del formulario
  (`DAILY_FIELD_ORDER`); en participantes, la primera casilla.
- **Corrección:** «Corregir operación» precarga montos, motivo y selección y
  guarda con `PATCH /daily-operations/:id` (mismo ID, sin duplicar). La fecha no
  cambia y el voucher registrado se conserva salvo que se adjunte otro. Los
  participantes que ya no son elegibles se avisan y se quitan al guardar. Un
  409 informa que la operación ya alimentó un reparto confirmado o pagado o
  que sus propinas ya se pagaron.
- **Detalle registrado:** muestra cada participante con su monto del día.
## Repartos anteriores: histórico de solo lectura (SPRINT-4A-T08)

El flujo de borradores, observación, confirmación y pago del reparto por período (`/propinas/repartos`, SPRINT-4R-T06) se retiró: la propina se reparte al guardar la operación diaria y el contador o el administrador la paga por período en `/propinas`. Pagar un reparto por período dejaba esas propinas sin pagar y permitía pagarlas dos veces.

- **`/propinas/historico`** (ADMINISTRADOR y CONTADOR, enlazado desde `/propinas` como «Repartos anteriores»; Server Component sobre `GET /tip-pools`): lista los repartos guardados del más reciente al más antiguo. Los confirmados y pagados van en la tabla principal («Confirmado sin pago», «Pagado»); los borradores van aparte y plegados como «Borrador sin efecto». Desde SPRINT-4A-T22 ya no muestra la alerta de los registros con tarjeta anteriores: esos registros no alertan y la alerta vigente está en `/propinas`.
- **`/propinas/historico/<id>`**: resumen, montos por trabajador y, si está pagado, las constancias PDF (BFF `/api/tip-pools/<id>/receipts/<userId>/download`). No hay acciones sobre el reparto.
- `/propinas/repartos` redirige a `/propinas` (administrador y contador) o al inicio (supervisor). El supervisor ya no tiene vista de repartos; sus propinas personales llegan al portal en otra tarea.

Pruebas: `npm run test:tip-pools` y `TEST_REAL_DISPOSABLE=true COMPOSE_PROJECT_NAME=<stack> npm run test:tip-pools:real` (los repartos históricos se siembran en la base exclusiva del stack, porque la API ya no los crea).

## Alerta de propinas vencidas sin pagar (SPRINT-4A-T22)

`GET /tip-payment-alerts` avisa las propinas diarias No pagadas cuya fecha superó los días legales de pago (`TIP_LEGAL_PAYMENT_DAYS` del backend, 7 días hábiles por defecto y ampliables por convenio; ver `backend/README.md`). El token no llega al navegador: las páginas la leen en el servidor (`lib/tip-payment-alerts-backend.ts`), validan el contrato (`lib/tip-payment-alerts.ts`) y muestran mensajes propios, nunca los del backend.

- **`/propinas`**: panel «Propinas vencidas sin pagar» sobre el filtro, con el plazo vigente y la última fecha vencida. Por local muestra monto, cantidad de propinas y mayor atraso, y por trabajador monto, días, fecha más antigua y días de atraso. «Ver propinas vencidas» abre `/propinas?storeId=…&from=…&to=…` con el período vencido del local (si supera 62 días, desde la fecha más antigua). Al registrar el pago del período la página se vuelve a consultar y lo pagado deja de alertar.
- **`/admin/panel-ventas`**: aviso con el monto total vencido y el mayor atraso, la ficha «Propinas vencidas» y, en cada local, monto y atraso con el mismo enlace a `/propinas`. Ya no enlaza a `/propinas/historico`.

Pruebas: `npm run test:daily-tips` (incluye `tip-payment-alerts.test.js`) y `npm run test:sales-overview`.

## Verificación end-to-end del flujo diario y el reparto (SPRINT-4R-T07)

`TEST_REAL_DISPOSABLE=true npm run test:daily-flow:real` recorre con API y base reales, en cuatro anchos, el flujo completo: el supervisor registra los días desde el formulario, cada día queda repartido y el contador ve el monto de cada trabajador y paga el período en `/propinas` (desde SPRINT-4A-T08; antes calculaba, validaba y entregaba el reparto por período); además comprueba que ya no existe cierre por turno ni captura de ventas o Mercado Pago. El equivalente por HTTP está en `backend/test/daily-flow-equal-pool.integration.spec.ts`. Trazabilidad con la DoD, comandos, conteos y hallazgos: [SPRINT-4R-T07](docs/SPRINT-4R-T07.md).

## Recorrido de propinas y pago (SPRINT-4A-T13)

`npm run test:tip-flow:real` (`tests/real-tip-flow`, 1440 y 390 px) recorre por la interfaz, con Next.js, NestJS y PostgreSQL reales, el flujo nuevo completo: el supervisor registra $40.000 entre tres trabajadores y él mismo (4 × $10.000 No pagadas), un día con residuo ($10.000 entre tres) y corrige un día antes del pago (se recalcula); el trabajador ve solo lo suyo como No pagada en «Mis propinas»; el contador ve la alerta legal (T22), el total diario, el detalle y descarga un Excel cuyos totales por trabajador, por día y general cuadran con la pantalla; paga del 03-11-2026 al 10-11-2026 (todo pasa a Pagado y un segundo pago responde 409); el administrador abre el período vencido desde la alerta, lo paga y la alerta desaparece; después del pago la corrección se rechaza y el trabajador ve Pagada.

Los pagos no se pueden borrar, así que corre en un stack desechable con puertos propios que se destruye al terminar:

```bash
docker compose -f docker-compose.yml -f frontend/docs/docker-compose.tip-flow-test.yml -p moifood-t13 up --build -d --wait
cd frontend
TEST_REAL_DISPOSABLE=true COMPOSE_PROJECT_NAME=moifood-t13 \
  TEST_REAL_BACKEND_URL=http://127.0.0.1:3614 TEST_REAL_FRONTEND_URL=http://127.0.0.1:3613 \
  npm run test:tip-flow:real
cd .. && docker compose -f docker-compose.yml -f frontend/docs/docker-compose.tip-flow-test.yml -p moifood-t13 down -v --rmi local
```

Con las mismas variables corren `test:daily-tips:real`, `test:daily-flow:real`, `test:daily-operations:real`, `test:my-tip-receipts:real` y `test:tip-pools:real`. Las fechas son las de la tarea: requiere que en Chile ya sea 10-11-2026 o después.

## Importación diaria de ventas (SPRINT-4R-T11)

`/admin/importacion-ventas`, solo para ADMINISTRADOR, carga el Informe de Ventas Diario de MrComanda (.xlsx, máximo 5 MB). La vista previa muestra local, fecha de negocio, emisión, medios de pago y total antes de confirmar; las ventas solo se registran al confirmar.

- Si la fecha del nombre del archivo difiere de la del contenido se avisa y se usa la del contenido.
- Un local o medio sin equivalencia, o un total que no cuadra, impide confirmar y explica qué revisar; no se guarda nada.
- Un archivo idéntico informa que ya estaba importado, sin duplicar.
- Una corrección muestra las diferencias por medio de pago contra la versión vigente y exige aceptar el reemplazo.
- El detalle indica versión, archivo, responsable y fecha de carga, y permite descargar el Excel original.

Pruebas: `npm run test:sales-imports` y `TEST_REAL_DISPOSABLE=true npm run test:sales-imports:real` (API y PostgreSQL reales; requiere `COMPOSE_PROJECT_NAME` del stack de pruebas, porque las equivalencias de locales se crean en la base).

## Panel, reportes y calendario de ventas (SPRINT-4R-T14)

Tres vistas nuevas para ADMINISTRADOR (los reportes también para CONTADOR desde SPRINT-4A-T23), registradas en `navigation.ts` (menú lateral y «Más» en móvil). Consumen los contratos de SPRINT-4R-T12 y T13 en el servidor: el token no llega al navegador.

- **`/admin/panel-ventas`** (`GET /sales-dashboard` y `GET /sales-days`): por local y día, ventas del Excel vigente, estado de importación, propinas de tarjeta y efectivo, diferencia de efectivo con signo y motivo, y alertas DT y de propinas vigentes hoy (`alertsAsOf`). «Ventas sin importar» lista los días ATRASADO y PENDIENTE de los últimos 30 días. Los días CERRADO no cuentan como faltantes y una carga tardía resuelve la alerta. En escritorio usa tablas; en móvil, fichas.
- **`/admin/reportes-ventas`** (`GET /sales-reports`): rango de hasta 366 días, de un local o de todos. Columnas dinámicas por medio de pago del catálogo; propinas y diferencias aparecen aparte; incluye detalle por día y lista de diferencias. No muestra conciliación Mercado Pago ni el histórico `/sales-reports/legacy`. Las fechas inválidas, futuras, invertidas o con un rango mayor a 366 días se explican sin consultar cifras.
- **`/admin/calendario-locales`** (BFF `/api/operating-calendars/[[...path]]`): revisa y guarda los días en que abre cada local y desde cuándo se exigen ventas; registra un cierre por excepción con fecha y motivo, o lo quita. No gestiona horarios de trabajadores.

Un dato ausente (`null`) se muestra como «Sin dato», nunca como $0. Cada fila enlaza su fuente por separado: la importación abre `/admin/importacion-ventas?importacion=<id>` con el detalle del Excel, y la operación diaria abre `/admin/panel-ventas/operaciones/<id>` (desde el panel) o `/admin/reportes-ventas/operaciones/<id>` (desde los reportes) en solo lectura.

**Revisión del contador (SPRINT-4A-T23).** Por decisión del PO, el CONTADOR tiene «Reportes de ventas» en su menú y abre en solo lectura `/admin/reportes-ventas` y el detalle `/admin/reportes-ventas/operaciones/<id>` (`getSalesReportsSession`; el backend admite ADMINISTRADOR y CONTADOR en `GET /sales-reports`). El detalle muestra la foto del voucher (BFF `/api/daily-operations/<id>/voucher`, auditado como `DAILY_OPERATION_VOUCHER_DOWNLOADED`), la propina declarada y, junto a la diferencia de efectivo y su motivo, las ventas del mismo local y día por medio de pago de la importación vigente (reporte de ese único día), o un aviso si no hay Excel vigente. Así se comprueba si un pago en efectivo se registró como tarjeta o al revés. El contador no ve el panel, la importación ni el calendario, no tiene enlaces a la importación en los reportes y nunca corrige la operación; el supervisor solo ve el voucher de su local y el trabajador no tiene acceso.

Pruebas: `npm run test:sales-overview` y `TEST_REAL_DISPOSABLE=true npm run test:sales-overview:real`. Corren contra la API y PostgreSQL reales en 1440, 360, 390 y 768 px; como en T11, necesitan `COMPOSE_PROJECT_NAME` del stack de pruebas.
