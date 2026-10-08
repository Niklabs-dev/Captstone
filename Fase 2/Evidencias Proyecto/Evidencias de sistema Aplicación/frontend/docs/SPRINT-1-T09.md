# SPRINT-1-T09 — Login, tokens y rutas protegidas

Estado local: **Implementación verificada; pendiente de envío y revisión**.
No se cambió el estado del tablero original: Notion no permite acceder a la página.
La tarea no se marca como Hecho hasta la revisión y aceptación del usuario.

## Rama y alcance

- Rama: `feat/sprint-1-t09-login-jwt`.
- Base: `origin/main`, commit `500e679`.
- Worktree: `.worktrees/sprint-1-t09`.
- Login con NestJS, cookies HttpOnly, renovación y cierre de sesión.
- Rutas verificadas mediante `GET /auth/me`; rechazo de JWT falsificado.
- Destino común `/dashboard`; la redirección por rol corresponde a SPRINT-1-T11.
- Conexión servidor a servidor configurada en Docker Compose.
- Corrección de origen público en Next.js standalone, detectada por la prueba real.

## Validación — 8 de octubre de 2026

| Comprobación | Resultado |
| --- | --- |
| Frontend: lint y formato | Aprobados |
| Frontend: pruebas unitarias | 13 aprobadas |
| Frontend: flujo HTTP simulado | Aprobado |
| Frontend: flujo HTTP con Next.js, NestJS y PostgreSQL reales | Aprobado |
| Frontend y backend: build en Docker | Aprobados |
| Backend: lint, formato y build local | Aprobados |
| Migraciones en volumen nuevo | Las 3 migraciones aplicadas correctamente |
| Seed | Roles, tipos de documento y administrador creados |
| Suite completa de backend con PostgreSQL | 86 aprobadas, 2 fallidas, 52 omitidas; 5 suites con fallos de inicialización |
| Suite e2e de backend | 1 prueba fallida por inicialización de dependencias |

La prueba real verifica credenciales incorrectas, login correcto, cookies protegidas,
acceso al dashboard, rechazo de JWT falso, rotación y rechazo de reutilización del
refresh token, rechazo de logout desde otro origen y cierre de sesión.

No se modificó el código del backend. Los avisos de formato del checkout se
corrigieron normalizando sus finales de línea, sin cambios de contenido en Git.

## Docker instalado y entorno disponible

Docker Desktop 4.94.0 instalado para el usuario, Docker Engine 29.8.2,
Compose 5.5.1 y WSL 2.6.1. Motor iniciado y contenedores en ejecución.

- Frontend: http://localhost:3100/login
- Backend: http://localhost:3101
- PostgreSQL: localhost:5433
- Proyecto Compose: `capstone-sprint1-t09`
- Volumen nuevo: `capstone-sprint1-t09_postgres_data`
- Configuración de puertos: `frontend/docs/docker-compose.test.yml`

Se usaron puertos alternativos porque el puerto 3001 está ocupado por un proceso
previo del computador, que no se detuvo.

```powershell
docker compose -p capstone-sprint1-t09 -f docker-compose.yml -f frontend/docs/docker-compose.test.yml up --build -d
docker compose -p capstone-sprint1-t09 -f docker-compose.yml -f frontend/docs/docker-compose.test.yml ps --all
```

La instalación limpia del backend funciona en la imagen Node 24 con npm 11.
El error anterior de `npm ci` ocurrió con el npm 10 instalado en Windows;
no fue necesario cambiar su lockfile.

## Pendientes independientes

1. Revisar la configuración de pruebas del backend. Durante las pruebas, NestJS
   recibe dependencias de constructor indefinidas (ConfigService y AppService).
   Los errores apuntan a los metadatos de decoradores durante la transformación
   de TypeScript en Vitest; el backend compilado y ejecutado en Docker sí funciona.
2. Adaptar `test/prisma-schema.spec.ts`: `execFileSync('npx', ...)` produce
   `spawnSync npx ENOENT` en Windows.
3. Resolver la autenticación de GitHub CLI para abrir el PR.
4. Registrar hash y comentario en Notion cuando se habilite el acceso.

Los problemas de pruebas del backend requieren una tarea y rama independientes,
según la regla de AGENTS.md de no mezclar varias tareas en un PR. La DoD global
del incremento continúa pendiente de esa revisión, aprobación y merge.

## Descripción preparada para el PR

Título: `feat: implementa login y sesiones protegidas (SPRINT-1-T09)`

El frontend incorpora login conectado a NestJS, tokens en cookies HttpOnly y
validación de JWT antes de mostrar rutas protegidas. Permite renovar y cerrar la
sesión y maneja errores de credenciales o conexión. La validación real en Docker
detectó y corrigió la comparación de origen con el host interno de Next.js.

Validado: 13 pruebas unitarias, flujo HTTP simulado, flujo con los tres servicios
reales, lint, formato, builds Docker, migraciones y seed sobre un volumen nuevo.
La suite existente del backend tiene fallos independientes de inicialización
de dependencias y ejecución de npx en Windows; quedan registrados para otra tarea.

## Diseño según el mockup

Referencia: `Fase 1/Evidencias Grupales/Documentación del proyecto/Adicionales/Mockup/index.html`.
El acceso y la pantalla de sesión adoptan la paleta salmón y crema, tarjetas
blancas, bordes cálidos y tipografías Inter / JetBrains Mono. Se reutiliza el
logo del mockup en `public/logo.png`. El mockup no contiene una vista de login;
el formulario adapta su lenguaje visual manteniendo los estados de error,
carga y renovación de sesión. Los módulos posteriores deben seguir esta referencia.

El lint y formato del frontend y backend pasan. La compilación local encontró
un bloqueo EPERM en `.next/diagnostics`; la compilación de producción se valida
en Docker. No se cambia la lógica de autenticación.

Validación posterior al ajuste visual: build de producción Docker y prueba
de login, renovación y logout contra frontend, NestJS y PostgreSQL reales aprobados.
