/**
 * CP5 render-level assertions: fused Dictionary (entities + process model) in the SPA.
 *
 * Assertions:
 *  1. Switch to Dictionary view
 *  2. Entity sections still present (24 for key-inherited)
 *  3. Process sections present — key-inherited has order-to-cash + refund DFDs
 *  4. A db: endpoint in the process IO table links to an entity anchor (#entity-<id>)
 *  5. Search filters a process by name ("Place Order" → visible; no non-matching process)
 *  6. Clearing search restores all process sections
 *  7. No dialog present (process sections render inline)
 *  8. Screenshot dark + light for visual inspection
 *
 * Durable: written to test/visual/ (not tmp/).
 * Scratch screenshots: tmp/cp5-fused-dict-dark.png + tmp/cp5-fused-dict-light.png
 *
 * Run: bun test/visual/test-cp5-fused-dict.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const PORT = 7283;
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
  ['bun', 'src/cli/cli.ts', 'serve', 'models/key-inherited', '--port', String(PORT)],
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
  await page.waitForTimeout(800);

  // ── Step 2: Verify entity sections rendered ──
  note('Step 2: Verify entity sections rendered (24 expected)…');
  // Since CP9b, all section types use .dict-entity-section — narrow by id prefix for entities.
  const entitySections = page.locator('.dict-entity-section[id^="entity-"]');
  await entitySections.first().waitFor({ timeout: 5000 });
  const entityCount = await entitySections.count();
  assert(entityCount === 24, `Expected 24 entity sections, got ${entityCount}`);

  // ── Step 3: Verify process sections rendered ──
  note('Step 3: Verify process sections rendered…');
  // key-inherited has order-to-cash and refund DFDs with multiple processes each
  // Process sections now use .dict-entity-section (unified class family, CP9b).
  // We narrow by id prefix to distinguish process sections from entity sections.
  const processSections = page.locator('.dict-entity-section[id^="process-"]');
  const processCount = await processSections.count();
  // key-inherited has processes in both order-to-cash and refund DFDs
  assert(processCount >= 2, `Expected ≥ 2 process sections, got ${processCount}`);
  note(`  Found ${processCount} process sections`);

  // ── Step 4: Verify db: endpoint links to entity anchor ──
  note('Step 4: Verify db: endpoint links to entity anchor…');
  // The IO table for processes has db: endpoints that link to #entity-<id>
  const entityLinks = page.locator('.dict-io-table a[href*="#entity-"]');
  const entityLinkCount = await entityLinks.count();
  assert(entityLinkCount > 0, `Expected ≥ 1 db: endpoint linking to #entity-<id>, got ${entityLinkCount}`);
  // Check one of the links has a valid #entity-<id> format
  if (entityLinkCount > 0) {
    const href = await entityLinks.first().getAttribute('href');
    assert(
      href !== null && href.includes('#entity-'),
      `First db: link href should contain #entity-: got ${href}`,
    );
    note(`  Found db: link → ${href}`);
  }

  // ── Step 5: Search filters a process by name ──
  note('Step 5: Search filters process by name…');
  const searchInput = page.locator('.dict-search-input');
  if (await searchInput.count() === 0) fail('Search input (.dict-search-input) not found');

  // Search for "Issue Invoice" (full label) — the body-render removes non-matching
  // sections from the DOM entirely, so we assert on count(), not isVisible().
  // "Issue Invoice" is unique to the Issue Invoice process label; "Collect Payment"
  // shares no label words with it and won't appear.
  const searchTerm = 'Issue Invoice';
  note(`  Searching for "${searchTerm}"`);

  await searchInput.fill(searchTerm);
  await page.waitForTimeout(400);

  // The matching section must appear in the DOM (rendered).
  const issueInvoiceSection = page.locator('.dict-entity-section[id^="process-"]', { hasText: 'Issue Invoice' });
  const issueInvoiceCount = await issueInvoiceSection.count();
  assert(issueInvoiceCount === 1, `"Issue Invoice" process section present in DOM when searching "${searchTerm}" (got ${issueInvoiceCount})`);

  // A non-matching section ("Collect Payment") must be absent from the DOM.
  const collectPaymentSection = page.locator('.dict-entity-section[id^="process-"]', { hasText: 'Collect Payment' });
  const collectPaymentCount = await collectPaymentSection.count();
  assert(collectPaymentCount === 0, `"Collect Payment" process section absent from DOM when searching "${searchTerm}" (got ${collectPaymentCount})`);

  // ── Step 6: No dialog present ──
  note('Step 6: No dialog visible (process sections inline)…');
  const modalBackdrop = page.locator('.modal-backdrop');
  const modalVisible = await modalBackdrop.isVisible().catch(() => false);
  assert(!modalVisible, 'No modal-backdrop visible on dict view');
  const dialogEl = page.locator('dialog[open]');
  const dialogVisible = await dialogEl.isVisible().catch(() => false);
  assert(!dialogVisible, 'No <dialog open> visible on dict view');

  // ── Step 7: Clearing search restores all sections ──
  note('Step 7: Clear search restores all sections…');
  await searchInput.fill('');
  await page.waitForTimeout(400);
  const processAfterClear = await page.locator('.dict-entity-section[id^="process-"]').count();
  assert(processAfterClear === processCount, `All ${processCount} process sections restored after clearing search (got ${processAfterClear})`);
  const entityAfterClear = await page.locator('.dict-entity-section[id^="entity-"]').count();
  assert(entityAfterClear === 24, `All 24 entity sections restored after clearing search (got ${entityAfterClear})`);

  // ── Screenshots ──
  note('Taking screenshots…');
  const tmpDir = join(ROOT, 'tmp');
  try { mkdirSync(tmpDir, { recursive: true }); } catch {}

  // Dark screenshot
  await page.screenshot({ path: join(tmpDir, 'cp5-fused-dict-dark.png'), fullPage: false });
  note('  Saved: tmp/cp5-fused-dict-dark.png');

  // Light screenshot — click theme toggle
  const toggle = page.locator('.theme-toggle');
  if (await toggle.count() > 0) {
    await toggle.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(tmpDir, 'cp5-fused-dict-light.png'), fullPage: false });
    note('  Saved: tmp/cp5-fused-dict-light.png');
  }

  note('\nAll CP5 fused Dictionary assertions passed.');
} finally {
  await browser.close();
  proc.kill();
}
