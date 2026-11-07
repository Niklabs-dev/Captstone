import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type QueryResultRow } from 'pg';

// Prueba del backfill real de la migración
// 20261105021500_medios_pago_catalogo (SPRINT-4-T32). No usa Prisma Migrate:
// crea una base temporal con nombre único, aplica a mano (en orden) los SQL
// de todas las migraciones anteriores, inserta datos legados (incluido un
// cierre CLOSED con líneas y vouchers, ventas reconciliadas y un registro de
// propinas), ejecuta la migración bajo prueba y verifica: catálogo sembrado,
// backfill de los tres FKs por el texto del enum, retiro del enum, triggers
// conservados (inmutabilidad de cierres CLOSED, reconciliación venta–registro
// con los nuevos FKs), CHECK de origen/período de ventas y conciliación de
// vouchers MrComanda solo con medios RECONCILABLE_CARD (los vouchers sin
// clasificar conservan la suma heredada). Se omite sin TEST_DATABASE_URL y
// siempre elimina solo la base temporal que creó.
const databaseUrl = process.env.TEST_DATABASE_URL;

// Migraciones previas a la de medios de pago, en el orden en que Prisma las
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
];

const T32_MIGRATION = '20261105021500_medios_pago_catalogo';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'prisma',
  'migrations',
);

interface CountRow {
  total: number;
}

interface CatalogRow {
  code: string;
  behavior: string;
  available_for_tips: boolean;
}

interface MethodIdRow {
  id: string;
}

interface TypeRow {
  typname: string;
}

interface UnmappedRow {
  unmapped: number;
}

interface BackfillRow {
  code: string;
  filas: number;
}

interface ClosingRow {
  status: string;
  mrcomanda_net_sales: number;
  mercado_pago_gross_amount: number;
  mercado_pago_tip_amount: number;
  reconciliation_difference: number;
}

interface TriggerRow {
  tgname: string;
}

describe.skipIf(!databaseUrl)(
  'Migración de medios de pago: catálogo, backfill y conciliación (SPRINT-4-T32)',
  () => {
    let adminClient: Client | undefined;
    let migrationClient: Client | undefined;
    let tempDatabaseName = '';
    let storeId = '';
    let workerId = '';
    let closedClosingId = '';

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
      tempDatabaseName = `medios_pago_backfill_${Date.now()}_${randomUUID()
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
      await applyMigration(migrationClient, T32_MIGRATION);
    }, 180_000);

    // Datos legados mínimos sobre el esquema pre-T32: un local, un rol y un
    // trabajador sintéticos; un cierre CLOSED con dos líneas y dos vouchers;
    // ventas de tres medios (una reconciliada con el registro diario de
    // propinas del día) para ejercitar el backfill sobre históricos.
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
          'Local Backfill Migracion Medios',
          'Melipilla',
          'Calle sintética 789',
          now,
        ],
      );
      storeId = store.id;
      const worker = await queryOne<{ id: string }>(
        client,
        `INSERT INTO users (
           email, password_hash, first_name, last_name, role_id, store_id,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          'trabajador.backfill@medios-migration-test.invalid',
          'hash-sintetico',
          'Trabajador',
          'Backfill',
          role.id,
          store.id,
          now,
        ],
      );
      workerId = worker.id;

      // Cierre histórico (se cierra después de cargar sus ventas, líneas y
      // vouchers): MrComanda 50.000 netos, Mercado Pago 63.000 brutos con
      // 3.062 de propina → diferencia de conciliación 9.938 (motivo obligatorio).
      const closing = await queryOne<{ id: string }>(
        client,
        `INSERT INTO cash_closings (
           business_date, shift, opening_cash, status, store_id,
           responsible_id, created_at, updated_at
         ) VALUES ($1, 1, 50000, 'OPEN', $2, $3, $4, $4) RETURNING id`,
        ['2026-10-15', store.id, worker.id, now],
      );
      closedClosingId = closing.id;

      await client.query(
        `INSERT INTO cash_closing_lines (
           payment_method, expected_amount, counted_amount, difference,
           closing_id
         ) VALUES
           ('CASH', 150000, 150000, 0, $1),
           ('DEBIT_CARD', 140000, 140000, 0, $1)`,
        [closing.id],
      );
      await client.query(
        `INSERT INTO cash_closing_vouchers (
           source, period_start, period_end, amount, tip_included_amount,
           closing_id
         ) VALUES
           ('MRCOMANDA', $2, $3, 50000, 0, $1),
           ('MERCADO_PAGO', $2, $3, 63000, 3062, $1)`,
        [closing.id, '2026-10-15T10:00:00-03:00', '2026-10-15T14:00:00-03:00'],
      );

      // Ventas del día del cierre (el mediodía en hora de Chile deja la fecha
      // local inequívoca): efectivo y débito asociadas al cierre, y una
      // transferencia fuera de cualquier cierre.
      await client.query(
        `INSERT INTO sales (
           sold_at, payment_method, channel, gross_amount, tip_amount,
           store_id, cash_closing_id, registered_by_id
         ) VALUES
           ($1, 'CASH', 'IN_STORE', 100000, 0, $2, $3, $4),
           ($1, 'DEBIT_CARD', 'IN_STORE', 140000, 1000, $2, $3, $4),
           ($1, 'TRANSFER', 'IN_STORE', 75000, 0, $2, NULL, $4)`,
        ['2026-10-15T12:00:00-03:00', store.id, closing.id, worker.id],
      );

      // Registro diario de propinas del débito: reconcilia la venta con
      // propina (restricción local/medio/día exigida por el trigger legacy).
      await client.query(
        `INSERT INTO tip_entries (
           business_date, payment_method, amount, store_id, responsible_id,
           created_at, updated_at
         ) VALUES ($1, 'DEBIT_CARD', 1000, $2, $3, $4, $4)`,
        ['2026-10-15', store.id, worker.id, now],
      );
      await client.query(
        `UPDATE sales SET tip_entry_id = e.id
         FROM tip_entries AS e
         WHERE e.store_id = sales.store_id
           AND e.payment_method = sales.payment_method
           AND e.business_date = (sales.sold_at AT TIME ZONE 'America/Santiago')::date
           AND sales.tip_amount > 0`,
      );

      // Cierre histórico: la transición a CLOSED valida los totales contra
      // los vouchers (regla heredada pre-T32).
      await client.query(
        `UPDATE cash_closings
         SET status = 'CLOSED',
             closed_at = $2,
             closed_by_id = $3,
             mrcomanda_net_sales = 50000,
             mercado_pago_gross_amount = 63000,
             mercado_pago_tip_amount = 3062,
             reconciliation_difference = 9938,
             difference_reason = 'Cierre histórico con diferencia de conciliación'
         WHERE id = $1`,
        [closing.id, now, worker.id],
      );
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

    it('siembra el catálogo base y retira el enum PaymentMethod', async () => {
      const client = db();

      const catalogo = await client.query<CatalogRow>(
        `SELECT code, behavior::text AS behavior, available_for_tips
         FROM payment_methods
         ORDER BY sort_order`,
      );
      expect(catalogo.rows).toHaveLength(4);
      expect(catalogo.rows.map((m) => m.code)).toEqual([
        'CASH',
        'DEBIT_CARD',
        'CREDIT_CARD',
        'TRANSFER',
      ]);
      expect(catalogo.rows.map((m) => m.behavior)).toEqual([
        'CASH',
        'RECONCILABLE_CARD',
        'RECONCILABLE_CARD',
        'EXTERNAL_OTHER',
      ]);
      // Los cuatro medios iniciales aceptan propinas.
      expect(catalogo.rows.every((m) => m.available_for_tips)).toBe(true);

      // El enum queda reemplazado por PaymentMethodBehavior y SaleSource.
      const tipos = await client.query<TypeRow>(
        `SELECT typname
         FROM pg_type
         WHERE typname IN (
           'PaymentMethod', 'PaymentMethodBehavior', 'SaleSource'
         )`,
      );
      expect(tipos.rows.map((t) => t.typname).sort()).toEqual([
        'PaymentMethodBehavior',
        'SaleSource',
      ]);
    });

    it('transfiere ventas, propinas y líneas históricas al catálogo por código', async () => {
      const client = db();

      // Ninguna fila histórica quedó sin medio de pago mapeado.
      for (const tabla of ['sales', 'tip_entries', 'cash_closing_lines']) {
        const sinMapear = await queryOne<UnmappedRow>(
          client,
          `SELECT COUNT(*)::int AS unmapped FROM "${tabla}" WHERE payment_method_id IS NULL`,
          [],
        );
        expect(sinMapear.unmapped).toBe(0);
      }

      // Cada grupo histórico adoptó el catálogo que corresponde a su código.
      const ventas = await client.query<BackfillRow>(
        `SELECT m.code, COUNT(*)::int AS filas
         FROM sales AS s
         INNER JOIN payment_methods AS m ON m.id = s.payment_method_id
         GROUP BY m.code
         ORDER BY m.code`,
      );
      expect(ventas.rows).toEqual([
        { code: 'CASH', filas: 1 },
        { code: 'DEBIT_CARD', filas: 1 },
        { code: 'TRANSFER', filas: 1 },
      ]);

      const propinas = await queryOne<BackfillRow>(
        client,
        `SELECT m.code, COUNT(*)::int AS filas
         FROM tip_entries AS e
         INNER JOIN payment_methods AS m ON m.id = e.payment_method_id
         GROUP BY m.code`,
        [],
      );
      expect(propinas).toEqual({ code: 'DEBIT_CARD', filas: 1 });

      const lineas = await client.query<BackfillRow>(
        `SELECT m.code, COUNT(*)::int AS filas
         FROM cash_closing_lines AS l
         INNER JOIN payment_methods AS m ON m.id = l.payment_method_id
         GROUP BY m.code
         ORDER BY m.code`,
      );
      expect(lineas.rows).toEqual([
        { code: 'CASH', filas: 1 },
        { code: 'DEBIT_CARD', filas: 1 },
      ]);

      // Las claves únicas quedaron recreadas sobre el FK del catálogo.
      const indices = await client.query<{ indexname: string }>(
        `SELECT indexname
         FROM pg_indexes
         WHERE indexname IN (
           'tip_entries_store_id_business_date_payment_method_id_key',
           'cash_closing_lines_closing_id_payment_method_id_key',
           'sales_store_id_payment_method_id_period_start_period_end_key'
         )`,
      );
      expect(indices.rows).toHaveLength(3);
    });

    it('conserva intactos los cierres CLOSED históricos tras el backfill', async () => {
      const client = db();

      const cierre = await queryOne<ClosingRow>(
        client,
        `SELECT status::text AS status,
                mrcomanda_net_sales::float AS mrcomanda_net_sales,
                mercado_pago_gross_amount::float AS mercado_pago_gross_amount,
                mercado_pago_tip_amount::float AS mercado_pago_tip_amount,
                reconciliation_difference::float AS reconciliation_difference
         FROM cash_closings
         WHERE id = $1`,
        [closedClosingId],
      );
      expect(cierre).toEqual({
        status: 'CLOSED',
        mrcomanda_net_sales: 50000,
        mercado_pago_gross_amount: 63000,
        mercado_pago_tip_amount: 3062,
        reconciliation_difference: 9938,
      });

      // La inmutabilidad del cierre CLOSED sigue vigente tras la migración.
      await expect(
        client.query(`UPDATE cash_closings SET notes = 'toque' WHERE id = $1`, [
          closedClosingId,
        ]),
      ).rejects.toThrow(/inmutable/);

      // Los vouchers históricos quedaron sin clasificación (NULL) y las
      // ventas del cierre no pueden modificarse.
      const vouchersSinClasificar = await queryOne<CountRow>(
        client,
        `SELECT COUNT(*)::int AS total
         FROM cash_closing_vouchers
         WHERE closing_id = $1 AND payment_method_id IS NULL`,
        [closedClosingId],
      );
      expect(vouchersSinClasificar.total).toBe(2);
      await expect(
        client.query(
          `UPDATE sales SET gross_amount = 1
           WHERE cash_closing_id = $1`,
          [closedClosingId],
        ),
      ).rejects.toThrow(/cerrado/);
    });

    it('reconcilia la venta solo con un registro del mismo local, medio y día (trigger actualizado)', async () => {
      const client = db();

      const debito = await queryOne<MethodIdRow>(
        client,
        `SELECT id FROM payment_methods WHERE code = 'DEBIT_CARD'`,
        [],
      );
      const efectivo = await queryOne<MethodIdRow>(
        client,
        `SELECT id FROM payment_methods WHERE code = 'CASH'`,
        [],
      );
      const entrada = await queryOne<MethodIdRow>(
        client,
        `SELECT id FROM tip_entries WHERE payment_method_id = $1`,
        [debito.id],
      );

      // Medio correcto: la venta se reconcilia con el registro diario.
      await expect(
        client.query(
          `INSERT INTO sales (
             sold_at, payment_method_id, gross_amount, tip_amount, store_id,
             registered_by_id, tip_entry_id
           ) VALUES ($1, $2, 12500, 1250, $3, $4, $5)`,
          [
            '2026-10-15T13:00:00-03:00',
            debito.id,
            storeId,
            workerId,
            entrada.id,
          ],
        ),
      ).resolves.toBeDefined();

      // Medio distinto: el trigger actualizado a los FKs rechaza la fila.
      await expect(
        client.query(
          `INSERT INTO sales (
             sold_at, payment_method_id, gross_amount, tip_amount, store_id,
             registered_by_id, tip_entry_id
           ) VALUES ($1, $2, 12500, 1250, $3, $4, $5)`,
          [
            '2026-10-15T13:00:00-03:00',
            efectivo.id,
            storeId,
            workerId,
            entrada.id,
          ],
        ),
      ).rejects.toThrow(/local, fecha y medio de pago/);
    });

    it('exige origen y período coherentes y totales MrComanda únicos por local, medio y período', async () => {
      const client = db();

      const debito = await queryOne<MethodIdRow>(
        client,
        `SELECT id FROM payment_methods WHERE code = 'DEBIT_CARD'`,
        [],
      );

      // MrComanda sin período: viola el CHECK de coherencia origen/período.
      await expect(
        client.query(
          `INSERT INTO sales (
             sold_at, payment_method_id, gross_amount, source, store_id,
             registered_by_id
           ) VALUES ($1, $2, 1000, 'MRCOMANDA', $3, $4)`,
          ['2026-10-16T12:00:00-03:00', debito.id, storeId, workerId],
        ),
      ).rejects.toThrow(/sales_source_period_consistency/);

      // MrComanda con propina: viola el CHECK (PROPINAS conserva su fuente).
      await expect(
        client.query(
          `INSERT INTO sales (
             sold_at, payment_method_id, gross_amount, tip_amount, source,
             period_start, period_end, store_id, registered_by_id
           ) VALUES ($1, $2, 1000, 100, 'MRCOMANDA', $3, $4, $5, $6)`,
          [
            '2026-10-16T12:00:00-03:00',
            debito.id,
            '2026-10-16T10:00:00-03:00',
            '2026-10-16T14:00:00-03:00',
            storeId,
            workerId,
          ],
        ),
      ).rejects.toThrow(/sales_mrcomanda_no_tip/);

      // Carga válida e idempotencia por local, medio y período.
      const carga = `INSERT INTO sales (
             sold_at, payment_method_id, gross_amount, source, period_start,
             period_end, store_id, registered_by_id
           ) VALUES ($1, $2, 125500, 'MRCOMANDA', $3, $4, $5, $6)`;
      const periodo = [
        '2026-10-16T12:00:00-03:00',
        debito.id,
        '2026-10-16T10:00:00-03:00',
        '2026-10-16T14:00:00-03:00',
        storeId,
        workerId,
      ];
      await expect(client.query(carga, periodo)).resolves.toBeDefined();
      await expect(client.query(carga, periodo)).rejects.toMatchObject({
        code: '23505',
      });
    });

    it('concilia mrcomanda_net_sales solo con vouchers MrComanda RECONCILABLE_CARD o sin clasificar', async () => {
      const client = db();

      const debito = await queryOne<MethodIdRow>(
        client,
        `SELECT id FROM payment_methods WHERE code = 'DEBIT_CARD'`,
        [],
      );
      const transferencia = await queryOne<MethodIdRow>(
        client,
        `SELECT id FROM payment_methods WHERE code = 'TRANSFER'`,
        [],
      );

      // Cierre nuevo: 20.000 débito (conciliable) + 10.000 transferencia
      // (fuera de la conciliación) + 5.000 sin clasificar (heredado) +
      // Mercado Pago 35.000 con 1.000 de propina. mrcomanda_net_sales debe
      // recibir solo 25.000.
      const cierre = await queryOne<{ id: string }>(
        client,
        `INSERT INTO cash_closings (
           business_date, shift, opening_cash, status, store_id,
           responsible_id, created_at, updated_at
         ) VALUES ('2026-10-16', 1, 50000, 'OPEN', $1, $2, $3, $3)
         RETURNING id`,
        [storeId, workerId, new Date()],
      );
      await client.query(
        `INSERT INTO cash_closing_vouchers (
           source, period_start, period_end, amount, tip_included_amount,
           payment_method_id, closing_id
         ) VALUES
           ('MRCOMANDA', $2, $3, 20000, 0, $4, $1),
           ('MRCOMANDA', $2, $3, 10000, 0, $5, $1),
           ('MRCOMANDA', $2, $3, 5000, 0, NULL, $1),
           ('MERCADO_PAGO', $2, $3, 35000, 1000, NULL, $1)`,
        [
          cierre.id,
          '2026-10-16T10:00:00-03:00',
          '2026-10-16T14:00:00-03:00',
          debito.id,
          transferencia.id,
        ],
      );

      // Total que incluiría la transferencia: la transición se rechaza.
      await expect(
        client.query(
          `UPDATE cash_closings
           SET status = 'CLOSED', closed_at = $2, closed_by_id = $3,
               mrcomanda_net_sales = 35000, mercado_pago_gross_amount = 35000,
               mercado_pago_tip_amount = 1000, reconciliation_difference = 0,
               difference_reason = 'Prueba de descarte'
           WHERE id = $1`,
          [cierre.id, new Date(), workerId],
        ),
      ).rejects.toThrow(/no coinciden con la suma de sus vouchers/);

      // Total correcto (solo conciliables + sin clasificar) con diferencia de
      // conciliación 9.000: cierra con motivo.
      await expect(
        client.query(
          `UPDATE cash_closings
           SET status = 'CLOSED', closed_at = $2, closed_by_id = $3,
               mrcomanda_net_sales = 25000, mercado_pago_gross_amount = 35000,
               mercado_pago_tip_amount = 1000, reconciliation_difference = 9000,
               difference_reason = 'Prueba de clasificación de vouchers'
           WHERE id = $1`,
          [cierre.id, new Date(), workerId],
        ),
      ).resolves.toBeDefined();
    });

    it('restaura los triggers retirados para el backfill', async () => {
      const client = db();

      const triggers = await client.query<TriggerRow>(
        `SELECT tgname
         FROM pg_trigger
         WHERE tgname IN (
           'sales_cash_closing_require_open',
           'sales_cash_closing_require_open_truncate',
           'cash_closing_lines_require_open',
           'cash_closing_lines_require_open_truncate',
           'sales_tip_entry_consistency'
         )
           AND NOT tgisinternal`,
      );
      expect(triggers.rows.map((t) => t.tgname).sort()).toEqual([
        'cash_closing_lines_require_open',
        'cash_closing_lines_require_open_truncate',
        'sales_cash_closing_require_open',
        'sales_cash_closing_require_open_truncate',
        'sales_tip_entry_consistency',
      ]);
    });
  },
  180_000,
);
