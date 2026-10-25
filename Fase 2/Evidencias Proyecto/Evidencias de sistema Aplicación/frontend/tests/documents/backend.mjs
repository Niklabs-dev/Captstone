// Backend simulado exclusivo de pruebas. No se inicia desde producción.
import { createServer } from 'node:http';

const adminId = 'a0000000-0000-4000-8000-000000000210';
const store = {
  id: '60000000-0000-4000-8000-000000000210',
  name: 'Local de prueba Centro',
};
const user = (
  id,
  firstName,
  lastName,
  email,
  role,
  assignedStore,
  isActive = true,
) => ({
  id,
  firstName,
  lastName,
  email,
  role: { code: role, name: role },
  store: assignedStore,
  isActive,
  rut: null,
  phone: null,
  hiredAt: null,
  createdAt: '2026-10-14T12:00:00Z',
});
const users = [
  user(
    adminId,
    'Administrador',
    'Prueba',
    'admin@documents.example.test',
    'ADMINISTRADOR',
    null,
  ),
  user(
    '10000000-0000-4000-8000-000000000210',
    'Camila',
    'Prueba',
    'camila@example.test',
    'TRABAJADOR',
    store,
  ),
  user(
    '11000000-0000-4000-8000-000000000210',
    'Diego',
    'Prueba',
    'diego@example.test',
    'TRABAJADOR',
    store,
    false,
  ),
  user(
    '12000000-0000-4000-8000-000000000210',
    'María',
    'Prueba',
    'maria@example.test',
    'SUPERVISOR',
    {
      id: '61000000-0000-4000-8000-000000000210',
      name: 'Local de prueba Norte',
    },
  ),
];
const roles = {
  'test-documents-admin': 'ADMINISTRADOR',
  'test-documents-inactive': 'ADMINISTRADOR',
  'test-documents-worker': 'TRABAJADOR',
  'test-documents-supervisor': 'SUPERVISOR',
  'test-documents-accountant': 'CONTADOR',
};
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  const url = new URL(request.url ?? '/', 'http://localhost');
  let token = request.headers.authorization?.replace('Bearer ', '');
  if (url.pathname === '/auth/login' && request.method === 'POST') {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const input = JSON.parse(raw || '{}');
    if (
      input.email !== 'admin@documents.example.test' ||
      input.password !== 'Documents-test-2026!'
    ) {
      response.writeHead(401);
      response.end('{}');
      return;
    }
    token = 'test-documents-admin';
    response.end(
      JSON.stringify({
        accessToken: token,
        refreshToken: 'test-documents-refresh',
        expiresIn: 3600,
        tokenType: 'Bearer',
        user: {
          id: adminId,
          email: users[0].email,
          firstName: users[0].firstName,
          lastName: users[0].lastName,
          role: 'ADMINISTRADOR',
          storeId: null,
        },
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
          token === 'test-documents-inactive'
            ? 'a1000000-0000-4000-8000-000000000210'
            : adminId,
        email: 'admin@documents.example.test',
        role: roles[token],
        storeId: null,
      }),
    );
    return;
  }
  if (url.pathname === '/stores' && request.method === 'GET') {
    response.end(
      JSON.stringify(
        [
          store,
          {
            id: '61000000-0000-4000-8000-000000000210',
            name: 'Local de prueba Norte',
          },
        ].map((item) => ({
          ...item,
          city: 'Melipilla',
          address: 'Av. Prueba 325',
          isActive: true,
          createdAt: '2026-10-24T12:00:00Z',
          updatedAt: '2026-10-24T12:00:00Z',
        })),
      ),
    );
    return;
  }
  if (url.pathname === '/users') {
    if (roles[token] !== 'ADMINISTRADOR') {
      response.writeHead(403);
      response.end('{}');
      return;
    }
    const filtered =
      url.searchParams.get('isActive') === 'true'
        ? users.filter((item) => item.isActive)
        : users;
    response.end(JSON.stringify(filtered));
    return;
  }
  if (url.pathname === '/documents' && request.method === 'GET') {
    response.end(
      JSON.stringify({
        items: [],
        policy: {
          maxBytes: 26214400,
          allowedMimes: ['application/pdf', 'image/png', 'image/jpeg'],
          canUpload: true,
        },
      }),
    );
    return;
  }
  response.writeHead(404);
  response.end('{}');
});
server.listen(3145, '127.0.0.1', () =>
  process.stdout.write(
    'Backend simulado documental: puerto 3145, solo loopback.\n',
  ),
);
