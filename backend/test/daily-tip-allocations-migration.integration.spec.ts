import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type QueryResultRow } from 'pg';
import {
  calculateEqualDailyDistribution,
  splitDailyFund,
  type EqualDailyShareDay,
} from '../src/tips/calculation/equal-daily-distribution.calculator.js';

// Prueba de la migración 20261110040000_propinas_diarias_lotes_pago
// (SPRINT-4A-T02) con datos existentes: crea una base temporal con nombre
// único, aplica a mano (en orden) los SQL de todas las migraciones
// anteriores, siembra operaciones diarias legadas (repartos PAID, CONFIRMED y
// DRAFT alimentados por operaciones, fondo 0, fondo sin participantes y una
// muestra pseudoaleatoria determinista), ejecuta la migración y verifica:
// - la asignación de cada operación es exactamente splitDailyFund (misma
//   regla que la API) y suma su fondo;
// - las operaciones de un reparto PAID quedan PAID en un lote histórico que
//   cuadra con el reparto y con sus líneas; el resto queda UNPAID;
// - ningún reparto, línea ni fuente cambia y no se borra ningún dato;
// - down.sql retira el modelo sin tocar los históricos.
// Se omite sin TEST_DATABASE_URL y solo elimina la base temporal que creó.
const databaseUrl = process.env.TEST_DATABASE_URL;

const T02_MIGRATION = '20261110040000_propinas_diarias_lotes_pago';
const T03_MIGRATION = '20261110050000_reparto_diario_automatico';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'prisma',
  'migrations',
);

interface AllocationRow {
  operation_id: string;
  worker_id: string;
  amount: string;
  status: 'UNPAID' | 'PAID';
  payment_batch_id: string | null;
}

interface SeededDay extends EqualDailyShareDay {
  poolKey: 'paid' | 'confirmed' | 'draft' | null;
}

// Generador congruencial determinista: la muestra es la misma en cada
// corrida (sin Math.random) y cubre residuos variados.
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state;
  };
}

describe.skipIf(!databaseUrl)(
  'Migración de propinas diarias y lotes de pago (SPRINT-4A-T02)',
  () => {
    let adminClient: Client | undefined;
    let migrationClient: Client | undefined;
    let tempDatabaseName = '';

    const days: SeededDay[] = [];
    const ids: Record<string, string> = {};
    let poolSnapshotBefore = '';

    function db(): Client {
      if (!migrationClient) {
        throw new Error('El cliente de la base temporal no fue inicializado');
      }
      return migrationClient;
    }

    async function sqlOf(migration: string, file: string): Promise<string> {
      return readFile(path.join(MIGRATIONS_DIR, migration, file), 'utf8');
    }

    async function queryOne<Row extends QueryResultRow>(
      client: Client,
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<Row> {
      const { rows } = await client.query<Row>(sql, [...params]);
      const row: Row | undefined = rows[0];
      if (!row) throw new Error('La consulta no devolvió filas');
      return row;
    }

    // Foto de los históricos que la migración no debe tocar.
    async function poolSnapshot(client: Client): Promise<string> {
      const { rows } = await client.query(
        `SELECT
           (SELECT json_agg(p ORDER BY p.id) FROM tip_pools p) AS pools,
           (SELECT json_agg(l ORDER BY l.id) FROM tip_pool_lines l) AS lines,
           (SELECT json_agg(s ORDER BY s.id) FROM tip_pool_daily_operation_sources s) AS sources,
           (SELECT json_agg(o ORDER BY o.id) FROM daily_operations o) AS operations,
           (SELECT json_agg(x ORDER BY x.id) FROM daily_operation_participants x) AS participants`,
      );
      return JSON.stringify(rows[0]);
    }

    async function insertUser(
      client: Client,
      roleId: string,
      storeId: string | null,
      label: string,
    ): Promise<string> {
      const row = await queryOne<{ id: string }>(
        client,
        `INSERT INTO users (email, password_hash, first_name, last_name, role_id, store_id, updated_at)
         VALUES ($1, 'hash-sintetico', $2, 'Migracion', $3, $4, NOW()) RETURNING id`,
        [
          `${label}.${randomUUID()}@migracion-t02.invalid`,
          label,
          roleId,
          storeId,
        ],
      );
      return row.id;
    }

    async function insertDay(
      client: Client,
      storeId: string,
      businessDate: string,
      fund: number,
      participantIds: string[],
      poolKey: SeededDay['poolKey'],
    ): Promise<void> {
      const operation = await queryOne<{ id: string }>(
        client,
        `INSERT INTO daily_operations (
           store_id, business_date, card_tip_amount, cash_tip_amount,
           tip_fund_amount, cash_difference, responsible_id, updated_at
         ) VALUES ($1, $2, 0, $3, $3, 0, $4, NOW()) RETURNING id`,
        [storeId, businessDate, fund, ids.supervisor],
      );
      for (const workerId of participantIds) {
        await client.query(
          `INSERT INTO daily_operation_participants (operation_id, worker_id) VALUES ($1, $2)`,
          [operation.id, workerId],
        );
      }
      days.push({
        operationId: operation.id,
        businessDate,
        fundAmount: fund,
        participantIds,
        poolKey,
      });
    }

    // Reparto equitativo alimentado por los días indicados, con sus líneas
    // (calculadas con la misma regla que el servicio de repartos) y llevado
    // al estado pedido con las transiciones que exigen los triggers.
    async function insertPool(
      client: Client,
      key: 'paid' | 'confirmed' | 'draft',
      status: 'DRAFT' | 'CONFIRMED' | 'PAID',
      period: { start: string; end: string },
    ): Promise<void> {
      const fed = days.filter((day) => day.poolKey === key);
      const distribution = calculateEqualDailyDistribution(fed);
      const pool = await queryOne<{ id: string }>(
        client,
        `INSERT INTO tip_pools (
           store_id, period_start, period_end, total_amount, calculated_by_id,
           agreement_snapshot, updated_at
         ) VALUES ($1, $2, $3, $4, $5, '{"rule":"EQUAL_SHARES"}'::jsonb, NOW())
         RETURNING id`,
        [
          ids.store,
          period.start,
          period.end,
          distribution.totalAmount,
          ids.accountant,
        ],
      );
      ids[`pool-${key}`] = pool.id;
      for (const day of fed) {
        await client.query(
          `INSERT INTO tip_pool_daily_operation_sources (pool_id, operation_id, amount) VALUES ($1, $2, $3)`,
          [pool.id, day.operationId, day.fundAmount],
        );
      }
      for (const line of distribution.lines) {
        await client.query(
          `INSERT INTO tip_pool_lines (pool_id, user_id, hours_worked, amount) VALUES ($1, $2, NULL, $3)`,
          [pool.id, line.userId, line.amount],
        );
      }
      if (status === 'DRAFT') return;
      await client.query(
        `UPDATE tip_pools SET status = 'CONFIRMED', confirmed_at = NOW(), confirmed_by_id = $2 WHERE id = $1`,
        [pool.id, ids.accountant],
      );
      if (status === 'CONFIRMED') return;
      await client.query(
        `UPDATE tip_pools
         SET status = 'PAID', paid_at = '2026-10-15T15:00:00Z', paid_by_id = $2,
             payment_date = $3, version = version + 1
         WHERE id = $1`,
        [pool.id, ids.accountant, period.end],
      );
    }

    async function seedLegacyData(client: Client): Promise<void> {
      const roleIds: Record<string, string> = {};
      for (const code of ['TRABAJADOR', 'SUPERVISOR', 'CONTADOR']) {
        const role = await queryOne<{ id: string }>(
          client,
          `INSERT INTO roles (code, name, updated_at) VALUES ($1, $1, NOW()) RETURNING id`,
          [code],
        );
        roleIds[code] = role.id;
      }
      const store = await queryOne<{ id: string }>(
        client,
        `INSERT INTO stores (name, city, address, updated_at)
         VALUES ('Local Migracion 4A-T02', 'Melipilla', 'Calle 1', NOW()) RETURNING id`,
      );
      ids.store = store.id;
      ids.supervisor = await insertUser(
        client,
        roleIds.SUPERVISOR,
        store.id,
        'supervisor',
      );
      ids.accountant = await insertUser(
        client,
        roleIds.CONTADOR,
        null,
        'contador',
      );
      const workers: string[] = [ids.supervisor];
      for (let index = 0; index < 5; index += 1) {
        workers.push(
          await insertUser(client, roleIds.TRABAJADOR, store.id, `w${index}`),
        );
      }

      // Repartos: PAID (dos días), CONFIRMED y DRAFT.
      await insertDay(
        client,
        store.id,
        '2026-10-01',
        10_000,
        workers.slice(0, 3),
        'paid',
      );
      await insertDay(
        client,
        store.id,
        '2026-10-02',
        7_001,
        workers.slice(1, 3),
        'paid',
      );
      await insertDay(
        client,
        store.id,
        '2026-10-05',
        5_000,
        workers.slice(1, 2),
        'confirmed',
      );
      await insertDay(client, store.id, '2026-10-06', 3, workers, 'draft');
      // Fondo 0 y fondo sin participantes (previa a la selección).
      await insertDay(client, store.id, '2026-10-07', 0, [], null);
      await insertDay(client, store.id, '2026-10-08', 9_000, [], null);
      // Muestra determinista de 40 días sin reparto: fondos y cantidades de
      // participantes variados (residuos de 0 a n − 1).
      const next = lcg(20_261_110);
      for (let index = 0; index < 40; index += 1) {
        const count = 1 + (next() % workers.length);
        const offset = next() % workers.length;
        const selected = [...workers, ...workers].slice(offset, offset + count);
        const date = new Date(Date.UTC(2026, 6, 1 + index))
          .toISOString()
          .slice(0, 10);
        await insertDay(
          client,
          store.id,
          date,
          1 + (next() % 250_000),
          selected,
          null,
        );
      }

      await insertPool(client, 'paid', 'PAID', {
        start: '2026-10-01',
        end: '2026-10-02',
      });
      await insertPool(client, 'confirmed', 'CONFIRMED', {
        start: '2026-10-05',
        end: '2026-10-05',
      });
      await insertPool(client, 'draft', 'DRAFT', {
        start: '2026-10-06',
        end: '2026-10-06',
      });
    }

    async function allocations(client: Client): Promise<AllocationRow[]> {
      const { rows } = await client.query<AllocationRow>(
        `SELECT operation_id, worker_id, amount::text AS amount, status::text AS status, payment_batch_id
         FROM daily_tip_allocations ORDER BY operation_id, worker_id`,
      );
      return rows;
    }

    beforeAll(async () => {
      if (!databaseUrl) return;
      tempDatabaseName = `t4a02_propinas_${Date.now()}_${randomUUID()
        .replace(/-/g, '')
        .slice(0, 8)}`;
      adminClient = new Client({ connectionString: databaseUrl });
      await adminClient.connect();
      await adminClient.query(`CREATE DATABASE "${tempDatabaseName}"`);

      const tempUrl = new URL(databaseUrl);
      tempUrl.pathname = `/${tempDatabaseName}`;
      migrationClient = new Client({ connectionString: tempUrl.toString() });
      await migrationClient.connect();

      // Todas las migraciones anteriores, en el orden alfabético de Prisma.
      const previous = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name < T02_MIGRATION)
        .map((entry) => entry.name)
        .sort();
      for (const migration of previous) {
        await migrationClient.query(await sqlOf(migration, 'migration.sql'));
      }
      await seedLegacyData(migrationClient);
      poolSnapshotBefore = await poolSnapshot(migrationClient);
      await migrationClient.query(await sqlOf(T02_MIGRATION, 'migration.sql'));
    }, 180_000);

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

    it('asigna cada operación con la regla de splitDailyFund y concilia su fondo', async () => {
      const rows = await allocations(db());
      for (const day of days) {
        const actual = rows
          .filter((row) => row.operation_id === day.operationId)
          .map((row) => ({ userId: row.worker_id, amount: Number(row.amount) }))
          .sort((a, b) => (a.userId < b.userId ? -1 : 1));
        const expected =
          day.fundAmount > 0 && day.participantIds.length > 0
            ? splitDailyFund(day)
            : [];
        expect(actual, day.businessDate).toEqual(expected);
        if (expected.length > 0) {
          expect(actual.reduce((sum, row) => sum + row.amount, 0)).toBe(
            day.fundAmount,
          );
        }
      }
      // 40 días de muestra + 4 de repartos; sin filas para fondo 0 ni para
      // el fondo sin participantes.
      const withRows = new Set(rows.map((row) => row.operation_id));
      expect(withRows.size).toBe(44);
    });

    it('deja PAID en un lote histórico las operaciones del reparto pagado y UNPAID el resto', async () => {
      const client = db();
      const rows = await allocations(client);
      const paidOperations = new Set(
        days
          .filter((day) => day.poolKey === 'paid')
          .map((day) => day.operationId),
      );
      const batch = await queryOne<{
        id: string;
        store_id: string;
        period_start: string;
        period_end: string;
        total_amount: string;
        allocation_count: number;
        paid_by_id: string;
        paid_at: Date;
      }>(
        client,
        `SELECT id, store_id, period_start::text, period_end::text,
                total_amount::text, allocation_count, paid_by_id, paid_at
         FROM tip_payment_batches WHERE legacy_pool_id = $1`,
        [ids['pool-paid']],
      );
      expect(batch).toMatchObject({
        store_id: ids.store,
        period_start: '2026-10-01',
        period_end: '2026-10-02',
        total_amount: '17001',
        allocation_count: 5,
        paid_by_id: ids.accountant,
      });
      expect(batch.paid_at.toISOString()).toBe('2026-10-15T15:00:00.000Z');

      for (const row of rows) {
        if (paidOperations.has(row.operation_id)) {
          expect(row.status).toBe('PAID');
          expect(row.payment_batch_id).toBe(batch.id);
        } else {
          expect(row.status).toBe('UNPAID');
          expect(row.payment_batch_id).toBeNull();
        }
      }
      // Solo el reparto PAID genera lote: CONFIRMED y DRAFT quedan sin efecto.
      const batches = await queryOne<{ total: number }>(
        client,
        'SELECT count(*)::int AS total FROM tip_payment_batches',
      );
      expect(batches.total).toBe(1);
    });

    it('el lote histórico cuadra con las líneas pagadas del reparto', async () => {
      const { rows } = await db().query<{ user_id: string; equal: boolean }>(
        `SELECT l.user_id, l.amount = COALESCE(a.total, 0) AS equal
         FROM tip_pool_lines l
         LEFT JOIN (
           SELECT worker_id, sum(amount) AS total
           FROM daily_tip_allocations a
           INNER JOIN tip_payment_batches b ON b.id = a.payment_batch_id
           WHERE b.legacy_pool_id = $1
           GROUP BY worker_id
         ) a ON a.worker_id = l.user_id
         WHERE l.pool_id = $1`,
        [ids['pool-paid']],
      );
      expect(rows.length).toBe(3);
      expect(rows.every((row) => row.equal)).toBe(true);
    });

    it('no modifica ni borra repartos, líneas, fuentes, operaciones ni participantes', async () => {
      expect(await poolSnapshot(db())).toBe(poolSnapshotBefore);
    });

    // SPRINT-4A-T03: la migración siguiente genera el reparto de cualquier
    // operación con fondo y participantes que haya quedado sin él y lo vuelve
    // obligatorio; su down.sql vuelve a la conciliación de T02.
    it('SPRINT-4A-T03 genera el reparto faltante y lo exige al commit', async () => {
      const client = db();
      // Bajo la regla de T02 una operación con fondo y participantes puede
      // quedar sin reparto (ej. registrada por la API anterior).
      await insertDay(
        client,
        ids.store,
        '2026-11-01',
        10_000,
        days[0].participantIds.slice(0, 3),
        null,
      );
      const pending = days[days.length - 1];
      expect(
        (await allocations(client)).filter(
          (row) => row.operation_id === pending.operationId,
        ),
      ).toEqual([]);

      await client.query(await sqlOf(T03_MIGRATION, 'migration.sql'));
      const generated = (await allocations(client))
        .filter((row) => row.operation_id === pending.operationId)
        .map((row) => ({ userId: row.worker_id, amount: Number(row.amount) }));
      expect(generated).toEqual(splitDailyFund(pending));
      expect(
        (await allocations(client)).every(
          (row) =>
            row.operation_id !== pending.operationId || row.status === 'UNPAID',
        ),
      ).toBe(true);

      // Con la regla nueva, una operación con fondo y participantes sin
      // reparto no llega al commit; fondo 0 y fondo sin participantes sí.
      const strict = await client
        .query(
          `BEGIN;
           INSERT INTO daily_operations (store_id, business_date, card_tip_amount, cash_tip_amount, tip_fund_amount, cash_difference, responsible_id, updated_at)
           VALUES ('${ids.store}', '2026-11-02', 0, 500, 500, 0, '${ids.supervisor}', NOW());
           INSERT INTO daily_operation_participants (operation_id, worker_id)
           SELECT id, '${ids.supervisor}' FROM daily_operations WHERE store_id = '${ids.store}' AND business_date = '2026-11-02';
           COMMIT;`,
        )
        .then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : ''),
        );
      await client.query('ROLLBACK');
      expect(strict).toMatch(/no tiene su reparto de propinas diarias/);
      await client.query(
        `INSERT INTO daily_operations (store_id, business_date, card_tip_amount, cash_tip_amount, tip_fund_amount, cash_difference, responsible_id, updated_at)
         VALUES ($1, '2026-11-03', 0, 700, 700, 0, $2, NOW()),
                ($1, '2026-11-04', 0, 0, 0, 0, $2, NOW())`,
        [ids.store, ids.supervisor],
      );

      // La reversa de T03 vuelve a la conciliación de T02 (sin exigirlo).
      await client.query(await sqlOf(T03_MIGRATION, 'down.sql'));
      await client.query(
        `BEGIN;
         INSERT INTO daily_operations (store_id, business_date, card_tip_amount, cash_tip_amount, tip_fund_amount, cash_difference, responsible_id, updated_at)
         VALUES ('${ids.store}', '2026-11-05', 0, 500, 500, 0, '${ids.supervisor}', NOW());
         INSERT INTO daily_operation_participants (operation_id, worker_id)
         SELECT id, '${ids.supervisor}' FROM daily_operations WHERE store_id = '${ids.store}' AND business_date = '2026-11-05';
         COMMIT;`,
      );
      // Limpieza de lo agregado para que la foto de históricos siga igual.
      await client.query(
        `DELETE FROM daily_tip_allocations WHERE business_date >= '2026-11-01';
         DELETE FROM daily_operation_participants USING daily_operations o
           WHERE o.id = operation_id AND o.business_date >= '2026-11-01';
         DELETE FROM daily_operations WHERE business_date >= '2026-11-01';`,
      );
    });

    it('down.sql retira el modelo y conserva los históricos', async () => {
      const client = db();
      await client.query(await sqlOf(T02_MIGRATION, 'down.sql'));
      const tables = await queryOne<{ total: number }>(
        client,
        `SELECT count(*)::int AS total FROM information_schema.tables
         WHERE table_name IN ('daily_tip_allocations', 'tip_payment_batches')`,
      );
      expect(tables.total).toBe(0);
      expect(await poolSnapshot(client)).toBe(poolSnapshotBefore);
    });
  },
);
