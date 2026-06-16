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
  // Find a gated db: edge (data-contract-type="hidden") and its contract text.
  // ---------------------------------------------------------------------------

  // Get the contract text from the first gated hidden edge.
  const hiddenEdgeContract = await page.evaluate((): string | null => {
    const svg = document.querySelector('[data-ignatius="flow-svg"]');
    if (!svg) return null;
    for (const g of svg.querySelectorAll('[data-contract-type="hidden"]')) {
      const contract = g.getAttribute('data-contract') ?? '';
      if (contract) return contract;
    }
    return null;
  });

  assert(
    hiddenEdgeContract !== null,
    'T2-setup: found at least one gated (hidden) db: edge in memory-lifecycle',
  );

  if (hiddenEdgeContract !== null) {
    // ---------------------------------------------------------------------------
    // Test 2: Hover the gated edge — tooltip appears with full column list.
    // ---------------------------------------------------------------------------

    // Hover the edge: get the bounding rect of the <g> element, then move the
    // mouse to a point on the transparent wide stroke (the actual hit-test area).
    // We walk the polyline segments to find a point ON the path, not just in bbox.
    const hoverPoint = await page.evaluate((): { x: number; y: number } | null => {
      const svg = document.querySelector('[data-ignatius="flow-svg"]');
      if (!svg) return null;
      const g = svg.querySelector('[data-contract-type="hidden"]') as SVGGElement | null;
      if (!g) return null;
      // The transparent wide stroke path is the last <path> in the group.
      const paths = g.querySelectorAll('path');
      const hitPath = paths[paths.length - 1] as SVGPathElement | null;
      if (!hitPath) return null;
      // Sample several points along the path and return the first that has a
      // non-zero bounding rect (meaning the path is visible on screen).
      const totalLen = hitPath.getTotalLength();
      if (totalLen === 0) return null;
      const pt = hitPath.getPointAtLength(totalLen / 2);
      // Convert SVG user-space coords to screen coords via the SVG element's
      // coordinate transform matrix.
      const svgEl = hitPath.ownerSVGElement;
      if (!svgEl) return null;
      const domPt = svgEl.createSVGPoint();
      domPt.x = pt.x;
      domPt.y = pt.y;
      const screen = domPt.matrixTransform(svgEl.getScreenCTM() ?? new DOMMatrix());
      return { x: screen.x, y: screen.y };
    });

    assert(hoverPoint !== null, 'T2-hover-setup: computed hover point on edge path');

    if (hoverPoint !== null) {
      await page.mouse.move(hoverPoint.x, hoverPoint.y);
    } else {
      // Fallback: use locator hover on the group
      await page.locator('[data-ignatius="flow-svg"] [data-contract-type="hidden"]').first().hover({ force: true });
    }

    // Wait for the tooltip to appear (no fixed sleep — use selector wait).
    await page.waitForSelector('[data-ignatius="flow-edge-tooltip"]', { timeout: 5000 });

    const tooltipText = await page.evaluate((): string => {
      const el = document.querySelector('[data-ignatius="flow-edge-tooltip"]');
      return el?.textContent ?? '';
    });

    // Split the contract on ', ' to get individual column tokens.
    // The tooltip must contain every token (the full list, not a truncation).
    const contractTokens = hiddenEdgeContract.split(', ').map(t => t.trim()).filter(Boolean);

    let allTokensPresent = true;
    for (const token of contractTokens) {
      if (!tooltipText.includes(token)) {
        allTokensPresent = false;
        console.error(`  FAIL  T2: tooltip missing token "${token}" (contract: "${hiddenEdgeContract.slice(0, 80)}")`);
        failures++;
      }
    }
    if (allTokensPresent && contractTokens.length > 0) {
      console.log(`  PASS  T2: tooltip text contains all ${contractTokens.length} contract token(s)`);
    }

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
