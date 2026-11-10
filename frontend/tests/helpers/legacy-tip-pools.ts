import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Repartos por período históricos para las pruebas con API real
// (SPRINT-4A-T08). Desde que la API ya no calcula, confirma ni paga
// repartos, los existentes se siembran directamente en la base exclusiva de
// la prueba, como los dejaba el flujo anterior: foto equitativa en DRAFT con
// sus líneas y, según el estado, las transiciones a CONFIRMED y PAID que
// exigen los triggers, con una constancia por línea al pagar.

export interface LegacyPoolSeed {
  storeId: string;
  periodStart: string;
  periodEnd: string;
  accountantId: string;
  status: 'DRAFT' | 'CONFIRMED' | 'PAID';
  // Fecha de pago (YYYY-MM-DD); por defecto el último día del período.
  paymentDate?: string;
  lines: { userId: string; amount: number }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Solo UUID, fechas y enteros validados llegan al SQL: no hay texto libre.
function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error('UUID inválido: ' + value);
  return `'${value}'::uuid`;
}
function date(value: string): string {
  if (!DATE.test(value)) throw new Error('Fecha inválida: ' + value);
  return `'${value}'::date`;
}
function amount(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Monto inválido: ' + value);
  return String(value);
}

function poolSql(id: string, seed: LegacyPoolSeed): string {
  const pool = uuid(id);
  const accountant = uuid(seed.accountantId);
  const total = seed.lines.reduce((sum, line) => sum + line.amount, 0);
  const statements = [
    `INSERT INTO tip_pools (id, store_id, period_start, period_end, total_amount, calculated_by_id, agreement_snapshot, updated_at) VALUES (${pool}, ${uuid(seed.storeId)}, ${date(seed.periodStart)}, ${date(seed.periodEnd)}, ${amount(total)}, ${accountant}, '{"rule":"EQUAL_SHARES"}'::jsonb, now());`,
    `INSERT INTO tip_pool_lines (pool_id, user_id, hours_worked, amount) VALUES ${seed.lines
      .map(
        (line) =>
          `(${pool}, ${uuid(line.userId)}, NULL, ${amount(line.amount)})`,
      )
      .join(', ')};`,
  ];
  if (seed.status === 'DRAFT') return statements.join('\n');
  statements.push(
    `UPDATE tip_pools SET status = 'CONFIRMED', confirmed_at = now(), confirmed_by_id = ${accountant}, version = version + 1 WHERE id = ${pool};`,
  );
  if (seed.status === 'CONFIRMED') return statements.join('\n');
  statements.push(
    `UPDATE tip_pools SET status = 'PAID', paid_at = now(), paid_by_id = ${accountant}, payment_date = ${date(seed.paymentDate ?? seed.periodEnd)}, version = version + 1 WHERE id = ${pool};`,
    `INSERT INTO tip_pool_receipts (pool_id, user_id, worker_name, store_id, store_name, period_start, period_end, hours_worked, amount, payment_date, paid_by_id, paid_by_name, detail)
     SELECT p.id, l.user_id, u.first_name || ' ' || u.last_name, p.store_id, s.name, p.period_start, p.period_end, NULL, l.amount, p.payment_date, p.paid_by_id, a.first_name || ' ' || a.last_name,
       jsonb_build_object('rule', 'EQUAL_SHARES', 'agreementSnapshot', NULL, 'totalAmount', p.total_amount::int, 'totalHours', NULL,
         'lines', (SELECT jsonb_agg(jsonb_build_object('userId', x.user_id, 'workerName', y.first_name || ' ' || y.last_name, 'hoursWorked', NULL, 'amount', x.amount::int) ORDER BY x.user_id)
                   FROM tip_pool_lines x JOIN users y ON y.id = x.user_id WHERE x.pool_id = p.id))
     FROM tip_pools p
     JOIN tip_pool_lines l ON l.pool_id = p.id
     JOIN users u ON u.id = l.user_id
     JOIN users a ON a.id = p.paid_by_id
     JOIN stores s ON s.id = p.store_id
     WHERE p.id = ${pool};`,
  );
  return statements.join('\n');
}

// Siembra los repartos en una sola transacción y devuelve sus ID en orden.
export function seedLegacyPools(
  composeProject: string,
  seeds: readonly LegacyPoolSeed[],
): string[] {
  const ids = seeds.map(() => randomUUID());
  const sql = [
    'BEGIN;',
    ...seeds.map((seed, index) => poolSql(ids[index], seed)),
    'COMMIT;',
  ].join('\n');
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      '../docker-compose.yml',
      '-p',
      composeProject,
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1',
    ],
    { input: sql, encoding: 'utf8', timeout: 30000 },
  );
  return ids;
}
