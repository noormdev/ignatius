/**
 * CP25 visual assertion: clickable IO endpoints in the DD process card.
 *
 * The DD card for `1.1 Validate Customer` previously rendered all non-db
 * endpoints as plain text. CP25 wires `onOpenToken`/`canOpenToken` into
 * `DictProcessSection`'s `FlowIoTable` so external + non-entity-store
 * endpoints link to their DD section.
 *
 * Assertions:
 *  (a) In the DD card for `1.1 Validate Customer`:
 *      - Customer (ext:Customer) renders as `.entity-link` → clicks scroll
 *        to `#external-Customer`.
 *      - OrderIntake (queue:OrderIntake) stays plain text — no `_stores/`
 *        file exists so there is no DD section to link to (correct per spec:
 *        "unresolvable stay plain").
 *      - db:Party endpoint is unchanged (still links as an entity).
 *
 *  (b) The process DIALOG (opened from the Flows view sub-DFD) also shows
 *      Customer as a link — via the existing CP20 resolver. Verifies the
 *      sub-DFD dialog path is not broken.
 *
 * Light + dark. Uses models/key-inherited (order-to-cash sub-DFD).
 *
 * Run: bun test/visual/test-cp25-dd-endpoint-links.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp25-dd-endpoint-links');
mkdirSync(TMP, { recursive: true });

const PORT = 7425;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

function assert(cond: boolean, label: string) {
  if (cond) { note(`  PASS  ${label}`); } else { fail(label); }
}

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
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

const serverReady = await waitForServer(BASE, 12_000);
if (!serverReady) fail('Server did not start within 12 seconds');
note(`Server ready at ${BASE}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function shot(name: string): Promise<void> {
  const p = join(TMP, name);
  await page.screenshot({ path: p, fullPage: false });
  note(`Screenshot: ${p}`);
}

async function setTheme(theme: 'dark' | 'light'): Promise<void> {
  const currentTheme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme') ?? 'dark',
  );
  if (currentTheme !== theme) {
    await page.locator('.theme-toggle').click();
    await page.waitForTimeout(300);
  }
}

async function switchToDict(): Promise<void> {
  const currentView = await page.evaluate(() => {
    const h = location.hash;
    if (h.includes('view=dict')) return 'dict';
    if (h.includes('view=flow')) return 'flow';
    return 'graph';
  });
  if (currentView === 'dict') return;
  const fab = page.locator('.fab').first();
  await fab.click();
  await page.waitForTimeout(200);
  const dictItem = page.locator('.fab-menu-item').filter({ hasText: 'Dictionary' });
  await dictItem.click();
  await page.waitForTimeout(800);
}

async function switchToFlow(): Promise<void> {
  const currentView = await page.evaluate(() => {
    const h = location.hash;
    if (h.includes('view=flow')) return 'flow';
    if (h.includes('view=dict')) return 'dict';
    return 'graph';
  });
  if (currentView !== 'flow') {
    const fab = page.locator('.fab').first();
    await fab.click();
    await page.waitForTimeout(200);
    const flowItem = page.locator('.fab-menu-item').filter({ hasText: 'Data Flows' });
    await flowItem.click();
    await page.waitForTimeout(1200);
  }
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__IGNATIUS_FLOW_READY__ === true, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

// Scroll the DD to the Validate-Customer process card and wait for it to be in view.
async function scrollToValidateCustomer(): Promise<void> {
  await page.evaluate(() => {
    const el = document.getElementById('process-Validate-Customer');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await page.waitForTimeout(400);
}

// ── Navigate to the SPA ───────────────────────────────────────────────────────

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// ════════════════════════════════════════════════════════════════════════════════
// ASSERTION (a): DD card for 1.1 Validate Customer — endpoint link state
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Assertion (a): DD card endpoint link state ──');

for (const theme of ['dark', 'light'] as const) {
  note(`\n  [${theme}]`);
  await setTheme(theme);
  await switchToDict();

  // Wait for the process section to exist in the DOM
  await page.waitForSelector('#process-Validate-Customer', { timeout: 8000 });
  await scrollToValidateCustomer();

  await shot(`a-validate-customer-card-${theme}.png`);

  // (a1) Customer (ext:Customer) renders as .entity-link inside the process card
  const customerLinkCount = await page.evaluate(() => {
    const section = document.getElementById('process-Validate-Customer');
    if (!section) return 0;
    // Look for an .entity-link anchor whose text content is "Customer"
    const links = section.querySelectorAll<HTMLAnchorElement>('a.entity-link');
    let count = 0;
    for (const a of links) {
      if (a.textContent?.trim() === 'Customer') count++;
    }
    return count;
  });
  assert(customerLinkCount > 0, `[${theme}] Customer (ext:Customer) renders as .entity-link in the DD card`);

  // (a2) OrderIntake stays plain text — no _stores/ file so no DD section
  const orderIntakeLinkCount = await page.evaluate(() => {
    const section = document.getElementById('process-Validate-Customer');
    if (!section) return 0;
    const links = section.querySelectorAll<HTMLAnchorElement>('a.entity-link');
    let count = 0;
    for (const a of links) {
      if (a.textContent?.trim() === 'OrderIntake') count++;
    }
    return count;
  });
  assert(orderIntakeLinkCount === 0, `[${theme}] OrderIntake (queue, no store section) stays plain text in the DD card`);

  // (a3) The io-table cell containing "OrderIntake" is just text — not wrapped in an anchor
  const orderIntakeIsPlain = await page.evaluate(() => {
    const section = document.getElementById('process-Validate-Customer');
    if (!section) return false;
    const tds = section.querySelectorAll<HTMLTableCellElement>('td');
    for (const td of tds) {
      if (td.textContent?.trim() === 'OrderIntake') {
        // The cell exists and has no anchor child
        return td.querySelector('a') === null;
      }
    }
    return false;
  });
  assert(orderIntakeIsPlain, `[${theme}] OrderIntake cell contains plain text (no anchor), no dead link`);

  // (a4) db:Party endpoint is still an anchor (regression — unchanged by CP25).
  // Note: in the DD card context (no onOpenEntity), db: entities render as a plain
  // <a href="#entity-..."> WITHOUT .entity-link class — that pre-CP25 behaviour is preserved.
  const partyLinkCount = await page.evaluate(() => {
    const section = document.getElementById('process-Validate-Customer');
    if (!section) return 0;
    const links = section.querySelectorAll<HTMLAnchorElement>('a');
    let count = 0;
    for (const a of links) {
      if (a.textContent?.trim() === 'Party') count++;
    }
    return count;
  });
  assert(partyLinkCount > 0, `[${theme}] db:Party endpoint still renders as an anchor (entity scroll unchanged)`);

  // (a5) Clicking Customer scrolls the #external-Customer section into view.
  // Capture scroll position before and after click.
  const scrolledToCustomer = await page.evaluate(async () => {
    const section = document.getElementById('process-Validate-Customer');
    if (!section) return false;
    const links = section.querySelectorAll<HTMLAnchorElement>('a.entity-link');
    let customerLink: HTMLAnchorElement | null = null;
    for (const a of links) {
      if (a.textContent?.trim() === 'Customer') { customerLink = a; break; }
    }
    if (!customerLink) return false;

    // Record scroll position of the external section before click
    const externalSection = document.getElementById('external-Customer');
    if (!externalSection) return false;

    const scrollBefore = document.querySelector('.dict-view')?.scrollTop ?? window.scrollY;
    customerLink.click();

    // Give the smooth scroll a moment to land
    await new Promise(r => setTimeout(r, 600));

    // Check external-Customer is in the viewport (or at least scrolled toward)
    const rect = externalSection.getBoundingClientRect();
    // Consider "scrolled into view" if the section top is within the viewport
    return rect.top >= -50 && rect.top < window.innerHeight;
  });
  assert(scrolledToCustomer, `[${theme}] clicking Customer link scrolls #external-Customer into view`);

  await shot(`a-after-customer-click-${theme}.png`);

  // Scroll back to the process card for next check
  await scrollToValidateCustomer();
}

// ════════════════════════════════════════════════════════════════════════════════
// ASSERTION (b): The DIALOG for 1.1 Validate Customer (sub-DFD) shows Customer
//                as a link (CP20 resolver — sub-DFD path verification)
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Assertion (b): Dialog for 1.1 Validate Customer (sub-DFD) shows Customer as link ──');

for (const theme of ['dark', 'light'] as const) {
  note(`\n  [${theme}]`);
  await setTheme(theme);
  await switchToFlow();

  // Navigate to the sub-DFD: order-to-cash > Create-Sales-Order.
  // Click the sub-DFD drill-down for Create-Sales-Order.
  const drillClicked = await page.evaluate(() => {
    // Look for a process node with token proc:Create-Sales-Order and click its drill-down
    const procGroup = document.querySelector<SVGGElement>('g[data-token="proc:Create-Sales-Order"]');
    if (!procGroup) return 'not-found';
    const badge = procGroup.querySelector<SVGGElement>('g[data-ignatius="flow-drill"]');
    if (!badge) {
      // No drill badge — caller falls back to hash navigation below.
      return 'no-drill-badge';
    }
    badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    return 'clicked';
  });
  note(`    Drill-down attempt: ${drillClicked}`);
  await page.waitForTimeout(1000);

  // If we couldn't drill in, try via hash navigation
  if (drillClicked !== 'clicked') {
    await page.evaluate(() => {
      location.hash = '#view=flow&dfd=Create-Sales-Order';
    });
    await page.waitForTimeout(1200);
  }

  // Now open the Validate-Customer ⓘ dialog
  const dialogOpened = await page.evaluate(() => {
    const procGroup = document.querySelector<SVGGElement>('g[data-token="proc:Validate-Customer"]');
    if (!procGroup) return false;
    const badge = procGroup.querySelector<SVGGElement>('g[data-ignatius="flow-info"]');
    if (!badge) return false;
    badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    return true;
  });
  assert(dialogOpened, `[${theme}] Validate-Customer ⓘ badge found in sub-DFD and clicked`);
  await page.waitForTimeout(600);

  await shot(`b-validate-customer-dialog-${theme}.png`);

  // Check the dialog's I/O table for Customer as a link
  const customerDialogLinkCount = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    if (!modal) return 0;
    const links = modal.querySelectorAll<HTMLAnchorElement>('a.entity-link');
    let count = 0;
    for (const a of links) {
      if (a.textContent?.trim() === 'Customer') count++;
    }
    return count;
  });
  assert(
    customerDialogLinkCount > 0,
    `[${theme}] Customer appears as .entity-link in the Validate-Customer sub-DFD dialog`,
  );

  // Close the dialog
  const closeBtn = page.locator('.modal-close').first();
  if (await closeBtn.count() > 0) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }
}

// ── Teardown ──────────────────────────────────────────────────────────────────

await browser.close();
proc.kill();

note('\n✓ All CP25 assertions passed.');
note(`Screenshots in: ${TMP}`);
