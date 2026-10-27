/** test-export-as-seen.ts — FAB → Export HTML downloads a file that opens, in a fresh browser, with the exporter's
 *  hidden entity, dictionary lens, layout mode and settings, and a reload keeps the recipient's own changes. */

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { serveCommand } from '../../src/server/server';
import { HOVER_INTENT_MS } from '../../src/app/logic/motion';
import { assert } from '../assert';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const PORT = 3339;
const BASE = `http://localhost:${PORT}`;
const HIDDEN_ENTITY = 'Identity';

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

const WATCHDOG_MS = 120_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-export-as-seen.ts exceeded its ${WATCHDOG_MS}ms watchdog`);
  process.exit(1);
}, WATCHDOG_MS);

async function waitForFirstLayout(page: Page) {
  await page.waitForFunction(() => (window.__IGNATIUS_PERF__?.layoutStopAt ?? 0) > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(300);
}

function isHidden(page: Page, id: string) {
  return page.evaluate(nodeId => window.__IGNATIUS_CY__?.$id(nodeId).hasClass('user-hidden') ?? false, id);
}

async function hideByRightClick(page: Page, id: string) {
  const point = await page.evaluate(nodeId => {
    const cy = window.__IGNATIUS_CY__;
    if (!cy) throw new Error('no live cytoscape core');
    const rendered = cy.$id(nodeId).renderedPosition();
    const rect = cy.container()?.getBoundingClientRect();
    if (!rect) throw new Error('no cytoscape container');
    return { x: rect.left + rendered.x, y: rect.top + rendered.y };
  }, id);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.waitForTimeout(HOVER_INTENT_MS + 150);
}

async function openFabItem(page: Page, name: string | RegExp) {
  await page.click('.fab');
  await page.getByRole('menuitem', { name }).click();
}

function lensPressed(page: Page, lens: 'Read' | 'Browse') {
  return page.getByRole('group', { name: 'Dictionary lens' }).getByRole('button', { name: lens }).getAttribute('aria-pressed');
}

async function alwaysOpenChecked(page: Page) {
  await openFabItem(page, 'Settings');
  const checked = await page.getByRole('dialog', { name: 'Settings' }).getByLabel('Always open examples').isChecked();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached', timeout: 5_000 });
  return checked;
}

/** The theme Settings shows as chosen; with `choose`, picks that theme first. */
async function settingsTheme(page: Page, choose?: 'dark' | 'light') {
  await openFabItem(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  if (choose) await dialog.getByRole('radio', { name: choose === 'dark' ? 'Dark' : 'Light' }).check();
  const dark = await dialog.getByRole('radio', { name: 'Dark' }).isChecked();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 5_000 });
  return dark ? 'dark' : 'light';
}

async function fabLayoutLabel(page: Page) {
  await page.click('.fab');
  const label = await page.getByRole('menuitem', { name: / layout/ }).filter({ hasNotText: 'Reset' }).innerText();
  await page.keyboard.press('Escape');
  return label;
}

const root = mkdtempSync(join(tmpdir(), 'ignatius-export-as-seen-'));
const dir = join(root, 'model');
const leftovers = new Set([join(FIXTURE, '.ignatius'), join(FIXTURE, '.gitignore')]);
cpSync(FIXTURE, dir, { recursive: true, filter: source => !leftovers.has(source) });
const exportPath = join(root, 'export.html');

const handle = serveCommand(dir, { port: PORT });

try {
  const browser = await chromium.launch();
  try {
    const live = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors: string[] = [];
    live.on('pageerror', e => pageErrors.push(String(e)));
    await live.route('**/events', route => route.abort());
    await live.goto(`${BASE}/#view=graph`);
    await waitForFirstLayout(live);

    await hideByRightClick(live, HIDDEN_ENTITY);
    assert(await isHidden(live, HIDDEN_ENTITY), `FAIL: fixture: right-click hides ${HIDDEN_ENTITY} in the live viewer`);

    const modeBefore = await live.evaluate(() => localStorage.getItem('ignatius-layout-mode'));
    await openFabItem(live, /^(Organic|Hierarchical|Tree) layout/);
    const layoutMode = await live.evaluate(() => localStorage.getItem('ignatius-layout-mode'));
    assert(layoutMode !== modeBefore, `FAIL: fixture: the FAB layout item changes the stored mode (stayed ${layoutMode})`);
    const liveLayoutLabel = await fabLayoutLabel(live);

    await openFabItem(live, 'Dictionary');
    await live.getByRole('group', { name: 'Dictionary lens' }).getByRole('button', { name: 'Browse' }).click();
    await openFabItem(live, 'Settings');
    await live.getByRole('dialog', { name: 'Settings' }).getByLabel('Always open examples').setChecked(true);
    await live.keyboard.press('Escape');
    await live.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached', timeout: 5_000 });

    const downloadPromise = live.waitForEvent('download', { timeout: 30_000 });
    await openFabItem(live, 'Export HTML');
    const download = await downloadPromise;
    assert(download.suggestedFilename() === 'key-inherited.html', `FAIL: the download is named for the model (got ${download.suggestedFilename()})`);
    await download.saveAs(exportPath);

    const recipient = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const file = await recipient.newPage();
      file.on('pageerror', e => pageErrors.push(String(e)));
      await file.goto(pathToFileURL(exportPath).href);
      await file.getByRole('group', { name: 'Dictionary lens' }).waitFor({ timeout: 15_000 });
      assert(await lensPressed(file, 'Browse') === 'true', 'FAIL: the export opens on the Dictionary in the Browse lens');
      assert(await alwaysOpenChecked(file), 'FAIL: the export opens with Always open examples on');

      await file.evaluate(() => { location.hash = '#view=graph'; });
      await waitForFirstLayout(file);
      assert(await isHidden(file, HIDDEN_ENTITY), `FAIL: the export opens with ${HIDDEN_ENTITY} hidden`);
      const fileLayoutMode = await file.evaluate(() => localStorage.getItem('ignatius-layout-mode'));
      assert(fileLayoutMode === layoutMode, `FAIL: the export keeps layout mode ${layoutMode} (got ${fileLayoutMode})`);
      const fileLayoutLabel = await fabLayoutLabel(file);
      assert(fileLayoutLabel === liveLayoutLabel, `FAIL: the export's FAB offers the same next layout (${liveLayoutLabel} vs ${fileLayoutLabel})`);

      await file.evaluate(() => { location.hash = '#view=dict'; });
      await file.getByRole('group', { name: 'Dictionary lens' }).getByRole('button', { name: 'Read' }).click();
      await file.reload();
      await file.getByRole('group', { name: 'Dictionary lens' }).waitFor({ timeout: 15_000 });
      assert(await lensPressed(file, 'Read') === 'true', 'FAIL: a reload keeps the recipient\'s lens change instead of re-applying the snapshot');

      const exportedTheme = await settingsTheme(file);
      const recipientTheme = exportedTheme === 'dark' ? 'light' : 'dark';
      await settingsTheme(file, recipientTheme);
      assert(await settingsTheme(file) === recipientTheme, `FAIL: fixture: Settings switches the theme (stayed "${exportedTheme}")`);
      await file.reload();
      await file.getByRole('group', { name: 'Dictionary lens' }).waitFor({ timeout: 15_000 });
      const reloadedTheme = await settingsTheme(file);
      assert(reloadedTheme === recipientTheme, `FAIL: a reload keeps the recipient's theme (expected "${recipientTheme}", got "${reloadedTheme}")`);
    } finally {
      await recipient.close();
    }

    assert(pageErrors.length === 0, `FAIL: no page errors (got ${pageErrors.join(' | ')})`);
    console.log(process.exitCode ? '\nexport-as-seen: failures above.' : '\nAll export-as-seen checks passed.');
  } finally {
    await browser.close();
  }
} finally {
  handle.stop(true);
  rmSync(root, { recursive: true, force: true });
  clearTimeout(watchdog);
}
