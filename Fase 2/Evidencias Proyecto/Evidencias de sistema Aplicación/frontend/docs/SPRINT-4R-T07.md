# SPRINT-4R-T07 — Verificación end-to-end del flujo diario y el reparto equitativo

Valida como **un único flujo** lo construido en SPRINT-4R-T01 a T06: propinas,
comprobante (voucher), diferencia de efectivo, participantes, cálculo del
reparto y detalle por trabajador. Sustituye la verificación del antiguo cierre
de caja por turno (E3-H1) y conserva la verificación del detalle del reparto
equitativo.

## Enfoque

Antes de escribir pruebas se inventariaron las existentes de T01–T06 para no
duplicarlas. La cobertura por módulo ya era amplia, pero faltaba:

1. Un recorrido único donde **el mismo dato** viaje del formulario del
   supervisor al cálculo del contador, a la entrega y a la constancia del
   trabajador (los specs de reparto sembraban las operaciones por API).
2. Una comprobación explícita de que **no existe un segundo cierre** ni la
   captura de ventas o vouchers de Mercado Pago.
3. La diferencia **positiva** con motivo registrada desde la interfaz.
4. Un test de integración que encadene todo por HTTP con un día en cero,
   tarjeta + efectivo y la comprobación de que los históricos no cambian.

Se agregaron:

| Archivo | Tipo | Qué recorre |
| --- | --- | --- |
| `backend/test/daily-flow-equal-pool.integration.spec.ts` | Integración HTTP + PostgreSQL real (`withinRollback`) | 3 días por la API (tarjeta + efectivo con voucher y sobrante; solo efectivo con faltante; día en cero), reintento idéntico, cálculo, corrección y recálculo en DRAFT, confirmación, pago, constancias, portal de cada trabajador, congelación en CONFIRMED/PAID, auditoría del ciclo, históricos intactos y rutas del flujo antiguo inexistentes. |
| `frontend/tests/real-daily-flow/daily-flow.spec.ts` | Playwright con API y base reales, 4 anchos | Supervisor registra 2 días desde el formulario (vista previa exacta, voucher, sobrante y faltante con motivo, participantes distintos), reintento por el BFF, contador calcula/valida/entrega con conciliación exacta, cada trabajador ve su monto en el portal, corrección posterior rechazada con mensaje claro. Además, menú, formulario y BFF sin cierre por turno ni ventas/Mercado Pago. |

Los montos esperados no se escriben a mano: se calculan con la regla
documentada del calculador (base para todos y el peso extra en la posición
`díaDesdeEpoch mod n` del orden por ID), de modo que la prueba verifica peso a
peso a quién le toca el residuo.

## Trazabilidad con la DoD

| Criterio de la DoD | Dónde se verifica |
| --- | --- |
| Playwright: login de SUPERVISOR, propinas, foto válida, diferencia positiva y negativa con motivo, participantes, guardado, reintento y detalle | `real-daily-flow/daily-flow.spec.ts` (flujo completo); validaciones del formulario y doble envío en `real-daily-operations/daily-operations.spec.ts` |
| No existe segundo cierre ni captura de ventas/vouchers Mercado Pago en el flujo del supervisor | `real-daily-flow` (menú, formulario y BFF `/api/cash-closings`, `/api/sales` → 404); `daily-flow-equal-pool` (POST `/cash-closings`, `/close`, `/vouchers`, `/sales` → 404 y campos `mercadoPago*`, `mrcomandaNetSales`, `shift` → 400) |
| Integración PostgreSQL: $10.000 entre 3, monto cero, tarjeta + efectivo, varios días con participantes distintos, conciliación exacta | `daily-flow-equal-pool` (todo en un flujo por HTTP); `tip-pools.integration.spec.ts` (casos aislados del calculador) |
| Rechazos: archivo inválido, lista vacía con fondo, duplicados, inactivos, otro local, otro supervisor, acceso directo indebido | `daily-operations-api.integration.spec.ts` (firma/tipo/tamaño del voucher, selección vacía con fondo, duplicados, no elegibles, supervisor de otro local, roles y anónimos); `upload-hardening.integration.spec.ts`; `real-daily-operations` (BFF, roles y páginas); `real-tip-pools/equal-pools` (supervisor solo lectura) |
| Idempotencia, concurrencia, recálculo DRAFT, inmutabilidad de CONFIRMED/PAID y constancias | `daily-flow-equal-pool` (reintento, recálculo, congelación tras confirmar y pagar); `daily-operations-concurrency.integration.spec.ts`; `tip-pools.integration.spec.ts`; `tip-pools-actions.integration.spec.ts` (triggers de inmutabilidad y constancias) |
| Repartos proporcionales históricos y cierres antiguos conservados sin cambios | `daily-flow-equal-pool` (foto completa antes/después de un cierre CLOSED con línea, voucher y venta, y de un reparto proporcional); `tip-pools*.integration.spec.ts` (seed demo); `cash-closings-api.integration.spec.ts` (lectura histórica) |
| Lint, formato, builds y regresión con API real; evidencia con comandos, conteos y defectos | Secciones siguientes |

## Entorno de ejecución

| Dato | Valor |
| --- | --- |
| Fecha | 2026-11-09 |
| Sistema | Windows 11 (Docker Desktop), Git Bash |
| Node / Playwright | v24.19.0 / 1.64.0 |
| PostgreSQL | 16 (contenedor `db` del compose) |
| Rama / commits | `feat/sprint-4r-t07-e2e-flujo-diario` · `b4b540e`, `3484bf3`, `283f96b` |

Para no ensuciar la base de desarrollo, la regresión con API real usó una
**base exclusiva y desechable** en el mismo contenedor, eliminada al terminar:

```bash
# Base exclusiva
docker compose exec -T db psql -U postgres -c "CREATE DATABASE subway_t07_e2e"
cd backend
DATABASE_URL=postgresql://postgres:<clave>@localhost:5433/subway_t07_e2e npx prisma migrate deploy
DATABASE_URL=... npm run prisma:seed
npm run build
PORT=3341 DATABASE_URL=... JWT_SECRET=<secreto de prueba> DOCUMENTS_STORAGE_PATH=<carpeta temporal> node dist/main

# Frontend apuntando a ese backend
cd ../frontend && npm run build
BACKEND_INTERNAL_URL=http://127.0.0.1:3341 npx next start -p 3342 -H 127.0.0.1

# Pruebas
export TEST_REAL_DISPOSABLE=true TEST_REAL_BACKEND_URL=http://127.0.0.1:3341 TEST_REAL_FRONTEND_URL=http://127.0.0.1:3342
npm run test:daily-flow:real
npx playwright test --config playwright.daily-operations.config.ts --grep-invert "Local desactivado"
npx playwright test --config playwright.tip-pools.config.ts equal-pools

# Al terminar
docker compose exec -T db psql -U postgres -c "DROP DATABASE subway_t07_e2e"
```

Los tests de integración del backend corren contra la base de desarrollo con
`TEST_DATABASE_URL` y revierten su transacción: no dejan datos.

## Resultados

### Pruebas nuevas

| Suite | Resultado |
| --- | --- |
| `daily-flow-equal-pool.integration.spec.ts` | 2/2 |
| `real-daily-flow` (desktop, mobile-360, mobile-390, tablet-768) | 8/8 (2 tests × 4 anchos) |

### Regresión con API real (Playwright, 4 anchos)

| Suite | Resultado |
| --- | --- |
| `real-daily-operations` (sin «Local desactivado») | 16/16 |
| `real-tip-pools/equal-pools` | 12/12 |
| `real-tip-pools/pools.spec.ts` y test «Local desactivado…» | **No ejecutados** (ver limitaciones) |

### Backend

| Comando | Resultado |
| --- | --- |
| 11 suites relacionadas (`daily-flow-equal-pool`, `daily-operations-api`, `daily-operations-concurrency`, `daily-operation-participants-model`, `tip-pools`, `tip-pools-actions`, `tip-pool-equitable-model`, `participants-daily-migration`, `my-tip-receipts`, `cash-closings-api`, `upload-hardening`) | 191/191 |
| `npx vitest run --no-file-parallelism` (suite completa, en serie) | 1.071 pasan · 2 fallan · 1 omitido; el primero corregido en esta tarea y el segundo propio de Windows (ver defectos) |
| `daily-operations-concurrency` tras la corrección | 15/15 ejecuciones |
| `npm run lint` · `npm run build` · `npx prisma validate` | Sin errores |

### Frontend

| Comando | Resultado |
| --- | --- |
| `npm run test:daily-operations` | 50/50 |
| `npm run test:tip-pools` | 29/29 |
| `npm run test:my-tip-receipts` | 26/26 |
| `npm run lint` · `npm run build` | Sin errores |

`npm run format:check` (frontend y backend) informa archivos en un checkout de
Windows con `core.autocrlf=true`: el repositorio guarda LF y la copia local
CRLF. Con `prettier --check --end-of-line auto` todos los archivos cumplen el
estilo; no hay diferencias de formato reales.

## Defectos y hallazgos

| # | Severidad | Hallazgo | Estado |
| --- | --- | --- | --- |
| 1 | Media (pruebas) | `daily-operations-concurrency › carrera con selección distinta` fallaba de forma intermitente (3 de 8): asumía que siempre ganaba la petición con dos participantes. La API respondía bien (201 + 409 sin duplicar). | **Corregido** en `283f96b`; 15/15 ejecuciones. |
| 2 | Baja | El BFF de `PATCH /api/daily-operations/:id` reemplaza todo 409 del backend por el mensaje genérico «Ya existe una operación registrada para esta fecha…». La interfaz no se ve afectada: el panel muestra su propio mensaje correcto («…reparto confirmado o pagado…»), verificado en `real-daily-flow`. Solo el JSON crudo del BFF es impreciso. | Abierto; propuesto como tarea nueva. |
| 3 | Baja (entorno) | `prisma-schema.spec.ts › el schema de Prisma es válido` llama a `npx` sin shell y falla en Windows (`spawnSync npx ENOENT`). En Linux/Docker pasa; `npx prisma validate` confirma el schema. | Abierto; propuesto como tarea nueva. |
| 4 | Baja (pruebas) | Con la suite completa del backend **en paralelo**, varios archivos (`sales-imports-model`, `tip-pools*` con el seed demo) chocan con *deadlocks* / conflictos de escritura en PostgreSQL. Ocurre también sin los archivos de esta tarea; en serie no aparece. | Abierto; propuesto como tarea nueva. |

**No quedan defectos críticos ni altos abiertos** en el flujo diario ni en el
reparto equitativo. Ningún resultado de esta evidencia proviene de mocks
presentados como integración: los dos archivos nuevos usan el pipeline HTTP
completo de NestJS y PostgreSQL real, y Playwright usa backend y base reales.

## Limitaciones

- `real-tip-pools/pools.spec.ts` y el test «Local desactivado después de abrir
  la vista» de `real-daily-operations` preparan datos con
  `docker compose exec db psql` sobre la base por defecto del compose. Contra
  una base exclusiva distinta no aplican, y contra la de desarrollo la
  ensuciarían; requieren un stack de compose dedicado
  (`COMPOSE_PROJECT_NAME` propio), como en los workflows anteriores. Su
  cobertura (histórico proporcional y local desactivado) queda respaldada por
  los tests de integración del backend.
- La concurrencia real (dos conexiones simultáneas) se verifica en
  `daily-operations-concurrency` y en `tip-pools*`; el recorrido completo usa
  una sola transacción revertible. Por eso los rechazos de los triggers se
  aíslan con `SAVEPOINT` en `daily-flow-equal-pool`.

## Capturas

Playwright guarda capturas por ancho en
`frontend/output/playwright/daily-flow/<proyecto>/` (`dia-1.png`, `dia-2.png`,
`reparto-entregado.png`, `correccion-rechazada.png`). La carpeta `output/` está
en `.gitignore` y no se commitea.
