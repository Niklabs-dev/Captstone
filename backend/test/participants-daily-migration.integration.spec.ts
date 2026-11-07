import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type QueryResultRow } from 'pg';

// Prueba de la migración 20261107200000_participantes_diarios_reparto_equitativo
// (SPRINT-4R-T02) con datos existentes: no usa Prisma Migrate; crea una base
// temporal con nombre único, aplica a mano (en orden) los SQL de todas las
// migraciones anteriores, siembra datos legados (pacto proporcional con
// repartos DRAFT/CONFIRMED/PAID, líneas, fuentes, constancia y una operación
// diaria de T01), ejecuta la migración bajo prueba y verifica: los valores
// históricos no se reinterpretan (horas conservadas, enum ampliado, NOT NULL
// cae sin reescribir filas), las nuevas reglas funcionan en la base migrada y
// los triggers anteriores quedan intactos. Se omite sin TEST_DATABASE_URL y
// siempre elimina solo la base temporal que creó.
const databaseUrl = process.env.TEST_DATABASE_URL;

// Migraciones previas a la de participantes, en el orden en que Prisma las
// aplica.
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
  '20261026174911_propinas_diarias_pacto_horas',
  '20261028010122_propinas_confirmacion_pago',
  '20261028221910_propinas_fecha_calculo',
  '20261104010649_cierres_caja_turno_conciliacion',
  '20261105021500_medios_pago_catalogo',
  '20261107181442_operacion_diaria',
];

const T02_MIGRATION = '20261107200000_participantes_diarios_reparto_equitativo';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'prisma',
  'migrations',
);

interface CountRow {
  total: number;
}

interface EnumRow {
  label: string;
}

interface HoursRow {
  hours_worked: string | null;
}

interface NullableRow {
  is_nullable: string;
}

interface TriggerRow {
  tgname: string;
}

describe.skipIf(!databaseUrl)(
  'Migración de participantes diarios y reparto equitativo (SPRINT-4R-T02)',
  () => {
    let adminClient: Client | undefined;
    let migrationClient: Client | undefined;
    let tempDatabaseName = '';

    const ids: Record<string, string> = {};

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

    // Ejecuta sql esperando que la base lo rechace; devuelve el mensaje.
    async function expectReject(
      client: Client,
      sql: string,
      params: readonly unknown[],
    ): Promise<string> {
      try {
        await client.query(sql, [...params]);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      throw new Error(`Se esperaba un rechazo y la consulta pasó: ${sql}`);
    }

    beforeAll(async () => {
      if (!databaseUrl) {
        return;
      }
      tempDatabaseName = `t02_participantes_${Date.now()}_${randomUUID()
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
      await applyMigration(migrationClient, T02_MIGRATION);
    }, 120_000);

    // Datos legados mínimos pero representativos: un local, un supervisor y
    // un trabajador; dos entradas de propina; pacto proporcional; repartos en
    // los tres estados con líneas, fuentes y una constancia; y una operación
    // diaria de T01. Todo se inserta ANTES de la migración bajo prueba.
    async function seedLegacyData(client: Client) {
      const now = new Date();
      const role = await queryOne<{ id: string }>(
        client,
        `INSERT INTO roles (code, name, updated_at)
         VALUES ($1, $2, $3) RETURNING id`,
        ['TRABAJADOR', 'Trabajador', now],
      );
      const supervisorRole = await queryOne<{ id: string }>(
        client,
        `INSERT INTO roles (code, name, updated_at)
         VALUES ($1, $2, $3) RETURNING id`,
        ['SUPERVISOR', 'Supervisor', now],
      );
      const store = await queryOne<{ id: string }>(
        client,
        `INSERT INTO stores (name, city, address, updated_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        ['Local Migracion T02', 'Melipilla', 'Calle sintética 789', now],
      );
      const worker = await queryOne<{ id: string }>(
        client,
        `INSERT INTO users (
           email, password_hash, first_name, last_name, role_id, store_id,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          'trabajador.migracion-t02@test.invalid',
          'hash-sintetico',
          'Trabajador',
          'Migracion',
          role.id,
          store.id,
          now,
        ],
      );
      const supervisor = await queryOne<{ id: string }>(
        client,
        `INSERT INTO users (
           email, password_hash, first_name, last_name, role_id, store_id,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          'supervisor.migracion-t02@test.invalid',
          'hash-sintetico',
          'Supervisor',
          'Migracion',
          supervisorRole.id,
          store.id,
          now,
        ],
      );
      ids.store = store.id;
      ids.worker = worker.id;
      ids.supervisor = supervisor.id;

      const cash = await queryOne<{ id: string }>(
        client,
        `SELECT id FROM payment_methods WHERE code = 'CASH'`,
        [],
      );
      const card = await queryOne<{ id: string }>(
        client,
        `SELECT id FROM payment_methods WHERE code = 'DEBIT_CARD'`,
        [],
      );

      const entries: ReadonlyArray<{
        date: string;
        method: string;
        amount: string;
      }> = [
        { date: '2026-03-02', method: cash.id, amount: '8000' },
        { date: '2026-04-02', method: card.id, amount: '4000' },
        { date: '2026-05-02', method: cash.id, amount: '4000' },
      ];
      const entryIds: string[] = [];
      for (const entry of entries) {
        const inserted = await queryOne<{ id: string }>(
          client,
          `INSERT INTO tip_entries (
             business_date, amount, store_id, payment_method_id,
             responsible_id, updated_at
           ) VALUES ($1::date, $2, $3, $4, $5, $6) RETURNING id`,
          [
            entry.date,
            entry.amount,
            store.id,
            entry.method,
            supervisor.id,
            now,
          ],
        );
        entryIds.push(inserted.id);
      }

      const agreement = await queryOne<{ id: string }>(
        client,
        `INSERT INTO tip_agreements (
           name, rule, valid_from, store_id, created_by_id, updated_at
         ) VALUES ($1, 'PROPORTIONAL_TO_HOURS', $2::date, $3, $4, $5)
         RETURNING id`,
        [
          'Pacto proporcional legado',
          '2026-01-01',
          store.id,
          supervisor.id,
          now,
        ],
      );
      ids.agreement = agreement.id;

      const pools: ReadonlyArray<{
        key: string;
        start: string;
        end: string;
        hours: string;
        amount: string;
        entryId: string;
        status: 'DRAFT' | 'CONFIRMED' | 'PAID';
      }> = [
        {
          key: 'draft',
          start: '2026-03-01',
          end: '2026-03-31',
          hours: '10',
          amount: '8000',
          entryId: entryIds[0] ?? '',
          status: 'DRAFT',
        },
        {
          key: 'confirmed',
          start: '2026-04-01',
          end: '2026-04-30',
          hours: '20',
          amount: '4000',
          entryId: entryIds[1] ?? '',
          status: 'CONFIRMED',
        },
        {
          key: 'paid',
          start: '2026-05-01',
          end: '2026-05-31',
          hours: '40',
          amount: '4000',
          entryId: entryIds[2] ?? '',
          status: 'PAID',
        },
      ];
      for (const pool of pools) {
        // Se siembra en DRAFT y la foto (línea y fuente) se inserta antes de
        // subir el estado: los hijos solo cambian en DRAFT.
        const inserted = await queryOne<{ id: string }>(
          client,
          `INSERT INTO tip_pools (
             period_start, period_end, total_amount, store_id,
             calculated_by_id, agreement_id, status, calculated_at,
             version, updated_at
           ) VALUES ($1::date, $2::date, $3, $4, $5, $6, 'DRAFT', $7, 1, $7)
           RETURNING id`,
          [
            pool.start,
            pool.end,
            pool.amount,
            store.id,
            supervisor.id,
            agreement.id,
            now,
          ],
        );
        ids[pool.key] = inserted.id;
        await client.query(
          `INSERT INTO tip_pool_lines (hours_worked, amount, pool_id, user_id)
           VALUES ($1, $2, $3, $4)`,
          [pool.hours, pool.amount, inserted.id, worker.id],
        );
        await client.query(
          `INSERT INTO tip_pool_sources (amount, pool_id, tip_entry_id)
           VALUES ($1, $2, $3)`,
          [pool.amount, inserted.id, pool.entryId],
        );
        if (pool.status === 'CONFIRMED' || pool.status === 'PAID') {
          await client.query(
            `UPDATE tip_pools SET status = 'CONFIRMED', confirmed_at = $2,
               confirmed_by_id = $3 WHERE id = $1`,
            [inserted.id, now, supervisor.id],
          );
        }
        if (pool.status === 'PAID') {
          await client.query(
            `UPDATE tip_pools SET status = 'PAID', paid_at = $2,
               paid_by_id = $3, payment_date = $4::date, version = 2
             WHERE id = $1`,
            [inserted.id, now, supervisor.id, pool.end],
          );
        }
      }

      // La constancia del reparto pagado copia su línea (horas incluidas).
      await client.query(
        `INSERT INTO tip_pool_receipts (
           worker_name, store_name, period_start, period_end, hours_worked,
           amount, payment_date, paid_by_name, detail, pool_id, user_id,
           store_id, paid_by_id
         ) VALUES ($1, $2, $3::date, $4::date, $5, $6, $7::date, $8, $9, $10,
                   $11, $12, $13)`,
        [
          'Trabajador Migracion',
          'Local Migracion T02',
          '2026-05-01',
          '2026-05-31',
          '40',
          '4000',
          '2026-05-31',
          'Supervisor Migracion',
          '{}',
          ids.paid,
          worker.id,
          store.id,
          supervisor.id,
        ],
      );

      // Operación diaria de T01: solo efectivo, sin voucher.
      const operation = await queryOne<{ id: string }>(
        client,
        `INSERT INTO daily_operations (
           business_date, card_tip_amount, cash_tip_amount, tip_fund_amount,
           cash_difference, store_id, responsible_id, updated_at
         ) VALUES ($1::date, 0, 36102, 36102, 0, $2, $3, $4) RETURNING id`,
        ['2026-03-10', store.id, supervisor.id, now],
      );
      ids.operation = operation.id;
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

    it('conserva los valores históricos: horas y montos no se reinterpretan', async () => {
      const client = db();

      // Las horas de las líneas legadas quedan exactamente igual.
      const expected: Record<string, string> = {
        [ids.draft ?? '']: '10.00',
        [ids.confirmed ?? '']: '20.00',
        [ids.paid ?? '']: '40.00',
      };
      for (const [poolId, hours] of Object.entries(expected)) {
        const line = await queryOne<HoursRow>(
          client,
          `SELECT hours_worked::text AS hours_worked
           FROM tip_pool_lines WHERE pool_id = $1`,
          [poolId],
        );
        expect(line.hours_worked).toBe(hours);
      }

      // La constancia legada conserva sus horas y montos.
      const receipt = await queryOne<HoursRow>(
        client,
        `SELECT hours_worked::text AS hours_worked
         FROM tip_pool_receipts WHERE pool_id = $1`,
        [ids.paid],
      );
      expect(receipt.hours_worked).toBe('40.00');

      // No quedan filas residuales en las tablas nuevas.
      const participants = await queryOne<CountRow>(
        client,
        `SELECT COUNT(*)::int AS total FROM daily_operation_participants`,
        [],
      );
      expect(participants.total).toBe(0);
      const sources = await queryOne<CountRow>(
        client,
        `SELECT COUNT(*)::int AS total FROM tip_pool_daily_operation_sources`,
        [],
      );
      expect(sources.total).toBe(0);
    });

    it('amplía el enum con la regla equitativa y deja NULLable las horas sin reescribir filas', async () => {
      const client = db();

      const labels = await client.query<EnumRow>(
        `SELECT e.enumlabel AS label
         FROM pg_enum AS e
         INNER JOIN pg_type AS t ON t.oid = e.enumtypid
         WHERE t.typname = 'TipAgreementRule'
         ORDER BY e.enumsortorder`,
      );
      expect(labels.rows.map((row) => row.label)).toEqual([
        'PROPORTIONAL_TO_HOURS',
        'EQUAL_SHARES',
      ]);

      for (const table of ['tip_pool_lines', 'tip_pool_receipts']) {
        const column = await queryOne<NullableRow>(
          client,
          `SELECT is_nullable FROM information_schema.columns
           WHERE table_name = $1 AND column_name = 'hours_worked'`,
          [table],
        );
        expect(column.is_nullable).toBe('YES');
      }
    });

    it('crea las tablas, índices únicos y triggers nuevos', async () => {
      const client = db();

      for (const table of [
        'daily_operation_participants',
        'tip_pool_daily_operation_sources',
      ]) {
        const found = await queryOne<CountRow>(
          client,
          `SELECT COUNT(*)::int AS total FROM pg_tables WHERE tablename = $1`,
          [table],
        );
        expect(found.total).toBe(1);
      }

      const triggers = await client.query<TriggerRow>(
        `SELECT tgname FROM pg_trigger
         WHERE tgname IN (
           'daily_operation_participants_validate_worker_rows',
           'daily_operation_participants_require_draft_pool_rows',
           'daily_operations_require_draft_pool_rows',
           'tip_pool_daily_operation_sources_enforce_rows',
           'tip_pool_lines_hours_consistent_rows',
           'tip_pool_receipts_hours_consistent_rows'
         )`,
      );
      expect(triggers.rows).toHaveLength(6);
    });

    it('deja intactos los triggers históricos del reparto', async () => {
      const client = db();

      // El reparto confirmado sigue siendo inmutable (trigger de T13).
      const mensaje = await expectReject(
        client,
        `UPDATE tip_pools SET total_amount = 1 WHERE id = $1`,
        [ids.confirmed],
      );
      expect(mensaje).toMatch(/reparto confirmado/);

      // Las líneas y fuentes históricas solo cambian en DRAFT.
      const lineas = await expectReject(
        client,
        `UPDATE tip_pool_lines SET amount = 1 WHERE pool_id = $1`,
        [ids.confirmed],
      );
      expect(lineas).toMatch(/ya no está en DRAFT/);

      // La constancia sigue siendo inmutable.
      const constancia = await expectReject(
        client,
        `UPDATE tip_pool_receipts SET amount = 1 WHERE pool_id = $1`,
        [ids.paid],
      );
      expect(constancia).toMatch(/inmutables/);

      // La línea proporcional sigue exigiendo horas tras la migración.
      const sinHoras = await expectReject(
        client,
        `INSERT INTO tip_pool_lines (pool_id, user_id, hours_worked, amount)
         VALUES ($1, $2, NULL, 100)`,
        [ids.draft, ids.worker],
      );
      expect(sinHoras).toMatch(/requiere horas trabajadas/);
    });

    it('valida participantes en la base migrada y conserva el historial en bajas lógicas', async () => {
      const client = db();

      // Trabajador activo del local: ok.
      await client.query(
        `INSERT INTO daily_operation_participants (operation_id, worker_id)
         VALUES ($1, $2)`,
        [ids.operation, ids.worker],
      );

      // Duplicado: rechazado.
      const duplicado = await expectReject(
        client,
        `INSERT INTO daily_operation_participants (operation_id, worker_id)
         VALUES ($1, $2)`,
        [ids.operation, ids.worker],
      );
      expect(duplicado).toMatch(/operation_id_worker_id/);

      // El supervisor (rol distinto): rechazado.
      const supervisorRechazado = await expectReject(
        client,
        `INSERT INTO daily_operation_participants (operation_id, worker_id)
         VALUES ($1, $2)`,
        [ids.operation, ids.supervisor],
      );
      expect(supervisorRechazado).toMatch(/trabajador activo del local/);

      // Bajas lógicas posteriores no borran la selección.
      await client.query(`UPDATE users SET is_active = false WHERE id = $1`, [
        ids.worker,
      ]);
      const conservada = await queryOne<CountRow>(
        client,
        `SELECT COUNT(*)::int AS total
         FROM daily_operation_participants WHERE operation_id = $1`,
        [ids.operation],
      );
      expect(conservada.total).toBe(1);
      await client.query(`UPDATE users SET is_active = true WHERE id = $1`, [
        ids.worker,
      ]);
    });

    it('concilia la fuente diaria y bloquea correcciones con reparto cerrado', async () => {
      const client = db();

      // Nuevo reparto DRAFT del día de la operación legada.
      const pool = await queryOne<{ id: string }>(
        client,
        `INSERT INTO tip_pools (
           period_start, period_end, total_amount, store_id, calculated_by_id,
           agreement_id, calculated_at, version, updated_at
         ) VALUES ('2026-03-10'::date, '2026-03-10'::date, 36102, $1, $2, $3,
                   now(), 1, now()) RETURNING id`,
        [ids.store, ids.supervisor, ids.agreement],
      );

      // Monto distinto del fondo: rechazado.
      const noConcilia = await expectReject(
        client,
        `INSERT INTO tip_pool_daily_operation_sources
           (pool_id, operation_id, amount)
         VALUES ($1, $2, 36000)`,
        [pool.id, ids.operation],
      );
      expect(noConcilia).toMatch(/no concilia/);

      // Conciliación exacta: aceptado.
      await client.query(
        `INSERT INTO tip_pool_daily_operation_sources
           (pool_id, operation_id, amount)
         VALUES ($1, $2, 36102)`,
        [pool.id, ids.operation],
      );

      // Confirmar el reparto bloquea la corrección de montos de la operación.
      await client.query(
        `UPDATE tip_pools SET status = 'CONFIRMED', confirmed_at = now(),
           confirmed_by_id = $2 WHERE id = $1`,
        [pool.id, ids.supervisor],
      );
      const operacionBloqueada = await expectReject(
        client,
        `UPDATE daily_operations SET cash_tip_amount = 40000,
           tip_fund_amount = 40000 WHERE id = $1`,
        [ids.operation],
      );
      expect(operacionBloqueada).toMatch(/no se pueden corregir sus montos/);

      // Y también la modificación de la selección.
      const participanteBloqueado = await expectReject(
        client,
        `DELETE FROM daily_operation_participants
         WHERE operation_id = $1`,
        [ids.operation],
      );
      expect(participanteBloqueado).toMatch(/reparto confirmado o pagado/);
    });
  },
  120_000,
);
