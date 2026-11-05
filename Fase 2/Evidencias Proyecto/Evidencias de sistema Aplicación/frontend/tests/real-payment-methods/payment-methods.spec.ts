import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { openNavigation, getNavigationSurface } from '../helpers/navigation';
import type { PaymentMethod } from '../../src/lib/payment-methods';

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
test('CRUD real, navegación de administrador, inactivos con historial y teclado', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!);
  await page.goto('/admin/medios-pago');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Medios de pago',
      exact: true,
    }),
  ).toHaveCount(1);
  await openNavigation(page);
  await expect(
    getNavigationSurface(page).getByRole('link', {
      name: 'Medios de pago',
      exact: true,
    }),
  ).toBeVisible();
  if (await page.getByRole('dialog', { name: 'Todos los módulos' }).isVisible())
    await page.keyboard.press('Escape');
  await assertNoOverflow(page);
  // Los cuatro medios sembrados siguen listados con su estado. El nombre puede
  // repetirse como comportamiento ("Efectivo"), así que se afirma el primero.
  for (const name of [
    'Efectivo',
    'Tarjeta de débito',
    'Tarjeta de crédito',
    'Transferencia',
  ])
    await expect(
      page
        .getByRole('cell', { name, exact: true })
        .or(page.getByRole('article', { name, exact: true }))
        .first(),
    ).toBeVisible();
  // Crear con validaciones visibles y Escape devuelve el foco al disparador.
  const create = page.getByRole('button', {
    name: 'Crear medio de pago',
    exact: true,
  });
  await create.click();
  let dialog = page.getByRole('dialog', { name: 'Crear medio de pago' });
  await dialog.getByRole('button', { name: 'Guardar medio' }).click();
  await expect(dialog.getByText('Ingresa el código del medio.')).toBeVisible();
  await expect(dialog.getByText('Ingresa el nombre del medio.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(create).toBeFocused();
  // Nombre único por corrida: el catálogo conserva historial y no se borra,
  // así que las repeticiones de la suite deben distinguirse entre sí.
  const suffix = info.project.name + ' ' + Date.now();
  const code = ('TESTMEDIO' + Date.now()).slice(0, 40);
  const name = 'Medio Integración ' + suffix;
  const renamed = name + ' Norte';
  await create.click();
  dialog = page.getByRole('dialog', { name: 'Crear medio de pago' });
  await dialog.getByLabel('Código del medio').fill('  ' + code + '  ');
  await dialog.getByLabel('Nombre del medio').fill(name);
  await dialog.getByLabel('Orden de lista').fill('90');
  await dialog
    .getByLabel('Comportamiento en cierre')
    .selectOption('EXTERNAL_OTHER');
  await dialog.getByLabel('Disponible para propinas').selectOption('true');
  await dialog.getByRole('button', { name: 'Guardar medio' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('creado');
  const methods: PaymentMethod[] = await (
    await context.request.get('/api/payment-methods')
  ).json();
  const created = methods.find((method) => method.code === code);
  expect(created).toBeDefined();
  if (!created) throw Error('Medio no persistido');
  await page.reload();
  await expect(
    page
      .getByRole('cell', { name, exact: true })
      .or(page.getByRole('article', { name, exact: true })),
  ).toBeVisible();
  // El código se normaliza y es único: reutilizarlo se rechaza con 409 traducido.
  await create.click();
  dialog = page.getByRole('dialog', { name: 'Crear medio de pago' });
  await dialog.getByLabel('Código del medio').fill(code.toLowerCase());
  await dialog.getByLabel('Nombre del medio').fill('Medio duplicado');
  await dialog.getByLabel('Orden de lista').fill('91');
  await dialog
    .getByLabel('Comportamiento en cierre')
    .selectOption('EXTERNAL_OTHER');
  await dialog.getByLabel('Disponible para propinas').selectOption('false');
  await dialog.getByRole('button', { name: 'Guardar medio' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Ya existe un medio');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  // Editar nombre y configuración; el código queda fuera del formulario.
  await page
    .getByRole('button', { name: 'Editar ' + name, exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Editar medio de pago' });
  await expect(dialog.getByText(/Código:/)).toContainText(code);
  await dialog.getByLabel('Nombre del medio').fill(renamed);
  await dialog.getByLabel('Orden de lista').fill('92');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('actualizado');
  // Desactivar conserva el historial visible y vuelve a activar.
  await page
    .getByRole('button', {
      name: 'Desactivar ' + renamed,
      exact: true,
    })
    .click();
  dialog = page.getByRole('dialog', { name: 'Desactivar medio de pago' });
  await expect(dialog.getByText(/historial se conserva/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirmar desactivación' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('desactivado');
  await expect(
    page
      .getByRole('row', { name: new RegExp(renamed) })
      .or(page.getByRole('article', { name: renamed })),
  ).toContainText('Inactivo');
  await page
    .getByRole('button', {
      name: 'Reactivar ' + renamed,
      exact: true,
    })
    .click();
  dialog = page.getByRole('dialog', { name: 'Reactivar medio de pago' });
  await dialog.getByRole('button', { name: 'Confirmar reactivación' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('reactivado');
  await assertNoOverflow(page);
  await page.screenshot({
    path: info.outputPath('medios-pago.png'),
    fullPage: true,
  });
  // El filtro de inactivos muestra el medio desactivado y oculta los activos.
  await page
    .getByRole('button', {
      name: 'Desactivar ' + renamed,
      exact: true,
    })
    .click();
  dialog = page.getByRole('dialog', { name: 'Desactivar medio de pago' });
  await dialog.getByRole('button', { name: 'Confirmar desactivación' }).click();
  await page
    .getByRole('combobox', { name: 'Estado', exact: true })
    .selectOption('false');
  await expect(
    page
      .getByRole('cell', { name: renamed, exact: true })
      .or(page.getByRole('article', { name: renamed, exact: true })),
  ).toBeVisible();
  await expect(
    page
      .getByRole('cell', { name: 'Efectivo', exact: true })
      .or(page.getByRole('article', { name: 'Efectivo', exact: true }))
      .first(),
  ).toHaveCount(0);
  // Limpieza: el medio sintético queda inactivo (historial conservado) para no
  // ofrecerlo en los formularios productivos de otros flujos de prueba.
  const final: PaymentMethod[] = await (
    await context.request.get('/api/payment-methods')
  ).json();
  expect(final.find((method) => method.code === code)?.isActive).toBe(false);
});

test('Propinas diarias consumen el catálogo activo del administrador', async ({
  page,
  context,
  baseURL,
}, info) => {
  const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3339';
  const password = 'Medios-Test-2026!';
  const suffix = info.project.name + '-' + Date.now();
  // Crea un local y una supervisora descartables para entrar a propinas diarias.
  const adminLogin = await context.request.post(backend + '/auth/login', {
    data: { email: admin.email, password: admin.password },
  });
  expect(adminLogin.status()).toBe(200);
  const adminSession: unknown = await adminLogin.json();
  if (
    typeof adminSession !== 'object' ||
    adminSession === null ||
    !('accessToken' in adminSession) ||
    typeof adminSession.accessToken !== 'string'
  )
    throw Error('Login de administrador inválido.');
  const headers = { Authorization: 'Bearer ' + adminSession.accessToken };
  const storeResponse = await context.request.post(backend + '/stores', {
    headers,
    data: {
      name: 'Medios ' + suffix,
      city: 'Melipilla',
      address: 'Av. Pruebas 311',
    },
  });
  expect(storeResponse.status()).toBe(201);
  const store: { id: string } = await storeResponse.json();
  const userResponse = await context.request.post(backend + '/users', {
    headers,
    data: {
      email: 'medios-' + suffix + '@example.test',
      password,
      firstName: 'Camila',
      lastName: 'Prueba de medios',
      roleCode: 'SUPERVISOR',
      storeId: store.id,
    },
  });
  expect(userResponse.status()).toBe(201);
  const supervisor: { id: string } = await userResponse.json();
  try {
    await login(
      context,
      baseURL!,
      'medios-' + suffix + '@example.test',
      password,
    );
    const methods: PaymentMethod[] = await (
      await context.request.get(
        '/api/payment-methods?isActive=true&availableForTips=true',
      )
    ).json();
    expect(methods.length).toBeGreaterThan(0);
    await page.goto('/propinas/diarias');
    const select = page.getByRole('combobox', { name: /Medio de pago/ });
    await expect(select).toBeEnabled();
    for (const method of methods) {
      await expect(
        select.locator('option', { hasText: method.name }),
      ).toHaveCount(1);
    }
  } finally {
    await context.request.patch(
      backend + '/users/' + supervisor.id + '/deactivate',
      {
        headers,
      },
    );
    await context.request.patch(
      backend + '/stores/' + store.id + '/deactivate',
      {
        headers,
      },
    );
  }
});
