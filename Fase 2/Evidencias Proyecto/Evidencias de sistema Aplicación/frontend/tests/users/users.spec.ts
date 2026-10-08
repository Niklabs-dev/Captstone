import {
  expect,
  test,
  type BrowserContext,
  type APIRequestContext,
} from '@playwright/test';
import { isObject } from '../../src/lib/users';
const frontendUrl =
  process.env.TEST_USERS_FRONTEND_URL ?? 'http://localhost:3102';
const backendUrl =
  process.env.TEST_USERS_BACKEND_URL ?? 'http://localhost:3103';
const storeId = process.env.TEST_USERS_STORE_ID;
const password = 'TestUserPassword123';
async function login(
  request: APIRequestContext,
  email: string,
  accountPassword: string,
): Promise<string> {
  const response = await request.post(`${backendUrl}/auth/login`, {
    data: { email, password: accountPassword },
  });
  expect(response.status()).toBe(200);
  const data: unknown = await response.json();
  if (!isObject(data) || typeof data.accessToken !== 'string')
    throw new Error('Login de prueba sin token válido.');
  return data.accessToken;
}
async function authenticate(
  context: BrowserContext,
  token: string,
): Promise<undefined> {
  await context.addCookies([
    {
      name: 'mf_access',
      value: token,
      url: frontendUrl,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}
test.beforeEach(async ({ context, request }) => {
  const email = process.env.TEST_USERS_ADMIN_EMAIL;
  const adminPassword = process.env.TEST_USERS_ADMIN_PASSWORD;
  if (!email || !adminPassword || process.env.TEST_USERS_DISPOSABLE !== 'true')
    throw new Error(
      'Configura credenciales y TEST_USERS_DISPOSABLE=true para usar una BD exclusiva de pruebas.',
    );
  await authenticate(context, await login(request, email, adminPassword));
});
test('Crea, busca, filtra, maneja duplicados y desactiva con confirmación', async ({
  page,
  context,
  request,
}, info) => {
  const email = `ui-${info.project.name}-${Date.now()}@example.test`;
  await page.goto('/admin/usuarios');
  await expect(
    page.getByRole('heading', { name: 'Usuarios del sistema' }),
  ).toBeVisible();
  await expect(page.locator('aside')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  const errors: string[] = [];
  page.on('pageerror', (failure) => errors.push(failure.message));
  await page.getByRole('button', { name: 'Crear usuario' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear usuario' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Nombre', { exact: true }).fill('Prueba');
  await dialog.getByLabel('Apellido', { exact: true }).fill('Navegador');
  await dialog.getByLabel('Correo electrónico').fill(email);
  await dialog.getByLabel('Contraseña inicial').fill(password);
  await dialog
    .getByRole('combobox', { name: 'Rol', exact: true })
    .selectOption('CONTADOR');
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/users') &&
      response.request().method() === 'POST' &&
      response.status() === 201,
  );
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  const created: unknown = await (await createdResponse).json();
  if (!isObject(created) || typeof created.id !== 'string')
    throw new Error('Alta sin ID válido.');
  const openedSession = await request.post(`${backendUrl}/auth/login`, {
    data: { email, password },
  });
  expect(openedSession.status()).toBe(200);
  const openedTokens: unknown = await openedSession.json();
  if (!isObject(openedTokens) || typeof openedTokens.refreshToken !== 'string')
    throw new Error('Sesión de prueba inválida.');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toHaveText(
    'Usuario creado correctamente.',
  );
  await page.getByLabel('Buscar usuario').fill(email);
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await page
    .getByRole('combobox', { name: 'Rol', exact: true })
    .selectOption('TRABAJADOR');
  await expect(
    page.getByText('No hay usuarios que coincidan con los filtros.'),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Rol', exact: true })
    .selectOption('CONTADOR');
  await page.getByRole('button', { name: 'Crear usuario' }).click();
  await dialog.getByLabel('Nombre', { exact: true }).fill('Prueba');
  await dialog.getByLabel('Apellido', { exact: true }).fill('Duplicada');
  await dialog.getByLabel('Correo electrónico').fill(email);
  await dialog.getByLabel('Contraseña inicial').fill(password);
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Ya existe');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await row.getByRole('button', { name: 'Desactivar' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Desactivar usuario' });
  await confirmation.getByRole('button', { name: 'Cancelar' }).click();
  await expect(row.getByText('Activo', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Desactivar' }).click();
  await confirmation
    .getByRole('button', { name: 'Confirmar desactivación' })
    .click();
  await expect(row.getByText('Desactivado', { exact: true })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Estado', exact: true })
    .selectOption('true');
  await expect(row).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Estado', exact: true })
    .selectOption('false');
  await expect(row).toHaveCount(1);
  const deniedLogin = await request.post(`${backendUrl}/auth/login`, {
    data: { email, password },
  });
  expect(deniedLogin.status()).toBe(401);
  expect(
    (
      await request.post(`${backendUrl}/auth/refresh`, {
        data: { refreshToken: openedTokens.refreshToken },
      })
    ).status(),
  ).toBe(401);
  const adminToken = (await context.cookies()).find(
    (cookie) => cookie.name === 'mf_access',
  )?.value;
  const auditResponse = await request.get(
    `${backendUrl}/audit-logs?limit=200`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  expect(auditResponse.status()).toBe(200);
  const audit: unknown = await auditResponse.json();
  if (!isObject(audit) || !Array.isArray(audit.items))
    throw new Error('Auditoría no disponible.');
  for (const action of ['USER_CREATED', 'USER_DEACTIVATED'])
    expect(
      audit.items.some(
        (item: unknown) =>
          isObject(item) &&
          item.entityId === created.id &&
          item.action === action,
      ),
    ).toBe(true);
  await page.screenshot({
    path: `test-results/users/${info.project.name}-users.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  const own = await context.request.get(`${backendUrl}/auth/me`, {
    headers: {
      Authorization: `Bearer ${(await context.cookies()).find((cookie) => cookie.name === 'mf_access')?.value}`,
    },
  });
  expect(own.status()).toBe(200);
});

test('Bloquea un administrador desactivado aunque su JWT siga vigente', async ({
  browser,
  context,
  request,
}, info) => {
  const email = `inactive-admin-${info.project.name}-${Date.now()}@example.test`;
  const created = await context.request.post(`${frontendUrl}/api/users`, {
    headers: { Origin: frontendUrl },
    data: {
      firstName: 'Prueba',
      lastName: 'Administrador',
      email,
      password,
      roleCode: 'ADMINISTRADOR',
    },
  });
  expect(created.status()).toBe(201);
  const user: unknown = await created.json();
  if (!isObject(user) || typeof user.id !== 'string')
    throw new Error('Alta inválida.');
  const restricted = await browser.newContext();
  await authenticate(restricted, await login(request, email, password));
  expect(
    (await restricted.request.get(`${frontendUrl}/api/users`)).status(),
  ).toBe(200);
  expect(
    (
      await context.request.patch(
        `${frontendUrl}/api/users/${user.id}/deactivate`,
        { headers: { Origin: frontendUrl } },
      )
    ).status(),
  ).toBe(200);
  expect(
    (await restricted.request.get(`${frontendUrl}/api/users`)).status(),
  ).toBe(401);
  expect(
    (
      await restricted.request.post(`${frontendUrl}/api/users`, {
        headers: { Origin: frontendUrl },
        data: {},
      })
    ).status(),
  ).toBe(401);
  const page = await restricted.newPage();
  await page.goto(`${frontendUrl}/admin/usuarios`);
  expect(page.url()).toContain('/login?reason=session');
  await restricted.close();
});
test('Rechaza visitantes, token falso y los tres roles no administradores', async ({
  browser,
  context,
  request,
}, info) => {
  const anonymous = await browser.newContext();
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(`${frontendUrl}/admin/usuarios`);
  expect(anonymousPage.url()).toContain('/login?reason=session');
  const absent = await anonymous.request.get(`${frontendUrl}/api/users`);
  expect(absent.status()).toBe(401);
  await authenticate(anonymous, 'forged-token');
  expect(
    (await anonymous.request.get(`${frontendUrl}/api/users`)).status(),
  ).toBe(401);
  await anonymous.close();
  for (const roleCode of ['CONTADOR', 'SUPERVISOR', 'TRABAJADOR']) {
    if (roleCode !== 'CONTADOR' && !storeId)
      throw new Error(
        'TEST_USERS_STORE_ID es obligatorio para probar roles locales.',
      );
    const email = `rbac-${roleCode.toLowerCase()}-${info.project.name}-${Date.now()}@example.test`;
    const created = await context.request.post(`${frontendUrl}/api/users`, {
      headers: { Origin: frontendUrl },
      data: {
        firstName: 'Prueba',
        lastName: roleCode,
        email,
        password,
        roleCode,
        ...(roleCode !== 'CONTADOR' ? { storeId } : {}),
      },
    });
    expect(created.status()).toBe(201);
    const user: unknown = await created.json();
    if (!isObject(user) || typeof user.id !== 'string')
      throw new Error('Usuario creado sin ID.');
    const token = await login(request, email, password);
    const restricted = await browser.newContext();
    await authenticate(restricted, token);
    expect(
      (await restricted.request.get(`${frontendUrl}/api/users`)).status(),
    ).toBe(403);
    expect(
      (
        await restricted.request.post(`${frontendUrl}/api/users`, {
          headers: { Origin: frontendUrl },
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await restricted.request.patch(
          `${frontendUrl}/api/users/${user.id}/deactivate`,
          { headers: { Origin: frontendUrl } },
        )
      ).status(),
    ).toBe(403);
    const restrictedPage = await restricted.newPage();
    await restrictedPage.goto(`${frontendUrl}/admin/usuarios`);
    expect(restrictedPage.url()).toContain('/dashboard?reason=forbidden');
    await restricted.close();
    expect(
      (
        await context.request.patch(
          `${frontendUrl}/api/users/${user.id}/deactivate`,
          { headers: { Origin: frontendUrl } },
        )
      ).status(),
    ).toBe(200);
  }
});
test('Protege cuenta propia y origen de mutaciones', async ({
  context,
  request,
}) => {
  const email = process.env.TEST_USERS_ADMIN_EMAIL;
  const adminPassword = process.env.TEST_USERS_ADMIN_PASSWORD;
  if (!email || !adminPassword) throw new Error('Faltan credenciales.');
  const token = await login(request, email, adminPassword);
  const me = await request.get(`${backendUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const identity: unknown = await me.json();
  if (!isObject(identity) || typeof identity.id !== 'string')
    throw new Error('Identidad inválida.');
  expect(
    (
      await context.request.patch(
        `${frontendUrl}/api/users/${identity.id}/deactivate`,
        { headers: { Origin: frontendUrl } },
      )
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.post(`${frontendUrl}/api/users`, {
        headers: { Origin: 'https://external.example' },
        data: {},
      })
    ).status(),
  ).toBe(403);
});

test('Permite asignar local al supervisor y exige una selección', async ({
  page,
}, info) => {
  if (!storeId) throw new Error('Falta el local de pruebas.');
  const email = `local-${info.project.name}-${Date.now()}@example.test`;
  await page.goto('/admin/usuarios');
  await page.getByRole('button', { name: 'Crear usuario' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear usuario' });
  await dialog.getByLabel('Nombre', { exact: true }).fill('Prueba');
  await dialog.getByLabel('Apellido', { exact: true }).fill('Local');
  await dialog.getByLabel('Correo electrónico').fill(email);
  await dialog.getByLabel('Contraseña inicial').fill(password);
  await dialog
    .getByRole('combobox', { name: 'Rol', exact: true })
    .selectOption('SUPERVISOR');
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('combobox', { name: 'Local asignado', exact: true })
    .selectOption(storeId);
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel('Buscar usuario').fill(email);
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row.getByText('Local de prueba', { exact: true })).toBeVisible();
  await expect(row.getByText('Supervisor', { exact: true })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Local', exact: true })
    .selectOption(storeId);
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Desactivar' }).click();
  await page
    .getByRole('dialog', { name: 'Desactivar usuario' })
    .getByRole('button', { name: 'Confirmar desactivación' })
    .click();
  await expect(row.getByText('Desactivado', { exact: true })).toBeVisible();
});
