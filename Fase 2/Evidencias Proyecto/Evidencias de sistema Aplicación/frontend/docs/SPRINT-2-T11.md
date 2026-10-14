# SPRINT-2-T11 — Panel de alertas de registro en la DT

Entrega independiente del frontend. `/admin/alertas-dt` permite al administrador
consultar contratos próximos a vencer y vencidos, filtrar por trabajador/contrato,
local y estado, y confirmar que el registro ya se realizó en la DT.
Referencia visual: Panel de alertas del mockup del proyecto (paleta, tipografía,
estructura administrativa y separación por severidad). No incluye alertas de
caja, inventario o propinas ni datos del mockup en producción.

## Alcance y dependencia

Ficha 3f0dcd61-e2b1-81fd-8db3-f2fd194fc0c8, Sprint 2, E1-H3, 3 horas.
Depende de SPRINT-2-T08 backend para calcular plazos y guardar el registro.
El frontend NO calcula el plazo legal de 15 días: muestra deadline, daysRemaining
y status del servidor. La fecha límite es calendario YYYY-MM-DD y no se desplaza
por zona horaria. calculatedAt identifica cuándo se consultaron los plazos.
El listado se ordena por días restantes, colocando los vencidos primero.

La ruta está limitada a administradores mediante proxy y revalidación de sesión
activa existente. La API real deberá autorizar rol/local en cada operación.
No se serializan tokens al cliente ni se incluyen RUT, correo o archivos.
El BFF provisional `/api/dt-alerts` comprueba sesión/origen de POST y responde
503 hasta conectar T08. No registra contratos ni tiene modo de simulación.

## Contrato interno propuesto (pendiente de Swagger)

- GET `/api/dt-alerts`: `{ items: DtAlert[], calculatedAt: ISO-con-zona }`.
- POST `/api/dt-alerts/:alertId/registration`: `{ documentId, revision }`.
- Confirmación: `{ alertId, documentId, status: REGISTERED, registeredAt }`.
- DtAlert: id, documentId, contractTitle, worker {id,name}, store {id,name},
  deadline, daysRemaining (entero), status UPCOMING/OVERDUE, revision y canRegister.

El contrato supone un listado completo. Confirmar paginación, alcance por rol,
umbral de próximos a vencer, definición de días, revisión/concurrencia, errores
y auditoría con T08 antes de conectar el adaptador `dt-alerts-client.ts`.
Los identificadores son UUID; se rechazan duplicados, fechas inválidas, estados
incoherentes y respuestas de confirmación para otro contrato.
revision es un identificador opaco para el control de concurrencia del servidor;
el cliente no sustituye transacciones ni idempotencia de la API.

La acción abre un diálogo con trabajador, contrato, local y fecha límite. Exige
una confirmación explícita de que el registro externo ya ocurrió. No envía el
contrato a la Dirección del Trabajo. Bloquea doble envío y cierre durante el
guardado. Solo retira la alerta tras una respuesta válida y vinculada; ante
409/error mantiene la alerta y permite cancelar, actualizar y volver a consultar.
canRegister=false habilita solo consulta. No hay éxito optimista ni estado falso
de cero alertas cuando falla el servicio.

## Pruebas

```powershell
npm ci
npm run test:dt-alerts
npm run lint
npm run format:check
npm run build
docker build --target build -t capstone-s2-t11-build .
docker run -d --name capstone_s2_t11_preview -p 3111:3000 capstone-s2-t11-build sh -c 'node tests/dt-alerts/backend.mjs & BACKEND_INTERNAL_URL=http://127.0.0.1:3146 npm run start -- --port 3000'
npm run test:dt-alerts:e2e
```

No hay dependencias nuevas. TEST_DT_ALERTS_URL configura la URL del navegador.
El backend de autenticación/usuarios de pruebas escucha solo dentro del contenedor.
Playwright intercepta las respuestas DT exclusivamente en los escenarios simulados.
Un escenario separado comprueba las guardas HTTP sin interceptar DT: sesión,
roles, origen, métodos y 503 honesto. No se usa PostgreSQL ni registros reales.
Capturas en output/playwright/dt-alerts, ignoradas por git y Docker.

## Evidencia ejecutada — 14 de octubre de 2026

- 10 pruebas unitarias de alertas y 18 de regresión de autenticación/navegación: pasan.
- 10 escenarios Playwright escritorio/móvil: pasan. Tras ajustar distribución móvil, los dos escenarios visuales se repitieron y pasan.
- Compilación de producción Docker, lint y formato de frontend/backend: pasan.
- Capturas de escritorio/móvil revisadas; confirmación visual tras un ajuste de distribución.
- Playwright CLI: login y panel con 503 esperado, sin respuestas DT interceptadas.
- Detector visual: advertencia de borde lateral conservado porque el mockup usa .alert.sev-crit/.sev-warn con ese recurso de severidad.

Estado: frontend preparado para revisión, integración NestJS/PostgreSQL pendiente.
No marcar Hecho hasta conectar T08, probar la integración real y recibir aprobación.
El tablero vivo no se modificó por falta de acceso a Notion; seguimiento local.