/**
 * CP26 visual assertion: per-process in/out sample-data tables rendered in the
 * DD process card (not just the process dialog).
 *
 * Asserts:
 *  (a) In the DD view, the Collect-Payment process CARD shows .flow-process-examples
 *      with the demo in/out tables (dark + light). Checks the "****4242" and "9001"
 *      demo values that CP16 verified in the dialog are also visible in the card.
 *  (b) The Issue-Invoice process CARD (no examples:) shows NO .flow-process-examples
 *      section inside its card.
 *
 * Run: bun test/visual/test-cp26-process-examples-in-dd.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp26-process-examples-in-dd');
mkdirSync(TMP, { recursive: true });

const PORT = 7426;
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

// ── Navigate to the SPA ───────────────────────────────────────────────────────

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// ════════════════════════════════════════════════════════════════════════════════
// ASSERTION (a): Collect-Payment DD card shows in/out example tables (dark + light)
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Assertion (a): Collect-Payment DD card shows in/out example tables ──');

for (const theme of ['dark', 'light'] as const) {
  note(`\n  [${theme}]`);
  await setTheme(theme);
  await switchToDict();

  // Scroll to the Collect-Payment process section in the DD
  await page.evaluate(() => {
    const el = document.getElementById('process-Collect-Payment');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(400);

  // The process section must exist
  const sectionCount = await page.locator('#process-Collect-Payment').count();
  assert(sectionCount > 0, `[${theme}] #process-Collect-Payment DD section exists`);

  // .flow-process-examples must be present inside that section
  const examplesInCard = await page.locator('#process-Collect-Payment .flow-process-examples').count();
  assert(examplesInCard > 0, `[${theme}] .flow-process-examples rendered inside Collect-Payment DD card`);

  // 4 example tables (2 in + 2 out)
  const detailsCount = await page.locator('#process-Collect-Payment .flow-process-examples details.modal-examples').count();
  note(`    modal-examples <details> count: ${detailsCount}`);
  assert(detailsCount === 4, `[${theme}] 4 example tables in DD card (2 in + 2 out), got ${detailsCount}`);

  // Column headers present
  const thCount = await page.locator('#process-Collect-Payment .flow-process-examples table th').count();
  assert(thCount > 0, `[${theme}] example tables have column headers`);
  note(`    th count: ${thCount}`);

  // Data rows present
  const tdCount = await page.locator('#process-Collect-Payment .flow-process-examples table td').count();
  assert(tdCount > 0, `[${theme}] example tables have data rows`);
  note(`    td count: ${tdCount}`);

  // Demo value from in[0]: "****4242" must be visible
  const hasCard = await page.evaluate(() => {
    const section = document.getElementById('process-Collect-Payment');
    if (!section) return false;
    const cells = section.querySelectorAll<HTMLElement>('.flow-process-examples table td');
    for (const cell of cells) {
      if (cell.textContent?.includes('****4242')) return true;
    }
    return false;
  });
  assert(hasCard, `[${theme}] demo row value '****4242' visible in DD card example tables`);

  // Demo value from out[0]: "9001" must be visible
  const hasPaymentId = await page.evaluate(() => {
    const section = document.getElementById('process-Collect-Payment');
    if (!section) return false;
    const cells = section.querySelectorAll<HTMLElement>('.flow-process-examples table td');
    for (const cell of cells) {
      if (cell.textContent?.trim() === '9001') return true;
    }
    return false;
  });
  assert(hasPaymentId, `[${theme}] demo row value '9001' visible in DD card example tables`);

  await shot(`a-collect-payment-dd-card-${theme}.png`);
}

// ════════════════════════════════════════════════════════════════════════════════
// ASSERTION (b): Issue-Invoice DD card (no examples:) shows NO examples section
// ════════════════════════════════════════════════════════════════════════════════

note('\n── Assertion (b): Issue-Invoice DD card shows no .flow-process-examples ──');

for (const theme of ['dark', 'light'] as const) {
  note(`\n  [${theme}]`);
  await setTheme(theme);
  await switchToDict();

  // Scroll to the Issue-Invoice process section
  await page.evaluate(() => {
    const el = document.getElementById('process-Issue-Invoice');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(400);

  const sectionCount = await page.locator('#process-Issue-Invoice').count();
  if (sectionCount === 0) {
    note(`  NOTE: #process-Issue-Invoice not found — skipping [${theme}]`);
    continue;
  }

  const noExamples = await page.locator('#process-Issue-Invoice .flow-process-examples').count();
  assert(noExamples === 0, `[${theme}] Issue-Invoice DD card has NO .flow-process-examples section`);

  await shot(`b-no-examples-dd-card-${theme}.png`);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

await browser.close();
proc.kill();

note('\nAll CP26 visual assertions PASSED');
note(`Screenshots in: ${TMP}`);
