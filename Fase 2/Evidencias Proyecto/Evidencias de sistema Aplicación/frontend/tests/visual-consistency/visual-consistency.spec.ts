import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { getNavigationItems } from '../../src/lib/navigation';
import { openNavigation, navigateTo } from '../helpers/navigation';

const controlUrl = process.env.TEST_UI_PROXY_CONTROL_URL;
const email = process.env.TEST_UI_ADMIN_EMAIL;
const password = process.env.TEST_UI_ADMIN_PASSWORD;
const controlProperties = [
  'border-radius',
  'border-width',
  'border-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'min-height',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'background-color',
  'color',
];
const textProperties = [
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'line-height',
  'text-transform',
  'color',
];

async function metrics(
  locator: Locator,
  properties = controlProperties,
): Promise<Record<string, string>> {
  return locator.evaluate((element, keys) => {
    const css = getComputedStyle(element);
    return Object.fromEntries(
      keys.map((key) => [key, css.getPropertyValue(key)]),
    );
  }, properties);
}

async function login(page: Page): Promise<undefined> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(email!);
  await page
    .getByRole('textbox', { name: 'Contraseña', exact: true })
    .fill(password!);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function focusedControl(
  page: Page,
  locator: Locator,
): Promise<undefined> {
  await page.keyboard.press('Tab');
  await locator.focus();
  await expect(locator).toBeFocused();
  const css = await metrics(locator, [
    'outline-style',
    'outline-width',
    'outline-color',
  ]);
  expect(css['outline-style']).toBe('solid');
  expect(css['outline-width']).toBe('2px');
}

function luminance(color: string): number {
  const normalized = /^#[\da-f]{3}$/i.test(color)
    ? `#${[...color.slice(1)].map((channel) => channel.repeat(2)).join('')}`
    : color;
  const channels = normalized.startsWith('#')
    ? [0, 2, 4].map((offset) =>
        parseInt(normalized.slice(offset + 1, offset + 3), 16),
      )
    : (normalized.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  if (channels.length !== 3 || channels.some(Number.isNaN))
    throw new Error('Color de prueba inválido.');
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test.beforeEach(async ({ request }) => {
  if (
    process.env.TEST_UI_DISPOSABLE !== 'true' ||
    !controlUrl ||
    !email ||
    !password
  )
    throw new Error(
      'Se requiere proxy de fallos separado, entorno exclusivo y credenciales de desarrollo.',
    );
  expect(
    (
      await request.post(controlUrl, {
        data: {
          usersUnavailable: false,
          auditDelayMs: 0,
          backendUnavailable: false,
        },
      })
    ).status(),
  ).toBe(200);
});

test.afterEach(async ({ request }) => {
  if (controlUrl)
    expect(
      (
        await request.post(controlUrl, {
          data: {
            usersUnavailable: false,
            auditDelayMs: 0,
            backendUnavailable: false,
          },
        })
      ).status(),
    ).toBe(200);
});

test('Los controles, etiquetas, tablas y marca comparten estilos renderizados', async ({
  page,
}, info) => {
  const folder = `output/playwright/visual-consistency/${info.project.name}`;
  await mkdir(folder, { recursive: true });
  await page.goto('/login');
  const input = await metrics(
    page.getByRole('textbox', { name: 'Correo electrónico' }),
  );
  const label = await metrics(
    page.locator('label[for="email"]'),
    textProperties,
  );
  const primary = await metrics(
    page.getByRole('button', { name: 'Ingresar', exact: true }),
  );
  const brand = await metrics(
    page.getByText('Gestión interna', { exact: true }),
    textProperties,
  );
  expect(Number.parseFloat(input['min-height'])).toBeGreaterThanOrEqual(44);
  expect(
    contrast(primary.color, primary['background-color']),
  ).toBeGreaterThanOrEqual(4.5);
  await focusedControl(
    page,
    page.getByRole('textbox', { name: 'Correo electrónico' }),
  );
  await page.screenshot({ path: `${folder}/login.png`, scale: 'css' });
  await login(page);
  await expect(
    page.getByRole('heading', { name: 'Bienvenido al sistema' }),
  ).toBeVisible();
  expect(
    await metrics(
      page
        .getByRole('complementary')
        .getByText('Gestión interna', { exact: true }),
      textProperties,
    ),
  ).toEqual(brand);
  await page.screenshot({ path: `${folder}/inicio.png`, scale: 'css' });
  await navigateTo(page, 'Usuarios');
  await expect(
    page.getByRole('heading', { name: 'Usuarios del sistema' }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  const search = page.getByRole('textbox', { name: 'Buscar usuario' });
  expect(await metrics(search)).toEqual(input);
  expect(await metrics(search.locator('..'), textProperties)).toEqual(label);
  expect(
    await metrics(page.getByRole('button', { name: 'Crear usuario' })),
  ).toEqual(primary);
  const secondary = await metrics(
    page.getByRole('button', { name: 'Actualizar', exact: true }),
  );
  const select = await metrics(
    page.getByRole('combobox', { name: 'Rol', exact: true }),
  );
  const tableHead = await metrics(page.locator('thead'), [
    ...textProperties,
    'background-color',
    'border-bottom-color',
  ]);
  const badge = await metrics(
    page
      .getByRole('table')
      .locator('tbody tr')
      .first()
      .locator('td')
      .nth(1)
      .locator('span'),
    [
      'font-family',
      'font-size',
      'font-weight',
      'text-transform',
      'border-radius',
      'padding-left',
      'padding-right',
      'padding-top',
      'padding-bottom',
    ],
  );
  const heading = await metrics(page.getByRole('columnheader').first(), [
    ...textProperties,
    'padding-top',
    'padding-bottom',
    'padding-left',
    'padding-right',
  ]);
  await focusedControl(
    page,
    page.getByRole('button', { name: 'Actualizar', exact: true }),
  );
  await page.screenshot({ path: `${folder}/usuarios.png`, scale: 'css' });
  await page.getByRole('button', { name: 'Crear usuario' }).click();
  expect(
    await metrics(page.getByRole('textbox', { name: 'Nombre', exact: true })),
  ).toEqual(input);
  expect(
    await metrics(
      page.getByRole('button', { name: 'Guardar usuario', exact: true }),
    ),
  ).toEqual(primary);
  expect(
    await metrics(page.getByRole('button', { name: 'Cancelar', exact: true })),
  ).toEqual(secondary);
  await page.screenshot({ path: `${folder}/formulario.png`, scale: 'css' });
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await navigateTo(page, 'Auditoría');
  await expect(
    page.getByRole('heading', { name: 'Registro de operaciones' }),
  ).toBeVisible();
  await page.mouse.move(0, 0);
  expect(await metrics(page.getByLabel('Desde', { exact: true }))).toEqual(
    input,
  );
  expect(
    await metrics(
      page.getByText('Solo lectura', { exact: true }),
      Object.keys(badge),
    ),
  ).toEqual(badge);
  expect(
    await metrics(page.getByRole('combobox', { name: 'Local', exact: true })),
  ).toEqual(select);
  expect(
    await metrics(
      page.getByRole('combobox', { name: 'Local', exact: true }).locator('..'),
      textProperties,
    ),
  ).toEqual(label);
  expect(
    await metrics(
      page.getByRole('button', { name: 'Aplicar filtros', exact: true }),
    ),
  ).toEqual(primary);
  expect(
    await metrics(page.getByRole('button', { name: 'Limpiar', exact: true })),
  ).toEqual(secondary);
  expect(
    await metrics(page.locator('thead'), [
      ...textProperties,
      'background-color',
      'border-bottom-color',
    ]),
  ).toEqual(tableHead);
  expect(
    await metrics(page.getByRole('columnheader').first(), [
      ...textProperties,
      'padding-top',
      'padding-bottom',
      'padding-left',
      'padding-right',
    ]),
  ).toEqual(heading);
  await page.screenshot({ path: `${folder}/auditoria.png`, scale: 'css' });
  await page.getByText('Mi sesión', { exact: true }).click();
  const renew = page.getByRole('button', {
    name: 'Renovar sesión',
    exact: true,
  });
  expect(await metrics(renew)).toEqual(secondary);
  expect(
    await metrics(
      page.getByRole('button', { name: 'Cerrar sesión', exact: true }),
    ),
  ).toEqual(primary);
  await focusedControl(page, renew);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('La paleta global actualiza Usuarios y Auditoría y mantiene contraste legible', async ({
  page,
}) => {
  await login(page);
  const colors = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      ['bg', 'muted', 'crit', 'crit-bg', 'ok', 'ok-bg', 'info', 'info-bg'].map(
        (key) => [key, css.getPropertyValue(`--color-${key}`).trim()],
      ),
    );
  });
  for (const [text, background] of [
    ['muted', 'bg'],
    ['crit', 'crit-bg'],
    ['ok', 'ok-bg'],
    ['info', 'info-bg'],
  ])
    expect(contrast(colors[text], colors[background])).toBeGreaterThanOrEqual(
      4.5,
    );
  await page.evaluate(() =>
    document.documentElement.style.setProperty(
      '--color-line2',
      'rgb(20, 70, 90)',
    ),
  );
  await navigateTo(page, 'Usuarios');
  await expect(
    page.getByRole('heading', { name: 'Usuarios del sistema' }),
  ).toBeVisible();
  expect(
    (await metrics(page.getByRole('textbox', { name: 'Buscar usuario' })))[
      'border-color'
    ],
  ).toBe('rgb(20, 70, 90)');
  await navigateTo(page, 'Auditoría');
  await expect(
    page.getByRole('heading', { name: 'Registro de operaciones' }),
  ).toBeVisible();
  expect(
    (await metrics(page.getByLabel('Desde', { exact: true })))['border-color'],
  ).toBe('rgb(20, 70, 90)');
});

test('El estado de carga de Auditoría conserva navegación, cuenta y sesión', async ({
  page,
  request,
}, info) => {
  await login(page);
  expect(
    (
      await request.post(controlUrl!, { data: { auditDelayMs: 2500 } })
    ).status(),
  ).toBe(200);
  const navigate = navigateTo(page, 'Auditoría');
  await expect(
    page.getByText('Cargando registro de auditoría…', { exact: true }),
  ).toBeVisible();
  await openNavigation(page);
  await expect(
    page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link'),
  ).toHaveText(getNavigationItems('ADMINISTRADOR').map((item) => item.label));
  await expect(
    page.getByRole('complementary').getByText(email!, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Mi sesión', { exact: true })).toBeVisible();
  const folder = `output/playwright/visual-consistency/${info.project.name}`;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: `${folder}/auditoria-cargando.png`,
    scale: 'css',
  });
  await navigate;
  await expect(
    page.getByRole('heading', { name: 'Registro de operaciones' }),
  ).toBeVisible();
});

test('Un fallo del listado de Usuarios conserva el layout y permite cerrar sesión', async ({
  page,
  request,
  context,
}, info) => {
  await login(page);
  expect(
    (
      await request.post(controlUrl!, { data: { usersUnavailable: true } })
    ).status(),
  ).toBe(200);
  await page.goto('/admin/usuarios');
  await expect(
    page.getByRole('alert').filter({ hasText: 'No se pudo' }),
  ).toBeVisible();
  await openNavigation(page);
  await expect(
    page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link'),
  ).toHaveText(getNavigationItems('ADMINISTRADOR').map((item) => item.label));
  await expect(
    page.getByRole('complementary').getByText(email!, { exact: true }),
  ).toBeVisible();
  await page.getByText('Mi sesión', { exact: true }).click();
  const folder = `output/playwright/visual-consistency/${info.project.name}`;
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: `${folder}/usuarios-error.png`, scale: 'css' });
  await page
    .getByRole('button', { name: 'Cerrar sesión', exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    (await context.cookies()).filter((cookie) =>
      ['mf_access', 'mf_refresh'].includes(cookie.name),
    ),
  ).toEqual([]);
});

test('Mi sesión flota sin mover la cabecera ni el contenido de las tres vistas', async ({
  page,
}, info) => {
  await login(page);
  for (const path of ['/dashboard', '/admin/usuarios', '/admin/auditoria']) {
    await page.goto(path);
    const title =
      path === '/dashboard'
        ? 'Bienvenido al sistema'
        : path === '/admin/usuarios'
          ? 'Usuarios del sistema'
          : 'Registro de operaciones';
    await expect(
      page.getByRole('heading', { name: title, exact: true }),
    ).toBeVisible();
    const header = page.locator('header');
    const main = page.getByRole('main');
    const beforeHeader = await header.boundingBox();
    const beforeMain = await main.boundingBox();
    await page.getByText('Mi sesión', { exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Cerrar sesión', exact: true }),
    ).toBeVisible();
    expect(await header.boundingBox()).toEqual(beforeHeader);
    expect(await main.boundingBox()).toEqual(beforeMain);
    const panel = await page.locator('details > div').boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    const folder = `output/playwright/visual-consistency/${info.project.name}`;
    await mkdir(folder, { recursive: true });
    await page.screenshot({
      path: `${folder}/sesion-${path.split('/').pop()}.png`,
      scale: 'css',
    });
    await page.getByText('Mi sesión', { exact: true }).click();
  }
});

test('El fallo de validación de sesión muestra recuperación y reintenta sin exponer datos', async ({
  page,
  request,
}, info) => {
  await login(page);
  expect(
    (
      await request.post(controlUrl!, { data: { backendUnavailable: true } })
    ).status(),
  ).toBe(200);
  for (const path of ['/dashboard', '/admin/usuarios', '/admin/auditoria']) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: 'No se pudo verificar tu sesión' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Intentar nuevamente', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cerrar sesión', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByText(email!, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
  }
  const folder = `output/playwright/visual-consistency/${info.project.name}`;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: `${folder}/sesion-no-disponible.png`,
    scale: 'css',
  });
  expect(
    (
      await request.post(controlUrl!, { data: { backendUnavailable: false } })
    ).status(),
  ).toBe(200);
  await page
    .getByRole('button', { name: 'Intentar nuevamente', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Registro de operaciones' }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Navegación principal' }),
  ).toBeVisible();
  // Con el layout ya montado, un fallo de la página queda dentro de error.tsx.
  expect(
    (
      await request.post(controlUrl!, { data: { backendUnavailable: true } })
    ).status(),
  ).toBe(200);
  await navigateTo(page, 'Inicio');
  await expect(
    page.getByRole('heading', { name: 'No se pudo cargar esta vista' }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Navegación principal' }),
  ).toBeVisible();
  await page.screenshot({
    path: `${folder}/sesion-error-navegacion.png`,
    scale: 'css',
  });
  expect(
    (
      await request.post(controlUrl!, { data: { backendUnavailable: false } })
    ).status(),
  ).toBe(200);
  await page
    .getByRole('button', { name: 'Intentar nuevamente', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Bienvenido al sistema' }),
  ).toBeVisible();
});

test('Cerrar sesión elimina las dos cookies aunque el backend siga caído', async ({
  page,
  request,
  context,
}) => {
  await login(page);
  expect(
    (
      await request.post(controlUrl!, { data: { backendUnavailable: true } })
    ).status(),
  ).toBe(200);
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { name: 'No se pudo verificar tu sesión' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Cerrar sesión', exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    (await context.cookies()).filter((cookie) =>
      ['mf_access', 'mf_refresh'].includes(cookie.name),
    ),
  ).toEqual([]);
  await expect(
    page.getByRole('button', { name: 'Ingresar', exact: true }),
  ).toBeVisible();
});
