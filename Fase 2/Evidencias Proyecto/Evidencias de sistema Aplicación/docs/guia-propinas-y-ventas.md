# Guía de uso — Propinas y ventas

Cómo se registran, reparten y pagan las propinas, y cómo se importan y revisan
las ventas diarias en el sistema Moi-food (flujo vigente desde el Sprint 4A).
Está organizada por rol; cada paso indica la ruta de la aplicación web. El
contrato técnico de cada endpoint está en Swagger (`/api/docs` del backend) y en
el [README del backend](../backend/README.md).

## Resumen del flujo

```text
SUPERVISOR                         SISTEMA                         ADMINISTRADOR / CONTADOR
/propinas/diarias                                                  /propinas
Guarda la operación del día  ──►  Reparte el fondo en partes  ──►  Revisa por día y trabajador,
(propinas, voucher, diferencia,   iguales: una propina             descarga el Excel del período
participantes)                    «No pagada» por participante     y lo marca como pagado
                                         │                                │
                                         ▼                                ▼
TRABAJADOR / SUPERVISOR           Alerta si sigue sin pagar        La propina pasa a «Pagada»
/portal/propinas                  después del plazo legal          y la alerta desaparece
Ve sus propinas y su estado
```

Las ventas siguen un camino separado: el ADMINISTRADOR importa cada día el
Excel de MrComanda en `/admin/importacion-ventas`, y el panel y los reportes
muestran juntas, sin mezclarlas, las ventas importadas, las propinas y la
diferencia de efectivo de la operación diaria.

| Rol | Qué hace en este flujo |
| --- | --- |
| SUPERVISOR | Registra y corrige la operación diaria de su local; puede ser participante del reparto y ve sus propinas en «Mis propinas». |
| ADMINISTRADOR | Revisa y paga propinas; importa las ventas; configura locales (ID Subway), medios de pago y sus etiquetas; revisa panel y reportes. |
| CONTADOR | Revisa y paga propinas; revisa en solo lectura los reportes de ventas, el voucher y la diferencia de cada operación diaria. |
| TRABAJADOR | Consulta sus propinas y si ya se pagaron. |

## SUPERVISOR: operación diaria y participantes

Menú **Operación diaria** (`/propinas/diarias`). El local sale de la sesión; no
se elige.

1. Elige la **fecha** (día de negocio en hora de Chile). Si ese día ya tiene
   operación, la pantalla la muestra.
2. Ingresa, en pesos enteros:
   - **Propina con tarjeta** y la **foto del voucher** (JPEG, PNG o WebP, hasta
     5 MiB; obligatoria si la propina con tarjeta es mayor que 0).
   - **Propina en efectivo**.
   - **Diferencia de efectivo**: positiva si sobra, negativa si falta. Si no es
     0, el **motivo** es obligatorio.
3. Marca los **participantes**: los trabajadores y supervisores activos del
   local («Seleccionar todos» / «Quitar selección»). El supervisor puede
   incluirse a sí mismo. Con fondo mayor que 0 se exige al menos uno; con fondo
   0 no se reparte nada.
4. Revisa la **vista previa**: fondo del día, cantidad de participantes y monto
   de cada uno antes de guardar.
5. Pulsa **Guardar operación**. Guardar dos veces lo mismo no duplica nada.

**Corregir.** Con **Corregir operación diaria** se cambian montos, diferencia,
motivo, voucher o participantes (la fecha no cambia). Mientras ninguna propina
del día esté pagada, el reparto se recalcula solo. Si alguna ya se pagó, el
sistema rechaza el cambio de montos o de participantes; el motivo, la
diferencia y el voucher sí se pueden corregir.

## Cómo se reparte la propina

Al guardar la operación diaria, el sistema reparte el **fondo del día**
(propina con tarjeta + propina en efectivo) **en partes iguales** entre los
participantes de ese día y crea una propina **No pagada** para cada uno. No se
usan horas trabajadas y quien no participó no recibe nada de ese día.

- Cada participante recibe `fondo ÷ participantes`, redondeado hacia abajo al
  peso.
- Los pesos que sobran (**residuo**) se entregan de a $1 a algunos
  participantes. Quién recibe el peso extra rota de un día a otro según la
  fecha, así no favorece siempre a la misma persona.
- La suma siempre es exactamente el fondo. Ejemplos: $40.000 entre 4 son
  $10.000 para cada uno; $10.000 entre 3 son $3.334, $3.333 y $3.333.

## ADMINISTRADOR y CONTADOR: revisar y pagar propinas

Menú **Propinas** (`/propinas`).

1. **Filtrar**: elige el **local** y el período **Desde/Hasta** (por defecto la
   semana actual, de lunes a domingo; hasta 62 días). Los atajos **Semana
   actual** y **Semana anterior** completan las fechas.
2. **Propinas por día**: total repartido, pagado y pendiente de cada día, con
   su estado (No pagado, Parcial o Pagado). **Detalle** abre el monto de cada
   trabajador ese día y, si ya se pagó, el lote y la fecha de pago.
3. **Resumen por trabajador**: días con propina, pendiente, pagado y total de
   cada persona en el período, más el total general.
4. **Descargar Excel**: baja `propinas_<local>_<desde>_<hasta>.xlsx` con dos
   hojas. «Resumen» tiene una fila por trabajador (nombre y RUT), una columna
   por día y los totales. «Detalle» tiene fecha, trabajador, monto, estado y
   lote. Los totales cuadran con la pantalla. El archivo trae RUT: guárdalo
   solo donde corresponda.
5. **Marcar propinas como pagadas**: el diálogo muestra local, período, total a
   pagar y cantidad de trabajadores. **Confirmar pago** marca como Pagadas
   todas las propinas No pagadas del local en ese período y crea un **lote de
   pago** con quién y cuándo pagó. Lo ya pagado no cambia, un doble clic no
   paga dos veces y **un pago no se puede revertir**. Desde ese momento ya no
   se pueden corregir los montos ni los participantes de esos días.
6. **Pagos registrados**: historial de lotes del local que cubren el período,
   incluidos los lotes históricos migrados de los repartos antiguos ya pagados.

### Alertas de propinas vencidas y plazo de pago

Arriba de `/propinas` aparece **Propinas vencidas sin pagar** cuando hay
propinas No pagadas fuera del plazo: por local muestra el monto, la cantidad y
el mayor atraso; por trabajador, el monto, los días, la fecha más antigua y el
atraso. **Ver propinas vencidas** abre `/propinas` ya filtrado con el local y el
período vencido; al pagarlo, la alerta desaparece. El **Panel de ventas**
(`/admin/panel-ventas`) muestra el mismo aviso por local para el
ADMINISTRADOR.

El plazo se configura en el backend:

| Variable | Por defecto | Qué controla |
| --- | --- | --- |
| `TIP_LEGAL_PAYMENT_DAYS` | `7` | Días hábiles para pagar una propina, contados desde el día siguiente a su fecha. Entero de 1 a 260; se puede ampliar si el convenio pacta más días. |
| `TIP_ALERT_HOLIDAYS` | vacío | Feriados que no cuentan como días hábiles, separados por coma (`2026-09-18,2026-12-25`). Debe actualizarse cada año con el calendario oficial. |

Los días hábiles son de lunes a viernes sin los feriados configurados. El día
límite todavía está en plazo: la alerta aparece desde el día siguiente. Con el
plazo por defecto y sin feriados, una propina del viernes 2 de octubre de 2026
vence el martes 13 y alerta desde el miércoles 14. Un valor inválido en
cualquiera de las dos variables impide iniciar el backend. En Docker se definen
en el `.env` junto a `docker-compose.yml`; ver el
[README raíz](../README.md#variables-de-compose).

## TRABAJADOR y SUPERVISOR: «Mis propinas»

Menú **Mis propinas** (`/portal/propinas`).

- Muestra cada día del mes con su local, monto y estado: **No pagada** desde
  que el supervisor guarda la operación del día, o **Pagada** con la fecha de
  pago.
- Totales del mes: pendiente de pago, pagado y total. Se puede cambiar de mes.
- Solo se ven las propinas propias: la identidad sale de la sesión.
- Debajo siguen disponibles las **constancias PDF** de los repartos antiguos ya
  pagados.

## Repartos antiguos (histórico de solo lectura)

Antes del Sprint 4A el contador calculaba un reparto por local y período, lo
revisaba, lo confirmaba y lo pagaba. Ese flujo se **retiró** porque pagar un
reparto por período dejaba las propinas diarias sin pagar y permitía pagarlas
dos veces. Hoy el reparto es automático al guardar la operación diaria y el
pago se registra por período en `/propinas`.

- Nada se borró: los repartos, sus líneas y constancias se consultan en
  **Repartos anteriores** (`/propinas/historico`, enlazado desde `/propinas`).
  Sin acciones de cálculo, confirmación ni pago.
- Los repartos que estaban **pagados** quedaron como lotes de pago históricos:
  sus propinas diarias figuran como Pagadas.
- Los que nunca se pagaron (borradores sin efecto y confirmados sin pago) no
  cambian nada: las propinas de esos días figuran como No pagadas y se pagan
  en `/propinas`.
- La dirección antigua `/propinas/repartos` redirige a `/propinas`. Las
  acciones de escritura de la API (`POST /tip-pools/...`) responden
  `410 Gone` y figuran como obsoletas en Swagger.

## ADMINISTRADOR: importar el Excel de ventas

### Antes de la primera carga: ID Subway de cada local

En **Locales** (`/admin/locales`) cada local tiene su **ID Subway**: el número
que el «Informe de Ventas Diario» de MrComanda trae en el encabezado después
del número interno (en `Local: 208 - 72597` el ID Subway es `72597`; el 208 se
ignora). Se edita en el formulario del local (solo dígitos, de 1 a 10, único
entre los locales; vacío lo quita). Los locales base vienen con su ID: Santa
María `72597`, Ugalde `74413` y Calera `69132`.

### Cargar el informe del día

Menú **Importar ventas** (`/admin/importacion-ventas`).

1. Elige el «Informe de Ventas Diario» (.xlsx, hasta 5 MB) y pulsa **Ver vista
   previa**. La fecha de negocio sale del «Período» del informe, no del nombre
   del archivo: el informe del 05/11 suele llamarse `ventas-06-11-2026.xlsx`.
2. La vista previa muestra local, fecha, emisión, cada medio de pago con su
   monto y el total. Las líneas en **$0 sin medio reconocido se omiten solas**
   (por ejemplo «N.de Créd.» en 0) y no impiden confirmar.
3. Pulsa **Confirmar importación**. Las ventas quedan vigentes para ese local y
   día. Subir de nuevo el mismo archivo avisa que ya estaba importado, sin
   duplicar.
4. **Corrección**: un archivo distinto para el mismo local y día muestra las
   diferencias por medio contra la versión vigente y exige aceptar el
   reemplazo (**Confirmar corrección**). Las versiones anteriores se conservan
   y el Excel original se puede descargar desde el detalle.

### Cuando algo no se reconoce

Si el informe trae un ID Subway que ningún local tiene, o una línea con valor
cuyo medio no se reconoce, la vista previa avisa
«Elige los datos que no se identificaron para confirmar». Nada se adivina:

- **Local**: elige el local activo en «Selecciona un local activo».
  **Recordar para próximas cargas** asigna ese ID Subway al local, solo si el
  local todavía no tiene uno.
- **Cada línea sin medio**: elige un medio activo del catálogo, o **Crear medio
  de pago «etiqueta»** con un nombre editable. El medio nuevo se crea activo,
  fuera de la conciliación de vouchers y sin propinas; se ajusta después en
  **Medios de pago**. **Recordar para próximas cargas** guarda la etiqueta como
  alias del medio (al crear un medio, siempre se guarda).
- **Confirmar importación** se habilita cuando todo está resuelto. Lo elegido a
  mano queda registrado con quién lo resolvió, y cada cambio de configuración
  queda en la auditoría.

### Etiquetas de los medios de pago

En **Medios de pago** (`/admin/medios-pago`), la sección **Etiquetas de los
informes de ventas** lista las etiquetas del Excel de MrComanda asociadas a cada
medio (por ejemplo «T. DEBITO» → Tarjeta de débito). Con **Agregar etiqueta** se
asocia una etiqueta nueva a un medio activo; quitarla hace que la próxima carga
con esa etiqueta pida elegir el medio. Para corregir una etiqueta mal asociada,
se quita y se agrega en el medio correcto. Las importaciones ya confirmadas no
cambian.

## Revisar voucher y diferencias

**ADMINISTRADOR.** En **Panel de ventas** (`/admin/panel-ventas`) cada local y
día muestra las ventas del Excel vigente, el estado de la importación, las
propinas con tarjeta y en efectivo, la diferencia de efectivo con su motivo y
las alertas. Cada fila abre la operación diaria
(`/admin/panel-ventas/operaciones/<id>`) con la foto del voucher. **Reportes de
ventas** (`/admin/reportes-ventas`) resume un rango de hasta 366 días, de un
local o de todos, con columnas por medio de pago; propinas y diferencias van
aparte, nunca sumadas a las ventas.

**CONTADOR.** En **Reportes de ventas** (`/admin/reportes-ventas`, solo
lectura) cada día abre `/admin/reportes-ventas/operaciones/<id>`: foto del
voucher, propina declarada y, junto a la diferencia de efectivo y su motivo,
las ventas de ese local y día por medio de pago según el Excel vigente (o un
aviso si no hay Excel). Así se comprueba si un pago en efectivo se registró
como tarjeta o al revés. El contador no importa ventas ni corrige la
operación; ver el voucher queda auditado.

Un dato que falta (sin Excel vigente o sin operación diaria) se muestra como
«Sin dato», nunca como $0.

## Verificación automatizada del flujo

| Comando (en `frontend/`) | Qué recorre |
| --- | --- |
| `npm run test:tip-flow:real` | Operación diaria, reparto con residuo, corrección, «Mis propinas», alerta, Excel y pago por período con API y base reales (ver [README del frontend](../frontend/README.md#recorrido-de-propinas-y-pago-sprint-4a-t13)). |
| `MRCOMANDA_SAMPLE_XLSX=/ruta/informe.xlsx npm run test:sales-section:real` | Importación con el Excel real, ID Subway, línea en 0 omitida, elección y creación de medio, panel, reportes y revisión del contador (ver [README del frontend](../frontend/README.md#verificación-con-el-excel-real-sprint-4a-t12)). |
