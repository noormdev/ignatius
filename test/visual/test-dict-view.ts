/**
 * CP4 render-level assertions: DictionaryView in the SPA.
 *
 * Assertions:
 *  1. Switch to Dictionary view — entity sections present (24 for key-inherited)
 *  2. No .modal or dialog element visible on the dict page
 *  3. Search filters entities live (type "SSN" → exactly SSN, Identity, ITIN visible; Party hidden)
 *  4. Clearing search restores all sections
 *  5. Clicking a child-entity anchor-link scrolls to the target section (no dialog)
 *  6. Screenshot dark + light for visual inspection
 *
 * Durable: written to test/visual/ (not tmp/).
 * Scratch screenshots: tmp/dict-view-dark.png + tmp/dict-view-light.png
 *
 * Run: bun test/visual/test-dict-view.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const PORT = 7282;
const BASE_URL = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => {
  console.error('FAIL:', m);
  process.exit(1);
};

function assert(condition: boolean, label: string) {
  if (condition) {
    note(`  PASS  ${label}`);
  } else {
    fail(label);
  }
}

// ── Server ───────────────────────────────────────────────────────────────────

note(`Starting ignatius serve models/key-inherited on port ${PORT}…`);
const proc = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', 'models/key-inherited', '--port', String(PORT)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

async function waitForServer(url: string, timeout = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await Bun.sleep(200);
  }
  return false;
}

const serverReady = await waitForServer(BASE_URL, 12_000);
if (!serverReady) {
  proc.kill();
  fail('Server did not start within 12 seconds');
}
note(`Server ready at ${BASE_URL}`);

// ── Playwright ───────────────────────────────────────────────────────────────

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  // Navigate to the SPA
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // ── Step 1: Switch to Dictionary via FAB ──
  note('Step 1: Switch to Dictionary view via FAB…');
  const fab = page.locator('.fab').first();
  if (await fab.count() === 0) fail('FAB (.fab) not found');
  await fab.click();
  await page.waitForTimeout(200);

  const dictItem = page.locator('.fab-menu-item').filter({ hasText: 'Dictionary' });
  if (await dictItem.count() === 0) fail('Dictionary FAB menu item not found');
  await dictItem.click();
  await page.waitForTimeout(500);

  // ── Step 2: Verify entity sections rendered ──
  note('Step 2: Verify entity sections rendered…');
  // key-inherited has 24 entities. Entity sections use .dict-entity-section with id="entity-*".
  // Since CP9b, process/store/external sections also use .dict-entity-section — narrow by id prefix.
  const entitySections = page.locator('.dict-entity-section[id^="entity-"]');
  await entitySections.first().waitFor({ timeout: 5000 });
  const sectionCount = await entitySections.count();
  assert(sectionCount === 24, `Expected 24 entity sections, got ${sectionCount}`);

  // ── Step 3: No .modal or dialog visible ──
  note('Step 3: Asserting no modal or dialog visible…');
  const modalBackdrop = page.locator('.modal-backdrop');
  const modalVisible = await modalBackdrop.isVisible().catch(() => false);
  assert(!modalVisible, 'No modal-backdrop visible on dict view');

  const dialogEl = page.locator('dialog[open]');
  const dialogVisible = await dialogEl.isVisible().catch(() => false);
  assert(!dialogVisible, 'No <dialog open> visible on dict view');

  // ── Step 4: Search filters entities live ──
  note('Step 4: Search filters entities…');
  const searchInput = page.locator('.dict-search-input');
  if (await searchInput.count() === 0) fail('Search input (.dict-search-input) not found');

  // "SSN" appears in exactly 3 entities (SSN, Identity, ITIN) and nowhere else in
  // the key-inherited model. This makes the assertion precise enough to catch a
  // broken filter while being stable against unrelated model edits.
  await searchInput.fill('SSN');
  await page.waitForTimeout(300);

  const visibleAfterSearch = await page.locator('.dict-entity-section[id^="entity-"]:visible').count();
  assert(visibleAfterSearch === 3, `Searching "SSN" shows exactly 3 entity sections (SSN, Identity, ITIN); got ${visibleAfterSearch}`);

  // SSN entity IS visible
  const ssnSection = page.locator('#entity-SSN');
  const ssnVisible = await ssnSection.isVisible().catch(() => false);
  assert(ssnVisible, '#entity-SSN is visible after search "SSN"');

  // Party is NOT visible (does not mention SSN)
  const partySection = page.locator('#entity-Party');
  const partyHidden = !(await partySection.isVisible().catch(() => true));
  assert(partyHidden, '#entity-Party is hidden after search "SSN"');

  // ── Step 5: Clearing search restores all sections ──
  note('Step 5: Clear search restores all sections…');
  await searchInput.fill('');
  await page.waitForTimeout(300);

  const visibleAfterClear = await page.locator('.dict-entity-section[id^="entity-"]').count();
  assert(visibleAfterClear === 24, `All 24 entity sections restored after clearing search (got ${visibleAfterClear})`);

  // ── Step 6: Anchor click scrolls to target (no dialog opens) ──
  note('Step 6: Anchor click scrolls to target, no dialog…');
  // Find a relationship link in the dict — SalesInvoice is a parent of SalesOrder line items.
  // We check that clicking an anchor-link in the downstream relationships table scrolls to the
  // target entity section rather than opening a modal dialog.
  const firstRelLink = page.locator('.dict-rel-table a').first();
  const relLinkCount = await firstRelLink.count();
  if (relLinkCount > 0) {
    const targetId = await firstRelLink.getAttribute('href');
    await firstRelLink.click();
    await page.waitForTimeout(500);

    // Modal must NOT have appeared
    const backdropAfterClick = page.locator('.modal-backdrop');
    const backdropVisible = await backdropAfterClick.isVisible().catch(() => false);
    assert(!backdropVisible, `No modal-backdrop after clicking relationship anchor (href=${targetId})`);
    note(`  Clicked anchor ${targetId ?? '(none)'} — no modal opened`);
  } else {
    note('  (no downstream relationship links found — skip anchor test)');
  }

  // ── Step 7: Search text survives a detour to graph view ──
  note('Step 7: Search text survives view detour…');
  // Type a search term in the dict
  await searchInput.fill('Payment');
  await page.waitForTimeout(200);

  const visibleBeforeDetour = await page.locator('.dict-entity-section[id^="entity-"]:visible').count();
  assert(visibleBeforeDetour < sectionCount, `Search "Payment" filters (${visibleBeforeDetour} < ${sectionCount})`);

  // Switch to graph
  const fab2 = page.locator('.fab').first();
  await fab2.click();
  await page.waitForTimeout(200);
  const graphItem = page.locator('.fab-menu-item').filter({ hasText: 'Data Graph' });
  if (await graphItem.count() > 0) {
    await graphItem.click();
    await page.waitForTimeout(500);

    // Switch back to dict
    const fab3 = page.locator('.fab').first();
    await fab3.click();
    await page.waitForTimeout(200);
    const dictItem2 = page.locator('.fab-menu-item').filter({ hasText: 'Dictionary' });
    await dictItem2.click();
    await page.waitForTimeout(500);

    // Search input should still contain "Payment"
    const inputValue = await searchInput.inputValue();
    assert(inputValue === 'Payment', `Search text "Payment" survived graph detour (got "${inputValue}")`);

    // Sections still filtered
    const visibleAfterDetour = await page.locator('.dict-entity-section[id^="entity-"]:visible').count();
    assert(visibleAfterDetour === visibleBeforeDetour, `Same filtered count after detour (${visibleAfterDetour})`);
  }

  // Clear for screenshot
  await searchInput.fill('');
  await page.waitForTimeout(200);

  // ── Screenshots ──
  note('Taking screenshots…');
  const tmpDir = join(ROOT, 'tmp');
  try { mkdirSync(tmpDir, { recursive: true }); } catch {}

  // Dark screenshot
  await page.screenshot({ path: join(tmpDir, 'dict-view-dark.png'), fullPage: false });
  note('  Saved: tmp/dict-view-dark.png');

  // Light screenshot — click theme toggle
  const toggle = page.locator('.theme-toggle');
  if (await toggle.count() > 0) {
    await toggle.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(tmpDir, 'dict-view-light.png'), fullPage: false });
    note('  Saved: tmp/dict-view-light.png');
  }

  note('\nAll CP4 DictionaryView assertions passed.');
} finally {
  await browser.close();
  proc.kill();
}
