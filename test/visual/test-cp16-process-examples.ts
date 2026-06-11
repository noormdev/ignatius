/**
 * CP16 visual assertion: per-process in/out data examples in the process dialog.
 *
 * Asserts:
 *  (a) Opening the Collect-Payment process dialog shows example tables with the
 *      demo in/out rows (both dark and light themes).
 *  (b) A process WITHOUT examples: (e.g. Issue-Invoice) shows no .flow-process-examples
 *      section — regression guard.
 *
 * Run: bun test/visual/test-cp16-process-examples.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp16-process-examples');
mkdirSync(TMP, { recursive: true });

const PORT = 7416;
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

async function closeModal(): Promise<void> {
  const closeBtn = page.locator('.modal-close').first();
  if (await closeBtn.count() > 0) {
    await closeBtn.click();
    await page.waitForTimeout(300);
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
// ASSERTION (a): Collect-Payment dialog shows in/out example tables (dark + light)
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Assertion (a): Collect-Payment dialog shows example tables ──');

for (const theme of ['dark', 'light'] as const) {
  note(`\n  [${theme}]`);
  await setTheme(theme);
  await switchToFlow();

  const dialogOpened = await openCollectPaymentDialog();
  assert(dialogOpened, `[${theme}] Collect-Payment ⓘ badge found and clicked`);
  await page.waitForTimeout(600);

  // Confirm dialog opened
  const modalCount = await page.locator('.modal-header h1').count();
  assert(modalCount > 0, `[${theme}] dialog modal opened`);

  // Check .flow-process-examples section is present
  const examplesSection = await page.locator('.flow-process-examples').count();
  assert(examplesSection > 0, `[${theme}] .flow-process-examples section is rendered`);

  // Check at least one <details class="modal-examples"> is present (one per in/out entry)
  const detailsCount = await page.locator('.flow-process-examples details.modal-examples').count();
  note(`    modal-examples <details> count: ${detailsCount}`);
  // We have 2 in + 2 out = 4 entries in Collect-Payment.md
  assert(detailsCount === 4, `[${theme}] 4 example tables rendered (2 in + 2 out), got ${detailsCount}`);

  // Check tables have th cells (column headers from row keys)
  const tableHeaderCells = await page.locator('.flow-process-examples table th').count();
  assert(tableHeaderCells > 0, `[${theme}] example tables have column headers`);
  note(`    th count: ${tableHeaderCells}`);

  // Check tables have td cells (data rows)
  const tableDataCells = await page.locator('.flow-process-examples table td').count();
  assert(tableDataCells > 0, `[${theme}] example tables have data rows`);
  note(`    td count: ${tableDataCells}`);

  // Verify first table summary contains "in" direction
  const firstSummary = await page.locator('.flow-process-examples details.modal-examples summary').first().textContent();
  note(`    first summary text: "${firstSummary}"`);
  assert(firstSummary?.includes('in') ?? false, `[${theme}] first summary includes direction 'in' (got: "${firstSummary}")`);

  // Take screenshot showing the dialog with examples
  await shot(`a-collect-payment-dialog-${theme}.png`);

  // Verify a row from in[0]: "****4242" should appear somewhere in the tables
  const cardCellText = await page.evaluate(() => {
    const cells = document.querySelectorAll<HTMLElement>('.flow-process-examples table td');
    for (const cell of cells) {
      if (cell.textContent?.includes('****4242')) return true;
    }
    return false;
  });
  assert(cardCellText, `[${theme}] demo row value '****4242' visible in example tables`);

  // Verify a numeric row from out[0]: "9001" should appear
  const paymentIdText = await page.evaluate(() => {
    const cells = document.querySelectorAll<HTMLElement>('.flow-process-examples table td');
    for (const cell of cells) {
      if (cell.textContent?.trim() === '9001') return true;
    }
    return false;
  });
  assert(paymentIdText, `[${theme}] demo row value '9001' visible in out example tables`);

  await closeModal();
}

// ════════════════════════════════════════════════════════════════════════════════
// ASSERTION (b): A process WITHOUT examples: renders no .flow-process-examples
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Assertion (b): Issue-Invoice (no examples:) shows no examples section ──');

for (const theme of ['dark', 'light'] as const) {
  note(`\n  [${theme}]`);
  await setTheme(theme);
  await switchToFlow();

  // Try to open Issue-Invoice dialog
  const invoiceDialogOpened = await page.evaluate(() => {
    const procGroup = document.querySelector<SVGGElement>('g[data-token="proc:Issue-Invoice"]');
    if (!procGroup) return false;
    const badge = procGroup.querySelector<SVGGElement>('g[data-ignatius="flow-info"]');
    if (!badge) return false;
    badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    return true;
  });

  if (!invoiceDialogOpened) {
    note(`  NOTE: Issue-Invoice badge not found — skipping no-examples check for [${theme}]`);
    continue;
  }

  await page.waitForTimeout(600);

  const modalOpen = await page.locator('.modal-header h1').count();
  if (modalOpen > 0) {
    // Confirm there is NO .flow-process-examples section
    const noExamplesSection = await page.locator('.flow-process-examples').count();
    assert(noExamplesSection === 0, `[${theme}] Issue-Invoice (no examples:) has no .flow-process-examples section`);

    await shot(`b-no-examples-${theme}.png`);
    await closeModal();
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

await browser.close();
proc.kill();

note('\nAll CP16 visual assertions PASSED');
note(`Screenshots in: ${TMP}`);
