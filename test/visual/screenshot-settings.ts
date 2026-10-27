/** The Settings modal, light and dark, plus the header corner without the theme button, into tmp/settings/.
 *  Run: bun test/visual/screenshot-settings.ts (needs `bun run build:cli` first). */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const OUT = join(ROOT, 'tmp', 'settings');
mkdirSync(OUT, { recursive: true });

const handle = serveCommand(join(ROOT, 'models/key-inherited'), { port: 0 });
const base = `http://localhost:${handle.server.port}`;
const browser = await chromium.launch();

try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await page.addInitScript(mode => localStorage.setItem('ignatius-theme', mode), theme);
    await page.goto(`${base}/#view=dict`);
    await page.waitForSelector('.dict-view', { timeout: 20_000 });

    const corner = join(OUT, `corner-${theme}.png`);
    await page.screenshot({ path: corner, clip: { x: 980, y: 0, width: 300, height: 80 } });
    console.log(corner);

    await page.click('.fab');
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.waitFor();
    await page.waitForTimeout(300);
    const path = join(OUT, `settings-${theme}.png`);
    await dialog.screenshot({ path });
    console.log(path);
    await page.close();
  }
} finally {
  await browser.close();
  handle.stop(true);
}
