# Modelo de datos — Sistema de Gestión Interna "Moi-food" (Subway)

> Tarea: **SPRINT-3-T09** · Fuente de verdad: `prisma/schema.prisma` · Motor: PostgreSQL 16 · ORM: Prisma 7
>
> Este documento describe el modelo de datos completo del sistema (los 6 módulos),
> sus decisiones de diseño, el cumplimiento normativo (Código del Trabajo y
> Ley N°21.719) y las formas de visualizarlo.

## Vista general por módulo

| Módulo | Tablas | Propósito |
| --- | --- | --- |
| Núcleo | `stores`, `roles`, `users`, `refresh_tokens`, `audit_logs` | Locales, control de acceso por rol y local, autenticación JWT y auditoría inmutable |
| Gestor Documental | `document_types`, `documents`, `document_versions`, `payslips` | Documentación laboral con hash SHA-256, versionado y conservación por 5 años; liquidaciones de sueldo con estado de publicación |
| Propinas | `tip_entries`, `tip_agreements`, `work_hours_records`, `tip_pools`, `tip_pool_lines`, `tip_pool_sources`, `tip_pool_receipts`, `tip_pool_daily_operation_sources` | Pacto de reparto (proporcional histórico y equitativo), horas trabajadas, reparto con snapshots (art. 64 CT) y constancias de pago; `tip_entries` conserva la captura histórica por medio (modo lectura desde SPRINT-4R-T01) y `tip_pool_daily_operation_sources` vincula el reparto con la operación diaria (SPRINT-4R-T02) |
| Ventas y Caja | `payment_methods`, `sales`, `cash_closings`, `cash_closing_lines`, `cash_closing_vouchers`, `cash_closing_tip_entries` | **Histórico, modo lectura:** catálogo administrable de medios de pago (se conserva para historial y futura importación Excel), ventas por local (manuales y totales netos MrComanda) y cierre de caja por local, día y turno con conciliación y vouchers. Reemplazado operativamente por la operación diaria |
| Operación diaria | `daily_operations`, `daily_operation_vouchers`, `daily_operation_participants` | Una operación por local y fecha de negocio (SPRINT-4R-T01): propina tarjeta con voucher fotográfico, propina efectivo, fondo de propinas calculado y diferencia de efectivo con signo y motivo. Fuente operativa de ambos montos de propina y, desde SPRINT-4R-T02, de la selección de participantes del reparto (compartida por tarjeta y efectivo) |
| Inventario | `products`, `inventory_movements`, `inventory_counts`, `inventory_count_lines` | Stock por libro mayor de movimientos y conteos físicos que detectan mermas |
| Ley N°21.719 | `data_rights_requests` | Solicitudes de derechos ARCO de los titulares de datos personales |

**31 tablas y 14 enums**: el modelo base (27 tablas, hasta SPRINT-4-T32) más la
operación diaria de SPRINT-4R-T01 (`daily_operations` y
`daily_operation_vouchers`) y los participantes y fuentes diarias de
SPRINT-4R-T02 (`daily_operation_participants` y
`tip_pool_daily_operation_sources`; fuente de verdad física:
`prisma/schema.prisma`). SPRINT-4R-T02 no agrega enums: añade el valor
`EQUAL_SHARES` a `TipAgreementRule`. El Portal del Trabajador no agrega
tablas: es una vista
de solo lectura sobre `users`, `documents`, `tip_pool_lines` y `sales`, con
aislamiento por `subject_user_id` / `store_id` aplicado en el backend.

## Decisiones de diseño

- **Identificadores UUID** generados por PostgreSQL (`gen_random_uuid()`), salvo
  `audit_logs` e `inventory_movements`, que usan `BIGSERIAL` por ser libros
  mayores donde el orden cronológico natural importa.
- **Sin borrado físico**: todas las FK usan `ON DELETE RESTRICT` por defecto
  (protege la trazabilidad), `SET NULL` en auditoría (el registro sobrevive a la
  anonimización del usuario) y `CASCADE` solo en datos estrictamente hijos
  (tokens de sesión, líneas de reparto/cierre/conteo, fuentes de reparto,
  vouchers y vínculos a propinas del cierre de caja y participaciones de la
  operación diaria con su operación).
- **Dinero en `DECIMAL(12,2)`** (CLP) y cantidades en `DECIMAL(12,3)`: nunca
  `float`, para evitar errores de redondeo en propinas, ventas e inventario.
  La operación diaria y su fuente de reparto son la excepción por diseño:
  montos en **`BIGINT` en CLP entero** (`daily_operations.*_tip_amount` y
  `tip_fund_amount`, `tip_pool_daily_operation_sources.amount`), sin centavos,
  con conciliación exacta contra el fondo.
- **`date` para fechas de negocio** (períodos de reparto, día de cierre) y
  **`timestamptz` para marcas de tiempo** (Chile tiene horario de verano).
- **Restricciones de negocio en la BD**: una operación diaria por local y día
  de negocio (`UNIQUE(store_id, business_date)`; el reintento idéntico devuelve
  la existente y un contenido distinto responde 409 con el ID consultable), un cierre de caja por local, día y
  turno (`UNIQUE(store_id, business_date, shift)`), una línea por medio de pago por cierre
  (`UNIQUE(closing_id, payment_method_id)`), un reparto por local y período
  (`UNIQUE(store_id, period_start, period_end)`), una línea por trabajador por
  reparto (`UNIQUE(pool_id, user_id)`), hash SHA-256 único por versión de
  documento, un registro de propinas por local, fecha y medio de pago
  (`UNIQUE(store_id, business_date, payment_method_id)`), un total MrComanda
  por local, medio y período
  (`UNIQUE(store_id, payment_method_id, period_start, period_end)`; los
  períodos NULL de las ventas manuales no colisionan), una fuente por registro
  diario (`UNIQUE(tip_entry_id)` en `tip_pool_sources`) y una operación diaria
  alimentando como máximo un reparto (`UNIQUE(operation_id)` en
  `tip_pool_daily_operation_sources`), una participación por trabajador y
  operación (`UNIQUE(operation_id, worker_id)` en
  `daily_operation_participants`), un medio de pago por
  código (`UNIQUE(code)` en `payment_methods`), un pacto por local e
  inicio (`UNIQUE(store_id, valid_from)`) y restricciones de exclusión que impiden
  vigencias de pactos o períodos de horas solapados (`tip_agreements_no_overlap`
  y `work_hours_records_no_overlap`).
- **Inmutabilidad**: `audit_logs` y `document_versions` no tienen `updated_at`;
  la aplicación solo permite `INSERT`/`SELECT` sobre ellas.
- **Convenciones**: tablas y columnas en `snake_case`, modelos Prisma en
  inglés `PascalCase`, enums en inglés (los literales de negocio —roles, tipos
  de documento— viven como datos en `roles` y `document_types`, seed en T05).

### Propinas (SPRINT-3-T09)

> Desde SPRINT-4R-T01 la captura por medio en `tip_entries` es **histórica**
> (modo lectura) y la fuente operativa de los montos de propina es la
> [operación diaria](#operación-diaria-sprint-4r-t01). Lo siguiente describe el
> modelo del flujo anterior, conservado íntegro con sus repartos ya calculados.
> Desde SPRINT-4R-T02 el reparto puede alimentarse además de la operación
> diaria (`tip_pool_daily_operation_sources`, separada de `tip_pool_sources`)
> y el pacto admite la regla equitativa `EQUAL_SHARES` junto a la histórica
> `PROPORTIONAL_TO_HOURS`, sin reinterpretar los repartos proporcionales
> (detalle en
> [Participantes diarios y regla equitativa](#participantes-diarios-y-regla-equitativa-sprint-4r-t02)).

- **`tip_entries` es la única fuente de los repartos**: agrupa por local, día de
  negocio y medio de pago el monto disponible para repartir. Los repartos se
  calculan **solo desde `tip_entries`**; `sales.tip_amount` se reconcilia con
  una única entrada mediante `sales.tip_entry_id` y **nunca se suma como segunda
  fuente**.
- **Unicidad diaria y por fuente**: no puede existir más de un `tip_entries` para
  el mismo local, fecha y medio de pago; un registro diario solo puede usarse en
  un reparto (`tip_pool_sources.tip_entry_id` es único).
- **Snapshots inmutables del cálculo**: `tip_pools` conserva el pacto aplicado en
  `agreement_snapshot` (`agreement_id` + `agreement_snapshot`), cada línea
  guarda las horas usadas en `hours_worked` y la fuente guarda el monto aplicado
  en `tip_pool_sources.amount`. Si cambian el pacto, las horas o el registro
  diario posteriormente, el reparto ya confirmado no se altera. Desde
  SPRINT-4R-T02 la fuente también puede ser la operación diaria
  (`tip_pool_daily_operation_sources.amount`, CLP entero igual al fondo del
  día) y las líneas/constancias de un reparto equitativo guardan `hours_worked`
  **NULL** — la regla no usa horas y no se inventan —, mientras los repartos
  proporcionales e históricos conservan sus horas y su `NOT NULL` lógico
  (trigger `tip_pool_children_hours_consistent`).
- **`work_hours_records`** descompone las horas trabajadas por trabajador y
  período, permitiendo reutilizarlas en futuros repartos y mantener la
  referencia fuente en cada línea (`tip_pool_lines.work_hours_record_id`).
- **Vigencias sin ambigüedad**: restricciones de exclusión con rangos inclusivos
  impiden dos pactos solapados en un local o dos registros de horas solapados
  para un trabajador; un pacto sin `valid_to` queda abierto.
- **Reglas de consistencia en la BD**: triggers garantizan que una venta solo se
  reconcilie con un registro del mismo local, medio y día de negocio, y que una
  fuente de reparto pertenezca al mismo local y esté dentro del período del
  reparto. El backfill solo vincula un reparto si todas sus entradas son
  inequívocas y concilian con su total; las horas históricas solapadas conservan
  su snapshot sin crear una referencia ambigua.

## Cumplimiento de la Ley N°21.719 (protección de datos personales)

| Principio / obligación | Mecanismo en el modelo |
| --- | --- |
| Minimización y finalidad | Los datos personales existen **solo en `users`** (email, nombres, RUT, teléfono, fecha de contratación); el resto del modelo referencia por UUID, sin duplicar datos personales |
| Base legal | La relación laboral y la obligación legal de conservar documentación (art. 9 bis CT) fundamentan el tratamiento; no se requiere consentimiento adicional para estos datos |
| Derecho de **cancelación** | **Anonimización, no borrado**: `users.anonymized_at` marca la anonimización; `rut`/`phone` quedan `NULL` (el índice único admite múltiples `NULL`), nombres se reemplazan por "Usuario Anonimizado" y el email por uno técnico. La trazabilidad laboral y documental se preserva |
| Derechos **ARCO** (acceso, rectificación, cancelación, oposición) y portabilidad | Tabla `data_rights_requests`: tipo de derecho, estado (`PENDING` → `RESOLVED`/`REJECTED`), plazo legal de respuesta (`due_at`), quién resolvió y cuándo |
| Seguridad del tratamiento | Contraseñas solo como hash (`password_hash`); refresh tokens solo como hash con expiración y revocación; secretos fuera del código (variables de entorno) |
| Registro de actividades de tratamiento | `audit_logs` inmutable: usuario, operación, entidad, local, detalle (JSONB), IP y fecha de cada operación crítica |
| Conservación limitada | `document_types.retention_years` (5 por defecto), `documents.retain_until` (fecha hasta la que se conserva cada documento) y `documents.expires_at` para gestionar plazos; el cumplimiento de conservación laboral prima sobre el borrado |
| Aislamiento por titular (Portal del Trabajador) | `documents.subject_user_id` y `users.store_id` permiten que cada trabajador vea **solo su información**; el aislamiento se enforce en los servicios del backend |

## Cumplimiento del Código del Trabajo

- **Art. 9 bis (conservación de documentación laboral)**: `documents` +
  `document_versions` conservan contratos, anexos, finiquitos y liquidaciones
  con integridad verificable, versionado y conservación por 5 años.
- **Art. 64 (reparto de propinas)**: desde SPRINT-4R-T01 el registro diario del
  monto vive en la operación diaria (`daily_operations`), fuente de ambos
  montos de propina; en el flujo anterior era `tip_entries` quien registraba
  diariamente el monto por local y medio de pago. `tip_pools` define el fondo y
  período por local;
  `tip_pool_lines.hours_worked` es la base del reparto proporcional
  (`PROPORTIONAL_TO_HOURS`) y `amount` el registro escrito por trabajador; con
  la regla equitativa (`EQUAL_SHARES`, SPRINT-4R-T02) la base son los
  participantes de la operación diaria y las horas quedan `NULL`, sin ceros
  ficticios; `calculated_by`/`confirmed_by`/`confirmed_at` dejan trazabilidad
  del cálculo validado por el contador. El pacto vigente (`tip_agreements`) y
  las horas trabajadas (`work_hours_records`) se fotografían en el reparto para
  que modificaciones posteriores no alteren un cálculo ya confirmado.
- **Cierre de caja por turno con responsable y desglose por medio de pago**:
  un cierre por local, día de negocio y turno
  (`UNIQUE(store_id, business_date, shift)`); `cash_closings.responsible_id`
  (obligatorio), `opening_cash` (fondo de caja) y, al cerrar, quién y cuándo
  (`closed_by_id`, `closed_at`) en la cabecera; `cash_closing_lines` registra
  **una línea por cada medio de pago del catálogo** con lo esperado según las
  ventas (`expected_amount`), lo contado por el supervisor (`counted_amount`) y
  la `difference` de la línea. El fondo se suma una sola vez a lo esperado, en
  la primera línea cuyo medio tiene comportamiento `CASH` (es un monto físico
  único, aunque el catálogo tenga más de un medio CASH), y la diferencia total
  del cierre se deriva sumando las líneas. Si hay diferencia, el motivo
  (`difference_reason`) es obligatorio para cerrar, y un cierre `CLOSED` es
  inmutable (detalle en [Cierres de caja por turno](#cierres-de-caja-por-turno-sprint-4-t08)).

## Trazabilidad del Gestor Documental

1. El archivo se guarda en un **volumen separado** (fuera de la BD); en
   `document_versions.file_path` queda la ruta relativa.
2. Al subir, la aplicación calcula el **SHA-256** del archivo y lo registra en
   `sha256_hash` (`CHAR(64)`, **único**: el mismo archivo no puede subirse dos
   veces). La integridad se verifica recalculando el hash y comparándolo.
3. Cada corrección crea una **nueva versión inmutable**
   (`UNIQUE(document_id, version_number)`); `documents.current_version_id`
   apunta a la vigente y el historial completo queda disponible.
4. Quién subió (`uploaded_by_id`), cuándo (`uploaded_at`) y por qué
   (`change_note`) quedan registrados, y la operación se audita en `audit_logs`.
5. Las FK en `RESTRICT` impiden borrar documentos, versiones o tipos: la
   conservación de 5 años está garantizada a nivel de base de datos.

## Plazos del Gestor Documental (E1-H3)

| Plazo | Columnas | Regla |
| --- | --- | --- |
| Conservación (art. 9 bis CT) | `documents.retain_until` | Se fija al crear el documento: `issued_at` (o el día de carga, hora de Chile) + `document_types.retention_years`. Es una foto: no cambia si luego se modifica el tipo. Base del bloqueo de eliminación (SPRINT-2-T07). |
| Registro en la Dirección del Trabajo | `document_types.requires_dt_registration`, `documents.dt_registration_due_at` | Los tipos marcados (`CONTRATO`, `ANEXO` y `FINIQUITO`) tienen 15 días desde su celebración para registrarse en la DT. `dt_registration_due_at` es `NULL` si el tipo no lo exige. |
| Registro en la DT realizado | `documents.dt_registered_at`, `documents.dt_registered_by_id` | Mientras `dt_registered_at` sea `NULL`, la alerta sigue activa (SPRINT-2-T08). |

Dos `CHECK` mantienen la consistencia: un documento solo se marca como
registrado en la DT si tiene plazo (`documents_dt_registered_requires_due_at`),
y la fecha de registro y quién lo marcó van siempre juntos
(`documents_dt_registered_by_consistent`).

## Liquidaciones de sueldo (E2-H1)

Una liquidación (`payslips`, SPRINT-2-T12) es un documento de tipo
`LIQUIDACION` del gestor documental (`document_id`, único): reutiliza su
versionado, su hash SHA-256 y su plazo de conservación de 5 años, y agrega el
período y el estado de publicación.

| Columna | Regla |
| --- | --- |
| `period` | Mes de la remuneración, guardado como su primer día (`payslips_period_first_day_check`). |
| `status` | `PENDING_SIGNATURE` al cargarla el contador (no visible para el trabajador) y `PUBLISHED` al confirmar su publicación. |
| `signed_at`, `published_at`, `published_by_id` | Fecha de firma, de publicación y quién publicó: obligatorias solo en `PUBLISHED` y vacías mientras está pendiente (`payslips_status_publication_check`). |
| `worker_id` | Repite `documents.subject_user_id` para exigir **una liquidación por trabajador y período** (`UNIQUE(worker_id, period)`); el trigger `payslips_check_document` rechaza un documento que no sea `LIQUIDACION` o de otro trabajador. |

Publicada, la liquidación es **inmutable** (SPRINT-2-T14, migración
`liquidaciones_publicadas_inmutables`): sus triggers rechazan modificarla,
eliminarla antes de que venza la conservación de su documento, `TRUNCATE`, y
agregar versiones o modificar el documento de su archivo. Mientras está
pendiente, el trabajador, el período, el documento y quién la cargó tampoco
cambian; el único cambio de estado posible es a `PUBLISHED`.

## Reparto de propinas (SPRINT-3-T09)

| Tabla | Rol |
| --- | --- |
| `tip_entries` | Registro diario agregado por local, día de negocio y medio de pago. Es la **única fuente** que alimenta los repartos; `sales.tip_amount` se reconcilia con ella mediante `sales.tip_entry_id`. |
| `tip_agreements` | Pacto de reparto vigente en un local (regla, vigencia, creador). `tip_pools` guarda una copia en `agreement_snapshot` para inmutabilidad. |
| `work_hours_records` | Horas trabajadas por trabajador y período; `tip_pool_lines` referencia su registro fuente y fotografía las horas usadas. |
| `tip_pools` | Reparto de un local para un período. Contiene el monto total (desde `tip_entries`), el estado, el pacto aplicado y las trazabilidades de cálculo y confirmación. |
| `tip_pool_lines` | Línea del reparto por trabajador: horas fotografiadas, monto asignado, trabajador y referencia al registro de horas. |
| `tip_pool_sources` | Fuente del reparto: vincula un `tip_pool` con el `tip_entry` usado y guarda el monto aplicado. Un registro diario solo puede usarse una vez. |
| `tip_pool_receipts` | Constancia de pago del reparto para un trabajador: foto con nombres, local, período, horas, monto y detalle; inmutable y solo de un reparto `PAID`. |
| `tip_pool_daily_operation_sources` | Fuente del reparto alimentada por la operación diaria (SPRINT-4R-T02): vincula un `tip_pool` con la `daily_operation` usada y guarda el fondo aplicado en CLP entero. Una operación solo puede alimentar un reparto. |

Reglas clave:

- Un `tip_entries` por `(store_id, business_date, payment_method_id)`.
- Un `tip_pool_sources` por `tip_entry_id` (la fuente no se reutiliza en otro reparto).
- El total de `tip_pools` se calcula sumando los `tip_entries` del período; las
  ventas aportan su `tip_amount` a través de la reconciliación con un único
  `tip_entry`, sin sumar dos veces. Desde SPRINT-4R-T02 el total también puede
  componerse desde la operación diaria vía `tip_pool_daily_operation_sources`
  (fondo completo del día, CLP entero).
- Los repartos históricos se mantienen intactos porque cada entidad relevante
  conserva una copia del momento del cálculo: pacto (`agreement_snapshot`),
  horas (`tip_pool_lines.hours_worked`, `NULL` solo en repartos equitativos
  `EQUAL_SHARES`) y monto fuente (`tip_pool_sources.amount` /
  `tip_pool_daily_operation_sources.amount`).

## Medios de pago y ventas MrComanda (SPRINT-4-T32)

> Con SPRINT-4R-T01 las ventas (manuales y MrComanda) dejaron de capturarse y
> pasaron a modo lectura histórica; el catálogo `payment_methods` se conserva
> para ese historial y para la futura importación de ventas desde Excel.

Migración `20261105021500_medios_pago_catalogo` (reversa manual en su
`down.sql`, que Prisma no ejecuta). Reemplaza al enum `PaymentMethod` por el
catálogo relacional `payment_methods`, única fuente para ventas, propinas,
líneas de cierre y clasificación de vouchers.

| Tabla | Rol |
| --- | --- |
| `payment_methods` | Catálogo administrable de medios de pago: `code` único e inmutable (contrato operativo con frontend y DTO), nombre, `sort_order`, `is_active`, `behavior` y `available_for_tips`. Sin borrado físico: desactivar no elimina ni oculta el historial. |
| `sales` | Agrega `source` (`MANUAL` o `MRCOMANDA`) y `period_start`/`period_end` (NULL en ventas manuales). Las cargas MrComanda guardan el total neto agregado por local, medio y período (`tip_amount` = 0: PROPINAS conserva su fuente propia en `tip_entries`). |
| `cash_closing_vouchers` | Agrega `payment_method_id` opcional: clasifica vouchers MrComanda nuevos. Los vouchers históricos quedan sin clasificar (NULL) y conservan el comportamiento heredado. |

Reglas clave:

- **Backfill por código**: los valores históricos del enum (`CASH`,
  `DEBIT_CARD`, `CREDIT_CARD`, `TRANSFER`) se transfieren al catálogo por su
  texto antes de retirar las columnas y el enum; la migración falla si quedara
  alguna fila sin mapear. Los cuatro códigos se siembran con UUID fijos
  (catálogo de la migración y `prisma/seed.ts`, upsert idempotente por código
  con `update: {}` que no revierte la administración vía API).
- **Comportamiento** (`PaymentMethodBehavior`): `CASH` recibe el fondo de caja
  y no se concilia contra vouchers; `RECONCILABLE_CARD` alimenta
  `mrcomanda_net_sales` con los vouchers MrComanda clasificados;
  `EXTERNAL_OTHER` (transferencias, Junaeb, etc.) queda fuera de esa
  conciliación para no sumarse dos veces.
- **Origen y período de la venta** (CHECK `sales_source_period_consistency` y
  `sales_valid_period`): `source` y período van siempre juntos, con
  `period_end > period_start`. Las ventas MrComanda no llevan propina (CHECK
  `sales_mrcomanda_no_tip`).
- **Idempotencia de las cargas MrComanda**:
  `UNIQUE(store_id, payment_method_id, period_start, period_end)`; los períodos
  NULL de las ventas manuales no colisionan (PostgreSQL trata cada NULL como
  distinto en un índice único).
- **Triggers actualizados**: `sales_check_tip_entry` compara los FKs del
  catálogo (misma regla de local, medio y día de negocio en hora de Chile) y
  la transición a `CLOSED` suma `mrcomanda_net_sales` solo con vouchers
  MrComanda `RECONCILABLE_CARD` o sin clasificar. El backfill retira y
  restaura solo los triggers que lo bloquearían (ventas y líneas de cierres
  `CLOSED`), sin `session_replication_role`.

## Cierres de caja por turno (SPRINT-4-T08)

> **Flujo anterior, hoy histórico (modo lectura) desde SPRINT-4R-T01:** las
> tablas, columnas y datos se conservan íntegros y consultables; la diferencia
> de efectivo y las propinas pasan a declararse una sola vez al día en la
> [operación diaria](#operación-diaria-sprint-4r-t01), sin doble cierre ni
> conciliación.

Migración `20261104010649_cierres_caja_turno_conciliacion` (reversa manual en
su `down.sql`, que Prisma no ejecuta).

| Tabla | Rol |
| --- | --- |
| `cash_closings` | Cierre de un local, día de negocio y turno (`shift >= 1`; cada local define cuántos turnos tiene). Guarda responsable, fondo de caja, motivo de diferencia, quién y cuándo cerró y los totales de conciliación. |
| `cash_closing_lines` | Una línea por medio de pago del catálogo: esperado vs. contado y su diferencia. |
| `cash_closing_vouchers` | Vouchers de respaldo de la conciliación: fuente (`MRCOMANDA` o `MERCADO_PAGO`), período de corte que cubren, monto, propina incluida, referencia y, desde SPRINT-4-T32, medio de pago que clasifica los vouchers MrComanda nuevos. Puede haber varios por fuente y turno (terminales o cortes parciales). |
| `cash_closing_tip_entries` | Vínculo de **solo referencia** entre el cierre y el registro diario de propinas (`tip_entries`) del mismo local y día. |

Reglas clave (CHECK y triggers; aplican a cualquier vía de escritura):

- **Unicidad por turno**: `UNIQUE(store_id, business_date, shift)`. Los cierres
  anteriores a la migración quedaron en el turno 1; `shift` no tiene default,
  así que la API siempre debe indicar el turno.
- **Montos y diferencias**: montos `>= 0` y, por línea,
  `difference = counted_amount - expected_amount`.
- **Conciliación MrComanda / Mercado Pago** (CHECK
  `cash_closings_reconciliation_difference_consistent`):

  ```text
  reconciliation_difference = mercado_pago_gross_amount
                              - mercado_pago_tip_amount
                              - mrcomanda_net_sales
  ```

  Positiva: Mercado Pago cobró más de lo vendido. La propina de Mercado Pago no
  puede superar su bruto. **SUPUESTO pendiente de confirmar con el PO**: (a)
  `mrcomanda_net_sales` es solo la porción de la venta cobrada por Mercado Pago
  y (b) todos los montos incluyen IVA.
- **Vouchers**: período válido (`period_end > period_start`), monto y propina
  incluida `>= 0` con propina `<= monto`, y solo Mercado Pago informa propina
  (en MrComanda es siempre 0). Al cerrar, los tres totales de conciliación del
  cierre deben coincidir con la suma de sus vouchers: `mrcomanda_net_sales`
  solo recibe vouchers MrComanda clasificados con un medio `RECONCILABLE_CARD`
  (los sin clasificar conservan el comportamiento heredado y siguen sumando);
  los vouchers MrComanda de medios `CASH` u `EXTERNAL_OTHER` quedan fuera de
  esa conciliación y no se suman dos veces.
- **Ciclo `OPEN` → `CLOSED`**: el cierre se crea en `OPEN` (las líneas y
  vouchers se agregan después) y solo puede pasar a `CLOSED`; `closed_at` y
  `closed_by_id` están informados si y solo si está `CLOSED`
  (`cash_closings_status_consistency`). En `OPEN` no cambian el local, el día ni
  el turno.
- **Motivo obligatorio con diferencia**: si alguna línea o la conciliación tiene
  diferencia distinta de 0, no se puede cerrar sin `difference_reason`, que
  tampoco puede quedar en blanco.
- **Propinas solo como referencia**: la propina no es venta, no se suma a lo
  esperado de ninguna línea ni a la venta neta y no se copia al cierre;
  `tip_entries` sigue siendo la única fuente de los repartos. El vínculo exige
  el mismo local y día que el cierre, y como el registro es diario y el cierre
  por turno, un mismo registro puede vincularse a varios turnos.
- **Inmutabilidad del cierre `CLOSED`** (triggers): se rechaza todo `UPDATE` o
  `DELETE` del cierre y de sus líneas, vouchers y vínculos a propinas; las
  ventas (`sales`) asociadas a un cierre cerrado no se crean, modifican,
  desligan ni eliminan, y una venta solo puede asociarse a un cierre de su
  mismo local. `TRUNCATE` sobre `cash_closings` se rechaza siempre, y sobre las
  tablas hijas y `sales` si hay cierres cerrados. Solo
  `session_replication_role = replica` (superusuario) omite estas reglas.

## Operación diaria (SPRINT-4R-T01)

Migración del módulo `daily-operations` (los nombres físicos finales viven en
`prisma/schema.prisma`, fuente de verdad). Reemplaza operativamente al cierre
por turno con conciliación, a la captura de ventas y al registro de propinas
por medio: **una sola operación por local y fecha de negocio**, declarada por
el supervisor al final del día.

| Entidad | Rol |
| --- | --- |
| `daily_operations` | Una fila por `(store_id, business_date)` (`UNIQUE`). Guarda `card_tip_amount` (propina tarjeta, entero `>= 0`), `cash_tip_amount` (propina efectivo, entero `>= 0`), `tip_fund_amount` (fondo calculado: tarjeta + efectivo, CHECK) y `cash_difference` (entero **con signo** en BIGINT: positivo = sobrante, negativo = faltante), con `difference_reason` obligatorio si la diferencia no es cero (CHECK). FK única opcional al voucher: exige voucher siempre que `card_tip_amount > 0` (CHECK sobre la misma fila). Referencia al local y al responsable (siempre desde el JWT). |
| `daily_operation_vouchers` | Foto del voucher de propinas con tarjeta: solo metadatos (`file_name`, `file_path`, `mime_type`, `size_bytes`, `sha256_hash` `CHAR(64)`). Obligatorio si `card_tip_amount > 0`; JPEG/PNG/WebP, máximo 5 MiB (validado en la API). El archivo vive en el **volumen privado** del backend (mismo volumen que el gestor documental, subcarpeta `vouchers/`, nombre físico aleatorio) y solo se descarga mediante el endpoint autorizado `GET /daily-operations/:id/voucher`; no existe URL pública. Relación 1:1 con la operación. |

Reglas clave:

- **Unicidad e idempotencia**: una operación por local y día. El reintento
  idéntico (mismos campos, incluido el mismo voucher por su hash SHA-256)
  devuelve la operación existente (200) sin duplicar fila ni auditoría; un
  contenido distinto para la misma clave responde 409 con `existingOperationId`
  consultable.
- **Fuente única de propinas**: la operación diaria es la fuente de ambos
  montos de propina; no se crean registros `tip_entries` paralelos ni se
  infieren propinas desde ventas o vouchers. Las propinas, las ventas
  (`sales`) y los cierres (`cash_closings*`) del flujo anterior quedan en modo
  lectura histórica.
- **Ventas fuera de la operación**: ningún total se calcula desde ventas; el
  supervisor ya no captura ventas ni realiza el cierre por turno/conciliación.
- **Auditoría con lista blanca**: el alta se registra con local, fecha y
  montos, sin datos personales ni contenido del archivo.
- Contrato HTTP completo: [Operación diaria](../README.md#operación-diaria-sprint-4r-t01)
  en el README del backend.

## Participantes diarios y regla equitativa (SPRINT-4R-T02)

Migración `20261107200000_participantes_diarios_reparto_equitativo` (reversa
manual en su `down.sql`, que Prisma no ejecuta; requiere que ninguna fila use
`EQUAL_SHARES` ni queden horas `NULL` antes de revertir). Completa el modelo de
la operación diaria: **los participantes del reparto viven en la operación** y
una única selección cubre la propina de tarjeta y la de efectivo del mismo
local y día (la operación ya acumula ambas en `tip_fund_amount`), así que
consultar o corregir la operación siempre recupera la misma selección. Agrega
la regla equitativa explícita al pacto y la fuente de reparto alimentada por la
operación, sin tocar los históricos proporcionales. **No agrega endpoints:** la
API de participantes es SPRINT-4R-T03 y el cálculo diario equitativo es
SPRINT-4R-T04; ambos consumen este modelo.

| Entidad | Rol |
| --- | --- |
| `daily_operation_participants` | Participante del reparto de una operación diaria: un trabajador una sola vez por operación (`UNIQUE(operation_id, worker_id)`). FK a la operación en `Cascade` (la participación muere con su operación) y al trabajador en `Restrict` (un trabajador con historial no se borra). |
| `TipAgreementRule.EQUAL_SHARES` | Valor explícito de la regla equitativa en el enum de pactos. Convive con `PROPORTIONAL_TO_HOURS`; ninguna fila existente se reescribe. |
| `tip_pool_lines.hours_worked` / `tip_pool_receipts.hours_worked` | `NULL` solo en repartos cuya regla aplicada es `EQUAL_SHARES`; obligatorias en cualquier otro caso, incluidos los repartos históricos sin pacto ni snapshot. La migración solo cae el `NOT NULL`: los valores existentes no se alteran. El campo sigue requerido en el cliente de Prisma hasta los ajustes de visualización de SPRINT-4R-T04. |
| `tip_pool_daily_operation_sources` | Fuente de un reparto alimentada por la operación diaria, separada de `tip_pool_sources` (que sigue ligada a `tip_entries`). `amount` BIGINT en CLP entero aplica el fondo completo del día y `operation_id` es único: cada operación alimenta como máximo un reparto. |

Reglas clave (CHECK y triggers; aplican a cualquier vía de escritura):

- **Una selección compartida por tarjeta y efectivo**: al ser la operación
  única por local y día y acumular ambos montos en `tip_fund_amount`, no
  existen selecciones paralelas por medio que puedan divergir: tarjeta y
  efectivo del mismo local/día comparten exactamente la misma selección.
- **Validación al escribir, historia intacta después**: el trigger
  `daily_operation_participants_validate_worker_rows` exige, al insertar o
  cambiar una participación, que el trabajador sea del mismo local de la
  operación, con rol `TRABAJADOR` y activo. Validar solo al escribir es lo que
  permite que una baja lógica, un cambio de rol o de local posteriores dejen
  la selección intacta (esos `UPDATE` sobre `users` no reevalúan la
  participación), y la FK `Restrict` impide el borrado físico: las bajas
  lógicas no borran historial.
- **Sin doble reparto y conciliación exacta**: `UNIQUE(operation_id)` evita que
  el mismo fondo se reparta dos veces; al insertar o cambiar la fuente, el
  trigger `tip_pool_daily_operation_sources_enforce_rows` exige que `amount`
  sea exactamente el `tip_fund_amount` de la operación y que reparto y
  operación sean del mismo local
  (`tip_pool_daily_operation_sources_amount_nonnegative` exige además
  `amount >= 0`). El total del reparto cuadra con el fondo que lo originó, en
  CLP entero.
- **Reglas que conviven sin reinterpretar**: la regla aplicada se resuelve
  primero desde el snapshot del reparto (`agreement_snapshot->>'rule'`) y solo
  si no hay, desde el pacto vigente: cambiar el pacto no altera repartos ya
  calculados. `tip_pool_children_hours_consistent` exige horas `NULL` en
  líneas y constancias equitativas y las prohíbe en cualquier otro caso, así
  los repartos proporcionales e históricos siguen funcionando igual y sus
  valores no se reescriben.
- **CONFIRMED/PAID inmutables también frente a la operación**: si la operación
  alimentó un reparto `CONFIRMED` o `PAID`, los triggers
  `daily_operation_participants_require_draft_pool_*` y
  `daily_operations_require_draft_pool_rows` rechazan cambiar la selección de
  participantes y los montos, fecha o local de la operación (con el reparto en
  `DRAFT` sí se permite ajustarla, porque el recálculo vuelve a leerla). La
  fuente diaria solo cambia en `DRAFT`, como las líneas y fuentes históricas.
  Corregir participantes o fondos nunca reinterpreta repartos cerrados; el
  motivo de la diferencia, el voucher y `updated_at` de la operación siguen
  siendo corregibles porque no afectan el reparto.
- **Constancia equitativa consistente**: la foto pagada compara sus horas con
  las de su línea usando `IS NOT DISTINCT FROM` (en
  `tip_pool_receipts_enforce_immutability`), porque `NULL = NULL` no sería
  verdadero: la constancia de un reparto equitativo cuadra consigo misma y
  sigue siendo inmutable.

Sucesores: SPRINT-4R-T03 expone la API de participantes (consulta y corrección
de la selección) y SPRINT-4R-T04 calcula el reparto diario equitativo
reutilizando `tip_pool_lines` para el monto final, sin inventar horas; este
modelo es el contrato que ambos consumen.

## Cómo ver el modelo de forma visual

> Los diagramas Mermaid y DBML de abajo incluyen el módulo de operación
> diaria (SPRINT-4R-T01 y SPRINT-4R-T02); la fuente de verdad física siempre
> es `prisma/schema.prisma` y las migraciones.

Hay cuatro opciones; las dos primeras están listas en este archivo:

1. **Mermaid (en este mismo documento, abajo)** — se renderiza
   automáticamente en GitHub y en VS Code con la extensión de vista previa
   Markdown. Muestra el mapa de relaciones.
2. **DBML → dbdiagram.io** — copia el bloque `dbml` de más abajo y pégalo en
   [dbdiagram.io](https://dbdiagram.io) (gratuito): obtienes el diagrama ER
   completo con columnas, tipos e índices, exportable a PNG/PDF. Es el formato
   recomendado para la documentación del proyecto.
3. **Prisma Studio** (`npm run prisma:studio`) — explorador visual de los
   **datos** (no dibuja el diagrama del esquema). Útil para inspeccionar y
   editar registros en desarrollo.
4. **`prisma-erd-generator`** (opcional, no instalado) — generador comunitario
   que produce un ERD desde `schema.prisma`. Se decidió no agregarlo como
   dependencia (requiere puppeteer/mermaid-cli) y mantener el diagrama
   versionado aquí.

## Diagrama de relaciones (Mermaid)

```mermaid
erDiagram
  ROLES ||--o{ USERS : "asigna"
  STORES ||--o{ USERS : "emplea"
  USERS ||--o{ REFRESH_TOKENS : "renueva sesión"
  USERS |o--o{ AUDIT_LOGS : "ejecuta"
  STORES |o--o{ AUDIT_LOGS : "registra"

  DOCUMENT_TYPES ||--o{ DOCUMENTS : "clasifica"
  STORES ||--o{ DOCUMENTS : "custodia"
  USERS |o--o{ DOCUMENTS : "es titular"
  USERS ||--o{ DOCUMENTS : "crea"
  DOCUMENTS ||--o{ DOCUMENT_VERSIONS : "versiona"
  DOCUMENTS |o--o| DOCUMENT_VERSIONS : "versión vigente"
  USERS ||--o{ DOCUMENT_VERSIONS : "sube"
  USERS |o--o{ DOCUMENTS : "registra en la DT"
  DOCUMENTS ||--o| PAYSLIPS : "archivo de la liquidación"
  USERS ||--o{ PAYSLIPS : "recibe / carga / publica"

  STORES ||--o{ TIP_ENTRIES : "registra propinas diarias"
  USERS ||--o{ TIP_ENTRIES : "responsable"
  TIP_ENTRIES ||--o{ SALES : "reconcilia"
  TIP_ENTRIES ||--o| TIP_POOL_SOURCES : "usado como fuente"
  STORES ||--o{ TIP_AGREEMENTS : "tiene pacto"
  USERS ||--o{ TIP_AGREEMENTS : "crea"
  TIP_AGREEMENTS |o--o{ TIP_POOLS : "aplica"
  STORES ||--o{ WORK_HOURS_RECORDS : "registra horas"
  USERS ||--o{ WORK_HOURS_RECORDS : "trabajador / registrador"
  WORK_HOURS_RECORDS |o--o{ TIP_POOL_LINES : "fuente de horas"
  STORES ||--o{ TIP_POOLS : "reparte"
  USERS ||--o{ TIP_POOLS : "calcula / confirma"
  TIP_POOLS ||--o{ TIP_POOL_LINES : "detalla"
  TIP_POOLS ||--o{ TIP_POOL_SOURCES : "compone"
  TIP_POOLS ||--o{ TIP_POOL_DAILY_OPERATION_SOURCES : "compone (operación diaria)"
  USERS ||--o{ TIP_POOL_LINES : "recibe"

  STORES ||--o{ DAILY_OPERATIONS : "opera a diario"
  USERS ||--o{ DAILY_OPERATIONS : "responsable"
  DAILY_OPERATIONS |o--o| DAILY_OPERATION_VOUCHERS : "voucher 1:1"
  DAILY_OPERATIONS ||--o{ DAILY_OPERATION_PARTICIPANTS : "selecciona"
  USERS ||--o{ DAILY_OPERATION_PARTICIPANTS : "participa"
  DAILY_OPERATIONS |o--o| TIP_POOL_DAILY_OPERATION_SOURCES : "alimenta un reparto"

  STORES ||--o{ SALES : "vende"
  PAYMENT_METHODS ||--o{ SALES : "cobra"
  PAYMENT_METHODS ||--o{ TIP_ENTRIES : "recibe propinas"
  PAYMENT_METHODS ||--o{ CASH_CLOSING_LINES : "desglosa"
  PAYMENT_METHODS |o--o{ CASH_CLOSING_VOUCHERS : "clasifica (opcional)"
  CASH_CLOSINGS |o--o{ SALES : "agrupa"
  CASH_CLOSINGS ||--o{ CASH_CLOSING_LINES : "desglosa por medio de pago"
  CASH_CLOSINGS ||--o{ CASH_CLOSING_VOUCHERS : "respalda la conciliación"
  CASH_CLOSINGS ||--o{ CASH_CLOSING_TIP_ENTRIES : "referencia propinas"
  TIP_ENTRIES ||--o{ CASH_CLOSING_TIP_ENTRIES : "vinculado (solo referencia)"
  USERS ||--o{ SALES : "registra"
  STORES ||--o{ CASH_CLOSINGS : "cierra por turno"
  USERS ||--o{ CASH_CLOSINGS : "es responsable"
  USERS |o--o{ CASH_CLOSINGS : "cierra"

  STORES ||--o{ PRODUCTS : "almacena (vía movimientos)"
  PRODUCTS ||--o{ INVENTORY_MOVEMENTS : "mueve"
  STORES ||--o{ INVENTORY_MOVEMENTS : "en"
  USERS ||--o{ INVENTORY_MOVEMENTS : "registra"
  STORES ||--o{ INVENTORY_COUNTS : "cuenta"
  USERS ||--o{ INVENTORY_COUNTS : "levanta"
  INVENTORY_COUNTS ||--o{ INVENTORY_COUNT_LINES : "detalla"
  PRODUCTS ||--o{ INVENTORY_COUNT_LINES : "compara"

  USERS ||--o{ DATA_RIGHTS_REQUESTS : "solicita (titular)"
  USERS |o--o{ DATA_RIGHTS_REQUESTS : "resuelve"
```

## Modelo completo en DBML (para dbdiagram.io)

```dbml
Project moi_food_gestion {
  database_type: 'PostgreSQL'
  Note: 'Sistema de gestión interna Subway "Moi-food" — Capstone Duoc UC (SPRINT-3-T09)'
}

enum DocumentStatus {
  ACTIVE
  EXPIRED
  ARCHIVED
}

enum PayslipStatus {
  PENDING_SIGNATURE
  PUBLISHED
}

enum TipPoolStatus {
  DRAFT
  CONFIRMED
  PAID
}

enum TipAgreementRule {
  PROPORTIONAL_TO_HOURS [note: 'Histórica: reparte en proporción a las horas registradas']
  EQUAL_SHARES [note: 'Equitativa entre los participantes de la operación diaria (SPRINT-4R-T02); sin horas']
}

enum PaymentMethodBehavior {
  CASH [note: 'Recibe el fondo de caja; no se concilia contra vouchers']
  RECONCILABLE_CARD [note: 'Alimenta mrcomanda_net_sales con vouchers MrComanda clasificados']
  EXTERNAL_OTHER [note: 'Transferencias, Junaeb, etc.: fuera de la conciliación de vouchers']
}

enum SaleSource {
  MANUAL [note: 'Registro del supervisor; sin período']
  MRCOMANDA [note: 'Total neto agregado por local, medio y período; sin propina']
}

enum SaleChannel {
  IN_STORE
  DELIVERY
}

enum CashClosingStatus {
  OPEN
  CLOSED
}

enum CashClosingVoucherSource {
  MRCOMANDA [note: 'Venta neta del punto de venta']
  MERCADO_PAGO [note: 'Cobro bruto; incluye la propina pagada con tarjeta']
}

enum UnitOfMeasure {
  UNIT
  KG
  G
  L
  ML
  PACK
}

enum InventoryMovementType {
  PURCHASE
  CONSUMPTION
  WASTE
  ADJUSTMENT
}

enum InventoryCountStatus {
  OPEN
  CONFIRMED
}

enum DataRightType {
  ACCESS
  RECTIFICATION
  CANCELLATION
  OBJECTION
  PORTABILITY
}

enum DataRightStatus {
  PENDING
  IN_PROGRESS
  RESOLVED
  REJECTED
}

Table stores {
  id uuid [pk, default: `gen_random_uuid()`]
  name varchar(100) [not null]
  city varchar(100) [not null]
  address varchar(200) [not null]
  is_active boolean [not null, default: true]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]

  Note: 'stores_name_normalized_key: nombre único normalizado a mayúsculas, sin tildes ni espacios repetidos'
}

Table roles {
  id uuid [pk, default: `gen_random_uuid()`]
  code varchar(30) [not null, unique]
  name varchar(50) [not null]
  description varchar(255)
  is_active boolean [not null, default: true]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
}

Table users {
  id uuid [pk, default: `gen_random_uuid()`]
  email varchar(160) [not null, unique]
  password_hash varchar(255) [not null]
  first_name varchar(80) [not null]
  last_name varchar(80) [not null]
  rut varchar(12) [unique, note: 'Dato personal Ley 21.719; NULL al anonimizar']
  phone varchar(20)
  hired_at date
  is_active boolean [not null, default: true]
  anonymized_at timestamptz [note: 'Marca de anonimización (derecho de cancelación)']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  role_id uuid [not null, ref: > roles.id]
  store_id uuid [ref: > stores.id, note: 'NULL = usuario global (dueño/admin/contador)']

  indexes {
    store_id
  }
}

Table refresh_tokens {
  id uuid [pk, default: `gen_random_uuid()`]
  token_hash varchar(255) [not null, unique, note: 'Nunca el token en claro']
  expires_at timestamptz [not null]
  revoked_at timestamptz
  ip_address inet
  user_agent varchar(255)
  created_at timestamptz [not null, default: `now()`]
  user_id uuid [not null, ref: > users.id]

  indexes {
    user_id
  }
}

Table audit_logs {
  id bigserial [pk]
  action varchar(60) [not null]
  entity_type varchar(60) [not null]
  entity_id varchar(64)
  detail jsonb
  ip_address inet
  user_agent varchar(255)
  created_at timestamptz [not null, default: `now()`]
  user_id uuid [ref: > users.id]
  store_id uuid [ref: > stores.id]

  indexes {
    (store_id, created_at)
    (user_id, created_at)
    (entity_type, entity_id)
  }

  Note: 'INMUTABLE: solo INSERT/SELECT; sin updated_at'
}

Table document_types {
  id uuid [pk, default: `gen_random_uuid()`]
  code varchar(40) [not null, unique, note: 'CONTRATO, ANEXO, PACTO, FINIQUITO, LIQUIDACION...']
  name varchar(100) [not null]
  description varchar(255)
  requires_expiration boolean [not null, default: false]
  requires_dt_registration boolean [not null, default: false, note: 'Registro en la DT dentro de 15 días']
  retention_years int [not null, default: 5, note: 'Conservación art. 9 bis CT']
  is_active boolean [not null, default: true]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
}

Table documents {
  id uuid [pk, default: `gen_random_uuid()`]
  title varchar(160) [not null]
  description text
  status DocumentStatus [not null, default: 'ACTIVE']
  issued_at date [note: 'Fecha de celebración (firma)']
  expires_at date [note: 'Permite alertas de vencimiento']
  retain_until date [not null, note: 'Conservar hasta: issued_at (o carga) + retention_years']
  dt_registration_due_at date [note: 'Plazo de 15 días para registrar en la DT; NULL si el tipo no lo exige']
  dt_registered_at timestamptz [note: 'Registro en la DT marcado como realizado']
  dt_registered_by_id uuid [ref: > users.id, note: 'Quién marcó el registro en la DT']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]
  subject_user_id uuid [ref: > users.id, note: 'Trabajador titular del documento']
  document_type_id uuid [not null, ref: > document_types.id]
  created_by_id uuid [not null, ref: > users.id]
  current_version_id uuid [unique, ref: > document_versions.id]

  indexes {
    (store_id, status)
    subject_user_id
    expires_at
    dt_registration_due_at
    retain_until
  }
}

Table document_versions {
  id uuid [pk, default: `gen_random_uuid()`]
  version_number int [not null]
  file_name varchar(255) [not null]
  file_path varchar(500) [not null, note: 'Archivo en volumen separado']
  mime_type varchar(100) [not null]
  size_bytes bigint [not null]
  sha256_hash char(64) [not null, unique, note: 'Integridad verificable']
  change_note varchar(255)
  uploaded_at timestamptz [not null, default: `now()`]
  document_id uuid [not null, ref: > documents.id]
  uploaded_by_id uuid [not null, ref: > users.id]

  indexes {
    (document_id, version_number) [unique]
  }

  Note: 'INMUTABLE: cada corrección crea una versión nueva'
}

Table payslips {
  id uuid [pk, default: `gen_random_uuid()`]
  period date [not null, note: 'Mes de la remuneración (primer día, CHECK)']
  status PayslipStatus [not null, default: 'PENDING_SIGNATURE']
  signed_at date [note: 'Fecha de firma; obligatoria al publicar (CHECK)']
  published_at timestamptz [note: 'Obligatoria al publicar (CHECK)']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  document_id uuid [not null, unique, ref: - documents.id, note: 'Documento LIQUIDACION del gestor documental']
  worker_id uuid [not null, ref: > users.id, note: 'Igual a documents.subject_user_id (trigger)']
  created_by_id uuid [not null, ref: > users.id]
  published_by_id uuid [ref: > users.id, note: 'Obligatorio al publicar (CHECK)']

  indexes {
    (worker_id, period) [unique]
    (status, period)
  }
}

Table tip_entries {
  id uuid [pk, default: `gen_random_uuid()`]
  business_date date [not null]
  amount decimal(12,2) [not null, note: 'Monto disponible para repartir']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]
  payment_method_id uuid [not null, ref: > payment_methods.id]
  responsible_id uuid [not null, ref: > users.id, note: 'Quién registró la entrada']

  indexes {
    (store_id, business_date)
    (store_id, business_date, payment_method_id) [unique, note: 'Un registro diario por local, fecha y medio de pago']
  }
}

Table tip_agreements {
  id uuid [pk, default: `gen_random_uuid()`]
  name varchar(160) [not null]
  rule TipAgreementRule [not null, note: 'PROPORTIONAL_TO_HOURS']
  valid_from date [not null]
  valid_to date [note: 'NULL = vigente']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]
  created_by_id uuid [not null, ref: > users.id]

  indexes {
    (store_id, valid_from) [unique, note: 'Un pacto por local y fecha de inicio']
    (store_id, valid_to)
  }

  Note: 'tip_agreements_no_overlap impide vigencias solapadas por local; rangos inclusivos'
}

Table work_hours_records {
  id uuid [pk, default: `gen_random_uuid()`]
  period_start date [not null]
  period_end date [not null]
  hours_worked decimal(6,2) [not null, note: 'Horas trabajadas en el período']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]
  worker_id uuid [not null, ref: > users.id]
  recorded_by_id uuid [not null, ref: > users.id]

  indexes {
    (store_id, period_start, period_end)
    (store_id, worker_id, period_start, period_end) [unique, note: 'Un registro de horas por trabajador y período']
  }

  Note: 'work_hours_records_no_overlap impide períodos solapados para un trabajador'
}

Table tip_pools {
  id uuid [pk, default: `gen_random_uuid()`]
  period_start date [not null]
  period_end date [not null]
  total_amount decimal(12,2) [not null, note: 'Suma de tip_entries del período']
  status TipPoolStatus [not null, default: 'DRAFT']
  notes varchar(255)
  agreement_snapshot jsonb [note: 'Copia del pacto aplicado al momento del cálculo']
  confirmed_at timestamptz
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]
  calculated_by_id uuid [not null, ref: > users.id]
  confirmed_by_id uuid [ref: > users.id]
  agreement_id uuid [ref: > tip_agreements.id, note: 'Pacto vigente al calcular']

  indexes {
    (store_id, period_start, period_end) [unique]
    agreement_id
  }
}

Table tip_pool_lines {
  id uuid [pk, default: `gen_random_uuid()`]
  hours_worked decimal(6,2) [note: 'Snapshot de horas usadas en el cálculo (art. 64 CT); NULL solo en repartos EQUAL_SHARES (trigger)']
  amount decimal(12,2) [not null, note: 'Registro escrito del reparto']
  pool_id uuid [not null, ref: > tip_pools.id]
  user_id uuid [not null, ref: > users.id]
  work_hours_record_id uuid [ref: > work_hours_records.id, note: 'Registro fuente de las horas']

  indexes {
    (pool_id, user_id) [unique]
    work_hours_record_id
  }
}

Table tip_pool_sources {
  id uuid [pk, default: `gen_random_uuid()`]
  amount decimal(12,2) [not null, note: 'Monto de la fuente aplicado al reparto (snapshot)']
  pool_id uuid [not null, ref: > tip_pools.id]
  tip_entry_id uuid [not null, unique, ref: > tip_entries.id, note: 'Registro diario usado una sola vez']

  indexes {
    pool_id
  }
}

Table tip_pool_receipts {
  id uuid [pk, default: `gen_random_uuid()`]
  worker_name varchar(161) [not null, note: 'Foto: nombre del trabajador']
  store_name varchar(100) [not null, note: 'Foto: nombre del local']
  period_start date [not null]
  period_end date [not null]
  hours_worked decimal(6,2) [note: 'Foto de horas; NULL solo en repartos equitativos (compara con IS NOT DISTINCT FROM)']
  amount decimal(12,2) [not null]
  payment_date date [not null]
  paid_by_name varchar(161) [not null]
  detail jsonb [not null, note: 'Detalle del reparto para explicarse sola']
  created_at timestamptz [not null, default: `now()`]
  pool_id uuid [not null, ref: > tip_pools.id]
  user_id uuid [not null, ref: > users.id]
  store_id uuid [not null, ref: > stores.id]
  paid_by_id uuid [not null, ref: > users.id]

  indexes {
    (pool_id, user_id) [unique]
    user_id
    store_id
    paid_by_id
  }

  Note: 'Constancia inmutable: solo INSERT de un reparto PAID (SPRINT-3-T13)'
}

Table payment_methods {
  id uuid [pk, default: `gen_random_uuid()`]
  code varchar(40) [not null, unique, note: 'Estable e inmutable: contrato operativo (CASH, DEBIT_CARD, CREDIT_CARD, TRANSFER...)']
  name varchar(100) [not null, note: 'Administrable sin reescribir montos ni vínculos históricos']
  sort_order int [not null, note: 'Orden de presentación en formularios y cierres']
  is_active boolean [not null, default: true, note: 'Desactivar no elimina ni oculta el historial']
  behavior PaymentMethodBehavior [not null]
  available_for_tips boolean [not null, default: false, note: 'Elegible para el registro diario de propinas']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]

  Note: 'Catálogo administrable (SPRINT-4-T32); reemplaza al enum PaymentMethod. Sin borrado físico (FK Restrict)'
}

Table sales {
  id uuid [pk, default: `gen_random_uuid()`]
  sold_at timestamptz [not null, note: 'Día de negocio en hora de Chile para la reconciliación']
  channel SaleChannel [not null, default: 'IN_STORE']
  gross_amount decimal(12,2) [not null]
  tip_amount decimal(12,2) [not null, default: 0, note: 'Se reconcilia con un único tip_entry; no es fuente del reparto']
  source SaleSource [not null, default: 'MANUAL', note: 'Origen y período van siempre juntos (CHECK)']
  period_start timestamptz [note: 'Solo MRCOMANDA: inicio del período agregado']
  period_end timestamptz [note: 'Solo MRCOMANDA: fin del período (> inicio, CHECK)']
  created_at timestamptz [not null, default: `now()`]
  store_id uuid [not null, ref: > stores.id]
  payment_method_id uuid [not null, ref: > payment_methods.id]
  cash_closing_id uuid [ref: > cash_closings.id]
  registered_by_id uuid [not null, ref: > users.id]
  tip_entry_id uuid [ref: > tip_entries.id, note: 'Reconciliación con el registro diario']

  indexes {
    (store_id, payment_method_id, period_start, period_end) [unique, note: 'Un total MrComanda por local, medio y período; los NULL manuales no colisionan']
    (store_id, sold_at)
    cash_closing_id
    tip_entry_id
  }
}

Table cash_closings {
  id uuid [pk, default: `gen_random_uuid()`]
  business_date date [not null]
  shift smallint [not null, note: 'Número de turno (>= 1, CHECK); sin default']
  opening_cash decimal(12,2) [not null, note: 'Fondo de caja (>= 0): se suma a lo esperado de la línea CASH']
  status CashClosingStatus [not null, default: 'OPEN', note: 'Se crea en OPEN; CLOSED es inmutable (triggers)']
  notes varchar(255)
  difference_reason varchar(500) [note: 'Obligatorio para cerrar si hay diferencia; no en blanco (CHECK)']
  mrcomanda_net_sales decimal(12,2) [not null, default: 0, note: 'Suma de vouchers MRCOMANDA al cerrar']
  mercado_pago_gross_amount decimal(12,2) [not null, default: 0, note: 'Suma de vouchers MERCADO_PAGO al cerrar']
  mercado_pago_tip_amount decimal(12,2) [not null, default: 0, note: 'Propina incluida en el bruto; <= bruto']
  reconciliation_difference decimal(12,2) [not null, default: 0, note: 'mp_gross - mp_tip - mrcomanda_net (CHECK)']
  closed_at timestamptz [note: 'Informado si y solo si CLOSED (CHECK)']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]
  responsible_id uuid [not null, ref: > users.id, note: 'Responsable asociado (obligatorio)']
  closed_by_id uuid [ref: > users.id, note: 'Quién cerró; informado si y solo si CLOSED (CHECK)']

  indexes {
    (store_id, business_date, shift) [unique, note: 'Un cierre por local, día y turno']
    closed_by_id
  }

  Note: 'Conciliación: SUPUESTO pendiente con el PO (venta neta MrComanda = porción cobrada por Mercado Pago; montos con IVA)'
}

Table cash_closing_lines {
  id uuid [pk, default: `gen_random_uuid()`]
  expected_amount decimal(12,2) [not null, note: 'Calculado desde las ventas del medio de pago (>= 0)']
  counted_amount decimal(12,2) [not null, note: 'Declarado por el supervisor (>= 0)']
  difference decimal(12,2) [not null, note: 'counted - expected (CHECK); el total del cierre es la suma de líneas']
  closing_id uuid [not null, ref: > cash_closings.id]
  payment_method_id uuid [not null, ref: > payment_methods.id]

  indexes {
    (closing_id, payment_method_id) [unique, note: 'Una línea por medio de pago por cierre']
  }
}

Table cash_closing_vouchers {
  id uuid [pk, default: `gen_random_uuid()`]
  source CashClosingVoucherSource [not null]
  period_start timestamptz [not null]
  period_end timestamptz [not null, note: '> period_start (CHECK)']
  amount decimal(12,2) [not null, note: '>= 0']
  tip_included_amount decimal(12,2) [not null, default: 0, note: '<= amount; solo MERCADO_PAGO puede informarla']
  reference varchar(100)
  created_at timestamptz [not null, default: `now()`]
  closing_id uuid [not null, ref: > cash_closings.id]
  payment_method_id uuid [ref: > payment_methods.id, note: 'Clasifica vouchers MrComanda nuevos; NULL = heredado (sigue sumando)']

  indexes {
    (closing_id, source)
  }
}

Table cash_closing_tip_entries {
  closing_id uuid [not null, ref: > cash_closings.id]
  tip_entry_id uuid [not null, ref: > tip_entries.id]

  indexes {
    (closing_id, tip_entry_id) [pk]
    tip_entry_id
  }

  Note: 'Solo referencia: no copia montos; exige el mismo local y día que el cierre (trigger)'
}

Table daily_operations {
  id uuid [pk, default: `gen_random_uuid()`]
  business_date date [not null, note: 'Fecha de negocio']
  card_tip_amount bigint [not null, note: 'Propina tarjeta CLP entero >= 0']
  cash_tip_amount bigint [not null, note: 'Propina efectivo CLP entero >= 0']
  tip_fund_amount bigint [not null, note: 'Fondo: card_tip + cash_tip (CHECK)']
  cash_difference bigint [not null, note: 'Con signo: positivo sobrante, negativo faltante']
  difference_reason varchar(500) [note: 'Obligatorio si la diferencia no es cero (CHECK)']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]
  responsible_id uuid [not null, ref: > users.id, note: 'Siempre desde el JWT']
  voucher_id uuid [unique, ref: > daily_operation_vouchers.id, note: 'Obligatorio si card_tip_amount > 0 (CHECK); relación 1:1']

  indexes {
    (store_id, business_date) [unique, note: 'Una operación por local y día']
  }

  Note: 'SPRINT-4R-T01: fuente de ambos montos de propina. Montos, fecha y local inmutables si alimentó un reparto CONFIRMED/PAID (SPRINT-4R-T02)'
}

Table daily_operation_vouchers {
  id uuid [pk, default: `gen_random_uuid()`]
  file_name varchar(255) [not null]
  file_path varchar(500) [not null, note: 'Archivo en volumen privado (subcarpeta vouchers/)']
  mime_type varchar(100) [not null]
  size_bytes bigint [not null]
  sha256_hash char(64) [not null, note: 'Integridad verificable']
  created_at timestamptz [not null, default: `now()`]
}

Table daily_operation_participants {
  id uuid [pk, default: `gen_random_uuid()`]
  created_at timestamptz [not null, default: `now()`]
  operation_id uuid [not null, ref: > daily_operations.id, note: 'Cascade: la participación muere con su operación']
  worker_id uuid [not null, ref: > users.id, note: 'Restrict: el trabajador con historial no se borra']

  indexes {
    (operation_id, worker_id) [unique, note: 'Un trabajador una sola vez por operación']
    worker_id
  }

  Note: 'SPRINT-4R-T02: selección compartida por tarjeta y efectivo; trigger exige mismo local, rol TRABAJADOR y activo al escribir'
}

Table tip_pool_daily_operation_sources {
  id uuid [pk, default: `gen_random_uuid()`]
  amount bigint [not null, note: 'Fondo aplicado en CLP entero = tip_fund_amount de la operación (trigger); >= 0']
  pool_id uuid [not null, ref: > tip_pools.id]
  operation_id uuid [not null, unique, ref: > daily_operations.id, note: 'Una operación alimenta como máximo un reparto']

  indexes {
    pool_id
  }

  Note: 'SPRINT-4R-T02: fuente del reparto alimentada por la operación diaria, separada de tip_pool_sources'
}

Table products {
  id uuid [pk, default: `gen_random_uuid()`]
  sku varchar(40) [not null, unique]
  name varchar(120) [not null]
  category varchar(60)
  unit UnitOfMeasure [not null]
  min_stock decimal(12,3) [not null, default: 0]
  is_active boolean [not null, default: true]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
}

Table inventory_movements {
  id bigserial [pk]
  type InventoryMovementType [not null, note: 'quantity siempre positiva; el tipo define el signo']
  quantity decimal(12,3) [not null]
  reason varchar(255)
  reference varchar(60)
  occurred_at timestamptz [not null, default: `now()`]
  created_at timestamptz [not null, default: `now()`]
  store_id uuid [not null, ref: > stores.id]
  product_id uuid [not null, ref: > products.id]
  created_by_id uuid [not null, ref: > users.id]

  indexes {
    (store_id, product_id, occurred_at)
  }

  Note: 'Libro mayor: stock = suma firmada de movimientos'
}

Table inventory_counts {
  id uuid [pk, default: `gen_random_uuid()`]
  status InventoryCountStatus [not null, default: 'OPEN']
  counted_at timestamptz [not null, default: `now()`]
  notes varchar(255)
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]
  created_by_id uuid [not null, ref: > users.id]
}

Table inventory_count_lines {
  id uuid [pk, default: `gen_random_uuid()`]
  system_quantity decimal(12,3) [not null, note: 'Stock según sistema al contar']
  counted_quantity decimal(12,3) [not null]
  difference decimal(12,3) [not null, note: 'Mermas detectadas']
  count_id uuid [not null, ref: > inventory_counts.id]
  product_id uuid [not null, ref: > products.id]

  indexes {
    (count_id, product_id) [unique]
  }
}

Table data_rights_requests {
  id uuid [pk, default: `gen_random_uuid()`]
  type DataRightType [not null]
  status DataRightStatus [not null, default: 'PENDING']
  description text
  response text
  requested_at timestamptz [not null, default: `now()`]
  due_at date [not null, note: 'Plazo legal de respuesta']
  resolved_at timestamptz
  updated_at timestamptz [not null]
  subject_id uuid [not null, ref: > users.id, note: 'Titular de los datos']
  resolved_by_id uuid [ref: > users.id]

  indexes {
    (status, due_at)
  }

  Note: 'Derechos ARCO — Ley N°21.719'
}
```

## Comandos útiles

```bash
# Levantar PostgreSQL (docker compose, puerto 5433 del host)
docker compose up -d db

# Aplicar migraciones en desarrollo / producción
npm run prisma:migrate            # migrate dev (crea nuevas migraciones)
npm run prisma:migrate:deploy     # migrate deploy (solo aplica, para prod/CI)

# Regenerar el cliente Prisma (también corre solo con npm install)
npm run prisma:generate

# Explorar los datos en el navegador
npm run prisma:studio

# Tests (los de integración requieren la BD y se revierten solos)
npm run test
TEST_DATABASE_URL="postgresql://postgres:cambiar-en-produccion@localhost:5433/subway_gestion" npm run test
```

## Archivos relacionados

- `prisma/schema.prisma` — modelo (fuente de verdad)
- `prisma/migrations/` — historial de migraciones aplicables con `migrate deploy`
- `prisma.config.ts` — configuración del CLI de Prisma 7 (schema, migraciones, `DATABASE_URL`)
- `src/prisma/prisma.module.ts` / `src/prisma/prisma.service.ts` — integración NestJS (módulo global)
- `src/generated/prisma/` — cliente generado (no se commitea; `npm install` lo regenera)
- `test/prisma-schema.spec.ts` — validación del schema y la migración
- `test/database.integration.spec.ts` — pruebas de restricciones contra PostgreSQL real
