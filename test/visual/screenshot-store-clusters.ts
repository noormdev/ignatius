/**
 * Visual verification: the stacked store node, StackDialog, and the CP6
 * contract-dialog upgrade (docs/spec/dfd-store-clusters.md).
 *
 * Screenshots hub-diagram in:
 *  1. the default per-process view (dark, then light)
 *  2. the connected view at the "clusters" collapse level (dark)
 *  3. the connected view with an open StackDialog on the adjacency stack
 *     (dark, then light)
 *
 * Screenshots models/llm-memory-db-mssql's tag-administration diagram:
 *  4. the Merge Tag stack edge's "Tag junctions" chip (connected view)
 *  5. the stack edge's contract dialog, listing all four junction tables
 *     (dark, then light)
 *  6. the default per-process view's Merge Tag write chip — mixed labelled/
 *     unlabelled members — and its contract dialog (all 6 stores)
 *  7. an ext: edge's contract dialog (label lines only)
 *
 * Both views at every collapse level (dark), plus the FAB view/collapse
 * controls themselves (both themes), under tmp/cp7-shots/.
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'test/fixtures/hub-dfd');
const TMP = join(ROOT, 'tmp/cp5-shots');
mkdirSync(TMP, { recursive: true });
const TAG_MODEL = join(ROOT, 'models/llm-memory-db-mssql');
const TAG_TMP = join(ROOT, 'tmp/cp6-shots');
mkdirSync(TAG_TMP, { recursive: true });
const VIEW_TOGGLE_TMP = join(ROOT, 'tmp/cp7-shots');
mkdirSync(VIEW_TOGGLE_TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

const PORT = 3303;
const handle = serveCommand(MODEL, { port: PORT });

async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise<void>(r => setTimeout(r, 100));
  }
  fail(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}
await waitForServer(`http://localhost:${PORT}/`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

async function shotAt(target: Page, dir: string, name: string): Promise<void> {
  const p = join(dir, name);
  await target.screenshot({ path: p, fullPage: false });
  note(`Screenshot: ${p}`);
}
const shot = (name: string) => shotAt(page, TMP, name);

async function waitFlowReady(): Promise<void> {
  await page.waitForFunction(() => !!(window as { __IGNATIUS_FLOW_READY__?: unknown }).__IGNATIUS_FLOW_READY__, { timeout: 20_000 });
  await page.waitForSelector('[data-ignatius="flow-svg"]', { timeout: 10_000 });
  await page.waitForTimeout(400); // let ELK settle
}

async function toggleTheme(): Promise<void> {
  await page.locator('.theme-toggle').click();
  await page.waitForTimeout(200);
}

try {
  // 1. Default per-process view, dark.
  await page.goto(`http://localhost:${PORT}/#view=flow&dfd=hub-diagram`, { waitUntil: 'load' });
  await waitFlowReady();
  await shot('01-per-process-dark.png');

  // 1b. Same view, light.
  await toggleTheme();
  await shot('02-per-process-light.png');
  await toggleTheme();

  // 2. Connected view at the "clusters" collapse level — a fresh navigation is
  // required: App reads flowview=/collapse= from the hash on mount and
  // reconciles them live on Back/Forward, but a plain hash-only page.goto is
  // a same-document navigation, not a popstate event, so it retriggers neither.
  await page.goto('about:blank');
  await page.goto(`http://localhost:${PORT}/#view=flow&dfd=hub-diagram&flowview=connected&collapse=clusters`, { waitUntil: 'load' });
  await waitFlowReady();
  await shot('03-connected-clusters-dark.png');

  // 3. Open StackDialog on the adjacency stack (LogStoreOne/LogStoreTwo).
  const ADJACENCY_STACK = 'stack:db:LogStoreOne+db:LogStoreTwo--write';
  await page.waitForSelector(`g[data-token="${ADJACENCY_STACK}"]`, { timeout: 10_000 });
  await page.locator(`g[data-token="${ADJACENCY_STACK}"]`).first().click();
  await page.waitForSelector('.modal', { timeout: 5000 });
  await shot('04-stack-dialog-adjacency-dark.png');

  // 3b. Same dialog, light — close first: the theme toggle sits behind the
  // modal backdrop.
  await page.locator('.modal-close').first().click();
  await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
  await toggleTheme();
  await page.locator(`g[data-token="${ADJACENCY_STACK}"]`).first().click();
  await page.waitForSelector('.modal', { timeout: 5000 });
  await shot('05-stack-dialog-adjacency-light.png');
  await page.locator('.modal-close').first().click();
  await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
  await toggleTheme(); // back to dark

  // Both views at every collapse level, dark theme.
  const COLLAPSE_LEVELS = ['stores', 'clusters', 'groups'] as const;
  for (const view of ['per-process', 'connected'] as const) {
    for (const level of COLLAPSE_LEVELS) {
      await page.goto('about:blank');
      await page.goto(`http://localhost:${PORT}/#view=flow&dfd=hub-diagram&flowview=${view}&collapse=${level}`, { waitUntil: 'load' });
      await waitFlowReady();
      await shotAt(page, VIEW_TOGGLE_TMP, `${view}-${level}-dark.png`);
    }
  }

  // The FAB view/collapse-level controls themselves, both themes.
  await page.goto('about:blank');
  await page.goto(`http://localhost:${PORT}/#view=flow&dfd=hub-diagram`, { waitUntil: 'load' });
  await waitFlowReady();
  await page.locator('.fab').click();
  await page.waitForSelector('.fab-menu', { timeout: 5000 });
  await shotAt(page, VIEW_TOGGLE_TMP, 'fab-menu-dark.png');
  await page.keyboard.press('Escape');
  await toggleTheme();
  await page.locator('.fab').click();
  await page.waitForSelector('.fab-menu', { timeout: 5000 });
  await shotAt(page, VIEW_TOGGLE_TMP, 'fab-menu-light.png');
  await toggleTheme();
} finally {
  await page.close();
  await browser.close();
  handle.stop();
}

// ---------------------------------------------------------------------------
// tag-administration: the Merge Tag cluster's stack edge — chip and contract
// dialog (CP6).
// ---------------------------------------------------------------------------

const TAG_PORT = 3304;
const tagHandle = serveCommand(TAG_MODEL, { port: TAG_PORT });
await waitForServer(`http://localhost:${TAG_PORT}/`);

const tagBrowser = await chromium.launch();
const tagPage = await tagBrowser.newPage({ viewport: { width: 1600, height: 1000 } });

try {
  // Connected view: the cluster-tag grouping node (`cluster:tag-junctions--write`)
  // aggregates only the four cluster members, matching the success criterion.
  // The default per-process view folds Merge Tag's *entire* write set (including
  // its unrelated db:Tag / db:Memory_Tag outputs) into one stack instead.
  await tagPage.goto(`http://localhost:${TAG_PORT}/#view=flow&dfd=tag-administration&flowview=connected&collapse=clusters`, { waitUntil: 'load' });
  await tagPage.waitForFunction(() => !!(window as { __IGNATIUS_FLOW_READY__?: unknown }).__IGNATIUS_FLOW_READY__, { timeout: 20_000 });
  await tagPage.waitForSelector('[data-ignatius="flow-svg"]', { timeout: 10_000 });
  await tagPage.waitForTimeout(400);

  const tagChip = tagPage.locator('[data-ignatius="flow-chip"]', { hasText: 'Tag junctions' }).first();
  await tagChip.waitFor({ timeout: 10_000 });
  await shotAt(tagPage, TAG_TMP, '06-tag-junctions-chip-dark.png');

  await tagChip.click();
  await tagPage.waitForSelector('.modal', { timeout: 5000 });
  await shotAt(tagPage, TAG_TMP, '07-tag-junctions-contract-dark.png');

  await tagPage.locator('.modal-close').first().click();
  await tagPage.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
  await tagPage.locator('.theme-toggle').click();
  await tagPage.waitForTimeout(200);
  await tagChip.click();
  await tagPage.waitForSelector('.modal', { timeout: 5000 });
  await shotAt(tagPage, TAG_TMP, '08-tag-junctions-contract-light.png');
  await tagPage.locator('.modal-close').first().click();
  await tagPage.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
  await tagPage.locator('.theme-toggle').click(); // back to dark
  await tagPage.waitForTimeout(200);

  // Default per-process view: Merge Tag's write side is one stack (all 6
  // stores it touches), whose chip mixes the cluster's authored label with
  // the two unlabelled db:Tag / db:Memory_Tag outputs' own column previews.
  await tagPage.goto('about:blank');
  await tagPage.goto(`http://localhost:${TAG_PORT}/#view=flow&dfd=tag-administration`, { waitUntil: 'load' });
  await tagPage.waitForFunction(() => !!(window as { __IGNATIUS_FLOW_READY__?: unknown }).__IGNATIUS_FLOW_READY__, { timeout: 20_000 });
  await tagPage.waitForSelector('[data-ignatius="flow-svg"]', { timeout: 10_000 });
  await tagPage.waitForTimeout(400);

  const mergeTagWriteChip = tagPage.locator('[data-ignatius="flow-chip"]', { hasText: 'Tag junctions' }).first();
  await mergeTagWriteChip.waitFor({ timeout: 10_000 });
  await shotAt(tagPage, TAG_TMP, '09-per-process-merge-tag-chip-dark.png');

  await mergeTagWriteChip.click();
  await tagPage.waitForSelector('.modal', { timeout: 5000 });
  await shotAt(tagPage, TAG_TMP, '10-per-process-merge-tag-contract-dark.png');
  await tagPage.locator('.modal-close').first().click();
  await tagPage.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

  // An ext: edge's contract dialog — label lines only, no group/store/type
  // columns. Create Tag's output to ext:LLM-Agent ("newly assigned tag_id").
  const extChip = tagPage.locator('[data-ignatius="flow-chip"]', { hasText: 'newly assigned tag_id' }).first();
  await extChip.waitFor({ timeout: 10_000 });
  await extChip.click();
  await tagPage.waitForSelector('.modal', { timeout: 5000 });
  await shotAt(tagPage, TAG_TMP, '11-ext-contract-dark.png');
} finally {
  await tagPage.close();
  await tagBrowser.close();
  tagHandle.stop();
}

note('\nDone. Look at the screenshots before trusting this render.');
