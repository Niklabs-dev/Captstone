# Modelo de datos — Sistema de Gestión Interna "Moi-food" (Subway)

> Tarea: **SPRINT-3-T09** · Fuente de verdad: `prisma/schema.prisma` · Motor: PostgreSQL 16 · ORM: Prisma 7
>
> Este documento describe el modelo de datos completo del sistema (los 6 módulos),
> sus decisiones de diseño, el cumplimiento normativo (Código del Trabajo y
> Ley N°21.719) y las formas de visualizarlo.

## Vista general por módulo

| Módulo                  | Tablas                                                                                                                                                                                                            | Propósito                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Núcleo                  | `stores`, `roles`, `users`, `refresh_tokens`, `audit_logs`                                                                                                                                                        | Locales, control de acceso por rol y local, autenticación JWT y auditoría inmutable                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Gestor Documental       | `document_types`, `documents`, `document_versions`, `payslips`                                                                                                                                                    | Documentación laboral con hash SHA-256, versionado y conservación por 5 años; liquidaciones de sueldo con estado de publicación                                                                                                                                                                                                                                                                                                                                                                                |
| Propinas                | `daily_tip_allocations`, `tip_payment_batches`, `tip_entries`, `tip_agreements`, `work_hours_records`, `tip_pools`, `tip_pool_lines`, `tip_pool_sources`, `tip_pool_receipts`, `tip_pool_daily_operation_sources` | **Vigente (SPRINT-4A-T02):** propina diaria por participante, creada al guardar la operación diaria, y lotes de pago por local y período. **Histórico de solo lectura:** pacto de reparto (proporcional histórico y equitativo), horas trabajadas, reparto con snapshots (art. 64 CT) y constancias de pago; `tip_entries` conserva la captura histórica por medio (modo lectura desde SPRINT-4R-T01) y `tip_pool_daily_operation_sources` vincula el reparto con la operación diaria (SPRINT-4R-T02)          |
| Ventas y Caja           | `payment_methods`, `sales`, `cash_closings`, `cash_closing_lines`, `cash_closing_vouchers`, `cash_closing_tip_entries`                                                                                            | **Histórico, modo lectura:** catálogo administrable de medios de pago (vigente: clasifica las líneas de la importación de ventas), ventas por local (manuales y totales netos MrComanda) y cierre de caja por local, día y turno con conciliación y vouchers. Reemplazado operativamente por la operación diaria                                                                                                                                                                                               |
| Operación diaria        | `daily_operations`, `daily_operation_vouchers`, `daily_operation_participants`                                                                                                                                    | Una operación por local y fecha de negocio (SPRINT-4R-T01): propina tarjeta con voucher fotográfico, propina efectivo, fondo de propinas calculado y diferencia de efectivo con signo y motivo. Fuente operativa de ambos montos de propina y, desde SPRINT-4R-T02, de la selección de participantes del reparto (compartida por tarjeta y efectivo)                                                                                                                                                           |
| Importación de ventas   | `payment_method_aliases`, `sales_imports`, `sales_import_lines`, `sales_import_skipped_lines`, `store_external_codes`                                                                                             | Ventas diarias importadas desde el Excel de MrComanda (SPRINT-4R-T08): el local se identifica por `stores.subway_store_id` (SPRINT-4A-T17; `store_external_codes` queda sin uso), alias de medios de pago, resolución manual de lo no identificado y líneas en 0 omitidas (SPRINT-4A-T18/T21), archivo importado con hash SHA-256 y versiones (una vigente por local y fecha) y totales por medio de pago. No guarda propinas ni diferencias de efectivo (vienen de la operación diaria) ni escribe en `sales` |
| Calendario de operación | `store_operating_schedules`, `store_closures`                                                                                                                                                                     | Días semanales en que abre cada local, desde cuándo se exigen ventas y cierres por excepción con motivo (SPRINT-4R-T12). El estado diario de ventas (IMPORTADO / PENDIENTE / ATRASADO / CERRADO) se calcula al consultar, sin tablas de alertas                                                                                                                                                                                                                                                                |
| Inventario              | `products`, `inventory_template_rows`, `inventory_movements`, `inventory_counts`, `inventory_count_lines`                                                                                                         | Catálogo de productos con SKU de proveedor, nombres alternativos y formato de caja y paquete; filas fijas de la plantilla impresa; toma de inventario por local (En curso / Finalizado) con conteo por caja, paquete y cantidad suelta (SPRINT-5-T01). El libro mayor de movimientos queda para la comparación contra el stock esperado                                                                                                                                                                        |
| Ley N°21.719            | `data_rights_requests`                                                                                                                                                                                            | Solicitudes de derechos ARCO de los titulares de datos personales                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**41 tablas y 19 enums**: el modelo base (27 tablas, hasta SPRINT-4-T32) más la
operación diaria de SPRINT-4R-T01 (`daily_operations` y
`daily_operation_vouchers`), los participantes y fuentes diarias de
SPRINT-4R-T02 (`daily_operation_participants` y
`tip_pool_daily_operation_sources`) y la importación de ventas MrComanda de
SPRINT-4R-T08 (`store_external_codes`, `payment_method_aliases`,
`sales_imports` y `sales_import_lines`, con los enums `ExternalSystem` y
`SalesImportStatus`) y el calendario de operación de SPRINT-4R-T12
(`store_operating_schedules` y `store_closures`), y del Sprint 4A la propina
diaria y los lotes de pago (`daily_tip_allocations` y `tip_payment_batches`,
enum `TipAllocationStatus`) y las líneas omitidas de la importación
(`sales_import_skipped_lines`, enum `SalesImportResolution`), y del Sprint 5
las filas de la plantilla de inventario (`inventory_template_rows`, enum
`InventoryTemplateRowKind`). Fuente de verdad física: `prisma/schema.prisma`.
SPRINT-4R-T02 no agrega enums: añade el valor `EQUAL_SHARES` a
`TipAgreementRule`. El Portal del Trabajador no agrega
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

| Principio / obligación                                                           | Mecanismo en el modelo                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minimización y finalidad                                                         | Los datos personales existen **solo en `users`** (email, nombres, RUT, teléfono, fecha de contratación); el resto del modelo referencia por UUID, sin duplicar datos personales                                                                                                  |
| Base legal                                                                       | La relación laboral y la obligación legal de conservar documentación (art. 9 bis CT) fundamentan el tratamiento; no se requiere consentimiento adicional para estos datos                                                                                                        |
| Derecho de **cancelación**                                                       | **Anonimización, no borrado**: `users.anonymized_at` marca la anonimización; `rut`/`phone` quedan `NULL` (el índice único admite múltiples `NULL`), nombres se reemplazan por "Usuario Anonimizado" y el email por uno técnico. La trazabilidad laboral y documental se preserva |
| Derechos **ARCO** (acceso, rectificación, cancelación, oposición) y portabilidad | Tabla `data_rights_requests`: tipo de derecho, estado (`PENDING` → `RESOLVED`/`REJECTED`), plazo legal de respuesta (`due_at`), quién resolvió y cuándo                                                                                                                          |
| Seguridad del tratamiento                                                        | Contraseñas solo como hash (`password_hash`); refresh tokens solo como hash con expiración y revocación; secretos fuera del código (variables de entorno)                                                                                                                        |
| Registro de actividades de tratamiento                                           | `audit_logs` inmutable: usuario, operación, entidad, local, detalle (JSONB), IP y fecha de cada operación crítica                                                                                                                                                                |
| Conservación limitada                                                            | `document_types.retention_years` (5 por defecto), `documents.retain_until` (fecha hasta la que se conserva cada documento) y `documents.expires_at` para gestionar plazos; el cumplimiento de conservación laboral prima sobre el borrado                                        |
| Aislamiento por titular (Portal del Trabajador)                                  | `documents.subject_user_id` y `users.store_id` permiten que cada trabajador vea **solo su información**; el aislamiento se enforce en los servicios del backend                                                                                                                  |

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

| Plazo                                | Columnas                                                                      | Regla                                                                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conservación (art. 9 bis CT)         | `documents.retain_until`                                                      | Se fija al crear el documento: `issued_at` (o el día de carga, hora de Chile) + `document_types.retention_years`. Es una foto: no cambia si luego se modifica el tipo. Base del bloqueo de eliminación (SPRINT-2-T07). |
| Registro en la Dirección del Trabajo | `document_types.requires_dt_registration`, `documents.dt_registration_due_at` | Los tipos marcados (`CONTRATO`, `ANEXO` y `FINIQUITO`) tienen 15 días desde su celebración para registrarse en la DT. `dt_registration_due_at` es `NULL` si el tipo no lo exige.                                       |
| Registro en la DT realizado          | `documents.dt_registered_at`, `documents.dt_registered_by_id`                 | Mientras `dt_registered_at` sea `NULL`, la alerta sigue activa (SPRINT-2-T08).                                                                                                                                         |

Dos `CHECK` mantienen la consistencia: un documento solo se marca como
registrado en la DT si tiene plazo (`documents_dt_registered_requires_due_at`),
y la fecha de registro y quién lo marcó van siempre juntos
(`documents_dt_registered_by_consistent`).

## Liquidaciones de sueldo (E2-H1)

Una liquidación (`payslips`, SPRINT-2-T12) es un documento de tipo
`LIQUIDACION` del gestor documental (`document_id`, único): reutiliza su
versionado, su hash SHA-256 y su plazo de conservación de 5 años, y agrega el
período y el estado de publicación.

| Columna                                        | Regla                                                                                                                                                                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `period`                                       | Mes de la remuneración, guardado como su primer día (`payslips_period_first_day_check`).                                                                                                                                            |
| `status`                                       | `PENDING_SIGNATURE` al cargarla el contador (no visible para el trabajador) y `PUBLISHED` al confirmar su publicación.                                                                                                              |
| `signed_at`, `published_at`, `published_by_id` | Fecha de firma, de publicación y quién publicó: obligatorias solo en `PUBLISHED` y vacías mientras está pendiente (`payslips_status_publication_check`).                                                                            |
| `worker_id`                                    | Repite `documents.subject_user_id` para exigir **una liquidación por trabajador y período** (`UNIQUE(worker_id, period)`); el trigger `payslips_check_document` rechaza un documento que no sea `LIQUIDACION` o de otro trabajador. |

Publicada, la liquidación es **inmutable** (SPRINT-2-T14, migración
`liquidaciones_publicadas_inmutables`): sus triggers rechazan modificarla,
eliminarla antes de que venza la conservación de su documento, `TRUNCATE`, y
agregar versiones o modificar el documento de su archivo. Mientras está
pendiente, el trabajador, el período, el documento y quién la cargó tampoco
cambian; el único cambio de estado posible es a `PUBLISHED`.

## Reparto de propinas (SPRINT-3-T09)

> **Histórico de solo lectura desde SPRINT-4A-T08.** El reparto por período
> descrito aquí ya no se calcula, confirma ni paga; el reparto vigente es la
> [propina diaria por trabajador](#propinas-diarias-por-trabajador-y-lotes-de-pago-sprint-4a-t02).
> Las tablas y sus filas se conservan sin cambios.

| Tabla                              | Rol                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tip_entries`                      | Registro diario agregado por local, día de negocio y medio de pago. Es la **única fuente** que alimenta los repartos; `sales.tip_amount` se reconcilia con ella mediante `sales.tip_entry_id`.                                                                                                        |
| `tip_agreements`                   | Pacto de reparto vigente en un local (regla, vigencia, creador). `tip_pools` guarda una copia en `agreement_snapshot` para inmutabilidad.                                                                                                                                                             |
| `work_hours_records`               | Horas trabajadas por trabajador y período; `tip_pool_lines` referencia su registro fuente y fotografía las horas usadas.                                                                                                                                                                              |
| `tip_pools`                        | Reparto de un local para un período. Contiene el monto total (desde `tip_entries`), el estado, el pacto aplicado y las trazabilidades de cálculo y confirmación. Histórico de solo lectura desde SPRINT-4A-T08: la API ya no crea ni cambia repartos (el reparto vigente es `daily_tip_allocations`). |
| `tip_pool_lines`                   | Línea del reparto por trabajador: horas fotografiadas, monto asignado, trabajador y referencia al registro de horas.                                                                                                                                                                                  |
| `tip_pool_sources`                 | Fuente del reparto: vincula un `tip_pool` con el `tip_entry` usado y guarda el monto aplicado. Un registro diario solo puede usarse una vez.                                                                                                                                                          |
| `tip_pool_receipts`                | Constancia de pago del reparto para un trabajador: foto con nombres, local, período, horas, monto y detalle; inmutable y solo de un reparto `PAID`.                                                                                                                                                   |
| `tip_pool_daily_operation_sources` | Fuente del reparto alimentada por la operación diaria (SPRINT-4R-T02): vincula un `tip_pool` con la `daily_operation` usada y guarda el fondo aplicado en CLP entero. Una operación solo puede alimentar un reparto.                                                                                  |

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

## Propinas diarias por trabajador y lotes de pago (SPRINT-4A-T02)

Decisión del PO (10/11/2026): la unidad de propina es la **asignación diaria
por participante**, creada en la misma transacción que la operación diaria
(SPRINT-4A-T03), y el pago se registra como **lote** por local y período.
Reemplaza al reparto por período (`tip_pools`), que queda como histórico de
solo lectura. Migración `20261110040000_propinas_diarias_lotes_pago` (con
`down.sql`); la generación obligatoria del reparto está en
`20261110050000_reparto_diario_automatico` y la inclusión del supervisor
como participante en `20261110030000_participantes_incluyen_supervisor`
(SPRINT-4A-T01).

| Tabla                   | Rol                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daily_tip_allocations` | Propina de un participante en una operación diaria: operación, local y fecha (copiados de la operación), trabajador, monto CLP entero (`BIGINT >= 0`), estado `UNPAID`/`PAID` (`TipAllocationStatus`) y lote de pago opcional. Única por `(operation_id, worker_id)`; índices por `(store_id, business_date)` y `(worker_id, business_date)`. |
| `tip_payment_batches`   | Lote de pago: local, período (`period_start`–`period_end`, inclusive), total, cantidad de asignaciones, quién pagó (`paid_by_id`) y cuándo (`paid_at`). `legacy_pool_id` solo lo usan los lotes históricos creados por la migración para los repartos `PAID`.                                                                                 |

Reglas que garantiza la base (CHECK y triggers, para cualquier vía de
escritura):

- El trabajador de la asignación es participante de la operación; las
  asignaciones de una operación suman exactamente su fondo
  (`tip_fund_amount`) y hay una por participante (constraint trigger
  diferido, al commit). Desde SPRINT-4A-T03 toda operación con fondo y
  participantes debe tener su reparto.
- `PAID` exige lote y `UNPAID` no lo admite. Una asignación pasa a `PAID` una
  sola vez, con un lote del mismo local cuyo período contiene su fecha; una
  asignación `PAID` es inmutable y no se borra.
- Mientras una operación tenga asignaciones `PAID` no cambian sus montos,
  fecha, local ni participantes.
- El lote es inmutable (sin `UPDATE`, `DELETE` ni `TRUNCATE`) y sus totales
  cuadran con sus asignaciones.

**Migración de datos.** Cada operación existente con fondo y participantes
recibió sus asignaciones con la regla de reparto vigente (`splitDailyFund`:
partes iguales y residuo de a $1 rotado por fecha). Las que alimentaban un
reparto `PAID` quedaron `PAID` en un lote histórico por reparto; el resto,
incluidas las de repartos `DRAFT` y `CONFIRMED`, quedó `UNPAID`. Ninguna fila
de `tip_pools` ni de sus constancias se borró ni modificó.

## Medios de pago y ventas MrComanda (SPRINT-4-T32)

> Con SPRINT-4R-T01 las ventas (manuales y MrComanda) dejaron de capturarse y
> pasaron a modo lectura histórica; el catálogo `payment_methods` se conserva
> para ese historial y clasifica las líneas de la importación diaria del Excel
> (SPRINT-4R-T08 en adelante).

Migración `20261105021500_medios_pago_catalogo` (reversa manual en su
`down.sql`, que Prisma no ejecuta). Reemplaza al enum `PaymentMethod` por el
catálogo relacional `payment_methods`, única fuente para ventas, propinas,
líneas de cierre y clasificación de vouchers.

| Tabla                   | Rol                                                                                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment_methods`       | Catálogo administrable de medios de pago: `code` único e inmutable (contrato operativo con frontend y DTO), nombre, `sort_order`, `is_active`, `behavior` y `available_for_tips`. Sin borrado físico: desactivar no elimina ni oculta el historial.       |
| `sales`                 | Agrega `source` (`MANUAL` o `MRCOMANDA`) y `period_start`/`period_end` (NULL en ventas manuales). Las cargas MrComanda guardan el total neto agregado por local, medio y período (`tip_amount` = 0: PROPINAS conserva su fuente propia en `tip_entries`). |
| `cash_closing_vouchers` | Agrega `payment_method_id` opcional: clasifica vouchers MrComanda nuevos. Los vouchers históricos quedan sin clasificar (NULL) y conservan el comportamiento heredado.                                                                                    |

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

| Tabla                      | Rol                                                                                                                                                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cash_closings`            | Cierre de un local, día de negocio y turno (`shift >= 1`; cada local define cuántos turnos tiene). Guarda responsable, fondo de caja, motivo de diferencia, quién y cuándo cerró y los totales de conciliación.                                                                                           |
| `cash_closing_lines`       | Una línea por medio de pago del catálogo: esperado vs. contado y su diferencia.                                                                                                                                                                                                                           |
| `cash_closing_vouchers`    | Vouchers de respaldo de la conciliación: fuente (`MRCOMANDA` o `MERCADO_PAGO`), período de corte que cubren, monto, propina incluida, referencia y, desde SPRINT-4-T32, medio de pago que clasifica los vouchers MrComanda nuevos. Puede haber varios por fuente y turno (terminales o cortes parciales). |
| `cash_closing_tip_entries` | Vínculo de **solo referencia** entre el cierre y el registro diario de propinas (`tip_entries`) del mismo local y día.                                                                                                                                                                                    |

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

| Entidad                    | Rol                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `daily_operations`         | Una fila por `(store_id, business_date)` (`UNIQUE`). Guarda `card_tip_amount` (propina tarjeta, entero `>= 0`), `cash_tip_amount` (propina efectivo, entero `>= 0`), `tip_fund_amount` (fondo calculado: tarjeta + efectivo, CHECK) y `cash_difference` (entero **con signo** en BIGINT: positivo = sobrante, negativo = faltante), con `difference_reason` obligatorio si la diferencia no es cero (CHECK). FK única opcional al voucher: exige voucher siempre que `card_tip_amount > 0` (CHECK sobre la misma fila). Referencia al local y al responsable (siempre desde el JWT). |
| `daily_operation_vouchers` | Foto del voucher de propinas con tarjeta: solo metadatos (`file_name`, `file_path`, `mime_type`, `size_bytes`, `sha256_hash` `CHAR(64)`). Obligatorio si `card_tip_amount > 0`; JPEG/PNG/WebP, máximo 5 MiB (validado en la API). El archivo vive en el **volumen privado** del backend (mismo volumen que el gestor documental, subcarpeta `vouchers/`, nombre físico aleatorio) y solo se descarga mediante el endpoint autorizado `GET /daily-operations/:id/voucher`; no existe URL pública. Relación 1:1 con la operación.                                                      |

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
- Contrato HTTP completo: [Operación diaria](../README.md#operación-diaria-sprint-4r-t01-participantes-desde-sprint-4r-t03)
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
operación, sin tocar los históricos proporcionales. **No agrega endpoints por sí
sola:** la API de participantes es SPRINT-4R-T03 (ya implementada: catálogo
acotado de elegibles, `participantIds` repetido en el alta y corrección
multipart de la operación diaria) y el cálculo diario equitativo es
SPRINT-4R-T04; ambos consumen este modelo.

| Entidad                                                          | Rol                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daily_operation_participants`                                   | Participante del reparto de una operación diaria: un trabajador una sola vez por operación (`UNIQUE(operation_id, worker_id)`). FK a la operación en `Cascade` (la participación muere con su operación) y al trabajador en `Restrict` (un trabajador con historial no se borra).                                                                             |
| `TipAgreementRule.EQUAL_SHARES`                                  | Valor explícito de la regla equitativa en el enum de pactos. Convive con `PROPORTIONAL_TO_HOURS`; ninguna fila existente se reescribe.                                                                                                                                                                                                                        |
| `tip_pool_lines.hours_worked` / `tip_pool_receipts.hours_worked` | `NULL` solo en repartos cuya regla aplicada es `EQUAL_SHARES`; obligatorias en cualquier otro caso, incluidos los repartos históricos sin pacto ni snapshot. La migración solo cae el `NOT NULL`: los valores existentes no se alteran. Desde SPRINT-4R-T04 el campo también es opcional en el cliente de Prisma (sin migración: la columna ya era NULLable). |
| `tip_pool_daily_operation_sources`                               | Fuente de un reparto alimentada por la operación diaria, separada de `tip_pool_sources` (que sigue ligada a `tip_entries`). `amount` BIGINT en CLP entero aplica el fondo completo del día y `operation_id` es único: cada operación alimenta como máximo un reparto.                                                                                         |

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

Sucesores: SPRINT-4R-T03 expuso la API de participantes (catálogo
`GET /daily-operations/eligible-workers`, `participantIds` repetido en el alta
y corrección multipart de la selección, con la selección comparada como
conjunto en la idempotencia) y SPRINT-4R-T04 calcula el reparto diario
equitativo reutilizando `tip_pool_lines` para el monto final, sin inventar
horas: todo cálculo nuevo crea el reparto con `agreement_id NULL`,
`agreement_snapshot.rule = 'EQUAL_SHARES'`, una fila de
`tip_pool_daily_operation_sources` por operación del período y líneas con
`hours_worked NULL` (regla y residuo en el README del backend); este modelo es
el contrato que ambos consumen. Desde SPRINT-4A-T08 ese reparto por período ya
no se calcula: la misma regla se aplica al guardar la operación diaria y queda
en [`daily_tip_allocations`](#propinas-diarias-por-trabajador-y-lotes-de-pago-sprint-4a-t02);
los repartos ya guardados se conservan como histórico.

## Importación diaria de ventas MrComanda (SPRINT-4R-T08)

Las ventas del día dejan de ingresarse a mano: salen del reporte Excel diario
de MrComanda. Esta tarea solo agrega el **modelo**; la lectura del archivo es
SPRINT-4R-T09 y la API de previsualización y confirmación es SPRINT-4R-T10.
Migración `20261108010000_importaciones_ventas_mrcomanda` (con reversa en
`down.sql`, que Prisma no ejecuta). No toca ninguna tabla existente.

| Tabla                        | Propósito                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store_external_codes`       | Identificador explícito de un local en un sistema externo (`ExternalSystem`, hoy solo `MRCOMANDA`), con el nombre externo opcional. Un local tiene a lo más uno por sistema y un identificador nunca apunta a dos locales. **Sin uso desde SPRINT-4A-T17**: el local se identifica por `stores.subway_store_id`; se conserva por compatibilidad.                    |
| `payment_method_aliases`     | Alias externo de un medio del catálogo (`T. DEBITO` → `DEBIT_CARD`). Guarda la etiqueta configurada y su forma normalizada; una etiqueta normalizada resuelve un único medio por sistema. El código del medio no cambia.                                                                                                                                            |
| `sales_imports`              | Cabecera por archivo importado: local, fecha de negocio, período y horario del reporte, fecha de emisión (`issued_at`, informativa, desde SPRINT-4R-T10), identificador y nombre externos del local, versión, estado, total del reporte, nombre original, ruta privada, tipo, tamaño, SHA-256, quién lo subió (`uploaded_by_id`, `created_at`) y quién lo confirmó. |
| `sales_import_lines`         | Total por medio de pago dentro de una importación: número de línea, etiqueta original, etiqueta normalizada, medio resuelto, monto CLP entero con signo y porcentaje opcional.                                                                                                                                                                                      |
| `sales_import_skipped_lines` | Línea del reporte omitida (SPRINT-4A-T18; desde SPRINT-4A-T21 se omite sola): solo con monto 0 (CHECK) y sin alias para su etiqueta (trigger). Se conserva para la trazabilidad, no es una venta e inmutable.                                                                                                                                                       |

**Resolución manual (SPRINT-4A-T18, migración `20261110070000_importaciones_resolucion_manual`).**
`sales_imports.store_resolution` y `sales_import_lines.resolution`
(`SalesImportResolution`: `AUTOMATIC` por equivalencia configurada, `MANUAL`
si lo eligió el administrador) junto con `resolved_by_id` y `resolved_at`
registran lo resuelto a mano en la vista previa. Los triggers aceptan la
elección manual sin abrir huecos: local activo, sin contradecir otro ID
Subway, medio activo y sin alias hacia otro medio.

Reglas que garantiza la base (CHECK, índices únicos y triggers):

- **Sin asignaciones por suposición.** Una cabecera solo se inserta si su
  `subway_store_id` es el ID Subway del local (`stores.subway_store_id`;
  migración `20261110020000_importaciones_id_subway`, SPRINT-4A-T17; antes se
  exigía `external_store_code` en `store_external_codes`, que queda sin uso);
  una línea solo se inserta si su etiqueta normalizada tiene un alias hacia
  ese mismo medio. En «208 - 72597» el ID Subway es 72597 y el 208, número
  interno de MrComanda, se ignora; `external_store_code` conserva el texto
  original.
- **Normalización única.** La función SQL inmutable
  `normalize_external_label` (sin tildes, mayúsculas y espacios colapsados,
  conservando la puntuación) es la misma regla de
  `src/sales-imports/normalization/normalize-external-label.ts`; los CHECK
  exigen que identificadores y etiquetas se guarden ya normalizados, y una
  prueba de integración compara ambas implementaciones.
- **Versiones e idempotencia.** `(store_id, business_date, sha256_hash)` es
  único: reimportar el mismo archivo no crea otra fila. Un archivo distinto
  para la misma clave crea la siguiente `version` (única por local y fecha).
- **Una sola versión vigente.** `is_current` es `TRUE` solo en `ACTIVE` y
  `NULL` en los demás estados; el índice único
  `(store_id, business_date, is_current)` no hace colisionar los `NULL`
  (mismo patrón que los períodos de `sales`, sin índices parciales que Prisma
  no representa). Reemplazar es atómico en una transacción:
  `ACTIVE → SUPERSEDED` de la anterior y luego `PENDING → ACTIVE` de la nueva.
- **Ciclo de vida.** Se crea `PENDING` (previsualizada); solo una `PENDING`
  se descarta (`DELETE`, con sus líneas en cascada). `PENDING → ACTIVE` exige
  al menos una línea y que las líneas sumen exactamente `total_amount`.
  `ACTIVE → SUPERSEDED` es la única salida de una vigente y `SUPERSEDED` es
  terminal. Los datos del archivo son inmutables desde el `INSERT` y las
  líneas solo cambian mientras la cabecera está `PENDING` (la cabecera se lee
  con `FOR SHARE`, así una confirmación concurrente espera a la escritura de
  líneas). `TRUNCATE` se rechaza en ambas tablas.
- **Período de un día.** `period_end > period_start`, hasta 24 horas (admite
  horarios que cruzan la medianoche), y `business_date` es la fecha de inicio
  del período en hora de Chile: la fecha sale del contenido del reporte, no
  del nombre del archivo.
- **Historial estable.** Cada línea conserva la etiqueta original y el medio
  resuelto al importar: cambiar o borrar un alias después no reinterpreta
  importaciones pasadas, y los medios no se borran (FK `Restrict`).
- **Conceptos separados.** El modelo no tiene columnas de propina ni de
  diferencia de efectivo, y no escribe en `sales`: las ventas manuales y los
  totales MrComanda de SPRINT-4-T32 quedan como historial.

El seed sincroniza solo los alias conocidos del reporte real cuyo medio no es
ambiguo: `EFECTIVO` → `CASH`, `T. DEBITO` → `DEBIT_CARD` y `T. CREDITO` →
`CREDIT_CARD`. «N.de Créd.» aparece en el reporte, pero el catálogo no tiene
un medio equivalente; queda sin alias hasta que se defina (mientras tanto, un
reporte con esa línea no se puede confirmar).

SPRINT-4R-T10 agrega `issued_at` (migración
`20261108020000_importaciones_fecha_emision`, con reversa): la fecha de
emisión del reporte, solo informativa, nullable e inmutable como el resto de
los datos del archivo (se suma a la comparación del trigger
`sales_imports_enforce`). La API que usa este modelo está documentada en el
README del backend.

## Calendario de operación de los locales (SPRINT-4R-T12)

Migración `20261108030000_calendario_operacion_locales` (con reversa en
`down.sql`). No toca tablas existentes y es independiente de
`work_hours_records` (horarios de trabajadores).

| Tabla                       | Propósito                                                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store_operating_schedules` | Uno por local (`store_id` único): siete columnas booleanas `opens_monday` … `opens_sunday` (al menos una verdadera, CHECK), `tracking_start_date` (primer día en que se exigen ventas) y quién lo modificó por última vez. |
| `store_closures`            | Cierre por excepción: local, `closure_date`, motivo obligatorio no vacío (CHECK) y quién lo registró. Uno por local y fecha (índice único). Se puede quitar (la API lo audita).                                            |

El estado diario de ventas **no se guarda**: la API lo calcula al consultar a
partir de este calendario, de los cierres y de las importaciones `ACTIVE`
(`sales_imports`). Así no hay alertas duplicadas ni que limpiar, y una
importación tardía resuelve el día sin pasos manuales. Reglas en el README del
backend.

## Inventario: catálogo y toma (SPRINT-5-T01)

Migración `20261111120000_inventario_catalogo_toma` (con reversa en
`down.sql`). Amplía `products`, `inventory_counts` e `inventory_count_lines`,
que existían desde la migración inicial sin uso ni filas, y agrega
`inventory_template_rows`. `inventory_movements` no cambia.

| Tabla                     | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products`                | `sku` opcional y único cuando existe (lo entrega el proveedor; PostgreSQL admite varios NULL) y nunca vacío. Agrega `alternative_names` (`VARCHAR(120)[]`, un producto con varios nombres y un solo SKU: Carne Fajita, Beef Steak y Carne Queso), `package_name` (bolsa, paquete, botella o pack), `box_content` y `package_content` (`DECIMAL(12,3)`, independientes), `packages_per_box` (entero, solo informativo) y `loose_only` («solo cantidad suelta»). |
| `inventory_template_rows` | Una fila por fila de la hoja Excel: `position` (único, = número de fila; la 1 es el encabezado), `kind` (`ITEM`, `BLANK` o `SECTION`), `printed_text` (nombre, `<Vacío>` o rótulo; NULL solo en `BLANK`), `section` (rótulo de la sección que cierra el grupo) y `product_id` opcional y único (solo en `ITEM`).                                                                                                                                               |
| `inventory_counts`        | `status` OPEN («En curso») o CONFIRMED («Finalizado»); agrega `count_date` (fecha de la toma), `finalized_at`, `finalized_by_id` y `template_snapshot` (JSONB, copia de la plantilla al finalizar).                                                                                                                                                                                                                                                            |
| `inventory_count_lines`   | Agrega `boxes`, `packages` (enteros), `loose_quantity` (`DECIMAL(12,3)`), `saved_by_id` y `saved_at` (último guardado) y la copia del producto al contarlo: `product_sku`, `product_name`, `unit`, `package_name`, `box_content`, `packages_per_box`, `package_content` y `loose_only`. `counted_quantity` guarda el total; `system_quantity` y `difference` pasan a opcionales (reservadas para la comparación contra el stock).                              |

**Total de una línea** (lo calcula el backend con aritmética decimal exacta y
la base lo verifica sobre la copia del formato, CHECK
`inventory_count_lines_counted_quantity_consistent`):

```
counted_quantity = boxes × box_content + packages × package_content + loose_quantity
```

Ejemplo: Carne Fajita (caja de 5 kg con 2 bolsas de 2,5 kg), 1 caja + 2 bolsas

- 0,300 kg = 10,300 kg. El contenido por caja no se deriva de los paquetes
  (Pepperoni: caja de 7,3 kg con paquetes de 0,93 kg). Una línea vacía (producto
  no contado) tiene `boxes`, `packages`, `loose_quantity` y `counted_quantity` en
  NULL, igual que la celda en blanco de la hoja impresa.

**Unidad**: `UnitOfMeasure` queda en `UNIT`, `KG` y `L`. Se recreó el enum en
vez de agregar un CHECK para que el cliente Prisma y la API solo conozcan
valores válidos (G, ML y PACK no tenían filas). En `UNIT` los contenidos y la
cantidad suelta son enteros (un pack de 6 bebidas son 6 unidades).

Reglas que garantiza la base:

- CHECK: cajas y paquetes `>= 0`; cantidad suelta `>= 0`; contenidos `> 0` y
  `packages_per_box >= 1` cuando existen; cajas o paquetes contados exigen su
  contenido en la copia del formato; un producto `loose_only` no admite cajas
  ni paquetes; textos (SKU, nombre, paquete, nombres alternativos) no vacíos.
- Una toma OPEN por local como máximo (índice único parcial
  `inventory_counts_store_id_open_key`, solo en SQL) e índice por
  `(store_id, count_date)`. Una línea por toma y producto.
- Ciclo de la toma (trigger `inventory_counts_status_rows`): nace OPEN, no
  cambia de local ni de creador y pasa una sola vez a CONFIRMED con
  `finalized_at`, `finalized_by_id` y `template_snapshot` (CHECK
  `inventory_counts_status_consistency`). Una toma CONFIRMED es inmutable y no
  se borra; una OPEN se puede descartar y sus líneas se borran en cascada.
- Las líneas de una toma CONFIRMED no se insertan, modifican ni borran
  (trigger `inventory_count_lines_require_open_rows`). La finalización
  (SPRINT-5-T06) inserta las líneas vacías **antes** de pasar la toma a
  CONFIRMED, en la misma transacción. Desde
  `20261111130000_inventario_bloqueo_finalizacion` el trigger toma la toma con
  `FOR NO KEY UPDATE` (antes `FOR SHARE`, que producía deadlock entre dos
  finalizaciones simultáneas): las escrituras de líneas de una toma se
  serializan entre sí y con su finalización, y la que llega tarde ve la toma
  CONFIRMED y se rechaza. El rechazo usa SQLSTATE `42501`
  (`insufficient_privilege`) con el mensaje «La toma de inventario … está
  finalizada: no se permite INSERT/UPDATE/DELETE sobre sus líneas»; la API
  (SPRINT-5-T06) lo traduce a 409.
- `saved_at` lo asigna el mismo trigger (`now()`) en cada INSERT y UPDATE
  permitido; `saved_by_id` lo informa el servicio.

Uso desde la API (SPRINT-5-T05, `/inventory-counts`, sin cambios de schema):

- Iniciar la toma inserta `inventory_counts` con el local de la sesión del
  supervisor, `created_by_id` y `count_date` (por defecto el día en curso en
  `America/Santiago`). Antes de insertar, el servicio bloquea la fila del local
  en `stores` (`FOR NO KEY UPDATE`) y busca una toma OPEN: si existe responde
  409 con su id; el índice parcial `inventory_counts_store_id_open_key` es la
  última defensa.
- Guardar un producto hace `upsert` sobre `(count_id, product_id)`: una línea
  por producto, que se reemplaza. El servicio calcula `counted_quantity` con
  `Prisma.Decimal` sobre el formato vigente, copia el SKU, el nombre, la unidad
  y el formato, y asigna `saved_by_id`; los campos no informados quedan en
  NULL (celda vacía) y cuentan como 0 en el total. Antes del `upsert` bloquea
  la toma con `FOR NO KEY UPDATE` (el mismo bloqueo del trigger) y verifica que
  siga OPEN.
- Filas de la plantilla fijas (trigger `inventory_template_rows_fixed_rows`):
  la posición y el tipo no se actualizan y las filas no se borran, porque el Product
  Owner copia el Excel descargado y lo pega en otro cuadre. Solo cambian el
  texto impreso, la sección y el producto asignado. La carga de las 182 filas
  es el seed de SPRINT-5-T02 (solo la estructura, sin productos).
- Un producto con líneas de toma, movimientos o fila asignada no se borra (FK
  Restrict).

### Estructura de la plantilla (SPRINT-5-T02)

El seed (`prisma/inventory-template.ts`, llamado desde `prisma/seed.ts`) carga
las 182 filas de `docs/plantilla-inventario.xlsx` (filas 2 a 183) en
`inventory_template_rows`, con su posición, tipo, texto impreso y sección:
140 artículos, 34 `<Vacío>`, 3 filas sin texto (23, 24 y 65) y 5 secciones
que cierran cada grupo (45, 88, 141, 162 y 183). La plantilla en blanco queda
en el repositorio como fixture y el test `inventory-template-xlsx.spec.ts`
compara el seed contra ella.

- **No crea productos** (decisión del Product Owner del 11/11/2026): el
  administrador los crea a mano con el SKU del proveedor y los ubica en su
  fila (SPRINT-5-T03 y T04). Una fila de artículo sin producto es un artículo
  pendiente de crear.
- Antes de escribir valida la estructura completa (`INVENTORY_TEMPLATE_STRUCTURE`):
  182 filas, posiciones de la 2 a la 183 sin huecos, filas por tipo y las
  secciones en sus filas. Si algo no calza, se detiene sin escribir nada,
  porque la base no permite corregir después la posición ni el tipo.
- No es destructiva: solo inserta las filas que faltan. Una fila existente
  no se toca, así que una segunda carga no duplica filas, no desasigna
  productos y no pisa los textos que edita el administrador. Si la plantilla
  cambia el tipo de una fila existente, la carga se detiene antes de escribir.
- **Plantilla actualizada** (decisión del Product Owner del 12/11/2026): la
  plantilla cambia seguido y es temporal, porque más adelante el cuadre se
  hará dentro de la aplicación. Por eso el texto vigente de cada fila lo
  mantiene el administrador desde la aplicación (SPRINT-5-T03), y el seed no lo
  sobrescribe en cada despliegue. Cuando el texto de una fila existente difiere
  del de la plantilla del repositorio, el seed lo informa en
  `textDifferences` y muestra un aviso con la fila, el texto de la base y el de
  la plantilla, sin modificar nada.
- «Lata Fanta Zero» se carga dos veces (filas 99 y 102), como viene en la
  hoja.
- Los formatos de la caché de «BASE DE DATOS» quedan como referencia en
  `INVENTORY_REFERENCE_FORMATS` (no se cargan): Carne Fajita (caja de 5 kg, 2
  bolsas de 2,5 kg), Pepperoni (caja de 7,3 kg, paquetes de 0,93 kg), Pan
  Blanco (caja de 70 unidades) y Atún, Pollo Teriyaki y Meat Lover
  (Preparado), que solo admiten la cantidad suelta.
- Una base donde ya corrió la versión anterior del seed (PR #89, que creaba
  los 140 productos) los conserva: la carga nueva no borra productos ni
  desasigna filas, y en esa base no quedan artículos pendientes de crear. Los
  entornos desplegados no están afectados (no tenían el inventario). En una
  base local se limpia de dos formas:
  - recreando el volumen: `docker compose down -v && docker compose up --build`;
  - o, para conservar el resto de los datos, con este SQL. Solo toca los
    productos que creó ese seed: sin SKU, con el mismo nombre que el texto de
    su fila y sin líneas de toma ni movimientos. El trigger de filas fijas
    permite desasignar `product_id`.

    ```sql
    BEGIN;
    CREATE TEMP TABLE seeded AS
      SELECT p.id FROM products p
      JOIN inventory_template_rows r ON r.product_id = p.id
      WHERE p.sku IS NULL AND p.name = r.printed_text
        AND NOT EXISTS (SELECT 1 FROM inventory_count_lines l WHERE l.product_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = p.id);
    UPDATE inventory_template_rows SET product_id = NULL, updated_at = now()
      WHERE product_id IN (SELECT id FROM seeded);
    DELETE FROM products WHERE id IN (SELECT id FROM seeded);
    COMMIT;
    ```

## Cómo ver el modelo de forma visual

> Los diagramas Mermaid y DBML de abajo incluyen el módulo de operación
> diaria (SPRINT-4R-T01 y SPRINT-4R-T02) y la importación de ventas MrComanda
> (SPRINT-4R-T08), el calendario de operación (SPRINT-4R-T12) y el inventario
> ampliado (SPRINT-5-T01); la fuente de verdad física siempre
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
  DAILY_OPERATIONS ||--o{ DAILY_TIP_ALLOCATIONS : "reparte"
  USERS ||--o{ DAILY_TIP_ALLOCATIONS : "recibe"
  STORES ||--o{ TIP_PAYMENT_BATCHES : "paga propinas"
  USERS ||--o{ TIP_PAYMENT_BATCHES : "registra el pago"
  TIP_PAYMENT_BATCHES |o--o{ DAILY_TIP_ALLOCATIONS : "marca como pagadas"
  TIP_POOLS |o--o| TIP_PAYMENT_BATCHES : "lote histórico"

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

  STORES ||--o{ STORE_EXTERNAL_CODES : "identificado en MrComanda"
  PAYMENT_METHODS ||--o{ PAYMENT_METHOD_ALIASES : "alias externo"
  STORES ||--o{ SALES_IMPORTS : "importa ventas"
  USERS ||--o{ SALES_IMPORTS : "sube"
  USERS |o--o{ SALES_IMPORTS : "confirma"
  SALES_IMPORTS ||--o{ SALES_IMPORT_LINES : "totales por medio"
  SALES_IMPORTS ||--o{ SALES_IMPORT_SKIPPED_LINES : "líneas en 0 omitidas"
  USERS |o--o{ SALES_IMPORTS : "resuelve a mano"
  PAYMENT_METHODS ||--o{ SALES_IMPORT_LINES : "resuelve"

  STORES ||--o| STORE_OPERATING_SCHEDULES : "abre según"
  USERS ||--o{ STORE_OPERATING_SCHEDULES : "configura"
  STORES ||--o{ STORE_CLOSURES : "cierra por excepción"
  USERS ||--o{ STORE_CLOSURES : "registra"

  STORES ||--o{ PRODUCTS : "almacena (vía movimientos)"
  PRODUCTS |o--o| INVENTORY_TEMPLATE_ROWS : "ocupa una fila"
  PRODUCTS ||--o{ INVENTORY_MOVEMENTS : "mueve"
  STORES ||--o{ INVENTORY_MOVEMENTS : "en"
  USERS ||--o{ INVENTORY_MOVEMENTS : "registra"
  STORES ||--o{ INVENTORY_COUNTS : "cuenta"
  USERS ||--o{ INVENTORY_COUNTS : "levanta"
  USERS |o--o{ INVENTORY_COUNTS : "finaliza"
  INVENTORY_COUNTS ||--o{ INVENTORY_COUNT_LINES : "detalla"
  PRODUCTS ||--o{ INVENTORY_COUNT_LINES : "cuenta"
  USERS ||--o{ INVENTORY_COUNT_LINES : "guarda"

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

enum ExternalSystem {
  MRCOMANDA [note: 'Punto de venta; origen del Excel diario (SPRINT-4R-T08)']
}

enum TipAllocationStatus {
  UNPAID
  PAID
}

enum SalesImportResolution {
  AUTOMATIC
  MANUAL
}

enum SalesImportStatus {
  PENDING [note: 'Previsualizada; se puede descartar']
  ACTIVE [note: 'Confirmada y vigente; una por local y fecha']
  SUPERSEDED [note: 'Reemplazada por una versión posterior; terminal']
}

enum UnitOfMeasure {
  UNIT [note: 'Unidades: contenidos y cantidad suelta enteros']
  KG
  L
}

enum InventoryTemplateRowKind {
  ITEM [note: 'Artículo: nombre o <Vacío>; único tipo que lleva producto']
  BLANK [note: 'Fila sin texto']
  SECTION [note: 'Rótulo que cierra su grupo']
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
  subway_store_id varchar(10) [unique, note: 'ID del local asignado por Subway (SPRINT-4A-T15): opcional, solo dígitos 1 a 10 (CHECK stores_subway_store_id_digits). No guarda el número interno de MrComanda']
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

  Note: 'SPRINT-4R-T02: selección compartida por tarjeta y efectivo; trigger exige mismo local, rol TRABAJADOR o SUPERVISOR (SPRINT-4A-T01) y activo al escribir'
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

Table daily_tip_allocations {
  id uuid [pk, default: `gen_random_uuid()`]
  business_date date [not null, note: 'Copiada de la operación (trigger)']
  amount bigint [not null, note: 'CLP entero >= 0 (CHECK)']
  status TipAllocationStatus [not null, default: 'UNPAID', note: 'PAID exige lote; UNPAID no lo admite (CHECK). PAID es inmutable']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  operation_id uuid [not null, ref: > daily_operations.id, note: 'Cascade']
  store_id uuid [not null, ref: > stores.id, note: 'Copiado de la operación (trigger)']
  worker_id uuid [not null, ref: > users.id, note: 'Debe ser participante de la operación (trigger)']
  payment_batch_id uuid [ref: > tip_payment_batches.id]

  indexes {
    (operation_id, worker_id) [unique]
    (store_id, business_date)
    (worker_id, business_date)
    payment_batch_id
  }

  Note: 'SPRINT-4A-T02: propina diaria por participante; las de una operación suman su fondo (constraint trigger diferido)'
}

Table tip_payment_batches {
  id uuid [pk, default: `gen_random_uuid()`]
  period_start date [not null]
  period_end date [not null, note: '>= period_start (CHECK)']
  total_amount bigint [not null, note: 'Suma de sus asignaciones (constraint trigger diferido)']
  allocation_count integer [not null, note: 'Cantidad de asignaciones; al menos una']
  paid_at timestamptz [not null]
  created_at timestamptz [not null, default: `now()`]
  store_id uuid [not null, ref: > stores.id]
  paid_by_id uuid [not null, ref: > users.id]
  legacy_pool_id uuid [unique, ref: - tip_pools.id, note: 'Solo lotes históricos migrados de repartos PAID']

  indexes {
    (store_id, period_start, period_end)
    paid_by_id
  }

  Note: 'SPRINT-4A-T02: lote de pago por local y período; inmutable (trigger)'
}

Table store_external_codes {
  id uuid [pk, default: `gen_random_uuid()`]
  system ExternalSystem [not null]
  external_code varchar(100) [not null, note: 'Normalizado (CHECK con normalize_external_label)']
  external_name varchar(150)
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]

  indexes {
    (system, external_code) [unique, note: 'Un identificador no apunta a dos locales']
    (system, store_id) [unique, note: 'Un identificador por local y sistema']
    store_id
  }

  Note: 'SPRINT-4R-T08: equivalencia explícita; el seed no la siembra'
}

Table payment_method_aliases {
  id uuid [pk, default: `gen_random_uuid()`]
  system ExternalSystem [not null]
  label varchar(100) [not null]
  normalized_label varchar(100) [not null, note: '= normalize_external_label(label) (CHECK)']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  payment_method_id uuid [not null, ref: > payment_methods.id]

  indexes {
    (system, normalized_label) [unique]
    payment_method_id
  }

  Note: 'SPRINT-4R-T08: alias externos sin cambiar el código estable del medio'
}

Table sales_imports {
  id uuid [pk, default: `gen_random_uuid()`]
  system ExternalSystem [not null, default: 'MRCOMANDA']
  business_date date [not null, note: 'Fecha de inicio del período en hora de Chile (CHECK)']
  period_start timestamptz [not null]
  period_end timestamptz [not null, note: '> period_start y hasta 24 h (CHECK)']
  issued_at timestamptz [note: 'Emisión del reporte (SPRINT-4R-T10); informativa e inmutable']
  external_store_code varchar(100) [not null, note: 'Texto original del encabezado («208 - 72597»)']
  external_store_name varchar(150)
  subway_store_id varchar(10) [note: 'SPRINT-4A-T17: ID Subway del local (solo dígitos, CHECK); al insertar debe ser el de store_id (trigger). NULL solo en importaciones anteriores. Inmutable']
  version integer [not null, note: '>= 1']
  status SalesImportStatus [not null, default: 'PENDING']
  is_current boolean [note: 'TRUE solo en ACTIVE; NULL en los demás estados']
  total_amount bigint [not null, note: 'Total del reporte; las líneas deben sumarlo para confirmar']
  file_name varchar(255) [not null, note: 'Nombre original del archivo']
  file_path varchar(500) [not null, note: 'Ruta en el volumen privado']
  mime_type varchar(100) [not null]
  size_bytes bigint [not null]
  sha256_hash char(64) [not null]
  created_at timestamptz [not null, default: `now()`, note: 'Fecha de carga']
  confirmed_at timestamptz
  superseded_at timestamptz
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]
  uploaded_by_id uuid [not null, ref: > users.id]
  confirmed_by_id uuid [ref: > users.id]
  store_resolution SalesImportResolution [not null, default: 'AUTOMATIC', note: 'SPRINT-4A-T18: MANUAL si el local se eligió a mano']
  resolved_at timestamptz
  resolved_by_id uuid [ref: > users.id, note: 'Quien resolvió a mano en la vista previa']

  indexes {
    (store_id, business_date, version) [unique]
    (store_id, business_date, sha256_hash) [unique, note: 'Reimportar el mismo archivo es idempotente']
    (store_id, business_date, is_current) [unique, note: 'Una sola versión vigente por local y fecha']
    business_date
  }

  Note: 'SPRINT-4R-T08: datos del archivo inmutables; PENDING -> ACTIVE -> SUPERSEDED (trigger)'
}

Table sales_import_lines {
  id uuid [pk, default: `gen_random_uuid()`]
  line_number integer [not null]
  original_label varchar(100) [not null, note: 'Etiqueta tal como viene en el reporte']
  normalized_label varchar(100) [not null]
  amount bigint [not null, note: 'CLP entero con signo']
  percentage decimal(5,2) [note: '0 a 100, opcional']
  created_at timestamptz [not null, default: `now()`]
  import_id uuid [not null, ref: > sales_imports.id, note: 'Cascade solo al descartar una PENDING']
  payment_method_id uuid [not null, ref: > payment_methods.id, note: 'Resuelto por alias o a mano (trigger)']
  resolution SalesImportResolution [not null, default: 'AUTOMATIC', note: 'SPRINT-4A-T18: MANUAL si el medio se eligió a mano']

  indexes {
    (import_id, line_number) [unique]
    (import_id, normalized_label) [unique]
    payment_method_id
  }

  Note: 'SPRINT-4R-T08: solo cambian mientras la importación está PENDING'
}

Table sales_import_skipped_lines {
  id uuid [pk, default: `gen_random_uuid()`]
  line_number integer [not null]
  original_label varchar(100) [not null]
  normalized_label varchar(100) [not null, note: 'Sin alias configurado (trigger)']
  amount bigint [not null, note: 'Solo 0 (CHECK)']
  percentage decimal(5,2)
  resolution SalesImportResolution [not null, default: 'AUTOMATIC', note: 'AUTOMATIC: omitida sola (SPRINT-4A-T21)']
  created_at timestamptz [not null, default: `now()`]
  import_id uuid [not null, ref: > sales_imports.id, note: 'Cascade solo al descartar una PENDING']

  indexes {
    (import_id, line_number) [unique]
    (import_id, normalized_label) [unique]
  }

  Note: 'SPRINT-4A-T18/T21: trazabilidad de las líneas en 0 sin medio; no es una venta'
}

Table store_operating_schedules {
  id uuid [pk, default: `gen_random_uuid()`]
  opens_monday boolean [not null]
  opens_tuesday boolean [not null]
  opens_wednesday boolean [not null]
  opens_thursday boolean [not null]
  opens_friday boolean [not null]
  opens_saturday boolean [not null]
  opens_sunday boolean [not null, note: 'Al menos un día abierto (CHECK)']
  tracking_start_date date [not null, note: 'Primer día en que se exigen ventas']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, unique, ref: - stores.id]
  updated_by_id uuid [not null, ref: > users.id]

  Note: 'SPRINT-4R-T12: un calendario por local; sin calendario no hay alertas'
}

Table store_closures {
  id uuid [pk, default: `gen_random_uuid()`]
  closure_date date [not null]
  reason varchar(300) [not null, note: 'Motivo obligatorio no vacío (CHECK)']
  created_at timestamptz [not null, default: `now()`]
  store_id uuid [not null, ref: > stores.id]
  created_by_id uuid [not null, ref: > users.id]

  indexes {
    (store_id, closure_date) [unique, note: 'Un cierre por local y fecha']
  }

  Note: 'SPRINT-4R-T12: cierre por excepción; ese día nunca genera alerta'
}

Table products {
  id uuid [pk, default: `gen_random_uuid()`]
  sku varchar(40) [unique, note: 'SKU del proveedor; opcional, único cuando existe']
  name varchar(120) [not null]
  alternative_names "varchar(120)[]" [not null, default: '{}', note: 'Otros nombres, mismo SKU']
  category varchar(60)
  unit UnitOfMeasure [not null]
  package_name varchar(30) [note: 'bolsa, paquete, botella o pack']
  box_content decimal(12,3) [note: '> 0; independiente del paquete']
  packages_per_box integer [note: '>= 1; solo informativo']
  package_content decimal(12,3) [note: '> 0']
  loose_only boolean [not null, default: false, note: 'Solo cantidad suelta']
  min_stock decimal(12,3) [not null, default: 0]
  is_active boolean [not null, default: true]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]

  Note: 'SPRINT-5-T01: catálogo con formato de caja y paquete'
}

Table inventory_template_rows {
  id uuid [pk, default: `gen_random_uuid()`]
  position integer [not null, unique, note: 'Número de fila de la hoja (>= 2); fijo']
  kind InventoryTemplateRowKind [not null]
  printed_text varchar(120) [note: 'NULL solo en BLANK']
  section varchar(120) [not null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  product_id uuid [unique, ref: - products.id, note: 'Solo en ITEM']

  Note: 'SPRINT-5-T01: filas fijas de la plantilla; no se borran ni cambian de posición'
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
  status InventoryCountStatus [not null, default: 'OPEN', note: 'OPEN = En curso; CONFIRMED = Finalizado']
  count_date date [not null, note: 'Fecha de la toma']
  counted_at timestamptz [not null, default: `now()`]
  notes varchar(255)
  finalized_at timestamptz
  template_snapshot jsonb [note: 'Copia de la plantilla al finalizar']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]
  created_by_id uuid [not null, ref: > users.id]
  finalized_by_id uuid [ref: > users.id]

  indexes {
    (store_id, count_date)
    finalized_by_id
    store_id [unique, note: 'Parcial WHERE status = OPEN: una toma en curso por local']
  }

  Note: 'SPRINT-5-T01: CONFIRMED es inmutable y no se borra'
}

Table inventory_count_lines {
  id uuid [pk, default: `gen_random_uuid()`]
  boxes integer [note: '>= 0']
  packages integer [note: '>= 0']
  loose_quantity decimal(12,3) [note: '>= 0']
  counted_quantity decimal(12,3) [note: 'Total = cajas × caja + paquetes × paquete + suelta']
  system_quantity decimal(12,3) [note: 'Reservada: stock esperado']
  difference decimal(12,3) [note: 'Reservada: comparación contra el stock']
  product_sku varchar(40)
  product_name varchar(120) [not null]
  unit UnitOfMeasure [not null]
  package_name varchar(30)
  box_content decimal(12,3)
  packages_per_box integer
  package_content decimal(12,3)
  loose_only boolean [not null, default: false]
  saved_at timestamptz [not null, default: `now()`, note: 'Lo asigna el trigger en cada INSERT y UPDATE']
  count_id uuid [not null, ref: > inventory_counts.id]
  product_id uuid [not null, ref: > products.id]
  saved_by_id uuid [not null, ref: > users.id]

  indexes {
    (count_id, product_id) [unique]
    product_id
    saved_by_id
  }

  Note: 'SPRINT-5-T01: copia el producto y su formato; inmutable con la toma CONFIRMED'
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
- `test/sales-imports-model.integration.spec.ts` / `test/sales-imports-migration.integration.spec.ts` — reglas de la importación MrComanda y migración con datos existentes y reversa (SPRINT-4R-T08)
- `test/database.integration.spec.ts` — pruebas de restricciones contra PostgreSQL real
