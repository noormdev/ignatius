/**
 * Visual verification: DFD edge hover tooltip.
 *
 * Navigates to a dense DFD in models/llm-memory-db-mssql, hovers a gated
 * db: column-list edge (data-contract-type="hidden"), and screenshots the
 * styled HTML tooltip for human inspection.
 *
 * Run: bun test/visual/test-dfd-edge-hover.ts
 *
 * NOT run by `bun run test` — visual screenshot only. Requires:
 *   - Playwright chromium installed
 *   - models/llm-memory-db-mssql present
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'dfd-edge-hover');
mkdirSync(TMP, { recursive: true });

const PORT = 7415;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting server for models/llm-memory-db-mssql…');
const MODEL = join(ROOT, 'models/llm-memory-db-mssql');
const serverHandle = serveCommand(MODEL, { port: PORT });

async function waitForServer(url: string, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await new Promise<void>(r => setTimeout(r, 250));
  }
  return false;
}

const serverReady = await waitForServer(BASE, 15_000);
if (!serverReady) fail('Server did not start within 15 seconds');
note(`Server ready at ${BASE}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function shot(name: string): Promise<string> {
  const p = join(TMP, name);
  await page.screenshot({ path: p, fullPage: false });
  note(`  Screenshot: ${p}`);
  return p;
}

// ── Navigate to the Flows view and select a dense diagram ─────────────────────

note('Loading app…');
await page.goto(`${BASE}/#view=flow`, { waitUntil: 'load' });
const flowReady = await page.waitForFunction(
  () => !!(window as { __IGNATIUS_FLOW_READY__?: unknown }).__IGNATIUS_FLOW_READY__,
  undefined,
  { timeout: 40_000 },
).then(() => true).catch(() => false);
if (!flowReady) fail('Flow view did not signal ready in 40 s');
await page.waitForTimeout(800);

note('Navigating to memory-lifecycle diagram…');
await page.evaluate(() => {
  const handle = (window as { __IGNATIUS_FLOW_HANDLE__?: { selectDiagramById?: (id: string) => void } }).__IGNATIUS_FLOW_HANDLE__;
  if (handle?.selectDiagramById) {
    handle.selectDiagramById('memory-lifecycle');
  } else {
    location.hash = '#view=flow&dfd=memory-lifecycle';
  }
});
await page.waitForTimeout(1500);

await shot('01-diagram-loaded.png');
note('  Captured diagram without hover.');

// ── Find a gated db: edge and hover it ───────────────────────────────────────

note('Looking for a gated (hidden) db: edge…');
const hiddenEdgeContract = await page.evaluate((): string | null => {
  const svg = document.querySelector('[data-ignatius="flow-svg"]');
  if (!svg) return null;
  for (const g of svg.querySelectorAll('[data-contract-type="hidden"]')) {
    const contract = g.getAttribute('data-contract') ?? '';
    if (contract) return contract;
  }
  return null;
});

if (hiddenEdgeContract === null) {
  fail('No gated (hidden) db: edge found in memory-lifecycle — cannot screenshot hover tooltip');
  throw new Error('unreachable');
}

note(`  Found gated edge: "${hiddenEdgeContract.slice(0, 60)}…"`);

// Compute a point on the actual edge stroke using SVG path geometry, then move
// the mouse to that exact screen coordinate so pointer events fire on the path.
const hoverPoint = await page.evaluate((): { x: number; y: number } | null => {
  const svg = document.querySelector('[data-ignatius="flow-svg"]');
  if (!svg) return null;
  const g = svg.querySelector('[data-contract-type="hidden"]') as SVGGElement | null;
  if (!g) return null;
  const paths = g.querySelectorAll('path');
  const hitPath = paths[paths.length - 1] as SVGPathElement | null;
  if (!hitPath) return null;
  const totalLen = hitPath.getTotalLength();
  if (totalLen === 0) return null;
  const pt = hitPath.getPointAtLength(totalLen / 2);
  const svgEl = hitPath.ownerSVGElement;
  if (!svgEl) return null;
  const domPt = svgEl.createSVGPoint();
  domPt.x = pt.x;
  domPt.y = pt.y;
  const screen = domPt.matrixTransform(svgEl.getScreenCTM() ?? new DOMMatrix());
  return { x: screen.x, y: screen.y };
});

if (hoverPoint !== null) {
  await page.mouse.move(hoverPoint.x, hoverPoint.y);
} else {
  // Fallback
  await page.locator('[data-ignatius="flow-svg"] [data-contract-type="hidden"]').first().hover({ force: true });
}
await page.waitForSelector('[data-ignatius="flow-edge-tooltip"]', { timeout: 3000 });
await page.waitForTimeout(150); // allow any CSS transition to settle

const tooltipPath = await shot('02-edge-hover-tooltip.png');
note('  Captured tooltip screenshot.');

const tooltipText = await page.evaluate(() => {
  return document.querySelector('[data-ignatius="flow-edge-tooltip"]')?.textContent ?? '';
});
note(`  Tooltip text: "${tooltipText.trim().replace(/\n/g, ' | ')}"`);
note(`  Contract: "${hiddenEdgeContract.slice(0, 80)}…"`);

// Move away and confirm it disappears.
await page.mouse.move(50, 50);
await page.waitForFunction(
  () => document.querySelector('[data-ignatius="flow-edge-tooltip"]') === null,
  { timeout: 2000 },
);
await shot('03-after-hover.png');
note('  Tooltip gone after pointer leave.');

// ── Cleanup ───────────────────────────────────────────────────────────────────

await browser.close();
serverHandle.stop();

note(`\nVisual check complete. Screenshot at: ${tooltipPath}`);
note('Review the tooltip screenshot — it should show:');
note('  - A styled card with "SourceLabel → TargetLabel" header');
note('  - One column name per line (the full db: column list)');
note('  - Theme-aware surface/border/text colors');
process.exit(0);
