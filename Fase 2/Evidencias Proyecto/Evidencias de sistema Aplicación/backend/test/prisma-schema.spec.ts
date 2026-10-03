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

describe('Esquema de base de datos (SPRINT-1-T04)', () => {
  it('el schema de Prisma es válido', () => {
    const output = execFileSync('npx', ['prisma', 'validate'], {
      cwd: backendRoot,
      encoding: 'utf-8',
    });
    expect(output).toContain('is valid');
  });

  it('las migraciones crean las 18 tablas del modelo', () => {
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
      'tip_pools',
      'tip_pool_lines',
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

  it('protege la trazabilidad: FKs con Restrict y auditoría con SetNull', () => {
    const sql = readMigrations();
    expect(sql).toContain('ON DELETE RESTRICT');
    // La auditoría sobrevive a la anonimización de usuarios.
    expect(sql).toContain(
      'ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL',
    );
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
});
