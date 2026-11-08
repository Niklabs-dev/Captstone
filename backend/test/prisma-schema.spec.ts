import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const backendRoot = join(import.meta.dirname, '..');
const migrationsDir = join(backendRoot, 'prisma', 'migrations');

function readMigrations(): string {
  const migrationDirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  expect(migrationDirs.length).toBeGreaterThan(0);
  return migrationDirs
    .map((dir) =>
      readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf-8'),
    )
    .join('\n');
}

// SQL de la única migración cuyo nombre termina en el sufijo indicado.
function readMigration(suffix: string): string {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => entry.name);
  expect(dirs).toHaveLength(1);
  return readFileSync(join(migrationsDir, dirs[0], 'migration.sql'), 'utf-8');
}

describe('Esquema de base de datos (SPRINT-1-T04)', () => {
  it('el schema de Prisma es válido', () => {
    const output = execFileSync('npx', ['prisma', 'validate'], {
      cwd: backendRoot,
      encoding: 'utf-8',
    });
    expect(output).toContain('is valid');
  });

  it('las migraciones crean las 37 tablas del modelo', () => {
    const sql = readMigrations();
    const tablasEsperadas = [
      'stores',
      'roles',
      'users',
      'refresh_tokens',
      'audit_logs',
      'document_types',
      'documents',
      'document_versions',
      'payslips',
      'payment_methods',
      'tip_entries',
      'tip_agreements',
      'work_hours_records',
      'tip_pools',
      'tip_pool_lines',
      'tip_pool_sources',
      'tip_pool_receipts',
      'sales',
      'cash_closings',
      'cash_closing_lines',
      'cash_closing_vouchers',
      'cash_closing_tip_entries',
      'daily_operations',
      'daily_operation_vouchers',
      'daily_operation_participants',
      'tip_pool_daily_operation_sources',
      'store_external_codes',
      'payment_method_aliases',
      'sales_imports',
      'sales_import_lines',
      'store_operating_schedules',
      'store_closures',
      'products',
      'inventory_movements',
      'inventory_counts',
      'inventory_count_lines',
      'data_rights_requests',
    ];
    for (const tabla of tablasEsperadas) {
      expect(sql).toContain(`CREATE TABLE "${tabla}"`);
    }
  });

  it('modela cierres de caja por turno con conciliación, vouchers y reversa (SPRINT-4-T08)', () => {
    const sql = readMigration('cierres_caja_turno_conciliacion');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "cash_closings_store_id_business_date_shift_key"',
    );
    expect(sql).toContain('"cash_closing_lines_difference_consistent" CHECK');
    expect(sql).toContain(
      '"cash_closings_reconciliation_difference_consistent" CHECK',
    );
    expect(sql).toContain('"cash_closings_status_consistency" CHECK');
    expect(sql).toContain('"cash_closing_vouchers_valid_period" CHECK');
    expect(sql).toContain(
      '"cash_closing_vouchers_tip_only_mercado_pago" CHECK',
    );
    expect(sql).toContain('CREATE TRIGGER "cash_closings_status_rows"');
    expect(sql).toContain('CREATE TRIGGER "cash_closing_lines_require_open"');
    expect(sql).toContain(
      'CREATE TRIGGER "cash_closing_vouchers_require_open"',
    );
    expect(sql).toContain('CREATE TRIGGER "sales_cash_closing_require_open"');

    // La reversa vive junto a la migración y deshace triggers y esquema.
    const dirs = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('cierres_caja_turno_conciliacion'),
    );
    const down = readFileSync(
      join(migrationsDir, dirs[0], 'down.sql'),
      'utf-8',
    );
    expect(down).toContain('DROP FUNCTION "cash_closings_enforce_status"()');
    expect(down).toContain('DROP FUNCTION "sales_require_open_cash_closing"()');
    expect(down).toContain('DROP TABLE "cash_closing_vouchers"');
    expect(down).toContain(
      'CREATE UNIQUE INDEX "cash_closings_store_id_business_date_key"',
    );
  });

  it('modela medios de pago administrables y ventas MrComanda (SPRINT-4-T32)', () => {
    const sql = readMigration('medios_pago_catalogo');

    // Catálogo relacional con comportamiento y disponibilidad para propinas.
    expect(sql).toContain('CREATE TYPE "PaymentMethodBehavior" AS ENUM');
    expect(sql).toContain("'CASH', 'RECONCILABLE_CARD', 'EXTERNAL_OTHER'");
    expect(sql).toContain('CREATE TABLE "payment_methods"');
    expect(sql).toContain('"available_for_tips" BOOLEAN');
    expect(sql).toContain('CREATE UNIQUE INDEX "payment_methods_code_key"');
    // Catálogo base con los cuatro códigos del enum reemplazado.
    expect(sql).toContain("'CASH', 'Efectivo', 10");
    expect(sql).toContain("'DEBIT_CARD', 'Tarjeta de débito', 20");
    expect(sql).toContain("'TRANSFER', 'Transferencia', 40");

    // Backfill de los tres FKs por el texto del enum y retiro posterior del
    // enum; el backfill se verifica completo antes de exigir las columnas.
    expect(sql).toContain('m."code" = s."payment_method"::text');
    expect(sql).toContain('m."code" = e."payment_method"::text');
    expect(sql).toContain('m."code" = l."payment_method"::text');
    expect(sql).toContain('ALTER COLUMN "payment_method_id" SET NOT NULL');
    expect(sql).toContain('DROP TYPE "PaymentMethod"');

    // Claves únicas recreadas sobre el FK y totales MrComanda por
    // local/medio/período.
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "tip_entries_store_id_business_date_payment_method_id_key"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "cash_closing_lines_closing_id_payment_method_id_key"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "sales_store_id_payment_method_id_period_start_period_end_key"',
    );
    expect(sql).toContain('"sales_source_period_consistency" CHECK');
    expect(sql).toContain('"sales_valid_period" CHECK');
    expect(sql).toContain('"sales_mrcomanda_no_tip" CHECK');
    expect(sql).toContain('CREATE TYPE "SaleSource" AS ENUM');
    expect(sql).toContain("'MANUAL', 'MRCOMANDA'");

    // Voucher clasificado y conciliación solo de vouchers MrComanda
    // RECONCILABLE_CARD o sin clasificar.
    expect(sql).toContain(
      'ADD CONSTRAINT "cash_closing_vouchers_payment_method_id_fkey"',
    );
    expect(sql).toContain(
      'v."source" = \'MRCOMANDA\' AND (v."payment_method_id" IS NULL OR m."behavior" = \'RECONCILABLE_CARD\')',
    );

    // Solo se retiran y restauran los triggers necesarios para el backfill,
    // sin session_replication_role, y se actualizan a los nuevos FKs.
    expect(sql).toContain(
      'DROP TRIGGER "sales_cash_closing_require_open" ON "sales"',
    );
    expect(sql).toContain(
      'DROP TRIGGER "cash_closing_lines_require_open" ON "cash_closing_lines"',
    );
    expect(sql).not.toContain('SET session_replication_role');
    expect(sql).toContain('e."payment_method_id" = NEW."payment_method_id"');
    expect(sql).toContain('CREATE TRIGGER "sales_tip_entry_consistency"');
    expect(sql).toContain('CREATE TRIGGER "sales_cash_closing_require_open"');
    expect(sql).toContain('CREATE TRIGGER "cash_closing_lines_require_open"');

    // La reversa vive junto a la migración y devuelve el enum y los triggers.
    const dirs = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('medios_pago_catalogo'),
    );
    const down = readFileSync(
      join(migrationsDir, dirs[0], 'down.sql'),
      'utf-8',
    );
    expect(down).toContain('CREATE TYPE "PaymentMethod" AS ENUM');
    expect(down).toContain(
      'CREATE UNIQUE INDEX "cash_closing_lines_closing_id_payment_method_key"',
    );
    expect(down).toContain(
      'CREATE UNIQUE INDEX "tip_entries_store_id_business_date_payment_method_key"',
    );
    expect(down).toContain('DELETE FROM "_prisma_migrations"');
  });

  it('modela propinas diarias, pacto, horas y fuentes sin doble contabilización (SPRINT-3-T09)', () => {
    const sql = readMigration('propinas_diarias_pacto_horas');
    expect(sql).toContain(
      'CREATE TYPE "TipAgreementRule" AS ENUM (\'PROPORTIONAL_TO_HOURS\')',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "tip_entries_store_id_business_date_payment_method_key"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "tip_pool_sources_tip_entry_id_key"',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "sales_tip_entry_id_fkey" FOREIGN KEY ("tip_entry_id")',
    );
    expect(sql).toContain('"agreement_snapshot" JSONB');
    expect(sql).toContain('"work_hours_record_id" UUID');
    expect(sql).toContain('"tip_entries_amount_nonnegative" CHECK');
    expect(sql).toContain('"work_hours_records_hours_nonnegative" CHECK');
    expect(sql).toContain('WITH aggregated_sales AS');
    expect(sql).toContain('WITH nonoverlapping_hours AS');
    expect(sql).toContain('), inserted_hours AS (');
    expect(sql).toContain('), evaluated AS (');
    expect(sql).toContain('MAX("pool_matches") OVER (PARTITION BY "pool_id")');
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist');
    expect(sql).toContain('ADD CONSTRAINT "tip_agreements_no_overlap" EXCLUDE');
    expect(sql).toContain(
      'ADD CONSTRAINT "work_hours_records_no_overlap" EXCLUDE',
    );
    expect(sql).toContain('CREATE TRIGGER "sales_tip_entry_consistency"');
    expect(sql).toContain(
      'CREATE TRIGGER "tip_pool_sources_entry_consistency"',
    );
  });

  it('garantiza la trazabilidad del gestor documental', () => {
    const sql = readMigrations();
    // Hash SHA-256 único por versión para verificar integridad del archivo.
    expect(sql).toContain('"sha256_hash" CHAR(64) NOT NULL');
    // Control de versiones: un número de versión por documento.
    expect(sql).toContain(
      'UNIQUE INDEX "document_versions_document_id_version_number_key"',
    );
    // Conservación documental por defecto de 5 años (art. 9 bis CT).
    expect(sql).toContain('"retention_years" INTEGER NOT NULL DEFAULT 5');
  });

  it('desglosa el cierre de caja por medio de pago con diferencia por línea', () => {
    const sql = readMigrations();
    // Una línea por medio de pago dentro del mismo cierre.
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "cash_closing_lines_closing_id_payment_method_key"',
    );
    // Efectivo, débito, crédito y transferencia como medios distintos.
    expect(sql).toContain("'DEBIT_CARD', 'CREDIT_CARD'");
    // Esperado (sistema), contado (supervisor) y diferencia por línea.
    expect(sql).toContain('"expected_amount" DECIMAL(12,2) NOT NULL');
    expect(sql).toContain('"counted_amount" DECIMAL(12,2) NOT NULL');
  });

  it('protege la trazabilidad: FKs con Restrict', () => {
    const sql = readMigrations();
    expect(sql).toContain('ON DELETE RESTRICT');
  });

  it('hace inmutable el registro de auditoría (SPRINT-1-T15)', () => {
    const sql = readMigration('auditoria_inmutable');
    // Triggers que rechazan UPDATE/DELETE por fila y TRUNCATE por sentencia.
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "audit_logs"');
    expect(sql).toContain('FOR EACH ROW EXECUTE FUNCTION');
    expect(sql).toContain('BEFORE TRUNCATE ON "audit_logs"');
    // Las FK ya no ponen en NULL al responsable ni al local al borrarlos.
    for (const fk of ['user_id', 'store_id']) {
      expect(sql).toContain(
        `ADD CONSTRAINT "audit_logs_${fk}_fkey" FOREIGN KEY ("${fk}")`,
      );
    }
    expect(sql).not.toContain('ON DELETE SET NULL');
    expect(sql.match(/ON DELETE RESTRICT/g)).toHaveLength(2);
  });

  it('registra los plazos del gestor documental (SPRINT-2-T03)', () => {
    const sql = readMigration('gestor_documental_plazos');
    // Tipos que deben registrarse en la DT dentro de 15 días.
    expect(sql).toContain(
      '"requires_dt_registration" BOOLEAN NOT NULL DEFAULT false',
    );
    // Plazo de registro en la DT y quién/cuándo lo marcó como realizado.
    expect(sql).toContain('"dt_registration_due_at" DATE');
    expect(sql).toContain('"dt_registered_at" TIMESTAMPTZ(6)');
    expect(sql).toContain(
      'ADD CONSTRAINT "documents_dt_registered_by_id_fkey" FOREIGN KEY ("dt_registered_by_id")',
    );
    expect(sql).toContain('CHECK ("dt_registered_at" IS NULL OR');
    // Conservación: se completa en los documentos existentes antes de exigirla.
    expect(sql).toContain('ALTER COLUMN "retain_until" SET NOT NULL');
    expect(sql.indexOf('UPDATE "documents"')).toBeLessThan(
      sql.indexOf('ALTER COLUMN "retain_until" SET NOT NULL'),
    );
  });

  it('modela las liquidaciones con estado de publicación (SPRINT-2-T12)', () => {
    const sql = readMigration('modelo_liquidaciones');
    expect(sql).toContain(
      "CREATE TYPE \"PayslipStatus\" AS ENUM ('PENDING_SIGNATURE', 'PUBLISHED')",
    );
    // Una sola liquidación por trabajador y período, y un documento por liquidación.
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "payslips_worker_id_period_key" ON "payslips"("worker_id", "period")',
    );
    expect(sql).toContain('CREATE UNIQUE INDEX "payslips_document_id_key"');
    // Fecha de firma y de publicación, obligatorias solo al publicar.
    expect(sql).toContain('"signed_at" DATE');
    expect(sql).toContain('"published_at" TIMESTAMPTZ(6)');
    expect(sql).toContain('"payslips_status_publication_check" CHECK');
    expect(sql).toContain('"payslips_period_first_day_check" CHECK');
    // El documento debe ser una LIQUIDACION del mismo trabajador.
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OF "document_id", "worker_id" ON "payslips"',
    );
  });

  it('hace inmutables las liquidaciones publicadas (SPRINT-2-T14)', () => {
    const sql = readMigration('liquidaciones_publicadas_inmutables');
    // Rechaza UPDATE/DELETE de publicadas por fila y TRUNCATE por sentencia.
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "payslips"');
    expect(sql).toContain('BEFORE TRUNCATE ON "payslips"');
    // El archivo de una liquidación publicada no recibe versiones nuevas.
    expect(sql).toContain('BEFORE INSERT ON "document_versions"');
    expect(sql).toContain('ON "documents"');
  });

  it('controla los estados del reparto y hace inmutables sus constancias (SPRINT-3-T13)', () => {
    const sql = readMigration('propinas_confirmacion_pago');
    expect(sql).toContain('"version" INTEGER NOT NULL DEFAULT 1');
    expect(sql).toContain('CONSTRAINT "tip_pools_status_consistency" CHECK');
    expect(sql).toContain('"payment_date" >= "period_end"');
    expect(sql).toContain('CREATE TABLE "tip_pool_receipts"');
    expect(sql).toContain('"tip_pool_receipts_amount_nonnegative" CHECK');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "tip_pool_receipts_pool_id_user_id_key"',
    );
    // Estados del reparto por fila y TRUNCATE por sentencia.
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "tip_pools"');
    expect(sql).toContain('BEFORE TRUNCATE ON "tip_pools"');
    // La foto (líneas y fuentes) solo cambia en DRAFT.
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE ON "tip_pool_lines"',
    );
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE ON "tip_pool_sources"',
    );
    // Constancias: solo INSERT de un reparto pagado.
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE ON "tip_pool_receipts"',
    );
    expect(sql).toContain('BEFORE TRUNCATE ON "tip_pool_receipts"');
    expect(sql).toContain("USING ERRCODE = 'insufficient_privilege'");
  });

  it('guarda la fecha del último cálculo del reparto, fija desde CONFIRMED (SPRINT-3-T13)', () => {
    const sql = readMigration('propinas_fecha_calculo');
    // Las filas existentes se rellenan con updated_at antes del NOT NULL.
    expect(sql).toContain('SET "calculated_at" = "updated_at"');
    expect(sql).toContain('ALTER COLUMN "calculated_at" SET NOT NULL');
    expect(sql).toContain(
      'ALTER COLUMN "calculated_at" SET DEFAULT CURRENT_TIMESTAMP',
    );
    // El trigger se desactiva solo durante el relleno.
    expect(sql).toContain('DISABLE TRIGGER "tip_pools_status_rows"');
    expect(sql).toContain('ENABLE TRIGGER "tip_pools_status_rows"');
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION "tip_pools_enforce_status"()',
    );
    expect(sql).toContain('OR NEW."calculated_at" <> OLD."calculated_at"');
  });

  it('soporta el cumplimiento de la Ley N°21.719', () => {
    const sql = readMigrations();
    // Anonimización de titulares (derecho de cancelación).
    expect(sql).toContain('"anonymized_at" TIMESTAMPTZ(6)');
    // Solicitudes de derechos ARCO con plazo de respuesta.
    expect(sql).toContain('CREATE TABLE "data_rights_requests"');
    expect(sql).toContain(
      "CREATE TYPE \"DataRightType\" AS ENUM ('ACCESS', 'RECTIFICATION', 'CANCELLATION', 'OBJECTION', 'PORTABILITY')",
    );
    // Registro de auditoría de operaciones sobre datos.
    expect(sql).toContain('"detail" JSONB');
  });

  it('garantiza nombres de local únicos con espacios y mayúsculas normalizados', () => {
    const sql = readMigration('locales_nombre_normalizado_unico');
    expect(sql).toContain('CREATE UNIQUE INDEX "stores_name_normalized_key"');
    expect(sql).toContain('upper(regexp_replace(btrim("name")');
  });

  it('normaliza las tildes con funciones inmutables aptas para el índice', () => {
    const sql = readMigration('locales_nombre_sin_tildes');
    expect(sql).toContain('DROP INDEX "stores_name_normalized_key"');
    expect(sql).toContain('upper(translate(');
    expect(sql).not.toContain('unaccent');
  });

  it('modela la operación diaria por local y fecha con voucher privado (SPRINT-4R-T01)', () => {
    const sql = readMigration('operacion_diaria');

    // Una sola operación por local y día; el voucher es 1:1 (FK única en
    // daily_operations, lo que permite exigirlo con CHECK cuando hay
    // propina de tarjeta).
    expect(sql).toContain('CREATE TABLE "daily_operations"');
    expect(sql).toContain('CREATE TABLE "daily_operation_vouchers"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "daily_operations_store_id_business_date_key"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "daily_operations_voucher_id_key"',
    );

    // Montos CLP enteros en BIGINT con sus reglas: no negativos, fondo
    // consistente, motivo exigido con diferencia y voucher con propina.
    expect(sql).toContain('"card_tip_amount" BIGINT NOT NULL');
    expect(sql).toContain('"cash_tip_amount" BIGINT NOT NULL');
    expect(sql).toContain('"tip_fund_amount" BIGINT NOT NULL');
    expect(sql).toContain('"cash_difference" BIGINT NOT NULL');
    expect(sql).toContain('"daily_operations_card_tip_non_negative" CHECK');
    expect(sql).toContain('"daily_operations_cash_tip_non_negative" CHECK');
    expect(sql).toContain('"daily_operations_tip_fund_consistent" CHECK');
    // El motivo se exige con IS NOT NULL: un CHECK satisfecho por NULL no
    // rechaza la fila.
    expect(sql).toContain(
      '"daily_operations_difference_reason_required" CHECK ("cash_difference" = 0 OR ("difference_reason" IS NOT NULL AND btrim("difference_reason") <> \'\'))',
    );
    expect(sql).toContain('"daily_operations_voucher_required" CHECK');
    expect(sql).toContain(
      'ADD CONSTRAINT "daily_operations_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "daily_operation_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
    );

    // La migración no toca los históricos de cierres ni de propinas.
    expect(sql).not.toContain('ALTER TABLE "cash_closings"');
    expect(sql).not.toContain('ALTER TABLE "tip_entries"');

    // La reversa vive junto a la migración y solo deshace el esquema nuevo.
    const dirs = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('operacion_diaria'),
    );
    const down = readFileSync(
      join(migrationsDir, dirs[0], 'down.sql'),
      'utf-8',
    );
    expect(down).toContain('DROP TABLE "daily_operations"');
    expect(down).toContain('DROP TABLE "daily_operation_vouchers"');
  });

  it('modela participantes diarios y reparto equitativo (SPRINT-4R-T02)', () => {
    const sql = readMigration('participantes_diarios_reparto_equitativo');

    // Regla equitativa explícita que convive con la proporcional histórica.
    expect(sql).toContain(
      'ALTER TYPE "TipAgreementRule" ADD VALUE \'EQUAL_SHARES\'',
    );

    // Horas NULLables solo para líneas y constancias (los valores existentes
    // no se reescriben: solo cae el NOT NULL).
    expect(sql).toContain(
      'ALTER TABLE "tip_pool_lines" ALTER COLUMN "hours_worked" DROP NOT NULL',
    );
    expect(sql).toContain(
      'ALTER TABLE "tip_pool_receipts" ALTER COLUMN "hours_worked" DROP NOT NULL',
    );

    // Una sola selección por operación y trabajador, sin duplicados.
    expect(sql).toContain('CREATE TABLE "daily_operation_participants"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "daily_operation_participants_operation_id_worker_id_key"',
    );
    // El trabajador con historial no se borra (Restrict); la participación
    // muere con su operación (Cascade).
    expect(sql).toContain(
      'ADD CONSTRAINT "daily_operation_participants_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "daily_operation_participants_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "daily_operations"("id") ON DELETE CASCADE',
    );

    // Fuente del reparto alimentada por la operación diaria: separada de
    // tip_pool_sources, monto BIGINT y una sola operación por fuente.
    expect(sql).toContain('CREATE TABLE "tip_pool_daily_operation_sources"');
    expect(sql).toContain('"amount" BIGINT NOT NULL');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "tip_pool_daily_operation_sources_operation_id_key"',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "tip_pool_daily_operation_sources_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "daily_operations"("id") ON DELETE RESTRICT',
    );

    // Triggers: validación del trabajador al escribir la participación,
    // bloqueo de cambios con reparto CONFIRMED/PAID y conciliación exacta de
    // la fuente (monto = fondo de la operación, mismo local).
    expect(sql).toContain(
      'CREATE TRIGGER "daily_operation_participants_validate_worker_rows"',
    );
    expect(sql).toContain(
      'CREATE TRIGGER "daily_operation_participants_require_draft_pool_rows"',
    );
    expect(sql).toContain(
      'CREATE TRIGGER "daily_operations_require_draft_pool_rows"',
    );
    expect(sql).toContain(
      'CREATE TRIGGER "tip_pool_daily_operation_sources_enforce_rows"',
    );
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE ON "daily_operation_participants"',
    );
    expect(sql).toContain('r."code" = \'TRABAJADOR\'');
    expect(sql).toContain('NEW."amount" = o."tip_fund_amount"');
    expect(sql).toContain(
      'CREATE TRIGGER "tip_pool_lines_hours_consistent_rows"',
    );
    expect(sql).toContain(
      'CREATE TRIGGER "tip_pool_receipts_hours_consistent_rows"',
    );
    // Las horas de la constancia se comparan NULL-safe contra su línea.
    expect(sql).toContain(
      'l."hours_worked" IS NOT DISTINCT FROM NEW."hours_worked"',
    );

    // La migración no toca los históricos de propinas ni de cierres.
    expect(sql).not.toContain('ALTER TABLE "tip_entries"');
    expect(sql).not.toContain('ALTER TABLE "tip_pool_sources"');
    expect(sql).not.toContain('ALTER TABLE "cash_closings"');

    // La reversa vive junto a la migración y devuelve el enum y los NOT NULL.
    const dirs = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('participantes_diarios_reparto_equitativo'),
    );
    const down = readFileSync(
      join(migrationsDir, dirs[0], 'down.sql'),
      'utf-8',
    );
    expect(down).toContain('DROP TABLE "daily_operation_participants"');
    expect(down).toContain('DROP TABLE "tip_pool_daily_operation_sources"');
    expect(down).toContain(
      'ALTER TABLE "tip_pool_lines" ALTER COLUMN "hours_worked" SET NOT NULL',
    );
    expect(down).toContain(
      'CREATE TYPE "TipAgreementRule_new" AS ENUM (\'PROPORTIONAL_TO_HOURS\')',
    );
    expect(down).toContain(
      'DROP TRIGGER "daily_operation_participants_validate_worker_rows" ON "daily_operation_participants"',
    );
  });

  it('modela importaciones diarias MrComanda con equivalencias y versiones (SPRINT-4R-T08)', () => {
    const sql = readMigration('importaciones_ventas_mrcomanda');

    // Normalización inmutable usada por los CHECK de equivalencias y líneas.
    expect(sql).toContain(
      'CREATE FUNCTION "normalize_external_label"("label" TEXT) RETURNS TEXT',
    );
    expect(sql).toContain('IMMUTABLE STRICT PARALLEL SAFE');
    expect(sql).toContain('"payment_method_aliases_label_normalized" CHECK');
    expect(sql).toContain('"store_external_codes_code_normalized" CHECK');

    // Equivalencias explícitas: un identificador por local y sistema, y una
    // etiqueta normalizada por medio y sistema.
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "store_external_codes_system_external_code_key"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "store_external_codes_system_store_id_key"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "payment_method_aliases_system_normalized_label_key"',
    );

    // Versiones, idempotencia por hash y una sola vigente por local y fecha.
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "sales_imports_store_id_business_date_version_key"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "sales_imports_store_id_business_date_sha256_hash_key"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "sales_imports_store_id_business_date_is_current_key"',
    );
    expect(sql).toContain('"sales_imports_status_consistency" CHECK');
    expect(sql).toContain('"sales_imports_business_date_matches_period" CHECK');
    expect(sql).toContain('CREATE TRIGGER "sales_imports_enforce_rows"');
    expect(sql).toContain('CREATE TRIGGER "sales_import_lines_enforce_rows"');

    // No toca ventas, propinas, operaciones diarias ni el catálogo existente.
    expect(sql).not.toContain('ALTER TABLE "sales"');
    expect(sql).not.toContain('ALTER TABLE "payment_methods"');
    expect(sql).not.toContain('ALTER TABLE "daily_operations"');
    expect(sql).not.toContain('ALTER TABLE "tip_entries"');
    expect(sql).not.toContain('tip_amount');

    // La reversa vive junto a la migración y retira todo el esquema nuevo.
    const dirs = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('importaciones_ventas_mrcomanda'),
    );
    const down = readFileSync(
      join(migrationsDir, dirs[0], 'down.sql'),
      'utf-8',
    );
    expect(down).toContain('DROP TABLE "sales_import_lines"');
    expect(down).toContain('DROP TABLE "sales_imports"');
    expect(down).toContain('DROP TABLE "payment_method_aliases"');
    expect(down).toContain('DROP TABLE "store_external_codes"');
    expect(down).toContain('DROP FUNCTION "normalize_external_label"(TEXT)');
    expect(down).toContain('DROP TYPE "ExternalSystem"');
  });

  it('guarda la fecha de emisión inmutable de la importación (SPRINT-4R-T10)', () => {
    const sql = readMigration('importaciones_fecha_emision');
    expect(sql).toContain(
      'ALTER TABLE "sales_imports" ADD COLUMN "issued_at" TIMESTAMPTZ(6)',
    );
    // La columna entra en la comparación de inmutabilidad del trigger.
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION "sales_imports_enforce"()',
    );
    expect(sql).toContain('NEW."issued_at")');
    expect(sql).toContain('OLD."issued_at") THEN');

    const dirs = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('importaciones_fecha_emision'),
    );
    const down = readFileSync(
      join(migrationsDir, dirs[0], 'down.sql'),
      'utf-8',
    );
    expect(down).toContain(
      'ALTER TABLE "sales_imports" DROP COLUMN "issued_at"',
    );
    expect(down).not.toContain('NEW."issued_at"');
  });

  it('modela el calendario de operación y los cierres por local (SPRINT-4R-T12)', () => {
    const sql = readMigration('calendario_operacion_locales');
    expect(sql).toContain('CREATE TABLE "store_operating_schedules"');
    expect(sql).toContain('CREATE TABLE "store_closures"');
    // Un calendario por local con al menos un día abierto.
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "store_operating_schedules_store_id_key"',
    );
    expect(sql).toContain('"store_operating_schedules_opens_some_day" CHECK');
    expect(sql).toContain('"tracking_start_date" DATE NOT NULL');
    // Una excepción por local y fecha, con motivo obligatorio.
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "store_closures_store_id_closure_date_key"',
    );
    expect(sql).toContain('"store_closures_reason_not_blank" CHECK');
    // Independiente de los horarios de trabajadores y de las ventas.
    expect(sql).not.toContain('REFERENCES "work_hours_records"');
    expect(sql).not.toContain('ALTER TABLE "work_hours_records"');
    expect(sql).not.toContain('ALTER TABLE "sales_imports"');

    const dirs = readdirSync(migrationsDir).filter((name) =>
      name.endsWith('calendario_operacion_locales'),
    );
    const down = readFileSync(
      join(migrationsDir, dirs[0], 'down.sql'),
      'utf-8',
    );
    expect(down).toContain('DROP TABLE "store_closures"');
    expect(down).toContain('DROP TABLE "store_operating_schedules"');
  });
});
