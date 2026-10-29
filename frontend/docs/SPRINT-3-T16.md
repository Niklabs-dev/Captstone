# SPRINT-3-T16 — Mis constancias de propinas

Ruta `/portal/propinas`, exclusiva del trabajador. Presenta únicamente
constancias propias de repartos PAID: local histórico, período, monto,
horas, fecha de entrega, responsable y emisión. La navegación personal
incluye Mis propinas. Se reutilizan las tarjetas y controles de DESIGN.md.
No hay operaciones de escritura.

La API agrega GET /my-tip-receipts y GET /my-tip-receipts/:id/download.
Ambas fijan el usuario desde la sesión JWT; no admiten parámetros de
identidad ni local. La consulta exige propietario y PAID en la base.
Constancias ajenas, inexistentes o sin reparto pagado responden 404 de
la misma forma. El historial se conserva aunque el trabajador cambie
de local. La proyección personal excluye detalle y líneas de compañeros.
Swagger documenta los contratos, permisos y respuestas.

El PDF es el de T13: determinista, generado desde la foto guardada al pagar.
La API devuelve SHA-256 de los bytes en X-Content-SHA256; el BFF verifica
contenido, tamaño (máximo 1 MiB) y hash, y el navegador vuelve a verificar
antes de guardar. No se publica ni reutiliza un archivo que falle esta
comprobación. Las descargas quedan auditadas. No se añade almacenamiento
ni migraciones; el checksum comprueba la integridad de transferencia.

## Pruebas

- `npm run test:my-tip-receipts`: contratos, propietario, PAID, URLs sin
  identidad del cliente, datos privados, PDF/hash, errores y navegación.
- `npm run test:my-tip-receipts:real`: Chromium a 360, 390, 768 y 1440 px
  con Next.js, NestJS y PostgreSQL reales. Requiere TEST_REAL_DISPOSABLE,
  TEST_REAL_FRONTEND_URL, TEST_REAL_BACKEND_URL y credenciales sintéticas
  del administrador, ya descritas en .env.example.
- COMPOSE_PROJECT_NAME identifica la base exclusiva (sprint3-t16 por
  defecto). Solo se preparan pacto y horas por SQL. El resto se crea por
  API, incluidos borradores, confirmados, pagos y constancias.
- Se verifica aislamiento entre dos trabajadores, cambio de local,
  ocultamiento de repartos no pagados, permisos, errores y PDF alterado.
  Las cuentas y locales sintéticos se desactivan al terminar; constancias
  y auditoría permanecen en la base exclusiva.
- El workflow sprint-3-t16-mis-propinas.yml repite calidad y pruebas y
  adjunta capturas y trazas. Evidencia local en output/, fuera de Git.

La entrega queda para revisión, sin marcar Hecho antes de la confirmación.
