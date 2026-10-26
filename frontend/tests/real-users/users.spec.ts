import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import type { ManagedUser } from '../../src/lib/users';
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Requiere backend y base exclusivos de pruebas.',
);
const backendURL = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3001';
const password = 'User-test-2026!';
async function login(context: BrowserContext, baseURL: string): Promise<void> {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: {
          email: process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
          password:
            process.env.TEST_REAL_ADMIN_PASSWORD ??
            'admin-cambiar-en-produccion',
        },
      })
    ).status(),
  ).toBe(200);
}
async function noOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const dialog = page.getByRole('dialog');
  if (await dialog.count())
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
}
test('Edición persistente, asignación, reactivación, clave y revocación de sesiones reales', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!);
  const suffix = info.project.name + '-' + Date.now();
  const email = `user-${suffix}@integration.example.test`;
  const headers = { Origin: baseURL! };
  const created = await context.request.post('/api/users', {
    headers,
    data: {
      firstName: 'Lucía',
      lastName: suffix,
      email,
      password,
      roleCode: 'CONTADOR',
    },
  });
  expect(created.status()).toBe(201);
  const user: ManagedUser = await created.json();
  const oldSession = await context.request.post(`${backendURL}/auth/login`, {
    data: { email, password },
  });
  expect(oldSession.status()).toBe(200);
  const oldTokens = (await oldSession.json()) as { refreshToken: string };
  await page.goto('/admin/usuarios');
  await page.getByRole('textbox', { name: 'Buscar usuario' }).fill(email);
  const edit = page.getByRole('button', {
    name: `Editar a Lucía ${suffix}`,
    exact: true,
  });
  await edit.click();
  let dialog = page.getByRole('dialog', {
    name: 'Editar usuario',
    exact: true,
  });
  await noOverflow(page);
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  await edit.click();
  await dialog.getByLabel('Nombre', { exact: true }).fill('Lucía María');
  await dialog
    .getByLabel('Teléfono (opcional)', { exact: true })
    .fill('+56912345678');
  await dialog
    .getByLabel('Fecha de contratación (opcional)')
    .fill('2026-10-01');
  await dialog
    .getByRole('combobox', { name: 'Rol', exact: true })
    .selectOption('TRABAJADOR');
  const storesResponse = await context.request.get('/api/stores');
  const stores = (await storesResponse.json()) as {
    id: string;
    isActive: boolean;
  }[];
  const store = stores.find((item) => item.isActive);
  expect(store).toBeDefined();
  await dialog
    .getByRole('combobox', { name: 'Local asignado' })
    .selectOption(store!.id);
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('Usuario actualizado');
  expect(
    (
      await context.request.post(`${backendURL}/auth/refresh`, {
        data: { refreshToken: oldTokens.refreshToken },
      })
    ).status(),
  ).toBe(401);
  await page.reload();
  await page.getByRole('textbox', { name: 'Buscar usuario' }).fill(email);
  await page
    .getByRole('button', {
      name: `Editar a Lucía María ${suffix}`,
      exact: true,
    })
    .click();
  await expect(
    dialog.getByLabel('Teléfono (opcional)', { exact: true }),
  ).toHaveValue('+56912345678');
  await expect(
    dialog.getByLabel('Fecha de contratación (opcional)'),
  ).toHaveValue('2026-10-01');
  // Un duplicado devuelve 409, permanece abierto y orienta a corregir el correo.
  await dialog
    .getByLabel('Correo electrónico', { exact: true })
    .fill(process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Ya existe un usuario');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await page
    .getByRole('button', {
      name: `Desactivar a Lucía María ${suffix}`,
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Confirmar desactivación' }).click();
  await expect(page.getByRole('status')).toContainText('Usuario desactivado');
  await page
    .getByRole('button', {
      name: `Reactivar a Lucía María ${suffix}`,
      exact: true,
    })
    .click();
  dialog = page.getByRole('dialog', { name: 'Reactivar usuario' });
  await dialog.getByRole('button', { name: 'Confirmar reactivación' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('Usuario reactivado');
  const session = await context.request.post(`${backendURL}/auth/login`, {
    data: { email, password },
  });
  expect(session.status()).toBe(200);
  const tokens = (await session.json()) as { refreshToken: string };
  await page
    .getByRole('button', {
      name: `Restablecer contraseña de Lucía María ${suffix}`,
      exact: true,
    })
    .click();
  dialog = page.getByRole('dialog', {
    name: 'Restablecer contraseña',
    exact: true,
  });
  await noOverflow(page);
  await expect(
    dialog.getByText('Se revocarán las sesiones', { exact: false }),
  ).toBeVisible();
  const newPassword = 'New-user-test-2026!';
  await dialog
    .getByLabel('Nueva contraseña', { exact: true })
    .fill(newPassword);
  await dialog
    .getByLabel('Confirmar nueva contraseña', { exact: true })
    .fill('Different-test-2026!');
  await dialog
    .getByRole('button', { name: 'Restablecer contraseña', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText('no coinciden');
  await dialog
    .getByLabel('Confirmar nueva contraseña', { exact: true })
    .fill(newPassword);
  await dialog.screenshot({
    path: info.outputPath('restablecer-movil-escritorio.png'),
  });
  await dialog
    .getByRole('button', { name: 'Restablecer contraseña', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Contraseña restablecida',
  );
  expect(
    (
      await context.request.post(`${backendURL}/auth/login`, {
        data: { email, password },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await context.request.post(`${backendURL}/auth/refresh`, {
        data: { refreshToken: tokens.refreshToken },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await context.request.post(`${backendURL}/auth/login`, {
        data: { email, password: newPassword },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await page.getByRole('textbox', { name: 'Buscar usuario' }).fill(email);
  await page
    .getByRole('button', {
      name: `Restablecer contraseña de Lucía María ${suffix}`,
      exact: true,
    })
    .click();
  await expect(
    dialog.getByLabel('Nueva contraseña', { exact: true }),
  ).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: info.outputPath('usuarios-actualizados.png') });
  await noOverflow(page);
  const listed = await context.request.get('/api/users');
  const text = await listed.text();
  expect(text).not.toContain(newPassword);
  expect(text).not.toContain('passwordHash');
  expect(text).not.toContain('refreshToken');
  const updated = (JSON.parse(text) as ManagedUser[]).find(
    (item) => item.id === user.id,
  );
  expect(updated?.isActive).toBe(true);
  expect(updated?.store?.id).toBe(store!.id);
});
test('BFF real: origen, rol, campos prohibidos, política de clave y protección de cuenta propia', async ({
  context,
  baseURL,
}) => {
  await login(context, baseURL!);
  const list: ManagedUser[] = await (
    await context.request.get('/api/users')
  ).json();
  const own = list.find(
    (user) =>
      user.email === (process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl'),
  )!;
  const missing = '77000000-0000-4000-8000-000000000999';
  for (const suffix of ['', '/reactivate', '/password']) {
    expect(
      (
        await context.request.patch(`/api/users/${missing}${suffix}`, {
          headers: { Origin: 'https://invalid.example.test' },
          data: { newPassword: password },
        })
      ).status(),
    ).toBe(403);
  }
  const headers = { Origin: baseURL! };
  expect(
    (
      await context.request.patch(`/api/users/${own.id}`, {
        headers,
        data: { roleCode: 'TRABAJADOR' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.patch(`/api/users/${own.id}/password`, {
        headers,
        data: { newPassword: password },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.patch(`/api/users/${missing}`, {
        headers,
        data: { firstName: 'Prueba' },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await context.request.patch(`/api/users/${missing}/reactivate`, {
        headers,
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await context.request.patch(`/api/users/${missing}/password`, {
        headers,
        data: { newPassword: password },
      })
    ).status(),
  ).toBe(404);
  for (const data of [
    { newPassword: 'short' },
    { newPassword: 'x'.repeat(33) },
    { newPassword: '😀'.repeat(19) },
    { newPassword: password, isActive: true },
  ])
    expect(
      (
        await context.request.patch(`/api/users/${missing}/password`, {
          headers,
          data,
        })
      ).status(),
    ).toBe(400);
  expect(
    (
      await context.request.patch(`/api/users/${missing}`, {
        headers,
        data: { password },
      })
    ).status(),
  ).toBe(400);
  // Una cuenta no administradora nunca alcanza los endpoints nuevos del BFF.
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers,
        data: {
          email: 'worker@integration.example.test',
          password: 'Integration-test-2026!',
        },
      })
    ).status(),
  ).toBe(200);
  for (const suffix of ['', '/reactivate', '/password'])
    expect(
      (
        await context.request.patch(`/api/users/${own.id}${suffix}`, {
          headers,
          data: { newPassword: password },
        })
      ).status(),
    ).toBe(403);
});
