// Autenticación sintética exclusiva del contenedor de pruebas, sin datos de producción.
import { createServer } from 'node:http';
const workerId = '30000000-0000-4000-8000-000000000217';
const roles = {
  'test-my-worker': 'TRABAJADOR',
  'test-my-other': 'TRABAJADOR',
  'test-my-admin': 'ADMINISTRADOR',
  'test-my-accountant': 'CONTADOR',
  'test-my-supervisor': 'SUPERVISOR',
};
const user = {
  id: workerId,
  email: 'trabajador@payslips.example.test',
  firstName: 'Trabajador',
  lastName: 'Prueba',
  role: 'TRABAJADOR',
  storeId: '40000000-0000-4000-8000-000000000217',
};
createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/auth/login' && request.method === 'POST') {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      response.writeHead(400);
      response.end('{}');
      return;
    }
    if (body.email !== user.email || body.password !== 'Payslips-test-2026!') {
      response.writeHead(401);
      response.end('{}');
      return;
    }
    response.end(
      JSON.stringify({
        accessToken: 'test-my-worker',
        refreshToken: 'test-my-refresh',
        expiresIn: 3600,
        tokenType: 'Bearer',
        user,
      }),
    );
    return;
  }
  const token = request.headers.authorization?.replace('Bearer ', '');
  if (!token || !roles[token]) {
    response.writeHead(401);
    response.end('{}');
    return;
  }
  if (url.pathname === '/auth/me') {
    response.end(
      JSON.stringify({
        ...user,
        id:
          token === 'test-my-other'
            ? '31000000-0000-4000-8000-000000000217'
            : workerId,
        role: roles[token],
      }),
    );
    return;
  }
  response.writeHead(404);
  response.end('{}');
}).listen(3148, '127.0.0.1', () =>
  console.log(
    'Autenticación de pruebas de liquidaciones personales: loopback:3148.',
  ),
);
