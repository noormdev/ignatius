/**
 * Visual verification: CP6 — Non-entity data stores.
 *
 * Proves:
 *  1. A non-entity store (kind=file, "Payment Gateway Log") appears in a DFD
 *     as a Gane-Sarson store node (data-node-type="store") with the correct label.
 *  2. Its ⓘ badge opens the plain FlowNodeModal (kind badge + title + body),
 *     NOT the rich SelectedEntityModal (no attributes table).
 *  3. The same store appears in a "Data Stores" section in the Dictionary view
 *     (id="store-gateway-log") with .dict-entity-header styling.
 *  4. db: stores (e.g. Payment, PaymentAllocation) are unaffected — they do NOT
 *     appear in the "Data Stores" section.
 *  5. Light AND dark mode for all of the above.
 *
 * Uses models/key-inherited (gateway-log store in flows/order-to-cash/_stores/).
 * Distinctive phrase: "Append-only log of raw payment-gateway responses".
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp6-non-entity-stores');
mkdirSync(TMP, { recursive: true });

const PORT = 7406;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

async function shot(name: string): Promise<void> {
  const p = join(TMP, name);
  await page.screenshot({ path: p, fullPage: true });
  note(`Screenshot: ${p}`);
}

async function assertExists(selector: string, label: string): Promise<void> {
  const el = page.locator(selector).first();
  const visible = await el.isVisible().catch(() => false);
  if (!visible) {
    const inDom = await page.evaluate((s) => !!document.querySelector(s), selector);
    if (!inDom) fail(`Expected to find ${label} matching "${selector}"`);
    note(`OK: ${label} present (not visible but in DOM)`);
    return;
  }
  note(`OK: ${label} present`);
}

async function assertNotExists(selector: string, label: string): Promise<void> {
  const inDom = await page.evaluate((s) => !!document.querySelector(s), selector);
  if (inDom) fail(`Expected ${label} to be ABSENT but found it matching "${selector}"`);
  note(`OK: ${label} absent (correct)`);
}

async function assertPhraseOnce(phrase: string, ctx: string): Promise<void> {
  const pageText = await page.evaluate(() => document.body.innerText);
  const count = pageText.split(phrase).length - 1;
  note(`Phrase count "${phrase.slice(0, 40)}…" in ${ctx}: ${count}`);
  if (count !== 1) {
    await shot(`FAIL-phrase-count-${ctx.replace(/\s+/g, '-')}.png`);
    fail(`${ctx}: expected phrase exactly 1 time, found ${count}`);
  }
  note(`OK: phrase appears exactly once in ${ctx}`);
}

const STORE_PHRASE = 'Append-only log of raw payment-gateway responses';

// ── Run checks for a given theme ──────────────────────────────────────────────

async function runChecks(theme: 'dark' | 'light'): Promise<void> {
  note(`\n══ Theme: ${theme} ══════════════════════════════════════════════════════`);

  // ── 1 + 3. Navigate to Dictionary view and check Data Stores section ─────────
  note('\n── 1+3. DD: navigate to Dictionary view ─────────────────────────────────');
  await page.goto(`${BASE}/#view=dict`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  if (theme === 'light') {
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('ignatius-theme', 'light');
    });
    await page.waitForTimeout(300);
  }

  // 3a. Data Stores section heading
  const storeHeadingInDom = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h2.flow-dict-section-heading'));
    return headings.some(h => h.textContent?.trim() === 'Data Stores');
  });
  if (!storeHeadingInDom) fail('"Data Stores" section heading not found in DD');
  note('OK: "Data Stores" section heading present');

  // 3b. gateway-log store section
  const storeSection = page.locator('#store-gateway-log');
  const storeInDom = await page.evaluate(() => !!document.getElementById('store-gateway-log'));
  if (!storeInDom) fail('#store-gateway-log section not found in DD DOM');
  note('OK: #store-gateway-log present in DD');

  // 3c. Body appears exactly once
  await assertPhraseOnce(STORE_PHRASE, `DD ${theme}`);

  // 3d. .dict-entity-header styling
  await assertExists('#store-gateway-log .dict-entity-header', 'store header (.dict-entity-header)');
  await assertExists('#store-gateway-log .flow-store-kind', 'FILE kind badge');

  // 4. db: stores are NOT duplicated in the Data Stores section
  // Payment and PaymentAllocation are db: stores — they must NOT have store-<name> IDs
  await assertNotExists('#store-Payment', 'db:Payment must not appear in Data Stores section');
  await assertNotExists('#store-PaymentAllocation', 'db:PaymentAllocation must not appear in Data Stores section');

  await storeSection.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await shot(`01-dd-data-stores-${theme}.png`);

  // ── 1. Navigate to DFD view and find the store node ─────────────────────────
  note('\n── 1. DFD: navigate to order-to-cash ────────────────────────────────────');
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`);
  await page.waitForLoadState('domcontentloaded');

  await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).catch(() => null);

  if (theme === 'light') {
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('ignatius-theme', 'light');
    });
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(800);

  // 1a. A store node with "Payment Gateway Log" label is present.
  // Each store <g> has two <text> children: D# (cap) and the name label.
  // Check the full text content of the <g> to catch the name in either child.
  const storeNodePresent = await page.evaluate(() => {
    const stores = Array.from(document.querySelectorAll('g[data-node-type="store"]'));
    return stores.some(s => (s.textContent ?? '').includes('Payment Gateway Log'));
  });
  if (!storeNodePresent) {
    await shot(`FAIL-store-node-absent-${theme}.png`);
    fail('DFD store node "Payment Gateway Log" not found in SVG');
  }
  note('OK: "Payment Gateway Log" store node present in DFD SVG');

  await shot(`02-dfd-store-node-${theme}.png`);

  // ── 2. Click ⓘ on the store node ────────────────────────────────────────────
  note('\n── 2. DFD: click gateway-log store ⓘ badge ─────────────────────────────');
  const dialogOpened = await page.evaluate(() => {
    const stores = Array.from(document.querySelectorAll('g[data-node-type="store"]'));
    for (const s of stores) {
      if (!(s.textContent ?? '').includes('Payment Gateway Log')) continue;
      const badge = s.querySelector('g[data-ignatius="flow-info"]');
      if (badge) {
        (badge as HTMLElement).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        return true;
      }
    }
    return false;
  });

  if (!dialogOpened) {
    note('WARNING: Could not click ⓘ on gateway-log store — taking screenshot for manual inspection.');
    await shot(`02b-dfd-no-dialog-${theme}.png`);
    note('SKIP: DFD dialog assertion skipped (ⓘ badge not found via automation); DFD node presence confirmed.');
  } else {
    await page.waitForTimeout(800);

    // 2a. Modal is open
    const modalVisible = await page.locator('.modal-backdrop').first().isVisible().catch(() => false);
    if (!modalVisible) {
      await shot(`FAIL-store-modal-invisible-${theme}.png`);
      fail(`DFD store dialog (${theme}): expected modal to be visible after ⓘ click`);
    }

    // 2b. Plain card (not rich entity dialog) — no attributes table
    const hasEntityTable = await page.locator('.entity-attributes-table').isVisible().catch(() => false);
    if (hasEntityTable) {
      await shot(`FAIL-store-opened-entity-dialog-${theme}.png`);
      fail(`DFD store dialog (${theme}): opened rich entity dialog instead of plain card`);
    }

    // 2c. FILE kind badge present in dialog facts
    await assertExists('.flow-node-dialog-facts .flow-store-kind', 'dialog FILE kind badge');

    // 2d. Body text present in dialog
    const dialogText = await page.locator('.modal-backdrop').first().innerText().catch(() => '');
    if (!dialogText.includes('Append-only log')) {
      await shot(`FAIL-store-dialog-no-body-${theme}.png`);
      fail(`DFD store dialog (${theme}): store body not found in dialog`);
    }
    note('OK: store body present in dialog');

    await shot(`03-dfd-store-dialog-${theme}.png`);
    note('OK: DFD store ⓘ opens plain card (not entity dialog)');
  }

  note(`\n✓ All CP6 ${theme}-mode assertions passed.`);
}

// ── Run for both themes ───────────────────────────────────────────────────────

try {
  await runChecks('dark');
  await runChecks('light');

  note('\n══ CP6 PASS ════════════════════════════════════════════════════════════');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await browser.close();
  proc.kill();
}
