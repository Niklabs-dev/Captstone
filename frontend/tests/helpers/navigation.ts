import type { Page } from '@playwright/test';

// Un diálogo nativo es el ámbito activo del menú; el fondo está inerte.
export function getNavigationSurface(page: Page) {
  const dialog = page.getByRole('dialog', {
    name: 'Todos los módulos',
    exact: true,
  });
  return page
    .getByRole('navigation', { name: 'Navegación principal', exact: true })
    .filter({ hasNot: dialog })
    .or(dialog);
}

export async function openNavigation(page: Page): Promise<undefined> {
  const toggle = page.getByRole('button', {
    name: 'Menú principal',
    exact: true,
  });
  if (await toggle.isVisible()) {
    if ((await toggle.getAttribute('aria-expanded')) === 'false')
      await toggle.click();
  }
}

export async function navigateTo(
  page: Page,
  label: string,
): Promise<undefined> {
  await openNavigation(page);
  await getNavigationSurface(page)
    .getByRole('link', { name: label, exact: true })
    .click();
}
