// Regresión transversal sobre una base exclusiva; cada suite conserva sus fixtures.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
if (process.env.TEST_REAL_DISPOSABLE !== 'true' || !process.env.DATABASE_URL)
  throw new Error(
    'Requiere TEST_REAL_DISPOSABLE=true y DATABASE_URL de pruebas.',
  );
const execute = (args, env = process.env) => {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
execute(['scripts/prepare-real-api.mjs']);
const fixtures = JSON.parse(
  await readFile('output/real-api/fixtures.json', 'utf8'),
);
await mkdir('output/ci', { recursive: true });
const env = {
  ...process.env,
  TEST_NAVIGATION_DISPOSABLE: 'true',
  TEST_NAVIGATION_FRONTEND_URL: process.env.TEST_REAL_FRONTEND_URL,
  TEST_NAVIGATION_BACKEND_URL: process.env.TEST_REAL_BACKEND_URL,
  TEST_NAVIGATION_ADMIN_EMAIL:
    process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
  TEST_NAVIGATION_ADMIN_PASSWORD: process.env.TEST_REAL_ADMIN_PASSWORD,
  TEST_NAVIGATION_STORE_ID: fixtures.store,
};
for (const suite of [
  'navigation',
  'user-management',
  'real-api',
  'stores',
  'my-documents',
  'tips',
  'tip-pools',
  'my-tip-receipts',
]) {
  execute(
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.' + suite + '.config.ts',
      '--reporter=line,junit',
    ],
    {
      ...env,
      PLAYWRIGHT_JUNIT_OUTPUT_FILE: 'output/ci/responsive-' + suite + '.xml',
    },
  );
}
