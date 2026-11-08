// Prepara la carpeta de almacenamiento de las pruebas contra la API real
// (SPRINT-4R-T19). docker-compose.test.yml la monta en el backend y Playwright
// altera o retira archivos dentro de ella para probar ALTERED y MISSING.
//
// Para que eso funcione sin EACCES y sin abrir permisos (nunca chmod 0777):
// - La carpeta la crea quien ejecuta las pruebas, no Docker: si la creara
//   Docker quedaría a nombre de root y el backend no podría escribir en ella.
// - Queda privada (0700) y a nombre de ese usuario.
// - El backend corre con el mismo UID/GID (CI_UID/CI_GID en
//   docker-compose.test.yml), así que los archivos que guarda (0600) también
//   quedan a su nombre y Playwright puede modificarlos.
// En Linux y macOS además verifica que CI_UID/CI_GID coincidan con el usuario
// actual y explica cómo corregirlo. En Windows (Docker Desktop) los dueños de
// archivo no se aplican a los bind mounts, así que solo crea la carpeta y
// prueba la escritura.
import { chmod, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const storage = path.join(frontendRoot, 'output', 'real-api', 'storage');

function fail(message) {
  console.error(`prepare-real-storage: ${message}`);
  process.exit(1);
}

await mkdir(storage, { recursive: true, mode: 0o700 });

if (process.platform !== 'win32') {
  const uid = process.getuid();
  const gid = process.getgid();
  const info = await stat(storage);
  if (info.uid !== uid) {
    fail(
      `${storage} pertenece al UID ${info.uid} y no al usuario actual (${uid}). ` +
        'Probablemente la creó Docker como root: elimínala (su contenido es ' +
        'sintético) y vuelve a ejecutar este script antes de docker compose.',
    );
  }
  // Privada aunque una ejecución anterior la hubiera dejado más abierta.
  await chmod(storage, 0o700);

  const expected = { CI_UID: String(uid), CI_GID: String(gid) };
  for (const [name, value] of Object.entries(expected)) {
    if (process.env[name] !== value) {
      fail(
        `${name} es «${process.env[name] ?? '(sin definir)'}» y debe ser ${value} ` +
          'para que el backend guarde archivos a tu nombre. Ejecuta: ' +
          'export CI_UID="$(id -u)" CI_GID="$(id -g)"',
      );
    }
  }
}

// Prueba de escritura con los mismos permisos que usa el backend.
const probe = path.join(storage, `.prepare-probe-${process.pid}`);
try {
  await writeFile(probe, 'ok', { mode: 0o600 });
} catch (error) {
  fail(`no se pudo escribir en ${storage}: ${String(error)}`);
} finally {
  await rm(probe, { force: true });
}

console.log(
  process.platform === 'win32'
    ? `Almacenamiento de pruebas listo en ${storage} (Windows: sin control de UID).`
    : `Almacenamiento de pruebas listo en ${storage} (0700, UID ${process.getuid()}).`,
);
