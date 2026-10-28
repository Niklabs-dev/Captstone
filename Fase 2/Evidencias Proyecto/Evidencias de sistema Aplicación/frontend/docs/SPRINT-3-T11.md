# SPRINT-3-T11 — Registro diario de propinas

El supervisor abre **Registrar propinas** desde Inicio o **Propinas diarias**
desde el menú. La ruta es `/propinas/diarias`, dentro del layout autenticado.
Conecta con la API real de T10; no usa datos simulados en producción.

## Registro y consulta

- El local se obtiene de la sesión validada y su nombre del catálogo de la API.
  No hay un selector de local ni de responsable. El backend obtiene el responsable
  del JWT. Si el local está inactivo se conserva la consulta histórica y se
  deshabilita el registro.
- La fecha inicial corresponde a Chile. Cambiarla consulta los registros de ese
  día; una consulta anterior se cancela para no reemplazar la selección nueva.
- Efectivo, débito, crédito y transferencia admiten montos enteros en CLP entre
  cero y 9.999.999.999. El ingreso no acepta puntos, decimales ni negativos y
  muestra una vista previa con formato chileno.
- Los campos obligatorios tienen errores asociados y foco en el primero que
  requiere corrección. Guardar bloquea campos y nuevos envíos, incluidos dos
  eventos de envío en el mismo ciclo de React.
- El listado muestra fecha, medio, monto, responsable y fecha de registro.
  Incluye totales por medio y del día. La tabla se desplaza dentro de una región
  accesible y no amplía horizontalmente la página.
- Un alta devuelve 201. Un reintento idéntico devuelve 200 y avisa que el registro
  ya estaba guardado. Un monto o responsable distinto para la misma clave diaria
  devuelve 409 y conserva los campos para revisar el listado. No se cambia
  automáticamente el monto de un registro existente.
- La carga, lista vacía, fallo de consulta y error al guardar tienen mensajes y
  acciones de recuperación. Los errores no borran el monto ingresado.

## Contrato del frontend

Solo SUPERVISOR accede a esta vista y al BFF. La API NestJS mantiene sus permisos
propios, que también permiten otras operaciones administrativas. Las vistas
del contador y las constancias personales se entregan en T15 y T16.

| Método y ruta | Datos del navegador | Llamada a NestJS |
| --- | --- | --- |
| GET `/api/tips?businessDate=YYYY-MM-DD` | Solo fecha; sin filtros repetidos | GET `/tips?storeId=<sesión>&businessDate=...` |
| POST `/api/tips` | `businessDate`, `paymentMethod`, `amount` numérico | POST `/tips` con el local de sesión |

El BFF verifica origen en las mutaciones, limita el JSON a 4096 bytes y rechaza
campos adicionales, incluidos `storeId` y `responsibleId`. Reenvía el token
solo en servidor. Valida fecha/local y proyecta la respuesta; una colección
con registros ajenos, duplicados o malformados responde 502. En el alta también
comprueba medio, monto y responsable. Las respuestas usan
`Cache-Control: private, no-store`. No implementa PATCH ni DELETE.

## Verificación

Requiere Node 24 y npm. Desde `frontend/`:

```powershell
npm ci
npm run lint
npm run format:check
npm run test:tips
npm run test:tips:integration
```

La integración HTTP compila Next y utiliza un backend controlado únicamente
en el proceso de pruebas. Comprueba sesión, roles, origen, cuerpos inválidos,
identidad no editable, códigos 200/201/409, proyección y rechazo de respuestas
inconsistentes. No sustituye los recorridos con NestJS y PostgreSQL reales.

Para esos recorridos, levantar un Docker exclusivo con migraciones y seed y
definir las variables `TEST_REAL_*` ya documentadas en `.env.example`:

```powershell
$env:TEST_REAL_DISPOSABLE='true'
$env:TEST_REAL_FRONTEND_URL='http://127.0.0.1:3000'
$env:TEST_REAL_BACKEND_URL='http://127.0.0.1:3001'
# Configurar TEST_REAL_ADMIN_EMAIL y TEST_REAL_ADMIN_PASSWORD con el seed de pruebas.
npm run test:tips:real
```

Las pruebas crean locales y cuentas sintéticas por proyecto y los desactivan
al terminar, conservando su auditoría en esa base exclusiva. Se ejecutan a
360, 390, 768 y 1440 px. Cubren los cuatro medios, cero, errores de monto,
responsable, totales, reintentos, doble envío, permisos, aislamiento por local,
carga, error y recuperación. Los fallos de red se inyectan en el navegador
sin sustituir las operaciones válidas de NestJS.

El workflow `.github/workflows/sprint-3-t11-propinas.yml` ejecuta calidad,
contrato HTTP y navegador con Docker real. Conserva resultados, capturas y
trazas siete días. La evidencia local queda en `output/`, fuera de Git.
La comprobación móvil usa Chromium emulado; no se afirma validación en
teléfonos físicos ni Safari.

T11 integra main con las mejoras responsive de T07 y conserva ambas guías
referenciadas en README. La regresión se repite sobre esta integración.

Si el local se desactiva después de cargar el formulario, el BFF traduce
exclusivamente el mensaje conocido de NestJS al código público STORE_INACTIVE.
El cliente muestra la causa y la acción con el administrador, conserva el monto
y permite consultar el historial. Los demás errores 400 mantienen la ayuda de
validación y los mensajes arbitrarios del backend no se muestran.
La API administrativa impide desactivar locales con usuarios activos. Para
reproducir este estado con una sesión abierta, la regresión lo prepara mediante
SQL únicamente en la base exclusiva y verifica el BFF, NestJS y el historial
reales en los cuatro anchos. El proyecto Compose se toma de
`COMPOSE_PROJECT_NAME` (por defecto `sprint3-t11`); no cambia las reglas de baja
del backend.
La tarea queda para revisión antes de marcarla Hecho.
