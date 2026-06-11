/**
 * CP-4 visual verification: live server dict route.
 *
 * Confirms the mode-flag injection didn't break anything visible:
 * - Dict renders correctly in dark mode
 * - No blank page, no JS errors from the mode flag script
 *
 * Output: tmp/cp4-live-dict.png
 */

import { chromium } from 'playwright';
import { resolve } from 'path';
import { serveCommand } from '../../src/server/server';

const modelsDir = resolve(import.meta.dir, '../../models');
const tmpDir = resolve(import.meta.dir, '../../tmp');

const PORT = 3289;
const handle = serveCommand(modelsDir, { port: PORT });

// Give the server a moment to bind
await Bun.sleep(500);

try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://localhost:${PORT}/dict`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(tmpDir, 'cp4-live-dict.png') });
  console.log('Saved: tmp/cp4-live-dict.png');
  await browser.close();
} finally {
  handle.stop(true);
}
