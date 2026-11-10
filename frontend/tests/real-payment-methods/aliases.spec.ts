import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

// SPRINT-4A-T20: etiquetas del informe de MrComanda de cada medio en
// /admin/medios-pago, con API y PostgreSQL reales. Cada proyecto usa su
// propia etiqueta y la deja eliminada al terminar.
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo con Docker, backend y base exclusivos de pruebas.',
);
const admin = {
  email: process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
  password:
    process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
};
async function login(context: BrowserContext, baseURL: string): Promise<void> {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: admin,
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
}
function letters(length: number): string {
  return Array.from({ length }, () =>
    String.fromCharCode(65 + randomInt(0, 26)),
  ).join('');
}

test('Ver, agregar, corregir y quitar etiquetas de los informes', async ({
  page,
  context,
  baseURL,
}, info) => {
  const label = `N.de Créd. ${letters(5)}`;
  await login(context, baseURL!);
  await page.goto('/admin/medios-pago');
  const panel = page.getByRole('region', {
    name: 'Etiquetas de los informes de ventas',
  });
  await expect(panel.getByText('Cargando etiquetas…')).toHaveCount(0);
  const methodCard = (name: string) =>
    panel.getByRole('article').filter({
      has: page.getByRole('heading', { name, exact: false }),
    });
  // Las etiquetas sembradas aparecen en su medio.
  await expect(methodCard('Tarjeta de débito')).toContainText('T. DEBITO');
  await expect(methodCard('Efectivo')).toContainText('EFECTIVO');
  await noOverflow(page);

  // Agregar con «recordar» equivocado: a Transferencia.
  await panel.getByLabel('Etiqueta del informe').fill(label);
  await panel
    .getByLabel('Medio de pago', { exact: false })
    .selectOption({ label: 'Transferencia' });
  await panel.getByRole('button', { name: 'Agregar etiqueta' }).click();
  await expect(panel.getByRole('status')).toContainText(
    `«${label}» quedó asociada a Transferencia`,
  );
  await expect(methodCard('Transferencia')).toContainText(label);

  // La misma etiqueta (con otras tildes y mayúsculas) no se repite.
  await panel
    .getByLabel('Etiqueta del informe')
    .fill(label.toUpperCase().replace('É', 'E'));
  await panel
    .getByLabel('Medio de pago', { exact: false })
    .selectOption({ label: 'Efectivo' });
  await panel.getByRole('button', { name: 'Agregar etiqueta' }).click();
  await expect(panel.getByRole('alert')).toContainText(
    'ya está asociada a Transferencia',
  );

  // Corregir: quitarla de Transferencia y asociarla a Efectivo.
  await panel
    .getByRole('button', { name: `Quitar «${label}» de Transferencia` })
    .click();
  await expect(panel.getByRole('status')).toContainText(
    'Las importaciones confirmadas no cambian',
  );
  await expect(methodCard('Transferencia')).not.toContainText(label);
  await panel.getByLabel('Etiqueta del informe').fill(label);
  await panel.getByRole('button', { name: 'Agregar etiqueta' }).click();
  await expect(methodCard('Efectivo')).toContainText(label);
  await noOverflow(page);
  const folder =
    'output/playwright/payment-methods/aliases-' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/etiquetas.png',
    fullPage: true,
    scale: 'css',
  });

  // Persiste al recargar y se limpia al final.
  await page.reload();
  await expect(methodCard('Efectivo')).toContainText(label);
  await panel
    .getByRole('button', { name: `Quitar «${label}» de Efectivo` })
    .click();
  await expect(methodCard('Efectivo')).not.toContainText(label);
});
