// Servicio de autenticación exclusivo del contenedor de pruebas; nunca se inicia en producción.
import { createServer } from 'node:http';
const roles = {
  'test-payroll-accountant': 'CONTADOR',
  'test-payroll-admin': 'ADMINISTRADOR',
  'test-payroll-supervisor': 'SUPERVISOR',
  'test-payroll-worker': 'TRABAJADOR',
};
const user = {
  id: 'a0000000-0000-4000-8000-000000000216',
  email: 'contador@payroll.example.test',
  firstName: 'Contador',
  lastName: 'Prueba',
  role: 'CONTADOR',
  storeId: null,
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
    if (body.email !== user.email || body.password !== 'Payroll-test-2026!') {
      response.writeHead(401);
      response.end('{}');
      return;
    }
    response.end(
      JSON.stringify({
        accessToken: 'test-payroll-accountant',
        refreshToken: 'test-payroll-refresh',
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
    response.end(JSON.stringify({ ...user, role: roles[token] }));
    return;
  }
  if (url.pathname === '/payroll' && request.method === 'GET') {
    response.end(JSON.stringify({ items: [], workers: [], policy: { maxBytes: 26214400, allowedMimes: ['application/pdf'], canUpload: roles[token] === 'CONTADOR' } }));
    return;
  }
  response.writeHead(404);
  response.end('{}');
}).listen(3147, '127.0.0.1', () =>
  console.log('Autenticación de prueba payroll: loopback:3147.'),
);
