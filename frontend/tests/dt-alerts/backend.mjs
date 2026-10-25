// Autenticación y usuarios simulados exclusivamente para el contenedor de pruebas.
import { createServer } from 'node:http';
const adminId = 'a0000000-0000-4000-8000-000000000211';
const roles = {
  'test-dt-admin': 'ADMINISTRADOR',
  'test-dt-inactive': 'ADMINISTRADOR',
  'test-dt-worker': 'TRABAJADOR',
  'test-dt-supervisor': 'SUPERVISOR',
  'test-dt-accountant': 'CONTADOR',
};
const admin = {
  id: adminId,
  email: 'admin@dt.example.test',
  firstName: 'Administrador',
  lastName: 'Prueba',
  role: { code: 'ADMINISTRADOR', name: 'Administrador' },
  store: null,
  isActive: true,
  createdAt: '2026-10-14T12:00:00Z',
};
createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  const token = request.headers.authorization?.replace('Bearer ', '');
  if (url.pathname === '/auth/login' && request.method === 'POST') {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      response.writeHead(400);
      response.end('{}');
      return;
    }
    if (input.email !== admin.email || input.password !== 'Dt-test-2026!') {
      response.writeHead(401);
      response.end('{}');
      return;
    }
    response.end(
      JSON.stringify({
        accessToken: 'test-dt-admin',
        refreshToken: 'test-dt-refresh',
        expiresIn: 3600,
        tokenType: 'Bearer',
        user: { ...admin, role: 'ADMINISTRADOR', storeId: null },
      }),
    );
    return;
  }
  if (!token || !roles[token]) {
    response.writeHead(401);
    response.end('{}');
    return;
  }
  if (url.pathname === '/auth/me') {
    response.end(
      JSON.stringify({
        id:
          token === 'test-dt-inactive'
            ? 'a1000000-0000-4000-8000-000000000211'
            : adminId,
        email: admin.email,
        role: roles[token],
        storeId: null,
      }),
    );
    return;
  }
  if (url.pathname === '/users') {
    if (roles[token] !== 'ADMINISTRADOR') {
      response.writeHead(403);
      response.end('{}');
      return;
    }
    response.end(JSON.stringify([admin]));
    return;
  }
  if (url.pathname === '/stores' && request.method === 'GET') {
    response.end(JSON.stringify([
      {id:'40000000-0000-4000-8000-000000000211',name:'Local de prueba Centro'},
      {id:'41000000-0000-4000-8000-000000000211',name:'Local de prueba Norte'},
    ].map(store => ({...store,city:'Melipilla',address:'Av. Prueba 325',isActive:true,createdAt:'2026-10-24T12:00:00Z',updatedAt:'2026-10-24T12:00:00Z'}))));
    return;
  }
  if (url.pathname === '/dt-alerts' && request.method === 'GET') {
    response.end(JSON.stringify({ items: [], calculatedAt: new Date().toISOString() }));
    return;
  }
  response.writeHead(404);
  response.end('{}');
}).listen(3146, '127.0.0.1', () =>
  console.log('Backend de prueba DT en loopback:3146.'),
);
