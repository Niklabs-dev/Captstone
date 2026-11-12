import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

// Administración de productos de inventario con API y PostgreSQL reales
// (SPRINT-5-T04). Usa el catálogo cargado por la plantilla (SPRINT-5-T02) y
// crea productos con nombres propios de cada proyecto.
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo contra backend y base exclusivos con datos sintéticos.',
);
const adminEmail = process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl';
const adminPassword =
  process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion';

async function login(context: BrowserContext, baseURL: string) {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email: adminEmail, password: adminPassword },
      })
    ).status(),
  ).toBe(200);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test('Administrador: listado por sección, filtros, crear con coma decimal, error junto al campo, editar y desactivar', async ({
  page,
  context,
  baseURL,
}, info) => {
  const suffix = `${info.project.name}-${randomUUID().slice(0, 6)}`;
  const name = `Producto E2E ${suffix}`;
  await login(context, baseURL!);
  await page.goto('/admin/productos');
  await expect(page.getByText('Cargando productos…')).toHaveCount(0);

  // Agrupado por sección en el orden de la plantilla y con el formato.
  await expect(
    page.getByRole('heading', { name: 'COSTO DE BEBIDAS' }),
  ).toBeVisible();
  const fajita = page
    .getByRole('listitem')
    .filter({ hasText: 'Carne Fajita (Beef Steak Saborizado)' });
  await expect(fajita).toContainText('Caja 5 kg · 2 bolsas de 2,5 kg');
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Lata Fanta Zero' }).first(),
  ).toContainText('Sin formato');

  // Búsqueda sin mayúsculas y filtro de los que faltan.
  await page.getByLabel('Buscar por nombre').fill('fanta zero');
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Lata Fanta Zero' }),
  ).toHaveCount(2);
  await page.getByLabel('Buscar por nombre').fill('');
  await page.getByLabel(/Solo sin formato/).check();
  await expect(fajita).toHaveCount(0);
  await page.getByLabel(/Solo sin formato/).uncheck();
  await noOverflow(page);

  // Crear: coma decimal, caja calculada y ejemplo.
  await page.getByRole('button', { name: 'Crear producto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear producto' });
  await dialog.getByLabel('Nombre', { exact: true }).fill(name);
  await dialog.getByLabel('Sección').selectOption('COSTO DE VARIOS');
  await dialog.getByLabel('Nombre del paquete').fill('bolsa');
  await dialog.getByLabel('Paquetes por caja').fill('2');
  await dialog.getByLabel('Contenido por paquete').fill('2,5');
  await expect(dialog.getByLabel('Contenido por caja')).toHaveValue('5');
  await expect(dialog).toContainText(
    'Ejemplo: 1 caja + 2 bolsas + 0,300 kg = 10,300 kg',
  );
  await noOverflow(page);
  await dialog.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(page.getByText(`Producto «${name}» creado`)).toBeVisible();
  const created = page.getByRole('listitem').filter({ hasText: name });
  await expect(created).toContainText('Caja 5 kg · 2 bolsas de 2,5 kg');

  // Nombre repetido: el error de la API va junto al campo y se conserva lo
  // escrito.
  await page.getByRole('button', { name: 'Crear producto' }).click();
  const again = page.getByRole('dialog', { name: 'Crear producto' });
  await again.getByLabel('Nombre', { exact: true }).fill(name.toUpperCase());
  await again.getByLabel('Sección').selectOption('COSTO DE VARIOS');
  await again.getByLabel('Contenido por paquete').fill('1,25');
  await again.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(again.getByText(/Ya existe un producto llamado/)).toBeVisible();
  await expect(again.getByLabel('Nombre', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(again.getByLabel('Contenido por paquete')).toHaveValue('1,25');
  await again.getByRole('button', { name: 'Cancelar' }).click();

  // Editar el nombre.
  await created.getByRole('button', { name: `Editar ${name}` }).click();
  const edit = page.getByRole('dialog', { name: 'Editar producto' });
  await expect(edit.getByLabel('Contenido por paquete')).toHaveValue('2,5');
  await edit.getByLabel('Nombre', { exact: true }).fill(`${name} editado`);
  await edit.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(
    page.getByText(`Producto «${name} editado» actualizado.`),
  ).toBeVisible();

  // Desactivar con confirmación.
  const edited = page
    .getByRole('listitem')
    .filter({ hasText: `${name} editado` });
  await edited
    .getByRole('button', { name: `Desactivar ${name} editado` })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Desactivar producto' });
  await expect(confirm).toContainText('dejará de aparecer en las tomas nuevas');
  await confirm
    .getByRole('button', { name: 'Desactivar', exact: true })
    .click();
  await expect(
    page.getByText(`Producto «${name} editado» desactivado.`),
  ).toBeVisible();
  await expect(edited).toHaveCount(0);
  await page.getByLabel('Estado').selectOption('all');
  await expect(edited).toContainText('Inactivo');
  await noOverflow(page);

  const folder = 'output/playwright/products/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/productos.png',
    fullPage: true,
    scale: 'css',
  });
});

test('Otros roles no ven ni usan la administración de productos', async ({
  page,
  context,
  baseURL,
}) => {
  await context.request.post('/api/auth/logout', {
    headers: { Origin: baseURL! },
  });
  await page.goto('/admin/productos');
  await expect(page).toHaveURL(/\/login|session-expired/);
  expect(
    (
      await context.request.post('/api/products', {
        headers: { Origin: baseURL! },
        data: { name: 'X', section: 'Y', unit: 'KG' },
      })
    ).status(),
  ).toBe(401);
});
