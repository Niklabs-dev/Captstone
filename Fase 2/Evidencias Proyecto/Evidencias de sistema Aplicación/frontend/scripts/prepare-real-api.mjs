// Datos sintéticos para una base exclusiva; requiere las migraciones y el seed reales.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const backendRequire = createRequire(
  new URL('../../backend/package.json', import.meta.url),
);
const { Client } = backendRequire('pg');
const bcrypt = backendRequire('bcryptjs');
if (process.env.TEST_REAL_DISPOSABLE !== 'true' || !process.env.DATABASE_URL)
  throw new Error(
    'Configura TEST_REAL_DISPOSABLE=true y DATABASE_URL de una base exclusiva.',
  );
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const store = '66000000-0000-4000-8000-000000000220';
  await client.query(
    `INSERT INTO stores (id,name,city,address,updated_at) VALUES ($1,'Local integración','Melipilla','Dirección sintética',now()) ON CONFLICT (id) DO NOTHING`,
    [store],
  );
  const hash = await bcrypt.hash('Integration-test-2026!', 12);
  const fixtures = { store };
  for (const [key, role] of [
    ['worker', 'TRABAJADOR'],
    ['other', 'TRABAJADOR'],
    ['supervisor', 'SUPERVISOR'],
    ['accountant', 'CONTADOR'],
  ]) {
    const email = `${key}@integration.example.test`;
    const result = await client.query(
      `INSERT INTO users (email,password_hash,first_name,last_name,role_id,store_id,updated_at) SELECT $1,$2,$3,'Integración',id,$4,now() FROM roles WHERE code=$5 ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash RETURNING id`,
      [email, hash, key, role === 'CONTADOR' ? null : store, role],
    );
    fixtures[key] = { id: result.rows[0].id, email };
  }
  await mkdir('output/real-api', { recursive: true });
  await writeFile(
    'output/real-api/fixtures.json',
    JSON.stringify(fixtures, null, 2),
  );
  console.log('Datos sintéticos de integración preparados.');
} finally {
  await client.end();
}
