import type { Page } from 'playwright';
import type { ThemeMode } from '../../src/theme/theme-defaults';

/** Picks `mode` the way a user does — FAB → Settings → Appearance — then closes the dialog. */
export async function setTheme(page: Page, mode: ThemeMode): Promise<void> {
  await page.locator('.fab').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('radio', { name: mode === 'light' ? 'Light' : 'Dark' }).check();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(m => document.documentElement.classList.contains(`theme-${m}`), mode);
}

export async function currentTheme(page: Page): Promise<ThemeMode> {
  return page.evaluate(() => (document.documentElement.classList.contains('theme-light') ? 'light' : 'dark'));
}

export async function toggleTheme(page: Page): Promise<void> {
  await setTheme(page, (await currentTheme(page)) === 'light' ? 'dark' : 'light');
}
