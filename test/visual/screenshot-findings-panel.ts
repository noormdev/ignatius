/**
 * Visual screenshot capture for CP-6: findings panel states.
 *
 * Captures:
 * - tmp/cp6-panel-expanded.png   — panel open with 18 findings rows visible
 * - tmp/cp6-panel-collapsed.png  — panel collapsed to badge
 * - tmp/cp6-panel-row-expanded.png — already captured by test-findings-panel.ts;
 *   recaptured here for standalone visual use
 *
 * Run: bun test/visual/screenshot-findings-panel.ts
 * NOT run by bun run test (visual scripts are manual-only).
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODELS = join(ROOT, 'models');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const PORT = 3291;
const handle = serveCommand(MODELS, { port: PORT });
await Bun.sleep(300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 }).catch(() => null);
  await page.waitForTimeout(2000);

  // Panel expanded (default state)
  await page.screenshot({ path: join(TMP, 'cp6-panel-expanded.png') });
  console.log('Saved: tmp/cp6-panel-expanded.png');

  // Collapse the panel
  await page.locator('.findings-panel-collapse').click();
  await page.waitForTimeout(200);

  // Panel collapsed badge state
  await page.screenshot({ path: join(TMP, 'cp6-panel-collapsed.png') });
  console.log('Saved: tmp/cp6-panel-collapsed.png');

  // Re-expand, then open a row
  await page.locator('.findings-panel-badge').click();
  await page.waitForTimeout(200);

  await page.locator('.findings-panel details').first().click();
  await page.waitForTimeout(500);

  await page.screenshot({ path: join(TMP, 'cp6-panel-row-expanded.png') });
  console.log('Saved: tmp/cp6-panel-row-expanded.png');

} finally {
  await browser.close();
  handle.stop(true);
}
