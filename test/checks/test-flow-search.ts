/**
 * test-flow-search.ts — CI-runnable Playwright check for the Flows search bar
 * (graph-flow-search CP3): cross-diagram dropdown, sub-DFD navigation,
 * in-diagram dim/highlight via searchTokens, body-toggle opt-in, the display
 * cap's "+N more" overflow line, and the SC9 no-persistence guarantee.
 *
 * Serves models/key-inherited, whose flows/order-to-cash carries a
 * "Create-Sales-Order" sub-DFD (Validate-Customer, Record-Order) plus a
 * sibling refund/Process-Return flow. Expected match sets are computed
 * directly via parseFlows + CP1's searchFlowDiagrams (the same source data
 * the server parses) rather than hardcoded, so the assertions stay correct
 * if the fixture model ever changes.
 *
 * Skips gracefully (exit 0) when dist/static/index.js is absent — CI builds
 * before running checks.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from '../../src/server/server';
import { parseFlows } from '../../src/flows/flow-parse';
import { searchFlowDiagrams } from '../../src/app/logic/search';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

let failures = 0;

function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

// ---------------------------------------------------------------------------
// Expected match sets — computed from the same fixture data the server
// parses, via CP1's pure matcher (already unit-proven in test-viewer-search.ts).
// ---------------------------------------------------------------------------

const { flowModel } = await parseFlows(MODEL);

const validateResults = searchFlowDiagrams(flowModel.diagrams, 'Validate', false);
assert(validateResults.length === 1, 'fixture sanity: "Validate" matches exactly one flow node', `got ${validateResults.length}`);
const validateResult = validateResults[0];
assert(validateResult?.kind === 'process' && validateResult.diagramId === 'Create-Sales-Order', 'fixture sanity: match is the process living in the Create-Sales-Order sub-DFD');

const visaBodyOff = searchFlowDiagrams(flowModel.diagrams, 'Visa', false);
assert(visaBodyOff.length === 0, 'fixture sanity: "Visa" (body-only text) has no title-field match', `got ${visaBodyOff.length}`);
const visaBodyOn = searchFlowDiagrams(flowModel.diagrams, 'Visa', true);
assert(visaBodyOn.length === 1 && visaBodyOn[0]?.diagramId === 'order-to-cash', 'fixture sanity: "Visa" matches Collect Payment\'s body when body search is on', JSON.stringify(visaBodyOn));

const manyResults = searchFlowDiagrams(flowModel.diagrams, 'e', false);
assert(manyResults.length > 20, 'fixture sanity: "e" produces more than the display cap', `got ${manyResults.length}`);

// ---------------------------------------------------------------------------

const PORT = 3298;
const handle = serveCommand(MODEL, { port: PORT });
await new Promise<void>(r => setTimeout(r, 400));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(`http://localhost:${PORT}/#view=flow`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as { __IGNATIUS_FLOW_READY__?: unknown }).__IGNATIUS_FLOW_READY__, { timeout: 20_000 });
  await page.waitForSelector('.viewer-search-bar--flow', { timeout: 10_000 });
  await page.waitForTimeout(1000); // let the initial diagram settle

  // graph-flow-search CP5 (SC5): the body-text opt-in is a labeled toggle
  // switch, not the old bare "Body" pill button — role="switch", aria-checked,
  // and a visible "Include descriptions" label.
  const bodySwitch = page.getByRole('switch', { name: 'Include descriptions' });
  await bodySwitch.waitFor({ state: 'visible', timeout: 5000 });
  assert(await bodySwitch.getAttribute('aria-checked') === 'false', 'SC5: body switch starts unchecked (aria-checked="false")');

  // ---------------------------------------------------------------------
  // SC9 (baseline) — capture hash + flow-layout localStorage BEFORE any
  // search interaction, and re-check after typing/toggling (not after the
  // navigation click below, which legitimately writes dfd= via the
  // pre-existing selectDiagramById → onActiveDiagramChange path).
  // ---------------------------------------------------------------------
  const hashBefore = await page.evaluate(() => location.hash);
  const flowLayoutBefore = await page.evaluate(() => localStorage.getItem('ignatius-flow-layout-positions'));

  // ---------------------------------------------------------------------
  // SC6 — typing "Validate" lists the sub-DFD process: kind, dotted number,
  // label, and owning diagram title (as a group header).
  // ---------------------------------------------------------------------
  await page.fill('.viewer-search-input', 'Validate');
  await page.waitForSelector('.viewer-search-result-row[data-token="proc:Validate-Customer"]', { timeout: 5000 });

  const row = await page.evaluate(() => {
    const el = document.querySelector('.viewer-search-result-row[data-token="proc:Validate-Customer"]');
    const group = el?.closest('.viewer-search-results-group');
    return {
      rowCount: document.querySelectorAll('.viewer-search-result-row').length,
      rowText: el?.textContent ?? '',
      groupTitle: group?.querySelector('.viewer-search-results-group-title')?.textContent ?? '',
      kind: el?.querySelector('.viewer-search-result-kind')?.textContent ?? '',
    };
  });
  assert(row.rowCount === 1, 'SC6: exactly one dropdown row for "Validate"', `got ${row.rowCount}`);
  assert(row.rowText.includes('1.1.1'), 'SC6: row shows the dotted number', row.rowText);
  assert(row.rowText.includes('Validate Customer'), 'SC6: row shows the label', row.rowText);
  assert(row.groupTitle === 'Create Sales Order', 'SC6: row is grouped under its owning diagram title', row.groupTitle);
  assert(row.kind === 'P', 'SC6: row shows the process kind marker', row.kind);

  // Toggle body on/off — exercised here (no title-field-vs-body ambiguity
  // for this term) purely to prove it doesn't disturb hash/localStorage.
  await bodySwitch.click();
  await page.waitForTimeout(200);
  await bodySwitch.click();
  await page.waitForTimeout(200);

  const hashAfterSearch = await page.evaluate(() => location.hash);
  const flowLayoutAfterSearch = await page.evaluate(() => localStorage.getItem('ignatius-flow-layout-positions'));
  assert(hashAfterSearch === hashBefore, 'SC9: URL hash unchanged while searching (flow bar)', `before="${hashBefore}" after="${hashAfterSearch}"`);
  assert(flowLayoutAfterSearch === flowLayoutBefore, 'SC9: ignatius-flow-layout-positions unchanged while searching');

  // ---------------------------------------------------------------------
  // SC6 — clicking the row navigates into the sub-DFD (active diagram +
  // the diagram actually renders that sub-DFD's own nodes).
  // ---------------------------------------------------------------------
  await page.click('.viewer-search-result-row[data-token="proc:Validate-Customer"]');
  await page.waitForFunction(
    () => (window as { __IGNATIUS_ACTIVE_FLOW_DFD__?: string }).__IGNATIUS_ACTIVE_FLOW_DFD__ === 'Create-Sales-Order',
    { timeout: 10_000 },
  );
  await page.waitForSelector('[data-token="proc:Record-Order"]', { timeout: 10_000 });
  assert(true, 'SC6: clicking the row navigates to the owning sub-DFD (active diagram + rendered nodes)');

  // ---------------------------------------------------------------------
  // SC7 — non-matching node (Record-Order) at DIM_OPACITY, matching node
  // (Validate-Customer) at full opacity.
  // ---------------------------------------------------------------------
  const opacitiesAfterNav = await page.evaluate(() => ({
    validate: document.querySelector('[data-token="proc:Validate-Customer"]')?.getAttribute('opacity'),
    record: document.querySelector('[data-token="proc:Record-Order"]')?.getAttribute('opacity'),
  }));
  assert(opacitiesAfterNav.validate === '1', 'SC7: matching node (Validate Customer) renders at full opacity', JSON.stringify(opacitiesAfterNav));
  assert(opacitiesAfterNav.record === '0.3', 'SC7: non-matching node (Record Order) renders at DIM_OPACITY', JSON.stringify(opacitiesAfterNav));

  // Hover wins while active; release restores the search dim.
  await page.locator('[data-token="proc:Record-Order"]').hover();
  await page.waitForFunction(
    () => document.querySelector('[data-token="proc:Record-Order"]')?.getAttribute('opacity') === '1',
    { timeout: 5000 },
  );
  assert(true, 'SC7: hovering a dimmed node temporarily overrides search dim (opacity → 1)');

  await page.mouse.move(20, 20);
  await page.waitForFunction(
    () => document.querySelector('[data-token="proc:Record-Order"]')?.getAttribute('opacity') === '0.3',
    { timeout: 5000 },
  );
  assert(true, 'SC7: releasing hover restores the search dim');

  // ---------------------------------------------------------------------
  // Clear restores everything (in-diagram half) — dropdown closes, both
  // nodes return to full opacity, and the breadcrumb still shows the
  // sub-DFD path we navigated into (proves the SVG/chrome state, not the
  // search state, drives navigation).
  // ---------------------------------------------------------------------
  await page.fill('.viewer-search-input', '');
  await page.waitForFunction(() => document.querySelectorAll('.viewer-search-results').length === 0, { timeout: 5000 });

  const opacitiesAfterClear = await page.evaluate(() => ({
    validate: document.querySelector('[data-token="proc:Validate-Customer"]')?.getAttribute('opacity'),
    record: document.querySelector('[data-token="proc:Record-Order"]')?.getAttribute('opacity'),
  }));
  assert(opacitiesAfterClear.validate === '1' && opacitiesAfterClear.record === '1', 'clearing the term restores full opacity to every node', JSON.stringify(opacitiesAfterClear));

  const breadcrumbHasSubDfd = (await page.locator('body').textContent())?.includes('Create Sales Order') ?? false;
  assert(breadcrumbHasSubDfd, 'SC6: breadcrumb reflects the sub-DFD path after navigation');

  // ---------------------------------------------------------------------
  // SC5 (flow half) — body toggle opt-in, plus Enter navigates to the
  // first (only) result's diagram.
  // ---------------------------------------------------------------------
  await page.fill('.viewer-search-input', 'Visa');
  await page.waitForTimeout(400);
  const visaOffRowCount = await page.locator('.viewer-search-result-row').count();
  assert(visaOffRowCount === 0, 'SC5: body-only term does not match with the body toggle off', `got ${visaOffRowCount}`);

  await bodySwitch.click(); // on
  assert(await bodySwitch.getAttribute('aria-checked') === 'true', 'SC5: body switch reports aria-checked="true" once on');
  await page.waitForSelector('.viewer-search-result-row[data-token="proc:Collect-Payment"]', { timeout: 5000 });
  const visaOnRow = await page.evaluate(() => {
    const el = document.querySelector('.viewer-search-result-row[data-token="proc:Collect-Payment"]');
    const group = el?.closest('.viewer-search-results-group');
    return {
      groupTitle: group?.querySelector('.viewer-search-results-group-title')?.textContent ?? '',
    };
  });
  assert(visaOnRow.groupTitle === 'Order To Cash', 'SC5: toggling body on matches Collect Payment via its prose body', JSON.stringify(visaOnRow));

  // Enter opens the first (only) result — navigates to order-to-cash.
  await page.locator('.viewer-search-input').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => (window as { __IGNATIUS_ACTIVE_FLOW_DFD__?: string }).__IGNATIUS_ACTIVE_FLOW_DFD__ === 'order-to-cash',
    { timeout: 10_000 },
  );
  assert(true, 'SC6: Enter opens the first dropdown row and navigates there');

  await bodySwitch.click(); // back off

  // ---------------------------------------------------------------------
  // SC6 — display cap: "+N more" overflow line, verified against the
  // independently-computed total (not a hardcoded cap value).
  // ---------------------------------------------------------------------
  await page.fill('.viewer-search-input', 'e');
  await page.waitForSelector('.viewer-search-results-overflow', { timeout: 5000 });

  const overflowInfo = await page.evaluate(() => ({
    shownRows: document.querySelectorAll('.viewer-search-result-row').length,
    overflowText: document.querySelector('.viewer-search-results-overflow')?.textContent ?? '',
  }));
  const overflowMatch = overflowInfo.overflowText.match(/^\+(\d+) more$/);
  assert(overflowMatch !== null, 'SC6: overflow line renders "+N more"', `got "${overflowInfo.overflowText}"`);
  if (overflowMatch) {
    const overflowN = parseInt(overflowMatch[1]!, 10);
    assert(
      overflowInfo.shownRows + overflowN === manyResults.length,
      'SC6: shown rows + overflow N equals the total match count',
      `shown=${overflowInfo.shownRows} overflow=${overflowN} total=${manyResults.length}`,
    );
  }

  // ---------------------------------------------------------------------
  // Clear restores everything (dropdown half).
  // ---------------------------------------------------------------------
  await page.fill('.viewer-search-input', '');
  await page.waitForTimeout(300);
  const dropdownGone = await page.locator('.viewer-search-results').count();
  assert(dropdownGone === 0, 'clearing the term removes the results dropdown', `got ${dropdownGone} elements`);

} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  failures++;
} finally {
  await page.close();
  await browser.close();
  handle.stop();
}

// ---------------------------------------------------------------------------
// SC12 (CP5) — flow-chrome non-collision: the search bar never overlaps the
// DFD breadcrumb chip row, at any breadcrumb depth. Mirrors the
// banner-collision idiom above. test/fixtures/flows-leveling drills 3 levels
// deep (auth → Authenticate → Login), rendering the full breadcrumb chain
// ("Process Flows" root chip + auth + Authenticate + Login = 4 chips) — the
// reported collision scenario. Deep-links straight to the deepest diagram via
// the #dfd= hash param (the same path selectDiagramById/findDiagramPath use
// for a sub-DFD id) rather than clicking through two drill-downs.
// ---------------------------------------------------------------------------

const LEVELING_MODEL = join(ROOT, 'test/fixtures/flows-leveling');
const LEVELING_PORT = 3299;
const levelingHandle = serveCommand(LEVELING_MODEL, { port: LEVELING_PORT });
await new Promise<void>(r => setTimeout(r, 400));

const levelingBrowser = await chromium.launch();
const levelingPage = await levelingBrowser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await levelingPage.goto(`http://localhost:${LEVELING_PORT}/#view=flow&dfd=Login`, { waitUntil: 'load' });
  await levelingPage.waitForFunction(() => !!(window as { __IGNATIUS_FLOW_READY__?: unknown }).__IGNATIUS_FLOW_READY__, { timeout: 20_000 });
  await levelingPage.waitForSelector('.viewer-search-bar--flow', { timeout: 10_000 });
  await levelingPage.waitForFunction(
    () => (window as { __IGNATIUS_ACTIVE_FLOW_DFD__?: string }).__IGNATIUS_ACTIVE_FLOW_DFD__ === 'Login',
    { timeout: 10_000 },
  );
  await levelingPage.waitForTimeout(500); // let the breadcrumb-offset ResizeObserver settle

  const barBox = await levelingPage.locator('.viewer-search-bar--flow').boundingBox();
  const crumbBox = await levelingPage.locator('[data-ignatius="flow-breadcrumbs"]').boundingBox();
  assert(barBox !== null, 'SC12: search bar has a bounding box');
  assert(crumbBox !== null, 'SC12: breadcrumb chip row has a bounding box');

  if (barBox && crumbBox) {
    const intersects =
      barBox.x < crumbBox.x + crumbBox.width &&
      barBox.x + barBox.width > crumbBox.x &&
      barBox.y < crumbBox.y + crumbBox.height &&
      barBox.y + barBox.height > crumbBox.y;
    assert(
      !intersects,
      'SC12: search bar bounding box does not intersect the breadcrumb chip row at full drill depth',
      `bar=${JSON.stringify(barBox)} crumbs=${JSON.stringify(crumbBox)}`,
    );
    assert(
      barBox.y >= crumbBox.y + crumbBox.height,
      'SC12: search bar sits fully below the breadcrumb chip row',
      `bar.y=${barBox.y} crumbs.bottom=${crumbBox.y + crumbBox.height}`,
    );
  }

  // Playwright's click() actionability check fails if the target point is
  // covered by another element — a successful click + type proves the bar is
  // visible AND clickable, not just geometrically clear (mirrors the
  // banner-collision idiom's clickability proof).
  await levelingPage.locator('.viewer-search-input').click();
  await levelingPage.keyboard.type('Login');
  await levelingPage.waitForTimeout(400);
  const typedValue = await levelingPage.locator('.viewer-search-input').inputValue();
  assert(
    typedValue === 'Login',
    'SC12: search input is visible and clickable at full breadcrumb depth',
    `got "${typedValue}"`,
  );
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  failures++;
} finally {
  await levelingPage.close();
  await levelingBrowser.close();
  levelingHandle.stop();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nCP3 flow-search: all assertions passed.');
process.exit(0);
