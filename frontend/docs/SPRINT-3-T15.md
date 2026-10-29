# SPRINT-3-T15 — Reparto de propinas del contador

Ruta: `/propinas/repartos`. Contador: consulta y calcula por local y período,
registra observaciones en borradores, confirma montos y registra la entrega
con fecha de pago y constancias PDF por trabajador. Administrador: consulta
los mismos datos y descarga constancias, sin controles de escritura.
Supervisor y trabajador no tienen acceso a esta vista ni a su BFF.

La pantalla reutiliza el layout, controles, diálogos y tablas de DESIGN.md.
Muestra pacto, horas, responsables, conciliación en CLP y observación vigente.
Confirmar, recalcular y pagar requieren confirmación explícita. Observaciones,
confirmación y pago envían expectedVersion; un 409 bloquea acciones hasta
actualizar la foto. Los fallos conservan los campos; una sesión vencida usa la recuperación
común. Las constancias se ofrecen solo en repartos PAID.

Las alertas se consultan desde T14; sus fechas y días hábiles proceden de la
API y del calendario configurado en backend. No se recalcula el plazo en el
navegador. Pagar actualiza las alertas; se descartan respuestas anteriores.

## Contrato y permisos

Se añade `GET /tip-pools?storeId&periodStart&periodEnd` para consultar la foto
existente sin calcular ni escribir. Acepta los mismos filtros de fecha/local
que la vista previa; responde lista vacía o reparto. Solo contador y
administrador. Swagger documenta la consulta. No hay migraciones nuevas.

El BFF `/api/tip-pools/[[...segments]]` admite únicamente las rutas conocidas,
valida sesión y rol, UUID y fechas reales, cuerpos JSON de hasta 4096 bytes,
origen de mutaciones y claves permitidas. Verifica la respuesta, correlaciona
local/período e identidad del reparto, proyecta personas y evita mensajes
arbitrarios de backend. Los códigos 422 se traducen mediante una lista de
causas conocidas; otros errores usan mensajes públicos.

## Validación

- `npm run test:tip-pools`: validación de contratos, fechas, conciliación,
  proyección, constancias, acciones y navegación.
- `npm run test:tip-pools:real`: Chromium a 360, 390, 768 y 1440 px contra
  Next.js, NestJS y PostgreSQL reales. Requiere TEST_REAL_DISPOSABLE=true,
  TEST_REAL_FRONTEND_URL, TEST_REAL_BACKEND_URL y credenciales sintéticas de
  administrador, ya documentadas en .env.example. COMPOSE_PROJECT_NAME debe
  apuntar al sistema exclusivo (por defecto sprint3-t15).
- Los tests crean un local y cuentas propios por proyecto, preparan solamente
  pacto y horas por SQL en esa base exclusiva y realizan el resto por API.
  Al terminar desactivan cuentas y local, conservando auditoría y constancias.
- El workflow sprint-3-t15-contador.yml ejecuta calidad de ambos proyectos,
  pruebas unitarias y recorridos reales y adjunta capturas y trazas.

La tarea se entrega para revisión; no se marca Hecho sin confirmación.
