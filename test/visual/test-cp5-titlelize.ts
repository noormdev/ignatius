/**
 * Visual verification: CP5 — Title metadata + titlelize fallback.
 *
 * Proves:
 *   1. DFD nav card shows "Order To Cash" (not raw "order-to-cash")
 *   2. DFD nav card shows "Refund" (already a clean word, still title-cased)
 *   3. Raw slug "order-to-cash" does NOT appear as visible text in the nav card
 *   4. Breadcrumb chip shows the titlelized DFD name (e.g. "Order To Cash")
 *   5. Screenshot captured for human inspection.
 *
 * Uses: models/key-inherited (has flows/order-to-cash + flows/refund)
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp5-titlelize');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', 'models/key-inherited', '--port', '7401'],
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

const serverReady = await waitForServer('http://localhost:7401', 12_000);
if (!serverReady) fail('Server did not start within 12 seconds');
note('Server ready at http://localhost:7401');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForFlow(): Promise<void> {
  const ok = await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Flow (__IGNATIUS_FLOW_READY__) did not become ready');
}

async function waitForGraph(): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 12_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Graph (__IGNATIUS_CY__) did not become ready');
}

async function goToFlow(): Promise<void> {
  const fab = page.locator('.fab');
  await fab.click();
  await page.waitForTimeout(500);
  const flowsItem = page.getByRole('menuitem', { name: 'Data Flows', exact: true });
  const c = await flowsItem.count();
  if (c === 0) {
    // Log all menuitem text for diagnosis
    const items = await page.locator('[role="menuitem"]').allTextContents();
    note(`Available menu items: ${JSON.stringify(items)}`);
    fail('FAB menu has no "Data Flows" item');
  }
  await flowsItem.click();
  await waitForFlow();
  await page.waitForTimeout(1000); // chrome settle
}

// ── Test ──────────────────────────────────────────────────────────────────────

try {
  await page.goto('http://localhost:7401/');
  await page.waitForLoadState('domcontentloaded');
  await waitForGraph();

  note('\n── 1. Navigate to flow view ──────────────────────────────────────────────');
  await goToFlow();

  const shot1 = join(TMP, '01-flow-nav-card.png');
  await page.screenshot({ path: shot1, fullPage: false });
  note(`Screenshot (flow nav card): ${shot1}`);

  // ── 2. Check nav card text ────────────────────────────────────────────────

  note('\n── 2. Assert nav card contains titlelized DFD names ──────────────────────');

  // Collect all visible text in nav card buttons.
  const navCardText: string = await page.evaluate(() => {
    // The nav card contains an h2 "Process Flows" and buttons for each DFD.
    // Find the nav card by its h2 heading text.
    const headings = Array.from(document.querySelectorAll('h2'));
    for (const h of headings) {
      if (h.textContent?.trim() === 'Process Flows') {
        return h.parentElement?.textContent ?? '';
      }
    }
    return '';
  });

  note(`Nav card full text: "${navCardText}"`);

  // Assert "Order To Cash" appears in nav card
  if (!navCardText.includes('Order To Cash')) {
    fail(`P1: Nav card does not contain "Order To Cash" — got: "${navCardText}"`);
  }
  note('OK P1: Nav card contains "Order To Cash"');

  // Assert "Refund" appears
  if (!navCardText.includes('Refund')) {
    fail(`P2: Nav card does not contain "Refund" — got: "${navCardText}"`);
  }
  note('OK P2: Nav card contains "Refund"');

  // Assert raw slug "order-to-cash" is NOT in the nav card text
  if (navCardText.toLowerCase().includes('order-to-cash')) {
    fail(`P3: Nav card still contains raw slug "order-to-cash" — got: "${navCardText}"`);
  }
  note('OK P3: Raw slug "order-to-cash" absent from nav card');

  // ── 3. Check breadcrumb ────────────────────────────────────────────────────

  note('\n── 3. Assert breadcrumb contains titlelized DFD name ─────────────────────');

  const breadcrumbText: string = await page.evaluate(() => {
    // Breadcrumb chips are in the absolute-positioned div at top:18px left:240px.
    // Collect all chip div text (border-radius: 8px inline style).
    const allText: string[] = [];
    document.querySelectorAll('div[style*="border-radius: 8px"]').forEach(el => {
      const t = (el as HTMLElement).textContent?.trim();
      if (t) allText.push(t);
    });
    return allText.join(' | ');
  });

  note(`Breadcrumb div text collected: "${breadcrumbText}"`);

  // P4a: "Order To Cash" MUST appear in the breadcrumb (positive assertion).
  // The flow view auto-selects the first DFD on load; its title goes into the breadcrumb.
  if (!breadcrumbText.includes('Order To Cash')) {
    fail(`P4a: Breadcrumb does not contain "Order To Cash" — got: "${breadcrumbText}"`);
  }
  note('OK P4a: Breadcrumb contains "Order To Cash"');

  // P4b: raw slug must NOT appear.
  if (breadcrumbText.toLowerCase().includes('order-to-cash')) {
    fail(`P4b: Raw slug "order-to-cash" appears in breadcrumb chips — got: "${breadcrumbText}"`);
  }
  note('OK P4b: Raw slug "order-to-cash" absent from breadcrumb chips');

  // ── 4 (skipped) — "End Customer" title: override test removed ────────────
  // The title: override proof is now covered by the unit test
  // test/checks/test-cp5-title-override.ts using a synthetic fixture, so the
  // demo model (Customer.md) was reverted to its original frontmatter.
  note('\n── 4. title: override proven by test/checks/test-cp5-title-override.ts ────');
  note('OK: demo model unmutated; unit test guards override + id-resolution behavior');

  // ── 5. Screenshot the nav card area more closely ───────────────────────────

  note('\n── 5. Take focused screenshot of nav card ────────────────────────────────');
  const shot2 = join(TMP, '02-flow-nav-card-focused.png');
  // Clip to the left panel area where the nav card lives
  await page.screenshot({ path: shot2, fullPage: false, clip: { x: 0, y: 60, width: 230, height: 300 } });
  note(`Screenshot (nav card focused): ${shot2}`);

  // ── 6. Screenshot size check ──────────────────────────────────────────────
  const shots = [shot1, shot2];
  for (const s of shots) {
    const f = Bun.file(s);
    note(`  ${s.split('/').pop()}: ${f.size} bytes`);
    if (f.size < 3_000) fail(`Screenshot ${s} suspiciously small (< 3 KB)`);
  }

  note('\nAll CP5 titlelize checks PASSED.');
  note(`Screenshots saved to ${TMP}/`);

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nCP5 visual check PASSED.');
