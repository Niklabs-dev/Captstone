// SPRINT-4A-T12: levanta un stack Docker EXCLUSIVO (proyecto y puertos
// propios, sin tocar el stack de desarrollo), ejecuta el recorrido de la
// sección de ventas con el Excel real y lo elimina con sus volúmenes.
//
//   MRCOMANDA_SAMPLE_XLSX=/ruta/ventas-06-11-2026.xlsx npm run test:sales-section:real
//
// El archivo real nunca se copia al repositorio: se lee desde la ruta dada.
// Variables opcionales: SALES_SECTION_PROJECT (moifood-sales-section),
// SALES_SECTION_FRONTEND_PORT (3612), SALES_SECTION_BACKEND_PORT (3611),
// SALES_SECTION_DB_PORT (55612) y KEEP_STACK=true para conservarlo al final.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const sample = process.env.MRCOMANDA_SAMPLE_XLSX;
if (!sample || !existsSync(sample))
  throw new Error(
    'Define MRCOMANDA_SAMPLE_XLSX con la ruta del Informe de Ventas Diario real.',
  );
const samplePath = isAbsolute(sample) ? sample : resolve(sample);
const project = process.env.SALES_SECTION_PROJECT ?? 'moifood-sales-section';
const frontendPort = process.env.SALES_SECTION_FRONTEND_PORT ?? '3612';
const backendPort = process.env.SALES_SECTION_BACKEND_PORT ?? '3611';
const dbPort = process.env.SALES_SECTION_DB_PORT ?? '55612';
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const backendUrl = `http://127.0.0.1:${backendPort}`;

// Puertos propios en un archivo temporal fuera del repositorio (el
// docker-compose.override.yml del repo publica 3000/3001/5433).
const folder = await mkdtemp(join(tmpdir(), 'moifood-sales-section-'));
const ports = join(folder, 'ports.yml');
await writeFile(
  ports,
  [
    'services:',
    '  db:',
    `    ports: ["127.0.0.1:${dbPort}:5432"]`,
    '  backend:',
    `    ports: ["127.0.0.1:${backendPort}:3001"]`,
    '  frontend:',
    `    ports: ["127.0.0.1:${frontendPort}:3000"]`,
    '',
  ].join('\n'),
);
const compose = ['compose', '-p', project, '-f', '../docker-compose.yml'];

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  return result.status ?? 1;
}
async function waitFor(url) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Todavía no responde: se reintenta.
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`${url} no respondió a tiempo.`);
}

let status = 1;
try {
  if (run('docker', [...compose, '-f', ports, 'up', '--build', '-d']) !== 0)
    throw new Error('No se pudo levantar el stack de pruebas.');
  await waitFor(backendUrl + '/');
  await waitFor(frontendUrl + '/login');
  status = run(
    'npx',
    [
      'playwright',
      'test',
      '--config',
      'playwright.sales-section.config.ts',
      ...process.argv.slice(2),
    ],
    {
      ...process.env,
      TEST_REAL_DISPOSABLE: 'true',
      TEST_REAL_FRONTEND_URL: frontendUrl,
      TEST_REAL_BACKEND_URL: backendUrl,
      COMPOSE_PROJECT_NAME: project,
      MRCOMANDA_SAMPLE_XLSX: samplePath,
    },
  );
} finally {
  if (process.env.KEEP_STACK !== 'true')
    run('docker', [...compose, '-f', ports, 'down', '-v', '--rmi', 'local']);
  await rm(folder, { recursive: true, force: true });
}
process.exit(status);
