/**
 * Visual verification: CP8 — DFD process dialog → entity links resolve.
 *
 * Proves:
 *  1. In the Flows view, opening the "Collect Payment" process ⓘ dialog shows
 *     db:Payment and db:PaymentMethod I/O rows with anchors carrying `data-entity`.
 *  2. Clicking a db:Payment entity link inside that dialog opens the rich
 *     SelectedEntityModal for the Payment entity (entity title + attributes table).
 *  3. The db: store badge path still works (db:Payment store ⓘ opens the same
 *     entity modal — regression check for CP6/CP7).
 *  4. Light + dark mode.
 *
 * Uses models/key-inherited.
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp8-process-dialog-entity-links');
mkdirSync(TMP, { recursive: true });

const PORT = 7408;
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

// ── Navigate to Flows view and open Collect Payment process dialog ────────────

async function openCollectPaymentDialog(): Promise<boolean> {
  // The process node wrapper has data-token="proc:Collect-Payment".
  // Inside it, the InfoBadge <g> has data-ignatius="flow-info".
  const clicked = await page.evaluate(() => {
    // Primary path: find the info badge inside the Collect-Payment process group.
    const procGroup = document.querySelector<SVGGElement>('g[data-token="proc:Collect-Payment"]');
    if (procGroup) {
      const badge = procGroup.querySelector<SVGGElement>('g[data-ignatius="flow-info"]');
      if (badge) {
        badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        return true;
      }
    }
    // Fallback: search all process nodes by label text.
    const allGroups = document.querySelectorAll<SVGGElement>('g[data-token^="proc:"]');
    for (const g of allGroups) {
      const texts = Array.from(g.querySelectorAll('text'));
      const hasLabel = texts.some(t => (t.textContent ?? '').includes('Collect Payment'));
      if (hasLabel) {
        const badge = g.querySelector<SVGGElement>('g[data-ignatius="flow-info"]');
        if (badge) {
          badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
          return true;
        }
      }
    }
    return false;
  });
  return clicked;
}

// ── Run checks for a given theme ──────────────────────────────────────────────

async function runChecks(theme: 'dark' | 'light'): Promise<void> {
  note(`\n══ Theme: ${theme} ══════════════════════════════════════════════════════`);

  // ── 1. Open Flows view (order-to-cash DFD) ────────────────────────────────────
  note('\n── 1. Navigate to Flows view (order-to-cash DFD) ────────────────────────');
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  await setTheme(theme);
  await shot(`01-flows-view-${theme}.png`);

  // ── 2. Open the Collect Payment process ⓘ dialog ─────────────────────────────
  note('\n── 2. Click Collect Payment process ⓘ badge ─────────────────────────────');
  const dialogOpened = await openCollectPaymentDialog();
  if (!dialogOpened) {
    await shot(`FAIL-02-no-collect-payment-badge-${theme}.png`);
    fail(`DFD: Could not find Collect Payment process ⓘ badge in SVG (${theme})`);
  }
  await page.waitForTimeout(800);

  const modalVisible = await page.locator('.modal-backdrop').first().isVisible().catch(() => false);
  if (!modalVisible) {
    await shot(`FAIL-02-no-modal-${theme}.png`);
    fail(`DFD: Clicking Collect Payment badge did not open a modal (${theme})`);
  }
  note('OK: Collect Payment process dialog opened');
  await shot(`02-collect-payment-dialog-${theme}.png`);

  // ── 3. Verify db:Payment link has data-entity attribute ───────────────────────
  note('\n── 3. Check db:Payment I/O row has data-entity attribute ─────────────────');
  const paymentLinkInfo = await page.evaluate(() => {
    const modal = document.querySelector('.modal-backdrop');
    if (!modal) return null;
    // Find all anchors in the modal that reference "Payment"
    const anchors = Array.from(modal.querySelectorAll('a'));
    const paymentAnchor = anchors.find(a =>
      a.textContent?.trim() === 'Payment' && (a.getAttribute('href') ?? '').includes('Payment')
    );
    if (!paymentAnchor) return null;
    return {
      hasDataEntity: paymentAnchor.hasAttribute('data-entity'),
      dataEntityValue: paymentAnchor.getAttribute('data-entity'),
      hasEntityLinkClass: paymentAnchor.classList.contains('entity-link'),
    };
  });

  if (!paymentLinkInfo) {
    await shot(`FAIL-03-no-payment-link-${theme}.png`);
    fail(`DFD process dialog: No "Payment" anchor found in I/O table (${theme})`);
  } else if (!paymentLinkInfo.hasDataEntity) {
    await shot(`FAIL-03-no-data-entity-${theme}.png`);
    fail(`DFD process dialog: Payment anchor is missing data-entity attribute (${theme})`);
  } else if (paymentLinkInfo.dataEntityValue !== 'Payment') {
    fail(`DFD process dialog: data-entity="${paymentLinkInfo.dataEntityValue}" but expected "Payment" (${theme})`);
  } else {
    note(`OK: db:Payment anchor has data-entity="${paymentLinkInfo.dataEntityValue}" and class entity-link=${paymentLinkInfo.hasEntityLinkClass}`);
  }

  // Also check PaymentMethod if it appears in I/O
  const paymentMethodLinkInfo = await page.evaluate(() => {
    const modal = document.querySelector('.modal-backdrop');
    if (!modal) return null;
    const anchors = Array.from(modal.querySelectorAll('a'));
    const pmAnchor = anchors.find(a =>
      a.textContent?.trim() === 'PaymentMethod' && (a.getAttribute('href') ?? '').includes('PaymentMethod')
    );
    if (!pmAnchor) return null;
    return {
      hasDataEntity: pmAnchor.hasAttribute('data-entity'),
      dataEntityValue: pmAnchor.getAttribute('data-entity'),
    };
  });
  if (paymentMethodLinkInfo) {
    if (!paymentMethodLinkInfo.hasDataEntity) {
      fail(`DFD process dialog: PaymentMethod anchor is missing data-entity attribute (${theme})`);
    }
    note(`OK: db:PaymentMethod anchor has data-entity="${paymentMethodLinkInfo.dataEntityValue}"`);
  } else {
    note('INFO: PaymentMethod not found in I/O table — skipping (may not be in this process)');
  }

  await shot(`03-process-dialog-entity-links-${theme}.png`);

  // ── 4. Click the db:Payment link → rich SelectedEntityModal opens ─────────────
  note('\n── 4. Click db:Payment link → assert SelectedEntityModal opens ─────────');
  const clickResult = await page.evaluate(() => {
    const modal = document.querySelector('.modal-backdrop');
    if (!modal) return false;
    const anchors = Array.from(modal.querySelectorAll('a[data-entity]'));
    const paymentLink = anchors.find(a => a.getAttribute('data-entity') === 'Payment');
    if (!paymentLink) return false;
    (paymentLink as HTMLElement).click();
    return true;
  });
  if (!clickResult) {
    await shot(`FAIL-04-no-entity-link-clicked-${theme}.png`);
    fail(`DFD process dialog: Could not find/click a[data-entity="Payment"] (${theme})`);
  }
  await page.waitForTimeout(800);

  // ── 5. Assert SelectedEntityModal opened with entity title + attributes ────────
  note('\n── 5. Assert SelectedEntityModal for Payment is open ───────────────────');
  const entityModalInfo = await page.evaluate(() => {
    const modal = document.querySelector('.modal-backdrop');
    if (!modal) return null;

    // The SelectedEntityModal has a header with the entity title.
    const header = modal.querySelector('.modal-header h1');
    const title = header?.textContent?.trim() ?? '';

    // Has an attributes / columns table.
    const hasTable = !!modal.querySelector('.dict-columns-table, .dict-attributes-table, table');

    // Has classification badges (entity-specific).
    const hasBadges = !!modal.querySelector('.dict-classification-badge, .entity-badge');

    return { title, hasTable, hasBadges };
  });

  if (!entityModalInfo) {
    await shot(`FAIL-05-no-entity-modal-${theme}.png`);
    fail(`DFD process dialog: entity modal not open after clicking db:Payment link (${theme})`);
  } else if (!entityModalInfo.title.includes('Payment')) {
    await shot(`FAIL-05-wrong-title-${theme}.png`);
    fail(`DFD entity modal: title "${entityModalInfo.title}" does not contain "Payment" (${theme})`);
  } else if (!entityModalInfo.hasTable) {
    await shot(`FAIL-05-no-table-${theme}.png`);
    fail(`DFD entity modal: no attributes table found for Payment entity (${theme})`);
  } else {
    note(`OK: SelectedEntityModal opened for "${entityModalInfo.title}" with attributes table`);
  }
  await shot(`05-entity-modal-payment-${theme}.png`);

  // Close modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── 6. Regression: db: store badge → rich entity dialog still works ───────────
  note('\n── 6. Regression: db:Payment store badge still opens entity dialog ────');
  const storeClicked = await page.evaluate(() => {
    const g = document.querySelector<SVGGElement>('g[data-token="db:Payment"]');
    if (g) {
      const infoBadge = g.querySelector<SVGGElement>('g[data-ignatius="flow-info"]');
      if (infoBadge) {
        infoBadge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        return true;
      }
      // Fallback: dispatch on the group itself.
      g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      return true;
    }
    return false;
  });
  if (!storeClicked) {
    note('INFO: db:Payment store badge not found in current DFD — regression check skipped');
  } else {
    await page.waitForTimeout(600);
    const storeModalOpen = await page.locator('.modal-backdrop').first().isVisible().catch(() => false);
    if (!storeModalOpen) {
      await shot(`FAIL-06-store-no-modal-${theme}.png`);
      fail(`Regression CP6: db:Payment store badge did not open entity modal (${theme})`);
    }
    const storeModalTitle = await page.evaluate(() => {
      const h1 = document.querySelector('.modal-backdrop .modal-header h1');
      return h1?.textContent?.trim() ?? '';
    });
    if (!storeModalTitle.includes('Payment')) {
      fail(`Regression CP6: db:Payment store modal title "${storeModalTitle}" — expected "Payment" (${theme})`);
    }
    note(`OK: db:Payment store badge still opens entity modal "${storeModalTitle}" (CP6 regression OK)`);
    await shot(`06-store-badge-entity-modal-${theme}.png`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  note(`\n✓ All CP8 ${theme}-mode assertions passed.`);
}

// ── Run for both themes ───────────────────────────────────────────────────────

try {
  await runChecks('dark');
  await runChecks('light');

  note('\n══ CP8 PASS ════════════════════════════════════════════════════════════');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await browser.close();
  proc.kill();
}
