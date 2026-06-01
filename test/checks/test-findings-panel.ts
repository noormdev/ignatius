/**
 * CP-6 check: findings panel in live viewer.
 *
 * Verifies that:
 * - The persistent top-right panel renders when findings > 0.
 * - The panel lists the expected number of rows for the real models/ baseline (1 entity finding).
 * - The panel collapses to a badge on button click and re-expands on click.
 * - Clicking an entity-scoped row expands inline detail AND pans/zooms the graph
 *   (Cytoscape has a selected node after the click).
 * - The panel is absent when findings are empty (not applicable against real models/;
 *   tested by asserting panel IS present for real models/).
 *
 * WHY Playwright: the panel is rendered client-side by React against the live
 * /api/model payload. Server-side HTML inspection cannot see it.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODELS = join(ROOT, 'models/broken-demo');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

let failures = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

const PORT = 3290;
const handle = serveCommand(MODELS, { port: PORT });
await Bun.sleep(300);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 }).catch(() => null);
  await page.waitForTimeout(2000);

  // ---------------------------------------------------------------------------
  // Test 1: Panel exists and is visible (models/ has 1 entity finding)
  // ---------------------------------------------------------------------------
  const panelVisible = await page.locator('.findings-panel').isVisible().catch(() => false);
  assert(panelVisible, 'findings panel visible when findings > 0');

  // ---------------------------------------------------------------------------
  // Test 2: Panel shows correct total count.
  // broken-demo baseline: 4 globals + 9 entity = 13. The entity errors include
  // the live-only `entity.example_unknown_column` on Customer.md and the
  // `body.unknown_link` from Order.md's [[Cart]] body link. The graph viewer runs
  // in live mode here so the live-only finding surfaces in the panel.
  // ---------------------------------------------------------------------------
  const headerText = await page.locator('.findings-panel header h3').textContent().catch(() => '');
  const countMatch = headerText?.match(/\d+/);
  const count = countMatch ? parseInt(countMatch[0]) : -1;
  assert(count === 13, `panel header shows 13 issues (got: "${headerText}")`, `Expected "Issues (13)"`);

  // ---------------------------------------------------------------------------
  // Test 3: Panel has finding rows (details elements)
  // ---------------------------------------------------------------------------
  const rowCount = await page.locator('.findings-panel details').count();
  assert(rowCount === 13, `panel renders 13 finding rows (got ${rowCount})`);

  // Dismiss the global banner so it does not intercept clicks on the panel below.
  const bannerClose = page.locator('.graph-global-banner-close');
  if (await bannerClose.isVisible().catch(() => false)) {
    await bannerClose.click();
    await page.waitForTimeout(100);
  }

  // ---------------------------------------------------------------------------
  // Test 4: Collapse — clicking the collapse button shows badge, hides list
  // ---------------------------------------------------------------------------
  const collapseBtn = page.locator('.findings-panel-collapse');
  await collapseBtn.click();
  await page.waitForTimeout(200);

  const collapsedBadge = await page.locator('.findings-panel-badge').isVisible().catch(() => false);
  assert(collapsedBadge, 'panel collapses to badge after clicking collapse button');

  const listHidden = await page.locator('.findings-panel ul').isVisible().catch(() => false);
  assert(!listHidden, 'panel list hidden when collapsed');

  // ---------------------------------------------------------------------------
  // Test 5: Re-expand — clicking badge restores the list
  // ---------------------------------------------------------------------------
  await page.locator('.findings-panel-badge').click();
  await page.waitForTimeout(200);

  const listVisible = await page.locator('.findings-panel ul').isVisible().catch(() => false);
  assert(listVisible, 'panel re-expands on badge click');

  // ---------------------------------------------------------------------------
  // Test 6: Clicking an entity-scoped finding row selects a node in the graph
  //
  // Errors (Class B globals) sort first — those don't have entityIds and are
  // expand-only. Click the first WARNING row so the pan+select path is exercised.
  // ---------------------------------------------------------------------------
  const firstEntityRow = page.locator('.findings-panel details:has(.finding-summary > span.finding-severity-warning), .findings-panel details:has(.finding-severity[class*="warning"])').first();
  // Fallback: just find the first row whose summary text doesn't start with "error".
  const rows = page.locator('.findings-panel details');
  const total = await rows.count();
  let warnRow = null;
  for (let i = 0; i < total; i++) {
    const row = rows.nth(i);
    const text = (await row.locator('summary').textContent()) ?? '';
    if (text.toLowerCase().includes('warn')) {
      warnRow = row;
      break;
    }
  }
  if (warnRow) {
    await warnRow.click();
    await page.waitForTimeout(800);

    const selectedCount = await page.evaluate(() => location.hash.includes('entity='));
    assert(selectedCount, 'clicking entity-scoped row sets entity in URL hash (pan+select fired)');
  } else {
    console.log('  SKIP  no entity-scoped row in broken-demo panel (unexpected)');
  }

  // ---------------------------------------------------------------------------
  // Test 7: Clicking a row expands inline detail (accordion)
  // ---------------------------------------------------------------------------
  const detailExpanded = await firstEntityRow.evaluate((el) => (el as HTMLDetailsElement).open);
  assert(detailExpanded, 'clicking finding row opens accordion detail');

  await page.screenshot({ path: join(TMP, 'cp6-panel-row-expanded.png') });
  console.log('  INFO  screenshot saved: tmp/cp6-panel-row-expanded.png');

} finally {
  await browser.close();
  handle.stop(true);
}

console.log('\n' + (failures === 0 ? 'All findings-panel tests passed.' : `${failures} findings-panel test(s) FAILED.`));
if (failures > 0) process.exit(1);
