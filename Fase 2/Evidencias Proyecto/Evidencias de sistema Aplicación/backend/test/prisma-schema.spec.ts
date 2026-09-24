import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const backendRoot = join(import.meta.dirname, '..');
const migrationsDir = join(backendRoot, 'prisma', 'migrations');

function readInitialMigration(): string {
  const migrationDirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('_init'))
    .map((entry) => entry.name);
  expect(migrationDirs).toHaveLength(1);
  return readFileSync(
    join(migrationsDir, migrationDirs[0], 'migration.sql'),
    'utf-8',
  );
}

describe('Esquema de base de datos (SPRINT-1-T04)', () => {
  it('el schema de Prisma es válido', () => {
    const output = execFileSync('npx', ['prisma', 'validate'], {
      cwd: backendRoot,
      encoding: 'utf-8',
    });
    expect(output).toContain('is valid');
  });

  it('la migración inicial crea las 17 tablas del modelo', () => {
    const sql = readInitialMigration();
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
    const sql = readInitialMigration();
    // Hash SHA-256 único por versión para verificar integridad del archivo.
    expect(sql).toContain('"sha256_hash" CHAR(64) NOT NULL');
    // Control de versiones: un número de versión por documento.
    expect(sql).toContain(
      'UNIQUE INDEX "document_versions_document_id_version_number_key"',
    );
    // Conservación documental por defecto de 5 años (art. 9 bis CT).
    expect(sql).toContain('"retention_years" INTEGER NOT NULL DEFAULT 5');
  });

  it('protege la trazabilidad: FKs con Restrict y auditoría con SetNull', () => {
    const sql = readInitialMigration();
    expect(sql).toContain('ON DELETE RESTRICT');
    // La auditoría sobrevive a la anonimización de usuarios.
    expect(sql).toContain(
      'ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL',
    );
  });

  it('soporta el cumplimiento de la Ley N°21.719', () => {
    const sql = readInitialMigration();
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
