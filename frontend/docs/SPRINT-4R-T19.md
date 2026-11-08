# SPRINT-4R-T19 — Playwright contra la API real sin EACCES ni permisos abiertos

Las suites `real-*` alteran y retiran archivos del almacenamiento del backend
para probar «archivo alterado» (`ALTERED`) y «archivo ausente» (`MISSING`).
`docker-compose.test.yml` monta `frontend/output/real-api/storage` en el
backend mediante un *bind mount*, así que el dueño de esos archivos decide si
Playwright puede tocarlos o si recibe `EACCES` (permiso denegado).

## Diagnóstico

| Problema | Riesgo |
| --- | --- |
| Seis workflows hacían `chmod 0777` sobre la carpeta de almacenamiento de pruebas. | Permisos abiertos a cualquier usuario del sistema: la «solución» insegura que la tarea prohíbe. Además era innecesaria, porque el backend ya corría con el UID del runner. |
| `docker-compose.test.yml` usaba el usuario `1001:1001` si no se definían `CI_UID`/`CI_GID`. | En un Linux cuyo usuario no es 1001 (lo habitual es 1000) los archivos quedaban a nombre de otro usuario y Playwright fallaba con `EACCES` sin explicación. |
| Si la carpeta no existía antes de levantar Docker, Docker la creaba como root. | El backend (no root) no podía escribir y fallaba con `EACCES`. |

## Corrección

- `docker-compose.test.yml` **exige** `CI_UID` y `CI_GID` (sin valor por
  defecto): sin ellas Compose se detiene con un mensaje que indica usar
  `id -u` / `id -g`. El compose principal no las exige.
- `frontend/scripts/prepare-real-storage.mjs` crea la carpeta a nombre de
  quien ejecuta las pruebas con permisos `0700`, verifica en Linux/macOS que
  `CI_UID`/`CI_GID` coincidan con ese usuario y que la carpeta no pertenezca a
  otro (por ejemplo, root), y prueba la escritura. Falla con instrucciones en
  cada caso.
- Los seis workflows usan ese script en lugar de `chmod 0777`.
- Workflow nuevo `.github/workflows/sprint-4r-t19-playwright-permisos.yml` con
  la verificación y la evidencia de abajo.
- No se corre nada como root ni se abren permisos: el backend mantiene sus
  permisos privados (carpetas `0700`, archivos `0600`) y comparte UID/GID con
  quien ejecuta las pruebas.

## Evidencia

### Script de preparación (Linux simulado en `node:24-alpine`)

| Escenario | Resultado |
| --- | --- |
| Usuario 1000 con `CI_UID`/`CI_GID` correctos | Carpeta lista, `700`, dueño `1000:1000`. |
| Usuario 1000 sin `CI_UID` | Se detiene: «CI_UID es (sin definir) y debe ser 1000… Ejecuta: export CI_UID="$(id -u)" CI_GID="$(id -g)"». |
| Carpeta creada antes por root | Se detiene: «pertenece al UID 0 y no al usuario actual (1000)… elimínala». |
| Carpeta propia que quedó en `0777` | La deja en `700`. |

En Windows (Docker Desktop) crea la carpeta y prueba la escritura; los dueños
de archivo no se aplican a los *bind mounts* en esa plataforma, por eso la
comprobación real se hace en el CI de Ubuntu.

### CI de GitHub Actions — run 42458272517 (commit `de9d192`)

Ambiente:

| Dato | Valor |
| --- | --- |
| Fecha (UTC) | 2026-11-08 07:20 |
| Sistema | Ubuntu 24.04 (kernel Linux 7.0.0-1017-azure x86_64) |
| Usuario del runner | `uid=1001(runner) gid=1001(runner)` |
| Usuario del backend | `1001:1001` (igual al runner; distinto de root) |
| Node / Docker / Compose / Playwright | v24.22.2 / 28.0.4 / 2.38.2 / 1.64.0 |

Comandos (desde la carpeta de la aplicación, con
`COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.test.yml`
y `CI_UID`/`CI_GID` = `id -u`/`id -g`):

```bash
node frontend/scripts/prepare-real-storage.mjs
docker compose up --build -d
docker compose exec -T backend id -u   # debe ser igual a CI_UID
cd frontend && node scripts/prepare-real-api.mjs
npx playwright test --config playwright.real-api.config.ts --reporter=line,junit
npx playwright test --config playwright.my-documents.config.ts --reporter=line,junit
```

Resultados:

| Verificación | Resultado |
| --- | --- |
| `real-api` (incluye liquidación con archivo ausente) | 8 pruebas: 8 aprobadas, 0 fallas, 0 omitidas |
| `real-my-documents` (archivo alterado y ausente para TRABAJADOR y SUPERVISOR en 1440, 768, 390 y 360 px) | 8 pruebas: 8 aprobadas, 0 fallas, 0 omitidas |
| Archivos creados en el almacenamiento | 74 |
| Entradas de otro dueño | 0 |
| Entradas con permisos de grupo u otros | 0 (carpetas `700`, archivos `600`, todos `runner:runner`) |
| Apariciones de `EACCES` en logs de Docker y Playwright | 0 |

La primera corrida (run 42457879063) aprobó las suites, los permisos y la
ausencia de `EACCES`, pero el paso de verificación falló por la propia
herramienta: `find … | head -20` cerraba la tubería y, con `pipefail`, el
`SIGPIPE` (código 141) hacía fallar el paso aunque las tres cuentas dieran
cero. Se reprodujo en Ubuntu y se reemplazó por `sed -n '1,20p'`.

El artefacto `sprint-4r-t19-evidencia-<run>` del workflow guarda
`ambiente.txt`, `permisos.txt`, los reportes JUnit, los logs de Compose y las
capturas de Playwright (incluidas `archivo-alterado.png` y
`archivo-ausente.png`).

## Archivos temporales

`frontend/output/` está en `.gitignore`: el almacenamiento sintético, los
fixtures, los reportes y las capturas que generan las pruebas no se
commitean.
