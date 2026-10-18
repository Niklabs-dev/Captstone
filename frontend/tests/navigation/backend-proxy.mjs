// Proxy exclusivo de pruebas: NestJS real salvo fallos/latencia activados por el runner.
// Se ejecuta en un contenedor separado; no forma parte del servidor de producción.
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const upstream = new URL(
  process.env.TEST_PROXY_UPSTREAM ?? 'http://backend:3001',
);
const state = {
  usersUnavailable: false,
  auditDelayMs: 0,
  backendUnavailable: false,
};

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new Error('Cuerpo de pruebas demasiado grande.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

const server = createServer(async (request, response) => {
  try {
    if (!request.url?.startsWith('/') || request.url.startsWith('//')) {
      json(response, 400, { message: 'Ruta de pruebas inválida.' });
      return;
    }
    const target = new URL(request.url, upstream);
    if (target.pathname === '/__test/state') {
      if (request.method !== 'POST') {
        json(response, 405, { message: 'Método no permitido.' });
        return;
      }
      const value = JSON.parse((await readBody(request)).toString('utf8'));
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some(
          (key) =>
            ![
              'usersUnavailable',
              'auditDelayMs',
              'backendUnavailable',
            ].includes(key),
        ) ||
        ('usersUnavailable' in value &&
          typeof value.usersUnavailable !== 'boolean') ||
        ('backendUnavailable' in value &&
          typeof value.backendUnavailable !== 'boolean') ||
        ('auditDelayMs' in value &&
          (!Number.isInteger(value.auditDelayMs) ||
            value.auditDelayMs < 0 ||
            value.auditDelayMs > 10000))
      ) {
        json(response, 400, { message: 'Estado de pruebas inválido.' });
        return;
      }
      Object.assign(state, value);
      json(response, 200, state);
      return;
    }
    if (target.pathname.startsWith('/__test/')) {
      json(response, 404, { message: 'Ruta de pruebas inexistente.' });
      return;
    }
    if (state.backendUnavailable) {
      json(response, 503, {
        message: 'Caída del backend simulada para revisión.',
      });
      return;
    }
    if (
      request.method === 'GET' &&
      target.pathname === '/users' &&
      state.usersUnavailable
    ) {
      json(response, 503, {
        message: 'Fallo de usuarios simulado para revisión.',
      });
      return;
    }
    if (
      request.method === 'GET' &&
      target.pathname === '/audit-logs' &&
      state.auditDelayMs
    )
      await delay(state.auditDelayMs);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (
        value !== undefined &&
        !['host', 'connection', 'content-length', 'transfer-encoding'].includes(
          name,
        )
      )
        headers.set(name, Array.isArray(value) ? value.join(',') : value);
    }
    const result = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method ?? '')
        ? undefined
        : await readBody(request),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    response.writeHead(result.status, {
      'Content-Type': result.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    if (!response.headersSent)
      json(response, 502, {
        message: 'No se pudo completar la petición de pruebas.',
      });
    else response.end();
  }
});

server.listen(3149, '0.0.0.0', () =>
  console.log('Proxy de pruebas listo en 3149.'),
);
