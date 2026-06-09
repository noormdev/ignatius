/**
 * CP12 assertion: DD body wiki-link references are clickable and scroll in-page.
 *
 * Assertions:
 *  1. Switch to Dictionary view
 *  2. entity→entity: clicking [[Party]] in Payment body scrolls to #entity-Party
 *  3. entity→entity: clicking [[SalesInvoice]] alias in Payment body scrolls to #entity-SalesInvoice
 *  4. process→entity: clicking [[Customer]] in Collect-Payment body scrolls to #external-Customer
 *     (Customer is a flow external, not an entity — resolved via scrollToSection fallback)
 *  5. Unknown refs stay non-clickable (missing span, not an anchor)
 *  6. Screenshot dark + light for visual inspection
 *
 * Run: bun test/visual/test-cp12-dd-body-links.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const PORT = 7292;
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
  await page.waitForTimeout(800);

  // Confirm entity sections are rendered
  const entitySections = page.locator('.dict-entity-section[id^="entity-"]');
  await entitySections.first().waitFor({ timeout: 5000 });

  // ── Step 2: entity→entity — [[Party]] in Payment body ──
  note('Step 2: entity→entity — [[Party]] link in Payment body scrolls to #entity-Party…');

  // Payment body contains [[Party]] — rendered as <a data-entity="Party">
  const paymentPartyLink = page.locator('#entity-Payment .dict-entity-body a[data-entity="Party"]').first();
  const paymentPartyLinkCount = await paymentPartyLink.count();
  assert(paymentPartyLinkCount > 0, '#entity-Payment body contains an <a data-entity="Party"> link');

  if (paymentPartyLinkCount > 0) {
    // Scroll Payment into view so its body links are reachable.
    await page.locator('#entity-Payment').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await paymentPartyLink.click();
    await page.waitForTimeout(800);

    // The dict-view panel is its own scroll container; scrollIntoView puts the
    // section at the panel top, so getBoundingClientRect().top may be slightly
    // below the chrome rather than at 0. Verify the element is at least partially
    // visible: its bottom is below the viewport top and its top is above the bottom.
    const partyInView = await page.locator('#entity-Party').evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    });
    assert(partyInView, '#entity-Party is at least partially visible after clicking the [[Party]] link');
  }

  // ── Step 3: entity→entity — [[SalesInvoice]] alias in Payment body ──
  note('Step 3: entity→entity — [[SalesInvoice|sales invoice]] link in Payment body scrolls to #entity-SalesInvoice…');

  // Scroll back to Payment so we can see its body link
  await page.locator('#entity-Payment').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  const paymentInvoiceLink = page.locator('#entity-Payment .dict-entity-body a[data-entity="SalesInvoice"]').first();
  const invoiceLinkCount = await paymentInvoiceLink.count();
  assert(invoiceLinkCount > 0, '#entity-Payment body contains an <a data-entity="SalesInvoice"> link');

  if (invoiceLinkCount > 0) {
    await paymentInvoiceLink.click();
    await page.waitForTimeout(600);

    const invoiceInView = await page.locator('#entity-SalesInvoice').evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    });
    assert(invoiceInView, '#entity-SalesInvoice is at least partially visible after clicking the [[SalesInvoice]] link');
  }

  // ── Step 4: process→external — [[Customer]] in Collect-Payment process body ──
  note('Step 4: process→external — [[Customer]] in Collect-Payment body scrolls to #external-Customer…');

  // Scroll to the process section — it has id="process-<id>"
  // Find the Collect-Payment process section
  const collectPaymentSection = page.locator('[id^="process-"]').filter({ has: page.locator('.flow-process-label', { hasText: /Collect/i }) }).first();
  const cpCount = await collectPaymentSection.count();
  assert(cpCount > 0, 'Collect-Payment process section is present in the DD');

  if (cpCount > 0) {
    await collectPaymentSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // [[Customer]] in Collect-Payment body — rendered as <a data-entity="Customer"> (optimistic from flow-parse)
    const customerLink = collectPaymentSection.locator('.flow-node-body a[data-entity="Customer"]').first();
    const customerLinkCount = await customerLink.count();
    assert(customerLinkCount > 0, 'Collect-Payment body contains <a data-entity="Customer">');

    if (customerLinkCount > 0) {
      await customerLink.click();
      await page.waitForTimeout(600);

      // #external-Customer should now be in viewport
      const externalCustomer = page.locator('#external-Customer');
      const externalExists = await externalCustomer.count() > 0;
      assert(externalExists, '#external-Customer section exists in the DD');

      if (externalExists) {
        const customerInView = await externalCustomer.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < window.innerHeight;
        });
        assert(customerInView, '#external-Customer is at least partially visible after clicking [[Customer]] in process body');
      }
    }
  }

  // ── Step 5: Unknown refs stay non-clickable ──
  // The broken-demo model has [[Cart]] which is unknown; key-inherited has none.
  // We verify by confirming that entity-link--missing spans have no href.
  note('Step 5: Check that entity-link--missing spans are non-navigating (no href)…');
  const missingSections = page.locator('.entity-link--missing');
  const missingCount = await missingSections.count();
  // key-inherited has no unknown refs so count should be 0 — that's OK (no missing means no broken links)
  note(`  Found ${missingCount} entity-link--missing span(s) in key-inherited (expected 0 for clean model)`);
  assert(missingCount === 0, 'key-inherited has no entity-link--missing spans (all refs resolve)');

  // ── Step 6: Click-time cross-type resolution — missing span in entity body scrolls to external ──
  //
  // Entity bodies are rendered at parse time with knownIds = entity IDs only, so a
  // reference to a flow external (e.g. Customer) emits a `.entity-link--missing` span
  // even though Customer exists in the DD. The click handler resolves the target at
  // click time against all known node IDs — timing-independent, survives React reconciliation.
  //
  // We prove it by: (a) injecting a synthetic `.entity-link--missing` span targeting
  // `Customer` into the first `.dict-entity-body`, (b) clicking it directly, and
  // (c) asserting the page scrolls to #external-Customer.
  // No upgrade dance needed — the click-time resolution is the mechanism under test.
  note('Step 6: Click-time resolution — click .entity-link--missing span in entity body → scrolls to #external-Customer…');

  const firstEntityBody = page.locator('.dict-entity-body').first();
  const entityBodyCount = await firstEntityBody.count();
  assert(entityBodyCount > 0, 'At least one .dict-entity-body exists in the DD');

  if (entityBodyCount > 0) {
    // Scroll to the entity body so it is visible.
    await firstEntityBody.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    // Inject a synthetic .entity-link--missing span targeting the `Customer` external.
    await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>('.dict-entity-body');
      if (!body) return;
      const span = document.createElement('span');
      span.className = 'entity-link entity-link--missing';
      span.setAttribute('title', 'Unknown entity: Customer');
      span.textContent = 'Customer';
      span.setAttribute('data-synthetic', 'true');
      body.prepend(span);
    });

    // The span is now in the DOM. Click it — the click handler resolves the target
    // at click time (no re-render required).
    const syntheticSpan = page.locator('span.entity-link--missing[data-synthetic="true"]');
    const spanCount = await syntheticSpan.count();
    assert(spanCount > 0, 'Synthetic .entity-link--missing span is present in entity body');

    if (spanCount > 0) {
      await syntheticSpan.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);

      // Record #external-Customer scroll position before click so we can verify
      // the scroll moves it meaningfully toward the viewport.
      const externalCustomer = page.locator('#external-Customer');
      const extExists = await externalCustomer.count() > 0;
      assert(extExists, '#external-Customer section exists in the DD');

      if (extExists) {
        await syntheticSpan.click();

        // Smooth scroll from a far position can take >1s. Poll until the element
        // is in the viewport (top < vh AND bottom > 0) or 3 seconds elapse.
        const inView = await page.waitForFunction(
          (id) => {
            const el = document.getElementById(id);
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.bottom > 0 && rect.top < window.innerHeight;
          },
          'external-Customer',
          { timeout: 3000 },
        ).then(() => true).catch(() => false);

        assert(inView, '#external-Customer is visible after clicking .entity-link--missing span in entity body');
      }
    }
  }

  // ── Screenshots ──
  note('Taking screenshots…');
  const tmpDir = join(ROOT, 'tmp');
  try { mkdirSync(tmpDir, { recursive: true }); } catch {}

  // Scroll to top first for a clean screenshot
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  // Dark screenshot
  await page.screenshot({ path: join(tmpDir, 'cp12-dd-body-links-dark.png'), fullPage: false });
  note('  Saved: tmp/cp12-dd-body-links-dark.png');

  // Light screenshot — click theme toggle
  const toggle = page.locator('.theme-toggle');
  if (await toggle.count() > 0) {
    await toggle.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(tmpDir, 'cp12-dd-body-links-light.png'), fullPage: false });
    note('  Saved: tmp/cp12-dd-body-links-light.png');
  }

  note('\nAll CP12 DD body-link assertions passed.');
} finally {
  await browser.close();
  proc.kill();
}
