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
| `backend` | API NestJS en `http://localhost:3001`, con los archivos del gestor documental en el volumen `documents_data` | No |
| `frontend` | Web Next.js en `http://localhost:3000` | No |

Que los contenedores de `migrate` y `seed` terminen con código `0` es lo esperado.

Los puertos `5433`, `3001` y `3000` del host los publica
`docker-compose.override.yml`, que Compose combina automáticamente con
`docker-compose.yml` al usar `docker compose up` sin `-f`. El
`docker-compose.yml` por sí solo no publica puertos (solo `expose`), porque es
el que despliega Coolify (ver [Despliegue con Coolify](#despliegue-con-coolify)).

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
| `DB_PORT_HOST` | `5433` | Puerto de PostgreSQL en el host, solo en local vía `docker-compose.override.yml` (evita chocar con un PostgreSQL local en `5432`) |
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
docker compose down -v                    # detener y BORRAR la base de datos y los documentos
docker compose up --build -d db migrate backend   # verificar migraciones sobre un volumen limpio (tras down -v)
```

### Volúmenes y respaldo

Compose crea dos volúmenes nombrados, separados a propósito:

| Volumen | Contenido | Montado en |
| --- | --- | --- |
| `postgres_data` | Base de datos PostgreSQL | `db:/var/lib/postgresql/data` |
| `documents_data` | Archivos del gestor documental (contratos, anexos, finiquitos, liquidaciones) | `backend:/app/storage/documents` (`DOCUMENTS_STORAGE_PATH`) |

Ambos sobreviven a `docker compose down` y a las reconstrucciones de imagen;
solo `docker compose down -v` los borra. La documentación laboral debe
conservarse **al menos 5 años** (art. 9 bis CT), y los volúmenes viven en el
mismo disco del servidor, así que deben respaldarse **fuera** del servidor. La
base de datos guarda la ruta y el hash SHA-256 de cada archivo: hay que
respaldar **ambos volúmenes juntos** para que se correspondan.

Compose antepone el nombre del proyecto al volumen (por defecto, el nombre de
la carpeta). Para ver el nombre real: `docker volume ls | grep documents_data`.

```bash
# Respaldo de los documentos en un .tar.gz de la carpeta actual (solo lectura sobre el volumen)
docker run --rm -v <proyecto>_documents_data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/documentos-$(date +%F).tar.gz -C /data .

# Restauración (con el backend detenido: docker compose stop backend)
docker run --rm -v <proyecto>_documents_data:/data -v "$PWD":/backup:ro alpine \
  tar xzf /backup/documentos-AAAA-MM-DD.tar.gz -C /data
```

En Coolify, los volúmenes nombrados del `docker-compose.yml` se crean igual (con
el identificador del recurso como prefijo, así que pruebas y producción no los
comparten);
no usar un *bind mount* a una carpeta del host sin darle permisos de escritura
al usuario `nestjs` del contenedor, porque el backend no corre como root.

## Despliegue con Coolify

Coolify despliega el `docker-compose.yml` de la rama configurada en cada
recurso. El archivo está preparado para eso:

- **Sin `ports`:** los servicios solo declaran `expose`. Un puerto publicado se
  salta el proxy de Coolify y dejaría la base de datos o la API accesibles
  directamente en la IP del servidor. Solo el frontend recibe dominio; el
  navegador nunca llama al backend directamente (Next.js lo consulta por la red
  interna en `http://backend:3001`).
- **Sin `container_name`:** Coolify antepone el identificador del recurso a
  contenedores y volúmenes, así que el entorno de pruebas y el de producción
  conviven en el mismo servidor con base de datos y documentos propios.
- `docker-compose.override.yml` **no se usa** en Coolify: solo aplica al
  `docker compose up` local.

| Entorno | Rama | Datos |
| --- | --- | --- |
| Pruebas (Sprint Review con el cliente) | `test` | Base y volumen de documentos propios, solo datos sintéticos; **nunca datos reales** |
| Producción | `main` | Datos reales de Moi-food |

### Configurar el recurso de pruebas

1. En Coolify: **New Resource → Docker Compose** desde el repositorio de GitHub,
   rama `test`, *Base Directory* `/Fase 2/Evidencias Proyecto/Evidencias de sistema Aplicación`
   y *Docker Compose Location* `/docker-compose.yml`.
2. En **Domains**, asignar el dominio de pruebas **solo al servicio `frontend`**,
   con el puerto interno: `https://<dominio-de-pruebas>:3000`. El resto de los
   servicios queda sin dominio.
3. En **Environment Variables**, reemplazar los valores por defecto de
   `DB_PASSWORD`, `JWT_SECRET` y `ADMIN_PASSWORD` por secretos propios del
   entorno (distintos de los de producción).
4. Activar el despliegue automático (*Auto Deploy* con la GitHub App o el
   webhook) para que cada push a `test` despliegue el incremento.

Para llevar cambios al entorno de pruebas se integra `main` en `test`
(`git checkout test && git merge --ff-only main && git push`).

`migrate` y `seed` terminan tras aplicar migraciones y datos base. Si Coolify
muestra el recurso como *degraded* por esos contenedores detenidos, es
esperable: el estado real lo dan `db`, `backend` y `frontend`, que tienen
`healthcheck`.

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
| El contenedor de `migrate` termina con error | Revisar `docker compose logs migrate`. Si la base local quedó en un estado inconsistente: `docker compose down -v` y volver a levantar (borra los datos). |
| El backend no puede guardar archivos (`EACCES`) | El volumen o carpeta de `DOCUMENTS_STORAGE_PATH` no es escribible por el usuario `nestjs`. Con el volumen nombrado de Compose no ocurre; si se usa un *bind mount*, darle permisos a la carpeta del host. |
| El backend no conecta a la base desde `npm run start:dev` | `DATABASE_URL` en `backend/.env` debe apuntar a `localhost:5433`, no a `db:5432` (ese host solo existe dentro de la red Docker). |
| El frontend no llega a la API tras cambiar `NEXT_PUBLIC_API_URL` | Es una variable de compilación: reconstruir con `docker compose up --build frontend`. |
| Login falla con el administrador por defecto | El seed no sobrescribe un administrador existente; si cambió su contraseña, usar la nueva o recrear la base con `docker compose down -v`. |

## Más documentación

- [`AGENTS.md`](AGENTS.md): convenciones de código y flujo de trabajo del equipo.
- [`backend/README.md`](backend/README.md): autenticación, roles, usuarios, auditoría y Swagger.
- [`backend/docs/modelo-datos.md`](backend/docs/modelo-datos.md): modelo de datos completo.
