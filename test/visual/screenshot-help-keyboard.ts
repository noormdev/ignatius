/** The help overlay's Keyboard section, graph and flow, light and dark, into tmp/help-keyboard/.
 *  Run: bun test/visual/screenshot-help-keyboard.ts */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const OUT = join(ROOT, 'tmp', 'help-keyboard');
mkdirSync(OUT, { recursive: true });

const handle = serveCommand(join(ROOT, 'models/key-inherited'), { port: 0 });
const base = `http://localhost:${handle.server.port}`;
const browser = await chromium.launch();

try {
  for (const theme of ['light', 'dark']) {
    for (const view of ['graph', 'flow']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
      await page.addInitScript(mode => localStorage.setItem('ignatius-theme', mode), theme);
      await page.goto(`${base}/#view=${view}`);
      await page.waitForTimeout(1_500);
      await page.keyboard.press('?');
      const section = page.locator('.help-modal .help-section').filter({ has: page.getByRole('heading', { name: 'Keyboard' }) });
      await section.scrollIntoViewIfNeeded();
      const path = join(OUT, `${view}-${theme}.png`);
      await section.screenshot({ path });
      console.log(path);
      await page.close();
    }
  }
} finally {
  await browser.close();
  handle.stop(true);
}
