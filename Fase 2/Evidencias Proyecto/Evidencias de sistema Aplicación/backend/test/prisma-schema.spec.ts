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

  it('las migraciones crean las 24 tablas del modelo', () => {
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
});
