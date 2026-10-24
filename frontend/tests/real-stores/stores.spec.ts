import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Store } from '../../src/lib/stores';
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo con Docker, backend y base exclusivos de pruebas.',
);
const admin = {
  email: process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
  password:
    process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
};
async function login(
  context: BrowserContext,
  baseURL: string,
  email = admin.email,
  password = admin.password,
): Promise<void> {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
}
async function assertNoOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
test('CRUD real, catálogo inmediato en Usuarios y Auditoría, inactivos e historial', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!);
  await page.goto('/admin/locales');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Locales', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('link', { name: 'Locales', exact: true }),
  ).toBeVisible();
  await assertNoOverflow(page);
  const create = page.getByRole('button', { name: 'Crear local', exact: true });
  await create.click();
  let dialog = page.getByRole('dialog', { name: 'Crear local' });
  await dialog.getByRole('button', { name: 'Guardar local' }).click();
  await expect(dialog.getByText('Completa este campo.')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(create).toBeFocused();
  await create.click();
  dialog = page.getByRole('dialog', { name: 'Crear local' });
  const suffix = info.project.name + ' ' + Date.now();
  const name = 'Local Café ' + suffix;
  await dialog.getByLabel('Nombre del local').fill('  ' + name + '  ');
  await dialog.getByLabel('Ciudad', { exact: true }).fill('Melipilla');
  await dialog
    .getByLabel('Dirección', { exact: true })
    .fill('Av. Integración 325');
  await dialog.getByRole('button', { name: 'Guardar local' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('Local creado');
  const stores: Store[] = await (
    await context.request.get('/api/stores')
  ).json();
  const created = stores.find((store) => store.name === name);
  expect(created).toBeDefined();
  if (!created) throw Error('Local no persistido');
  await page.reload();
  await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
  // El mismo nombre se rechaza; no basta con recargar y reintentar.
  await create.click();
  dialog = page.getByRole('dialog', { name: 'Crear local' });
  for (const [field, value] of [
    ['Nombre del local', name],
    ['Ciudad', 'Melipilla'],
    ['Dirección', 'Av. Integración 325'],
  ])
    await dialog.getByLabel(field, { exact: true }).fill(value);
  await dialog.getByRole('button', { name: 'Guardar local' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Ya existe un local');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  const updatedName = name + ' Centro';
  await page
    .getByRole('button', { name: 'Editar ' + name, exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Editar local' });
  await dialog.getByLabel('Nombre del local').fill(updatedName);
  await dialog.getByRole('button', { name: 'Guardar local' }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto('/admin/usuarios');
  await expect(
    page
      .getByRole('combobox', { name: 'Local', exact: true })
      .locator('option', { hasText: updatedName }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: /Crear usuario/ }).click();
  const userDialog = page.getByRole('dialog', { name: 'Crear usuario' });
  await userDialog
    .getByRole('combobox', { name: 'Rol', exact: true })
    .selectOption('TRABAJADOR');
  await expect(
    userDialog
      .getByRole('combobox', { name: 'Local asignado', exact: true })
      .locator('option', { hasText: updatedName }),
  ).toHaveCount(1);
  await userDialog.getByRole('button', { name: 'Cancelar' }).click();
  // Deja un usuario sintético asignado para comprobar que desactivar conserva historial.
  const userResponse = await context.request.post('/api/users', {
    headers: { Origin: baseURL! },
    data: {
      firstName: 'Trabajador',
      lastName: 'Catálogo',
      email: `catalog-${Date.now()}-${info.project.name}@integration.example.test`,
      password: 'Integration-test-2026!',
      roleCode: 'TRABAJADOR',
      storeId: created.id,
    },
  });
  expect(userResponse.status()).toBe(201);
  const user: { id: string } = await userResponse.json();
  await page.goto('/admin/auditoria');
  await expect(
    page
      .getByRole('combobox', { name: 'Local', exact: true })
      .locator('option', { hasText: updatedName }),
  ).toHaveCount(1);
  await page.goto('/liquidaciones');
  await expect(
    page
      .getByRole('combobox', { name: 'Local', exact: true })
      .locator('option', { hasText: updatedName }),
  ).toHaveCount(1);
  await page.goto('/admin/alertas-dt');
  await expect(
    page
      .getByRole('combobox', { name: 'Local', exact: true })
      .locator('option', { hasText: updatedName }),
  ).toHaveCount(1);
  await page.goto('/admin/locales');
  await page
    .getByRole('button', { name: 'Desactivar ' + updatedName, exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Desactivar local' });
  await dialog.getByRole('button', { name: 'Confirmar desactivación' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'usuarios activos asignados',
  );
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  // La cuenta queda inactiva, pero conserva su asignación y su historial.
  expect(
    (
      await context.request.patch('/api/users/' + user.id + '/deactivate', {
        headers: { Origin: baseURL! },
      })
    ).status(),
  ).toBe(200);
  await page
    .getByRole('button', { name: 'Desactivar ' + updatedName, exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Confirmar desactivación' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: updatedName }),
  ).toContainText('Inactivo');
  await page.goto('/admin/usuarios');
  await expect(
    page
      .getByRole('combobox', { name: 'Local', exact: true })
      .locator('option', { hasText: updatedName }),
  ).toContainText('(inactivo)');
  const users: { id: string; store: { id: string } | null }[] = await (
    await context.request.get('/api/users')
  ).json();
  expect(users.find((item) => item.id === user.id)?.store?.id).toBe(created.id);
  await page.getByRole('button', { name: /Crear usuario/ }).click();
  await userDialog
    .getByRole('combobox', { name: 'Rol', exact: true })
    .selectOption('TRABAJADOR');
  await expect(
    userDialog
      .getByRole('combobox', { name: 'Local asignado', exact: true })
      .locator(`option[value="${created.id}"]`),
  ).toHaveCount(0);
  await userDialog.getByRole('button', { name: 'Cancelar' }).click();
  await page.goto('/admin/auditoria');
  await expect(
    page
      .getByRole('combobox', { name: 'Local', exact: true })
      .locator(`option[value="${created.id}"]`),
  ).toContainText('(inactivo)');
  await page.goto('/admin/locales');
  await page
    .getByRole('button', { name: 'Reactivar ' + updatedName, exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Reactivar local' });
  await dialog.getByRole('button', { name: 'Confirmar reactivación' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel('Buscar local').fill(updatedName);
  await expect(page.locator('tbody').getByRole('row')).toHaveCount(1);
  await assertNoOverflow(page);
  await page.screenshot({
    path: info.outputPath('locales-crud-real.png'),
    fullPage: true,
  });
});
test('BFF real: autorización, origen, validación, rutas y errores privados', async ({
  page,
  context,
  baseURL,
}) => {
  expect((await context.request.get('/api/stores')).status()).toBe(401);
  await login(context, baseURL!);
  const input = {
    name: 'Local seguridad ' + Date.now(),
    city: 'Melipilla',
    address: 'Av. Prueba 450',
  };
  expect(
    (
      await context.request.post('/api/stores', {
        headers: { Origin: 'https://otro.example.test' },
        data: input,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.post('/api/stores', {
        headers: { Origin: baseURL! },
        data: { ...input, isActive: false },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.post('/api/stores', {
        headers: { Origin: baseURL! },
        data: { ...input, name: '\u200b' },
      })
    ).status(),
  ).toBe(400);
  expect((await context.request.get('/api/stores?isActive=no')).status()).toBe(
    400,
  );
  expect(
    (
      await context.request.get('/api/stores?isActive=true&isActive=false')
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.patch('/api/stores/no-es-uuid', {
        headers: { Origin: baseURL! },
        data: input,
      })
    ).status(),
  ).toBe(404);
  expect((await context.request.delete('/api/stores')).status()).toBe(405);
  const missing = await context.request.patch(
    '/api/stores/ffffffff-ffff-4fff-8fff-ffffffffffff',
    { headers: { Origin: baseURL! }, data: input },
  );
  expect(missing.status()).toBe(404);
  expect(await missing.text()).not.toMatch(/SQL|Prisma|stack/i);
  const fixtures: Record<string, { email: string }> = JSON.parse(
    readFileSync('output/real-api/fixtures.json', 'utf8'),
  );
  for (const key of ['accountant', 'supervisor', 'worker']) {
    await login(
      context,
      baseURL!,
      fixtures[key].email,
      'Integration-test-2026!',
    );
    expect((await context.request.get('/api/stores')).status()).toBe(200);
    expect(
      (
        await context.request.post('/api/stores', {
          headers: { Origin: baseURL! },
          data: input,
        })
      ).status(),
    ).toBe(403);
    await page.goto('/admin/locales');
    await expect(page).not.toHaveURL(/\/admin\/locales/);
    await expect(
      page.getByRole('link', { name: 'Locales', exact: true }),
    ).toHaveCount(0);
  }
});
