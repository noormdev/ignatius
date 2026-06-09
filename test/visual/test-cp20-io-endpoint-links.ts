/**
 * CP20 visual assertion: clickable process-dialog IO endpoints.
 *
 * Asserts:
 *  (a) In the Collect-Payment process dialog, non-db endpoints (ext:Customer,
 *      file:gateway-log) render as .entity-link anchors in the IO table — not
 *      plain text. Dark + light.
 *  (b) Clicking the ext:Customer endpoint in the IO table opens the Customer
 *      dialog IN PLACE (hash stays #view=flow, no view switch). Dark + light.
 *  (c) Clicking a db: endpoint (db:Payment) still opens the rich entity dialog
 *      in place (hash stays #view=flow). Regression guard for db: path. Dark + light.
 *  (d) Linkification is SELECTIVE, not blanket: the IO table still contains plain
 *      (non-anchor) cells — the direction + data-flow-label columns are not links.
 *      Note: every ENDPOINT in models/key-inherited resolves, so the unresolvable-
 *      endpoint → plain-text branch is not exercised by this fixture; that guard is
 *      covered by the code path (canOpenToken === false), not asserted here.
 *
 * Run: bun test/visual/test-cp20-io-endpoint-links.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp20-io-endpoint-links');
mkdirSync(TMP, { recursive: true });

const PORT = 7420;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

function assert(cond: boolean, label: string) {
  if (cond) { note(`  PASS  ${label}`); } else { fail(label); }
}

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
  await page.waitForFunction(() => window.__IGNATIUS_FLOW_READY__ === true, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function closeAllModals(): Promise<void> {
  // Close modals from outermost in (last opened) to clear the stack.
  let count = await page.locator('.modal-close').count();
  while (count > 0) {
    await page.locator('.modal-close').first().click();
    await page.waitForTimeout(300);
    count = await page.locator('.modal-close').count();
  }
}

async function openCollectPaymentDialog(): Promise<boolean> {
  return page.evaluate(() => {
    const procGroup = document.querySelector<SVGGElement>('g[data-token="proc:Collect-Payment"]');
    if (!procGroup) return false;
    const badge = procGroup.querySelector<SVGGElement>('g[data-ignatius="flow-info"]');
    if (!badge) return false;
    badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    return true;
  });
}

// ── Navigate to the SPA ───────────────────────────────────────────────────────

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// ════════════════════════════════════════════════════════════════════════════════
// ASSERTION (a): non-db IO endpoints render as .entity-link anchors
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Assertion (a): non-db IO endpoints are clickable .entity-link anchors ──');

for (const theme of ['dark', 'light'] as const) {
  note(`\n  [${theme}]`);
  await setTheme(theme);
  await switchToFlow();

  const dialogOpened = await openCollectPaymentDialog();
  assert(dialogOpened, `[${theme}] Collect-Payment ⓘ badge found and clicked`);
  await page.waitForTimeout(600);

  // Confirm dialog opened
  const modalCount = await page.locator('.modal-header h1').count();
  assert(modalCount > 0, `[${theme}] process dialog opened`);

  // Count all .entity-link anchors in the IO table (includes db: and non-db: endpoints)
  const allLinks = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    if (!modal) return { total: 0, nonDbNames: [] as string[] };
    const links = modal.querySelectorAll<HTMLAnchorElement>('table.dict-io-table a.entity-link');
    const nonDbNames: string[] = [];
    for (const link of links) {
      const text = link.textContent?.trim() ?? '';
      // db: endpoints have data-entity set; non-db don't (they use href="#")
      if (!link.getAttribute('data-entity')) {
        nonDbNames.push(text);
      }
    }
    return { total: links.length, nonDbNames };
  });

  note(`    Total .entity-link anchors in IO table: ${allLinks.total}`);
  note(`    Non-db link names: ${JSON.stringify(allLinks.nonDbNames)}`);

  // ext:Customer appears as both input AND output → 2 rows; file:gateway-log appears once
  assert(allLinks.nonDbNames.includes('Customer'), `[${theme}] ext:Customer renders as .entity-link in IO table`);
  assert(allLinks.nonDbNames.includes('gateway-log'), `[${theme}] file:gateway-log renders as .entity-link in IO table`);

  // (d) Selectivity: linkification is per-endpoint-cell, NOT a blanket pass over the table.
  // The direction + data-flow-label columns must remain plain text (no anchor inside).
  const plainCellCount = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    if (!modal) return 0;
    const cells = modal.querySelectorAll('table.dict-io-table td');
    let plain = 0;
    for (const cell of cells) {
      const text = cell.textContent?.trim() ?? '';
      if (text.length > 0 && !cell.querySelector('a.entity-link')) plain++;
    }
    return plain;
  });
  note(`    Plain (non-link) IO cells: ${plainCellCount}`);
  assert(plainCellCount > 0, `[${theme}] IO table keeps plain-text cells (links are selective, not blanket)`);

  // Take screenshot of the dialog showing the IO table with links
  await shot(`a-io-links-${theme}.png`);

  await closeAllModals();
}

// ════════════════════════════════════════════════════════════════════════════════
// ASSERTION (b): clicking ext:Customer opens its dialog IN PLACE (hash stays flow)
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Assertion (b): clicking ext:Customer opens in-place (hash stays #view=flow) ──');

for (const theme of ['dark', 'light'] as const) {
  note(`\n  [${theme}]`);
  await setTheme(theme);
  await switchToFlow();

  const dialogOpened = await openCollectPaymentDialog();
  assert(dialogOpened, `[${theme}] Collect-Payment ⓘ badge found and clicked`);
  await page.waitForTimeout(600);

  const hashBeforeClick = await page.evaluate(() => location.hash);
  note(`    Hash before click: ${hashBeforeClick}`);
  assert(hashBeforeClick.includes('view=flow'), `[${theme}] hash already on #view=flow before click`);

  // Click the ext:Customer link in the IO table (first occurrence)
  const clicked = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    if (!modal) return false;
    const links = modal.querySelectorAll<HTMLAnchorElement>('table.dict-io-table a.entity-link');
    for (const link of links) {
      // Non-db links have href="#" and no data-entity
      if (!link.getAttribute('data-entity') && link.textContent?.trim() === 'Customer') {
        link.click();
        return true;
      }
    }
    return false;
  });
  assert(clicked, `[${theme}] found and clicked ext:Customer link in IO table`);
  await page.waitForTimeout(600);

  // Verify hash still on view=flow (no dict/graph switch)
  const hashAfterClick = await page.evaluate(() => location.hash);
  note(`    Hash after click: ${hashAfterClick}`);
  assert(
    hashAfterClick.includes('view=flow'),
    `[${theme}] after clicking ext:Customer, hash still contains view=flow (got: ${hashAfterClick})`,
  );

  // Verify a dialog is open (the Customer dialog)
  const modalTitle = await page.locator('.modal-header h1').first().textContent();
  note(`    Modal title: "${modalTitle}"`);
  assert(
    (modalTitle ?? '').includes('Customer'),
    `[${theme}] Customer dialog opened (title: "${modalTitle}")`,
  );

  await shot(`b-customer-dialog-inplace-${theme}.png`);

  await closeAllModals();
}

// ════════════════════════════════════════════════════════════════════════════════
// ASSERTION (c): db: endpoint (db:Payment) still opens rich entity dialog in place
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Assertion (c): db:Payment still opens rich entity dialog in place (regression guard) ──');

for (const theme of ['dark', 'light'] as const) {
  note(`\n  [${theme}]`);
  await setTheme(theme);
  await switchToFlow();

  const dialogOpened = await openCollectPaymentDialog();
  assert(dialogOpened, `[${theme}] Collect-Payment ⓘ badge found and clicked`);
  await page.waitForTimeout(600);

  const hashBefore = await page.evaluate(() => location.hash);
  assert(hashBefore.includes('view=flow'), `[${theme}] hash on #view=flow before db: click`);

  // Click the db:Payment entity link in the IO table
  const dbClicked = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    if (!modal) return false;
    const links = modal.querySelectorAll<HTMLAnchorElement>('table.dict-io-table a.entity-link[data-entity]');
    for (const link of links) {
      if (link.getAttribute('data-entity') === 'Payment') {
        link.click();
        return true;
      }
    }
    return false;
  });
  assert(dbClicked, `[${theme}] found and clicked db:Payment link in IO table`);
  await page.waitForTimeout(600);

  const hashAfterDb = await page.evaluate(() => location.hash);
  note(`    Hash after db:Payment click: ${hashAfterDb}`);
  assert(
    hashAfterDb.includes('view=flow'),
    `[${theme}] after clicking db:Payment, hash still contains view=flow (got: ${hashAfterDb})`,
  );

  // The rich entity dialog (SelectedEntityModal) should be open — look for Payment in title or entity modal class
  const entityModalVisible = await page.evaluate(() => {
    // SelectedEntityModal adds 'modal--entity' or similar; check for modal with "Payment" in the title
    const headers = document.querySelectorAll<HTMLElement>('.modal-header h1');
    for (const h of headers) {
      if (h.textContent?.includes('Payment')) return true;
    }
    return false;
  });
  assert(entityModalVisible, `[${theme}] rich entity dialog for Payment is open`);

  await shot(`c-payment-entity-dialog-${theme}.png`);

  await closeAllModals();
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

await browser.close();
proc.kill();

note('\nAll CP20 assertions passed.');
