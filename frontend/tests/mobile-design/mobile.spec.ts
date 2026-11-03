import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { getNavigationItems, getHomePath } from '../../src/lib/navigation';
import { getMobileNavigation } from '../../src/lib/mobile-navigation';
import type { Role } from '../../src/lib/auth';

const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3351';
const adminEmail = process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl';
const adminPassword =
  process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion';
const password = 'Mobile-design-test-2026!';
const accounts = new Map<Role, { id: string; email: string }>();
let token = '';
let store = { id: '', name: '' };
const roles: Role[] = ['ADMINISTRADOR', 'CONTADOR', 'SUPERVISOR', 'TRABAJADOR'];

test.beforeAll(async ({ request }, info) => {
  if (process.env.TEST_REAL_DISPOSABLE !== 'true')
    throw Error('Solo contra una instancia exclusiva de pruebas.');
  const auth = await request.post(backend + '/auth/login', {
    data: { email: adminEmail, password: adminPassword },
  });
  expect(auth.status()).toBe(200);
  token = (await auth.json()).accessToken as string;
  const headers = { Authorization: 'Bearer ' + token };
  const suffix = info.project.name + '-' + randomUUID();
  const local = await request.post(backend + '/stores', {
    headers,
    data: {
      name: 'Diseño móvil ' + suffix,
      city: 'Melipilla',
      address: 'Dirección sintética 4',
    },
  });
  expect(local.status()).toBe(201);
  store = (await local.json()) as typeof store;
  for (const role of roles.slice(1)) {
    const email = role.toLowerCase() + '-' + suffix + '@example.test';
    const account = await request.post(backend + '/users', {
      headers,
      data: {
        firstName: 'Prueba',
        lastName: role,
        email,
        password,
        roleCode: role,
        ...(role === 'CONTADOR' ? {} : { storeId: store.id }),
      },
    });
    expect(account.status()).toBe(201);
    accounts.set(role, { id: (await account.json()).id as string, email });
  }
});

test.afterAll(async ({ request }) => {
  if (!token) return;
  const headers = { Authorization: 'Bearer ' + token };
  for (const account of accounts.values())
    expect(
      (
        await request.patch(backend + '/users/' + account.id + '/deactivate', {
          headers,
        })
      ).status(),
    ).toBe(200);
  if (store.id)
    expect(
      (
        await request.patch(backend + '/stores/' + store.id + '/deactivate', {
          headers,
        })
      ).status(),
    ).toBe(200);
});

async function noOverflow(page: Page): Promise<undefined> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const role of roles)
  test(
    role + ': inicio, navegación y acciones móviles con API real',
    async ({ page }, info) => {
      const mobile = info.project.name !== 'desktop';
      await page.goto('/login');
      await page
        .getByRole('textbox', { name: 'Correo electrónico' })
        .fill(
          role === 'ADMINISTRADOR' ? adminEmail : accounts.get(role)!.email,
        );
      await page
        .getByRole('textbox', { name: 'Contraseña', exact: true })
        .fill(role === 'ADMINISTRADOR' ? adminPassword : password);
      await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(getHomePath(role) + '$'));
      const nav = page.getByRole('navigation', {
        name: 'Navegación principal',
        exact: true,
      });
      await expect(nav).toBeVisible();
      await noOverflow(page);
      const homeLinks = page.getByRole('main').getByRole('link');
      for (const link of await homeLinks.all())
        await expect(link).toBeVisible();
      await page.screenshot({
        path: info.outputPath('inicio-' + role.toLowerCase() + '.png'),
        fullPage: true,
        scale: 'css',
      });
      const session = page.locator('summary').filter({ hasText: 'Mi sesión' });
      await session.click();
      await expect(
        page.getByRole('button', { name: 'Renovar sesión', exact: true }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(session).toBeFocused();
      if (mobile) {
        const metrics = await nav.evaluate((element) => ({
          bottom: element.getBoundingClientRect().bottom,
          top: element.getBoundingClientRect().top,
          height: innerHeight,
          widths: [...element.querySelectorAll('a,button')]
            .filter((node) => node.getClientRects().length)
            .map((node) => {
              const rect = node.getBoundingClientRect();
              return [rect.width, rect.height];
            }),
        }));
        expect(metrics.height - metrics.bottom).toBeGreaterThanOrEqual(0);
        const lastAction = await homeLinks.last().boundingBox();
        expect(lastAction).not.toBeNull();
        expect(lastAction!.y + lastAction!.height).toBeLessThanOrEqual(
          metrics.top,
        );
        for (const [width, height] of metrics.widths) {
          expect(width).toBeGreaterThanOrEqual(44);
          expect(height).toBeGreaterThanOrEqual(44);
        }
      }
      if (mobile && getMobileNavigation(role).additional.length) {
        const more = nav.getByRole('button', {
          name: 'Menú principal',
          exact: true,
        });
        await more.click();
        const dialog = page.getByRole('dialog', { name: 'Todos los módulos' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('link')).toHaveCount(
          getNavigationItems(role).length,
        );
        await page.screenshot({
          path: info.outputPath('mas.png'),
          scale: 'css',
        });
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await expect(more).toBeFocused();
        await more.click();
        await dialog
          .getByRole('link', { name: 'Auditoría', exact: true })
          .click();
        await expect(
          page.getByRole('heading', {
            name: 'Auditoría del sistema',
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(
          page
            .getByRole('navigation')
            .getByRole('button', { name: 'Menú principal' }),
        ).toHaveAttribute('aria-current', 'page');
      }
      for (const item of getNavigationItems(role).slice(1)) {
        await page.goto(item.href);
        await noOverflow(page);
        await expect(page.getByRole('main')).toBeVisible();
      }
      if (role === 'ADMINISTRADOR') {
        await page.goto('/admin/locales');
        await page.getByLabel('Buscar local').fill(store.name);
        await expect(
          page
            .getByRole(mobile ? 'article' : 'row', {
              name: mobile ? store.name : undefined,
            })
            .filter({ hasText: store.name }),
        ).toHaveCount(1);
        await page
          .getByRole('button', { name: 'Editar ' + store.name, exact: true })
          .click();
        const edit = page.getByRole('dialog', {
          name: 'Editar local',
          exact: true,
        });
        await expect(edit).toBeVisible();
        await noOverflow(page);
        await page.screenshot({
          path: info.outputPath('editar-local.png'),
          scale: 'css',
        });
        await page.keyboard.press('Escape');
        await expect(edit).not.toBeVisible();
        await expect(
          page.getByRole('button', {
            name: 'Editar ' + store.name,
            exact: true,
          }),
        ).toBeFocused();
        await page.goto('/admin/usuarios');
        await page
          .getByRole('textbox', { name: 'Buscar usuario' })
          .fill(accounts.get('TRABAJADOR')!.email);
        await expect(
          page.getByRole('button', {
            name: 'Editar a Prueba TRABAJADOR',
            exact: true,
          }),
        ).toBeVisible();
        if (mobile) {
          const roleFilter = page.getByRole('combobox', {
            name: 'Rol',
            exact: true,
          });
          await expect(roleFilter).not.toBeVisible();
          await page
            .getByRole('button', { name: 'Más filtros', exact: true })
            .click();
          await roleFilter.selectOption('TRABAJADOR');
          await page.getByRole('button', { name: /Menos filtros/ }).click();
          await expect(roleFilter).not.toBeVisible();
          await expect(
            page.getByRole('button', { name: 'Más filtros (1)', exact: true }),
          ).toBeVisible();
        }
        await page.screenshot({
          path: info.outputPath('usuarios.png'),
          fullPage: true,
          scale: 'css',
        });
      }
      if (role === 'TRABAJADOR') {
        await page.goto('/admin/usuarios');
        await expect(page).toHaveURL(/\/portal\?reason=forbidden$/);
        await expect(page.getByRole('main').getByRole('status')).toContainText(
          'no tiene acceso',
        );
      }
    },
  );
