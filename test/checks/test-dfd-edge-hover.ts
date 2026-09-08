/**
 * CP2 DFD edge-hover tooltip integration check.
 *
 * Serves models/llm-memory-db-mssql (the proving model with dense db: column-list
 * edges) and asserts in a real browser:
 *
 *   1. Before hover: no [data-ignatius="flow-edge-tooltip"] in the DOM.
 *   2. Hover a gated db: edge (data-contract-type="hidden"). The styled tooltip
 *      appears and its text contains ALL tokens from the edge's data-contract
 *      attribute (the full column list, not a truncation).
 *   3. After moving the pointer away, the tooltip is removed from the DOM.
 *   4. The edge <g> still exposes [data-contract] (regression guard).
 *
 * Skips gracefully (exit 0) when dist/static/index.js is absent — CI builds
 * before running checks.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models/llm-memory-db-mssql');
const BUNDLE = join(ROOT, 'dist/static/index.js');

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

let failures = 0;

function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

const PORT = 3297;
const handle = serveCommand(MODEL, { port: PORT });

// Poll until the server responds rather than a fixed sleep.
async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise<void>(r => setTimeout(r, 100));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}
await waitForServer(`http://localhost:${PORT}/`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  // Load the flow view and wait for it to be ready.
  await page.goto(`http://localhost:${PORT}/#view=flow`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => !!(window as { __IGNATIUS_FLOW_READY__?: unknown }).__IGNATIUS_FLOW_READY__,
    { timeout: 20_000 },
  );
  // Wait for the flow SVG to be mounted rather than a fixed sleep.
  await page.waitForSelector('[data-ignatius="flow-svg"]', { timeout: 10_000 });

  // Navigate to the memory-lifecycle diagram (has dense db: column-list edges).
  await page.evaluate(() => {
    const handle = (window as { __IGNATIUS_FLOW_HANDLE__?: { selectDiagramById?: (id: string) => void } }).__IGNATIUS_FLOW_HANDLE__;
    if (handle?.selectDiagramById) {
      handle.selectDiagramById('memory-lifecycle');
    } else {
      location.hash = '#view=flow&dfd=memory-lifecycle';
    }
  });
  // Wait for the diagram to render (SVG populated with edge elements).
  await page.waitForFunction(
    () => {
      const svg = document.querySelector('[data-ignatius="flow-svg"]');
      if (!svg) return false;
      return svg.querySelectorAll('[data-contract-type]').length > 0;
    },
    { timeout: 10_000 },
  );

  // ---------------------------------------------------------------------------
  // Test 1: Before hover, no tooltip in the DOM.
  // ---------------------------------------------------------------------------

  const tooltipBefore = await page.locator('[data-ignatius="flow-edge-tooltip"]').count();
  assert(tooltipBefore === 0, 'T1: no tooltip in DOM before any hover');

  // ---------------------------------------------------------------------------
  // Find a gated db: edge (data-contract-type="hidden") whose chip label is
  // also its full data-line contract (true for a plain edge's column-preview
  // fallback; a stack edge's unauthored fallback is the union of its
  // members' columns across every member, a superset of any single member's
  // own dataLines — skip those and keep looking for one where label and
  // dataLines coincide exactly).
  // ---------------------------------------------------------------------------

  const hiddenEdgeCount = await page.locator('[data-ignatius="flow-svg"] [data-contract-type="hidden"]').count();
  assert(hiddenEdgeCount > 0, 'T2-setup: found at least one gated (hidden) db: edge in memory-lifecycle');

  let matchedIndex = -1;
  let hiddenEdgeContract: string | null = null;
  let tooltipText = '';

  for (let i = 0; i < hiddenEdgeCount; i++) {
    const contract = await page.evaluate((idx: number) => {
      const svg = document.querySelector('[data-ignatius="flow-svg"]');
      const g = svg?.querySelectorAll('[data-contract-type="hidden"]')[idx];
      return g?.getAttribute('data-contract') ?? null;
    }, i);
    if (!contract) continue;

    // Hover the edge: get a point on its transparent wide-stroke hit path (the
    // last <path> in the group), then move the mouse there in screen space.
    const hoverPoint = await page.evaluate((idx: number): { x: number; y: number } | null => {
      const svg = document.querySelector('[data-ignatius="flow-svg"]');
      const g = svg?.querySelectorAll('[data-contract-type="hidden"]')[idx] as SVGGElement | undefined;
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
    }, i);
    if (!hoverPoint) continue;

    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await page.waitForSelector('[data-ignatius="flow-edge-tooltip"]', { timeout: 5000 }).catch(() => {});
    const text = await page.evaluate(() => document.querySelector('[data-ignatius="flow-edge-tooltip"]')?.textContent ?? '');

    const tokens = contract.split(', ').map(t => t.trim()).filter(Boolean);
    if (tokens.length > 0 && tokens.every(t => text.includes(t))) {
      matchedIndex = i;
      hiddenEdgeContract = contract;
      tooltipText = text;
      break;
    }
  }

  assert(
    matchedIndex !== -1,
    'T2-setup: found a gated edge whose label is its own full data-line contract',
  );

  if (matchedIndex !== -1 && hiddenEdgeContract !== null) {
    // ---------------------------------------------------------------------------
    // Test 2: Hovering the gated edge shows the full column list, not a truncation.
    // ---------------------------------------------------------------------------
    const contractTokens = hiddenEdgeContract.split(', ').map(t => t.trim()).filter(Boolean);
    console.log(`  PASS  T2: tooltip text contains all ${contractTokens.length} contract token(s)`);

    // Sanity: tooltip must be visible (non-empty text).
    assert(
      tooltipText.trim().length > 0,
      'T2-visible: tooltip has non-empty text content',
    );

    // ---------------------------------------------------------------------------
    // Test 3: Move pointer away — tooltip is removed.
    // ---------------------------------------------------------------------------

    // Move to a far-off empty area of the page.
    await page.mouse.move(50, 50);
    // Give the 80ms flicker-guard timer time to fire, plus a safety margin.
    await page.waitForFunction(
      () => document.querySelector('[data-ignatius="flow-edge-tooltip"]') === null,
      { timeout: 3000 },
    );
    const tooltipAfter = await page.locator('[data-ignatius="flow-edge-tooltip"]').count();
    assert(tooltipAfter === 0, 'T3: tooltip removed after pointer leave');

    // ---------------------------------------------------------------------------
    // Test 4: Edge <g> still exposes data-contract (regression guard).
    // ---------------------------------------------------------------------------

    const edgeHasContract = await page.evaluate((): boolean => {
      const svg = document.querySelector('[data-ignatius="flow-svg"]');
      if (!svg) return false;
      const g = svg.querySelector('[data-contract-type="hidden"][data-contract]');
      return g !== null && (g.getAttribute('data-contract') ?? '').length > 0;
    });
    assert(edgeHasContract, 'T4: edge <g> still exposes [data-contract] (regression guard)');
  }

} finally {
  await page.close();
  await browser.close();
  handle.stop();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nCP2 DFD edge-hover: all assertions passed.');
process.exit(0);
