import type { Page } from '@playwright/test';

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
  await page
    .getByRole('navigation', { name: 'Navegación principal', exact: true })
    .getByRole('link', { name: label, exact: true })
    .click();
}
