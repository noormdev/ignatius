/**
 * CP15 visual assertion: kind-colored DFD stores and externals.
 *
 * Asserts:
 *  (a) The `kind: file` store (gateway-log, in order-to-cash) renders a fill
 *      DISTINCT from a `db:` store in both dark and light modes.
 *  (b) The `kind: file` store's fill matches the expected lime palette (#1a2e05 dark /
 *      #f7fee7 light) — proving the kind palette is actually wired through.
 *  (c) DB stores use the legacy amber palette, not the lime file palette.
 *  (d) External entity (no kind) stays the conventional green — no visual regression.
 *
 * The `gateway-log` store is in:
 *   models/key-inherited/flows/order-to-cash/_stores/gateway-log.md  (kind: file)
 * DB stores present in order-to-cash: db:Party, db:Payment (etc.)
 *
 * Run: bun test/visual/test-cp15-kind-colors.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp15-kind-colors');
mkdirSync(TMP, { recursive: true });

const PORT = 7415;
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

// Navigate to the flows view and open order-to-cash
async function navigateToOrderToCash(): Promise<void> {
  await page.goto(`${BASE}/#view=flow&dfd=order-to-cash`, { waitUntil: 'domcontentloaded' });
  // Wait for the flow SVG to render
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>)['__IGNATIUS_FLOW_READY__'] === true,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(500);
}

// ── Helper: read fill of a node by its data-token attribute ──────────────────

/**
 * Get the computed fill of the first <rect> inside the node group with data-token.
 * Returns null if the node isn't found.
 */
async function getNodeFill(token: string): Promise<string | null> {
  return page.evaluate((t) => {
    const g = document.querySelector(`[data-token="${t}"]`);
    if (!g) return null;
    const rect = g.querySelector('rect');
    if (!rect) return null;
    return rect.getAttribute('fill');
  }, token);
}

// ── Dark mode ─────────────────────────────────────────────────────────────────

note('\n--- Dark mode ---');
await navigateToOrderToCash();
await setTheme('dark');
await page.waitForTimeout(500);
await shot('dark-order-to-cash.png');

// The gateway-log store is token `file:gateway-log`
const darkFileFill = await getNodeFill('file:gateway-log');
note(`  gateway-log fill (dark): ${darkFileFill}`);

// A db: store — db:Payment should be present in order-to-cash
const darkDbFill = await getNodeFill('db:Payment');
note(`  db:Payment fill (dark): ${darkDbFill}`);

assert(darkFileFill !== null, 'dark: file:gateway-log node found in SVG');
assert(darkDbFill !== null, 'dark: db:Payment node found in SVG');
assert(darkFileFill !== darkDbFill, 'dark: file store fill DISTINCT from db store fill');

// The lime dark fill should be #1a2e05
assert(darkFileFill === '#1a2e05', `dark: file store bg is lime #1a2e05 (got: ${darkFileFill})`);
// The amber dark fill should be #3d2e00
assert(darkDbFill === '#3d2e00', `dark: db store bg is amber #3d2e00 (got: ${darkDbFill})`);

// Check an external (Customer) stays conventional green (#1a3a1a).
// The external token is the file slug without prefix, e.g. "Customer" (not "ext:Customer").
// Multiple copies may exist (src/snk routing) — check the first one.
const darkExtFill = await page.evaluate(() => {
  // External nodes use data-node-type="external"; find the first one.
  const g = document.querySelector('[data-node-type="external"]');
  if (!g) return null;
  const rect = g.querySelector('rect');
  return rect ? rect.getAttribute('fill') : null;
});
note(`  Customer external fill (dark): ${darkExtFill}`);
assert(darkExtFill !== null, 'dark: Customer external node found');
assert(darkExtFill === '#1a3a1a', `dark: external stays green #1a3a1a (got: ${darkExtFill})`);

// ── Light mode ────────────────────────────────────────────────────────────────

note('\n--- Light mode ---');
await setTheme('light');
await page.waitForTimeout(500);
await shot('light-order-to-cash.png');

const lightFileFill = await getNodeFill('file:gateway-log');
note(`  gateway-log fill (light): ${lightFileFill}`);

const lightDbFill = await getNodeFill('db:Payment');
note(`  db:Payment fill (light): ${lightDbFill}`);

assert(lightFileFill !== null, 'light: file:gateway-log node found in SVG');
assert(lightDbFill !== null, 'light: db:Payment node found in SVG');
assert(lightFileFill !== lightDbFill, 'light: file store fill DISTINCT from db store fill');

// The lime light fill should be #f7fee7
assert(lightFileFill === '#f7fee7', `light: file store bg is lime #f7fee7 (got: ${lightFileFill})`);
// The amber light fill should be #fef9c3
assert(lightDbFill === '#fef9c3', `light: db store bg is amber #fef9c3 (got: ${lightDbFill})`);

// Check external stays conventional green (#dcfce7)
const lightExtFill = await page.evaluate(() => {
  const g = document.querySelector('[data-node-type="external"]');
  if (!g) return null;
  const rect = g.querySelector('rect');
  return rect ? rect.getAttribute('fill') : null;
});
note(`  Customer external fill (light): ${lightExtFill}`);
assert(lightExtFill !== null, 'light: Customer external node found');
assert(lightExtFill === '#dcfce7', `light: external stays green #dcfce7 (got: ${lightExtFill})`);

// ── Cleanup ───────────────────────────────────────────────────────────────────

await browser.close();
proc.kill();

note('\n=== All CP15 kind-colors visual checks passed ===');
note(`Screenshots in: ${TMP}`);
