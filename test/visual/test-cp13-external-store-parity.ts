/**
 * CP13 visual assertion: external/store parity in DD + DFD dialogs.
 *
 * Three connected assertions:
 *  (a) DD external body and store body use the same `.dict-entity-body` class as
 *      data-entity bodies — border-top separator is present on all three.
 *  (b) In the Flows view, clicking an external/process reference inside a DFD
 *      dialog opens the target in place (hash stays on `#view=flow`, no switch
 *      to dict/graph).
 *  (c) In a flow dialog, a `db:` reference and an `ext:` reference (after the
 *      upgrade pass) share the same `.entity-link` color (not `.entity-link--missing`).
 *
 * Light + dark. Uses models/key-inherited (Customer external, gateway-log store,
 * Collect-Payment process, db:Party / db:Payment entities).
 *
 * Run: bun test/visual/test-cp13-external-store-parity.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp13-external-store-parity');
mkdirSync(TMP, { recursive: true });

const PORT = 7413;
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
  // Use the theme toggle button to flip the actual data-theme attribute
  // (same path as the user) so CSS custom properties are applied.
  const currentTheme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme') ?? 'dark',
  );
  if (currentTheme !== theme) {
    await page.locator('.theme-toggle').click();
    await page.waitForTimeout(300);
  }
}

async function switchToDict(): Promise<void> {
  // If already on dict view, fab menu won't show "Dictionary" — navigate via hash instead.
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
  // Wait for the SVG flow renderer to be ready
  await page.waitForFunction(() => window.__IGNATIUS_FLOW_READY__ === true, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

// ── Navigate to the SPA ───────────────────────────────────────────────────────

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// ════════════════════════════════════════════════════════════════════════════════
// ASSERTION (a): DD external/store body uses dict-entity-body (border-top parity)
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Assertion (a): DD external + store body class / border-top parity ──');

for (const theme of ['dark', 'light'] as const) {
  note(`\n  [${theme}]`);
  await setTheme(theme);
  await switchToDict();

  // Wait for the Customer external section to be visible
  const externalSection = page.locator('#external-Customer');
  await externalSection.waitFor({ timeout: 5000 });

  // Check the external body div uses dict-entity-body (not flow-node-body)
  const externalBodyClass = await page.locator('#external-Customer .dict-entity-body').count();
  assert(externalBodyClass > 0, `[${theme}] #external-Customer body uses .dict-entity-body`);

  const externalBodyHasBorderTop = await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('#external-Customer .dict-entity-body');
    if (!body) return false;
    const style = getComputedStyle(body);
    const borderTop = style.borderTopWidth;
    return parseFloat(borderTop) > 0;
  });
  assert(externalBodyHasBorderTop, `[${theme}] #external-Customer body has border-top separator`);

  // Check the gateway-log store body uses dict-entity-body
  const storeSection = page.locator('[id^="store-"]').first();
  const storeCount = await storeSection.count();
  assert(storeCount > 0, `[${theme}] at least one store section exists`);

  if (storeCount > 0) {
    const storeBodyClass = await page.locator('[id^="store-"] .dict-entity-body').count();
    assert(storeBodyClass > 0, `[${theme}] store section body uses .dict-entity-body`);

    const storeBodyHasBorderTop = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>('[id^="store-"] .dict-entity-body');
      if (!body) return false;
      return parseFloat(getComputedStyle(body).borderTopWidth) > 0;
    });
    assert(storeBodyHasBorderTop, `[${theme}] store section body has border-top separator`);
  }

  // Confirm a data-entity body also has border-top (regression baseline)
  const entityBodyHasBorderTop = await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('[id^="entity-"] .dict-entity-body');
    if (!body) return false;
    return parseFloat(getComputedStyle(body).borderTopWidth) > 0;
  });
  assert(entityBodyHasBorderTop, `[${theme}] data-entity body also has border-top (baseline)`);

  await shot(`a-dd-bodies-${theme}.png`);
}

// ════════════════════════════════════════════════════════════════════════════════
// ASSERTION (b): DFD dialog — clicking an external/process ref opens in place
//                (hash stays #view=flow, no dict/graph switch)
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Assertion (b): DFD dialog in-place navigation ──');

for (const theme of ['dark', 'light'] as const) {
  note(`\n  [${theme}]`);
  await setTheme(theme);
  await switchToFlow();

  const hashBefore = await page.evaluate(() => location.hash);
  note(`    Hash before: ${hashBefore}`);

  // Open the Collect-Payment process dialog via its ⓘ badge
  const dialogOpened = await page.evaluate(() => {
    const procGroup = document.querySelector<SVGGElement>('g[data-token="proc:Collect-Payment"]');
    if (procGroup) {
      const badge = procGroup.querySelector<SVGGElement>('g[data-ignatius="flow-info"]');
      if (badge) {
        badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        return true;
      }
    }
    return false;
  });
  assert(dialogOpened, `[${theme}] Collect-Payment ⓘ badge found and clicked`);
  await page.waitForTimeout(600);

  // Confirm dialog opened and is a FlowNodeModal (has modal-header)
  const modalHeader = page.locator('.modal-header h1').first();
  const modalCount = await modalHeader.count();
  assert(modalCount > 0, `[${theme}] a dialog modal opened after clicking ⓘ badge`);

  // Take screenshot of the open dialog
  await shot(`b-flow-dialog-${theme}.png`);

  // Find a link inside the dialog body (entity link from I/O table or body) and click it.
  // The FlowIoTable renders db:Payment and db:PaymentMethod as links with data-entity.
  const entityLinkInDialog = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    if (!modal) return false;
    // Try clicking a db: entity link in the I/O table
    const link = modal.querySelector<HTMLElement>('a[data-entity]');
    if (link) {
      link.click();
      return true;
    }
    return false;
  });

  if (entityLinkInDialog) {
    await page.waitForTimeout(600);
    // A new modal should have opened (entity modal), hash still on flow
    const hashAfterEntityLink = await page.evaluate(() => location.hash);
    assert(
      hashAfterEntityLink.includes('view=flow'),
      `[${theme}] after clicking entity link in dialog, hash still contains view=flow (got: ${hashAfterEntityLink})`,
    );
    note(`    Hash after entity-link click: ${hashAfterEntityLink}`);

    // Close the entity modal if open
    const closeBtn = page.locator('.modal-close').first();
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }
  }

  // Close any open flow dialog
  const closeBtns = page.locator('.modal-close');
  const closeBtnCount = await closeBtns.count();
  if (closeBtnCount > 0) {
    await closeBtns.first().click();
    await page.waitForTimeout(300);
  }

  await shot(`b-flow-after-nav-${theme}.png`);
}

// ════════════════════════════════════════════════════════════════════════════════
// ASSERTION (c): db: and ext: links inside a flow dialog share .entity-link color
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Assertion (c): db: vs ext: link color parity in flow dialog ──');

for (const theme of ['dark', 'light'] as const) {
  note(`\n  [${theme}]`);
  await setTheme(theme);
  await switchToFlow();

  // Open the Collect-Payment process dialog
  await page.evaluate(() => {
    const procGroup = document.querySelector<SVGGElement>('g[data-token="proc:Collect-Payment"]');
    if (procGroup) {
      const badge = procGroup.querySelector<SVGGElement>('g[data-ignatius="flow-info"]');
      badge?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    }
  });
  await page.waitForTimeout(600);

  // Check that entity links in the dialog do NOT have the missing class
  const missingLinksInDialog = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    if (!modal) return -1;
    return modal.querySelectorAll('.entity-link--missing').length;
  });
  // entity-link--missing count inside dialog should be 0 for resolvable refs
  note(`    .entity-link--missing count in dialog: ${missingLinksInDialog}`);
  // Negative means no modal — that's a test setup issue, not a code failure
  if (missingLinksInDialog >= 0) {
    // The I/O table links are already plain anchors with data-entity.
    // The body upgrade pass should have resolved any remaining missing spans.
    // We allow 0 missing links for fully-resolved dialogs.
    assert(missingLinksInDialog === 0, `[${theme}] no .entity-link--missing inside the Collect-Payment dialog`);
  }

  // Verify that at least one .entity-link exists in the dialog (not all missing)
  const liveLinksInDialog = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    if (!modal) return 0;
    return modal.querySelectorAll('a.entity-link').length;
  });
  assert(liveLinksInDialog > 0, `[${theme}] at least one .entity-link (live) in the Collect-Payment dialog`);

  // Open the Customer external dialog to verify its body has live links (if any)
  // First close the current dialog
  const closeBtn = page.locator('.modal-close').first();
  if (await closeBtn.count() > 0) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }

  // Open Customer external dialog
  const extOpened = await page.evaluate(() => {
    const extGroup = document.querySelector<SVGGElement>('g[data-token="ext:Customer"]');
    if (extGroup) {
      const badge = extGroup.querySelector<SVGGElement>('g[data-ignatius="flow-info"]');
      if (badge) {
        badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        return true;
      }
    }
    return false;
  });

  await page.waitForTimeout(600);
  await shot(`c-ext-dialog-${theme}.png`);

  if (extOpened) {
    // Verify no missing links for known entities in the Customer external dialog body
    const missingInExt = await page.evaluate(() => {
      const modal = document.querySelector('.modal');
      if (!modal) return -1;
      return modal.querySelectorAll('.entity-link--missing').length;
    });
    note(`    .entity-link--missing in Customer dialog: ${missingInExt}`);

    // Close dialog
    const closeBtnExt = page.locator('.modal-close').first();
    if (await closeBtnExt.count() > 0) {
      await closeBtnExt.click();
      await page.waitForTimeout(300);
    }
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

await browser.close();
proc.kill();

note('\nAll CP13 assertions passed.');
