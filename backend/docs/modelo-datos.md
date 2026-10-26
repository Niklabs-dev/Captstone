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
| Propinas | `tip_entries`, `tip_agreements`, `work_hours_records`, `tip_pools`, `tip_pool_lines`, `tip_pool_sources` | Registro diario de propinas, pacto de reparto vigente, horas trabajadas y reparto con snapshots (art. 64 CT) |
| Ventas y Caja | `sales`, `cash_closings`, `cash_closing_lines` | Ventas por local y cierre de caja diario con responsable, desglosado por medio de pago (esperado vs. contado con diferencia por línea) |
| Inventario | `products`, `inventory_movements`, `inventory_counts`, `inventory_count_lines` | Stock por libro mayor de movimientos y conteos físicos que detectan mermas |
| Ley N°21.719 | `data_rights_requests` | Solicitudes de derechos ARCO de los titulares de datos personales |

**23 tablas y 12 enums.** El Portal del Trabajador no agrega tablas: es una vista
de solo lectura sobre `users`, `documents`, `tip_pool_lines` y `sales`, con
aislamiento por `subject_user_id` / `store_id` aplicado en el backend.

## Decisiones de diseño

- **Identificadores UUID** generados por PostgreSQL (`gen_random_uuid()`), salvo
  `audit_logs` e `inventory_movements`, que usan `BIGSERIAL` por ser libros
  mayores donde el orden cronológico natural importa.
- **Sin borrado físico**: todas las FK usan `ON DELETE RESTRICT` por defecto
  (protege la trazabilidad), `SET NULL` en auditoría (el registro sobrevive a la
  anonimización del usuario) y `CASCADE` solo en datos estrictamente hijos
  (tokens de sesión, líneas de reparto/cierre/conteo, fuentes de reparto).
- **Dinero en `DECIMAL(12,2)`** (CLP) y cantidades en `DECIMAL(12,3)`: nunca
  `float`, para evitar errores de redondeo en propinas, ventas e inventario.
- **`date` para fechas de negocio** (períodos de reparto, día de cierre) y
  **`timestamptz` para marcas de tiempo** (Chile tiene horario de verano).
- **Restricciones de negocio en la BD**: un cierre de caja por local y día
  (`UNIQUE(store_id, business_date)`), una línea por medio de pago por cierre
  (`UNIQUE(closing_id, payment_method)`), un reparto por local y período
  (`UNIQUE(store_id, period_start, period_end)`), una línea por trabajador por
  reparto (`UNIQUE(pool_id, user_id)`), hash SHA-256 único por versión de
  documento, un registro de propinas por local, fecha y medio de pago
  (`UNIQUE(store_id, business_date, payment_method)`), una fuente por registro
  diario (`UNIQUE(tip_entry_id)` en `tip_pool_sources`) y un pacto vigente por
  local y fecha de inicio (`UNIQUE(store_id, valid_from)`).
- **Inmutabilidad**: `audit_logs` y `document_versions` no tienen `updated_at`;
  la aplicación solo permite `INSERT`/`SELECT` sobre ellas.
- **Convenciones**: tablas y columnas en `snake_case`, modelos Prisma en
  inglés `PascalCase`, enums en inglés (los literales de negocio —roles, tipos
  de documento— viven como datos en `roles` y `document_types`, seed en T05).

### Propinas (SPRINT-3-T09)

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
  diario posteriormente, el reparto ya confirmado no se altera.
- **`work_hours_records`** descompone las horas trabajadas por trabajador y
  período, permitiendo reutilizarlas en futuros repartos y mantener la
  referencia fuente en cada línea (`tip_pool_lines.work_hours_record_id`).
- **Reglas de consistencia en la BD**: triggers garantizan que una venta solo se
  reconcilie con un registro del mismo local, medio y día de negocio, y que una
  fuente de reparto pertenezca al mismo local y esté dentro del período del
  reparto.

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
- **Art. 64 (reparto de propinas)**: `tip_entries` registra diariamente el monto
  por local y medio de pago; `tip_pools` define el fondo y período por local;
  `tip_pool_lines.hours_worked` es la base del reparto proporcional y `amount`
  el registro escrito por trabajador; `calculated_by`/`confirmed_by`/
  `confirmed_at` dejan trazabilidad del cálculo validado por el contador. El
  pacto vigente (`tip_agreements`) y las horas trabajadas
  (`work_hours_records`) se fotografían en el reparto para que modificaciones
  posteriores no alteren un cálculo ya confirmado.
- **Cierre de caja con responsable y desglose por medio de pago**:
  `cash_closings.responsible_id` (obligatorio) y `opening_cash` (fondo de caja)
  en la cabecera; `cash_closing_lines` registra **una línea por medio de pago**
  (efectivo, débito, crédito, transferencia) con lo esperado según las ventas
  (`expected_amount`), lo contado por el supervisor (`counted_amount`) y la
  `difference` de la línea. El fondo se suma a lo esperado de la línea CASH y
  la diferencia total del cierre se deriva sumando las líneas.

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

Reglas clave:

- Un `tip_entries` por `(store_id, business_date, payment_method)`.
- Un `tip_pool_sources` por `tip_entry_id` (la fuente no se reutiliza en otro reparto).
- El total de `tip_pools` se calcula sumando los `tip_entries` del período; las
  ventas aportan su `tip_amount` a través de la reconciliación con un único
  `tip_entry`, sin sumar dos veces.
- Los repartos históricos se mantienen intactos porque cada entidad relevante
  conserva una copia del momento del cálculo: pacto (`agreement_snapshot`),
  horas (`tip_pool_lines.hours_worked`) y monto fuente
  (`tip_pool_sources.amount`).

## Cómo ver el modelo de forma visual

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
  USERS ||--o{ TIP_POOL_LINES : "recibe"

  STORES ||--o{ SALES : "vende"
  CASH_CLOSINGS |o--o{ SALES : "agrupa"
  CASH_CLOSINGS ||--o{ CASH_CLOSING_LINES : "desglosa por medio de pago"
  USERS ||--o{ SALES : "registra"
  STORES ||--o{ CASH_CLOSINGS : "cierra"
  USERS ||--o{ CASH_CLOSINGS : "es responsable"

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
  PROPORTIONAL_TO_HOURS
}

enum PaymentMethod {
  CASH
  DEBIT_CARD
  CREDIT_CARD
  TRANSFER
}

enum SaleChannel {
  IN_STORE
  DELIVERY
}

enum CashClosingStatus {
  OPEN
  CLOSED
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
  payment_method PaymentMethod [not null]
  amount decimal(12,2) [not null, note: 'Monto disponible para repartir']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]
  responsible_id uuid [not null, ref: > users.id, note: 'Quién registró la entrada']

  indexes {
    (store_id, business_date)
    (store_id, business_date, payment_method) [unique, note: 'Un registro diario por local, fecha y medio de pago']
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
  hours_worked decimal(6,2) [not null, note: 'Snapshot de horas usadas en el cálculo (art. 64 CT)']
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

Table sales {
  id uuid [pk, default: `gen_random_uuid()`]
  sold_at timestamptz [not null]
  payment_method PaymentMethod [not null]
  channel SaleChannel [not null, default: 'IN_STORE']
  gross_amount decimal(12,2) [not null]
  tip_amount decimal(12,2) [not null, default: 0, note: 'Se reconcilia con un único tip_entry; no es fuente del reparto']
  created_at timestamptz [not null, default: `now()`]
  store_id uuid [not null, ref: > stores.id]
  cash_closing_id uuid [ref: > cash_closings.id]
  registered_by_id uuid [not null, ref: > users.id]
  tip_entry_id uuid [ref: > tip_entries.id, note: 'Reconciliación con el registro diario']

  indexes {
    (store_id, sold_at)
    cash_closing_id
    tip_entry_id
  }
}

Table cash_closings {
  id uuid [pk, default: `gen_random_uuid()`]
  business_date date [not null]
  opening_cash decimal(12,2) [not null, note: 'Fondo de caja: se suma a lo esperado de la línea CASH']
  status CashClosingStatus [not null, default: 'OPEN']
  notes varchar(255)
  closed_at timestamptz
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  store_id uuid [not null, ref: > stores.id]
  responsible_id uuid [not null, ref: > users.id, note: 'Responsable asociado (obligatorio)']

  indexes {
    (store_id, business_date) [unique, note: 'Un cierre por local y día']
  }
}

Table cash_closing_lines {
  id uuid [pk, default: `gen_random_uuid()`]
  payment_method PaymentMethod [not null]
  expected_amount decimal(12,2) [not null, note: 'Calculado desde las ventas del medio de pago']
  counted_amount decimal(12,2) [not null, note: 'Declarado por el supervisor']
  difference decimal(12,2) [not null, note: 'counted - expected; el total del cierre es la suma de líneas']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null]
  closing_id uuid [not null, ref: > cash_closings.id]

  indexes {
    (closing_id, payment_method) [unique, note: 'Una línea por medio de pago por cierre']
  }
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
