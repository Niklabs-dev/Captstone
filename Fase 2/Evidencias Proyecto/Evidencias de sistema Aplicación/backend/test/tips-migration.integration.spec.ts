import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type QueryResultRow } from 'pg';

// Prueba del backfill real de la migración
// 20261026174911_propinas_diarias_pacto_horas. No usa Prisma Migrate: crea
// una base temporal con nombre único, aplica a mano (en orden) los SQL de
// todas las migraciones anteriores, inserta datos legados, ejecuta la
// migración bajo prueba y verifica el comportamiento corregido: ninguna
// fuente parcial cuando una entrada es ambigua y backfill conservador de
// horas ante períodos solapados. Se omite sin TEST_DATABASE_URL y siempre
// elimina solo la base temporal que creó.
const databaseUrl = process.env.TEST_DATABASE_URL;

// Migraciones previas a la de propinas, en el orden en que Prisma las aplica.
const PREVIOUS_MIGRATIONS: readonly string[] = [
  '20260924183514_init',
  '20260925152325_desglose_cierre_caja',
  '20261005194938_auditoria_inmutable',
  '20261008192524_gestor_documental_plazos',
  '20261017150000_versiones_documento_inmutables',
  '20261017230000_bloqueo_eliminacion_documentos',
  '20261019184219_modelo_liquidaciones',
  '20261019200000_liquidaciones_publicadas_inmutables',
  '20261024184400_locales_nombre_normalizado_unico',
  '20261024193805_locales_nombre_sin_tildes',
];

const TIPS_MIGRATION = '20261026174911_propinas_diarias_pacto_horas';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'prisma',
  'migrations',
);

interface CountRow {
  total: number;
}

interface SalesReconciliationRow {
  total: number;
  reconciled: number;
}

interface TipEntriesSummaryRow {
  entries: number;
  total: number;
}

interface PoolSourcesSummaryRow {
  sources: number;
  total: number;
}

interface PoolLineRow {
  hours_worked: number;
  unlinked: boolean;
}

interface WorkHoursLinkRow {
  hours_worked: number;
  period_start: string;
  period_end: string;
}

interface ConstraintRow {
  conname: string;
}

describe.skipIf(!databaseUrl)(
  'Migración de propinas: backfill de entradas, fuentes y horas (SPRINT-3-T09)',
  () => {
    let adminClient: Client | undefined;
    let migrationClient: Client | undefined;
    let tempDatabaseName = '';
    const poolIds: { a: string; b: string; c: string } = {
      a: '',
      b: '',
      c: '',
    };

    // Ejecuta el archivo migration.sql de una migración contra la base
    // temporal. node-pg usa el protocolo simple sin parámetros, lo que
    // permite varias sentencias (incluidos BEGIN/COMMIT) en una sola llamada.
    async function applyMigration(client: Client, migration: string) {
      const sql = await readFile(
        path.join(MIGRATIONS_DIR, migration, 'migration.sql'),
        'utf8',
      );
      await client.query(sql);
    }

    // Ejecuta una consulta que debe devolver exactamente una fila.
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

    // Devuelve el cliente de la base temporal o falla con un mensaje claro.
    function db(): Client {
      if (!migrationClient) {
        throw new Error('El cliente de la base temporal no fue inicializado');
      }
      return migrationClient;
    }

    beforeAll(async () => {
      if (!databaseUrl) {
        return;
      }
      // Nombre único y seguro: minúsculas, números y guion bajo, siempre
      // con prefijo de letra para cumplir las reglas de identificadores.
      tempDatabaseName = `tips_backfill_${Date.now()}_${randomUUID()
        .replace(/-/g, '')
        .slice(0, 8)}`;

      adminClient = new Client({ connectionString: databaseUrl });
      await adminClient.connect();
      await adminClient.query(`CREATE DATABASE "${tempDatabaseName}"`);

      const tempUrl = new URL(databaseUrl);
      tempUrl.pathname = `/${tempDatabaseName}`;
      migrationClient = new Client({ connectionString: tempUrl.toString() });
      await migrationClient.connect();

      for (const migration of PREVIOUS_MIGRATIONS) {
        await applyMigration(migrationClient, migration);
      }

      await seedLegacyData(migrationClient);
      await applyMigration(migrationClient, TIPS_MIGRATION);
    });

    // Datos legados mínimos: un rol, un local y un trabajador sintéticos;
    // seis ventas con propina y un reparto por período (A, B y C), cada uno
    // con una línea de 10h, 20h y 40h para el mismo trabajador.
    async function seedLegacyData(client: Client) {
      const now = new Date();
      const role = await queryOne<{ id: string }>(
        client,
        `INSERT INTO roles (code, name, updated_at)
         VALUES ($1, $2, $3) RETURNING id`,
        ['TRABAJADOR', 'Trabajador', now],
      );
      const store = await queryOne<{ id: string }>(
        client,
        `INSERT INTO stores (name, city, address, updated_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          'Local Backfill Migracion Tips',
          'Melipilla',
          'Calle sintética 456',
          now,
        ],
      );
      const worker = await queryOne<{ id: string }>(
        client,
        `INSERT INTO users (
           email, password_hash, first_name, last_name, role_id, store_id,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          'trabajador.backfill@tips-migration-test.invalid',
          'hash-sintetico',
          'Trabajador',
          'Backfill',
          role.id,
          store.id,
          now,
        ],
      );

      // Ventas con propina. El mediodía en hora de Chile (UTC-3 en estas
      // fechas) deja la fecha local inequívoca para la agrupación diaria.
      // La venta de 2026-01-20 cabe en los períodos A y B (es la ambigua).
      const legacyTips: ReadonlyArray<{
        soldAt: string;
        paymentMethod: string;
        tipAmount: string;
      }> = [
        {
          soldAt: '2026-01-05T12:00:00-03:00',
          paymentMethod: 'CASH',
          tipAmount: '1000',
        },
        {
          soldAt: '2026-01-10T12:00:00-03:00',
          paymentMethod: 'CASH',
          tipAmount: '2000',
        },
        {
          soldAt: '2026-01-20T12:00:00-03:00',
          paymentMethod: 'CASH',
          tipAmount: '500',
        },
        {
          soldAt: '2026-02-01T12:00:00-03:00',
          paymentMethod: 'CASH',
          tipAmount: '700',
        },
        {
          soldAt: '2026-03-10T12:00:00-03:00',
          paymentMethod: 'DEBIT_CARD',
          tipAmount: '1000',
        },
        {
          soldAt: '2026-03-20T12:00:00-03:00',
          paymentMethod: 'DEBIT_CARD',
          tipAmount: '500',
        },
      ];
      for (const sale of legacyTips) {
        await client.query(
          `INSERT INTO sales (
             sold_at, payment_method, channel, gross_amount, tip_amount,
             store_id, registered_by_id
           ) VALUES ($1, $2, 'IN_STORE', $3, $3, $4, $5)`,
          [
            sale.soldAt,
            sale.paymentMethod,
            sale.tipAmount,
            store.id,
            worker.id,
          ],
        );
      }
      // Venta sin propina: no debe reconciliarse con ninguna entrada.
      await client.query(
        `INSERT INTO sales (
           sold_at, payment_method, channel, gross_amount, tip_amount,
           store_id, registered_by_id
         ) VALUES ($1, 'CASH', 'IN_STORE', $2, 0, $3, $4)`,
        ['2026-01-06T12:00:00-03:00', '4500', store.id, worker.id],
      );

      // Repartos legados. A (enero) y B (15-ene..15-feb) se solapan; el
      // reparto C (marzo) queda aislado. Las líneas usan el mismo trabajador.
      const pools: ReadonlyArray<{
        key: 'a' | 'b' | 'c';
        periodStart: string;
        periodEnd: string;
        total: string;
        hours: string;
      }> = [
        {
          key: 'a',
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          total: '3500',
          hours: '10',
        },
        {
          key: 'b',
          periodStart: '2026-01-15',
          periodEnd: '2026-02-15',
          total: '1200',
          hours: '20',
        },
        {
          key: 'c',
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
          total: '1500',
          hours: '40',
        },
      ];
      for (const pool of pools) {
        const inserted = await queryOne<{ id: string }>(
          client,
          `INSERT INTO tip_pools (
             period_start, period_end, total_amount, store_id,
             calculated_by_id, updated_at
           ) VALUES ($1::date, $2::date, $3, $4, $5, $6) RETURNING id`,
          [
            pool.periodStart,
            pool.periodEnd,
            pool.total,
            store.id,
            worker.id,
            now,
          ],
        );
        await client.query(
          `INSERT INTO tip_pool_lines (hours_worked, amount, pool_id, user_id)
           VALUES ($1, $2, $3, $4)`,
          [pool.hours, pool.total, inserted.id, worker.id],
        );
        poolIds[pool.key] = inserted.id;
      }
    }

    afterAll(async () => {
      if (migrationClient) {
        await migrationClient.end().catch(() => undefined);
      }
      if (adminClient) {
        try {
          if (tempDatabaseName) {
            // WITH (FORCE) evita quedar bloqueado si quedó alguna conexión.
            await adminClient.query(
              `DROP DATABASE IF EXISTS "${tempDatabaseName}" WITH (FORCE)`,
            );
          }
        } finally {
          await adminClient.end().catch(() => undefined);
        }
      }
    });

    it('agrupa las ventas con propina en entradas diarias y reconcilia cada venta', async () => {
      const client = db();

      const ventas = await queryOne<SalesReconciliationRow>(
        client,
        `SELECT COUNT(*)::int AS total,
                COUNT(tip_entry_id)::int AS reconciled
         FROM sales
         WHERE tip_amount > 0`,
        [],
      );
      expect(ventas.total).toBe(6);
      expect(ventas.reconciled).toBe(6);

      // La venta sin propina no se reconcilia.
      const sinPropina = await queryOne<CountRow>(
        client,
        `SELECT COUNT(*)::int AS total
         FROM sales
         WHERE tip_amount = 0 AND tip_entry_id IS NOT NULL`,
        [],
      );
      expect(sinPropina.total).toBe(0);

      // Seis entradas: 4 CASH (ene/feb) y 2 DEBIT_CARD (mar), por 5700 total.
      const entradas = await queryOne<TipEntriesSummaryRow>(
        client,
        `SELECT COUNT(*)::int AS entries,
                COALESCE(SUM(amount), 0)::float AS total
         FROM tip_entries`,
        [],
      );
      expect(entradas.entries).toBe(6);
      expect(entradas.total).toBe(5700);

      // Cada entrada cuadra con la suma de las propinas de sus ventas.
      const inconsistentes = await queryOne<CountRow>(
        client,
        `SELECT COUNT(*)::int AS total
         FROM (
           SELECT e.id
           FROM tip_entries AS e
           LEFT JOIN sales AS s ON s.tip_entry_id = e.id
           GROUP BY e.id, e.amount
           HAVING e.amount <> COALESCE(SUM(s.tip_amount), 0)
         ) AS diferencias`,
        [],
      );
      expect(inconsistentes.total).toBe(0);
    });

    it('no asocia fuentes parciales a repartos con entradas ambiguas', async () => {
      const client = db();

      // A y B comparten la entrada de 2026-01-20: el algoritmo antiguo les
      // habría asignado fuentes (3000 a A); el corregido no asigna ninguna.
      for (const poolId of [poolIds.a, poolIds.b]) {
        const fuentes = await queryOne<PoolSourcesSummaryRow>(
          client,
          `SELECT COUNT(*)::int AS sources,
                  COALESCE(SUM(amount), 0)::float AS total
           FROM tip_pool_sources
           WHERE pool_id = $1`,
          [poolId],
        );
        expect(fuentes.sources).toBe(0);
        expect(fuentes.total).toBe(0);
      }

      // C es inequívico: dos fuentes que concilian su total de 1500.
      const fuentesC = await queryOne<PoolSourcesSummaryRow>(
        client,
        `SELECT COUNT(*)::int AS sources,
                COALESCE(SUM(amount), 0)::float AS total
         FROM tip_pool_sources
         WHERE pool_id = $1`,
        [poolIds.c],
      );
      expect(fuentesC.sources).toBe(2);
      expect(fuentesC.total).toBe(1500);

      // Solo las dos entradas de marzo quedan con fuente.
      const sinFuente = await queryOne<CountRow>(
        client,
        `SELECT COUNT(*)::int AS total
         FROM tip_entries AS e
         WHERE NOT EXISTS (
           SELECT 1
           FROM tip_pool_sources AS s
           WHERE s.tip_entry_id = e.id
         )`,
        [],
      );
      expect(sinFuente.total).toBe(4);
    });

    it('conserva hours_worked pero no enlaza líneas con períodos solapados', async () => {
      const client = db();

      // A y B se solapan para el mismo trabajador: quedan sin enlace y el
      // snapshot hours_worked se preserva tal cual.
      const lineaA = await queryOne<PoolLineRow>(
        client,
        `SELECT hours_worked::float AS hours_worked,
                work_hours_record_id IS NULL AS unlinked
         FROM tip_pool_lines
         WHERE pool_id = $1`,
        [poolIds.a],
      );
      expect(lineaA.unlinked).toBe(true);
      expect(lineaA.hours_worked).toBe(10);

      const lineaB = await queryOne<PoolLineRow>(
        client,
        `SELECT hours_worked::float AS hours_worked,
                work_hours_record_id IS NULL AS unlinked
         FROM tip_pool_lines
         WHERE pool_id = $1`,
        [poolIds.b],
      );
      expect(lineaB.unlinked).toBe(true);
      expect(lineaB.hours_worked).toBe(20);

      // C no se solapa: su línea enlaza con un registro de 40h del período.
      const lineaC = await queryOne<PoolLineRow>(
        client,
        `SELECT hours_worked::float AS hours_worked,
                work_hours_record_id IS NULL AS unlinked
         FROM tip_pool_lines
         WHERE pool_id = $1`,
        [poolIds.c],
      );
      expect(lineaC.unlinked).toBe(false);
      expect(lineaC.hours_worked).toBe(40);

      const horasC = await queryOne<WorkHoursLinkRow>(
        client,
        `SELECT w.hours_worked::float AS hours_worked,
                w.period_start::text AS period_start,
                w.period_end::text AS period_end
         FROM tip_pool_lines AS l
         INNER JOIN work_hours_records AS w ON w.id = l.work_hours_record_id
         WHERE l.pool_id = $1`,
        [poolIds.c],
      );
      expect(horasC.hours_worked).toBe(40);
      expect(horasC.period_start).toBe('2026-03-01');
      expect(horasC.period_end).toBe('2026-03-31');

      // Solo el registro no solapado se creó durante el backfill.
      const registros = await queryOne<CountRow>(
        client,
        `SELECT COUNT(*)::int AS total FROM work_hours_records`,
        [],
      );
      expect(registros.total).toBe(1);
    });

    it('crea las constraints de exclusión de pactos y de horas', async () => {
      const client = db();

      const constraints = await client.query<ConstraintRow>(
        `SELECT conname
         FROM pg_constraint
         WHERE contype = 'x'
           AND conname IN (
             'tip_agreements_no_overlap',
             'work_hours_records_no_overlap'
           )`,
      );
      const names = constraints.rows.map((row) => row.conname);
      expect(names).toContain('tip_agreements_no_overlap');
      expect(names).toContain('work_hours_records_no_overlap');
    });
  },
  120_000,
);
