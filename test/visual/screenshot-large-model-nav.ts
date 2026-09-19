/**
 * Visual verification: flow index, breadcrumb level menu, and hover delay
 * (docs/spec/large-model-nav.md) on models/llm-memory-db-mssql, whose six
 * flows carry index.md descriptions.
 *
 * Writes to tmp/large-model-nav-shots/:
 *  0. the landing System overview, Process Flows chip current (dark)
 *  1. breadcrumbs with the ▾ on the flow crumb (dark)
 *  2. the level menu open on that crumb (dark, then light)
 *  3. the flow index with a row hovered and its description in the pane (dark, then light)
 *  4. a process node 100 ms into a hover (no fade yet) and after it settles
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';
import { HOVER_INTENT_MS } from '../../src/app/logic/motion';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models/llm-memory-db-mssql');
const OUT = join(ROOT, 'tmp/large-model-nav-shots');
mkdirSync(OUT, { recursive: true });

const PORT = 3321;
const handle = serveCommand(MODEL, { port: PORT });
await new Promise<void>(r => setTimeout(r, 500));

const browser = await chromium.launch();

async function openFlow(page: Page, dfd: string): Promise<void> {
  await page.goto(`http://localhost:${PORT}/#view=flow&dfd=${dfd}`);
  await page.waitForFunction(() => window.__IGNATIUS_FLOW_READY__ === true, null, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

async function shoot(theme: 'dark' | 'light'): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  if (theme === 'dark') {
    await page.goto(`http://localhost:${PORT}/#view=flow`);
    await page.waitForFunction(() => window.__IGNATIUS_FLOW_READY__ === true, null, { timeout: 30_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, '0-landing-overview-dark.png') });
  }
  await openFlow(page, 'work-planning');
  if (theme === 'light') {
    await page.locator('.theme-toggle').click();
    await page.waitForTimeout(200);
  }
  if (theme === 'dark') {
    await page.screenshot({ path: join(OUT, '1-crumbs-dark.png'), clip: { x: 0, y: 0, width: 1440, height: 120 } });
  }

  await page.locator('[data-ignatius="flow-crumb-menu-button"]').first().click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, `2-level-menu-${theme}.png`), clip: { x: 0, y: 0, width: 1100, height: 520 } });
  await page.keyboard.press('Escape');

  await page.locator('[data-ignatius="flow-index-button"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-ignatius="flow-index-row"][data-path$="/memory-lifecycle"]').first().hover();
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, `3-index-${theme}.png`) });
  await page.keyboard.press('Escape');

  if (theme === 'dark') {
    const box = await page.locator('[data-token^="proc:"]').first().boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(100);
      await page.screenshot({ path: join(OUT, '4a-hover-100ms.png') });
      await page.waitForTimeout(HOVER_INTENT_MS + 100);
      await page.screenshot({ path: join(OUT, '4b-hover-settled.png') });
    }
  }
  await page.close();
}

try {
  await shoot('dark');
  await shoot('light');
  console.log(`screenshots in ${OUT}`);
} finally {
  await browser.close();
  handle.stop();
}
process.exit(0);
