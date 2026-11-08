import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type QueryResultRow } from 'pg';

// Prueba de la migración 20261108010000_importaciones_ventas_mrcomanda
// (SPRINT-4R-T08) con datos existentes y su reversa: no usa Prisma Migrate;
// crea una base temporal con nombre único, aplica a mano (en orden) los SQL
// de todas las migraciones anteriores, siembra datos legados (venta manual,
// venta MrComanda agregada de T32 y una operación diaria de T01), ejecuta la
// migración bajo prueba y verifica que los datos previos no cambian y que el
// modelo nuevo funciona en la base migrada. Luego aplica down.sql, comprueba
// que el esquema nuevo desaparece sin tocar los datos legados y reaplica la
// migración. Se omite sin TEST_DATABASE_URL y siempre elimina solo la base
// temporal que creó.
const databaseUrl = process.env.TEST_DATABASE_URL;

const T08_MIGRATION = '20261108010000_importaciones_ventas_mrcomanda';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'prisma',
  'migrations',
);

interface CountRow {
  total: number;
}

interface SaleRow {
  id: string;
  gross_amount: string;
  source: string;
  payment_method_id: string;
}

interface OperationRow {
  id: string;
  tip_fund_amount: string;
  cash_difference: string;
}

interface StatusRow {
  status: string;
}

describe.skipIf(!databaseUrl)(
  'Migración de importaciones diarias MrComanda (SPRINT-4R-T08)',
  () => {
    let adminClient: Client | undefined;
    let migrationClient: Client | undefined;
    let tempDatabaseName = '';

    const ids: Record<string, string> = {};
    let legacySales: SaleRow[] = [];
    let legacyOperations: OperationRow[] = [];
    let legacyMethodsSnapshot = '';

    // Ejecuta un archivo SQL de una migración contra la base temporal.
    // node-pg usa el protocolo simple sin parámetros, lo que permite varias
    // sentencias (incluidos bloques $$) en una sola llamada.
    async function applySql(
      client: Client,
      migration: string,
      file: 'migration.sql' | 'down.sql',
    ) {
      const sql = await readFile(
        path.join(MIGRATIONS_DIR, migration, file),
        'utf8',
      );
      await client.query(sql);
    }

    async function queryOne<Row extends QueryResultRow>(
      client: Client,
      sql: string,
      params: readonly unknown[],
    ): Promise<Row> {
      const { rows } = await client.query<Row>(sql, [...params]);
      const row: Row | undefined = rows[0];
      if (!row) {
        throw new Error(
          'Se esperaba una fila y la consulta no devolvió ninguna',
        );
      }
      return row;
    }

    function db(): Client {
      if (!migrationClient) {
        throw new Error('El cliente de la base temporal no fue inicializado');
      }
      return migrationClient;
    }

    async function tableExists(client: Client, table: string) {
      const row = await queryOne<{ exists: boolean }>(
        client,
        `SELECT to_regclass($1) IS NOT NULL AS exists`,
        [`public.${table}`],
      );
      return row.exists;
    }

    async function readLegacy(client: Client) {
      const sales = await client.query<SaleRow>(
        `SELECT id, gross_amount::text, source::text, payment_method_id
           FROM sales ORDER BY id`,
      );
      const operations = await client.query<OperationRow>(
        `SELECT id, tip_fund_amount::text, cash_difference::text
           FROM daily_operations ORDER BY id`,
      );
      const methods = await client.query(
        `SELECT id, code, name, sort_order, is_active, behavior::text,
                available_for_tips
           FROM payment_methods ORDER BY code`,
      );
      return {
        sales: sales.rows,
        operations: operations.rows,
        methods: JSON.stringify(methods.rows),
      };
    }

    beforeAll(async () => {
      if (!databaseUrl) {
        return;
      }
      tempDatabaseName = `t08_importaciones_${Date.now()}_${randomUUID()
        .replace(/-/g, '')
        .slice(0, 8)}`;

      adminClient = new Client({ connectionString: databaseUrl });
      await adminClient.connect();
      await adminClient.query(`CREATE DATABASE "${tempDatabaseName}"`);

      const tempUrl = new URL(databaseUrl);
      tempUrl.pathname = `/${tempDatabaseName}`;
      migrationClient = new Client({ connectionString: tempUrl.toString() });
      await migrationClient.connect();

      // Todas las migraciones anteriores, en el orden alfabético en que
      // Prisma las aplica.
      const previous = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name < T08_MIGRATION)
        .map((entry) => entry.name)
        .sort();
      expect(previous.length).toBeGreaterThan(0);
      for (const migration of previous) {
        await applySql(migrationClient, migration, 'migration.sql');
      }

      await seedLegacyData(migrationClient);
      const before = await readLegacy(migrationClient);
      legacySales = before.sales;
      legacyOperations = before.operations;
      legacyMethodsSnapshot = before.methods;

      await applySql(migrationClient, T08_MIGRATION, 'migration.sql');
    }, 120_000);

    // Datos legados mínimos: un local, un supervisor y un administrador; una
    // venta manual, una venta MrComanda agregada (T32) y una operación diaria
    // sin propina de tarjeta (T01). Todo se inserta ANTES de la migración.
    async function seedLegacyData(client: Client) {
      const now = new Date();
      const supervisorRole = await queryOne<{ id: string }>(
        client,
        `INSERT INTO roles (code, name, updated_at)
         VALUES ($1, $2, $3) RETURNING id`,
        ['SUPERVISOR', 'Supervisor', now],
      );
      const adminRole = await queryOne<{ id: string }>(
        client,
        `INSERT INTO roles (code, name, updated_at)
         VALUES ($1, $2, $3) RETURNING id`,
        ['ADMINISTRADOR', 'Administrador', now],
      );
      const store = await queryOne<{ id: string }>(
        client,
        `INSERT INTO stores (name, city, address, updated_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        ['Local Migracion T08', 'Melipilla', 'Calle sintética 808', now],
      );
      const supervisor = await queryOne<{ id: string }>(
        client,
        `INSERT INTO users (
           email, password_hash, first_name, last_name, role_id, store_id,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          'supervisor.migracion-t08@test.invalid',
          'hash-sintetico',
          'Supervisor',
          'Migracion',
          supervisorRole.id,
          store.id,
          now,
        ],
      );
      const admin = await queryOne<{ id: string }>(
        client,
        `INSERT INTO users (
           email, password_hash, first_name, last_name, role_id, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          'admin.migracion-t08@test.invalid',
          'hash-sintetico',
          'Admin',
          'Migracion',
          adminRole.id,
          now,
        ],
      );
      ids.store = store.id;
      ids.admin = admin.id;

      const cash = await queryOne<{ id: string }>(
        client,
        `SELECT id FROM payment_methods WHERE code = 'CASH'`,
        [],
      );
      const debit = await queryOne<{ id: string }>(
        client,
        `SELECT id FROM payment_methods WHERE code = 'DEBIT_CARD'`,
        [],
      );
      ids.cash = cash.id;
      ids.debit = debit.id;

      await client.query(
        `INSERT INTO sales (
           sold_at, gross_amount, store_id, payment_method_id,
           registered_by_id
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          new Date('2026-11-03T15:00:00.000Z'),
          '12500',
          store.id,
          cash.id,
          supervisor.id,
        ],
      );
      await client.query(
        `INSERT INTO sales (
           sold_at, gross_amount, store_id, payment_method_id,
           registered_by_id, source, period_start, period_end
         ) VALUES ($1, $2, $3, $4, $5, 'MRCOMANDA', $6, $7)`,
        [
          new Date('2026-11-04T15:00:00.000Z'),
          '512300',
          store.id,
          debit.id,
          supervisor.id,
          new Date('2026-11-04T03:00:00.000Z'),
          new Date('2026-11-05T02:59:00.000Z'),
        ],
      );
      await client.query(
        `INSERT INTO daily_operations (
           business_date, card_tip_amount, cash_tip_amount, tip_fund_amount,
           cash_difference, difference_reason, store_id, responsible_id,
           updated_at
         ) VALUES ($1::date, 0, 4500, 4500, -1000, $2, $3, $4, $5)`,
        [
          '2026-11-04',
          'Faltante declarado de prueba',
          store.id,
          supervisor.id,
          now,
        ],
      );
    }

    afterAll(async () => {
      if (migrationClient) {
        await migrationClient.end().catch(() => undefined);
      }
      if (adminClient) {
        try {
          if (tempDatabaseName) {
            await adminClient.query(
              `DROP DATABASE IF EXISTS "${tempDatabaseName}" WITH (FORCE)`,
            );
          }
        } finally {
          await adminClient.end().catch(() => undefined);
        }
      }
    });

    it('no modifica ventas, operaciones diarias ni el catálogo de medios', async () => {
      const after = await readLegacy(db());
      expect(after.sales).toEqual(legacySales);
      expect(after.sales).toHaveLength(2);
      expect(after.operations).toEqual(legacyOperations);
      expect(after.methods).toBe(legacyMethodsSnapshot);
    });

    it('crea las tablas nuevas vacías: ninguna equivalencia por suposición', async () => {
      const client = db();
      for (const table of [
        'store_external_codes',
        'payment_method_aliases',
        'sales_imports',
        'sales_import_lines',
      ]) {
        const row = await queryOne<CountRow>(
          client,
          `SELECT count(*)::int AS total FROM "${table}"`,
          [],
        );
        expect(row.total).toBe(0);
      }
    });

    it('el modelo nuevo funciona sobre la base migrada', async () => {
      const client = db();
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO store_external_codes (system, external_code, store_id, updated_at)
           VALUES ('MRCOMANDA', '208 - 72597', $1, now())`,
          [ids.store],
        );
        await client.query(
          `INSERT INTO payment_method_aliases (
             system, label, normalized_label, payment_method_id, updated_at
           ) VALUES ('MRCOMANDA', 'T. DEBITO', 'T. DEBITO', $1, now()),
                    ('MRCOMANDA', 'EFECTIVO', 'EFECTIVO', $2, now())`,
          [ids.debit, ids.cash],
        );
        const header = await queryOne<{ id: string }>(
          client,
          `INSERT INTO sales_imports (
             business_date, period_start, period_end, external_store_code,
             version, total_amount, file_name, file_path, mime_type,
             size_bytes, sha256_hash, store_id, uploaded_by_id, updated_at
           ) VALUES (
             '2026-11-05', '2026-11-05T03:00:00Z', '2026-11-06T02:59:00Z',
             '208 - 72597', 1, 713760, 'ventas-06-11-2026.xlsx',
             'sales-imports/x.xlsx', 'application/octet-stream', 100,
             repeat('a', 64), $1, $2, now()
           ) RETURNING id`,
          [ids.store, ids.admin],
        );
        await client.query(
          `INSERT INTO sales_import_lines (
             import_id, line_number, original_label, normalized_label,
             amount, payment_method_id
           ) VALUES ($1, 1, 'T. DEBITO', 'T. DEBITO', 512300, $2),
                    ($1, 2, 'EFECTIVO', 'EFECTIVO', 201460, $3)`,
          [header.id, ids.debit, ids.cash],
        );
        await client.query(
          `UPDATE sales_imports
              SET status = 'ACTIVE', is_current = true, confirmed_at = now(),
                  confirmed_by_id = $2
            WHERE id = $1`,
          [header.id, ids.admin],
        );
        const status = await queryOne<StatusRow>(
          client,
          `SELECT status::text FROM sales_imports WHERE id = $1`,
          [header.id],
        );
        expect(status.status).toBe('ACTIVE');
      } finally {
        await client.query('ROLLBACK');
      }
    });

    it('down.sql retira el esquema nuevo sin tocar los datos legados y la migración se reaplica', async () => {
      const client = db();
      await applySql(client, T08_MIGRATION, 'down.sql');

      for (const table of [
        'store_external_codes',
        'payment_method_aliases',
        'sales_imports',
        'sales_import_lines',
      ]) {
        expect(await tableExists(client, table)).toBe(false);
      }
      const leftovers = await queryOne<CountRow>(
        client,
        `SELECT
           (SELECT count(*) FROM pg_proc
             WHERE proname IN ('normalize_external_label',
                               'sales_imports_enforce',
                               'sales_import_lines_enforce'))
           + (SELECT count(*) FROM pg_type
               WHERE typname IN ('ExternalSystem', 'SalesImportStatus'))
           AS total`,
        [],
      );
      expect(Number(leftovers.total)).toBe(0);

      const afterDown = await readLegacy(client);
      expect(afterDown.sales).toEqual(legacySales);
      expect(afterDown.operations).toEqual(legacyOperations);
      expect(afterDown.methods).toBe(legacyMethodsSnapshot);

      await applySql(client, T08_MIGRATION, 'migration.sql');
      expect(await tableExists(client, 'sales_imports')).toBe(true);
      expect(await tableExists(client, 'sales_import_lines')).toBe(true);
    });
  },
);
