# Sistema de Gestión Interna "Moi-food" — Capstone Subway

Sistema web de gestión interna para el franquiciado de Subway **Moi-food**
(locales de Melipilla y Calera): usuarios y roles, auditoría, gestor documental,
propinas, ventas y caja, inventario y Portal del Trabajador.

| Componente | Tecnología | Carpeta | Puerto local |
| --- | --- | --- | --- |
| Base de datos | PostgreSQL 16 | — (imagen oficial) | `5433` (host) → `5432` (contenedor) |
| API | NestJS + Prisma | [`backend/`](backend/README.md) | `3001` |
| Web | Next.js (App Router) + Tailwind | [`frontend/`](frontend/README.md) | `3000` |

## Requisitos

- **Docker** con **Docker Compose v2** (`docker compose version`).
- **Node.js 24** y npm, solo para desarrollar fuera de Docker (las imágenes usan `node:24-alpine`).
- **Git**.

## Opción 1: levantar todo con Docker (recomendado)

Desde esta carpeta (donde está `docker-compose.yml`):

```bash
docker compose up --build
```

No hay pasos manuales: Compose levanta los servicios en este orden y cada uno
espera al anterior.

| Servicio | Qué hace | Termina |
| --- | --- | --- |
| `db` | PostgreSQL con volumen persistente `postgres_data` | No (queda corriendo) |
| `migrate` | `prisma migrate deploy`: aplica las migraciones pendientes | Sí |
| `seed` | `prisma db seed`: roles, tipos de documento y administrador inicial (idempotente) | Sí |
| `backend` | API NestJS en `http://localhost:3001` | No |
| `frontend` | Web Next.js en `http://localhost:3000` | No |

Que `subway_migrate` y `subway_seed` terminen con código `0` es lo esperado.

### Verificar que quedó funcionando

| Qué | Dónde |
| --- | --- |
| Web | <http://localhost:3000> |
| API (estado) | <http://localhost:3001> |
| Swagger UI | <http://localhost:3001/api/docs> |
| Esquema OpenAPI (JSON) | <http://localhost:3001/api/docs-json> |

Credenciales iniciales (**solo desarrollo**, cambiarlas en el primer inicio):
`admin@moi-food.cl` / `admin-cambiar-en-produccion`.

```bash
curl -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@moi-food.cl","password":"admin-cambiar-en-produccion"}'
```

### Variables de Compose

Todas tienen un valor por defecto para desarrollo. Para cambiarlas, crear un
archivo `.env` junto a `docker-compose.yml` (nunca se commitea):

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `postgres` / `cambiar-en-produccion` / `subway_gestion` | Credenciales de PostgreSQL |
| `DB_PORT_HOST` | `5433` | Puerto de PostgreSQL en el host (evita chocar con un PostgreSQL local en `5432`) |
| `JWT_SECRET` | `dev-secret-cambiar-en-produccion` | Firma de los access tokens |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | `1d` / `7d` | Vida del access token y del refresh token |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@moi-food.cl` / `admin-cambiar-en-produccion` | Administrador creado por el seed |
| `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` | `Administrador` / `Moi-food` | Nombre del administrador |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | URL de la API que usa el navegador (se fija al construir la imagen del frontend) |

En producción **todos** los secretos (`DB_PASSWORD`, `JWT_SECRET`, `ADMIN_PASSWORD`)
deben reemplazarse.

### Comandos frecuentes

```bash
docker compose up --build -d              # en segundo plano
docker compose logs -f backend            # ver logs de un servicio
docker compose ps                         # estado de los servicios
docker compose down                       # detener (conserva los datos)
docker compose down -v                    # detener y BORRAR la base de datos
docker compose up --build -d db migrate backend   # verificar migraciones sobre un volumen limpio (tras down -v)
```

## Opción 2: desarrollo local (sin Docker para la app)

Útil para trabajar con recarga en caliente. La base de datos sigue corriendo en Docker.

```bash
# 1. Base de datos
docker compose up -d db

# 2. Backend (http://localhost:3001)
cd backend
cp .env.example .env              # ajustar valores si es necesario
npm install                       # genera el cliente Prisma (postinstall)
npm run prisma:migrate:deploy     # aplica migraciones
npm run prisma:seed               # datos base (idempotente)
npm run start:dev

# 3. Frontend (http://localhost:3000), en otra terminal
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Las variables de cada proyecto están documentadas en
[`backend/.env.example`](backend/.env.example) y
[`frontend/.env.example`](frontend/.env.example).

## Calidad antes de commitear

En `backend/` y en `frontend/`:

```bash
npm run lint && npm run format:check
npm run build
```

En `backend/`, además, los tests (Vitest). Los de integración corren contra
PostgreSQL real, revierten su transacción y se omiten si no se define
`TEST_DATABASE_URL` (debe ser un superusuario, como el `postgres` de Compose):

```bash
TEST_DATABASE_URL="postgresql://postgres:cambiar-en-produccion@localhost:5433/subway_gestion" npm run test
```

## Problemas comunes

| Síntoma | Causa y solución |
| --- | --- |
| `port is already allocated` en `5433`, `3000` o `3001` | Otro proceso usa el puerto. Detenerlo, o cambiar `DB_PORT_HOST` para la base de datos. |
| `subway_migrate` termina con error | Revisar `docker compose logs migrate`. Si la base local quedó en un estado inconsistente: `docker compose down -v` y volver a levantar (borra los datos). |
| El backend no conecta a la base desde `npm run start:dev` | `DATABASE_URL` en `backend/.env` debe apuntar a `localhost:5433`, no a `db:5432` (ese host solo existe dentro de la red Docker). |
| El frontend no llega a la API tras cambiar `NEXT_PUBLIC_API_URL` | Es una variable de compilación: reconstruir con `docker compose up --build frontend`. |
| Login falla con el administrador por defecto | El seed no sobrescribe un administrador existente; si cambió su contraseña, usar la nueva o recrear la base con `docker compose down -v`. |

## Más documentación

- [`AGENTS.md`](AGENTS.md): convenciones de código y flujo de trabajo del equipo.
- [`backend/README.md`](backend/README.md): autenticación, roles, usuarios, auditoría y Swagger.
- [`backend/docs/modelo-datos.md`](backend/docs/modelo-datos.md): modelo de datos completo.
