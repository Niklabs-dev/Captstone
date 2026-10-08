# Frontend Moi-food

Aplicación Next.js 16 con App Router, TypeScript estricto y Tailwind CSS.

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
- `/dashboard`, `/admin/*` y `/portal/*` pasan por `src/proxy.ts`.
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
- El destino de esta tarea es `/dashboard` para todos los roles.
  La redirección por rol y sus vistas corresponden a SPRINT-1-T11.

El usuario inicial lo configura el seed del backend. No se incorporan cuentas
ni contraseñas de demostración al frontend.

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

`test:integration` requiere un build previo y prueba el frontend compilado en
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
