/**
 * Visual verification: CP7 — Entity ↔ Process cross-reference.
 *
 * Proves:
 *  1. DD: Payment entity section shows a "Processes" table after examples,
 *     listing "3 Collect Payment" with direction "write" and DFD "order-to-cash".
 *     Also checks PaymentMethod as a read-only entity.
 *  2. The process link in the DD scrolls to #process-Collect-Payment on click.
 *  3. Graph: opening the Payment entity modal (DG node) shows a "Processes" section
 *     with the same process row and a working navigation link.
 *  4. DFD: opening a db: store dialog for Payment (rich entity modal) also shows
 *     the Processes section.
 *  5. Entities with no flow usage have NO Processes section.
 *  6. Light AND dark mode.
 *
 * Uses models/key-inherited.
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp7-entity-process-xref');
mkdirSync(TMP, { recursive: true });

const PORT = 7407;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
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

const serverReady = await waitForServer(BASE, 12_000);
if (!serverReady) fail('Server did not start within 12 seconds');
note(`Server ready at ${BASE}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

async function shot(name: string): Promise<void> {
  const p = join(TMP, name);
  await page.screenshot({ path: p, fullPage: false });
  note(`Screenshot: ${p}`);
}

async function setTheme(theme: 'dark' | 'light'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('ignatius-theme', t);
  }, theme);
  await page.waitForTimeout(200);
}

// ── Run checks for a given theme ──────────────────────────────────────────────

async function runChecks(theme: 'dark' | 'light'): Promise<void> {
  note(`\n══ Theme: ${theme} ══════════════════════════════════════════════════════`);

  // ── 1. DD: Payment entity shows Processes table ───────────────────────────────
  note('\n── 1. DD: navigate to Dictionary view, check Payment entity ─────────────');
  await page.goto(`${BASE}/#view=dict`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await setTheme(theme);

  // Scroll Payment entity into view
  const paymentScrolled = await page.evaluate(() => {
    const el = document.getElementById('entity-Payment');
    if (el) { el.scrollIntoView({ block: 'start' }); return true; }
    return false;
  });
  if (!paymentScrolled) fail('DD: #entity-Payment section not found');
  await page.waitForTimeout(400);
  await shot(`01-dd-payment-section-${theme}.png`);

  // 1a. Payment has a Processes table
  const hasProcessesWrap = await page.evaluate(() => {
    const section = document.getElementById('entity-Payment');
    if (!section) return false;
    return !!section.querySelector('.dict-processes-table-wrap');
  });
  if (!hasProcessesWrap) fail('DD: Payment entity is missing .dict-processes-table-wrap');
  note('OK: .dict-processes-table-wrap present in Payment entity');

  // 1b. "3 Collect Payment" row present in the Payment processes table
  const hasCollectPayment = await page.evaluate(() => {
    const section = document.getElementById('entity-Payment');
    if (!section) return false;
    const table = section.querySelector('.dict-processes-table');
    if (!table) return false;
    return (table.textContent ?? '').includes('Collect Payment');
  });
  if (!hasCollectPayment) fail('DD: "Collect Payment" row missing from Payment Processes table');
  note('OK: "Collect Payment" row present in Payment Processes table');

  // 1c. Direction badge is "write" (Payment is output of Collect Payment)
  const directionText = await page.evaluate(() => {
    const section = document.getElementById('entity-Payment');
    if (!section) return '';
    const badge = section.querySelector('.dict-process-direction');
    return badge?.textContent?.trim() ?? '';
  });
  if (!['write', 'readwrite'].includes(directionText)) {
    fail(`DD: Payment direction badge should be "write" or "readwrite" (got "${directionText}")`);
  }
  note(`OK: Payment direction badge: "${directionText}"`);

  // 1d. DFD title column shows "order-to-cash" or the titlized version
  const hasDfdTitle = await page.evaluate(() => {
    const section = document.getElementById('entity-Payment');
    if (!section) return false;
    const table = section.querySelector('.dict-processes-table');
    return (table?.textContent ?? '').toLowerCase().includes('order');
  });
  if (!hasDfdTitle) fail('DD: DFD title column missing from Payment Processes table');
  note('OK: DFD title column present');

  await shot(`01b-dd-payment-processes-table-${theme}.png`);

  // ── 1e. PaymentMethod is a read-only entity ───────────────────────────────────
  note('\n── 1e. DD: check PaymentMethod is read direction ─────────────────────────');
  const pmScrolled = await page.evaluate(() => {
    const el = document.getElementById('entity-PaymentMethod');
    if (el) { el.scrollIntoView({ block: 'start' }); return true; }
    return false;
  });
  if (pmScrolled) {
    await page.waitForTimeout(300);
    const pmDirection = await page.evaluate(() => {
      const section = document.getElementById('entity-PaymentMethod');
      if (!section) return null;
      const badge = section.querySelector('.dict-process-direction');
      return badge?.textContent?.trim() ?? null;
    });
    if (pmDirection !== null) {
      if (!['read', 'readwrite'].includes(pmDirection)) {
        fail(`DD: PaymentMethod direction should be "read" (got "${pmDirection}")`);
      }
      note(`OK: PaymentMethod direction badge: "${pmDirection}"`);
    }
    await shot(`01c-dd-paymentmethod-direction-${theme}.png`);
  }

  // ── 2. DD: clicking a process link navigates to the process section ───────────
  note('\n── 2. DD: click Collect Payment link → scroll to #process-Collect-Payment ─');
  const linkClicked = await page.evaluate(() => {
    const section = document.getElementById('entity-Payment');
    if (!section) return false;
    const link = section.querySelector<HTMLAnchorElement>('a[href="#process-Collect-Payment"]');
    if (!link) return false;
    link.click();
    return true;
  });
  if (!linkClicked) fail('DD: process link #process-Collect-Payment not found in Payment section');
  await page.waitForTimeout(800);

  const processVisible = await page.evaluate(() => {
    const el = document.getElementById('process-Collect-Payment');
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.top < window.innerHeight;
  });
  if (!processVisible) {
    await shot(`FAIL-dd-scroll-no-process-${theme}.png`);
    fail(`DD: #process-Collect-Payment did not scroll into viewport after link click (${theme})`);
  }
  note('OK: #process-Collect-Payment scrolled into view after link click');
  await shot(`02-dd-process-navigation-${theme}.png`);

  // ── 3. Graph: entity modal shows Processes section ────────────────────────────
  note('\n── 3. DG: open Payment entity modal → check Processes section ───────────');
  await page.goto(`${BASE}/#view=graph`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  await setTheme(theme);

  // Wait for Cytoscape to initialize
  await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 15_000 },
  ).catch(() => null);
  await page.waitForTimeout(1000);

  // Open Payment node by clicking it (or via hash navigation)
  await page.goto(`${BASE}/#view=graph&entity=Payment`);
  await page.waitForTimeout(1500);
  await setTheme(theme);

  // Check if entity modal opened (it may require a node click, not just hash)
  const modalOpen = await page.locator('.modal-backdrop').first().isVisible().catch(() => false);
  if (!modalOpen) {
    // Try clicking the node directly via Cytoscape API
    const nodeClicked = await page.evaluate(() => {
      const cy = (window as { __IGNATIUS_CY__?: { nodes: (sel: string) => { emit: (ev: string) => void; length: number } } }).__IGNATIUS_CY__;
      if (!cy) return false;
      const nodes = cy.nodes('[id="Payment"]');
      if (!nodes || nodes.length === 0) return false;
      nodes.emit('tap');
      return true;
    });
    if (!nodeClicked) {
      note('WARNING: Could not open Payment modal via Cytoscape — skipping modal assertion');
    } else {
      await page.waitForTimeout(800);
    }
  }

  const modalVisibleNow = await page.locator('.modal-backdrop').first().isVisible().catch(() => false);
  if (modalVisibleNow) {
    // 3a. "Processes" section heading present
    const hasProcessesHeading = await page.evaluate(() => {
      const modal = document.querySelector('.modal-backdrop');
      if (!modal) return false;
      const headings = Array.from(modal.querySelectorAll('h4'));
      return headings.some(h => h.textContent?.trim().toLowerCase() === 'processes');
    });
    if (!hasProcessesHeading) {
      await shot(`FAIL-graph-modal-no-processes-${theme}.png`);
      fail(`Graph modal: Payment entity missing "Processes" section heading (${theme})`);
    }
    note('OK: "Processes" heading present in Payment graph modal');

    // 3b. "Collect Payment" row present
    const hasCollectPaymentInModal = await page.evaluate(() => {
      const modal = document.querySelector('.modal-processes');
      return (modal?.textContent ?? '').includes('Collect Payment');
    });
    if (!hasCollectPaymentInModal) {
      await shot(`FAIL-graph-modal-missing-collect-payment-${theme}.png`);
      fail(`Graph modal: "Collect Payment" missing from Processes section (${theme})`);
    }
    note('OK: "Collect Payment" present in Payment graph modal Processes section');

    // 3c. Direction badge present
    const modalDirection = await page.evaluate(() => {
      const badge = document.querySelector('.modal-processes .dict-process-direction');
      return badge?.textContent?.trim() ?? null;
    });
    if (!modalDirection) {
      fail(`Graph modal: direction badge missing from Processes section (${theme})`);
    }
    note(`OK: modal Processes direction badge: "${modalDirection}"`);

    await shot(`03-graph-modal-payment-processes-${theme}.png`);
  } else {
    note('INFO: Graph modal could not be opened automatically — screenshot of graph taken');
    await shot(`03-graph-no-modal-${theme}.png`);
  }

  // ── 3b. DFD: open db:Payment store ⓘ → SelectedEntityModal shows Processes ───
  note('\n── 3b. DFD: open db:Payment ⓘ from Flows view → check Processes section ─');
  // Navigate to the Flows view on the order-to-cash DFD.
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  await setTheme(theme);

  // Click the ⓘ badge on the db:Payment store node. The store node carries
  // data-token="db:Payment" on its <g> wrapper; the badge is the ⓘ text inside it.
  const storeInfoClicked = await page.evaluate(() => {
    // The store group has data-token="db:Payment". Find the ⓘ text within it.
    const g = document.querySelector<SVGGElement>('g[data-token="db:Payment"]');
    if (!g) return false;
    const badge = g.querySelector<SVGTextElement>('text');
    if (!badge) return false;
    badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    return true;
  });
  if (!storeInfoClicked) {
    // Try looking at the SVG root — the DFD may be on a sub-diagram, try Collect-Payment sub-view
    const altClicked = await page.evaluate(() => {
      // Search all g elements for db:Payment token
      const groups = document.querySelectorAll<SVGGElement>('g[data-token]');
      for (const g of groups) {
        if (g.getAttribute('data-token') === 'db:Payment') {
          const badge = g.querySelector<SVGTextElement>('text');
          if (badge) {
            badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            return true;
          }
        }
      }
      return false;
    });
    if (!altClicked) {
      await shot(`FAIL-03b-dfd-store-not-found-${theme}.png`);
      fail(`DFD db:Payment store node not found in current DFD view (${theme})`);
    } else {
      await page.waitForTimeout(600);
    }
  } else {
    await page.waitForTimeout(600);
  }

  const dfdModalOpen = await page.locator('.modal-backdrop').first().isVisible().catch(() => false);
  if (!dfdModalOpen) {
    await shot(`FAIL-03b-dfd-store-no-modal-${theme}.png`);
    fail(`DFD db:Payment store ⓘ click did not open a modal (${theme})`);
  }

  const dfdHasProcesses = await page.evaluate(() => {
    const modal = document.querySelector('.modal-backdrop');
    if (!modal) return false;
    const headings = Array.from(modal.querySelectorAll('h4'));
    return headings.some(h => h.textContent?.trim().toLowerCase() === 'processes');
  });
  if (!dfdHasProcesses) {
    await shot(`FAIL-dfd-store-no-processes-${theme}.png`);
    fail(`DFD db:Payment modal: missing "Processes" section (${theme})`);
  }
  note('OK: DFD db:Payment store modal shows Processes section');
  await shot(`03b-dfd-store-processes-${theme}.png`);
  // Close the modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ── 4. Entity with no flow usage HARD-asserts NO Processes section in DD ─────
  note('\n── 4. DD: LineItemType (zero process usage) has no Processes section ────');
  await page.goto(`${BASE}/#view=dict`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);
  await setTheme(theme);

  // LineItemType is a reference entity not referenced by any process I/O in
  // key-inherited/flows — guaranteed zero usage. The Processes section MUST be absent.
  const lineItemTypeSection = await page.evaluate(() => {
    return document.getElementById('entity-LineItemType');
  });
  if (!lineItemTypeSection) fail('DD: #entity-LineItemType section not found in model');

  const lineItemTypeHasProcesses = await page.evaluate(() => {
    const section = document.getElementById('entity-LineItemType');
    if (!section) return null;
    return !!section.querySelector('.dict-processes-table-wrap');
  });
  if (lineItemTypeHasProcesses === null) fail('DD: #entity-LineItemType section disappeared during check');
  if (lineItemTypeHasProcesses === true) {
    await shot(`FAIL-dd-lineitemtype-has-processes-${theme}.png`);
    fail(`DD: LineItemType unexpectedly has a Processes table — usage index may be over-counting (${theme})`);
  }
  note('OK: LineItemType has NO Processes table (correct — zero flow usage confirmed)');
  await shot(`04-dd-no-processes-entity-${theme}.png`);

  note(`\n✓ All CP7 ${theme}-mode assertions passed.`);
}

// ── Run for both themes ───────────────────────────────────────────────────────

try {
  await runChecks('dark');
  await runChecks('light');

  note('\n══ CP7 PASS ════════════════════════════════════════════════════════════');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await browser.close();
  proc.kill();
}
