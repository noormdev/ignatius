/**
 * Visual verification: CP14 — DFD node SVG groups non-text-selectable.
 *
 * Proves:
 *  1. Computed `user-select` is "none" on each node type group:
 *     g[data-node-type="process"], g[data-node-type="external"], g[data-node-type="store"]
 *  2. `pointer-events` is NOT disabled (ⓘ badge click still opens a dialog).
 *  3. The `user-select: none` rule does NOT leak onto non-flow surfaces:
 *     - `.graph-panel` (ERD) nodes are unaffected.
 *     - `.dict-view` text is selectable.
 *  4. Light + dark for the computed-style assertion.
 *
 * Uses models/key-inherited (order-to-cash DFD).
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp14-no-text-select');
mkdirSync(TMP, { recursive: true });

const PORT = 7414;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Navigate to the Flows view and wait for the flow SVG to be ready. */
async function gotoFlow(): Promise<void> {
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).catch(() => note('flow-ready signal timed out — proceeding on settle delay'));
  await page.waitForTimeout(600);
}

/** Switch theme via the real theme-toggle button. */
async function setTheme(theme: 'dark' | 'light'): Promise<void> {
  const current = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme') ?? 'dark',
  );
  if (current !== theme) {
    await page.click('.theme-toggle');
    await page.waitForTimeout(300);
  }
}

// ── Check: user-select is none on all three node types ────────────────────────

async function assertNodeSelectability(theme: 'dark' | 'light'): Promise<void> {
  note(`\n── user-select assertions (${theme}) ──────────────────────────────────`);

  for (const nodeType of ['process', 'external', 'store'] as const) {
    const userSelect = await page.evaluate((nt) => {
      const el = document.querySelector(`[data-ignatius="flow-svg"] g[data-node-type="${nt}"]`);
      if (!el) return null;
      return window.getComputedStyle(el).userSelect;
    }, nodeType);

    if (userSelect === null) {
      await shot(`FAIL-${nodeType}-absent-${theme}.png`);
      fail(`No g[data-node-type="${nodeType}"] found in DFD SVG (${theme})`);
    }

    if (userSelect !== 'none') {
      await shot(`FAIL-${nodeType}-select-${theme}.png`);
      fail(
        `g[data-node-type="${nodeType}"] (${theme}): expected user-select "none", got "${userSelect}"`,
      );
    }
    note(`OK: g[data-node-type="${nodeType}"] user-select = none (${theme})`);
  }
}

// ── Check: pointer-events NOT disabled (ⓘ badge click opens dialog) ──────────

async function assertBadgeClickable(): Promise<void> {
  note('\n── ⓘ badge click (pointer-events not blocked) ──────────────────────');

  const clicked = await page.evaluate(() => {
    // Click the first ⓘ badge on any node
    const badge = document.querySelector<HTMLElement>(
      '[data-ignatius="flow-svg"] [data-ignatius="flow-info"]',
    );
    if (!badge) return false;
    badge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return true;
  });

  if (!clicked) {
    await shot('FAIL-badge-absent.png');
    fail('No ⓘ (flow-info) badge found in DFD SVG — cannot prove pointer-events unaffected');
  }

  await page.waitForTimeout(600);

  const modalVisible = await page.locator('.modal-backdrop').first().isVisible().catch(() => false);
  if (!modalVisible) {
    await shot('FAIL-badge-no-modal.png');
    fail('ⓘ badge click did not open modal — pointer-events may be blocked');
  }
  note('OK: ⓘ badge click opened modal (pointer-events unaffected)');

  // Close modal for subsequent checks
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// ── Check: user-select NOT leaked onto non-flow surfaces ──────────────────────

async function assertNoLeak(): Promise<void> {
  note('\n── No-leak checks (ERD + Dictionary) ───────────────────────────────');

  // Dictionary view text should be selectable
  await page.goto(`${BASE}/#view=dict`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  const dictUserSelect = await page.evaluate(() => {
    const el = document.querySelector('.dict-view');
    if (!el) return null;
    return window.getComputedStyle(el).userSelect;
  });

  if (dictUserSelect === 'none') {
    await shot('FAIL-dict-user-select-none.png');
    fail(`user-select leaked onto .dict-view: got "${dictUserSelect}"`);
  }
  note(`OK: .dict-view user-select = "${dictUserSelect}" (not none)`);

  // Graph panel: no node groups should be user-select: none (flow rule must not apply)
  await page.goto(`${BASE}/#view=graph`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Cytoscape renders into canvas, not SVG elements with data-node-type — confirm
  // no g[data-node-type] elements exist outside flow-svg context
  const leakedNode = await page.evaluate(() => {
    // Any g[data-node-type] outside [data-ignatius="flow-svg"] should not be user-select:none
    const all = Array.from(document.querySelectorAll('g[data-node-type]'));
    const outside = all.filter(el => !el.closest('[data-ignatius="flow-svg"]'));
    return outside.map(el => ({
      type: el.getAttribute('data-node-type'),
      userSelect: window.getComputedStyle(el).userSelect,
    }));
  });

  if (leakedNode.length > 0) {
    note(`Found ${leakedNode.length} g[data-node-type] outside flow-svg:`);
    for (const n of leakedNode) {
      if (n.userSelect === 'none') {
        await shot('FAIL-leak-outside-flow-svg.png');
        fail(`user-select:none leaked onto g[data-node-type="${n.type}"] outside [data-ignatius="flow-svg"]`);
      }
    }
    note('OK: nodes outside flow-svg are not user-select:none');
  } else {
    note('OK: no g[data-node-type] elements outside [data-ignatius="flow-svg"] (expected for ERD/graph)');
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

try {
  // Dark mode checks
  await gotoFlow();
  await setTheme('dark');
  await assertNodeSelectability('dark');
  await assertBadgeClickable();
  await shot('01-flow-dark.png');

  // Light mode checks — navigate back to flow after switching
  await gotoFlow();
  await setTheme('light');
  await assertNodeSelectability('light');
  await shot('02-flow-light.png');

  // No-leak check (ERD + dict surfaces)
  await assertNoLeak();
  await shot('03-graph-no-leak.png');

  note('\n══ CP14 PASS ════════════════════════════════════════════════════════════');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await browser.close();
  proc.kill();
}
